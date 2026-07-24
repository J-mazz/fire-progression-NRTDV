import maplibregl, { GeoJSONSource, LngLatBounds } from 'maplibre-gl';
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import type { EventConfiguration, Snapshot, SnapshotLayer } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };

export class MapController {
  private readonly map: maplibregl.Map;
  private readonly ready: Promise<void>;
  private dynamicLayerIds: string[] = [];
  private dynamicSourceIds: string[] = [];
  private errorHandler: (message: string) => void = () => undefined;

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      center: [-122.98, 42.69],
      zoom: 10,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      }
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('error', (event) => this.errorHandler(event.error?.message ?? 'Map rendering error.'));
    this.ready = new Promise((resolve) => this.map.once('load', () => {
      this.installUploadedKmlLayers();
      resolve();
    }));
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
  }

  async setEvent(event: EventConfiguration): Promise<void> {
    await this.ready;
    this.map.fitBounds(event.bounds, { padding: 72, duration: 700, maxZoom: 12 });
    const source = this.map.getSource('event-area') as GeoJSONSource | undefined;
    const data: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { name: event.name },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [event.bounds[0], event.bounds[1]],
            [event.bounds[2], event.bounds[1]],
            [event.bounds[2], event.bounds[3]],
            [event.bounds[0], event.bounds[3]],
            [event.bounds[0], event.bounds[1]]
          ]]
        }
      }]
    };
    if (source) {
      source.setData(data);
      return;
    }
    this.map.addSource('event-area', { type: 'geojson', data });
    this.map.addLayer({
      id: 'event-area-outline',
      type: 'line',
      source: 'event-area',
      paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [3, 2], 'line-opacity': 0.75 }
    });
  }

  async renderSnapshot(snapshot: Snapshot): Promise<void> {
    await this.ready;
    this.clearDynamicLayers();
    for (const layer of snapshot.layers) {
      if (layer.status !== 'ready') continue;
      if (layer.kind === 'sentinel-raster') this.addRasterLayer(layer);
      else this.addGeoJsonLayer(layer);
    }
  }

  async setUploadedKml(data: FeatureCollection<Geometry, GeoJsonProperties>): Promise<void> {
    await this.ready;
    const source = this.map.getSource('uploaded-kml') as GeoJSONSource;
    source.setData(data);
    const bounds = collectBounds(data);
    if (!bounds.isEmpty()) this.map.fitBounds(bounds, { padding: 84, duration: 700, maxZoom: 15 });
  }

  private installUploadedKmlLayers(): void {
    this.map.addSource('uploaded-kml', { type: 'geojson', data: EMPTY_COLLECTION });
    this.map.addLayer({
      id: 'uploaded-kml-fill', type: 'fill', source: 'uploaded-kml',
      paint: { 'fill-color': '#f97316', 'fill-opacity': 0.22 }
    });
    this.map.addLayer({
      id: 'uploaded-kml-line', type: 'line', source: 'uploaded-kml',
      paint: { 'line-color': '#fb923c', 'line-width': 3, 'line-opacity': 0.95 }
    });
    this.map.addLayer({
      id: 'uploaded-kml-point', type: 'circle', source: 'uploaded-kml',
      paint: { 'circle-color': '#fb923c', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }
    });
  }

  private addRasterLayer(layer: SnapshotLayer): void {
    const sourceId = `snapshot-source-${layer.id}`;
    const layerId = `snapshot-layer-${layer.id}`;
    const tiles = layer.tiles ?? (layer.url ? [layer.url] : []);
    if (tiles.length === 0) return;
    this.map.addSource(sourceId, {
      type: 'raster', tiles, tileSize: 256,
      ...(layer.bounds ? { bounds: layer.bounds } : {}),
      ...(layer.attribution ? { attribution: layer.attribution } : {})
    });
    this.map.addLayer({
      id: layerId, type: 'raster', source: sourceId,
      paint: {
        'raster-opacity': layer.opacity ?? 0.82,
        'raster-opacity-transition': { duration: 350 }
      }
    });
    this.dynamicSourceIds.push(sourceId);
    this.dynamicLayerIds.push(layerId);
  }

  private addGeoJsonLayer(layer: SnapshotLayer): void {
    if (!layer.url) return;
    const sourceId = `snapshot-source-${layer.id}`;
    this.map.addSource(sourceId, { type: 'geojson', data: layer.url });
    this.dynamicSourceIds.push(sourceId);

    if (layer.kind === 'firms') {
      const id = `snapshot-points-${layer.id}`;
      this.map.addLayer({
        id, type: 'circle', source: sourceId,
        paint: {
          'circle-color': '#ff3b20', 'circle-radius': 6,
          'circle-blur': 0.15, 'circle-opacity': layer.opacity ?? 0.9,
          'circle-stroke-color': '#ffd7c7', 'circle-stroke-width': 1
        }
      });
      this.dynamicLayerIds.push(id);
      return;
    }

    const fillId = `snapshot-fill-${layer.id}`;
    const lineId = `snapshot-line-${layer.id}`;
    this.map.addLayer({
      id: fillId, type: 'fill', source: sourceId,
      paint: {
        'fill-color': layer.kind === 'sam-mask' ? '#ef4444' : '#f59e0b',
        'fill-opacity': layer.opacity ?? 0.32,
        'fill-opacity-transition': { duration: 350 }
      }
    });
    this.map.addLayer({
      id: lineId, type: 'line', source: sourceId,
      paint: {
        'line-color': layer.kind === 'sam-mask' ? '#ff6b57' : '#fbbf24',
        'line-width': 2.5, 'line-opacity': 0.95
      }
    });
    this.dynamicLayerIds.push(fillId, lineId);
  }

  private clearDynamicLayers(): void {
    for (const id of this.dynamicLayerIds.reverse()) if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of this.dynamicSourceIds.reverse()) if (this.map.getSource(id)) this.map.removeSource(id);
    this.dynamicLayerIds = [];
    this.dynamicSourceIds = [];
  }
}

function collectBounds(data: FeatureCollection): LngLatBounds {
  const bounds = new LngLatBounds();
  const visit = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      bounds.extend([coordinates[0], coordinates[1]]);
      return;
    }
    for (const item of coordinates) visit(item);
  };
  for (const feature of data.features) {
    if (feature.geometry && 'coordinates' in feature.geometry) visit(feature.geometry.coordinates);
    if (feature.geometry?.type === 'GeometryCollection') {
      for (const geometry of feature.geometry.geometries) if ('coordinates' in geometry) visit(geometry.coordinates);
    }
  }
  return bounds;
}
