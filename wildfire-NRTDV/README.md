# East Evans Creek Fire NRT WASM Pipeline

This repository implements a high-efficiency Emscripten-based C++26 WebAssembly rendering pipeline for wildfire scene graph visualization.

## Build

Requires Emscripten SDK installed and activated.

```bash
emcc src/wasm_pipeline.cpp -O3 -std=c++26 -s USE_WEBGL2=1 -s NO_DISABLE_EXCEPTION_CATCHING -s STRICT=1 -DNDEBUG \
  -s EXPORTED_FUNCTIONS='[_initialize_webgl_context,_ingest_flatbuffer_stream,_render_frame,_malloc,_free]' \
  -s EXTRA_EXPORTED_RUNTIME_METHODS='["cwrap","getValue","setValue"]' \
  -o dist/wasm_pipeline.js
```

## Runtime

Load `dist/wasm_pipeline.js` and `dist/wasm_pipeline.wasm` in a browser, then call exposed functions from JavaScript.

## Notes

- Uses raw pointer arithmetic and null-terminated C strings for cross-boundary efficiency.
- Expects binary payloads to begin with a 32-bit vertex count followed by contiguous float triplets.

## Integration: manifests

This project supports manifest-driven startup for Earthview-style visualizations. Place a JSON manifest in `manifests/` and load it from the browser. The shipped example is `manifests/east_evans_creek_visualization.json`.

In the browser, the client exposes `loadVisualizationManifest(manifestUrl, Module)` which will:
- fetch and minimally validate the manifest
- initialize the WASM renderer
- log scene, camera and layer summaries

Example usage (in `index.html`):

```js
// auto-load example
window.loadVisualizationManifest('manifests/east_evans_creek_visualization.json', window.Module)
  .then(({ manifest, renderer }) => {
    // renderer is ready; you can feed buffers or connect sockets per manifest
  })
  .catch(err => console.error('manifest load failed', err));
```

Notes:
- The manifest format is minimal and intended to be extended. The client currently only supports initializing the renderer and logging layer metadata; it will attempt to open WebSocket URLs declared as vector layer `data_source` values.
- For production, add robust validation and secure fetching (CORS, auth) before connecting to external data sources.

FlatBuffers and JSON Schema
--------------------------------
This project now builds FlatBuffers in-browser before sending geometry to the WASM renderer. The page loads the FlatBuffers JS runtime and Ajv (JSON Schema validator) from CDNs. If the FlatBuffers runtime is unavailable, the client falls back to the legacy simple header format.

If you prefer to bundle dependencies locally, replace the CDN script tags in `index.html` with local copies of `flatbuffers.js` and `ajv.min.js`.
