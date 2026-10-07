/**
 * Seeded deterministic RNG (mulberry32) + Night Seed helpers.
 * The Night Seed decides the hidden scenario and seeds every random decision in a run,
 * so a seed code can be replayed exactly.
 */
import type { ScenarioType } from './types';

export function hashString(str: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class RNG {
  private state: number;
  readonly seed: number;

  constructor(seed: number | string) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.state = this.seed || 0x9e3779b9;
  }

  /** [0,1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** integer in [min,max] inclusive */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** weighted pick: items [{item, weight}] */
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((s, i) => s + Math.max(0, i.weight), 0);
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, it.weight);
      if (r <= 0) return it.item;
    }
    return items[items.length - 1].item;
  }

  /** derive an independent sub-stream (e.g. one per system) */
  fork(label: string): RNG {
    return new RNG(hashString(`${this.seed}:${label}`));
  }
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Make a human-readable Night Seed code from a numeric source (e.g. Date.now()). */
export function makeSeedCode(source: number): string {
  // keep every intermediate unsigned: a negative n would index past the alphabet
  let n = ((source >>> 0) ^ 0x5bd1e995) >>> 0;
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += SEED_ALPHABET[n % SEED_ALPHABET.length];
    n = (Math.floor(n / SEED_ALPHABET.length) ^ Math.imul(n, 0x9e3779b1)) >>> 0;
  }
  return `NS-${out.slice(0, 3)}-${out.slice(3)}`;
}

export function normalizeSeedCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return makeSeedCode(1);
  const body = cleaned.startsWith('NS') ? cleaned.slice(2) : cleaned;
  const padded = (body + 'AAAAAA').slice(0, 6);
  return `NS-${padded.slice(0, 3)}-${padded.slice(3)}`;
}

/**
 * Hidden scenario for a seed. Weighted so that 'mixed' and 'psychological' are the
 * most common, keeping the truth ambiguous across replays.
 */
export function scenarioForSeed(seedCode: string): ScenarioType {
  const r = new RNG(`${seedCode}:scenario`);
  return r.weighted<ScenarioType>([
    { item: 'grounded', weight: 22 },
    { item: 'psychological', weight: 26 },
    { item: 'supernatural', weight: 24 },
    { item: 'mixed', weight: 28 },
  ]);
}
