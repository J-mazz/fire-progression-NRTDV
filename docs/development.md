# Development

Requires Node.js 22+ and [uv](https://docs.astral.sh/uv/) (Python 3.13 and geospatial/SAM-2 dependencies are pinned in `pyproject.toml`/`uv.lock`).

```bash
npm install
uv sync
cp .env.example .env.local   # fill in only what you need; see the comments
npm run dev                  # http://localhost:8787
npm test
```

Run every Python tool through uv, e.g. `uv run python tools/import_firms.py --help`.

## Tests

| command | scope |
| --- | --- |
| `npm test` | builds, then runs both suites below |
| `npm run test:invariants` | fire-agnostic contract checks — the deploy gate |
| `npm run test:fixture` | East Evans Creek observation counts |

`tests/invariants.test.js` derives everything from `catalog.config.json`
(snapshot spacing, asset/reference integrity, CSP origin, geosplat header) and
compiles the frontend's own `validateCatalog` so the generator is checked against
the contract the browser enforces rather than a copy of it.

`tests/fixture.test.js` pins this fire's real numbers so the pipeline cannot
silently drop data. It **skips itself** when `event.id` changes, so retargeting
the project does not turn CI red. Add `--no-build` to reuse an existing `dist/`.

`npm run dev` serves the built `dist/` on `http://localhost:8787` via
`tools/dev_server.js`, which also exposes a **dev-only** config endpoint:

- `GET /api/config` — returns `public/data/catalog.config.json`.
- `PUT /api/config` — validates `{event, app, timeline}`, merges it into the config
  (preserving pipeline-populated `feeds`), and regenerates `dist/data/catalog.json`.

## Retargeting to another fire (⋮ → Settings)

The in-app **Settings** tab writes directly to `catalog.config.json` through that
endpoint. Frame the fire on the map, click **Use current map view**, set the timeline,
and **Save** — the map re-focuses via the catalog poller. Then run the pipeline
(FIRMS/SAM-2/geosplat/context, below) so the data layers match the new bounds.

Save is dev-only: the static Pages build strips `catalog.config.json` and has no write
endpoint, so Settings there is read-only and offers **Copy config JSON** instead.

## FIRMS hotspots

```bash
uv run python tools/import_firms.py \
  --config public/data/catalog.config.json \
  --output-dir public/data/firms  path/to/*.csv
```

Bins detections into `timeline.cadenceHours` frames and drops anything outside
`event.bounds`. Runs **incrementally**: the supplied CSVs are merged over the
already-published archive, so importing one new export does not erase history.
Pass `--replace` for a clean rebuild (use it after retargeting, when the old
fire's frames are no longer relevant) and `--no-bounds-filter` to keep
out-of-area detections.

## WASM (C++26, Emscripten)

```bash
npm run build:wasm
```

Sources the vendored `emsdk`, precompiles the `wildfire.*` C++26 modules, and writes the ES module + `.wasm` binary to `public/wasm/` (git-ignored). There is no Rust build path. The geosplat terrain decoder (`src/cpp/geosplat.cppm`) runs through this module in the browser.

## 3D terrain data

```bash
uv run python tools/build_geosplat.py
```

Regenerates `public/data/geosplat/terrain.splat` + `meta.json` (GSP1 binary: 512×512 grid of quantized heights, RGB, and surface normals) from the Copernicus GLO-30 DEM and the newest Sentinel scene. Requires network access.

## Contextual KML

```bash
bash tools/install_simdjson_local.sh
bash tools/fetch_context_kml.sh
```

Fetches OSM context, converts it with the native C++26/simdjson utility, and atomically publishes the four KML documents under `public/data/context/`. OpenStreetMap attribution remains visible in the map controls.

## Authenticated SAM-2 processing

Set `HF_TOKEN` in the git-ignored `.env.local`, then:

```bash
bash tools/run_hotspot_sam2.sh                 # GPU when available, CPU otherwise
bash tools/run_hotspot_sam2.sh --require-gpu   # for the scheduled service
```

The token is exported only to the uv-managed process and never appears in arguments or generated assets.

### Encoder acceleration

The hiera image encoder is ~95% of SAM-2's cost and does not depend on prompts,
so `process_hotspot_sam2.py` encodes each **Sentinel scene once** and reuses the
embeddings across every hotspot frame that resolves to it. With 13 frames over a
single scene that alone is ~8× less work.

`tools/sam2_encoder.py` then picks a backend:

- **`onnxruntime-cuda`** — runs the exported graph (`.models/sam2/encoder.onnx`,
  input `pixel_values[1,3,1024,1024]`, outputs the three-level feature pyramid)
  through the CUDA execution provider from `tools/gpu_runtime.py`. This is why
  `pyproject.toml` pins torch to the CPU wheel: torch handles pre/post-processing
  while ONNX Runtime carries the encoder on the GPU.
- **`torch`** — `Sam2Model.get_image_embeddings`, used when no CUDA stack or
  exported graph is present.

The split is numerically identical to the fused path. `--require-gpu` turns a
fallback into an error, which is what you want for a scheduled run: silently
dropping to CPU turns minutes into hours. Point `--encoder-onnx` elsewhere to use
a different export.

## Local GPU tools

ncnn/Vulkan tools install into the persistent, git-ignored `.tools/` directory:

```bash
bash tools/install_ncnn_local.sh
source tools/ncnn_env.sh
```

`tools/ncnn_env.sh` exports `WILDFIRE_VULKAN_DEVICE_INDEX` and `WILDFIRE_CUDA_DEVICE_INDEX` to select the GPU; note that Vulkan and CUDA enumerate devices independently.
