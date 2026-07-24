#!/usr/bin/env python3
import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="Publish FIRMS CSV files as three-hour GeoJSON observations.")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("csv", nargs="+", type=Path)
    return parser.parse_args()


def frame_timestamp(acq_date, acq_time):
    padded = acq_time.zfill(4)
    observed = datetime.strptime(f"{acq_date} {padded}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)
    return observed.replace(hour=(observed.hour // 3) * 3, minute=0, second=0, microsecond=0)


def optional_number(value, number_type=float):
    try:
        return number_type(value)
    except (TypeError, ValueError):
        return None


def main():
    args = parse_args()
    frames = defaultdict(list)
    seen = set()

    for csv_path in args.csv:
        with csv_path.open(newline="", encoding="utf-8-sig") as source:
            for row in csv.DictReader(source):
                if not row.get("latitude") or not row.get("longitude"):
                    continue
                acquired = datetime.strptime(
                    f"{row['acq_date']} {row['acq_time'].zfill(4)}", "%Y-%m-%d %H%M"
                ).replace(tzinfo=timezone.utc)
                identity = (
                    row.get("satellite"), acquired.isoformat(), row["latitude"], row["longitude"]
                )
                if identity in seen:
                    continue
                seen.add(identity)
                properties = {
                    "observedAt": acquired.isoformat().replace("+00:00", "Z"),
                    "satellite": row.get("satellite"),
                    "instrument": row.get("instrument"),
                    "confidence": row.get("confidence"),
                    "frpMw": optional_number(row.get("frp")),
                    "brightnessI4K": optional_number(row.get("bright_ti4")),
                    "brightnessI5K": optional_number(row.get("bright_ti5")),
                    "dayNight": row.get("daynight"),
                    "scanKm": optional_number(row.get("scan")),
                    "trackKm": optional_number(row.get("track")),
                }
                frames[frame_timestamp(row["acq_date"], row["acq_time"])].append({
                    "type": "Feature",
                    "properties": {key: value for key, value in properties.items() if value is not None},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [float(row["longitude"]), float(row["latitude"])],
                    },
                })

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for existing in args.output_dir.glob("*.geojson"):
        existing.unlink()

    observations = []
    for frame, features in sorted(frames.items()):
        frame_id = frame.strftime("%Y-%m-%dT%H-00-00Z")
        output_path = args.output_dir / f"firms-{frame_id}.geojson"
        output_path.write_text(json.dumps({
            "type": "FeatureCollection",
            "features": features,
        }, separators=(",", ":")) + "\n")
        observations.append({
            "observedAt": frame.isoformat().replace("+00:00", "Z"),
            "url": f"./data/firms/{output_path.name}",
            "status": "ready",
            "featureCount": len(features),
        })

    config = json.loads(args.config.read_text())
    config["feeds"]["firms"]["observations"] = observations
    config["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    args.config.write_text(json.dumps(config, indent=2) + "\n")
    print(f"Published {len(seen)} detections across {len(observations)} three-hour frames.")


if __name__ == "__main__":
    main()
