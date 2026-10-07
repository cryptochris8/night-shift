/**
 * Recorded narration: the title briefing, the one sound in the game that is not synthesised. It plays
 * through a plain media element instead of the Web Audio graph so it can start in the gesture that
 * asks for it, before the AudioContext is running. The engine sets its level from the master volume
 * and ducks the world under it while `active`.
 */
import type { NarrationState, NarrationStatus } from '../core/contracts';

/** The part of HTMLAudioElement this uses (tests pass a fake). */
export interface NarrationMedia {
  src: string;
  volume: number;
  currentTime: number;
  readonly duration: number;
  preload: string;
  play(): Promise<void> | undefined;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Narration {
  private media: NarrationMedia | null = null;
  private state: NarrationState = 'idle';
  private url = '';
  private level = 1;
  /** 1 = full, falls to 0 while stopping */
  private fade = 1;
  private fadeRate = 0;
  /** bumped on every start/stop so a late play() promise from an earlier start is ignored */
  private token = 0;
  /** the fade runs on frames; this wall-clock backstop ends it when frames stall (a hidden tab) */
  private haltTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly make: () => NarrationMedia;

  constructor(make: () => NarrationMedia = () => new Audio()) {
    this.make = make;
  }

  /** Loading or playing, or still fading out: the engine keeps the world ducked meanwhile. */
  get active(): boolean {
    return this.state === 'loading' || this.state === 'playing' || this.fadeRate > 0;
  }

  play(url: string): void {
    const m = this.element();
    const token = ++this.token;
    if (this.url !== url) {
      m.src = url;
      this.url = url;
    }
    m.currentTime = 0;
    this.clearHaltTimer();
    this.fade = 1;
    this.fadeRate = 0;
    this.apply();
    this.state = 'loading';
    let started: Promise<void> | undefined;
    try {
      started = m.play();
    } catch {
      this.state = 'failed';
      return;
    }
    if (!started) {
      this.state = 'playing';
      return;
    }
    started.then(
      () => {
        if (token === this.token && this.state === 'loading') this.state = 'playing';
      },
      () => {
        // autoplay refused, unsupported file, or a pause() that interrupted this start
        if (token === this.token) this.state = 'failed';
      },
    );
  }

  stop(fadeSeconds = 0.5): void {
    if (this.state !== 'loading' && this.state !== 'playing') return;
    this.state = 'stopped';
    this.token++;
    if (fadeSeconds <= 0) {
      this.halt();
      return;
    }
    this.fadeRate = 1 / fadeSeconds;
    this.clearHaltTimer();
    this.haltTimer = setTimeout(() => {
      this.haltTimer = null;
      if (this.fadeRate > 0) this.halt();
    }, fadeSeconds * 1000 + 100);
  }

  /** Master-derived volume, 0..1. */
  setLevel(v: number): void {
    this.level = clamp01(v);
    this.apply();
  }

  update(dt: number): void {
    if (this.fadeRate <= 0) return;
    this.fade = Math.max(0, this.fade - dt * this.fadeRate);
    this.apply();
    if (this.fade <= 0) this.halt();
  }

  status(): NarrationStatus {
    const m = this.media;
    const duration = m && Number.isFinite(m.duration) ? m.duration : 0;
    return { state: this.state, time: m ? m.currentTime : 0, duration };
  }

  dispose(): void {
    this.clearHaltTimer();
    this.token++;
    this.media?.pause();
    this.media = null;
    this.fadeRate = 0;
    this.state = 'idle';
  }

  private element(): NarrationMedia {
    if (this.media) return this.media;
    const m = this.make();
    m.preload = 'auto';
    m.addEventListener('ended', () => {
      if (this.state === 'playing' || this.state === 'loading') this.state = 'ended';
    });
    m.addEventListener('error', () => {
      if (this.state === 'playing' || this.state === 'loading') this.state = 'failed';
    });
    this.media = m;
    return m;
  }

  private halt(): void {
    this.clearHaltTimer();
    this.fadeRate = 0;
    this.fade = 0;
    this.apply();
    this.media?.pause();
  }

  private clearHaltTimer(): void {
    if (this.haltTimer === null) return;
    clearTimeout(this.haltTimer);
    this.haltTimer = null;
  }

  private apply(): void {
    if (this.media) this.media.volume = clamp01(this.level * this.fade);
  }
}
