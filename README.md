# East Evans Creek Near-Real-Time Earth View

MapLibre-based visualization for the East Evans Creek fire, whose recorded start date is **2026-07-10**. The browser presents a full-screen OpenStreetMap base, a compact specifications display, and an interactive snapshot timeline.

## Current milestone

- OpenStreetMap raster base with event-area framing
- Versioned, timestamp-ordered snapshot catalog
- Automatic catalog polling with ETag and last-known-good fallback
- Independent Sentinel raster, FIRMS point, SAM-2 mask, and KML vector layer contracts
- KML upload and browser-side conversion to GeoJSON
- Timeline scrubbing, playback speed, and live mode
- Responsive two-surface interface: specifications plus timeline

The catalog intentionally marks the existing July 15 artifacts unavailable because they are placeholders rather than validated geospatial products. The UI will publish a layer only when its catalog entry is `ready` and provides a real URL or tile template.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

The development server runs at `http://localhost:8787`.

```bash
npm test
```

## Snapshot catalog

`public/data/catalog.json` is the frontend/backend contract. Snapshots must be chronological and should use source observation times—not processing times or filename dates. Each snapshot can publish:

- `sentinel-raster`: XYZ raster tile templates
- `firms`: GeoJSON points
- `sam-mask`: GeoJSON polygons
- `kml`: server-normalized GeoJSON vectors

The frontend polls this catalog every 30 seconds. A production publisher should write immutable assets first and atomically replace the catalog last.

## Data pipeline boundary

Acquisition and SAM-2 inference are deliberately excluded from `npm run build`. They require separate scheduled services with credentials, retries, quality checks, and GPU infrastructure. Deterministic frontend builds must never fabricate Sentinel imagery or report empty segmentation output as successful data.

The previous C++/Emscripten renderer remains under `src/cpp` for reference but is no longer part of the application build. It did not implement projection, tiled rasters, cameras, or independent geospatial layers.

## Production notes

- Replace the public OpenStreetMap tile endpoint with a production-appropriate provider or self-hosted tiles before significant traffic.
- Publish Sentinel imagery as georeferenced XYZ tiles or through a tile service rather than whole TIFF files.
- Simplify or tile large SAM-2 and KML geometries before exposing them to browsers.
- Preserve the latest valid snapshot whenever an acquisition or inference job fails.
