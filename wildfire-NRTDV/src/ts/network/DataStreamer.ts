// src/ts/network/DataStreamer.ts
export async function autoIngestAll(Module: any) {
  const m = await fetch('./manifest.json').then(r => r.json());
  const wasmBadge = document.getElementById('wasmBadge')!;
  const firmsBadge = document.getElementById('firmsBadge')!;
  const samBadge = document.getElementById('samBadge')!;
  const samInfo = document.getElementById('samInfo')!;

  async function ingest(path: string, type: 'FIRMS' | 'SAM2') {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`fetch ${path} -> ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const ptr = Module._malloc(buf.length);
    Module.HEAPU8.set(buf, ptr);
    // C++: void ingest_flatbuffer_stream(uint8_t* ptr, size_t len)
    Module._ingest_flatbuffer_stream(ptr, buf.length);
    Module._free(ptr);

    if (type === 'FIRMS') firmsBadge.textContent = `FIRMS: ${(buf.length/1024).toFixed(0)}KB auto`;
    if (type === 'SAM2') {
      samBadge.textContent = 'SAM2: auto';
      samInfo.textContent = `auto-loaded ${path} • ${buf.length}B`;
    }
    return buf.length;
  }

  if (m.firms) await ingest(m.firms, 'FIRMS');
  if (m.sam) await ingest(m.sam, 'SAM2');
  wasmBadge.textContent = 'WASM: ready';
}
