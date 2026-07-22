import createWasm from './wasm_pipeline.js';
import { autoIngestAll } from './network/DataStreamer.js';

declare const L:any; // leaflet from script tag

// 1. base map first - so you don't get black
const map = L.map('map', {zoomControl:false}).setView([42.65, -123.0], 11);
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}).addTo(map);
satLayer.setOpacity(0);

function setBase(t:string){
  if(t==='sat'){ osmLayer.setOpacity(0); satLayer.setOpacity(1); }
  else { osmLayer.setOpacity(1); satLayer.setOpacity(0); }
  (window as any).Module?._set_basemap?.(t==='sat'?0:1);
}
(window as any).setBase = setBase; // <- makes onclick work if you keep it, but we won't need it
document.getElementById('btnSat')!.onclick = ()=> setBase('sat');
document.getElementById('btnTopo')!.onclick = ()=> setBase('topo');

// 2. wasm
(async()=>{
  const Module:any = await createWasm();
  (window as any).Module = Module;
  const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;
  const dpr = devicePixelRatio;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  Module._initialize_webgl_context(canvas.width, canvas.height);
  document.getElementById('wasmBadge')!.textContent = 'WASM: ready';
try{ await autoIngestAll(Module); }catch(e){ console.warn(e); }
(function loop(){ Module._render_frame(); requestAnimationFrame(loop); })();
})();
