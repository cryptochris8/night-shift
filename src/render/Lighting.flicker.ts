/**
 * Fluorescent-ballast behaviour for the lighting system: irregular flicker, strike-on
 * envelopes, dying fade and the blackout stutter. Pure logic (no three / DOM) so it can
 * be unit-tested and stays deterministic per seed through the injected RNG.
 */
import type { RNG } from '../core/rng';

/** Integer → [0,1) hash (xorshift-multiply). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x5bd1e995;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep01(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

/** Exponential approach with time constant `tau` (seconds); frame-rate independent. */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Smooth 1-D value noise in [0,1]; roughly one feature per unit of t. */
export class ValueNoise1D {
  constructor(private readonly seed: number) {}

  at(t: number): number {
    const i = Math.floor(t);
    const f = t - i;
    const a = hash01(i * 7919 + this.seed);
    const b = hash01((i + 1) * 7919 + this.seed);
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
}

export interface FlickerSample {
  /** multiplier 0..1 (can briefly exceed 1 by a hair during recovery) */
  level: number;
  /** a visible drop began this step (hook for a 'light_flicker' tick) */
  dropped: boolean;
}

interface Segment {
  dur: number;
  level: number;
  ramp: boolean;
  /** >0 → fast low-amplitude jitter around 1 instead of a fixed level */
  jitter: number;
}

/**
 * Irregular fluorescent flicker. Not a strobe: long stable stretches broken by brief
 * drops, short bursts (a ballast trying to re-strike), slow sags and buzzy jitter.
 * `intensity` scales depth and frequency; `reduced` (accessibility) makes everything
 * shallower, rarer and ramped instead of stepped.
 */
export class BallastFlicker {
  private wait: number;
  private readonly segs: Segment[] = [];
  private segT = 0;
  private out = 1;
  private clock = 0;
  private readonly noise: ValueNoise1D;

  constructor(private readonly rng: RNG) {
    this.noise = new ValueNoise1D(Math.floor(rng.next() * 1e6));
    this.wait = rng.range(0.1, 0.8);
  }

  reset(): void {
    this.segs.length = 0;
    this.segT = 0;
    this.out = 1;
    this.wait = this.rng.range(0.1, 0.8);
  }

  step(dt: number, intensity = 1, reduced = false): FlickerSample {
    this.clock += dt;
    const k = clamp01(intensity);
    let dropped = false;

    if (this.segs.length === 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        this.schedule(k, reduced);
        this.segT = 0;
        if (this.segs.length > 0 && this.segs[0].jitter === 0 && this.segs[0].level < 0.5) dropped = true;
      }
    }

    // stable state: a faint 2–3 % flutter so even "steady" flicker-mode light breathes
    let target = 1 - 0.03 * k * this.noise.at(this.clock * 9);
    let ramp = reduced;

    if (this.segs.length > 0) {
      const seg = this.segs[0];
      target = seg.jitter > 0 ? 1 - seg.jitter * (0.5 + 0.5 * this.noise.at(this.clock * 23)) : seg.level;
      ramp = ramp || seg.ramp;
      this.segT += dt;
      if (this.segT >= seg.dur) {
        this.segT -= seg.dur;
        this.segs.shift();
        const next = this.segs[0];
        if (next && next.jitter === 0 && next.level < 0.5) dropped = true;
        if (this.segs.length === 0) this.wait = this.gap(k, reduced);
      }
    }

    this.out = ramp ? approach(this.out, target, dt, 0.035) : target;
    return { level: this.out, dropped };
  }

  private gap(k: number, reduced: boolean): number {
    const mean = (2.2 - 1.6 * k) * (reduced ? 2.4 : 1);
    return mean * (0.35 + this.rng.next() * 1.5);
  }

  private schedule(k: number, reduced: boolean): void {
    const rng = this.rng;
    const r = rng.next();
    const push = (dur: number, level: number, ramp = false, jitter = 0): void => {
      this.segs.push({ dur, level, ramp, jitter });
    };
    if (r < 0.4) {
      // single drop
      let low = 0.45 - 0.39 * k;
      if (reduced) low = Math.max(low, 0.55);
      push(rng.range(0.04, 0.14) * (reduced ? 1.6 : 1), low, reduced);
    } else if (r < 0.65) {
      // burst: the ballast hunting for an arc
      const n = reduced ? 2 : rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const low = reduced ? rng.range(0.55, 0.7) : rng.range(0.08, 0.4);
        push(rng.range(0.03, 0.08), low, reduced);
        push(rng.range(0.05, 0.16), rng.range(0.7, 1), reduced);
      }
    } else if (r < 0.85) {
      // slow sag and recovery (brown-out feel)
      push(rng.range(0.25, 0.6), rng.range(0.5, 0.75) + (reduced ? 0.15 : 0), true);
    } else {
      // buzz: quick low-amplitude jitter, never below 0.78
      push(rng.range(0.3, 0.8), 1, false, (reduced ? 0.06 : 0.22) * (0.5 + 0.5 * k));
    }
  }
}

export type StrikeKind = 'fluorescent' | 'snap' | 'quick' | 'warm';

export interface StrikeSample {
  level: number;
  done: boolean;
  /** 0..1 progress of the envelope (used for sodium warm-up colour) */
  progress: number;
}

/**
 * Turn-on envelope. Fluorescent: dark, one to three partial flashes, then on with a
 * small overshoot. Snap: halogen/LED emergency head with a hot overshoot. Quick: short
 * ramp (glows, task strips). Warm: sodium warm-up from a deep orange ember.
 */
export class StrikeEnvelope {
  private t = 0;
  private readonly segs: { until: number; level: number }[] = [];
  private readonly total: number;

  constructor(rng: RNG, readonly kind: StrikeKind, private readonly delay = 0) {
    if (kind === 'fluorescent') {
      let t = delay + rng.range(0.02, 0.1);
      this.segs.push({ until: t, level: 0 });
      const flashes = rng.chance(0.3) ? 0 : rng.int(1, 3);
      for (let i = 0; i < flashes; i++) {
        t += rng.range(0.04, 0.09);
        this.segs.push({ until: t, level: rng.range(0.25, 0.7) });
        t += rng.range(0.06, 0.18);
        this.segs.push({ until: t, level: rng.range(0, 0.05) });
      }
      t += 0.08;
      this.segs.push({ until: t, level: 1.08 });
      this.total = t;
    } else if (kind === 'snap') {
      this.total = delay + 0.4;
    } else if (kind === 'quick') {
      this.total = delay + 0.08;
    } else {
      this.total = delay + 3.5;
    }
  }

  step(dt: number): StrikeSample {
    this.t += dt;
    const t = this.t;
    const done = t >= this.total;
    const local = Math.max(0, t - this.delay);
    const span = Math.max(1e-3, this.total - this.delay);
    const progress = clamp01(local / span);
    if (t < this.delay) return { level: 0, done: false, progress: 0 };
    switch (this.kind) {
      case 'fluorescent': {
        if (done) return { level: 1, done, progress: 1 };
        for (const s of this.segs) if (t < s.until) return { level: s.level, done: false, progress };
        return { level: 1, done: true, progress: 1 };
      }
      case 'snap':
        return { level: 1 + 0.35 * Math.exp(-local / 0.07), done, progress };
      case 'quick':
        return { level: Math.min(1, local / 0.08), done, progress };
      case 'warm':
      default:
        return { level: 0.12 + 0.88 * smoothstep01(local / 3.5), done, progress };
    }
  }
}

/**
 * Level of a dying fixture. `u` = 0..1 progress of the fade; n1/n2 are smooth noise
 * samples in [0,1]. Sputters get more frequent as the tube gives up.
 */
export function dyingLevel(u: number, n1: number, n2: number): number {
  const x = clamp01(u);
  const base = Math.pow(1 - x, 1.35) * (0.78 + 0.22 * n1);
  const gate = 0.84 - 0.25 * x;
  return n2 > gate ? base * 0.12 : base;
}

/** Wing-wide stutter for the first 0.3 s of a blackout, then the lights die. */
export function blackoutStutter(t: number): number {
  if (t < 0.05) return 1;
  if (t < 0.09) return 0.15;
  if (t < 0.16) return 0.92;
  if (t < 0.21) return 0.08;
  if (t < 0.3) return 0.75;
  return 1;
}

/** Smooth bump 0→1→0 over u∈[0,1], used for brown-outs and sags. */
export function bump(u: number): number {
  const x = clamp01(u);
  return Math.pow(Math.sin(Math.PI * x), 0.7);
}
