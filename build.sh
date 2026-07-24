#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

echo "Type-checking frontend..."
npx tsc --noEmit

echo "Bundling MapLibre application..."
npx esbuild src/ts/main.ts \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --minify \
  --sourcemap \
  --outfile=dist/client.js

cp src/index.html dist/index.html
cp -R public/. dist/
node tools/generate_catalog.js public/data/catalog.config.json dist/data/catalog.json
rm -f dist/data/catalog.config.json

echo "Build complete:"
find dist -maxdepth 2 -type f -printf '  %p (%s bytes)\n' | sort
