import { CATALOG_FORMAT } from '../types';
import type { SnapshotCatalog } from '../types';

const CACHE_KEY = 'wildfire-nrtdv:last-catalog';
const MIN_POLL_MS = 10_000;
const FALLBACK_POLL_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateFeeds(value: unknown): Set<string> {
  if (!isRecord(value)) throw new Error('Catalog feeds must be an object.');
  const feedIds = new Set<string>();
  for (const [feedId, feed] of Object.entries(value)) {
    if (!isRecord(feed) || typeof feed.label !== 'string' || typeof feed.kind !== 'string') {
      throw new Error(`Feed ${feedId} is missing label or kind.`);
    }
    feedIds.add(feedId);
  }
  return feedIds;
}

function validateAssets(value: unknown, feedIds: Set<string>): Set<string> {
  if (!isRecord(value)) throw new Error('Catalog assets must be an object.');
  const assetIds = new Set<string>();
  for (const [assetId, asset] of Object.entries(value)) {
    if (!isRecord(asset) || typeof asset.feedId !== 'string' || typeof asset.status !== 'string') {
      throw new Error(`Asset ${assetId} is missing feedId or status.`);
    }
    if (!feedIds.has(asset.feedId)) {
      throw new Error(`Asset ${assetId} references unknown feed ${asset.feedId}.`);
    }
    if (typeof asset.observedAt !== 'string' || !Number.isFinite(Date.parse(asset.observedAt))) {
      throw new Error(`Asset ${assetId} has an invalid observedAt.`);
    }
    if (asset.status === 'ready' && typeof asset.url !== 'string' && !Array.isArray(asset.tiles)) {
      throw new Error(`Ready asset ${assetId} must provide url or tiles.`);
    }
    assetIds.add(assetId);
  }
  return assetIds;
}

function validateLayerEntry(entry: unknown, snapshotId: string, feedIds: Set<string>, assetIds: Set<string>): void {
  if (!isRecord(entry)) throw new Error(`Snapshot ${snapshotId} contains an invalid layer entry.`);

  if (typeof entry.ref === 'string') {
    if (!assetIds.has(entry.ref)) {
      throw new Error(`Snapshot ${snapshotId} references unknown asset ${entry.ref}.`);
    }
    if (typeof entry.ageHours !== 'number' || !Number.isFinite(entry.ageHours) || entry.ageHours < 0) {
      throw new Error(`Snapshot ${snapshotId} reference ${entry.ref} needs a non-negative ageHours.`);
    }
    return;
  }

  if (typeof entry.feedId !== 'string' || !feedIds.has(entry.feedId)) {
    throw new Error(`Snapshot ${snapshotId} gap references unknown feed.`);
  }
  if (entry.status !== 'unavailable' || typeof entry.statusReason !== 'string') {
    throw new Error(`Snapshot ${snapshotId} gap for ${entry.feedId} must be unavailable with a reason.`);
  }
}

export function validateCatalog(value: unknown): SnapshotCatalog {
  if (!isRecord(value) || !isRecord(value.event) || !Array.isArray(value.snapshots)) {
    throw new Error('Catalog must contain an event and snapshots array.');
  }
  if (value.catalogFormat !== CATALOG_FORMAT) {
    throw new Error(`Catalog format ${String(value.catalogFormat)} is not supported (expected ${CATALOG_FORMAT}).`);
  }
  if (typeof value.version !== 'string' || typeof value.updatedAt !== 'string') {
    throw new Error('Catalog version and updatedAt are required.');
  }
  if (typeof value.pollIntervalSeconds !== 'number' || value.pollIntervalSeconds < 10) {
    throw new Error('Catalog pollIntervalSeconds must be at least 10 seconds.');
  }

  const event = value.event;
  if (typeof event.id !== 'string' || typeof event.name !== 'string' || typeof event.startedAt !== 'string') {
    throw new Error('Catalog event metadata is incomplete.');
  }
  if (!Array.isArray(event.center) || event.center.length !== 2 || !Array.isArray(event.bounds) || event.bounds.length !== 4) {
    throw new Error('Catalog event center or bounds are invalid.');
  }

  const feedIds = validateFeeds(value.feeds);
  const assetIds = validateAssets(value.assets, feedIds);

  let previousTime = Number.NEGATIVE_INFINITY;
  const ids = new Set<string>();
  for (const candidate of value.snapshots) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.observedAt !== 'string') {
      throw new Error('Every snapshot requires id and observedAt.');
    }
    if (!Array.isArray(candidate.layers)) throw new Error(`Snapshot ${candidate.id} has no layers array.`);
    if (ids.has(candidate.id)) throw new Error(`Duplicate snapshot id: ${candidate.id}`);
    ids.add(candidate.id);

    const observedTime = Date.parse(candidate.observedAt);
    if (!Number.isFinite(observedTime) || observedTime < previousTime) {
      throw new Error('Snapshots must be valid dates sorted by observedAt.');
    }
    previousTime = observedTime;

    for (const entry of candidate.layers) {
      validateLayerEntry(entry, candidate.id, feedIds, assetIds);
    }
  }

  return value as unknown as SnapshotCatalog;
}

export class CatalogClient {
  private etag: string | null = null;
  private timer: number | null = null;
  private inFlight = false;
  private pendingRefresh = false;
  private pollIntervalMs = FALLBACK_POLL_MS;
  private refresh: (() => Promise<void>) | null = null;

  constructor(private readonly url: string) {}

  start(onCatalog: (catalog: SnapshotCatalog, meta: { stale: boolean }) => void, onError: (error: Error) => void): void {
    const refresh = async (): Promise<void> => {
      // A poll is already running; remember the request and re-run once it lands.
      if (this.inFlight) {
        this.pendingRefresh = true;
        return;
      }
      this.inFlight = true;
      try {
        const catalog = await this.fetchCatalog();
        if (catalog) {
          this.pollIntervalMs = Math.max(MIN_POLL_MS, catalog.pollIntervalSeconds * 1_000);
          onCatalog(catalog, { stale: false });
        }
        this.schedule(this.pollIntervalMs, refresh);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        onError(normalized);
        const cached = this.readCache();
        if (cached) onCatalog(cached, { stale: true });
        this.schedule(this.pollIntervalMs, refresh);
      } finally {
        this.inFlight = false;
        if (this.pendingRefresh) {
          this.pendingRefresh = false;
          void refresh();
        }
      }
    };
    this.refresh = refresh;
    void refresh();
  }

  /** Force an immediate poll (skips the ETag no-op after a config write). */
  refreshNow(): void {
    this.etag = null;
    if (this.refresh) void this.refresh();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number, callback: () => Promise<void>): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void callback(), delayMs);
  }

  private async fetchCatalog(): Promise<SnapshotCatalog | null> {
    const headers: HeadersInit = { Accept: 'application/json' };
    if (this.etag) headers['If-None-Match'] = this.etag;
    const response = await fetch(this.url, { headers, cache: 'no-cache' });
    if (response.status === 304) return null;
    if (!response.ok) throw new Error(`Catalog request returned ${response.status}.`);

    const catalog = validateCatalog(await response.json());
    this.etag = response.headers.get('etag');
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
    } catch {
      // Storage can be disabled; the network catalog remains authoritative.
    }
    return catalog;
  }

  private readCache(): SnapshotCatalog | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached ? validateCatalog(JSON.parse(cached)) : null;
    } catch {
      return null;
    }
  }
}
