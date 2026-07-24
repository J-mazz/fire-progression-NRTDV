#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env.local ]]; then
  set -a
  source .env.local
  set +a
fi

: "${HF_TOKEN:?Set HF_TOKEN in .env.local or export it before running SAM-2}"

exec uv run python tools/process_hotspot_sam2.py "$@"
