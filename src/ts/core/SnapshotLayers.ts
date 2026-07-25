import { isAssetReference } from '../types';
import type { ResolvedLayer, Snapshot, SnapshotCatalog } from '../types';

/**
 * Joins a snapshot's thin layer references against the catalog's `feeds` and
 * `assets` maps. This is the only place that knows about the normalized wire
 * format — the map and the specifications panel work with flat layers.
 *
 * Dangling references are skipped rather than thrown on: `validateCatalog`
 * already rejects them, so reaching one here means a cached catalog from an
 * older format, and a partial render beats a blank map.
 */
export function resolveLayers(catalog: SnapshotCatalog, snapshot: Snapshot): ResolvedLayer[] {
  const resolved: ResolvedLayer[] = [];

  for (const entry of snapshot.layers) {
    if (isAssetReference(entry)) {
      const asset = catalog.assets[entry.ref];
      if (!asset) continue;
      const feed = catalog.feeds[asset.feedId];
      if (!feed) continue;

      resolved.push({
        id: entry.ref,
        label: feed.label,
        kind: feed.kind,
        format: feed.format,
        contextType: feed.contextType,
        status: asset.status,
        sourceObservedAt: asset.observedAt,
        ageHours: entry.ageHours,
        url: asset.url,
        tiles: asset.tiles,
        bounds: asset.bounds,
        opacity: asset.opacity,
        featureCount: asset.featureCount,
        cloudCoverPercent: asset.cloudCoverPercent,
        composite: asset.composite,
        model: asset.model,
        promptCount: asset.promptCount,
        sourceLagHours: asset.sourceLagHours,
        attribution: asset.attribution
      });
      continue;
    }

    const feed = catalog.feeds[entry.feedId];
    if (!feed) continue;
    resolved.push({
      id: `${entry.feedId}-${snapshot.observedAt}`,
      label: feed.label,
      kind: feed.kind,
      format: feed.format,
      contextType: feed.contextType,
      status: 'unavailable',
      statusReason: entry.statusReason,
      sourceObservedAt: snapshot.observedAt
    });
  }

  return resolved;
}
