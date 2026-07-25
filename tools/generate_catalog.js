// Expands catalog.config.json into the served snapshot catalog.
//
// The wire format is normalized: frame-invariant observation metadata lives once
// in `assets`, per-feed presentation lives once in `feeds`, and each snapshot
// carries only thin references. `ageHours` is the sole per-frame value, so a
// rolling window that repeats one observation across 56 frames costs 56 small
// objects instead of 56 full copies. See docs/data-contract.md.

const fs = require('node:fs');
const path = require('node:path');

const CATALOG_FORMAT = 2;

const [configPath, outputPath] = process.argv.slice(2);
if (!configPath || !outputPath) {
  throw new Error('Usage: node tools/generate_catalog.js <config> <output>');
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const start = Date.parse(config.timeline.startAt);
const end = Date.parse(config.timeline.endAt);
const cadenceMs = config.timeline.cadenceHours * 3_600_000;

if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
  throw new Error('Timeline startAt/endAt are invalid.');
}
if (!Number.isInteger(config.timeline.cadenceHours) || config.timeline.cadenceHours <= 0 || 24 % config.timeline.cadenceHours !== 0) {
  throw new Error('Timeline cadenceHours must be a positive divisor of 24.');
}

const feeds = Object.entries(config.feeds).map(([feedId, feed]) => {
  const observations = [...feed.observations]
    .map((observation) => ({ ...observation, timestamp: Date.parse(observation.observedAt) }))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (observations.some((observation) => !Number.isFinite(observation.timestamp))) {
    throw new Error(`Feed ${feedId} contains an invalid observedAt timestamp.`);
  }
  return { feedId, ...feed, observations };
});

const timeKey = (isoString) => isoString.replaceAll(':', '-').replace('.000Z', 'Z');

function observationsForFrame(feed, frameTime) {
  if (feed.mode === 'window') {
    const observation = feed.observations.find((candidate) => candidate.timestamp === frameTime);
    return observation ? [{ observation, ageHours: 0 }] : [];
  }
  if (feed.mode === 'carry-forward') {
    const observation = feed.observations.findLast((candidate) => candidate.timestamp <= frameTime);
    return observation ? [{ observation, ageHours: (frameTime - observation.timestamp) / 3_600_000 }] : [];
  }
  if (feed.mode === 'rolling-window') {
    if (!Number.isFinite(feed.persistenceHours) || feed.persistenceHours <= 0) {
      throw new Error(`Feed ${feed.feedId} requires positive persistenceHours`);
    }
    return feed.observations
      .filter((observation) => observation.timestamp <= frameTime)
      .map((observation) => ({ observation, ageHours: (frameTime - observation.timestamp) / 3_600_000 }))
      .filter((entry) => entry.ageHours <= feed.persistenceHours);
  }
  throw new Error(`Unsupported feed mode: ${feed.mode}`);
}

/** Frame-invariant description of one published observation. */
function assetForObservation(feed, observation) {
  return {
    feedId: feed.feedId,
    observedAt: observation.observedAt,
    status: observation.status ?? 'ready',
    ...(observation.url ? { url: observation.url } : {}),
    ...(observation.tiles ? { tiles: observation.tiles } : {}),
    ...(observation.bounds ? { bounds: observation.bounds } : {}),
    ...(observation.opacity !== undefined ? { opacity: observation.opacity } : {}),
    ...(observation.featureCount !== undefined ? { featureCount: observation.featureCount } : {}),
    ...(observation.cloudCoverPercent !== undefined ? { cloudCoverPercent: observation.cloudCoverPercent } : {}),
    ...(observation.composite ? { composite: observation.composite } : {}),
    ...(observation.model ? { model: observation.model } : {}),
    ...(observation.promptCount !== undefined ? { promptCount: observation.promptCount } : {}),
    ...(observation.sourceLagHours !== undefined ? { sourceLagHours: observation.sourceLagHours } : {}),
    ...(observation.attribution ? { attribution: observation.attribution } : {})
  };
}

function outageForFrame(feed, frameTime) {
  return (feed.outages ?? []).find((outage) => {
    const outageStart = Date.parse(outage.startAt);
    const outageEnd = Date.parse(outage.endAt);
    return Number.isFinite(outageStart) && Number.isFinite(outageEnd) && frameTime >= outageStart && frameTime < outageEnd;
  });
}

const feedMeta = {};
for (const feed of feeds) {
  feedMeta[feed.feedId] = {
    label: feed.label,
    kind: feed.kind,
    ...(feed.format ? { format: feed.format } : {}),
    ...(feed.contextType ? { contextType: feed.contextType } : {})
  };
}

const assets = {};
const snapshots = [];

for (let frameTime = start; frameTime <= end; frameTime += cadenceMs) {
  const observedAt = new Date(frameTime).toISOString();
  const layers = [];

  for (const feed of feeds) {
    const entries = observationsForFrame(feed, frameTime);
    if (entries.length > 0) {
      for (const { observation, ageHours } of entries) {
        const assetId = `${feed.feedId}-${timeKey(observation.observedAt)}`;
        assets[assetId] ??= assetForObservation(feed, observation);
        layers.push({ ref: assetId, ageHours: Math.round(ageHours * 100) / 100 });
      }
    } else if (feed.mode === 'window' || feed.mode === 'rolling-window') {
      const outage = outageForFrame(feed, frameTime);
      layers.push({
        feedId: feed.feedId,
        status: 'unavailable',
        statusReason: outage?.reason ?? `No observations were published for this ${config.timeline.cadenceHours}-hour window.`
      });
    }
  }

  const hasReadyLayer = layers.some((layer) => layer.ref && assets[layer.ref].status === 'ready');
  snapshots.push({
    id: `${config.event.id}-${timeKey(observedAt)}`,
    observedAt,
    label: `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(frameTime))} · ${observedAt.slice(11, 16)} UTC`,
    status: hasReadyLayer ? 'ready' : 'awaiting-data',
    layers
  });
}

const catalog = {
  catalogFormat: CATALOG_FORMAT,
  version: config.version,
  updatedAt: config.updatedAt,
  pollIntervalSeconds: config.pollIntervalSeconds,
  event: config.event,
  ...(config.app ? { app: config.app } : {}),
  timeline: config.timeline,
  feeds: feedMeta,
  assets,
  snapshots
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.next`;
fs.writeFileSync(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`);
fs.renameSync(temporaryPath, outputPath);

const layerCount = snapshots.reduce((total, snapshot) => total + snapshot.layers.length, 0);
console.log(
  `Generated ${snapshots.length} snapshots at ${config.timeline.cadenceHours}-hour cadence ` +
  `(${Object.keys(assets).length} assets, ${layerCount} references).`
);
