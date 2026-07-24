const fs = require('node:fs');
const path = require('node:path');

const [configPath, contextDirectory] = process.argv.slice(2);
if (!configPath || !contextDirectory) {
  throw new Error('Usage: node tools/register_context_layers.js <catalog.config.json> <context-directory>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(contextDirectory, 'manifest.json'), 'utf8'));
const observedAt = config.timeline.startAt;
const attribution = '© OpenStreetMap contributors';

const layers = [
  ['contextRoads', 'Major roads', 'roads', 'roads.kml'],
  ['contextCountyBorders', 'County borders', 'county-borders', 'county-borders.kml'],
  ['contextCityLimits', 'City limits', 'city-limits', 'city-limits.kml'],
  ['contextLandscape', 'Landscape features', 'landscape-features', 'landscape-features.kml']
];

for (const [feedId, label, contextType, filename] of layers) {
  const featureCount = manifest[contextType] ?? 0;
  config.feeds[feedId] = {
    label,
    kind: 'kml',
    format: 'kml',
    mode: 'carry-forward',
    contextType,
    observations: [{
      observedAt,
      url: `./data/context/${filename}`,
      status: featureCount > 0 ? 'ready' : 'unavailable',
      featureCount,
      attribution
    }]
  };
}

config.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const temporaryPath = `${configPath}.next`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
fs.renameSync(temporaryPath, configPath);
console.log(`Registered ${layers.length} contextual KML feeds.`);
