import type { Snapshot } from '../types';

interface TimelineCallbacks {
  onSelect(index: number): void;
  onTogglePlayback(): void;
  onGoLive(): void;
  onSpeedChange(): void;
}

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing timeline element #${id}`);
  return node as T;
};

export class TimelineController {
  private readonly range = el<HTMLInputElement>('timeline-range');
  private readonly label = el<HTMLElement>('timeline-label');
  private readonly playButton = el<HTMLButtonElement>('play-button');
  private readonly liveButton = el<HTMLButtonElement>('live-button');
  private readonly speed = el<HTMLSelectElement>('playback-speed');

  constructor(callbacks: TimelineCallbacks) {
    this.range.addEventListener('input', () => callbacks.onSelect(Number(this.range.value)));
    this.playButton.addEventListener('click', callbacks.onTogglePlayback);
    this.liveButton.addEventListener('click', callbacks.onGoLive);
    this.speed.addEventListener('change', callbacks.onSpeedChange);
  }

  get playbackIntervalMs(): number {
    return 1_500 / Number(this.speed.value || 1);
  }

  setSnapshots(snapshots: Snapshot[]): void {
    this.range.max = String(Math.max(0, snapshots.length - 1));
    this.range.disabled = snapshots.length < 2;
    this.playButton.disabled = snapshots.length < 2;
  }

  select(index: number, snapshot: Snapshot): void {
    this.range.value = String(index);
    this.label.textContent = snapshot.label;
  }

  setPlaying(playing: boolean): void {
    this.playButton.textContent = playing ? 'Pause' : 'Play';
    this.playButton.setAttribute('aria-label', playing ? 'Pause timeline' : 'Play timeline');
  }

  setLive(live: boolean): void {
    this.liveButton.dataset.active = String(live);
    this.liveButton.setAttribute('aria-pressed', String(live));
  }
}
