#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

emsdk_env="$PWD/emsdk/emsdk_env.sh"
if [[ ! -f "$emsdk_env" ]]; then
  echo "Vendored emsdk environment not found: $emsdk_env" >&2
  exit 1
fi

export EMSDK_QUIET=1
source "$emsdk_env"

module_dir="$PWD/build/wasm/modules"
output_dir="$PWD/public/wasm"
rm -rf "$PWD/build/wasm" "$output_dir"
mkdir -p "$module_dir" "$output_dir"

common=(
  -O3
  -std=c++26
  -I "$PWD/src/cpp"
  -I "$PWD/src/generated"
  -fprebuilt-module-path="$module_dir"
)

echo "Precompiling C++26 modules with $(emcc --version | head -n 1)..."
emcc src/cpp/shader_manager.cppm "${common[@]}" --precompile \
  -o "$module_dir/wildfire.shader_manager.pcm"
emcc src/cpp/buffer_parser.cppm "${common[@]}" --precompile \
  -o "$module_dir/wildfire.buffer_parser.pcm"
emcc src/cpp/renderer.cppm "${common[@]}" --precompile \
  -o "$module_dir/wildfire.renderer.pcm"

echo "Linking Emscripten WASM runtime..."
emcc src/cpp/main.cpp \
  "$module_dir/wildfire.shader_manager.pcm" \
  "$module_dir/wildfire.buffer_parser.pcm" \
  "$module_dir/wildfire.renderer.pcm" \
  "${common[@]}" \
  -sUSE_WEBGL2=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=33554432 \
  -sMAXIMUM_MEMORY=268435456 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createWildfireWasm \
  -sENVIRONMENT=web \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS='["_initialize_webgl_context","_ingest_flatbuffer_stream","_render_frame","_ext_allocate_wasm_buffer","_ext_free_wasm_buffer"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -o "$output_dir/wildfire.js"

printf 'Built Emscripten artifacts:\n'
find "$output_dir" -maxdepth 1 -type f -printf '  %f (%s bytes)\n' | sort
