export type SnapshotStatus = 'ready' | 'processing' | 'awaiting-data';
export type LayerStatus = 'ready' | 'processing' | 'unavailable';
export type LayerKind = 'sentinel-raster' | 'sam-mask' | 'firms' | 'kml';
export type LayerFormat = 'xyz' | 'image' | 'geojson' | 'kml';
export type Bounds = [west: number, south: number, east: number, north: number];

/** Wire-format revision of `catalog.json`; bumped on breaking shape changes. */
export const CATALOG_FORMAT = 2;

export interface EventConfiguration {
  id: string;
  name: string;
  startedAt: string;
  center: [longitude: number, latitude: number];
  bounds: Bounds;
}

export interface BaseImagery {
  tiles: string[];
  attribution: string;
  maxzoom?: number;
  minzoom?: number;
  tileSize?: number;
}

export interface AppConfig {
  title: string;
  tagline: string;
  initialZoom?: number;
  baseImagery: BaseImagery;
  simplifyToleranceMeters?: number;
}

/** Build-time JSON island (`#fire-bootstrap`) so first paint focuses the right fire. */
export interface FireBootstrap {
  title: string;
  tagline: string;
  center: [longitude: number, latitude: number];
  initialZoom: number;
  bounds: Bounds;
  baseImagery: BaseImagery | null;
}

/** Per-feed presentation, stored once instead of on every layer reference. */
export interface FeedMeta {
  label: string;
  kind: LayerKind;
  format?: LayerFormat;
  contextType?: string;
}

/** One published observation. Every field here is frame-invariant. */
export interface CatalogAsset {
  feedId: string;
  observedAt: string;
  status: LayerStatus;
  url?: string;
  tiles?: string[];
  bounds?: Bounds;
  opacity?: number;
  featureCount?: number;
  cloudCoverPercent?: number;
  composite?: string;
  model?: string;
  promptCount?: number;
  sourceLagHours?: number;
  attribution?: string;
}

/** A snapshot cites an asset and its age at that frame... */
export interface AssetReference {
  ref: string;
  ageHours: number;
}

/** ...or records that a feed published nothing for the frame. */
export interface FeedGap {
  feedId: string;
  status: 'unavailable';
  statusReason: string;
}

export type SnapshotLayerEntry = AssetReference | FeedGap;

export const isAssetReference = (entry: SnapshotLayerEntry): entry is AssetReference =>
  typeof (entry as AssetReference).ref === 'string';

/**
 * A layer entry joined against `feeds` + `assets`. This is the flat shape the
 * map and specifications panel consume; nothing downstream sees the wire format.
 */
export interface ResolvedLayer {
  id: string;
  label: string;
  kind: LayerKind;
  format?: LayerFormat;
  status: LayerStatus;
  contextType?: string;
  statusReason?: string;
  sourceObservedAt?: string;
  ageHours?: number;
  featureCount?: number;
  cloudCoverPercent?: number;
  composite?: string;
  model?: string;
  promptCount?: number;
  sourceLagHours?: number;
  url?: string;
  tiles?: string[];
  bounds?: Bounds;
  opacity?: number;
  attribution?: string;
}

export interface Snapshot {
  id: string;
  observedAt: string;
  label: string;
  status: SnapshotStatus;
  layers: SnapshotLayerEntry[];
}

export interface TimelineConfig {
  startAt: string;
  endAt: string;
  cadenceHours: number;
}

export interface SnapshotCatalog {
  catalogFormat: number;
  version: string;
  updatedAt: string;
  pollIntervalSeconds: number;
  event: EventConfiguration;
  app?: AppConfig;
  timeline?: TimelineConfig;
  feeds: Record<string, FeedMeta>;
  assets: Record<string, CatalogAsset>;
  snapshots: Snapshot[];
}
