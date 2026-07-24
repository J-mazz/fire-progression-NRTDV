const fs = require('node:fs');

const [configPath, templatePath, outputPath] = process.argv.slice(2);
if (!configPath || !templatePath || !outputPath) {
  throw new Error('Usage: node tools/generate_headers.js <config> <template> <output>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const template = fs.readFileSync(templatePath, 'utf8');

const tile = config.app?.baseImagery?.tiles?.[0];
if (typeof tile !== 'string' || tile.length === 0) {
  throw new Error('app.baseImagery.tiles[0] is required to derive the CSP imagery origin.');
}

let imageryOrigin;
try {
  // Tile templates carry {z}/{x}/{y} placeholders; only the origin matters for CSP.
  imageryOrigin = new URL(tile.replace(/\{[a-z-]+\}/gi, '0')).origin;
} catch {
  throw new Error(`app.baseImagery.tiles[0] is not a valid URL: ${tile}`);
}

const output = template.replaceAll('{{IMAGERY_ORIGIN}}', imageryOrigin);
fs.writeFileSync(outputPath, output);
console.log(`Generated _headers with imagery origin ${imageryOrigin}.`);
