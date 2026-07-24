#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
source tools/native_env.sh

config="$PWD/public/data/catalog.config.json"
workspace="$PWD/.tools/context"
response="$workspace/overpass.json.next"
staging="$PWD/public/data/context.next"
destination="$PWD/public/data/context"
backup="$PWD/public/data/context.previous"

bash tools/build_native.sh
mkdir -p "$workspace"
rm -rf "$staging"
mkdir -p "$staging"

IFS=',' read -r west south east north < <(
  node -e "const c=require(process.argv[1]); console.log(c.event.bounds.join(','))" "$config"
)

query="[out:json][timeout:90][bbox:${south},${west},${north},${east}];(way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary)$\"];relation[\"boundary\"=\"administrative\"][\"admin_level\"~\"^(6|8)$\"];nwr[\"name\"][\"natural\"];nwr[\"name\"][\"place\"~\"^(city|town|village|hamlet|locality)$\"];nwr[\"name\"][\"water\"];nwr[\"name\"][\"leisure\"~\"^(park|nature_reserve)$\"];nwr[\"name\"][\"boundary\"=\"protected_area\"];);out body center geom;"

curl --fail --silent --show-error --retry 3 --connect-timeout 20 --max-time 180 \
  --output "$response" \
  --data-urlencode "data=$query" \
  'https://overpass.kumi.systems/api/interpreter'

"$NATIVE_BIN/osm-context-to-kml" "$response" "$staging"

rm -rf "$backup"
if [[ -d "$destination" ]]; then mv "$destination" "$backup"; fi
if ! mv "$staging" "$destination"; then
  [[ -d "$backup" ]] && mv "$backup" "$destination"
  exit 1
fi
rm -rf "$backup"
mv "$response" "$workspace/overpass.json"

node tools/register_context_layers.js "$config" "$destination"
echo "Published contextual KML layers to $destination"
