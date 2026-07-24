#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/native_env.sh

mkdir -p "$NATIVE_BIN"

g++ \
  -std=c++26 \
  -O3 \
  -march=native \
  -DNDEBUG \
  -Wall -Wextra -Wpedantic \
  -I "$SIMDJSON_ROOT/include" \
  src/native/osm_context_to_kml.cpp \
  -L "$SIMDJSON_ROOT/lib64" \
  -Wl,-rpath,'$ORIGIN/../simdjson/root/usr/lib64' \
  -lsimdjson \
  -o "$NATIVE_BIN/osm-context-to-kml"

printf 'Built native C++26 tools:\n  %s\n' "$NATIVE_BIN/osm-context-to-kml"
