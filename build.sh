#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

rm -rf dist
mkdir -p dist

echo "Type-checking frontend..."
npx tsc --noEmit

echo "Bundling MapLibre application..."
esbuild_args=(
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --minify \
  --outfile=dist/client.js
)
if [[ "${SOURCE_MAPS:-1}" == "1" ]]; then
  esbuild_args+=(--sourcemap)
fi
npx esbuild src/ts/main.ts "${esbuild_args[@]}"

cp src/index.html dist/index.html
cp -R public/. dist/
node tools/inject_bootstrap.js public/data/catalog.config.json dist/index.html
node tools/generate_catalog.js public/data/catalog.config.json dist/data/catalog.json
node tools/generate_headers.js public/data/catalog.config.json public/_headers.template dist/_headers
rm -f dist/data/catalog.config.json dist/_headers.template

echo "Build complete:"
find dist -maxdepth 2 -type f -printf '  %p (%s bytes)\n' | sort
