import { EmscriptenModule, RendererOptions } from '../types';

export interface WebSocketOptions {
  wsSubprotocols?: string[];
}

export class WasmRenderer {
  private readonly module: EmscriptenModule;
  private readonly maxAllocationBytes: number;
  private readonly allowedOrigins: string[] | null;
  private readonly initializeWebGL: () => number;
  private readonly ingestFlatbufferStream: (ptr: number, byteLength: number) => number;
  private readonly renderFrame: () => void;
  private readonly allocate: (size: number) => number;
  private readonly freeMemory: (ptr: number) => void;

  constructor(module: EmscriptenModule, options?: RendererOptions) {
    this.module = module;
    this.maxAllocationBytes = options?.maxAllocationBytes ?? 64 * 1024 * 1024;
    this.allowedOrigins = options?.allowedOrigins ?? null;

    this.initializeWebGL = this.module.cwrap('initialize_webgl_context', 'number', []);
    this.ingestFlatbufferStream = this.module.cwrap('ingest_flatbuffer_stream', 'number', ['number', 'number']);
    this.renderFrame = this.module.cwrap('render_frame', null, []);
    this.allocate = this.module.cwrap('ext_allocate_wasm_buffer', 'number', ['number']);
    this.freeMemory = this.module.cwrap('ext_free_wasm_buffer', null, ['number']);
  }

  initialize(): number {
    return this.initializeWebGL();
  }

  render(): void {
    this.renderFrame();
  }

  feedBuffer(payload: ArrayBuffer): void {
    const { ptr, byteLength } = this.allocateAndCopy(payload);
    const result = this.ingestFlatbufferStream(ptr, byteLength);
    if (result !== 1) {
      console.error('WASM ingest failed with code', result);
    }
    this.freeMemory(ptr);
  }

  connectWebSocket(endpoint: string, wsOptions: WebSocketOptions = {}): WebSocket {
    if (this.allowedOrigins && !this.isOriginAllowed(endpoint)) {
      throw new Error('WebSocket endpoint origin not permitted');
    }

    const subprotocols = wsOptions.wsSubprotocols ?? ['wildfire.telemetry'];
    const socket = new WebSocket(endpoint, subprotocols);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => console.log('WebSocket connected to', endpoint);
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        this.feedBuffer(event.data);
      } else {
        console.warn('Unexpected WebSocket payload type', event.data);
      }
    };
    socket.onerror = (err) => console.error('WebSocket error:', err);
    return socket;
  }

  private allocateAndCopy(payload: ArrayBuffer): { ptr: number; byteLength: number } {
    if (!payload || payload.byteLength === 0) {
      throw new Error('Cannot allocate zero-length payload');
    }
    if (payload.byteLength > this.maxAllocationBytes) {
      throw new Error(`Payload size ${payload.byteLength} exceeds maximum allowed ${this.maxAllocationBytes} bytes`);
    }

    const ptr = this.allocate(payload.byteLength);
    if (!ptr) {
      throw new Error(`WASM allocation failed for payload size ${payload.byteLength}`);
    }

    const heap = new Uint8Array(this.module.HEAPU8.buffer, ptr, payload.byteLength);
    heap.set(new Uint8Array(payload));
    return { ptr, byteLength: payload.byteLength };
  }

  private isOriginAllowed(endpoint: string): boolean {
    if (!this.allowedOrigins) return true;
    const origin = new URL(endpoint, window.location.href).origin;
    return this.allowedOrigins.includes(origin);
  }
}
