export type SnapshotStatus = 'ready' | 'processing' | 'awaiting-data';
export type LayerStatus = 'ready' | 'processing' | 'unavailable';
export type LayerKind = 'sentinel-raster' | 'sam-mask' | 'firms' | 'kml';
export type Bounds = [west: number, south: number, east: number, north: number];

export interface EventConfiguration {
  id: string;
  name: string;
  startedAt: string;
  center: [longitude: number, latitude: number];
  bounds: Bounds;
}

export interface SnapshotLayer {
  id: string;
  label: string;
  kind: LayerKind;
  status: LayerStatus;
  url?: string;
  tiles?: string[];
  bounds?: Bounds;
  opacity?: number;
  attribution?: string;
}

export interface SnapshotSpecifications {
  sourceIds?: string[];
  cloudCoverPercent?: number;
  samModel?: string;
  notes?: string;
}

export interface Snapshot {
  id: string;
  observedAt: string;
  publishedAt?: string;
  label: string;
  status: SnapshotStatus;
  layers: SnapshotLayer[];
  specifications?: SnapshotSpecifications;
}

export interface SnapshotCatalog {
  version: string;
  updatedAt: string;
  pollIntervalSeconds: number;
  event: EventConfiguration;
  snapshots: Snapshot[];
}
