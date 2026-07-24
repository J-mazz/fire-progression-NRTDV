const fs = require('node:fs');
const path = require('node:path');

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

function observationsForFrame(feed, frameTime) {
  if (feed.mode === 'window') {
    const observation = feed.observations.find((candidate) => candidate.timestamp === frameTime);
    return observation ? [{ ...observation, ageHours: 0 }] : [];
  }
  if (feed.mode === 'carry-forward') {
    const observation = feed.observations.findLast((candidate) => candidate.timestamp <= frameTime);
    return observation ? [{ ...observation, ageHours: (frameTime - observation.timestamp) / 3_600_000 }] : [];
  }
  if (feed.mode === 'rolling-window') {
    if (!Number.isFinite(feed.persistenceHours) || feed.persistenceHours <= 0) {
      throw new Error(`Feed ${feed.feedId} requires positive persistenceHours`);
    }
    return feed.observations
      .filter((observation) => observation.timestamp <= frameTime)
      .map((observation) => ({
        ...observation,
        ageHours: (frameTime - observation.timestamp) / 3_600_000
      }))
      .filter((observation) => observation.ageHours <= feed.persistenceHours);
  }
  throw new Error(`Unsupported feed mode: ${feed.mode}`);
}

function layerForObservation(feed, observation) {
  const freshness = feed.mode === 'rolling-window'
    ? Math.max(0, 1 - observation.ageHours / feed.persistenceHours)
    : 1;
  return {
    id: `${feed.feedId}-${observation.observedAt.replaceAll(':', '-').replace('.000Z', 'Z')}`,
    label: feed.label,
    kind: feed.kind,
    format: feed.format,
    status: observation.status ?? 'ready',
    sourceObservedAt: observation.observedAt,
    ...(feed.contextType ? { contextType: feed.contextType } : {}),
    ageHours: Math.round(observation.ageHours * 100) / 100,
    ...(observation.url ? { url: observation.url } : {}),
    ...(observation.tiles ? { tiles: observation.tiles } : {}),
    ...(observation.bounds ? { bounds: observation.bounds } : {}),
    ...(observation.opacity !== undefined
      ? { opacity: observation.opacity }
      : feed.mode === 'rolling-window'
        ? { opacity: Math.round((0.18 + 0.77 * freshness) * 1000) / 1000 }
        : {}),
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
    const start = Date.parse(outage.startAt);
    const end = Date.parse(outage.endAt);
    return Number.isFinite(start) && Number.isFinite(end) && frameTime >= start && frameTime < end;
  });
}

const snapshots = [];
for (let frameTime = start; frameTime <= end; frameTime += cadenceMs) {
  const observedAt = new Date(frameTime).toISOString();
  const layers = [];

  for (const feed of feeds) {
    const observations = observationsForFrame(feed, frameTime);
    if (observations.length > 0) {
      for (const observation of observations) {
        layers.push(layerForObservation(feed, observation));
      }
    } else if (feed.mode === 'window' || feed.mode === 'rolling-window') {
      const outage = outageForFrame(feed, frameTime);
      layers.push({
        id: `${feed.feedId}-${observedAt.replaceAll(':', '-').replace('.000Z', 'Z')}`,
        label: feed.label,
        kind: feed.kind,
        format: feed.format,
        status: 'unavailable',
        sourceObservedAt: observedAt,
        statusReason: outage?.reason ?? 'No observations were published for this three-hour window.'
      });
    }
  }

  const hasReadyLayer = layers.some((layer) => layer.status === 'ready');
  snapshots.push({
    id: `${config.event.id}-${observedAt.replaceAll(':', '-').replace('.000Z', 'Z')}`,
    observedAt,
    label: `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(frameTime))} · ${observedAt.slice(11, 16)} UTC`,
    status: hasReadyLayer ? 'ready' : 'awaiting-data',
    layers
  });
}

const catalog = {
  version: config.version,
  updatedAt: config.updatedAt,
  pollIntervalSeconds: config.pollIntervalSeconds,
  event: config.event,
  ...(config.app ? { app: config.app } : {}),
  timeline: config.timeline,
  snapshots
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Generated ${snapshots.length} snapshots at ${config.timeline.cadenceHours}-hour cadence.`);
