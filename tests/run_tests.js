const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const result = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
if (result.status !== 0) {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const catalog = JSON.parse(read('dist/data/catalog.json'));
const catalogConfig = JSON.parse(read('public/data/catalog.config.json'));
const html = read('dist/index.html');
const bundle = read('dist/client.js');
const mapControllerSource = read('src/ts/core/MapController.ts');
const wasmBuild = read('tools/build_wasm.sh');
const nativeBuild = read('tools/build_native.sh');
const nativeConverter = read('src/native/osm_context_to_kml.cpp');
const contextManifest = JSON.parse(read('dist/data/context/manifest.json'));
const supportedFormats = new Set(['xyz', 'image', 'geojson', 'kml']);

assert.equal(catalog.event.startedAt, '2026-07-10T00:00:00Z', 'event start date must remain authoritative');
assert.equal(catalog.timeline.cadenceHours, 3, 'timeline must use three-hour FIRMS windows');
assert.equal(catalog.timeline.startAt, '2026-07-16T09:00:00Z', 'timeline must begin with the first reliable FIRMS pass');
assert.equal(catalog.snapshots.length, 53, 'timeline requires 53 three-hour frames from July 16 09:00 through July 22');
assert.equal(catalog.snapshots[0].observedAt, '2026-07-16T09:00:00.000Z');
assert.equal(catalog.snapshots.at(-1).observedAt, '2026-07-22T21:00:00.000Z');
assert.ok(contextManifest.roads >= 250, 'major-road KML is unexpectedly sparse');
assert.ok(contextManifest['county-borders'] >= 2, 'county-border KML is missing');
assert.ok(contextManifest['city-limits'] >= 4, 'city-limit KML is missing');
assert.ok(contextManifest['landscape-features'] >= 100, 'landscape identity KML is unexpectedly sparse');
for (const filename of ['roads.kml', 'county-borders.kml', 'city-limits.kml', 'landscape-features.kml']) {
  assert.match(read(`dist/data/context/${filename}`), /^<\?xml[^]*<kml /, `${filename} is not valid KML output`);
}
assert.deepEqual(
  [...catalog.snapshots].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)),
  catalog.snapshots,
  'snapshots must be chronological'
);
for (let index = 1; index < catalog.snapshots.length; index += 1) {
  const previous = Date.parse(catalog.snapshots[index - 1].observedAt);
  const current = Date.parse(catalog.snapshots[index].observedAt);
  assert.equal(current - previous, 10_800_000, 'snapshots must cover every three-hour window');
}

for (const snapshot of catalog.snapshots) {
  assert.ok(snapshot.id && snapshot.observedAt && Array.isArray(snapshot.layers));
  const firmsLayers = snapshot.layers.filter((layer) => layer.kind === 'firms');
  assert.ok(firmsLayers.length > 0, `FIRMS trail/status missing at ${snapshot.observedAt}`);
  for (const firms of firmsLayers.filter((layer) => layer.status === 'ready')) {
    assert.ok(Date.parse(firms.sourceObservedAt) <= Date.parse(snapshot.observedAt), 'FIRMS trail cannot contain future observations');
    assert.ok(firms.ageHours >= 0 && firms.ageHours <= 168, 'FIRMS trail exceeded seven-day persistence');
  }
  const sentinel = snapshot.layers.find((layer) => layer.kind === 'sentinel-raster');
  if (sentinel) {
    assert.equal(sentinel.format, 'image');
    assert.equal(sentinel.composite, 'B12/B8A/B04', 'Sentinel must use the smoke-resistant SWIR/NIR/red composite');
    assert.ok(Array.isArray(sentinel.bounds) && sentinel.bounds.length === 4, 'Sentinel image requires geospatial bounds');
    assert.ok(Date.parse(sentinel.sourceObservedAt) <= Date.parse(snapshot.observedAt), 'Sentinel cannot precede its acquisition');
  }
  const samLayers = snapshot.layers.filter((layer) => layer.kind === 'sam-mask' && layer.status === 'ready');
  for (const sam2 of samLayers) {
    assert.ok(Date.parse(sam2.sourceObservedAt) <= Date.parse(snapshot.observedAt), 'SAM-2 path cannot contain future masks');
    assert.ok(sam2.ageHours >= 0 && sam2.ageHours <= 168, 'SAM-2 path exceeded seven-day persistence');
    assert.equal(sam2.model, 'facebook/sam2.1-hiera-tiny');
    assert.equal(sam2.composite, 'B12/B8A/B04', 'SAM-2 must segment the SWIR/NIR/red composite');
    assert.ok(sam2.promptCount > 0 && sam2.featureCount > 0, 'SAM-2 output requires prompts and polygons');
  }
  for (const layer of snapshot.layers) {
    if (layer.format) assert.ok(supportedFormats.has(layer.format), `unsupported format on ${layer.id}`);
    if (layer.status === 'ready') {
      assert.ok(layer.url || (Array.isArray(layer.tiles) && layer.tiles.length > 0), `ready layer ${layer.id} needs data`);
    }
  }
}

const publishedFirms = catalog.snapshots
  .flatMap((snapshot) => snapshot.layers)
  .filter((layer) => layer.kind === 'firms' && layer.status === 'ready');
const uniqueFirms = new Map(publishedFirms.map((layer) => [layer.sourceObservedAt, layer]));
assert.equal(uniqueFirms.size, 13, 'expected 13 unique VIIRS orbital-pass frames');
assert.ok([...uniqueFirms.values()].reduce((total, layer) => total + layer.featureCount, 0) >= 1163, 'FIRMS detection count regressed');

const sentinelAcquisitions = new Set(catalog.snapshots
  .flatMap((snapshot) => snapshot.layers)
  .filter((layer) => layer.kind === 'sentinel-raster')
  .map((layer) => layer.sourceObservedAt));
assert.equal(catalogConfig.feeds.sentinel.observations.length, 1, 'expected only timeline-relevant Sentinel acquisitions to be archived');
assert.equal(sentinelAcquisitions.size, 1, 'trimmed timeline should carry only the latest pre-window Sentinel acquisition');

const publishedSam2 = catalog.snapshots
  .flatMap((snapshot) => snapshot.layers)
  .filter((layer) => layer.kind === 'sam-mask' && layer.status === 'ready');
const uniqueSam2 = new Map(publishedSam2.map((layer) => [layer.sourceObservedAt, layer]));
assert.equal(uniqueSam2.size, uniqueFirms.size, 'every unique hotspot frame requires a SAM-2 mask');
assert.ok(publishedSam2.reduce((total, layer) => total + layer.featureCount, 0) > 0, 'SAM-2 produced no polygons');

assert.match(html, /id="map"/, 'map surface missing');
assert.match(html, /class="specifications"/, 'specifications surface missing');
assert.match(html, /class="timeline"/, 'timeline surface missing');
assert.doesNotMatch(html, /type="file"|Load KML/, 'viewers must not manually load incident data');
assert.ok(fs.existsSync(path.join(root, 'dist/client.css')), 'CSS bundle missing');
assert.doesNotMatch(bundle, /wasm_pipeline/, 'legacy WASM loader leaked into the frontend');
assert.match(wasmBuild, /-std=c\+\+26/, 'Emscripten WASM must compile in C++26 mode');
assert.doesNotMatch(wasmBuild, /cargo|rustc|wasm-pack/, 'WASM build must remain Emscripten/C++ only');
assert.match(nativeBuild, /-std=c\+\+26/, 'native tools must compile in C++26 mode');
assert.match(nativeConverter, /#include <simdjson\.h>/, 'native KML conversion must use simdjson');
assert.match(mapControllerSource, /layer\.kind === 'kml'.*layer\.format === 'kml'/, 'automatic KML loading is missing');
assert.match(bundle, /event-area-outline/, 'overlay ordering logic was not bundled');
assert.match(bundle, /is below a raster layer/, 'overlay ordering invariant was not bundled');
assert.match(mapControllerSource, /World_Imagery/, 'Earthview base must use global satellite imagery');
assert.match(mapControllerSource, /context-roads/, 'road context rendering is missing');
assert.match(mapControllerSource, /context-county-borders/, 'county-border rendering is missing');
assert.match(mapControllerSource, /context-city-limits/, 'city-limit rendering is missing');
assert.match(mapControllerSource, /context-landscape-labels/, 'landscape identity rendering is missing');
assert.match(mapControllerSource, /dataCache/, 'vector assets must be cached across timeline frames');
assert.match(mapControllerSource, /mergeLayerCollections/, 'timeline vectors must use persistent merged sources');
assert.doesNotMatch(mapControllerSource, /clearDynamicLayers/, 'timeline rendering must not destroy every layer per frame');
assert.match(mapControllerSource, /LAYER_SAM_FILL = 'sam-body-fill'/, 'SAM-2 solid-body fill is missing');
assert.match(mapControllerSource, /LAYER_SAM_LINE = 'sam-body-outline'/, 'SAM-2 body outline is missing');
assert.match(mapControllerSource, /id: LAYER_SAM_FILL, type: 'fill', source: SOURCE_SAM/, 'SAM-2 must render as filled geometry');
assert.doesNotMatch(mapControllerSource, /type: 'circle', source: SOURCE_SAM/, 'SAM-2 must not render circle symbols');
assert.match(mapControllerSource, /id: LAYER_FIRMS, type: 'heatmap', source: SOURCE_FIRMS/, 'VIIRS detections require a flattened thermal field');
assert.doesNotMatch(mapControllerSource, /type: 'circle', source: SOURCE_FIRMS/, 'VIIRS must not render persistent circle symbols');

console.log('Build and temporal catalog checks passed.');
