# Data contract & pipeline

## Configuration source of truth

`public/data/catalog.config.json` defines the fire once, for both the frontend and
the pipeline. `tools/generate_catalog.js` expands it into the served
`dist/data/catalog.json`. Top-level blocks:

- `event` — id, name, `startedAt`, `center`, `bounds` (the pipeline's bounding box).
- `timeline` — `startAt`/`endAt`/`cadenceHours` (a positive divisor of 24).
- `app` — frontend presentation: `title`, `tagline`, `initialZoom`, `baseImagery`
  (`tiles`/`attribution`/`maxzoom`), and `simplifyToleranceMeters` (SAM-2 output).
- `feeds` — per-feed observation lists, populated by the pipeline tools.

The `app` and `event` blocks are carried into `catalog.json`; the frontend reads them
to brand the page, focus the map, and choose the base imagery. The ⋮ → **Settings**
form edits `event`/`app`/`timeline` (never `feeds`) — see [development](development.md).

## Snapshot catalog (`catalogFormat: 2`)

`dist/data/catalog.json` is the frontend/backend contract. It is **normalized**:
frame-invariant data is stored once and snapshots reference it.

```jsonc
{
  "catalogFormat": 2,
  "event": { ... }, "app": { ... }, "timeline": { ... },

  // Presentation per feed, stored once.
  "feeds": {
    "firms": { "label": "NASA FIRMS VIIRS", "kind": "firms", "format": "geojson" }
  },

  // One published observation each. Every field here is frame-invariant.
  "assets": {
    "firms-2026-07-16T09-00-00Z": {
      "feedId": "firms", "observedAt": "2026-07-16T09:00:00Z",
      "status": "ready", "url": "./data/firms/…", "featureCount": 291
    }
  },

  "snapshots": [{
    "id": "…", "observedAt": "…", "label": "…", "status": "ready",
    "layers": [
      { "ref": "firms-2026-07-16T09-00-00Z", "ageHours": 0 },   // cites an asset
      { "feedId": "sam2", "status": "unavailable",              // …or records a gap
        "statusReason": "No observations were published for this 3-hour window." }
    ]
  }]
}
```

`ageHours` is the only per-frame value, which matters because a rolling window
repeats one observation across many frames: at 3-hour cadence with 168-hour
persistence a single observation is cited up to 56 times. Storing full copies made
the catalog grow with `frames × window ÷ cadence`; references make that a small
constant. For the current fire it is 31 assets behind 1,227 references
(600 KB → 139 KB raw; 14.2 KB → 6.6 KB gzipped).

`resolveLayers` in `src/ts/core/SnapshotLayers.ts` is the only code that joins the
two maps; everything downstream works with flat layers.

Feed semantics:

- `sentinel-raster`: georeferenced image (acquisition-driven; carries forward until a newer pass)
- `firms`: VIIRS GeoJSON points, rendered as a seven-day age/FRP-weighted thermal field
- `sam-mask`: GeoJSON polygons, accumulated as the persistent fire-body progression
- `kml`: raw `.kml` or pre-parsed GeoJSON vectors

The frontend polls the catalog every 30 s with ETag and falls back to the last known
good copy. Only assets marked `ready` with real source files are rendered; the build
never fabricates data. `validateCatalog` rejects a catalog whose `catalogFormat` it
does not implement, along with dangling asset references.

Draw order, bottom to top: satellite base → Sentinel raster → context KML lines
(roads, county, city) → VIIRS field → SAM-2 body fill/outline → context labels →
incident perimeter vectors → event outline. Context lines sit *below* the fire
layers deliberately, so roads read as basemap instead of competing with the fire.
`MapController.raiseOverlays` is authoritative and asserts that nothing ends up
under a raster. In 3D mode the Sentinel raster hides because the terrain splats
carry its colors.

## Pipeline boundary

Acquisition and SAM-2 inference are excluded from `npm run build`; they belong to
scheduled services with credentials, retries, and GPU infrastructure.

Every publisher writes immutable assets to a staging location and swaps them in by
rename, then replaces the config the same way — so a failure leaves the previously
published tree fully intact. `tools/atomic_io.py` is the single implementation
(`write_json_atomic`, `write_bytes_atomic`, `staging_dir`, `publish_directory`);
`tools/register_context_layers.js` and `tools/dev_server.js` do the same in Node.
`import_firms.py` merges over the published archive by default, so importing one
new CSV export cannot erase history — pass `--replace` for a clean rebuild.

## Production notes

- **Base tile endpoint is config-driven** (`app.baseImagery`); the deployed CSP in
  `dist/_headers` is generated from that host at build (`tools/generate_headers.js`).
  Still replace the default public Esri endpoint with your own before real traffic.
- **Sentinel supports XYZ tiles**: an observation with `format:"xyz"` and a `tiles`
  array renders as a tiled raster; whole-image `url`+`bounds` remains supported.
  Prefer tiles over whole PNGs at scale.
- **SAM-2 geometry is simplified** at publish time (Douglas–Peucker, `app.simplifyToleranceMeters`).
- **Remaining follow-up:** simplify or tile large KML geometries before serving them
  (`roads.kml` is ~490 KB at the current bounds).
