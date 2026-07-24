import type { MapController } from './MapController';
import type { CatalogClient } from '../network/CatalogClient';
import type { AppConfig, Bounds, EventConfiguration, SnapshotCatalog, TimelineConfig } from '../types';

const CONFIG_ENDPOINT = './api/config';

type SaveMode = 'dev' | 'readonly';

interface ConfigDraft {
  event: EventConfiguration;
  app: AppConfig;
  timeline: TimelineConfig;
}

type ConfigSource = ConfigDraft;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing settings element #${id}`);
  return node as T;
};

const num = (input: HTMLInputElement): number => Number(input.value);

/** Treat datetime-local values as UTC wall-clock so stored ISO stays stable. */
const isoToLocalInput = (iso: string): string => (iso.length >= 16 ? iso.slice(0, 16) : '');
const localInputToIso = (value: string): string => `${value}:00Z`;

export class SettingsController {
  private readonly form = el<HTMLFormElement>('settings-view');
  private readonly specsView = el<HTMLElement>('specs-view');
  private readonly tabSpecs = el<HTMLButtonElement>('tab-specs');
  private readonly tabSettings = el<HTMLButtonElement>('tab-settings');
  private readonly status = el<HTMLParagraphElement>('settings-status');
  private readonly areaSummary = el<HTMLParagraphElement>('set-area-summary');
  private readonly saveButton = el<HTMLButtonElement>('set-save');

  private source: ConfigSource | null = null;
  private mode: SaveMode = 'readonly';
  private populated = false;

  constructor(
    private readonly map: MapController,
    private readonly catalog: CatalogClient
  ) {
    this.tabSpecs.addEventListener('click', () => this.showTab('specs'));
    this.tabSettings.addEventListener('click', () => this.showTab('settings'));
    el<HTMLButtonElement>('set-use-view').addEventListener('click', () => this.useCurrentView());
    el<HTMLButtonElement>('set-copy').addEventListener('click', () => void this.copyJson());
    el<HTMLButtonElement>('set-reset').addEventListener('click', () => this.reset());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.save();
    });
    void this.probeEndpoint();
  }

  /** Called on every catalog update so the form has authoritative fallback values. */
  syncCatalog(catalog: SnapshotCatalog): void {
    if (!catalog.app) return;
    const source: ConfigSource = { event: catalog.event, app: catalog.app, timeline: catalog.timeline ?? this.defaultTimeline() };
    if (this.mode === 'dev') {
      // The dev /api/config endpoint is authoritative; only seed if the probe hasn't.
      if (!this.source) {
        this.source = source;
        if (!this.populated) this.populate(source);
      }
      return;
    }
    // read-only: the served catalog is the source of truth.
    this.source = source;
    if (!this.populated) this.populate(source);
  }

  private defaultTimeline(): TimelineConfig {
    return { startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-02T00:00:00Z', cadenceHours: 3 };
  }

  private showTab(which: 'specs' | 'settings'): void {
    const settings = which === 'settings';
    this.specsView.hidden = settings;
    this.form.hidden = !settings;
    this.tabSpecs.setAttribute('aria-selected', String(!settings));
    this.tabSettings.setAttribute('aria-selected', String(settings));
    if (settings && this.source && !this.populated) this.populate(this.source);
  }

  private async probeEndpoint(): Promise<void> {
    // Local dev authoring server → instant file write.
    try {
      const response = await fetch(CONFIG_ENDPOINT, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (response.ok) {
        const config = await response.json();
        this.mode = 'dev';
        this.source = { event: config.event, app: config.app, timeline: config.timeline };
        this.populate(this.source);
        this.applyMode();
        return;
      }
    } catch {
      // fall through to read-only
    }
    this.mode = 'readonly';
    this.applyMode();
  }

  private applyMode(): void {
    if (this.mode === 'readonly') {
      this.saveButton.disabled = true;
      this.saveButton.title = 'Saving needs the local dev server. Use “Copy config JSON”.';
    } else {
      this.saveButton.disabled = false;
      this.saveButton.title = '';
    }
  }

  private populate(source: ConfigSource): void {
    const { event, app, timeline } = source;
    el<HTMLInputElement>('set-title').value = app.title ?? event.name ?? '';
    el<HTMLInputElement>('set-tagline').value = app.tagline ?? '';
    el<HTMLInputElement>('set-start').value = isoToLocalInput(timeline.startAt);
    el<HTMLInputElement>('set-end').value = isoToLocalInput(timeline.endAt);
    el<HTMLSelectElement>('set-cadence').value = String(timeline.cadenceHours);
    el<HTMLInputElement>('set-center-lng').value = String(event.center[0]);
    el<HTMLInputElement>('set-center-lat').value = String(event.center[1]);
    el<HTMLInputElement>('set-west').value = String(event.bounds[0]);
    el<HTMLInputElement>('set-south').value = String(event.bounds[1]);
    el<HTMLInputElement>('set-east').value = String(event.bounds[2]);
    el<HTMLInputElement>('set-north').value = String(event.bounds[3]);
    el<HTMLInputElement>('set-zoom').value = String(app.initialZoom ?? 9);
    el<HTMLInputElement>('set-base-url').value = app.baseImagery?.tiles?.[0] ?? '';
    el<HTMLInputElement>('set-base-attr').value = app.baseImagery?.attribution ?? '';
    this.renderAreaSummary(event.center, event.bounds);
    this.populated = true;
  }

  private useCurrentView(): void {
    const view = this.map.captureView();
    el<HTMLInputElement>('set-center-lng').value = String(view.center[0]);
    el<HTMLInputElement>('set-center-lat').value = String(view.center[1]);
    el<HTMLInputElement>('set-west').value = String(view.bounds[0]);
    el<HTMLInputElement>('set-south').value = String(view.bounds[1]);
    el<HTMLInputElement>('set-east').value = String(view.bounds[2]);
    el<HTMLInputElement>('set-north').value = String(view.bounds[3]);
    el<HTMLInputElement>('set-zoom').value = String(Math.max(2, Math.round(view.zoom)));
    this.renderAreaSummary(view.center, view.bounds);
    this.setStatus('Captured the current map view as the fire area.', 'ok');
  }

  private renderAreaSummary(center: [number, number], bounds: Bounds): void {
    const [lng, lat] = center;
    const midLat = (bounds[1] + bounds[3]) / 2;
    const widthKm = Math.abs(bounds[2] - bounds[0]) * 111.32 * Math.cos((midLat * Math.PI) / 180);
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lng >= 0 ? 'E' : 'W';
    this.areaSummary.textContent =
      `Centered ${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lng).toFixed(2)}°${ew} · ~${widthKm.toFixed(0)} km across`;
  }

  private readForm(): ConfigDraft | null {
    if (!this.source) {
      this.setStatus('Configuration is still loading; try again in a moment.', 'error');
      return null;
    }
    const title = el<HTMLInputElement>('set-title').value.trim();
    if (!title) return this.fail('Enter a fire name.');

    const center: [number, number] = [num(el('set-center-lng')), num(el('set-center-lat'))];
    const bounds: Bounds = [num(el('set-west')), num(el('set-south')), num(el('set-east')), num(el('set-north'))];
    if (![...center, ...bounds].every(Number.isFinite)) return this.fail('Set the fire area, or click “Use current map view”.');
    if (center[1] < -90 || center[1] > 90 || Math.abs(center[0]) > 180) return this.fail('Center coordinates are out of range.');
    if (bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return this.fail('Bounds must be west < east and south < north.');

    const zoom = num(el('set-zoom'));
    if (!Number.isFinite(zoom) || zoom < 1 || zoom > 18) return this.fail('Initial zoom must be between 1 and 18.');

    const startValue = el<HTMLInputElement>('set-start').value;
    const endValue = el<HTMLInputElement>('set-end').value;
    if (!startValue || !endValue) return this.fail('Set both the start and end times.');
    const startAt = localInputToIso(startValue);
    const endAt = localInputToIso(endValue);
    if (Date.parse(startAt) >= Date.parse(endAt)) return this.fail('The end time must be after the start time.');

    const baseUrl = el<HTMLInputElement>('set-base-url').value.trim();
    if (baseUrl && !/\{z\}.*\{[xy]\}.*\{[xy]\}/.test(baseUrl)) {
      return this.fail('The base map URL needs {z}, {x} and {y} placeholders.');
    }

    const cadenceHours = Number(el<HTMLSelectElement>('set-cadence').value);
    const baseImagery = { ...this.source.app.baseImagery };
    if (baseUrl) baseImagery.tiles = [baseUrl];
    baseImagery.attribution = el<HTMLInputElement>('set-base-attr').value.trim() || baseImagery.attribution;

    return {
      event: { ...this.source.event, name: title, center, bounds },
      app: { ...this.source.app, title, tagline: el<HTMLInputElement>('set-tagline').value.trim(), initialZoom: zoom, baseImagery },
      timeline: { startAt, endAt, cadenceHours }
    };
  }

  private async save(): Promise<void> {
    const draft = this.readForm();
    if (!draft) return;
    if (this.mode === 'readonly') {
      this.setStatus('Live save is unavailable here. Use “Copy config JSON” to update the pipeline config.', 'error');
      return;
    }
    this.saveButton.disabled = true;
    this.setStatus('Saving…', 'ok');
    try {
      await this.saveDev(draft);
      this.source = draft;
      this.catalog.refreshNow();
      this.setStatus('Saved. The map is updating — regenerate the data layers to match the new area.', 'ok');
    } catch (error) {
      this.setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      this.saveButton.disabled = false;
    }
  }

  private async saveDev(draft: ConfigDraft): Promise<void> {
    const response = await fetch(CONFIG_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(detail || `Server returned ${response.status}`);
    }
  }

  private async copyJson(): Promise<void> {
    const draft = this.readForm();
    if (!draft) return;
    const text = `${JSON.stringify(draft, null, 2)}\n`;
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('Copied the fire definition. Merge it into public/data/catalog.config.json.', 'ok');
    } catch {
      this.setStatus('Clipboard blocked. Copy it from the console instead.', 'error');
      // eslint-disable-next-line no-console
      console.info(text);
    }
  }

  private reset(): void {
    if (this.source) this.populate(this.source);
    this.setStatus('Reverted to the saved configuration.', 'ok');
  }

  private fail(message: string): null {
    this.setStatus(message, 'error');
    return null;
  }

  private setStatus(message: string, tone: 'ok' | 'error'): void {
    this.status.textContent = message;
    this.status.dataset.tone = tone;
    this.status.hidden = false;
  }
}
