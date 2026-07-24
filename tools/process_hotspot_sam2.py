#!/usr/bin/env python3
import argparse
import json
import math
import os
import shutil
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
import torch
from PIL import Image
from rasterio.features import shapes
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from transformers import Sam2Model, Sam2Processor

COMPOSITE_NAME = "B12/B8A/B04"
COMPOSITE_ASSETS = ("swir22", "nir08", "red")


def parse_args():
    parser = argparse.ArgumentParser(description="Segment FIRMS hotspot clusters on real Sentinel-2 imagery with SAM-2.")
    parser.add_argument("--config", type=Path, default=Path("public/data/catalog.config.json"))
    parser.add_argument("--public-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--model", default="facebook/sam2.1-hiera-tiny")
    parser.add_argument("--cloud-max", type=float, default=20.0)
    parser.add_argument("--image-size", type=int, default=1024)
    parser.add_argument("--cluster-radius-m", type=float, default=900.0)
    parser.add_argument("--max-prompts", type=int, default=12)
    parser.add_argument(
        "--simplify-tolerance-m", type=float, default=None,
        help="Polygon simplification tolerance in meters; defaults to app.simplifyToleranceMeters or 15.",
    )
    return parser.parse_args()


# Degrees per meter of latitude; longitude is denser but a single epsilon is
# adequate for the coarse (~15 m) simplification these masks need.
METERS_PER_DEGREE = 111_320.0


def _perp_distance(point, start, end):
    (px, py), (ax, ay), (bx, by) = point, start, end
    dx, dy = bx - ax, by - ay
    denom = math.hypot(dx, dy)
    if denom == 0:
        return math.hypot(px - ax, py - ay)
    return abs(dy * px - dx * py + bx * ay - by * ax) / denom


def _rdp(points, epsilon):
    if len(points) < 3:
        return list(points)
    start, end = points[0], points[-1]
    index, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        distance = _perp_distance(points[i], start, end)
        if distance > dmax:
            index, dmax = i, distance
    if dmax > epsilon:
        return _rdp(points[: index + 1], epsilon)[:-1] + _rdp(points[index:], epsilon)
    return [start, end]


def simplify_ring(ring, epsilon):
    """Ramer-Douglas-Peucker on a closed ring, split at its two extremes."""
    if len(ring) <= 5:
        return ring
    closed = ring[0] == ring[-1]
    points = list(ring[:-1]) if closed else list(ring)
    anchor = max(range(len(points)), key=lambda i: (points[i][0] - points[0][0]) ** 2 + (points[i][1] - points[0][1]) ** 2)
    if anchor == 0:
        return ring
    first = _rdp(points[: anchor + 1], epsilon)[:-1]
    second = _rdp(points[anchor:] + [points[0]], epsilon)[:-1]
    simplified = first + second
    if len(simplified) < 3:
        return ring
    simplified.append(simplified[0])
    return simplified


def simplify_geometry(geometry, epsilon):
    if epsilon <= 0:
        return geometry
    if geometry["type"] == "Polygon":
        return {**geometry, "coordinates": [simplify_ring(ring, epsilon) for ring in geometry["coordinates"]]}
    if geometry["type"] == "MultiPolygon":
        return {**geometry, "coordinates": [[simplify_ring(ring, epsilon) for ring in poly] for poly in geometry["coordinates"]]}
    return geometry


def count_vertices(geometry):
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return sum(len(ring) for ring in coordinates)
    if geometry["type"] == "MultiPolygon":
        return sum(len(ring) for poly in coordinates for ring in poly)
    return 0


def iso(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def stac_search(bounds, start_at, end_at):
    payload = json.dumps({
        "collections": ["sentinel-2-l2a"],
        "bbox": bounds,
        "datetime": f"{start_at}/{end_at}",
        "limit": 100,
    }).encode()
    request = urllib.request.Request(
        "https://earth-search.aws.element84.com/v1/search",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "wildfire-nrtdv/0.1"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return json.load(response)["features"]


def scene_groups(items, cloud_max):
    grouped = {}
    for item in items:
        props = item["properties"]
        cloud = float(props.get("eo:cloud_cover", 100.0))
        if cloud > cloud_max or not all(asset in item.get("assets", {}) for asset in COMPOSITE_ASSETS):
            continue
        timestamp = iso(props["datetime"])
        key = timestamp.date().isoformat()
        group = grouped.setdefault(key, {"observedAt": timestamp, "items": [], "cloud": []})
        group["items"].append(item)
        group["cloud"].append(cloud)
        if timestamp < group["observedAt"]:
            group["observedAt"] = timestamp
    return sorted(grouped.values(), key=lambda group: group["observedAt"])


def render_scene(group, bounds, size):
    transform = from_bounds(*bounds, size, size)
    mosaic = np.zeros((3, size, size), dtype=np.float32)
    coverage = np.zeros((size, size), dtype=bool)
    for item in sorted(group["items"], key=lambda value: value["properties"].get("eo:cloud_cover", 100), reverse=True):
        tile = np.zeros_like(mosaic)
        for channel, asset_name in enumerate(COMPOSITE_ASSETS):
            with rasterio.open(item["assets"][asset_name]["href"]) as source:
                reproject(
                    source=rasterio.band(source, 1), destination=tile[channel],
                    src_transform=source.transform, src_crs=source.crs,
                    dst_transform=transform, dst_crs="EPSG:4326",
                    dst_nodata=0, resampling=Resampling.bilinear,
                )
        valid = np.any(tile > 0, axis=0)
        mosaic[:, valid] = tile[:, valid]
        coverage |= valid
    if coverage.mean() < 0.95:
        raise RuntimeError(f"Sentinel crop covers only {coverage.mean():.1%} of the event bounds")
    stretched = np.zeros_like(mosaic, dtype=np.uint8)
    for channel in range(3):
        values = mosaic[channel][coverage & (mosaic[channel] > 0)]
        if values.size == 0:
            raise RuntimeError(f"Sentinel {COMPOSITE_ASSETS[channel]} band contains no valid pixels")
        low, high = np.percentile(values, (2, 98))
        normalized = np.clip((mosaic[channel] - low) / max(high - low, 1), 0, 1)
        stretched[channel] = np.round(np.power(normalized, 0.9) * 255).astype(np.uint8)
    return Image.fromarray(np.moveaxis(stretched, 0, 2), "RGB"), transform


def feathered_overlay(image, edge_fraction=0.1):
    width, height = image.size
    edge = max(1, int(min(width, height) * edge_fraction))
    y, x = np.ogrid[:height, :width]
    distance = np.minimum(
        np.minimum(x, width - 1 - x),
        np.minimum(y, height - 1 - y),
    )
    alpha = np.clip(distance / edge, 0, 1)
    alpha = np.round(np.power(alpha, 0.7) * 255).astype(np.uint8)
    overlay = image.convert("RGBA")
    overlay.putalpha(Image.fromarray(alpha, "L"))
    return overlay


def publish_directory(staging, destination):
    backup = destination.with_name(f"{destination.name}.previous")
    shutil.rmtree(backup, ignore_errors=True)
    if destination.exists():
        destination.rename(backup)
    try:
        staging.rename(destination)
    except Exception:
        if backup.exists() and not destination.exists():
            backup.rename(destination)
        raise
    shutil.rmtree(backup, ignore_errors=True)


def haversine_m(left, right):
    lon1, lat1 = map(math.radians, left)
    lon2, lat2 = map(math.radians, right)
    dlon, dlat = lon2 - lon1, lat2 - lat1
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(value))


def cluster_features(features, radius_m):
    points = [feature["geometry"]["coordinates"] for feature in features]
    unseen = set(range(len(points)))
    clusters = []
    while unseen:
        seed = unseen.pop()
        cluster = {seed}
        frontier = [seed]
        while frontier:
            current = frontier.pop()
            neighbours = {index for index in unseen if haversine_m(points[current], points[index]) <= radius_m}
            unseen -= neighbours
            cluster |= neighbours
            frontier.extend(neighbours)
        members = [features[index] for index in cluster]
        score = sum(float(member.get("properties", {}).get("frpMw") or 0) for member in members)
        clusters.append((score, members))
    return [members for _, members in sorted(clusters, key=lambda item: (item[0], len(item[1])), reverse=True)]


def pixel_boxes(clusters, bounds, size, max_prompts):
    west, south, east, north = bounds
    boxes = []
    for cluster in clusters[:max_prompts]:
        coordinates = [feature["geometry"]["coordinates"] for feature in cluster]
        lons = [point[0] for point in coordinates]
        lats = [point[1] for point in coordinates]
        x0 = (min(lons) - west) / (east - west) * size
        x1 = (max(lons) - west) / (east - west) * size
        y0 = (north - max(lats)) / (north - south) * size
        y1 = (north - min(lats)) / (north - south) * size
        padding = max(12, min(48, 20 + 3 * math.sqrt(len(cluster))))
        boxes.append([
            max(0, x0 - padding), max(0, y0 - padding),
            min(size - 1, x1 + padding), min(size - 1, y1 + padding),
        ])
    return boxes


def select_scene(groups, frame_time):
    prior = [group for group in groups if group["observedAt"] <= frame_time]
    if prior:
        return prior[-1]
    return min(groups, key=lambda group: abs((group["observedAt"] - frame_time).total_seconds()))


def polygonize_masks(masks, transform, frame_time, scene_time, model_name, epsilon):
    features = []
    raw_vertices = 0
    kept_vertices = 0
    for prompt_index, mask in enumerate(masks):
        for geometry, value in shapes(mask.astype(np.uint8), mask=mask, transform=transform):
            if value != 1:
                continue
            raw_vertices += count_vertices(geometry)
            geometry = simplify_geometry(geometry, epsilon)
            kept_vertices += count_vertices(geometry)
            features.append({
                "type": "Feature",
                "properties": {
                    "promptIndex": prompt_index,
                    "model": model_name,
                    "sentinelComposite": COMPOSITE_NAME,
                    "hotspotObservedAt": frame_time.isoformat().replace("+00:00", "Z"),
                    "sentinelObservedAt": scene_time.isoformat().replace("+00:00", "Z"),
                },
                "geometry": geometry,
            })
    return {"type": "FeatureCollection", "features": features}, raw_vertices, kept_vertices


def main():
    args = parse_args()
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise RuntimeError("HF_TOKEN is required; export it or run tools/run_hotspot_sam2.sh")
    config = json.loads(args.config.read_text())
    bounds = config["event"]["bounds"]
    tolerance_m = args.simplify_tolerance_m
    if tolerance_m is None:
        tolerance_m = config.get("app", {}).get("simplifyToleranceMeters", 15.0)
    epsilon = max(0.0, tolerance_m) / METERS_PER_DEGREE
    firms = [observation for observation in config["feeds"]["firms"]["observations"] if observation.get("status") == "ready"]
    if not firms:
        raise RuntimeError("No ready FIRMS hotspot frames to segment")

    items = stac_search(bounds, config["event"]["startedAt"], config["timeline"]["endAt"])
    groups = scene_groups(items, args.cloud_max)
    if not groups:
        raise RuntimeError(f"No Sentinel-2 scenes under {args.cloud_max}% cloud cover")

    # Keep only scenes a carry-forward timeline can reach: the latest baseline
    # at or before timeline start plus every scene inside the timeline window.
    timeline_start = iso(config["timeline"]["startAt"])
    baseline = [group for group in groups if group["observedAt"] <= timeline_start]
    groups = ([baseline[-1]] if baseline else []) + [
        group for group in groups if group["observedAt"] > timeline_start
    ]

    sentinel_dir = args.public_dir / "sentinel"
    sam_dir = args.public_dir / "sam2"
    sentinel_staging = args.public_dir / "sentinel.next"
    sam_staging = args.public_dir / "sam2.next"
    shutil.rmtree(sentinel_staging, ignore_errors=True)
    shutil.rmtree(sam_staging, ignore_errors=True)
    sentinel_staging.mkdir(parents=True)
    sam_staging.mkdir(parents=True)

    rendered = {}
    sentinel_observations = []
    for group in groups:
        image, transform = render_scene(group, bounds, args.image_size)
        scene_id = group["observedAt"].strftime("%Y-%m-%dT%H-%M-%SZ")
        path = sentinel_staging / f"sentinel-swir-{scene_id}.png"
        feathered_overlay(image).save(path, optimize=True)
        rendered[group["observedAt"].date().isoformat()] = (group, image, transform, path)
        sentinel_observations.append({
            "observedAt": group["observedAt"].isoformat().replace("+00:00", "Z"),
            "url": f"./data/sentinel/{path.name}",
            "status": "ready", "bounds": bounds, "opacity": 0.68,
            "cloudCoverPercent": max(group["cloud"]),
            "composite": COMPOSITE_NAME,
            "attribution": "Sentinel-2 L2A via Element 84 Earth Search",
        })

    processor = Sam2Processor.from_pretrained(args.model, token=hf_token)
    model = Sam2Model.from_pretrained(args.model, token=hf_token).eval()
    sam_observations = []
    total_raw_vertices = 0
    total_kept_vertices = 0
    for observation in firms:
        frame_time = iso(observation["observedAt"])
        firms_path = args.public_dir.parent / observation["url"].removeprefix("./")
        collection = json.loads(firms_path.read_text())
        clusters = cluster_features(collection["features"], args.cluster_radius_m)
        boxes = pixel_boxes(clusters, bounds, args.image_size, args.max_prompts)
        if not boxes:
            continue
        scene = select_scene(groups, frame_time)
        _, image, transform, _ = rendered[scene["observedAt"].date().isoformat()]
        inputs = processor(images=image, input_boxes=[boxes], return_tensors="pt")
        with torch.inference_mode():
            outputs = model(**inputs, multimask_output=True)
        processed = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0]
        scores = outputs.iou_scores.cpu()[0]
        selected_masks = []
        for object_index in range(processed.shape[0]):
            best_index = int(scores[object_index].argmax())
            selected_masks.append(processed[object_index, best_index].numpy().astype(bool))
        geojson, raw_vertices, kept_vertices = polygonize_masks(
            selected_masks, transform, frame_time, scene["observedAt"], args.model, epsilon
        )
        if not geojson["features"]:
            continue
        total_raw_vertices += raw_vertices
        total_kept_vertices += kept_vertices
        frame_id = frame_time.strftime("%Y-%m-%dT%H-%M-%SZ")
        output_path = sam_staging / f"sam2-{frame_id}.geojson"
        output_path.write_text(json.dumps(geojson, separators=(",", ":")) + "\n")
        sam_observations.append({
            "observedAt": frame_time.isoformat().replace("+00:00", "Z"),
            "url": f"./data/sam2/{output_path.name}",
            "status": "ready", "featureCount": len(geojson["features"]),
            "model": args.model, "promptCount": len(boxes),
            "composite": COMPOSITE_NAME,
            "sourceLagHours": round((frame_time - scene["observedAt"]).total_seconds() / 3600, 2),
        })

    publish_directory(sentinel_staging, sentinel_dir)
    publish_directory(sam_staging, sam_dir)
    config["feeds"]["sentinel"]["observations"] = sentinel_observations
    config["feeds"]["sam2"]["observations"] = sam_observations
    config["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    args.config.write_text(json.dumps(config, indent=2) + "\n")
    reduction = (1 - total_kept_vertices / total_raw_vertices) * 100 if total_raw_vertices else 0.0
    print(
        f"Published {len(sentinel_observations)} Sentinel scenes and {len(sam_observations)} SAM-2 hotspot masks; "
        f"simplified {total_raw_vertices} → {total_kept_vertices} vertices ({reduction:.0f}% fewer) at {tolerance_m:.0f} m tolerance."
    )


if __name__ == "__main__":
    main()
