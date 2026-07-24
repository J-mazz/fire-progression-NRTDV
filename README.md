# East Evans Creek Near-Real-Time Earth View

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

## Technical documentation

- [Development](docs/development.md): local setup, WASM/C++26 build, terrain data, KML tooling, SAM-2 processing
- [Data contract & pipeline](docs/data-contract.md): snapshot catalog format, layer semantics, pipeline boundary
- [Deployment](docs/deployment.md): Cloudflare Pages build and CI

