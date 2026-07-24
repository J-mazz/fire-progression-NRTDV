# East Evans Creek Near-Real-Time Earth View

MapLibre-based visualization for the East Evans Creek fire, whose recorded start date is **2026-07-10**. The browser presents a full-screen satellite Earthview, a compact specifications display, and an interactive snapshot timeline.

## Current milestone

- Global satellite Earthview base with event-area framing
- Versioned, timestamp-ordered snapshot catalog
- 53 contiguous three-hour frames from the first reliable FIRMS pass on July 16 at 09:00 UTC through July 22, 2026
- Automatic catalog polling with ETag and last-known-good fallback
- Independent Sentinel raster, VIIRS thermal-field, SAM-2 body, and KML vector contracts
- Automatic KML fetch and browser-side conversion to GeoJSON
- Automatic KML context for major roads, county borders, city limits, and named landscape features
- Timeline scrubbing, playback speed, and live mode
- Responsive two-surface interface: specifications plus timeline

The UI publishes only catalog layers marked `ready` with real source assets.

## Development

Requires Node.js 22 or newer and [uv](https://docs.astral.sh/uv/). Python 3.13 and all geospatial/SAM-2 dependencies are managed by `pyproject.toml` and `uv.lock`.

```bash
npm install
uv sync
npm run dev
```

The development server runs at `http://localhost:8787`.

```bash
npm test
```

Run every Python pipeline command through uv. For example:

```bash
uv run python tools/import_firms.py --help
```

Native ncnn/Vulkan tools are installed separately into the persistent, project-local `.tools/ncnn` directory:

```bash
bash tools/install_ncnn_local.sh
source tools/ncnn_env.sh
```

The downloaded RPMs are extracted locally; this does not install Fedora packages or alter the NVIDIA driver. `.tools/` is intentionally ignored by Git and survives normal uv synchronization and project builds.

On this hybrid-GPU host, Vulkan enumerates Intel as device `0`, the RTX 3000 Ada as device `1`, and llvmpipe as device `2`. `tools/ncnn_env.sh` therefore exports `WILDFIRE_VULKAN_DEVICE_INDEX=1`. CUDA has a separate NVIDIA-only namespace, so the same RTX is `WILDFIRE_CUDA_DEVICE_INDEX=0`. Do not interchange these indices.

### C++/WASM toolchain

WebAssembly is compiled exclusively from C++ through the vendored Emscripten SDK—there is no Rust or Cargo build path:

```bash
npm run build:wasm
```

This sources `emsdk/emsdk_env.sh`, precompiles the `wildfire.*` modules in C++26 mode, and writes the generated ES module plus `.wasm` binary to `public/wasm/`. Generated artifacts are ignored by Git.

### Contextual KML

Context layers are fetched from OpenStreetMap and converted with the native C++26/simdjson utility rather than Python object parsing:

```bash
bash tools/install_simdjson_local.sh
bash tools/fetch_context_kml.sh
```

The refresh publishes `roads.kml`, `county-borders.kml`, `city-limits.kml`, and `landscape-features.kml` atomically under `public/data/context/`, then updates only the corresponding catalog feeds. OpenStreetMap attribution remains visible in the map controls.

## Snapshot catalog

`public/data/catalog.json` is the frontend/backend contract. Snapshots must be chronological and should use source observation times—not processing times or filename dates. Each snapshot can publish:

- `sentinel-raster`: XYZ raster tile templates
- `firms`: GeoJSON points
- `sam-mask`: GeoJSON polygons
- `kml`: server-normalized GeoJSON vectors

The frontend polls this catalog every 30 seconds and automatically loads every `ready` layer for the selected three-hour frame. Viewers never upload or configure incident data. VIIRS observations persist as a seven-day age-faded thermal field. Sentinel imagery is acquisition-driven and carries forward from its real observation timestamp until a newer pass is published; the catalog never invents daily scenes. SAM-2 bodies persist as the progression envelope. KML entries may reference raw `.kml` documents (`"format": "kml"`) or pre-parsed GeoJSON (`"format": "geojson"`). A production publisher should write immutable assets first and atomically replace the catalog last.

Sentinel display and SAM-2 inference use a contrast-stretched **B12/B8A/B04** false-color composite (SWIR2/NIR/red). This reduces smoke scattering and improves active-fire/burn-scar contrast compared with true color. It does not make dense cloud or smoke completely transparent.

The Earthview publishes each acquisition as one georeferenced mosaic rather than exposing source-tile seams. Its footprint is four times the original area and is biased southeast toward Shady Cove to include the observed progression and smoke corridor.

Layer order is deterministic: global satellite base, Sentinel SWIR/NIR analysis, VIIRS thermal field, SAM-2 body, KML perimeter, then the event outline. Catalog ordering cannot place a raster above operational overlays.

VIIRS detections are flattened into a continuous thermal field weighted by fire radiative power and observation age. They are rendered beneath the persistent SAM-2 fire body rather than as point circles.

SAM-2 outputs persist for seven days and accumulate as filled fire-body polygons, producing a continuous progression path. They are rendered with solid fills and outlines only—never point or circle symbols. Newer masks are brighter; older path geometry remains visible in darker red beneath the current VIIRS trail.

## Data pipeline boundary

Acquisition and SAM-2 inference are deliberately excluded from `npm run build`. They require separate scheduled services with credentials, retries, quality checks, and GPU infrastructure. Deterministic frontend builds must never fabricate Sentinel imagery or report empty segmentation output as successful data.

The previous C++/Emscripten renderer remains under `src/cpp` for reference but is no longer part of the application build. It did not implement projection, tiled rasters, cameras, or independent geospatial layers.

### Authenticated SAM-2 processing

Set `HF_TOKEN` in the ignored `.env.local` file. The processing wrapper exports it only to the uv-managed process and never places it in command arguments or generated browser assets.

```bash
bash tools/run_hotspot_sam2.sh
```

`tools/process_hotspot_sam2.py` requires `HF_TOKEN` and passes it explicitly to `Sam2Processor.from_pretrained` and `Sam2Model.from_pretrained`.

## Production notes

- Replace the public satellite imagery endpoint with a production-appropriate provider or self-hosted tiles before significant traffic.
- Publish Sentinel imagery as georeferenced XYZ tiles or through a tile service rather than whole TIFF files.
- Simplify or tile large SAM-2 and KML geometries before exposing them to browsers.
- Preserve the latest valid snapshot whenever an acquisition or inference job fails.
