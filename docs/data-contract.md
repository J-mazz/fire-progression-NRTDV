# Data contract & pipeline

## Snapshot catalog

`public/data/catalog.json` is the frontend/backend contract. Snapshots are chronological and use source observation times. Coverage starts July 16, 2026 because the NASA FIRMS VIIRS outage prevented reliable detections between the fire's July 10 start and July 16. Feeds per snapshot:

- `sentinel-raster`: georeferenced image (acquisition-driven; carries forward until a newer pass)
- `firms`: VIIRS GeoJSON points, rendered as a seven-day age/FRP-weighted thermal field
- `sam-mask`: GeoJSON polygons, accumulated as the persistent fire-body progression
- `kml`: raw `.kml` or pre-parsed GeoJSON vectors

The frontend polls the catalog every 30 s with ETag and falls back to the last known good copy. Only layers marked `ready` with real source assets are shown; the build never fabricates data.

Layer order is deterministic: satellite base, Sentinel, VIIRS field, SAM-2 body, KML, event outline. In 3D mode the Sentinel raster hides because the terrain splats carry its colors. Publishers should write immutable assets first and replace the catalog atomically last.

Sentinel display and SAM-2 inference use a contrast-stretched B12/B8A/B04 (SWIR2/NIR/red) composite for smoke penetration and burn-scar contrast. The mosaic footprint is four times the event area, biased southeast toward Shady Cove.

## Pipeline boundary

Acquisition and SAM-2 inference are excluded from `npm run build`; they belong to scheduled services with credentials, retries, and GPU infrastructure. On failure, the latest valid snapshot is preserved.

## Production notes

- Replace the public satellite tile endpoint before significant traffic.
- Publish Sentinel imagery as XYZ tiles rather than whole files.
- Simplify or tile large SAM-2/KML geometries before serving them.
