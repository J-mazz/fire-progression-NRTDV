import { LayerConfig, LoadVisualizationManifestOptions } from '../types';
import { buildSceneGraphFromFloatArray, extractPositionsFromJson, tryInterpretBinaryAsWasmPayload } from '../core/FlatBufferBuilder';
import { WasmRenderer } from '../core/WasmRenderer';

export async function connectLayerData(
  layer: LayerConfig,
  renderer: WasmRenderer,
  manifestOptions: LoadVisualizationManifestOptions
): Promise<void> {
  const src = layer.data_source;
  if (!src) return;

  const authHeaders: Record<string, string> = {};
  if (manifestOptions.authToken) {
    authHeaders.Authorization = `Bearer ${manifestOptions.authToken}`;
  }

  const credentials = manifestOptions.credentials ?? 'omit';
  const corsMode = manifestOptions.corsMode ?? 'cors';

  const deliverBuffer = (ab: ArrayBuffer) => {
    const payload = tryInterpretBinaryAsWasmPayload(ab);
    renderer.feedBuffer(payload ?? ab);
  };

  const isHttp = src.startsWith('http:') || src.startsWith('https:');
  const isWs = src.startsWith('ws:') || src.startsWith('wss:');

  if (isWs) {
    if (manifestOptions.allowedOrigins && !isOriginAllowed(src, manifestOptions.allowedOrigins)) {
      console.warn('Layer websocket origin not permitted', src);
      return;
    }
    const ws = new WebSocket(src);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => console.log('Layer websocket open', src);
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        deliverBuffer(event.data);
        return;
      }

      if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data);
          const floats = extractPositionsFromJson(payload);
          if (floats) {
            renderer.feedBuffer(buildSceneGraphFromFloatArray(floats));
            return;
          }
        } catch {
          const tokens = event.data
            .trim()
            .split(/\s*,\s*/)
            .map((token) => Number(token))
            .filter((n) => Number.isFinite(n));
          if (tokens.length > 0) {
            renderer.feedBuffer(buildSceneGraphFromFloatArray(new Float32Array(tokens)));
          }
        }
      }
    };
    ws.onerror = (err) => console.warn('WS layer error', err);
    return;
  }

  if (isHttp) {
    if (manifestOptions.allowedOrigins && !isOriginAllowed(src, manifestOptions.allowedOrigins)) {
      console.warn('Layer source origin not permitted by allowedOrigins:', src);
      return;
    }

    const response = await fetch(src, {
      mode: corsMode,
      credentials,
      headers: authHeaders
    });
    if (!response.ok) {
      console.warn('Layer fetch failed', src, response.status);
      return;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/octet-stream') || contentType.includes('application/octet')) {
      const ab = await response.arrayBuffer();
      deliverBuffer(ab);
      return;
    }

    if (contentType.includes('application/json') || contentType.includes('text/json')) {
      const obj = await response.json();
      const floats = extractPositionsFromJson(obj);
      if (floats) {
        renderer.feedBuffer(buildSceneGraphFromFloatArray(floats));
        return;
      }
    }

    const ab = await response.arrayBuffer();
    deliverBuffer(ab);
    return;
  }

  if (Array.isArray(layer.data)) {
    const floats = extractPositionsFromJson(layer.data);
    if (floats) {
      renderer.feedBuffer(buildSceneGraphFromFloatArray(floats));
    }
  }
}

function isOriginAllowed(url: string, allowedOrigins: string[]): boolean {
  const origin = new URL(url, window.location.href).origin;
  return allowedOrigins.includes(origin);
}
