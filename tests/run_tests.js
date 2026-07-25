#!/usr/bin/env node
// Builds once, then runs the requested suites against dist/.
//
//   node tests/run_tests.js                 # invariants + fixture
//   node tests/run_tests.js invariants      # one suite
//   node tests/run_tests.js --no-build      # reuse the existing dist/

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ALL_SUITES = ['invariants', 'fixture'];

const args = process.argv.slice(2);
const skipBuild = args.includes('--no-build');
const requested = args.filter((arg) => !arg.startsWith('--'));
const suites = requested.length > 0 ? requested : ALL_SUITES;

for (const suite of suites) {
  if (!ALL_SUITES.includes(suite)) {
    console.error(`Unknown suite "${suite}". Available: ${ALL_SUITES.join(', ')}`);
    process.exit(2);
  }
}

if (!skipBuild) {
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
  if (build.status !== 0) {
    process.stdout.write(build.stdout ?? '');
    process.stderr.write(build.stderr ?? '');
    process.exit(build.status ?? 1);
  }
}

for (const suite of suites) {
  require(`./${suite}.test.js`);
}

console.log('All checks passed.');
