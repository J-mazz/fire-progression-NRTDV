#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
npm run build
exec python3 -m http.server 8787 --directory dist
