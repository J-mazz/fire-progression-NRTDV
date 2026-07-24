import maplibregl, { GeoJSONSource } from 'maplibre-gl';
import { kml } from '@tmcw/togeojson';
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson';
import type { EventConfiguration, Snapshot, SnapshotLayer } from '../types';
import 'maplibre-gl/dist/maplibre-gl.css';

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] };
const SOURCE_SAM = 'sam-fire-body';
const SOURCE_OPERATIONAL = 'operational-vectors';
const SOURCE_FIRMS = 'viirs-trail';
const LAYER_SAM_FILL = 'sam-body-fill';
const LAYER_SAM_LINE = 'sam-body-outline';
const LAYER_FIRMS = 'viirs-thermal-field';
const SOURCE_SENTINEL = 'sentinel-acquisition';
const LAYER_SENTINEL = 'sentinel-acquisition';
const CONTEXT_LINE_LAYERS = ['context-roads', 'context-county-borders', 'context-city-limits'];
const CONTEXT_LABEL_LAYERS = ['context-road-labels', 'context-county-labels', 'context-city-labels', 'context-landscape-labels'];
const OPERATIONAL_LAYERS = [
  ...CONTEXT_LINE_LAYERS,
  ...CONTEXT_LABEL_LAYERS,
  'operational-fill', 'operational-line', 'operational-points'
];

export class MapController {
  private readonly map: maplibregl.Map;
  private readonly ready: Promise<void>;
  private readonly dataCache = new Map<string, Promise<FeatureCollection>>();
  private renderRevision = 0;
  private currentSentinelId: string | null = null;
  private lastEventKey: string | null = null;
  private errorHandler: (message: string) => void = () => undefined;

  constructor(container: string) {
    this.map = new maplibregl.Map({
      container,
      center: [-122.9109927, 42.6454545],
      zoom: 9,
      minZoom: 2,
      maxZoom: 19,
      attributionControl: false,
      style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {
          'world-imagery': {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
            ],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: 'Earth imagery © Esri and contributors'
          }
        },
        layers: [{ id: 'world-imagery', type: 'raster', source: 'world-imagery' }]
      }
    });
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('error', (event) => this.errorHandler(event.error?.message ?? 'Map rendering error.'));
    this.ready = new Promise((resolve) => this.map.once('load', () => {
      this.installPersistentLayers();
      resolve();
    }));
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
  }

  async setEvent(event: EventConfiguration): Promise<void> {
    await this.ready;
    const eventKey = `${event.id}|${event.bounds.join(',')}`;
    if (eventKey === this.lastEventKey) return;
    this.lastEventKey = eventKey;
    this.map.fitBounds(event.bounds, { padding: 64, duration: 650, maxZoom: 11 });
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
    const source = this.map.getSource('event-area') as GeoJSONSource | undefined;
    if (source) {
      source.setData(data);
    } else {
      this.map.addSource('event-area', { type: 'geojson', data });
      this.map.addLayer({
        id: 'event-area-outline', type: 'line', source: 'event-area',
        paint: {
          'line-color': '#ffd166', 'line-width': 1,
          'line-dasharray': [2, 4], 'line-opacity': 0.3
        }
      });
    }
    this.raiseOverlays();
  }

  async renderSnapshot(snapshot: Snapshot): Promise<void> {
    await this.ready;
    const revision = ++this.renderRevision;
    const readyLayers = snapshot.layers.filter((layer) => layer.status === 'ready');
    const sentinel = readyLayers.find((layer) => layer.kind === 'sentinel-raster');
    const samLayers = readyLayers.filter((layer) => layer.kind === 'sam-mask');
    const firmsLayers = readyLayers.filter((layer) => layer.kind === 'firms');
    const operationalLayers = readyLayers.filter((layer) => layer.kind === 'kml');

    const [samData, operationalData, firmsData] = await Promise.all([
      this.mergeLayerCollections(samLayers),
      this.mergeLayerCollections(operationalLayers),
      this.mergeLayerCollections(firmsLayers)
    ]);
    if (revision !== this.renderRevision) return;
    this.setSentinel(sentinel);
    (this.map.getSource(SOURCE_SAM) as GeoJSONSource).setData(samData);
    (this.map.getSource(SOURCE_OPERATIONAL) as GeoJSONSource).setData(operationalData);
    (this.map.getSource(SOURCE_FIRMS) as GeoJSONSource).setData(firmsData);
    this.setOverlayVisibility(SOURCE_SAM, samLayers.length > 0);
    this.setOverlayVisibility(SOURCE_OPERATIONAL, operationalLayers.length > 0);
    this.setOverlayVisibility(SOURCE_FIRMS, firmsLayers.length > 0);
    this.raiseOverlays();
  }

  prefetchSnapshot(snapshot: Snapshot): void {
    for (const layer of snapshot.layers) {
      if (layer.status === 'ready' && layer.url && layer.kind !== 'sentinel-raster') {
        void this.loadVectorData(layer).catch(() => undefined);
      }
    }
  }

  private installPersistentLayers(): void {
    this.map.addSource(SOURCE_SAM, { type: 'geojson', data: EMPTY_COLLECTION });
    this.map.addLayer({
      id: LAYER_SAM_FILL, type: 'fill', source: SOURCE_SAM,
      layout: { visibility: 'none' },
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0],
          0, '#ff4d20', 168, '#6b1717'
        ],
        'fill-opacity': [
          'interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0],
          0, 0.55, 168, 0.16
        ],
        'fill-antialias': true,
        'fill-opacity-transition': { duration: 180 }
      }
    });
    this.map.addLayer({
      id: LAYER_SAM_LINE, type: 'line', source: SOURCE_SAM,
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': [
          'interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0],
          0, '#ffd166', 168, '#8f2020'
        ],
        'line-width': [
          'interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0],
          0, 2.2, 168, 0.8
        ],
        'line-opacity': 0.9
      }
    });

    this.map.addSource(SOURCE_OPERATIONAL, {
      type: 'geojson', data: EMPTY_COLLECTION,
      attribution: '© OpenStreetMap contributors'
    });
    this.map.addLayer({
      id: 'context-roads', type: 'line', source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'roads'],
      layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#f4e8c8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 11, 1.4, 15, 3.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.38, 12, 0.78]
      }
    });
    this.map.addLayer({
      id: 'context-county-borders', type: 'line', source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'county-borders'],
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': '#dbeafe', 'line-width': 1.6,
        'line-dasharray': [5, 3], 'line-opacity': 0.7
      }
    });
    this.map.addLayer({
      id: 'context-city-limits', type: 'line', source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'city-limits'],
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: {
        'line-color': '#fde68a', 'line-width': 1.35,
        'line-dasharray': [2, 2], 'line-opacity': 0.78
      }
    });
    this.addContextLabelLayer('context-road-labels', 'roads', 'line', 11, '#fff5d6');
    this.addContextLabelLayer('context-county-labels', 'county-borders', 'line', 7, '#dbeafe');
    this.addContextLabelLayer('context-city-labels', 'city-limits', 'line', 9, '#fde68a');
    this.map.addLayer({
      id: 'context-landscape-labels', type: 'symbol', source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], 'landscape-features'],
      minzoom: 9,
      layout: {
        visibility: 'none',
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 14, 13],
        'text-padding': 5,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#d9f99d',
        'text-halo-color': 'rgba(5, 15, 12, 0.9)',
        'text-halo-width': 1.35
      }
    });
    this.map.addLayer({
      id: 'operational-fill', type: 'fill', source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.2 }
    });
    this.map.addLayer({
      id: 'operational-line', type: 'line', source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: { 'line-color': '#fbbf24', 'line-width': 2.4, 'line-opacity': 0.95 }
    });
    this.map.addLayer({
      id: 'operational-points', type: 'circle', source: SOURCE_OPERATIONAL,
      filter: ['any', ['!', ['has', 'contextType']], ['==', ['get', 'contextType'], 'incident-perimeter']],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': '#fbbf24', 'circle-radius': 4,
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1
      }
    });

    this.map.addSource(SOURCE_FIRMS, { type: 'geojson', data: EMPTY_COLLECTION });
    this.map.addLayer({
      id: LAYER_FIRMS, type: 'heatmap', source: SOURCE_FIRMS,
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': [
          '*',
          [
            'interpolate', ['linear'], ['coalesce', ['get', 'frpMw'], 0],
            0, 0.08,
            10, 0.3,
            50, 0.72,
            200, 1
          ],
          [
            'interpolate', ['linear'], ['coalesce', ['get', 'ageHours'], 0],
            0, 1,
            72, 0.55,
            168, 0.12
          ]
        ],
        'heatmap-intensity': [
          'interpolate', ['linear'], ['zoom'],
          7, 0.7,
          11, 1.25,
          15, 1.7
        ],
        'heatmap-radius': [
          'interpolate', ['linear'], ['zoom'],
          7, 7,
          11, 18,
          15, 32
        ],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(75, 13, 13, 0)',
          0.15, 'rgba(127, 29, 29, 0.28)',
          0.35, 'rgba(220, 38, 38, 0.48)',
          0.58, 'rgba(249, 115, 22, 0.64)',
          0.8, 'rgba(251, 191, 36, 0.78)',
          1, 'rgba(255, 245, 180, 0.9)'
        ],
        'heatmap-opacity': [
          'interpolate', ['linear'], ['zoom'],
          7, 0.72,
          13, 0.58,
          17, 0.42
        ]
      }
    });
  }

  private setSentinel(layer: SnapshotLayer | undefined): void {
    const desiredId = layer?.id ?? null;
    if (desiredId === this.currentSentinelId) return;
    if (this.map.getLayer(LAYER_SENTINEL)) this.map.removeLayer(LAYER_SENTINEL);
    if (this.map.getSource(SOURCE_SENTINEL)) this.map.removeSource(SOURCE_SENTINEL);
    this.currentSentinelId = null;
    if (!layer?.url || !layer.bounds) return;

    const [west, south, east, north] = layer.bounds;
    this.map.addSource(SOURCE_SENTINEL, {
      type: 'image', url: layer.url,
      coordinates: [[west, north], [east, north], [east, south], [west, south]]
    });
    this.map.addLayer({
      id: LAYER_SENTINEL, type: 'raster', source: SOURCE_SENTINEL,
      paint: {
        'raster-opacity': layer.opacity ?? 0.72,
        'raster-opacity-transition': { duration: 240 }
      }
    }, LAYER_SAM_FILL);
    this.currentSentinelId = desiredId;
  }

  private async mergeLayerCollections(layers: SnapshotLayer[]): Promise<FeatureCollection> {
    if (layers.length === 0) return EMPTY_COLLECTION;
    const collections = await Promise.all(layers.map((layer) => this.loadVectorData(layer)));
    const features: Feature<Geometry, GeoJsonProperties>[] = [];
    collections.forEach((collection, index) => {
      const layer = layers[index]!;
      for (const feature of collection.features) {
        if (!feature.geometry) continue;
        features.push({
          ...feature,
          properties: {
            ...(feature.properties ?? {}),
            ageHours: layer.ageHours ?? 0,
            contextType: layer.contextType,
            sourceObservedAt: layer.sourceObservedAt,
            sourceLayerId: layer.id
          }
        } as Feature<Geometry, GeoJsonProperties>);
      }
    });
    return { type: 'FeatureCollection', features };
  }

  private loadVectorData(layer: SnapshotLayer): Promise<FeatureCollection> {
    if (!layer.url) return Promise.resolve(EMPTY_COLLECTION);
    const cached = this.dataCache.get(layer.url);
    if (cached) return cached;
    const pending = fetch(layer.url, { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Layer request returned ${response.status}: ${layer.url}`);
        if (layer.kind === 'kml' || layer.format === 'kml') {
          const documentNode = new DOMParser().parseFromString(await response.text(), 'text/xml');
          if (documentNode.querySelector('parsererror')) throw new Error(`Invalid KML document: ${layer.url}`);
          const converted = kml(documentNode, { skipNullGeometry: true });
          return {
            type: 'FeatureCollection',
            features: converted.features.filter((feature) => feature.geometry !== null)
          } as FeatureCollection;
        }
        return response.json() as Promise<FeatureCollection>;
      })
      .catch((error) => {
        this.dataCache.delete(layer.url!);
        throw error;
      });
    this.dataCache.set(layer.url, pending);
    return pending;
  }

  private setOverlayVisibility(sourceId: string, visible: boolean): void {
    const visibility = visible ? 'visible' : 'none';
    const layerIds = sourceId === SOURCE_SAM
      ? [LAYER_SAM_FILL, LAYER_SAM_LINE]
      : sourceId === SOURCE_OPERATIONAL
        ? OPERATIONAL_LAYERS
        : [LAYER_FIRMS];
    for (const id of layerIds) this.map.setLayoutProperty(id, 'visibility', visibility);
  }

  private raiseOverlays(): void {
    const ordered = [
      ...CONTEXT_LINE_LAYERS,
      LAYER_FIRMS,
      LAYER_SAM_FILL, LAYER_SAM_LINE,
      ...CONTEXT_LABEL_LAYERS,
      'operational-fill', 'operational-line', 'operational-points',
      'event-area-outline'
    ];
    for (const id of ordered) if (this.map.getLayer(id)) this.map.moveLayer(id);
    this.assertOverlaysAboveRasters();
  }

  private assertOverlaysAboveRasters(): void {
    const styleLayers = this.map.getStyle().layers;
    const highestRasterIndex = styleLayers.reduce(
      (highest, layer, index) => layer.type === 'raster' ? Math.max(highest, index) : highest,
      -1
    );
    const hiddenOverlay = [...CONTEXT_LINE_LAYERS, LAYER_FIRMS, LAYER_SAM_FILL, LAYER_SAM_LINE, 'event-area-outline']
      .find((id) => {
        const index = styleLayers.findIndex((layer) => layer.id === id);
        return index >= 0 && index <= highestRasterIndex;
      });
    if (hiddenOverlay) throw new Error(`Overlay ${hiddenOverlay} is below a raster layer.`);
  }

  private addContextLabelLayer(
    id: string,
    contextType: string,
    placement: 'line' | 'point',
    minzoom: number,
    color: string
  ): void {
    this.map.addLayer({
      id, type: 'symbol', source: SOURCE_OPERATIONAL,
      filter: ['==', ['get', 'contextType'], contextType],
      minzoom,
      layout: {
        visibility: 'none',
        'symbol-placement': placement,
        'text-field': ['coalesce', ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': placement === 'line' ? 10.5 : 11,
        'text-padding': 6,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': color,
        'text-halo-color': 'rgba(8, 12, 18, 0.92)',
        'text-halo-width': 1.3
      }
    });
  }
}