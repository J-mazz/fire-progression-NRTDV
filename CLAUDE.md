# CLAUDE.md

Orientation for working in this repo. Keep it current when the architecture shifts.

## What this is

A **zero-setup, near-real-time wildfire map** — a static site (MapLibre GL) that
plays back three-hourly snapshots of a wildfire from **real observations only**
(nothing is fabricated). Currently focused on the East Evans Creek Fire (Shady
Cove, OR; started 2026-07-10). See [fire-specs.md](fire-specs.md) for this fire's
full spec sheet.

The project is **polymorphous**: retarget it to a different fire by entering that
fire's coordinates + timeline — ideally through the ⋮ → **Settings** form in the
UI, which writes back to `public/data/catalog.config.json` — then run the pipeline
for the new bounds.

## Architecture (two halves + one contract)

- **Contract:** `public/data/catalog.config.json` is the single source of truth
  (`event`, `timeline`, `app`, `feeds`). `tools/generate_catalog.js` expands it
  into `dist/data/catalog.json` (the frontend/backend boundary). The frontend
  polls that catalog every 30 s (ETag, last-known-good fallback).
- **Frontend** (`src/ts/`, TypeScript → esbuild bundle → Cloudflare Pages):
  - `main.ts` — app wiring, branding, ⋮ panel (Specs + Settings), 3D toggle.
  - `core/MapController.ts` — owns every source/layer, ordering, base imagery,
    Sentinel, terrain toggle.
  - `core/TimelineController.ts` — snapshot scrubber, play/speed/Live.
  - `core/GeosplatLayer.ts` — WebGL2 instanced DEM "splat" terrain layer.
  - `network/CatalogClient.ts` — catalog polling + validation.
- **WASM core** (`src/cpp/`, C++26 modules via vendored `emsdk`): `main.cpp`
  exports a C ABI; `geosplat.cppm` decodes the `GSP1` terrain binary.
- **Pipeline** (`tools/`, Python via `uv` + a native C++/simdjson OSM→KML tool):
  `import_firms.py`, `process_hotspot_sam2.py`, `build_geosplat.py`,
  `fetch_context_kml.sh`. All read `catalog.config.json` for bounds/timeline.
  **Deliberately excluded from `npm run build`** — they belong to scheduled
  services with credentials/GPU; on failure the last valid snapshot is preserved.

## Commands

- `npm run dev` — build + serve on :8787 via `tools/dev_server.js` (also exposes
  the dev-only `GET/PUT /api/config` write endpoint the Settings form uses).
- `npm run build` — tsc + esbuild + catalog + headers generation → `dist/`.
- `npm run build:wasm` — compile the C++26 modules to `public/wasm/`.
- `npm run build:pages` / `npm run deploy:pages` — production build + deploy.
- `npm test`, `npm run typecheck`.

## Conventions / gotchas

- **Never fabricate data.** Only `status: "ready"` layers with real assets render.
- **Settings Save has two modes** (`SettingsController` auto-detects): **dev** writes the
  config file instantly via `dev_server.js` `PUT /api/config`; **read-only** (deployed)
  offers "Copy config JSON". Live retargeting-as-a-service is developed separately in the
  `wildfire-boundary-tracker` fork. `build_pages.sh` strips `catalog.config.json` from `dist`.
- The Settings write path must **preserve `feeds`** (pipeline-populated) — it only
  overwrites `event` / `app` / `timeline`.
- Base imagery endpoint + CSP host are config-driven (`app.baseImagery`). If you
  change the imagery host, the generated `dist/_headers` CSP must allow it.
- Publishers write immutable assets first, then swap the catalog atomically last.

## Open production follow-up

- Simplify/**tile** large KML geometry before serving (SAM-2 output is already
  simplified in `process_hotspot_sam2.py`).
