const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readJson = (relativePath) => JSON.parse(read(relativePath));
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath));

/** Resolve a catalog asset URL ("./data/...") to a path inside dist/. */
const assetPath = (url) => path.join(root, 'dist', url.replace(/^\.\//, ''));

/**
 * Compile the frontend's own catalog validator to CJS so the tests can assert
 * that generated output satisfies the exact contract the browser enforces,
 * rather than a second transcription of it that can drift.
 */
function loadClientValidator() {
  const { buildSync } = require('esbuild');
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wildfire-test-')), 'validator.cjs');
  buildSync({
    entryPoints: [path.join(root, 'src/ts/network/CatalogClient.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile,
    logLevel: 'silent'
  });
  return require(outfile).validateCatalog;
}

/** Group a snapshot's layer entries into asset references and feed gaps. */
function partitionLayers(snapshot) {
  const refs = [];
  const gaps = [];
  for (const entry of snapshot.layers) {
    (typeof entry.ref === 'string' ? refs : gaps).push(entry);
  }
  return { refs, gaps };
}

module.exports = { root, read, readJson, exists, assetPath, loadClientValidator, partitionLayers };
