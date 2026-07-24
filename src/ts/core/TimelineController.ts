import type { Snapshot } from '../types';

interface TimelineCallbacks {
  onSelect(index: number): void;
  onTogglePlayback(): void;
  onGoLive(): void;
}

export class TimelineController {
  private readonly range = document.getElementById('timeline-range') as HTMLInputElement;
  private readonly label = document.getElementById('timeline-label') as HTMLElement;
  private readonly playButton = document.getElementById('play-button') as HTMLButtonElement;
  private readonly liveButton = document.getElementById('live-button') as HTMLButtonElement;
  private readonly speed = document.getElementById('playback-speed') as HTMLSelectElement;

  constructor(callbacks: TimelineCallbacks) {
    this.range.addEventListener('input', () => callbacks.onSelect(Number(this.range.value)));
    this.playButton.addEventListener('click', callbacks.onTogglePlayback);
    this.liveButton.addEventListener('click', callbacks.onGoLive);
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
