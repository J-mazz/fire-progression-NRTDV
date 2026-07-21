import { loadVisualizationManifest } from './config/ManifestLoader.js';
import { WasmRenderer } from './core/WasmRenderer.js';
import { connectLayerData } from './network/DataStreamer.js';
import { buildSceneGraphFromFloatArray } from './core/FlatBufferBuilder.js';
import { VisualizationManifest, LoadVisualizationManifestOptions } from './types/index.js';

interface AppState {
  renderer: WasmRenderer | null;
  manifest: VisualizationManifest | null;
}

const appState: AppState = {
  renderer: null,
  manifest: null
};

export async function initializeApp(manifestPath: string, module: unknown): Promise<{ manifest: VisualizationManifest; renderer: WasmRenderer }> {
  if (!module || typeof module !== 'object' || !('cwrap' in module)) {
    throw new Error('Emscripten module instance is required');
  }

  const wasmModule = module as any;
  const manifest = await loadVisualizationManifest(manifestPath, {
    allowedOrigins: [new URL(manifestPath, window.location.href).origin]
  });

  const renderer = new WasmRenderer(wasmModule, { allowedOrigins: [window.location.origin] });
  const initialized = renderer.initialize();
  if (initialized !== 1) {
    throw new Error('Failed to initialize WASM renderer');
  }

  appState.renderer = renderer;
  appState.manifest = manifest;

  const layers = manifest.earthview_visualization_framework.layer_compositing_pipeline ?? [];
  const manifestOptions: LoadVisualizationManifestOptions = {
    corsMode: 'cors',
    credentials: 'omit',
    allowedOrigins: [window.location.origin]
  };

  for (const layer of layers) {
    await connectLayerData(layer, renderer, manifestOptions);
  }

  return { manifest, renderer };
}

export async function sendFlatbufferMesh(vertices: number[] | Float32Array): Promise<void> {
  if (!appState.renderer) {
    throw new Error('Renderer has not been initialized.');
  }

  const floatArray = vertices instanceof Float32Array ? vertices : new Float32Array(vertices);
  const payload = buildSceneGraphFromFloatArray(floatArray);
  appState.renderer.feedBuffer(payload);
  appState.renderer.render();
}

// Expose to browser runtime for compatibility with legacy index.html usage.
declare global {
  interface Window {
    initializeApp?: typeof initializeApp;
    sendFlatbufferMesh?: typeof sendFlatbufferMesh;
  }
}

window.initializeApp = initializeApp;
window.sendFlatbufferMesh = sendFlatbufferMesh;
