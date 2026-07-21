const fs = require('fs');
const vm = require('vm');

function assert(cond, msg) {
  if (!cond) {
    console.error('Assertion failed:', msg || '');
    process.exit(1);
  }
}

(async function() {
  // Load client.js source
  const clientSrc = fs.readFileSync('client.js', 'utf8');

  // Prepare a sandboxed global environment similar to a browser
  const sandbox = {};
  sandbox.window = {};
  sandbox.console = console;

  // Minimal Ajv mock that always validates successfully (we test logic path)
  sandbox.Ajv = function AjvMock() {
    this.validate = function(schema, data) {
      // very lightweight check: ensure top-level key exists if schema requires
      if (schema && schema.required && Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (!(k in data)) return false;
        }
      }
      return true;
    };
    this.errorsText = function() { return ''; };
  };

  // Mock fetch to return the manifest from file system
  sandbox.fetch = async function(url) {
    const content = fs.readFileSync(url.replace(/^\/*/, ''), 'utf8');
    return {
      ok: true,
      json: async () => JSON.parse(content)
    };
  };

  // Minimal Module stub with cwrap and HEAPU8
  const heap = new ArrayBuffer(1024*1024);
  const HEAPU8 = new Uint8Array(heap);
  sandbox.Module = {
    cwrap: (name, ret, args) => {
      if (name === 'initialize_webgl_context') return () => 1;
      if (name === 'ingest_flatbuffer_stream') return (ptr, len) => 1;
      if (name === 'render_frame') return () => {};
      if (name === 'ext_allocate_wasm_buffer') return (size) => 0;
      if (name === 'ext_free_wasm_buffer') return (ptr) => {};
      return () => {};
    },
    HEAPU8
  };
  sandbox.window.Module = sandbox.Module;

  // Expose globals used in client.js
  sandbox.Uint8Array = Uint8Array;
  sandbox.Float32Array = Float32Array;
  sandbox.ArrayBuffer = ArrayBuffer;
  sandbox.DataView = DataView;
  sandbox.Promise = Promise;

  // Create VM context
  const context = vm.createContext(sandbox);

  // Run client.js in sandbox
  try {
    vm.runInContext(clientSrc, context, { filename: 'client.js' });
  } catch (e) {
    console.error('Failed to load client.js in VM:', e);
    process.exit(1);
  }

  // Test: call loadVisualizationManifest and ensure it returns manifest
  try {
    const res = await sandbox.window.loadVisualizationManifest('manifests/east_evans_creek_visualization.json', sandbox.Module);
    assert(res && res.manifest, 'loadVisualizationManifest did not return manifest');
    console.log('loadVisualizationManifest: OK');
  } catch (e) {
    console.error('loadVisualizationManifest failed:', e);
    process.exit(1);
  }

  // Test: create renderer and call initialize
  try {
    const renderer = sandbox.window.createWasmRenderer(sandbox.Module);
    const ok = renderer.initialize();
    assert(ok === 1, 'renderer.initialize did not return 1');
    console.log('createWasmRenderer.initialize: OK');
  } catch (e) {
    console.error('createWasmRenderer test failed:', e);
    process.exit(1);
  }

  // Additional helper tests
  try {
    const helpers = sandbox.window.__testHelpers;
    assert(helpers, 'test helpers not exposed');

    // Test extractPositionsFromJson with nested arrays
    const arrObj = { positions: [[1,2,3],[4,5,6]] };
    const floats = helpers.extractPositionsFromJson(arrObj);
    assert(floats instanceof Float32Array && floats.length === 6, 'extractPositionsFromJson failed');

    // Test legacy payload builder and header parsing
    const legacy = helpers.floatArrayToLegacyPayload(floats);
    const dv = new DataView(legacy);
    const count = dv.getUint32(0, true);
    assert(count === 2, 'legacy payload vertex count mismatch');

    // Test tryInterpretBinaryAsWasmPayload on legacy buffer
    const interpreted = helpers.tryInterpretBinaryAsWasmPayload(legacy);
    assert(interpreted instanceof ArrayBuffer, 'tryInterpretBinaryAsWasmPayload failed to detect legacy payload');

    console.log('helper functions: OK');
  } catch (e) {
    console.error('helper tests failed:', e);
    process.exit(1);
  }

  // Run flatbuffers shim test
  try {
    require('./test_flatbuffers_builder.js');
    console.log('flatbuffers shim tests: OK');
  } catch (e) {
    console.error('flatbuffers shim test failed:', e);
    process.exit(1);
  }

  console.log('All tests passed');
  process.exit(0);
})();
