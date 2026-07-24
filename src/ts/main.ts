import { kml } from '@tmcw/togeojson';
import type { FeatureCollection, Geometry } from 'geojson';
import { CatalogClient } from './network/CatalogClient';
import { MapController } from './core/MapController';
import { TimelineController } from './core/TimelineController';
import type { Snapshot, SnapshotCatalog } from './types';

const CATALOG_URL = './data/catalog.json';

const requiredElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
};

const mapController = new MapController('map');
const statusElement = requiredElement<HTMLSpanElement>('connection-status');
const observedElement = requiredElement<HTMLElement>('spec-observed');
const freshnessElement = requiredElement<HTMLElement>('spec-freshness');
const layersElement = requiredElement<HTMLElement>('spec-layers');
const pipelineElement = requiredElement<HTMLElement>('spec-pipeline');
const kmlElement = requiredElement<HTMLElement>('spec-kml');
const errorElement = requiredElement<HTMLElement>('error-message');
const fileInput = requiredElement<HTMLInputElement>('kml-input');

let catalog: SnapshotCatalog | null = null;
let selectedSnapshotId: string | null = null;
let liveMode = true;
let playbackTimer: number | null = null;

const timeline = new TimelineController({
  onSelect(index) {
    liveMode = false;
    timeline.setLive(false);
    void selectSnapshotByIndex(index);
  },
  onTogglePlayback() {
    playbackTimer === null ? startPlayback() : stopPlayback();
  },
  onGoLive() {
    liveMode = true;
    stopPlayback();
    if (catalog) void selectSnapshotByIndex(catalog.snapshots.length - 1);
  }
});

function parseDate(value: string): Date {
  return new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
}

function formatObservedAt(value: string): string {
  const date = parseDate(value);
  const options: Intl.DateTimeFormatOptions = value.length === 10
    ? { dateStyle: 'medium', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function describeFreshness(snapshot: Snapshot): string {
  const ageMs = Date.now() - parseDate(snapshot.observedAt).getTime();
  const ageHours = Math.max(0, Math.floor(ageMs / 3_600_000));
  if (ageHours < 24) return `${ageHours}h old`;
  return `${Math.floor(ageHours / 24)}d old`;
}

function renderSpecifications(snapshot: Snapshot): void {
  observedElement.textContent = formatObservedAt(snapshot.observedAt);
  freshnessElement.textContent = describeFreshness(snapshot);
  const readyLayers = snapshot.layers.filter((layer) => layer.status === 'ready');
  layersElement.textContent = readyLayers.length === 0
    ? 'OSM base only'
    : readyLayers.map((layer) => layer.label).join(', ');
  pipelineElement.textContent = snapshot.status === 'ready'
    ? 'Published'
    : snapshot.status === 'processing' ? 'Processing' : 'Awaiting source data';
}

async function selectSnapshotByIndex(index: number): Promise<void> {
  if (!catalog || catalog.snapshots.length === 0) return;
  const boundedIndex = Math.max(0, Math.min(index, catalog.snapshots.length - 1));
  const snapshot = catalog.snapshots[boundedIndex];
  if (!snapshot) return;

  selectedSnapshotId = snapshot.id;
  timeline.select(boundedIndex, snapshot);
  renderSpecifications(snapshot);
  errorElement.hidden = true;

  try {
    await mapController.renderSnapshot(snapshot);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function startPlayback(): void {
  if (!catalog || catalog.snapshots.length < 2) return;
  timeline.setPlaying(true);
  liveMode = false;
  timeline.setLive(false);
  playbackTimer = window.setInterval(() => {
    if (!catalog) return;
    const currentIndex = catalog.snapshots.findIndex((snapshot) => snapshot.id === selectedSnapshotId);
    const nextIndex = currentIndex >= catalog.snapshots.length - 1 ? 0 : currentIndex + 1;
    void selectSnapshotByIndex(nextIndex);
  }, timeline.playbackIntervalMs);
}

function stopPlayback(): void {
  if (playbackTimer !== null) window.clearInterval(playbackTimer);
  playbackTimer = null;
  timeline.setPlaying(false);
}

function showError(message: string): void {
  errorElement.textContent = message;
  errorElement.hidden = false;
  statusElement.textContent = 'Update degraded';
  statusElement.dataset.state = 'error';
}

function applyCatalog(nextCatalog: SnapshotCatalog): void {
  const previousSelection = selectedSnapshotId;
  catalog = nextCatalog;
  void mapController.setEvent(nextCatalog.event);
  timeline.setSnapshots(nextCatalog.snapshots);
  statusElement.textContent = 'Catalog current';
  statusElement.dataset.state = 'ready';

  const preservedIndex = previousSelection
    ? nextCatalog.snapshots.findIndex((snapshot) => snapshot.id === previousSelection)
    : -1;
  const targetIndex = liveMode || preservedIndex < 0
    ? nextCatalog.snapshots.length - 1
    : preservedIndex;
  void selectSnapshotByIndex(targetIndex);
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const documentNode = new DOMParser().parseFromString(await file.text(), 'text/xml');
    if (documentNode.querySelector('parsererror')) throw new Error('The selected KML is not valid XML.');
    const converted = kml(documentNode, { skipNullGeometry: true });
    const data: FeatureCollection<Geometry> = {
      type: 'FeatureCollection',
      features: converted.features.filter((feature) => feature.geometry !== null) as FeatureCollection<Geometry>['features']
    };
    await mapController.setUploadedKml(data);
    kmlElement.textContent = `${file.name} · ${data.features.length} features`;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    fileInput.value = '';
  }
});

mapController.onError(showError);

const catalogClient = new CatalogClient(CATALOG_URL);
catalogClient.start(applyCatalog, (error) => showError(`Catalog update failed: ${error.message}`));
