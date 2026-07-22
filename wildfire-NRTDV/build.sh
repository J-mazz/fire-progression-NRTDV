#!/usr/bin/env bash
set -euo pipefail

for f in "$HOME/emsdk/emsdk_env.sh" "./emsdk/emsdk_env.sh" "/opt/emsdk/emsdk_env.sh"; do
  [ -f "$f" ] && source "$f" > /dev/null 2>&1 && break
done
[ -f .env.local ] && source .env.local
[ -f .env ] && source .env

: "${MAP_KEY:?set MAP_KEY in .env.local}"
: "${COPERN_USER_ID:?set COPERN_USER_ID}"
: "${COPERN_ACCT_ID:?set COPERN_ACCT_ID}"

mkdir -p dist/data/firms dist/data/sentinel2 dist/data/sam src/generated tools src/cpp
FIRMS_CSV="$(mktemp)"
trap 'rm -f "$FIRMS_CSV"' EXIT

echo "Using BBOX -123.5,42.3,-122.5,43.0"
echo "Fetching FIRMS VIIRS NRT..."
curl -sSL --retry 3 --max-time 60 -o "$FIRMS_CSV" \
  "https://firms.modaps.eosdis.nasa.gov/api/area/csv/${MAP_KEY}/VIIRS_SNPP_NRT/-123.15,42.58,-122.85,42.78/1" || true
BYTES=$(wc -c < "$FIRMS_CSV")
echo " -> SNPP: $BYTES bytes (122 = header-only = VALID)"
if [ "$BYTES" -lt 200 ]; then
  python3 -c "import struct; open('dist/data/firms/firms_2026-07-15.bin','wb').write(struct.pack('<I',0))"
else
  FIRMS_CSV="$FIRMS_CSV" python3 - << 'PY'
import csv,struct,os,io
c=open(os.environ['FIRMS_CSV']).read().replace('\r','\n')
pts=[]
for r in csv.DictReader(io.StringIO(c)):
    try: pts.append((float(r['longitude']), float(r['latitude']), 0.0))
    except: continue
with open("dist/data/firms/firms_2026-07-15.bin",'wb') as out:
    out.write(struct.pack('<I',len(pts)))
    for x,y,z in pts: out.write(struct.pack('<fff',x,y,z))
PY
fi

echo "Fetching Sentinel-2..."
COPERN_USER_ID="$COPERN_USER_ID" COPERN_ACCT_ID="$COPERN_ACCT_ID" uv run --python 3.13 python tools/fetch_sentinel2.py --bbox -123.15,42.58,-122.85,42.78 --out dist/data/sentinel2/east_evans_2026-07-15_visual.tif || true
ls -lh dist/data/sentinel2/*.tif || true

echo "Running SAM2..."
uv run --python 3.13 python tools/sam2_segment.py --bbox -123.15,42.58,-122.85,42.78 --in=dist/data/sentinel2/east_evans_2026-07-15_visual.tif --out=ist/data/sam/sam_2026-07-15.geojson || true
ls -lh dist/data/sam/ || true

# Vendored flatbuffers for emcc sysroot isolation
if [ ! -f src/cpp/flatbuffers/flatbuffers.h ]; then
  mkdir -p src/cpp/flatbuffers
  cp /usr/include/flatbuffers/*.h src/cpp/flatbuffers/ 2>/dev/null || true
fi

if command -v flatc >/dev/null 2>&1 && [ -f src/scene_graph.fbs ]; then
  flatc --ts --gen-object-api -o src/generated src/scene_graph.fbs || true
fi

echo "Building WASM C++20 modules..."
mkdir -p /tmp/wasm_modules dist
rm -f /tmp/wasm_modules/*.pcm

emcc src/cpp/shader_manager.cppm -O3 -std=c++20 -I src/cpp -I src/generated --precompile -o /tmp/wasm_modules/wildfire.shader_manager.pcm
emcc src/cpp/buffer_parser.cppm -O3 -std=c++20 -I src/cpp -I src/generated -fprebuilt-module-path=/tmp/wasm_modules --precompile -o /tmp/wasm_modules/wildfire.buffer_parser.pcm
emcc src/cpp/renderer.cppm -O3 -std=c++20 -I src/cpp -I src/generated -fprebuilt-module-path=/tmp/wasm_modules --precompile -o /tmp/wasm_modules/wildfire.renderer.pcm

emcc src/cpp/main.cpp \
  /tmp/wasm_modules/wildfire.shader_manager.pcm \
  /tmp/wasm_modules/wildfire.buffer_parser.pcm \
  /tmp/wasm_modules/wildfire.renderer.pcm \
  -O3 -std=c++20 -I src/cpp -I src/generated -fprebuilt-module-path=/tmp/wasm_modules \
  -s USE_WEBGL2=1 -s INITIAL_MEMORY=67108864 -s MAXIMUM_MEMORY=268435456 -s ALLOW_MEMORY_GROWTH=0 \
  -s EXPORTED_FUNCTIONS='["_initialize_webgl_context","_ingest_flatbuffer_stream","_render_frame","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","HEAPU8"]' -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -o dist/wasm_pipeline.js

echo "Bundling frontend [WasmRenderer.ts + SAM2]..."
npx esbuild src/ts/main.ts --bundle --platform=browser --target=es2020 --minify --outfile=dist/client.js

echo "Build complete:"; ls -lh dist/client.js dist/wasm_pipeline.js dist/wasm_pipeline.wasm dist/data/firms/*.bin dist/data/sam/*.geojson

# auto-serve what backend already fetched
cat > dist/manifest.json <<EOF
{
  "firms": "./data/firms/firms_2026-07-15.bin",
  "sam": "./data/sam/sam_2026-07-15.geojson",
  "sentinel_png": "./data/sentinel2/east_evans_2026-07-15_visual.png"
}
EOF

# convert TIF -> PNG for shader_manager.cppm texture (browser can't read GeoTIFF)
uv run --python 3.13 python -c "
from PIL import Image; import pathlib, sys
tif=pathlib.Path('dist/data/sentinel2/east_evans_2026-07-15_visual.tif')
png=pathlib.Path('dist/data/sentinel2/east_evans_2026-07-15_visual.png')
if tif.exists():
    Image.open(tif).save(png)
    print(f'-> {png}')
"
