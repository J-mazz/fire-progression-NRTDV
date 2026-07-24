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
const html = read('dist/index.html');
const bundle = read('dist/client.js');

assert.equal(catalog.event.startedAt, '2026-07-10', 'event start date must remain authoritative');
assert.ok(catalog.snapshots.length >= 2, 'timeline requires at least two snapshots');
assert.deepEqual(
  [...catalog.snapshots].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)),
  catalog.snapshots,
  'snapshots must be chronological'
);

for (const snapshot of catalog.snapshots) {
  assert.ok(snapshot.id && snapshot.observedAt && Array.isArray(snapshot.layers));
  for (const layer of snapshot.layers) {
    if (layer.status === 'ready') {
      assert.ok(layer.url || (Array.isArray(layer.tiles) && layer.tiles.length > 0), `ready layer ${layer.id} needs data`);
    }
  }
}

assert.match(html, /id="map"/, 'map surface missing');
assert.match(html, /class="specifications"/, 'specifications surface missing');
assert.match(html, /class="timeline"/, 'timeline surface missing');
assert.ok(fs.existsSync(path.join(root, 'dist/client.css')), 'CSS bundle missing');
assert.doesNotMatch(bundle, /wasm_pipeline/, 'legacy WASM loader leaked into the frontend');

console.log('Build and temporal catalog checks passed.');
