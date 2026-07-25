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
  The catalog is **normalized** (`catalogFormat: 2`): `feeds` holds per-feed
  presentation, `assets` holds each observation once, and snapshots carry thin
  `{ref, ageHours}` entries — or `{feedId, status:"unavailable", statusReason}`
  for a gap. Bump `CATALOG_FORMAT` in both `types/index.ts` and
  `generate_catalog.js` on any breaking shape change.
- **Frontend** (`src/ts/`, TypeScript → esbuild bundle → Cloudflare Pages):
  - `main.ts` — app wiring, branding, ⋮ panel (Specs + Settings), 3D toggle.
  - `core/MapController.ts` — owns every source/layer, ordering, base imagery,
    Sentinel, terrain toggle. Consumes `ResolvedLayer[]`, never the wire format.
  - `core/SnapshotLayers.ts` — `resolveLayers()`, the **only** join of
    `feeds`+`assets` into flat layers. Wire-format knowledge stops here.
  - `core/TimelineController.ts` — snapshot scrubber, play/speed/Live.
  - `core/GeosplatLayer.ts` — WebGL2 instanced DEM "splat" terrain layer.
  - `network/CatalogClient.ts` — catalog polling + validation.
- **WASM core** (`src/cpp/`, C++26 modules via vendored `emsdk`): `main.cpp`
  exports a C ABI; `geosplat.cppm` decodes the `GSP1` terrain binary. The
  `renderer`/`shader_manager`/`buffer_parser` modules and the FlatBuffers headers
  are scaffolding for a future scene-graph path — compiled and exported, but not
  yet called from the frontend.
- **Pipeline** (`tools/`, Python via `uv` + a native C++/simdjson OSM→KML tool):
  `import_firms.py`, `process_hotspot_sam2.py`, `build_geosplat.py`,
  `fetch_context_kml.sh`. All read `catalog.config.json` for bounds/timeline.
  **Deliberately excluded from `npm run build`** — they belong to scheduled
  services with credentials/GPU; on failure the last valid snapshot is preserved.
  - SAM-2 splits encoder from decoder: each Sentinel scene is encoded **once**
    (`tools/sam2_encoder.py`) and reused by every hotspot frame that selects it.
    The encoder prefers `.models/sam2/encoder.onnx` on ONNX Runtime CUDA and
    falls back to torch; `--require-gpu` makes the fallback an error. torch is
    intentionally pinned to the CPU wheel — ORT owns the GPU work.

## Commands

- `npm run dev` — build + serve on :8787 via `tools/dev_server.js` (also exposes
  the dev-only `GET/PUT /api/config` write endpoint the Settings form uses).
- `npm run build` — tsc + esbuild + catalog + headers generation → `dist/`.
- `npm run build:wasm` — compile the C++26 modules to `public/wasm/`.
- `npm run build:pages` / `npm run deploy:pages` — production build + deploy.
- `npm test` — build + both suites; `npm run test:invariants` (fire-agnostic,
  the deploy gate) and `npm run test:fixture` (this fire's counts, self-skips
  once `event.id` changes so retargeting cannot break CI).
- `npm run typecheck`.

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
- **Publishers never mutate in place.** Stage, then swap by rename, config last.
  `tools/atomic_io.py` is the one implementation for Python; `register_context_layers.js`
  and `dev_server.js` mirror it in Node. `import_firms.py` merges over the existing
  archive by default (`--replace` for a clean rebuild) so a partial import cannot
  erase published history.
- **Tests must stay fire-agnostic** unless they live in `tests/fixture.test.js`.
  Anything asserting a specific date or count belongs there, behind the
  `event.id` skip guard.
- Cloudflare Pages is the only supported deployment target; `_headers` carries the
  CSP and cache policy, so any other host needs those reproduced.

## Open production follow-up

- Simplify/**tile** large KML geometry before serving (SAM-2 output is already
  simplified in `process_hotspot_sam2.py`); `roads.kml` is ~490 KB at current bounds.
- The scene-graph WASM path (`renderer`/`buffer_parser`/FlatBuffers) is built but
  unused — either wire it up or drop it.
