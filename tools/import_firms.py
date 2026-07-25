#!/usr/bin/env python3
"""Publish FIRMS CSV exports as cadence-aligned GeoJSON observations.

Runs incrementally by default: detections from the supplied CSVs are merged over
whatever is already published, so importing a single new export does not erase
the archive. Pass --replace for a clean rebuild. Nothing is deleted until the
new tree is complete, and the config is swapped in by rename.
"""

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from atomic_io import publish_directory, staging_dir, write_json_atomic

FRAME_FORMAT = "%Y-%m-%dT%H-%M-%SZ"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--replace", action="store_true",
        help="Discard already-published frames instead of merging the CSVs over them.",
    )
    parser.add_argument(
        "--no-bounds-filter", action="store_true",
        help="Keep detections outside event.bounds (default drops them).",
    )
    parser.add_argument("csv", nargs="+", type=Path)
    return parser.parse_args()


def frame_timestamp(observed, cadence_hours):
    """Bin an acquisition to the start of its cadence window."""
    return observed.replace(
        hour=(observed.hour // cadence_hours) * cadence_hours,
        minute=0, second=0, microsecond=0,
    )


def optional_number(value, number_type=float):
    try:
        return number_type(value)
    except (TypeError, ValueError):
        return None


def within(bounds, longitude, latitude):
    west, south, east, north = bounds
    return west <= longitude <= east and south <= latitude <= north


def read_detections(csv_paths, bounds, cadence_hours):
    """Group detections from the CSVs into cadence frames, de-duplicating by identity."""
    frames = defaultdict(list)
    seen = set()
    outside = 0

    for csv_path in csv_paths:
        with csv_path.open(newline="", encoding="utf-8-sig") as source:
            for row in csv.DictReader(source):
                if not row.get("latitude") or not row.get("longitude"):
                    continue
                longitude = float(row["longitude"])
                latitude = float(row["latitude"])
                if bounds is not None and not within(bounds, longitude, latitude):
                    outside += 1
                    continue
                acquired = datetime.strptime(
                    f"{row['acq_date']} {row['acq_time'].zfill(4)}", "%Y-%m-%d %H%M"
                ).replace(tzinfo=timezone.utc)
                identity = (row.get("satellite"), acquired.isoformat(), row["latitude"], row["longitude"])
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
                frames[frame_timestamp(acquired, cadence_hours)].append({
                    "type": "Feature",
                    "properties": {key: value for key, value in properties.items() if value is not None},
                    "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
                })
    return frames, len(seen), outside


def main():
    args = parse_args()
    config = json.loads(args.config.read_text())
    cadence_hours = config["timeline"]["cadenceHours"]
    if not isinstance(cadence_hours, int) or cadence_hours <= 0 or 24 % cadence_hours:
        raise SystemExit(f"timeline.cadenceHours must be a positive divisor of 24, got {cadence_hours!r}")
    bounds = None if args.no_bounds_filter else config["event"]["bounds"]

    frames, detections, outside = read_detections(args.csv, bounds, cadence_hours)

    # Assemble the complete next tree before touching what is currently served.
    staging = staging_dir(args.output_dir)
    carried = 0
    if not args.replace and args.output_dir.is_dir():
        for existing in sorted(args.output_dir.glob("firms-*.geojson")):
            (staging / existing.name).write_bytes(existing.read_bytes())
            carried += 1

    for frame, features in sorted(frames.items()):
        target = staging / f"firms-{frame.strftime(FRAME_FORMAT)}.geojson"
        target.write_text(
            json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n"
        )

    # Derive observations from the staged tree so the config always matches disk.
    observations = []
    for path in sorted(staging.glob("firms-*.geojson")):
        stamp = datetime.strptime(path.stem.removeprefix("firms-"), FRAME_FORMAT).replace(tzinfo=timezone.utc)
        collection = json.loads(path.read_text())
        observations.append({
            "observedAt": stamp.isoformat().replace("+00:00", "Z"),
            "url": f"./data/firms/{path.name}",
            "status": "ready",
            "featureCount": len(collection["features"]),
        })

    publish_directory(staging, args.output_dir)

    config["feeds"]["firms"]["observations"] = observations
    config["updatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    write_json_atomic(args.config, config)

    dropped = f", dropped {outside} outside event bounds" if outside else ""
    reused = f", carried {carried} previously published frame(s)" if carried else ""
    print(
        f"Published {detections} detections across {len(observations)} {cadence_hours}-hour frames"
        f"{reused}{dropped}."
    )


if __name__ == "__main__":
    main()
