#!/usr/bin/env bash

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SIMDJSON_ROOT="$project_root/.tools/simdjson/root/usr"
export NATIVE_BIN="$project_root/.tools/bin"

if [[ ! -f "$SIMDJSON_ROOT/include/simdjson.h" ]]; then
  echo "Project-local simdjson is missing; run: bash tools/install_simdjson_local.sh" >&2
  return 1 2>/dev/null || exit 1
fi

export PATH="$NATIVE_BIN:$PATH"
export LD_LIBRARY_PATH="$SIMDJSON_ROOT/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
