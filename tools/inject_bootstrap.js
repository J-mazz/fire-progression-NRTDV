const fs = require('node:fs');

const [configPath, htmlPath] = process.argv.slice(2);
if (!configPath || !htmlPath) {
  throw new Error('Usage: node tools/inject_bootstrap.js <config> <html-file>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const app = config.app ?? {};
const bootstrap = {
  title: app.title ?? config.event?.name ?? 'Wildfire',
  tagline: app.tagline ?? 'Near-real-time earth view',
  center: config.event?.center ?? [0, 20],
  initialZoom: app.initialZoom ?? 9,
  bounds: config.event?.bounds ?? [-180, -60, 180, 75],
  baseImagery: app.baseImagery ?? null
};

// A non-executable JSON island keeps this CSP-safe (script-src 'self').
// Escape '<' so an asset URL can never break out of the <script> element.
const json = JSON.stringify(bootstrap).replaceAll('<', '\\u003c');
const island = `<script type="application/json" id="fire-bootstrap">${json}</script>`;

const html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('<!--FIRE_BOOTSTRAP-->')) {
  throw new Error('index.html is missing the <!--FIRE_BOOTSTRAP--> marker.');
}
fs.writeFileSync(htmlPath, html.replace('<!--FIRE_BOOTSTRAP-->', island));
console.log(`Injected fire bootstrap for "${bootstrap.title}".`);
