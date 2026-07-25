// Fire-agnostic contract tests. These must hold for ANY fire the project is
// retargeted to, so they are safe to gate deploys on. Anything that asserts a
// specific fire's dates or counts belongs in fixture.test.js.

const assert = require('node:assert/strict');
const { read, readJson, exists, assetPath, loadClientValidator, partitionLayers } = require('./helpers');

const catalog = readJson('dist/data/catalog.json');
const config = readJson('public/data/catalog.config.json');
const html = read('dist/index.html');

// --- the catalog must satisfy the validator the browser actually runs ---
const validateCatalog = loadClientValidator();
assert.doesNotThrow(() => validateCatalog(catalog), 'generated catalog must pass the frontend validator');
assert.equal(catalog.catalogFormat, 2, 'catalog format revision');

// --- timeline shape derives from config, not from a hard-coded fire ---
const cadenceMs = config.timeline.cadenceHours * 3_600_000;
const start = Date.parse(config.timeline.startAt);
const end = Date.parse(config.timeline.endAt);
assert.ok(24 % config.timeline.cadenceHours === 0, 'cadenceHours must divide 24');
assert.equal(
  catalog.snapshots.length,
  Math.floor((end - start) / cadenceMs) + 1,
  'snapshot count must follow from startAt/endAt/cadenceHours'
);
assert.equal(Date.parse(catalog.snapshots[0].observedAt), start, 'first snapshot is the timeline start');
for (let index = 1; index < catalog.snapshots.length; index += 1) {
  const previous = Date.parse(catalog.snapshots[index - 1].observedAt);
  const current = Date.parse(catalog.snapshots[index].observedAt);
  assert.equal(current - previous, cadenceMs, 'snapshots must be evenly spaced at the configured cadence');
}

// --- normalization actually holds ---
const assetIds = Object.keys(catalog.assets);
const urls = assetIds.map((id) => catalog.assets[id].url).filter(Boolean);
assert.equal(new Set(urls).size, urls.length, 'each published URL must appear as exactly one asset');

const referenced = new Set();
let referenceCount = 0;
for (const snapshot of catalog.snapshots) {
  const { refs, gaps } = partitionLayers(snapshot);
  referenceCount += refs.length;
  for (const entry of refs) {
    referenced.add(entry.ref);
    const asset = catalog.assets[entry.ref];
    assert.ok(asset, `snapshot ${snapshot.id} references missing asset ${entry.ref}`);
    assert.ok(catalog.feeds[asset.feedId], `asset ${entry.ref} references missing feed ${asset.feedId}`);
    assert.ok(entry.ageHours >= 0, 'ageHours must be non-negative');
    assert.ok(
      Date.parse(asset.observedAt) <= Date.parse(snapshot.observedAt),
      `snapshot ${snapshot.id} cannot cite a future observation`
    );
    const feedConfig = config.feeds[asset.feedId];
    if (feedConfig && feedConfig.mode === 'rolling-window') {
      assert.ok(
        entry.ageHours <= feedConfig.persistenceHours,
        `${asset.feedId} reference exceeded its ${feedConfig.persistenceHours}h persistence window`
      );
    }
  }
  for (const gap of gaps) {
    assert.ok(catalog.feeds[gap.feedId], `gap cites missing feed ${gap.feedId}`);
    assert.equal(gap.status, 'unavailable');
    assert.ok(gap.statusReason && gap.statusReason.length > 0, 'a gap must explain itself');
  }

  const hasReady = refs.some((entry) => catalog.assets[entry.ref].status === 'ready');
  assert.equal(
    snapshot.status,
    hasReady ? 'ready' : 'awaiting-data',
    `snapshot ${snapshot.id} status must reflect whether it has ready data`
  );
}
assert.equal(referenced.size, assetIds.length, 'every asset must be referenced by at least one snapshot');
assert.ok(referenceCount >= assetIds.length, 'references cannot be fewer than assets');

// --- every ready asset resolves to a real file, and nothing is fabricated ---
const supportedFormats = new Set(['xyz', 'image', 'geojson', 'kml']);
for (const [assetId, asset] of Object.entries(catalog.assets)) {
  const feed = catalog.feeds[asset.feedId];
  if (feed.format) assert.ok(supportedFormats.has(feed.format), `unsupported format on ${assetId}`);
  if (asset.status !== 'ready') continue;
  assert.ok(asset.url || (Array.isArray(asset.tiles) && asset.tiles.length > 0), `ready asset ${assetId} needs data`);
  if (asset.url && asset.url.startsWith('./')) {
    assert.ok(require('node:fs').existsSync(assetPath(asset.url)), `ready asset ${assetId} points at a missing file: ${asset.url}`);
  }
}

// --- build output ---
for (const artifact of ['dist/client.js', 'dist/client.css', 'dist/index.html', 'dist/_headers', 'dist/wasm/wildfire.js']) {
  assert.ok(exists(artifact), `${artifact} missing from build output`);
}
assert.ok(!exists('dist/data/catalog.config.json'), 'the private config must not ship');

const bootstrap = html.match(/<script type="application\/json" id="fire-bootstrap">(.*?)<\/script>/s);
assert.ok(bootstrap, 'bootstrap island missing');
const bootstrapData = JSON.parse(bootstrap[1].replaceAll('\\u003c', '<'));
assert.equal(bootstrapData.title, config.app.title, 'bootstrap must brand from config');
assert.deepEqual(bootstrapData.bounds, config.event.bounds, 'bootstrap must frame the configured event');

const imageryOrigin = new URL(config.app.baseImagery.tiles[0].replace(/\{[a-z-]+\}/gi, '0')).origin;
const headers = read('dist/_headers');
assert.ok(headers.includes(imageryOrigin), 'CSP must allow the configured imagery origin');
assert.ok(headers.includes("frame-ancestors 'none'"), 'CSP must deny framing');

// --- geosplat binary is self-consistent and covers the event ---
const geosplatMeta = readJson('public/data/geosplat/meta.json');
const geosplatBinary = require('node:fs').readFileSync(assetPath('./data/geosplat/terrain.splat'));
assert.equal(geosplatBinary.readUInt32LE(0), 0x31505347, 'geosplat magic mismatch');
const cells = geosplatBinary.readUInt16LE(4) * geosplatBinary.readUInt16LE(6);
assert.equal(geosplatBinary.length, 16 + cells * 7, 'geosplat section sizes are inconsistent');
assert.deepEqual(geosplatMeta.bounds, catalog.event.bounds, 'terrain must cover the event bounds');
assert.ok(geosplatMeta.maxHeightMeters > geosplatMeta.minHeightMeters, 'geosplat has no relief');

// --- rendering contract (source guards) ---
// Deliberately few: these encode product decisions that cannot be checked
// without a browser. They are guardrails, not behaviour tests.
const mapController = read('src/ts/core/MapController.ts');
assert.match(mapController, /id: LAYER_SAM_FILL, type: 'fill'/, 'SAM-2 must render as filled geometry');
assert.doesNotMatch(mapController, /type: 'circle', source: SOURCE_SAM/, 'SAM-2 must not render as circles');
assert.match(mapController, /id: LAYER_FIRMS, type: 'heatmap'/, 'VIIRS must render as a thermal field');
assert.doesNotMatch(mapController, /type: 'circle', source: SOURCE_FIRMS/, 'VIIRS must not render as circles');
assert.doesNotMatch(html, /type="file"|Load KML/, 'viewers must not manually load incident data');
assert.match(read('tools/build_wasm.sh'), /-std=c\+\+26/, 'WASM must compile as C++26');
assert.doesNotMatch(read('tools/build_wasm.sh'), /cargo|rustc|wasm-pack/, 'WASM build stays Emscripten/C++ only');

console.log(
  `invariants: ${catalog.snapshots.length} snapshots, ${assetIds.length} assets, ` +
  `${referenceCount} references, ${Object.keys(catalog.feeds).length} feeds — OK`
);
