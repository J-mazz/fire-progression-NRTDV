const assert = require('assert');
const fs = require('fs');

// Load the shim builder to mimic flatbuffers runtime
const flatbuffers = require('../vendor/flatbuffers.js');

function buildFromFloats(floats) {
  const builder = new flatbuffers.Builder(1024);
  // Use same pattern as client.js: push floats via addFieldFloat32
  for (let i = 0; i < floats.length; ++i) builder.addFieldFloat32(0, floats[i], 0);
  const arr = builder.asUint8Array();
  return arr.buffer;
}

// Test: ensure header and floats are correct
const floats = new Float32Array([1,2,3,4,5,6]);
const buf = buildFromFloats(floats);
const dv = new DataView(buf);
const count = dv.getUint32(0, true);
assert.strictEqual(count, 2, 'vertex count mismatch');
const fa = new Float32Array(buf, 4, 6);
for (let i = 0; i < 6; ++i) assert.strictEqual(fa[i], floats[i]);
console.log('flatbuffers builder shim test: OK');
