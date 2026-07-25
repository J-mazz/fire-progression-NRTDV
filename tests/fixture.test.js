// Regression tests for the East Evans Creek dataset specifically.
//
// These pin real observation counts so a pipeline change cannot quietly drop
// data. They are meaningless for a different fire, so the whole suite skips
// itself once the project is retargeted — retargeting must not turn CI red.

const assert = require('node:assert/strict');
const { read, readJson, partitionLayers } = require('./helpers');

const FIXTURE_EVENT_ID = 'east-evans-creek-2026';

const catalog = readJson('dist/data/catalog.json');
const config = readJson('public/data/catalog.config.json');

if (catalog.event.id !== FIXTURE_EVENT_ID) {
  console.log(
    `fixture: skipped — project is retargeted to "${catalog.event.id}". ` +
    `Delete tests/fixture.test.js or repoint FIXTURE_EVENT_ID once the new fire's data is settled.`
  );
  return;
}

// --- timeline the fire is published on ---
assert.equal(catalog.event.startedAt, '2026-07-10T00:00:00Z', 'event start date must remain authoritative');
assert.equal(catalog.timeline.cadenceHours, 3, 'three-hour FIRMS windows');
assert.equal(catalog.timeline.startAt, '2026-07-16T09:00:00Z', 'coverage begins at the first reliable FIRMS pass');
assert.equal(catalog.snapshots.length, 53, '53 three-hour frames from Jul 16 09:00 through Jul 22 21:00');
assert.equal(catalog.snapshots.at(-1).observedAt, '2026-07-22T21:00:00.000Z');

// --- observation volumes: a drop here means the pipeline lost data ---
const assetsByFeed = (feedId) =>
  Object.entries(catalog.assets).filter(([, asset]) => asset.feedId === feedId && asset.status === 'ready');

const firms = assetsByFeed('firms');
assert.equal(firms.length, 13, 'expected 13 unique VIIRS orbital-pass frames');
assert.ok(
  firms.reduce((total, [, asset]) => total + asset.featureCount, 0) >= 1163,
  'FIRMS detection count regressed'
);

const sentinel = assetsByFeed('sentinel');
assert.equal(sentinel.length, 1, 'only the latest pre-window Sentinel acquisition is archived');
assert.equal(config.feeds.sentinel.observations.length, 1);
for (const [, asset] of sentinel) {
  assert.equal(asset.composite, 'B12/B8A/B04', 'Sentinel uses the smoke-resistant SWIR/NIR/red composite');
  assert.ok(Array.isArray(asset.bounds) && asset.bounds.length === 4, 'Sentinel image requires bounds');
}

const sam2 = assetsByFeed('sam2');
assert.equal(sam2.length, firms.length, 'every hotspot frame requires a SAM-2 mask');
for (const [id, asset] of sam2) {
  assert.equal(asset.model, 'facebook/sam2.1-hiera-tiny', `unexpected model on ${id}`);
  assert.equal(asset.composite, 'B12/B8A/B04', 'SAM-2 segments the SWIR/NIR/red composite');
  assert.ok(asset.promptCount > 0 && asset.featureCount > 0, 'SAM-2 output requires prompts and polygons');
}

// --- the FIRMS outage before Jul 16 stays documented ---
const outage = config.feeds.firms.outages?.[0];
assert.ok(outage && outage.reason.includes('FIRMS'), 'the VIIRS outage must remain explained in the config');

// --- OSM context volumes ---
const contextManifest = readJson('dist/data/context/manifest.json');
assert.ok(contextManifest.roads >= 250, 'major-road KML is unexpectedly sparse');
assert.ok(contextManifest['county-borders'] >= 2, 'county-border KML is missing');
assert.ok(contextManifest['city-limits'] >= 4, 'city-limit KML is missing');
assert.ok(contextManifest['landscape-features'] >= 100, 'landscape identity KML is unexpectedly sparse');
for (const filename of ['roads.kml', 'county-borders.kml', 'city-limits.kml', 'landscape-features.kml']) {
  assert.match(read(`dist/data/context/${filename}`), /^<\?xml[^]*<kml /, `${filename} is not valid KML`);
}

const totalReferences = catalog.snapshots.reduce((total, s) => total + partitionLayers(s).refs.length, 0);
console.log(`fixture: East Evans Creek — 13 VIIRS frames, ${sam2.length} SAM-2 masks, ${totalReferences} references — OK`);
