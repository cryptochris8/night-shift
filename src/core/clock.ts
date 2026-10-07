/**
 * In-game clock. Time is stored as game MINUTES since shift start (22:45 = 0).
 * 1 real second advances DEFAULT_TIME_SCALE game seconds (6 → 30 real minutes per shift).
 */
import {
  DEFAULT_TIME_SCALE,
  SHIFT_LENGTH_MINUTES,
  SHIFT_START_HOUR,
  SHIFT_START_MINUTE,
} from './types';

export class GameClock {
  /** game minutes since shift start */
  time = 0;
  /** game seconds per real second */
  timeScale = DEFAULT_TIME_SCALE;
  running = false;

  reset(time = 0): void {
    this.time = time;
    this.running = false;
  }

  /** Advance by real seconds. Returns game minutes elapsed this step. */
  advance(realDt: number): number {
    if (!this.running) return 0;
    const dMin = (realDt * this.timeScale) / 60;
    const before = this.time;
    this.time = Math.min(SHIFT_LENGTH_MINUTES, this.time + dMin);
    return this.time - before;
  }

  /** Jump forward/back (debug / cinematic skips). */
  set(time: number): void {
    this.time = Math.max(0, Math.min(SHIFT_LENGTH_MINUTES, time));
  }

  get finished(): boolean {
    return this.time >= SHIFT_LENGTH_MINUTES;
  }
}

/** Absolute wall-clock components for a game time. */
export function clockParts(minutes: number): { h24: number; m: number; s: number } {
  const total = SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE + minutes;
  const h24 = Math.floor(total / 60) % 24;
  const m = Math.floor(total % 60);
  const s = Math.floor((total - Math.floor(total)) * 60);
  return { h24, m, s };
}

/** "10:47 PM" */
export function formatClock12(minutes: number): string {
  const { h24, m } = clockParts(minutes);
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`;
}

/** "22:47:13" — used by CCTV timestamps and terminals. */
export function formatClock24(minutes: number, withSeconds = true): string {
  const { h24, m, s } = clockParts(minutes);
  const base = `${h24.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  return withSeconds ? `${base}:${s.toString().padStart(2, '0')}` : base;
}

/** Game minutes for an absolute "HH:MM" on the shift (handles the midnight wrap). */
export function minutesAt(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  let total = h * 60 + m - (SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE);
  if (total < 0) total += 24 * 60;
  return total;
}
