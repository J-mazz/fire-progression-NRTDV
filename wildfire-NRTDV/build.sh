#!/usr/bin/env bash
set -euo pipefail

mkdir -p dist src/generated

if command -v flatc >/dev/null 2>&1; then
  echo "Generating FlatBuffers TypeScript bindings..."
  flatc --ts -o src/generated src/scene_graph.fbs
else
  echo "flatc not installed; skipping TypeScript FlatBuffers generation."
fi

echo "Building WASM module..."
emcc -fmodules-ts src/cpp/main.cpp src/cpp/renderer.cppm src/cpp/shader_manager.cppm src/cpp/buffer_parser.cppm \
  -O3 \
  -std=c++26 \
  -fmodules-ts \
  -s USE_WEBGL2=1 \
  -s NO_DISABLE_EXCEPTION_CATCHING \
  -s STRICT=1 \
  -DNDEBUG \
  -s INITIAL_MEMORY=268435456 \
  -s MAXIMUM_MEMORY=1073741824 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s EXPORTED_FUNCTIONS='["_initialize_webgl_context","_ingest_flatbuffer_stream","_render_frame","_malloc","_free","_ext_allocate_wasm_buffer","_ext_free_wasm_buffer","_ext_parse_scene_graph_stream"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","getValue","setValue","HEAPU8"]' \
  -o dist/wasm_pipeline.js

if command -v npm >/dev/null 2>&1; then
  echo "Bundling TypeScript frontend..."
  npm exec -- esbuild src/ts/main.ts --bundle --platform=browser --target=es2020 --outfile=dist/client.js
else
  echo "npm unavailable; skipping TypeScript bundling."
fi

echo "Build complete: dist/wasm_pipeline.js, dist/client.js"