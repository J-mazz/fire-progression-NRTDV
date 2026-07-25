# Wildfire Boundary Tracking with Near-Real-Time Data Visualization

Live map of the East Evans Creek fire (started July 10, 2026). Open it and it works: no setup, no configuration, no account.

Coverage begins July 16: a NASA FIRMS VIIRS outage blocked reliable thermal data for the first six days of the fire.

## Using the map

- **Timeline**: scrub through three-hour snapshots from July 16 to July 22, press Play, change speed, or hit Live to follow the newest data.
- **⋮ menu**: mission specifications and feed details; the dot on the button reflects feed health.
- **3D button**: tilts the view onto a terrain surface built from real elevation data and the latest satellite pass.

## What you're seeing

- Sentinel-2 SWIR false-color imagery (cuts through smoke, highlights burn scars)
- VIIRS thermal detections as an age-faded heat field
- SAM-2 segmented fire body showing the progression envelope
- Roads, county borders, city limits, and landscape features from OpenStreetMap

Every layer comes from real observations; nothing is fabricated. The map updates itself as new data is published.

The full specification for the fire currently in focus lives in [fire-specs.md](fire-specs.md).

## Focus on a different fire

This app is polymorphous: one deployment can be pointed at any fire by supplying its
coordinates and timeline. When running locally (`npm run dev`):

1. Frame the fire on the map, then open **⋮ → Settings**.
2. Enter a name and the timeline, click **Use current map view** to capture the area, and **Save**.
3. Save writes `public/data/catalog.config.json` and the map re-focuses immediately.
4. Run the data pipeline (see [Development](docs/development.md)) for the new area so the
   thermal, Sentinel, SAM-2, and terrain layers are regenerated to match.

The same config file is the single source of truth for both the map and the pipeline.

On the **deployed** site the Settings form is read-only: it offers **Copy config JSON** to
carry the fire definition into the pipeline config. Live retargeting from the UI is
developed separately in the
[wildfire-boundary-tracker](https://github.com/J-mazz/wildfire-boundary-tracker) fork.

## Technical documentation

- [Development](docs/development.md): local setup, WASM/C++26 build, terrain data, KML tooling, SAM-2 processing
- [Data contract & pipeline](docs/data-contract.md): snapshot catalog format, layer semantics, pipeline boundary
- [Deployment](docs/deployment.md): Cloudflare Pages build and CI

