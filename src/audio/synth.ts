/**
 * NIGHT SHIFT — Web Audio synthesis toolkit + every one-shot sound effect.
 * No audio files anywhere: noise banks, impulse responses and all 93 `SfxName`s are
 * rendered from oscillators, filtered noise and envelopes. Each builder schedules its
 * nodes relative to `s.t0`, connects to `s.out`, registers every source in `s.sources`
 * (so the engine can stop it) and returns its duration in seconds (Infinity = sustained).
 */
import type { SfxName } from '../core/contracts';
import type { RNG } from '../core/rng';

export type NoiseKind = 'white' | 'pink' | 'brown';
export interface NoiseBank { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer }

export interface SynthCtx {
  readonly ctx: BaseAudioContext;
  /** where the sound connects (per-voice gain owned by the engine) */
  readonly out: AudioNode;
  /** absolute context time the sound starts */
  readonly t0: number;
  readonly rng: RNG;
  readonly noise: NoiseBank;
  /** pitch/speed multiplier from SfxOptions.rate */
  readonly rate: number;
  /** caller asked for a sustained version (continuous sounds return Infinity) */
  readonly loop: boolean;
  readonly sources: AudioScheduledSourceNode[];
}

/** Returns the duration in seconds (Infinity when sustained until stopped). */
export type SfxBuilder = (s: SynthCtx) => number;

export type BusName = 'ambience' | 'sfx' | 'music' | 'ui' | 'body';
export interface SfxMeta {
  bus: BusName;
  /** reverb send 0..1 */
  wet: number;
  /** base gain */
  vol: number;
  /** 1 = steal-able first (footsteps/ui), 3 = never stolen (stings, loops the story relies on) */
  priority: 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Noise bank (rendered once per context) + impulse responses
// ---------------------------------------------------------------------------

export function makeNoiseBank(ctx: BaseAudioContext, rng: RNG): NoiseBank {
  const sr = ctx.sampleRate;
  const make = (seconds: number, fill: (d: Float32Array) => void): AudioBuffer => {
    const buf = ctx.createBuffer(1, Math.floor(sr * seconds), sr);
    const d = buf.getChannelData(0);
    fill(d);
    return buf;
  };
  const white = make(2, (d) => {
    for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
  });
  // Paul Kellet's refined pink filter
  const pink = make(3, (d) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rng.next() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  });
  const brown = make(4, (d) => {
    let last = 0;
    let peak = 0;
    for (let i = 0; i < d.length; i++) {
      const w = rng.next() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    const k = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < d.length; i++) d[i] *= k;
  });
  return { white, pink, brown };
}

export type ReverbClass = 'small_room' | 'corridor' | 'hall' | 'outdoors';

interface IRSpec {
  seconds: number;
  /** exponential decay time constant (s) */
  tau: number;
  /** early reflection taps: [delay s, gain] */
  early: [number, number][];
  /** one-pole lowpass coefficient per sample of tail (0 = none) — darkens the tail */
  damp: number;
  /** comb period for flutter echo (corridors), 0 = none */
  flutter: number;
  level: number;
}

const IR_SPECS: Record<ReverbClass, IRSpec> = {
  small_room: { seconds: 0.7, tau: 0.13, early: [[0.004, 0.7], [0.009, 0.5], [0.014, 0.45], [0.021, 0.3], [0.028, 0.25]], damp: 0.35, flutter: 0, level: 0.55 },
  corridor: { seconds: 1.9, tau: 0.42, early: [[0.008, 0.6], [0.017, 0.5], [0.025, 0.35], [0.041, 0.3]], damp: 0.55, flutter: 0.0164, level: 0.5 },
  hall: { seconds: 2.8, tau: 0.75, early: [[0.011, 0.5], [0.023, 0.45], [0.037, 0.4], [0.052, 0.3], [0.071, 0.25]], damp: 0.3, flutter: 0, level: 0.5 },
  outdoors: { seconds: 1.1, tau: 0.22, early: [[0.038, 0.35], [0.067, 0.2], [0.11, 0.12]], damp: 0.7, flutter: 0, level: 0.3 },
};

export function makeImpulseResponse(ctx: BaseAudioContext, cls: ReverbClass, rng: RNG): AudioBuffer {
  const spec = IR_SPECS[cls];
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * spec.seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    const flutterN = spec.flutter ? Math.floor(spec.flutter * sr * (ch ? 1.03 : 1)) : 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t / spec.tau) * (1 - Math.exp(-t / 0.004));
      let v = (rng.next() * 2 - 1) * env;
      // tail darkening: progressively heavier one-pole lowpass
      const k = spec.damp * Math.min(1, t / spec.seconds) * 0.9;
      lp = lp + (v - lp) * (1 - k);
      v = lp;
      if (flutterN && i >= flutterN) v += d[i - flutterN] * 0.42;
      d[i] = v;
    }
    for (const [delay, g] of spec.early) {
      const idx = Math.floor(delay * sr * (ch ? 1.02 : 0.98));
      if (idx < n) d[idx] += g * (rng.next() > 0.5 ? 1 : -1);
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak > 0 ? spec.level / peak : 1;
    for (let i = 0; i < n; i++) d[i] *= norm;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Toolkit
// ---------------------------------------------------------------------------

type Pt = readonly [number, number];

function reg<T extends AudioScheduledSourceNode>(s: SynthCtx, node: T, start: number, stop?: number): T {
  node.start(s.t0 + Math.max(0, start));
  if (stop !== undefined && Number.isFinite(stop)) node.stop(s.t0 + Math.max(start, stop) + 0.03);
  track(s, node);
  return node;
}

/** Register a source with the voice; ended sources drop out so long loops do not accumulate references. */
function track(s: SynthCtx, node: AudioScheduledSourceNode): void {
  s.sources.push(node);
  node.onended = () => {
    const i = s.sources.indexOf(node);
    if (i >= 0) s.sources.splice(i, 1);
    try { node.disconnect(); } catch { /* already disconnected */ }
  };
}

export function osc(s: SynthCtx, type: OscillatorType, freq: number, start: number, stop?: number, detune = 0): OscillatorNode {
  const o = new OscillatorNode(s.ctx, { type, frequency: freq * s.rate, detune });
  return reg(s, o, start, stop);
}

export function noise(s: SynthCtx, kind: NoiseKind, start: number, stop?: number, rate = 1): AudioBufferSourceNode {
  const buf = s.noise[kind];
  const n = new AudioBufferSourceNode(s.ctx, { buffer: buf, loop: true, playbackRate: rate });
  n.loopStart = 0;
  n.loopEnd = buf.duration;
  const offset = s.rng.next() * (buf.duration - 0.1);
  n.start(s.t0 + Math.max(0, start), offset);
  if (stop !== undefined && Number.isFinite(stop)) n.stop(s.t0 + Math.max(start, stop) + 0.03);
  track(s, n);
  return n;
}

export function filter(s: SynthCtx, type: BiquadFilterType, freq: number, q = 1, gainDb = 0): BiquadFilterNode {
  return new BiquadFilterNode(s.ctx, { type, frequency: Math.min(20000, Math.max(10, freq)), Q: q, gain: gainDb });
}

export function gain(s: SynthCtx, v: number): GainNode {
  return new GainNode(s.ctx, { gain: v });
}

/** Connect nodes in series. Only the LAST element may be an AudioParam (modulation target). */
export function chain(...nodes: [AudioNode, ...(AudioNode | AudioParam)[]]): void {
  for (let i = 0; i < nodes.length - 1; i++) {
    const from = nodes[i];
    const to = nodes[i + 1];
    if (!(from instanceof AudioNode)) throw new Error('chain: an AudioParam can only be the final element');
    if (to instanceof AudioNode) from.connect(to);
    else from.connect(to);
  }
}

/** Piecewise envelope: points are [offset seconds, value] relative to `t0`. */
export function ramp(param: AudioParam, t0: number, pts: readonly Pt[], exp = false): void {
  if (!pts.length) return;
  param.setValueAtTime(exp ? Math.max(1e-4, pts[0][1]) : pts[0][1], t0 + pts[0][0]);
  for (let i = 1; i < pts.length; i++) {
    const [t, v] = pts[i];
    if (exp) param.exponentialRampToValueAtTime(Math.max(1e-4, v), t0 + t);
    else param.linearRampToValueAtTime(v, t0 + t);
  }
}

/** Attack/decay/sustain/release gain node. `hold` = time at sustain. Returns the node (connect it yourself). */
export function adsr(s: SynthCtx, start: number, a: number, d: number, sus: number, r: number, hold: number, peak = 1): GainNode {
  const g = gain(s, 0);
  const t = s.t0 + start;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.linearRampToValueAtTime(peak * sus, t + a + d);
  g.gain.setValueAtTime(peak * sus, t + a + d + hold);
  g.gain.linearRampToValueAtTime(0, t + a + d + hold + r);
  return g;
}

/** Simple filtered noise burst with a percussive envelope, straight to `s.out`. */
export function burst(s: SynthCtx, o: { kind?: NoiseKind; at: number; dur: number; vol: number; type?: BiquadFilterType; freq: number; q?: number; attack?: number; hp?: number; rate?: number }): void {
  const n = noise(s, o.kind ?? 'white', o.at, o.at + o.dur, o.rate ?? 1);
  const f = filter(s, o.type ?? 'bandpass', o.freq, o.q ?? 1.2);
  const g = gain(s, 0);
  // keep the envelope strictly monotonic in time even for very short bursts
  const a = Math.min(o.attack ?? 0.004, o.dur * 0.3);
  const mid = Math.min(o.dur * 0.8, Math.max(a + 0.001, o.dur * 0.35));
  ramp(g.gain, s.t0 + o.at, [[0, 0], [a, o.vol], [mid, o.vol * 0.35], [o.dur, 0]]);
  if (o.hp) chain(n, f, filter(s, 'highpass', o.hp), g, s.out);
  else chain(n, f, g, s.out);
}

/** Short sine with a fast decay (clicks, ticks, chimes). */
export function ping(s: SynthCtx, o: { at: number; freq: number; dur: number; vol: number; type?: OscillatorType; to?: number; attack?: number }): void {
  const w = osc(s, o.type ?? 'sine', o.freq, o.at, o.at + o.dur);
  if (o.to !== undefined) ramp(w.frequency, s.t0 + o.at, [[0, o.freq * s.rate], [o.dur, o.to * s.rate]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + o.at, [[0, 0], [Math.min(o.attack ?? 0.003, o.dur * 0.5), o.vol], [o.dur, 0]], false);
  chain(w, g, s.out);
}

/** Pitch-dropping sine thump (doors, drops, footfalls). */
export function thump(s: SynthCtx, at: number, f0: number, f1: number, dur: number, vol: number): void {
  const w = osc(s, 'sine', f0, at, at + dur);
  ramp(w.frequency, s.t0 + at, [[0, f0 * s.rate], [dur, f1 * s.rate]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + at, [[0, 0], [0.006, vol], [dur * 0.4, vol * 0.3], [dur, 0]]);
  chain(w, g, s.out);
}

/** Tiny transient click. */
export function click(s: SynthCtx, at: number, vol: number, freq = 2500, dur = 0.012): void {
  burst(s, { at, dur, vol, freq, q: 0.8, attack: 0.001 });
}

/** Formant table for voice-like sounds. */
const VOWELS: Record<string, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  m: [250, 1000, 2500],
  n: [300, 1300, 2600],
};
const VOWEL_KEYS = Object.keys(VOWELS);

/**
 * Voice-like murmur (no words): glottal sawtooth (or breath noise when whispering)
 * through three moving formant bandpasses with syllabic amplitude.
 */
export function murmurBuilder(seconds: number, pitchHz = 135, whisper = false, level = 1): SfxBuilder {
  return (s) => {
    const r = s.rng;
    const total = Math.max(0.3, seconds);
    const f0 = pitchHz * (0.92 + r.next() * 0.16);
    const mix = gain(s, 0);
    const formants = [8, 10, 12].map((q, i) => {
      const f = filter(s, 'bandpass', VOWELS.a[i], q);
      const g = gain(s, [1, 0.55, 0.22][i]);
      f.connect(g);
      g.connect(mix);
      return f;
    });
    let exc: AudioNode;
    if (whisper) {
      exc = noise(s, 'white', 0, total + 0.1);
    } else {
      const saw = osc(s, 'sawtooth', f0, 0, total + 0.1);
      // vibrato + drift
      const lfo = osc(s, 'sine', 5.2 + r.next(), 0, total + 0.1);
      const lg = gain(s, f0 * 0.012);
      chain(lfo, lg, saw.frequency);
      let t = 0;
      saw.frequency.setValueAtTime(f0, s.t0);
      while (t < total) {
        t += 0.12 + r.next() * 0.2;
        saw.frequency.linearRampToValueAtTime(f0 * (0.9 + r.next() * 0.22), s.t0 + Math.min(total, t));
      }
      const breath = noise(s, 'pink', 0, total + 0.1);
      const bg = gain(s, 0.12);
      chain(breath, bg);
      for (const f of formants) bg.connect(f);
      exc = saw;
    }
    const pre = gain(s, whisper ? 0.9 : 0.35);
    exc.connect(pre);
    for (const f of formants) pre.connect(f);
    // syllables
    let t = 0.02;
    mix.gain.setValueAtTime(0, s.t0);
    while (t < total - 0.02) {
      // every syllable is clamped to `total` so the closing ramp below stays last in time
      const syl = Math.min(0.14 + r.next() * 0.18, total - t);
      const v = VOWELS[r.pick(VOWEL_KEYS)];
      formants.forEach((f, i) => f.frequency.linearRampToValueAtTime(v[i] * (0.95 + r.next() * 0.1), s.t0 + t + syl * 0.4));
      const amp = (0.5 + r.next() * 0.5) * level * (whisper ? 0.5 : 1);
      mix.gain.linearRampToValueAtTime(amp, s.t0 + t + Math.min(0.04, syl * 0.4));
      mix.gain.linearRampToValueAtTime(amp * 0.55, s.t0 + t + syl * 0.75);
      t += syl;
      if (r.chance(0.3) && t < total - 0.05) {
        // word gap
        mix.gain.linearRampToValueAtTime(0, s.t0 + t + 0.04);
        t += 0.12 + r.next() * 0.25;
      }
    }
    mix.gain.linearRampToValueAtTime(0, s.t0 + total + 0.08);
    chain(mix, filter(s, 'lowpass', whisper ? 6000 : 3400, 0.7), s.out);
    return total + 0.15;
  };
}

/** A formant "name call": 2–3 vowel syllables with a falling-then-rising contour, like someone calling from a hallway. */
function nameCall(s: SynthCtx): number {
  const r = s.rng;
  const f0 = 165 * (0.9 + r.next() * 0.2);
  const saw = osc(s, 'sawtooth', f0, 0, 1.1);
  const mix = gain(s, 0);
  const seq: [string, number][] = [['o', 0.3], ['a', 0.25], ['n', 0.3]];
  const formants = [9, 11, 13].map((q, i) => {
    const f = filter(s, 'bandpass', VOWELS.o[i], q);
    const g = gain(s, [1, 0.5, 0.2][i]);
    chain(saw, f, g, mix);
    return f;
  });
  let t = 0.05;
  saw.frequency.setValueAtTime(f0 * 1.08, s.t0);
  saw.frequency.linearRampToValueAtTime(f0 * 0.96, s.t0 + 0.4);
  saw.frequency.linearRampToValueAtTime(f0 * 1.12, s.t0 + 0.75);
  saw.frequency.linearRampToValueAtTime(f0 * 0.9, s.t0 + 1.0);
  mix.gain.setValueAtTime(0, s.t0);
  for (const [vk, dur] of seq) {
    const v = VOWELS[vk];
    formants.forEach((f, i) => f.frequency.linearRampToValueAtTime(v[i], s.t0 + t + dur * 0.35));
    mix.gain.linearRampToValueAtTime(vk === 'n' ? 0.35 : 0.6, s.t0 + t + 0.05);
    mix.gain.linearRampToValueAtTime(0.3, s.t0 + t + dur);
    t += dur;
  }
  mix.gain.linearRampToValueAtTime(0, s.t0 + t + 0.12);
  chain(mix, filter(s, 'lowpass', 2800), filter(s, 'highshelf', 2000, 1, -6), s.out);
  return 1.15;
}

// ---------------------------------------------------------------------------
// Builders — every SfxName
// ---------------------------------------------------------------------------

function footstepTile(s: SynthCtx): number {
  const r = s.rng;
  const toe = 0.085 + r.range(-0.015, 0.025);
  burst(s, { at: 0, dur: 0.055, vol: 0.55, freq: 1200 * (0.9 + r.next() * 0.2), q: 2.6, hp: 380 });
  burst(s, { at: toe, dur: 0.045, vol: 0.38, freq: 1600 * (0.9 + r.next() * 0.2), q: 2.2, hp: 500 });
  thump(s, 0, 160, 90, 0.05, 0.12);
  if (r.chance(0.1)) ping(s, { at: toe + 0.02, freq: 2200, to: 3100, dur: 0.08, vol: 0.045, attack: 0.02 });
  return 0.22;
}

function footstepConcrete(s: SynthCtx): number {
  const r = s.rng;
  const toe = 0.09 + r.range(-0.01, 0.03);
  burst(s, { kind: 'pink', at: 0, dur: 0.07, vol: 0.6, freq: 520 * (0.9 + r.next() * 0.2), q: 1.1, hp: 160 });
  burst(s, { kind: 'pink', at: toe, dur: 0.05, vol: 0.35, freq: 760, q: 1.3, hp: 200 });
  thump(s, 0, 130, 70, 0.07, 0.2);
  if (r.chance(0.25)) burst(s, { at: toe + 0.03, dur: 0.03, vol: 0.08, freq: 3200, q: 1.5 }); // grit
  return 0.24;
}

function footstepWet(s: SynthCtx): number {
  const r = s.rng;
  footstepTile(s);
  // squelch: downward sweeping bandpass
  const n = noise(s, 'pink', 0.01, 0.16);
  const f = filter(s, 'bandpass', 3000, 1.4);
  ramp(f.frequency, s.t0 + 0.01, [[0, 3000], [0.14, 800]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.01, [[0, 0], [0.02, 0.32], [0.14, 0]]);
  chain(n, f, filter(s, 'highpass', 900), g, s.out);
  for (let i = 0; i < 3; i++) ping(s, { at: 0.06 + r.next() * 0.12, freq: 2400 + r.next() * 1800, to: 1200, dur: 0.03, vol: 0.05 });
  return 0.25;
}

function hingeSweep(s: SynthCtx, at: number, dur: number, f0: number, f1: number, vol: number): void {
  const n = noise(s, 'pink', at, at + dur);
  const f = filter(s, 'bandpass', f0, 3);
  ramp(f.frequency, s.t0 + at, [[0, f0], [dur, f1]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + at, [[0, 0], [dur * 0.3, vol], [dur, 0]]);
  chain(n, f, g, s.out);
  // faint creaking tone with jitter
  const o = osc(s, 'sawtooth', 170, at, at + dur);
  for (let i = 0; i <= 6; i++) o.frequency.linearRampToValueAtTime(150 + s.rng.next() * 60, s.t0 + at + (dur * i) / 6);
  const og = gain(s, 0);
  ramp(og.gain, s.t0 + at, [[0, 0], [dur * 0.4, vol * 0.1], [dur, 0]]);
  chain(o, filter(s, 'bandpass', 900, 2), og, s.out);
}

function doorOpen(s: SynthCtx): number {
  thump(s, 0, 95, 50, 0.14, 0.45);
  burst(s, { kind: 'brown', at: 0, dur: 0.1, vol: 0.3, type: 'lowpass', freq: 300 });
  hingeSweep(s, 0.08, 0.42, 600, 1400, 0.16);
  click(s, 0.5, 0.18, 2200);
  click(s, 0.53, 0.1, 3400, 0.008);
  return 0.62;
}

function doorClose(s: SynthCtx): number {
  click(s, 0, 0.14, 2600);
  hingeSweep(s, 0.02, 0.26, 1300, 700, 0.1);
  thump(s, 0.3, 110, 48, 0.18, 0.6);
  burst(s, { kind: 'brown', at: 0.3, dur: 0.16, vol: 0.45, type: 'lowpass', freq: 220 });
  click(s, 0.34, 0.22, 1900, 0.015);
  return 0.6;
}

function doorLocked(s: SynthCtx): number {
  const r = s.rng;
  let t = 0;
  for (let i = 0; i < 4; i++) {
    burst(s, { at: t, dur: 0.02, vol: 0.3, freq: 2500 + r.next() * 800, q: 4 });
    ping(s, { at: t, freq: 185, dur: 0.05, vol: 0.2, type: 'triangle' });
    t += 0.07 + r.next() * 0.05;
  }
  burst(s, { kind: 'pink', at: 0.02, dur: 0.3, vol: 0.1, freq: 1800, q: 0.8 });
  thump(s, 0.3, 90, 60, 0.08, 0.2);
  return 0.5;
}

function doorSlam(s: SynthCtx): number {
  thump(s, 0, 75, 34, 0.22, 0.9);
  burst(s, { kind: 'brown', at: 0, dur: 0.14, vol: 0.9, type: 'lowpass', freq: 1800 });
  click(s, 0.004, 0.5, 1600, 0.02);
  burst(s, { at: 0.01, dur: 0.06, vol: 0.25, freq: 3200, q: 1 });
  return 0.5;
}

function doorCreak(s: SynthCtx): number {
  const r = s.rng;
  const dur = 1.35;
  const o = osc(s, 'sawtooth', 95, 0, dur);
  let f = 95;
  for (let i = 0; i <= 14; i++) {
    f = Math.max(60, Math.min(200, f + (r.next() - 0.45) * 28));
    o.frequency.linearRampToValueAtTime(f, s.t0 + (dur * i) / 14);
  }
  const g = gain(s, 0);
  const pts: Pt[] = [[0, 0]];
  for (let i = 1; i <= 10; i++) pts.push([(dur * i) / 11, r.chance(0.3) ? 0.02 : 0.1 + r.next() * 0.12]);
  pts.push([dur, 0]);
  ramp(g.gain, s.t0, pts);
  chain(o, filter(s, 'bandpass', 700, 1.8), g, s.out);
  const n = noise(s, 'pink', 0, dur);
  const ng = gain(s, 0);
  ramp(ng.gain, s.t0, [[0, 0], [0.3, 0.05], [dur, 0]]);
  chain(n, filter(s, 'bandpass', 2200, 2), ng, s.out);
  return dur + 0.1;
}

function badgeOk(s: SynthCtx): number {
  ping(s, { at: 0, freq: 1800, dur: 0.07, vol: 0.3 });
  ping(s, { at: 0.09, freq: 2400, dur: 0.1, vol: 0.3 });
  click(s, 0.22, 0.15, 1200, 0.02);
  return 0.32;
}

function badgeDeny(s: SynthCtx): number {
  for (let i = 0; i < 3; i++) {
    const w = osc(s, 'square', 440, i * 0.15, i * 0.15 + 0.09);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + i * 0.15, [[0, 0], [0.005, 0.18], [0.07, 0.15], [0.09, 0]]);
    chain(w, filter(s, 'lowpass', 1800), g, s.out);
  }
  return 0.5;
}

function cartRoll(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 2.8;
  const stop = s.loop ? undefined : dur;
  const n = noise(s, 'brown', 0, stop);
  const g = gain(s, 0);
  if (s.loop) ramp(g.gain, s.t0, [[0, 0], [0.4, 0.5]]);
  else ramp(g.gain, s.t0, [[0, 0], [0.4, 0.5], [2.2, 0.45], [2.8, 0]]);
  chain(n, filter(s, 'bandpass', 230, 1.1), g, s.out);
  // squeaky wheel, amplitude-modulated by the wheel rotation
  const sq = osc(s, 'sine', 1750 + r.next() * 300, 0, stop);
  const am = osc(s, 'sine', 2.1 + r.next() * 0.4, 0, stop);
  const amg = gain(s, 0.5);
  const sqg = gain(s, 0.5);
  chain(am, amg, sqg.gain);
  const env = gain(s, 0);
  if (s.loop) ramp(env.gain, s.t0, [[0, 0], [0.5, 0.05]]);
  else ramp(env.gain, s.t0, [[0, 0], [0.5, 0.05], [2.3, 0.04], [2.8, 0]]);
  chain(sq, sqg, env, s.out);
  const count = s.loop ? 8 : 5;
  for (let i = 0; i < count; i++) click(s, r.next() * (s.loop ? 4 : 2.6), 0.06, 1400 + r.next() * 1500, 0.01);
  return dur;
}

function wheelchair(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 2.3;
  const stop = s.loop ? undefined : dur;
  const n = noise(s, 'pink', 0, stop);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [0.3, 0.22]] : [[0, 0], [0.3, 0.22], [1.9, 0.2], [2.3, 0]]);
  chain(n, filter(s, 'bandpass', 340, 1), g, s.out);
  const sq = osc(s, 'sine', 1100 + r.next() * 200, 0, stop);
  const am = osc(s, 'sine', 1.6, 0, stop);
  const amg = gain(s, 0.5);
  const sqg = gain(s, 0.5);
  chain(am, amg, sqg.gain);
  const env = gain(s, 0);
  ramp(env.gain, s.t0, s.loop ? [[0, 0], [0.4, 0.03]] : [[0, 0], [0.4, 0.03], [2.0, 0.025], [2.3, 0]]);
  chain(sq, sqg, env, s.out);
  return dur;
}

function curtain(s: SynthCtx): number {
  const r = s.rng;
  const hooks = 6 + r.int(0, 4);
  for (let i = 0; i < hooks; i++) {
    const t = (i / hooks) * 0.6 + r.next() * 0.04;
    ping(s, { at: t, freq: 3000 + r.next() * 900, dur: 0.03, vol: 0.09, type: 'triangle' });
  }
  burst(s, { kind: 'pink', at: 0, dur: 0.6, vol: 0.2, freq: 900, q: 0.7, attack: 0.08 });
  return 0.75;
}

function bedRail(s: SynthCtx): number {
  for (const [f, v, d] of [[420, 0.3, 0.45], [1150, 0.2, 0.3], [2900, 0.12, 0.2]] as const) ping(s, { at: 0, freq: f, dur: d, vol: v, type: 'triangle' });
  click(s, 0, 0.3, 2000, 0.015);
  thump(s, 0, 160, 90, 0.08, 0.2);
  return 0.5;
}

function monitorBeep(s: SynthCtx): number {
  const w = osc(s, 'sine', 880, 0, 0.07);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.008, 0.25], [0.045, 0.22], [0.065, 0]]);
  chain(w, g, s.out);
  return 0.1;
}

function monitorAlarm(s: SynthCtx): number {
  const periods = s.loop ? 4 : 3;
  for (let p = 0; p < periods; p++) {
    for (let i = 0; i < 3; i++) {
      const at = p * 0.62 + i * 0.13;
      const w = osc(s, 'triangle', 1400, at, at + 0.09);
      const g = gain(s, 0);
      ramp(g.gain, s.t0 + at, [[0, 0], [0.005, 0.3], [0.08, 0.26], [0.09, 0]]);
      chain(w, g, s.out);
    }
  }
  return periods * 0.62;
}

function monitorFlat(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 3.2;
  const w = osc(s, 'sine', 1000, 0, s.loop ? undefined : dur);
  const g = gain(s, 0);
  if (s.loop) ramp(g.gain, s.t0, [[0, 0], [0.01, 0.22]]);
  else ramp(g.gain, s.t0, [[0, 0], [0.01, 0.22], [3.0, 0.2], [3.2, 0]]);
  chain(w, filter(s, 'lowpass', 4000), g, s.out);
  return dur;
}

function monitorOff(s: SynthCtx): number {
  ping(s, { at: 0, freq: 900, to: 180, dur: 0.14, vol: 0.2 });
  click(s, 0.02, 0.2, 1500, 0.02);
  ping(s, { at: 0.05, freq: 3200, to: 2400, dur: 0.4, vol: 0.03 });
  return 0.5;
}

function intercomClick(s: SynthCtx): number {
  burst(s, { at: 0, dur: 0.015, vol: 0.5, type: 'lowpass', freq: 1200, attack: 0.001 });
  const hum = osc(s, 'sine', 120, 0.01, 0.26);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.01, [[0, 0], [0.02, 0.08], [0.25, 0]]);
  chain(hum, g, s.out);
  burst(s, { at: 0.01, dur: 0.25, vol: 0.05, freq: 1800, q: 0.5, attack: 0.02 });
  return 0.3;
}

function paTone(s: SynthCtx, at: number, freq: number, dur: number, vol: number): void {
  const w = osc(s, 'sine', freq, at, at + dur);
  const h = osc(s, 'triangle', freq * 2, at, at + dur);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + at, [[0, 0], [0.02, vol], [dur * 0.8, vol * 0.5], [dur, 0]]);
  const hg = gain(s, 0.15);
  h.connect(hg);
  hg.connect(g);
  w.connect(g);
  chain(g, filter(s, 'highpass', 300), filter(s, 'lowpass', 3400), s.out);
}

function intercomChime(s: SynthCtx): number {
  paTone(s, 0, 660, 0.4, 0.22);
  paTone(s, 0.3, 880, 0.55, 0.2);
  return 0.95;
}

function intercomStatic(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 0.85;
  const n = noise(s, 'white', 0, s.loop ? undefined : dur);
  const g = gain(s, 0);
  if (s.loop) ramp(g.gain, s.t0, [[0, 0], [0.05, 0.18]]);
  else {
    const pts: Pt[] = [[0, 0], [0.02, 0.2]];
    for (let i = 1; i < 8; i++) pts.push([(i / 8) * 0.8, 0.1 + r.next() * 0.15]);
    pts.push([0.85, 0]);
    ramp(g.gain, s.t0, pts);
  }
  chain(n, filter(s, 'highpass', 300), filter(s, 'lowpass', 3400), g, s.out);
  for (let i = 0; i < 4; i++) click(s, r.next() * 0.8, 0.12, 2000 + r.next() * 1500, 0.006);
  return dur;
}

function elevatorTone(s: SynthCtx): number {
  for (const [at, f] of [[0, 784], [0.5, 659]] as const) {
    const w = osc(s, 'sine', f, at, at + 1.3);
    const h = osc(s, 'sine', f * 2.01, at, at + 0.9);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + at, [[0, 0], [0.01, 0.3], [1.3, 0]], false);
    const hg = gain(s, 0.07);
    chain(h, hg, g);
    chain(w, g, s.out);
  }
  return 1.9;
}

function elevatorDoors(s: SynthCtx): number {
  const dur = 1.7;
  const m = osc(s, 'sawtooth', 95, 0, dur);
  ramp(m.frequency, s.t0, [[0, 80], [0.3, 100], [1.4, 100], [1.7, 70]]);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.25, 0.14], [1.4, 0.12], [1.7, 0]]);
  chain(m, filter(s, 'lowpass', 600, 1.5), g, s.out);
  const n = noise(s, 'brown', 0, dur);
  const ng = gain(s, 0);
  ramp(ng.gain, s.t0, [[0, 0], [0.3, 0.25], [1.5, 0.2], [1.7, 0]]);
  chain(n, filter(s, 'bandpass', 180, 1), ng, s.out);
  thump(s, 1.62, 120, 60, 0.12, 0.3);
  click(s, 1.64, 0.15, 1800, 0.02);
  return dur + 0.15;
}

function elevatorHum(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 3;
  const stop = s.loop ? undefined : dur;
  const a = osc(s, 'sawtooth', 85, 0, stop);
  const b = osc(s, 'sine', 60, 0, stop);
  const fl = osc(s, 'sine', 7.3, 0, stop);
  const flg = gain(s, 1.6);
  chain(fl, flg, a.frequency);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [0.8, 1]] : [[0, 0], [0.8, 1], [2.4, 1], [3, 0]]);
  const ag = gain(s, 0.12);
  const bg = gain(s, 0.2);
  chain(a, filter(s, 'lowpass', 500), ag, g);
  chain(b, bg, g);
  g.connect(s.out);
  return dur;
}

function vendingDrop(s: SynthCtx): number {
  const r = s.rng;
  thump(s, 0, 130, 55, 0.12, 0.6);
  burst(s, { kind: 'brown', at: 0, dur: 0.1, vol: 0.4, type: 'lowpass', freq: 400 });
  const n = 5 + r.int(0, 3);
  for (let i = 0; i < n; i++) {
    const t = 0.08 + i * 0.07 + r.next() * 0.05;
    burst(s, { at: t, dur: 0.025, vol: 0.2 - i * 0.02, freq: 1800 + r.next() * 1400, q: 3 });
  }
  thump(s, 0.55 + r.next() * 0.1, 220, 120, 0.06, 0.18);
  burst(s, { at: 0.55, dur: 0.03, vol: 0.12, freq: 2600, q: 2 });
  return 0.85;
}

function vendingHum(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 3;
  const stop = s.loop ? undefined : dur;
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [0.5, 1]] : [[0, 0], [0.5, 1], [2.5, 1], [3, 0]]);
  for (const [f, v, type] of [[60, 0.14, 'sine'], [120, 0.07, 'triangle'], [180, 0.025, 'sine']] as const) {
    const o = osc(s, type, f, 0, stop);
    const og = gain(s, v);
    chain(o, og, g);
  }
  const n = noise(s, 'brown', 0, stop);
  const ng = gain(s, 0.12);
  chain(n, filter(s, 'lowpass', 320), ng, g);
  g.connect(s.out);
  return dur;
}

function coin(s: SynthCtx): number {
  const r = s.rng;
  ping(s, { at: 0, freq: 4200, dur: 0.12, vol: 0.18, type: 'triangle' });
  ping(s, { at: 0, freq: 6100, dur: 0.08, vol: 0.1 });
  for (let i = 0; i < 4; i++) click(s, 0.15 + i * 0.06 + r.next() * 0.03, 0.08, 3500 + r.next() * 1500, 0.008);
  return 0.5;
}

function phoneBuzz(s: SynthCtx): number {
  for (let i = 0; i < 3; i++) {
    const at = i * 0.3;
    const w = osc(s, 'square', 160, at, at + 0.18);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + at, [[0, 0], [0.01, 0.22], [0.17, 0.2], [0.18, 0]]);
    chain(w, filter(s, 'lowpass', 2000), g, s.out);
    burst(s, { at, dur: 0.18, vol: 0.12, freq: 2600, q: 1.5, attack: 0.01 });
  }
  return 0.95;
}

function phoneUnlock(s: SynthCtx): number {
  click(s, 0, 0.12, 2800, 0.008);
  ping(s, { at: 0.02, freq: 1200, dur: 0.05, vol: 0.08 });
  ping(s, { at: 0.07, freq: 1600, dur: 0.07, vol: 0.08 });
  return 0.2;
}

function phoneTap(s: SynthCtx): number {
  click(s, 0, 0.12, 1900, 0.008);
  return 0.05;
}

function paper(s: SynthCtx): number {
  const r = s.rng;
  const dur = 0.55;
  const n = noise(s, 'pink', 0, dur);
  const g = gain(s, 0);
  const pts: Pt[] = [[0, 0]];
  for (let i = 1; i < 9; i++) pts.push([(i / 9) * dur, 0.05 + r.next() * 0.18]);
  pts.push([dur, 0]);
  ramp(g.gain, s.t0, pts);
  chain(n, filter(s, 'highpass', 1500), filter(s, 'peaking', 4000, 1, 4), g, s.out);
  return dur + 0.05;
}

function pen(s: SynthCtx): number {
  const r = s.rng;
  const n = 3 + r.int(0, 2);
  for (let i = 0; i < n; i++) burst(s, { at: i * 0.14 + r.next() * 0.05, dur: 0.06 + r.next() * 0.05, vol: 0.1, freq: 3800 + r.next() * 1500, q: 2, attack: 0.01 });
  return 0.75;
}

function typing(s: SynthCtx): number {
  const r = s.rng;
  let t = 0;
  const n = 8 + r.int(0, 6);
  for (let i = 0; i < n; i++) {
    burst(s, { at: t, dur: 0.02, vol: 0.14, freq: 2800 + r.next() * 1200, q: 1.2 });
    click(s, t + 0.003, 0.08, 1400, 0.01);
    t += 0.06 + r.next() * 0.09;
  }
  return t + 0.05;
}

function keys(s: SynthCtx): number {
  const r = s.rng;
  const n = 6 + r.int(0, 3);
  for (let i = 0; i < n; i++) ping(s, { at: r.next() * 0.45, freq: 3000 + r.next() * 4000, dur: 0.04 + r.next() * 0.04, vol: 0.07, type: 'triangle' });
  burst(s, { at: 0, dur: 0.4, vol: 0.06, freq: 5000, q: 0.6, attack: 0.03 });
  return 0.6;
}

function clipboard(s: SynthCtx): number {
  burst(s, { at: 0, dur: 0.025, vol: 0.3, freq: 1200, q: 1 });
  thump(s, 0, 500, 300, 0.04, 0.15);
  paper(s);
  return 0.6;
}

function lightFlicker(s: SynthCtx): number {
  const r = s.rng;
  const dur = 0.75;
  const saw = osc(s, 'sawtooth', 120, 0, dur);
  const g = gain(s, 0);
  const pts: Pt[] = [[0, 0]];
  let t = 0;
  while (t < dur - 0.05) {
    const on = r.chance(0.55);
    const seg = 0.03 + r.next() * 0.09;
    pts.push([t + 0.004, on ? 0.08 + r.next() * 0.06 : 0.005]);
    pts.push([t + seg, on ? 0.06 : 0.003]);
    t += seg;
    if (on && r.chance(0.5)) click(s, t, 0.06, 3000 + r.next() * 2000, 0.005);
  }
  pts.push([dur, 0]);
  ramp(g.gain, s.t0, pts);
  chain(saw, filter(s, 'lowpass', 2200), filter(s, 'highpass', 90), g, s.out);
  return dur + 0.05;
}

function lightBuzz(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 1.5;
  const stop = s.loop ? undefined : dur;
  const saw = osc(s, 'sawtooth', 120, 0, stop);
  const sine = osc(s, 'sine', 60, 0, stop);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [0.3, 1]] : [[0, 0], [0.3, 1], [1.2, 0.9], [1.5, 0]]);
  const sg = gain(s, 0.06);
  const bg = gain(s, 0.05);
  chain(saw, filter(s, 'bandpass', 1500, 0.8), sg, g);
  chain(sine, bg, g);
  g.connect(s.out);
  return dur;
}

function lightPop(s: SynthCtx): number {
  click(s, 0, 0.4, 1800, 0.01);
  ping(s, { at: 0, freq: 1100, dur: 0.05, vol: 0.2 });
  ping(s, { at: 0.02, freq: 5200, dur: 0.12, vol: 0.06, type: 'triangle' });
  const saw = osc(s, 'sawtooth', 120, 0.03, 0.5);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.03, [[0, 0.05], [0.45, 0]]);
  chain(saw, filter(s, 'lowpass', 1500), g, s.out);
  return 0.6;
}

function lightOn(s: SynthCtx): number {
  click(s, 0, 0.18, 2400, 0.01);
  // two false starts, then the ballast catches
  for (const [at, d] of [[0.08, 0.05], [0.2, 0.07]] as const) {
    const saw = osc(s, 'sawtooth', 120, at, at + d);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + at, [[0, 0], [0.005, 0.06], [d, 0]]);
    chain(saw, filter(s, 'lowpass', 2000), g, s.out);
  }
  const saw = osc(s, 'sawtooth', 120, 0.34, 0.95);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.34, [[0, 0], [0.04, 0.07], [0.4, 0.04], [0.6, 0]]);
  chain(saw, filter(s, 'lowpass', 1800), g, s.out);
  return 1.0;
}

function breakerClick(s: SynthCtx): number {
  click(s, 0, 0.35, 2800, 0.008);
  thump(s, 0.002, 320, 180, 0.035, 0.25);
  burst(s, { at: 0.004, dur: 0.03, vol: 0.12, freq: 900, q: 1 });
  return 0.12;
}

function breakerThunk(s: SynthCtx): number {
  thump(s, 0, 95, 45, 0.14, 0.7);
  burst(s, { kind: 'brown', at: 0, dur: 0.08, vol: 0.4, type: 'lowpass', freq: 500 });
  ping(s, { at: 0, freq: 1400, dur: 0.18, vol: 0.12, type: 'triangle' });
  click(s, 0.003, 0.3, 2000, 0.01);
  const saw = osc(s, 'sawtooth', 120, 0.05, 0.5);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.05, [[0, 0.04], [0.45, 0]]);
  chain(saw, filter(s, 'lowpass', 1200), g, s.out);
  return 0.6;
}

function panelOpen(s: SynthCtx): number {
  click(s, 0, 0.25, 2200, 0.012);
  hingeSweep(s, 0.05, 0.45, 300, 180, 0.12);
  // sheet metal: two inharmonic partials with a wobble
  for (const [f, v] of [[210, 0.12], [587, 0.06]] as const) {
    const o = osc(s, 'triangle', f, 0.08, 0.7);
    const lfo = osc(s, 'sine', 9, 0.08, 0.7);
    const lg = gain(s, f * 0.02);
    chain(lfo, lg, o.frequency);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + 0.08, [[0, 0], [0.02, v], [0.62, 0]]);
    chain(o, g, s.out);
  }
  return 0.8;
}

function generatorStart(s: SynthCtx): number {
  const r = s.rng;
  // cranking: thumps accelerating
  let t = 0;
  let gap = 0.3;
  for (let i = 0; i < 8; i++) {
    thump(s, t, 60, 40, 0.12, 0.5);
    burst(s, { kind: 'brown', at: t, dur: 0.1, vol: 0.35, type: 'lowpass', freq: 600 });
    burst(s, { at: t + 0.02, dur: 0.05, vol: 0.1, freq: 1800 + r.next() * 600, q: 2 });
    t += gap;
    gap = Math.max(0.1, gap * 0.85);
  }
  // engine settles: 30/60 Hz with rpm climb
  const start = t;
  const dur = 2.4;
  for (const [f, v, type] of [[30, 0.35, 'sawtooth'], [60, 0.25, 'sawtooth'], [90, 0.06, 'triangle']] as const) {
    const o = osc(s, type, f * 0.7, start, start + dur);
    ramp(o.frequency, s.t0 + start, [[0, f * 0.7], [0.9, f * 1.05], [1.6, f]]);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + start, [[0, 0], [0.4, v], [dur - 0.5, v], [dur, 0]]);
    chain(o, filter(s, 'lowpass', 400), g, s.out);
  }
  for (let i = 0; i < 10; i++) {
    const at = start + 0.3 + i * (dur - 0.6) / 10 + r.next() * 0.05;
    burst(s, { kind: 'brown', at, dur: 0.05, vol: 0.14, type: 'lowpass', freq: 900 });
  }
  return start + dur + 0.1;
}

function generatorFail(s: SynthCtx): number {
  const r = s.rng;
  const dur = 1.4;
  for (const [f, v] of [[60, 0.3], [30, 0.3]] as const) {
    const o = osc(s, 'sawtooth', f, 0, dur);
    ramp(o.frequency, s.t0, [[0, f], [0.5, f * 0.8], [dur, f * 0.32]], true);
    const g = gain(s, 0);
    ramp(g.gain, s.t0, [[0, v], [0.9, v * 0.6], [dur, 0]]);
    chain(o, filter(s, 'lowpass', 500), g, s.out);
  }
  for (let i = 0; i < 5; i++) thump(s, 0.2 + i * 0.22 + r.next() * 0.1, 70, 40, 0.1, 0.3);
  thump(s, dur, 110, 50, 0.16, 0.5);
  click(s, dur + 0.01, 0.2, 1600, 0.02);
  return dur + 0.3;
}

function powerDown(s: SynthCtx): number {
  const dur = 1.15;
  const saw = osc(s, 'sawtooth', 120, 0, dur);
  ramp(saw.frequency, s.t0, [[0, 120], [dur, 38]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0.12], [0.3, 0.14], [dur, 0]]);
  chain(saw, filter(s, 'lowpass', 1400), g, s.out);
  ping(s, { at: 0.02, freq: 8000, to: 1800, dur: 0.9, vol: 0.025 });
  for (const t of [0.0, 0.18, 0.55]) click(s, t, 0.3, 2300, 0.012);
  thump(s, 0.55, 90, 50, 0.12, 0.3);
  return dur + 0.1;
}

function powerUp(s: SynthCtx): number {
  thump(s, 0, 100, 50, 0.12, 0.45);
  click(s, 0.01, 0.3, 2000, 0.012);
  const dur = 1.5;
  const saw = osc(s, 'sawtooth', 40, 0.1, dur);
  ramp(saw.frequency, s.t0 + 0.1, [[0, 40], [1.0, 120], [dur - 0.1, 120]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.1, [[0, 0], [0.6, 0.12], [1.1, 0.08], [dur - 0.1, 0]]);
  chain(saw, filter(s, 'lowpass', 1500), g, s.out);
  for (const t of [0.5, 0.72, 0.9, 1.05]) click(s, t, 0.1, 3200, 0.006);
  return dur + 0.1;
}

function transformerHum(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 1.8;
  const stop = s.loop ? undefined : dur;
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [0.4, 1]] : [[0, 0], [0.4, 1], [1.4, 1], [1.8, 0]]);
  for (const [f, v, type] of [[60, 0.16, 'sine'], [120, 0.09, 'sawtooth'], [180, 0.04, 'sine'], [240, 0.02, 'sine']] as const) {
    const o = osc(s, type, f, 0, stop);
    const og = gain(s, v);
    if (type === 'sawtooth') chain(o, filter(s, 'lowpass', 900), og, g);
    else chain(o, og, g);
  }
  g.connect(s.out);
  return dur;
}

function staticBurst(s: SynthCtx): number {
  const dur = 0.36;
  const n = noise(s, 'white', 0, dur);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.01, 0.5], [0.25, 0.4], [dur, 0]]);
  // 50 Hz AM
  const am = osc(s, 'sine', 50, 0, dur);
  const amg = gain(s, 0.45);
  const carrier = gain(s, 0.55);
  chain(am, amg, carrier.gain);
  chain(n, filter(s, 'highpass', 300), carrier, g, s.out);
  return dur + 0.05;
}

function cctvSwitch(s: SynthCtx): number {
  click(s, 0, 0.3, 2400, 0.01);
  burst(s, { at: 0.01, dur: 0.12, vol: 0.25, type: 'highpass', freq: 800 });
  ping(s, { at: 0.02, freq: 3100, to: 2200, dur: 0.035, vol: 0.06 });
  return 0.2;
}

function cctvOffline(s: SynthCtx): number {
  ping(s, { at: 0, freq: 900, to: 120, dur: 0.26, vol: 0.2 });
  click(s, 0.25, 0.2, 1500, 0.015);
  burst(s, { at: 0.26, dur: 0.3, vol: 0.12, type: 'highpass', freq: 1000, attack: 0.01 });
  return 0.6;
}

function drag(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 2.5;
  const stop = s.loop ? undefined : dur;
  const n = noise(s, 'brown', 0, stop);
  const p = noise(s, 'pink', 0, stop);
  const bp = filter(s, 'bandpass', 420, 1.2);
  const g = gain(s, 0);
  const span = s.loop ? 4 : 2.5;
  const pts: Pt[] = [[0, 0]];
  for (let i = 1; i <= 8; i++) {
    const swell = 0.5 + 0.5 * Math.sin((i / 8) * Math.PI * 2.2);
    pts.push([(i / 8) * span, 0.35 * swell + 0.1]);
  }
  if (!s.loop) pts.push([dur, 0]);
  ramp(g.gain, s.t0, pts);
  ramp(bp.frequency, s.t0, [[0, 300], [span * 0.5, 900], [span, 350]], true);
  const pg = gain(s, 0.5);
  chain(p, filter(s, 'highpass', 500), pg, bp);
  chain(n, bp, g, s.out);
  const grit = s.loop ? 40 : 28;
  for (let i = 0; i < grit; i++) burst(s, { kind: 'pink', at: r.next() * span, dur: 0.02 + r.next() * 0.03, vol: 0.06 + r.next() * 0.08, freq: 600 + r.next() * 1800, q: 2 });
  return dur;
}

function knocks(s: SynthCtx, count: number, gap: number, vol: number, freq: number): number {
  let t = 0;
  for (let i = 0; i < count; i++) {
    ping(s, { at: t, freq, to: freq * 0.7, dur: 0.11, vol, type: 'sine' });
    burst(s, { kind: 'pink', at: t, dur: 0.035, vol: vol * 0.9, freq: 800, q: 0.9 });
    click(s, t, vol * 0.5, 1800, 0.008);
    t += gap * (0.92 + s.rng.next() * 0.16);
  }
  return t + 0.2;
}
const knock = (s: SynthCtx): number => knocks(s, 3, 0.32, 0.45, 180);
const knockSoft = (s: SynthCtx): number => knocks(s, 2, 0.5, 0.2, 120);

function scratch(s: SynthCtx): number {
  const r = s.rng;
  const n = 3 + r.int(0, 2);
  let t = 0;
  for (let i = 0; i < n; i++) {
    const d = 0.12 + r.next() * 0.1;
    const src = noise(s, 'white', t, t + d);
    const f = filter(s, 'bandpass', 1500, 4);
    ramp(f.frequency, s.t0 + t, [[0, 1500 + r.next() * 500], [d, 3000 + r.next() * 1000]], true);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + t, [[0, 0], [0.02, 0.2], [d * 0.7, 0.14], [d, 0]]);
    chain(src, f, g, s.out);
    for (let k = 0; k < 4; k++) click(s, t + r.next() * d, 0.06, 2500 + r.next() * 2000, 0.005);
    t += d + 0.05 + r.next() * 0.15;
  }
  return t + 0.1;
}

function bang(s: SynthCtx): number {
  thump(s, 0, 62, 28, 0.26, 1.0);
  burst(s, { kind: 'brown', at: 0, dur: 0.11, vol: 0.9, type: 'lowpass', freq: 3000 });
  ping(s, { at: 0.01, freq: 760, dur: 0.3, vol: 0.08, type: 'triangle' });
  click(s, 0.002, 0.5, 1400, 0.02);
  return 0.6;
}

function metalGroan(s: SynthCtx): number {
  const r = s.rng;
  const dur = 2.2;
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.6, 0.18], [1.4, 0.22], [dur, 0]]);
  for (const [f, v] of [[87, 1], [131, 0.6], [219, 0.35], [340, 0.15]] as const) {
    const o = osc(s, 'sawtooth', f, 0, dur);
    let cur = f;
    for (let i = 0; i <= 6; i++) {
      cur = f * (0.96 + r.next() * 0.08);
      o.frequency.linearRampToValueAtTime(cur, s.t0 + (dur * i) / 6);
    }
    const og = gain(s, v);
    chain(o, og, g);
  }
  chain(g, filter(s, 'lowpass', 1600, 2), s.out);
  const n = noise(s, 'pink', 0.2, dur);
  const ng = gain(s, 0);
  ramp(ng.gain, s.t0 + 0.2, [[0, 0], [0.8, 0.05], [dur - 0.2, 0]]);
  chain(n, filter(s, 'bandpass', 2400, 3), ng, s.out);
  return dur + 0.2;
}

function hvacThump(s: SynthCtx): number {
  thump(s, 0, 48, 36, 0.32, 0.7);
  burst(s, { kind: 'brown', at: 0, dur: 0.2, vol: 0.5, type: 'lowpass', freq: 200 });
  // sheet-metal flutter
  const n = noise(s, 'pink', 0.02, 0.4);
  const am = osc(s, 'sine', 18, 0.02, 0.4);
  const amg = gain(s, 0.5);
  const carrier = gain(s, 0.5);
  chain(am, amg, carrier.gain);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.02, [[0, 0], [0.03, 0.18], [0.38, 0]]);
  chain(n, filter(s, 'bandpass', 420, 2), carrier, g, s.out);
  return 0.5;
}

function pipeKnock(s: SynthCtx): number {
  const r = s.rng;
  const n = 2 + r.int(0, 1);
  let t = 0;
  for (let i = 0; i < n; i++) {
    burst(s, { at: t, dur: 0.05, vol: 0.35, freq: 1300, q: 8 });
    ping(s, { at: t, freq: 650, dur: 0.16, vol: 0.18, type: 'triangle' });
    ping(s, { at: t, freq: 2100, dur: 0.08, vol: 0.06 });
    t += 0.18 + r.next() * 0.35;
  }
  return t + 0.2;
}

function whisper(s: SynthCtx): number {
  return murmurBuilder(1.6 + s.rng.next() * 0.6, 120, true, 0.55)(s);
}

function childLaugh(s: SynthCtx): number {
  const r = s.rng;
  let t = 0;
  for (let grp = 0; grp < 3; grp++) {
    for (let i = 0; i < 3; i++) {
      const f = 920 - grp * 60 - i * 40 + r.next() * 40;
      const o = osc(s, 'sawtooth', f, t, t + 0.1);
      ramp(o.frequency, s.t0 + t, [[0, f], [0.09, f * 0.72]], true);
      const g = gain(s, 0);
      ramp(g.gain, s.t0 + t, [[0, 0], [0.015, 0.16], [0.07, 0.1], [0.1, 0]]);
      chain(o, filter(s, 'bandpass', 1300, 1.2), filter(s, 'lowpass', 3500), g, s.out);
      burst(s, { kind: 'pink', at: t, dur: 0.1, vol: 0.06, freq: 2200, q: 1 });
      t += 0.13 + r.next() * 0.03;
    }
    burst(s, { kind: 'pink', at: t, dur: 0.12, vol: 0.05, freq: 1200, q: 0.8, attack: 0.03 }); // breath
    t += 0.18 + r.next() * 0.08;
  }
  return t + 0.2;
}

function cough(s: SynthCtx): number {
  const r = s.rng;
  const one = (at: number, v: number): void => {
    burst(s, { kind: 'white', at, dur: 0.16, vol: v, type: 'lowpass', freq: 1300, attack: 0.008 });
    const o = osc(s, 'sawtooth', 130 * (0.9 + r.next() * 0.2), at, at + 0.14);
    ramp(o.frequency, s.t0 + at, [[0, 130], [0.14, 95]], true);
    const g = gain(s, 0);
    ramp(g.gain, s.t0 + at, [[0, 0], [0.01, v * 0.5], [0.14, 0]]);
    chain(o, filter(s, 'bandpass', 600, 2), g, s.out);
  };
  one(0, 0.45);
  one(0.28 + r.next() * 0.08, 0.3);
  if (r.chance(0.3)) one(0.62, 0.18);
  return 0.9;
}

function voiceMurmur(s: SynthCtx): number {
  const male = s.rng.chance(0.5);
  return murmurBuilder(1.8 + s.rng.next() * 0.8, male ? 118 : 196, false, 0.8)(s);
}

function breathCycle(s: SynthCtx, at: number, inhale: number, exhale: number, vol: number): void {
  const n = noise(s, 'pink', at, at + inhale + exhale + 0.3);
  const f = filter(s, 'bandpass', 900, 0.9);
  ramp(f.frequency, s.t0 + at, [[0, 1100], [inhale, 800], [inhale + 0.15, 520], [inhale + exhale, 400]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + at, [[0, 0], [inhale * 0.6, vol], [inhale, vol * 0.4], [inhale + 0.12, 0.02], [inhale + 0.12 + exhale * 0.4, vol * 0.8], [inhale + exhale + 0.25, 0]]);
  chain(n, f, g, s.out);
}

function breath(s: SynthCtx): number {
  breathCycle(s, 0, 1.0, 1.3, 0.16);
  return 2.6;
}

function gasp(s: SynthCtx): number {
  click(s, 0, 0.05, 1200, 0.01);
  const n = noise(s, 'white', 0, 0.4);
  const f = filter(s, 'bandpass', 800, 1.5);
  ramp(f.frequency, s.t0, [[0, 800], [0.3, 2200]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.04, 0.35], [0.25, 0.3], [0.38, 0]]);
  chain(n, f, g, s.out);
  return 0.5;
}

function screamDistant(s: SynthCtx): number {
  const dur = 1.1;
  const o = osc(s, 'sawtooth', 700, 0, dur);
  ramp(o.frequency, s.t0, [[0, 650], [0.25, 960], [0.7, 900], [dur, 560]], true);
  const vib = osc(s, 'sine', 6.5, 0, dur);
  const vg = gain(s, 25);
  chain(vib, vg, o.frequency);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.12, 0.22], [0.8, 0.18], [dur, 0]]);
  chain(o, filter(s, 'bandpass', 1500, 1.4), filter(s, 'lowpass', 1500), g, s.out);
  return dur + 0.3;
}

function rainLoop(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 4;
  const stop = s.loop ? undefined : dur;
  const n = noise(s, 'pink', 0, stop);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, s.loop ? [[0, 0], [1.2, 0.5]] : [[0, 0], [1.2, 0.5], [3, 0.45], [4, 0]]);
  const swell = osc(s, 'sine', 0.11, 0, stop);
  const sg = gain(s, 0.12);
  const body = gain(s, 0.5);
  chain(swell, sg, body.gain);
  chain(n, filter(s, 'highpass', 900), filter(s, 'peaking', 3200, 0.8, 3), body, g, s.out);
  const drops = s.loop ? 36 : 24;
  for (let i = 0; i < drops; i++) ping(s, { at: r.next() * 4, freq: 2600 + r.next() * 2600, to: 1400, dur: 0.025, vol: 0.03 + r.next() * 0.04 });
  return dur;
}

function thunder(s: SynthCtx): number {
  const r = s.rng;
  const dur = 3.6;
  const n = noise(s, 'brown', 0, dur);
  const g = gain(s, 0);
  const pts: Pt[] = [[0, 0], [0.15, 0.5]];
  for (let i = 1; i < 6; i++) pts.push([0.3 + (i / 6) * 2.4, 0.25 + r.next() * 0.45]);
  pts.push([dur, 0]);
  ramp(g.gain, s.t0, pts);
  const lp = filter(s, 'lowpass', 90, 0.8);
  ramp(lp.frequency, s.t0, [[0, 160], [dur, 60]], true);
  chain(n, lp, g, s.out);
  burst(s, { at: 0.02, dur: 0.25, vol: 0.1, type: 'lowpass', freq: 1800, attack: 0.01 });
  return dur + 0.2;
}

function waterDrip(s: SynthCtx): number {
  const r = s.rng;
  const f = 1800 + r.next() * 1100;
  ping(s, { at: 0, freq: f, to: f * 0.42, dur: 0.045, vol: 0.28 });
  burst(s, { at: 0.004, dur: 0.03, vol: 0.08, freq: 3500, q: 1.2 });
  if (r.chance(0.4)) ping(s, { at: 0.07 + r.next() * 0.05, freq: f * 1.1, to: f * 0.5, dur: 0.03, vol: 0.09 });
  return 0.25;
}

function faucet(s: SynthCtx): number {
  const dur = s.loop ? Infinity : 1.9;
  const stop = s.loop ? undefined : dur;
  ping(s, { at: 0, freq: 2800, to: 3600, dur: 0.06, vol: 0.05, type: 'triangle' });
  const n = noise(s, 'white', 0.05, stop);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.05, s.loop ? [[0, 0], [0.15, 0.3]] : [[0, 0], [0.15, 0.3], [1.65, 0.28], [1.85, 0]]);
  chain(n, filter(s, 'bandpass', 2600, 0.6), g, s.out);
  const sp = noise(s, 'pink', 0.05, stop);
  const am = osc(s, 'sine', 9, 0.05, stop);
  const amg = gain(s, 0.4);
  const car = gain(s, 0.6);
  chain(am, amg, car.gain);
  const sg = gain(s, 0);
  ramp(sg.gain, s.t0 + 0.05, s.loop ? [[0, 0], [0.2, 0.22]] : [[0, 0], [0.2, 0.22], [1.65, 0.2], [1.85, 0]]);
  chain(sp, filter(s, 'bandpass', 620, 1), car, sg, s.out);
  if (!s.loop) ping(s, { at: 1.78, freq: 3400, to: 2600, dur: 0.05, vol: 0.04, type: 'triangle' });
  return dur;
}

function flush(s: SynthCtx): number {
  const r = s.rng;
  const dur = 3.2;
  const n = noise(s, 'white', 0, dur);
  const lp = filter(s, 'lowpass', 2000, 0.8);
  ramp(lp.frequency, s.t0, [[0, 2200], [1.4, 700], [dur, 1500]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.3, 0.45], [1.3, 0.4], [1.8, 0.15], [dur, 0]]);
  chain(n, lp, g, s.out);
  for (let i = 0; i < 14; i++) {
    const at = 0.2 + r.next() * 1.6;
    burst(s, { kind: 'pink', at, dur: 0.05 + r.next() * 0.06, vol: 0.18, freq: 250 + r.next() * 400, q: 2, attack: 0.01 });
  }
  burst(s, { at: 1.8, dur: 1.4, vol: 0.1, freq: 3000, q: 0.5, attack: 0.3 }); // refill hiss
  return dur + 0.1;
}

function flashlightClick(s: SynthCtx): number {
  click(s, 0, 0.35, 2800, 0.006);
  click(s, 0.025, 0.25, 3400, 0.005);
  thump(s, 0, 300, 180, 0.03, 0.15);
  return 0.1;
}

function callLight(s: SynthCtx): number {
  click(s, 0, 0.1, 1800, 0.01);
  ping(s, { at: 0.02, freq: 1046, dur: 0.45, vol: 0.14, attack: 0.01 });
  ping(s, { at: 0.02, freq: 1568, dur: 0.35, vol: 0.06, attack: 0.01 });
  return 0.55;
}

function heartbeat(s: SynthCtx): number {
  thump(s, 0, 62, 42, 0.12, 0.8);
  burst(s, { kind: 'brown', at: 0, dur: 0.07, vol: 0.3, type: 'lowpass', freq: 160 });
  thump(s, 0.17, 56, 40, 0.1, 0.5);
  burst(s, { kind: 'brown', at: 0.17, dur: 0.06, vol: 0.2, type: 'lowpass', freq: 140 });
  return 0.4;
}

function glassTap(s: SynthCtx): number {
  ping(s, { at: 0, freq: 3400, dur: 0.08, vol: 0.18 });
  ping(s, { at: 0, freq: 5200, dur: 0.05, vol: 0.08 });
  click(s, 0, 0.2, 2600, 0.006);
  return 0.15;
}

function glassCrack(s: SynthCtx): number {
  const r = s.rng;
  burst(s, { at: 0, dur: 0.018, vol: 0.6, freq: 4000, q: 0.8, attack: 0.001 });
  ping(s, { at: 0.005, freq: 6200, dur: 0.3, vol: 0.06 });
  let t = 0.03;
  for (let i = 0; i < 10; i++) {
    click(s, t, 0.22 * (1 - i / 12), 3000 + r.next() * 3000, 0.005);
    t += 0.02 + r.next() * 0.07;
  }
  return 0.7;
}

function squelch(s: SynthCtx, at: number): void {
  burst(s, { at, dur: 0.02, vol: 0.3, freq: 1500, q: 0.8 });
  burst(s, { at: at + 0.01, dur: 0.08, vol: 0.15, type: 'highpass', freq: 1200, attack: 0.002 });
}

function radioClick(s: SynthCtx): number {
  squelch(s, 0);
  ping(s, { at: 0.1, freq: 1200, dur: 0.035, vol: 0.06 });
  return 0.2;
}

function radioVoice(s: SynthCtx): number {
  const dur = 1.6 + s.rng.next() * 0.5;
  squelch(s, 0);
  const bed = noise(s, 'white', 0.05, dur + 0.1);
  const bg = gain(s, 0);
  ramp(bg.gain, s.t0 + 0.05, [[0, 0], [0.05, 0.05], [dur, 0.05], [dur + 0.08, 0]]);
  chain(bed, filter(s, 'bandpass', 2000, 0.5), bg, s.out);
  // speech through the radio band
  const inner = gain(s, 0.9);
  const voice = murmurBuilder(dur - 0.15, 150, false, 1);
  voice({ ...s, out: inner, t0: s.t0 + 0.12 });
  chain(inner, filter(s, 'highpass', 400), filter(s, 'lowpass', 2800), filter(s, 'peaking', 1400, 1, 4), s.out);
  squelch(s, dur + 0.05);
  return dur + 0.3;
}

const uiHover = (s: SynthCtx): number => { ping(s, { at: 0, freq: 2200, dur: 0.015, vol: 0.05 }); return 0.05; };
const uiSelect = (s: SynthCtx): number => { ping(s, { at: 0, freq: 1400, dur: 0.045, vol: 0.09 }); ping(s, { at: 0.05, freq: 1900, dur: 0.06, vol: 0.09 }); return 0.15; };
const uiBack = (s: SynthCtx): number => { ping(s, { at: 0, freq: 1600, to: 1000, dur: 0.08, vol: 0.09 }); return 0.12; };
const uiOpen = (s: SynthCtx): number => {
  burst(s, { at: 0, dur: 0.02, vol: 0.12, type: 'lowpass', freq: 2500 });
  ping(s, { at: 0.01, freq: 220, dur: 0.16, vol: 0.06, type: 'triangle', attack: 0.02 });
  return 0.2;
};
const uiClose = (s: SynthCtx): number => {
  burst(s, { at: 0, dur: 0.02, vol: 0.1, type: 'lowpass', freq: 2000 });
  ping(s, { at: 0.01, freq: 400, to: 200, dur: 0.12, vol: 0.06, type: 'triangle' });
  return 0.16;
};

function stingLow(s: SynthCtx): number {
  const dur = 3.4;
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [1.2, 1], [2.0, 0.7], [dur, 0]]);
  for (const [f, v] of [[38, 0.5], [57, 0.25], [76, 0.14]] as const) {
    const o = osc(s, 'sine', f, 0, dur);
    const og = gain(s, v);
    chain(o, og, g);
  }
  const n = noise(s, 'brown', 0, dur);
  const ng = gain(s, 0.3);
  chain(n, filter(s, 'lowpass', 120), ng, g);
  g.connect(s.out);
  return dur + 0.1;
}

function stingHigh(s: SynthCtx): number {
  const dur = 2.6;
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.6, 0.12], [1.2, 0.1], [dur, 0]]);
  const trem = osc(s, 'sine', 6.5, 0, dur);
  const tg = gain(s, 0.4);
  const car = gain(s, 0.6);
  chain(trem, tg, car.gain);
  for (const f of [2100, 2270, 2900]) {
    const o = osc(s, 'sine', f, 0, dur);
    const og = gain(s, 0.33);
    chain(o, og, car);
  }
  chain(car, g, s.out);
  return dur + 0.1;
}

function droneRise(s: SynthCtx): number {
  const dur = 4.5;
  const o = osc(s, 'sawtooth', 45, 0, dur);
  ramp(o.frequency, s.t0, [[0, 45], [dur - 0.5, 70]], true);
  const o2 = osc(s, 'sine', 45.6, 0, dur);
  ramp(o2.frequency, s.t0, [[0, 45.6], [dur - 0.5, 70.9]], true);
  const lp = filter(s, 'lowpass', 120, 2);
  ramp(lp.frequency, s.t0, [[0, 120], [dur - 0.5, 420]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [3.5, 0.35], [dur, 0]]);
  const og = gain(s, 0.5);
  chain(o, og, lp);
  const o2g = gain(s, 0.4);
  chain(o2, o2g, lp);
  chain(lp, g, s.out);
  return dur + 0.1;
}

function silenceDrop(s: SynthCtx): number {
  // reverse-envelope rumble that cuts dead, plus a thin whine that lingers for a beat
  const n = noise(s, 'brown', 0, 0.32);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.28, 0.5], [0.3, 0]]);
  chain(n, filter(s, 'lowpass', 200), g, s.out);
  ping(s, { at: 0.3, freq: 11000, dur: 0.35, vol: 0.02, attack: 0.01 });
  return 0.7;
}

function tvMurmur(s: SynthCtx): number {
  const r = s.rng;
  const dur = s.loop ? Infinity : 3;
  const span = s.loop ? 6 : 3;
  const out = gain(s, 0);
  ramp(out.gain, s.t0, s.loop ? [[0, 0], [0.5, 1]] : [[0, 0], [0.5, 1], [2.5, 1], [3, 0]]);
  const inner = gain(s, 0.5);
  // two overlapping newsreaders, low in the mix
  for (let i = 0; i < (s.loop ? 3 : 1); i++) {
    const v = murmurBuilder(span - 0.3, i % 2 ? 190 : 125, false, 0.7);
    v({ ...s, out: inner, t0: s.t0 + i * 2 + r.next() * 0.3 });
  }
  // faint bed music pad
  for (const f of [220, 277.2, 329.6]) {
    const o = osc(s, 'triangle', f, 0, s.loop ? undefined : dur);
    const og = gain(s, 0.025);
    chain(o, og, inner);
  }
  chain(inner, filter(s, 'highpass', 300), filter(s, 'lowpass', 1800), out, s.out);
  return dur;
}

function microwave(s: SynthCtx): number {
  const run = 2.5;
  const hum = osc(s, 'sine', 60, 0, run);
  const hg = gain(s, 0);
  ramp(hg.gain, s.t0, [[0, 0], [0.1, 0.12], [run - 0.1, 0.12], [run, 0]]);
  chain(hum, hg, s.out);
  const fan = noise(s, 'pink', 0, run);
  const fg = gain(s, 0);
  ramp(fg.gain, s.t0, [[0, 0], [0.2, 0.1], [run - 0.1, 0.1], [run, 0]]);
  chain(fan, filter(s, 'bandpass', 700, 0.6), fg, s.out);
  for (let i = 0; i < 3; i++) ping(s, { at: run + 0.1 + i * 0.3, freq: 2000, dur: 0.15, vol: 0.12, attack: 0.005 });
  return run + 1.1;
}

function coffee(s: SynthCtx): number {
  const r = s.rng;
  const dur = 2.6;
  for (let i = 0; i < 12; i++) burst(s, { kind: 'pink', at: r.next() * 2.2, dur: 0.06 + r.next() * 0.1, vol: 0.14, freq: 300 + r.next() * 600, q: 2.5, attack: 0.02 });
  burst(s, { at: 0, dur, vol: 0.06, freq: 4000, q: 0.5, attack: 0.4 });
  for (let i = 0; i < 5; i++) ping(s, { at: 0.5 + r.next() * 2, freq: 2400 + r.next() * 800, to: 1300, dur: 0.04, vol: 0.06 });
  return dur + 0.1;
}

function chairCreak(s: SynthCtx): number {
  const r = s.rng;
  const dur = 0.35;
  const o = osc(s, 'sawtooth', 220, 0, dur);
  for (let i = 0; i <= 5; i++) o.frequency.linearRampToValueAtTime(170 + r.next() * 70, s.t0 + (dur * i) / 5);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.05, 0.09], [0.25, 0.07], [dur, 0]]);
  chain(o, filter(s, 'bandpass', 1100, 2), g, s.out);
  click(s, 0.01, 0.06, 1600, 0.01);
  return dur + 0.1;
}

function sit(s: SynthCtx): number {
  burst(s, { kind: 'pink', at: 0, dur: 0.38, vol: 0.14, freq: 700, q: 0.7, attack: 0.06 });
  thump(s, 0.18, 85, 55, 0.1, 0.25);
  const c = gain(s, 0.5);
  chairCreak({ ...s, out: c, t0: s.t0 + 0.2 });
  c.connect(s.out);
  return 0.7;
}

function stand(s: SynthCtx): number {
  thump(s, 0, 90, 60, 0.08, 0.15);
  const c = gain(s, 0.4);
  chairCreak({ ...s, out: c, t0: s.t0 + 0.05 });
  c.connect(s.out);
  burst(s, { kind: 'pink', at: 0.1, dur: 0.35, vol: 0.12, freq: 800, q: 0.7, attack: 0.05 });
  return 0.6;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SFX: Record<SfxName, SfxBuilder> = {
  footstep_tile: footstepTile, footstep_concrete: footstepConcrete, footstep_wet: footstepWet,
  door_open: doorOpen, door_close: doorClose, door_locked: doorLocked, door_slam: doorSlam, door_creak: doorCreak,
  badge_ok: badgeOk, badge_deny: badgeDeny,
  cart_roll: cartRoll, wheelchair, curtain, bed_rail: bedRail,
  monitor_beep: monitorBeep, monitor_alarm: monitorAlarm, monitor_flat: monitorFlat, monitor_off: monitorOff,
  intercom_click: intercomClick, intercom_chime: intercomChime, intercom_static: intercomStatic,
  elevator_tone: elevatorTone, elevator_doors: elevatorDoors, elevator_hum: elevatorHum,
  vending_drop: vendingDrop, vending_hum: vendingHum, coin,
  phone_buzz: phoneBuzz, phone_unlock: phoneUnlock, phone_tap: phoneTap,
  paper, pen, typing, keys, clipboard,
  light_flicker: lightFlicker, light_buzz: lightBuzz, light_pop: lightPop, light_on: lightOn,
  breaker_click: breakerClick, breaker_thunk: breakerThunk, panel_open: panelOpen,
  generator_start: generatorStart, generator_fail: generatorFail, power_down: powerDown, power_up: powerUp, transformer_hum: transformerHum,
  static_burst: staticBurst, cctv_switch: cctvSwitch, cctv_offline: cctvOffline,
  drag, knock, knock_soft: knockSoft, scratch, bang, metal_groan: metalGroan, hvac_thump: hvacThump, pipe_knock: pipeKnock,
  whisper, name_call: nameCall, child_laugh: childLaugh, cough, voice_murmur: voiceMurmur, breath, gasp, scream_distant: screamDistant,
  rain_loop: rainLoop, thunder, water_drip: waterDrip, faucet, flush,
  flashlight_click: flashlightClick, call_light: callLight, heartbeat,
  glass_tap: glassTap, glass_crack: glassCrack,
  radio_click: radioClick, radio_voice: radioVoice,
  ui_hover: uiHover, ui_select: uiSelect, ui_back: uiBack, ui_open: uiOpen, ui_close: uiClose,
  sting_low: stingLow, sting_high: stingHigh, drone_rise: droneRise, silence_drop: silenceDrop,
  tv_murmur: tvMurmur, microwave, coffee, chair_creak: chairCreak, sit, stand,
};

const DEFAULT_META: SfxMeta = { bus: 'sfx', wet: 0.3, vol: 1, priority: 2 };
const META_OVERRIDES: Partial<Record<SfxName, Partial<SfxMeta>>> = {
  footstep_tile: { wet: 0.22, priority: 1, vol: 0.7 }, footstep_concrete: { wet: 0.35, priority: 1, vol: 0.75 }, footstep_wet: { wet: 0.25, priority: 1, vol: 0.7 },
  door_slam: { wet: 0.5 }, bang: { wet: 0.55 }, knock: { wet: 0.45 }, knock_soft: { wet: 0.4 },
  elevator_tone: { wet: 0.6 }, intercom_chime: { wet: 0.5, vol: 0.8 }, call_light: { wet: 0.4 },
  monitor_beep: { wet: 0.2, vol: 0.6, priority: 1 }, monitor_alarm: { wet: 0.25, vol: 0.8 }, monitor_flat: { wet: 0.2, vol: 0.7 },
  water_drip: { wet: 0.7, priority: 1 }, pipe_knock: { wet: 0.6 }, metal_groan: { wet: 0.6 }, hvac_thump: { wet: 0.5 },
  drag: { wet: 0.55, vol: 0.8 }, scratch: { wet: 0.5, vol: 0.7 }, whisper: { wet: 0.2, vol: 0.6, priority: 3 }, name_call: { wet: 0.5, vol: 0.5, priority: 3 },
  child_laugh: { wet: 0.6, vol: 0.5, priority: 3 }, scream_distant: { wet: 0.8, vol: 0.5, priority: 3 },
  heartbeat: { bus: 'body', wet: 0, priority: 3 }, breath: { bus: 'body', wet: 0, vol: 0.8 }, gasp: { bus: 'body', wet: 0.05 },
  sting_low: { bus: 'music', wet: 0.1, priority: 3 }, sting_high: { bus: 'music', wet: 0.3, priority: 3 }, drone_rise: { bus: 'music', wet: 0.1, priority: 3 }, silence_drop: { bus: 'music', wet: 0, priority: 3 },
  ui_hover: { bus: 'ui', wet: 0, priority: 1, vol: 0.6 }, ui_select: { bus: 'ui', wet: 0, priority: 1 }, ui_back: { bus: 'ui', wet: 0, priority: 1 }, ui_open: { bus: 'ui', wet: 0, priority: 1 }, ui_close: { bus: 'ui', wet: 0, priority: 1 },
  static_burst: { wet: 0, priority: 3 }, cctv_switch: { wet: 0, priority: 3 }, cctv_offline: { wet: 0, priority: 3 },
  intercom_click: { wet: 0.3, priority: 3 }, intercom_static: { wet: 0.2, priority: 3 },
  rain_loop: { wet: 0.05, vol: 0.8, priority: 3 }, thunder: { wet: 0.2, priority: 3 }, tv_murmur: { wet: 0.25, vol: 0.6, priority: 3 },
  vending_hum: { wet: 0.1, vol: 0.6, priority: 3 }, elevator_hum: { wet: 0.3, vol: 0.7, priority: 3 }, transformer_hum: { wet: 0.2, vol: 0.7, priority: 3 },
  generator_start: { wet: 0.5, priority: 3 }, generator_fail: { wet: 0.5, priority: 3 }, power_down: { wet: 0.3, priority: 3 }, power_up: { wet: 0.3, priority: 3 },
  radio_voice: { wet: 0.1, vol: 0.8, priority: 3 }, radio_click: { wet: 0.1 }, voice_murmur: { wet: 0.4, vol: 0.7 }, cough: { wet: 0.45, vol: 0.7 },
  typing: { wet: 0.2, vol: 0.6, priority: 1 }, paper: { wet: 0.15, vol: 0.7, priority: 1 }, pen: { wet: 0.1, vol: 0.6, priority: 1 }, keys: { wet: 0.3, vol: 0.6 },
  glass_crack: { wet: 0.5 }, door_creak: { wet: 0.45, vol: 0.8 }, curtain: { wet: 0.3, vol: 0.8 },
};

export function sfxMeta(name: SfxName): SfxMeta {
  return { ...DEFAULT_META, ...(META_OVERRIDES[name] ?? {}) };
}

// ---------------------------------------------------------------------------
// Extra builders used only by the ambience scheduler / engine (not SfxNames)
// ---------------------------------------------------------------------------

/** Car alarm, blocks away: two alternating tones, heavily lowpassed. */
function carAlarmFar(s: SynthCtx): number {
  const dur = 4.8;
  const o = osc(s, 'square', 900, 0, dur);
  for (let i = 0; i < 12; i++) o.frequency.setValueAtTime(i % 2 ? 900 : 1150, s.t0 + i * 0.4);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.8, 0.05], [3.8, 0.045], [dur, 0]]);
  chain(o, filter(s, 'lowpass', 900), g, s.out);
  return dur + 0.2;
}

/** Failing ballast: a tick with a little buzz tail. */
function ballastClick(s: SynthCtx): number {
  click(s, 0, 0.25, 3500, 0.005);
  const saw = osc(s, 'sawtooth', 120, 0.004, 0.09);
  const g = gain(s, 0);
  ramp(g.gain, s.t0 + 0.004, [[0, 0.05], [0.08, 0]]);
  chain(saw, filter(s, 'lowpass', 2500), g, s.out);
  return 0.12;
}

/** Something moving in the ductwork: metallic scrape with a hollow resonance. */
function ventScrape(s: SynthCtx): number {
  const r = s.rng;
  const dur = 0.9 + r.next() * 0.6;
  const n = noise(s, 'pink', 0, dur);
  const f = filter(s, 'bandpass', 1800, 5);
  ramp(f.frequency, s.t0, [[0, 1400 + r.next() * 600], [dur * 0.6, 2600], [dur, 1200]], true);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.2, 0.18], [dur * 0.7, 0.14], [dur, 0]]);
  chain(n, f, filter(s, 'peaking', 320, 6, 10), g, s.out);
  for (let i = 0; i < 3; i++) ping(s, { at: r.next() * dur, freq: 300 + r.next() * 120, dur: 0.12, vol: 0.08, type: 'triangle' });
  return dur + 0.3;
}

/** Intercom bed while a page is being spoken: hum + bandpassed air; `glitch` chops it. */
export function intercomBedBuilder(glitch: boolean): SfxBuilder {
  return (s) => {
    const hum = osc(s, 'sine', 120, 0);
    const hg = gain(s, 0.05);
    const air = noise(s, 'white', 0);
    const ag = gain(s, 0.035);
    const mix = gain(s, 0);
    ramp(mix.gain, s.t0, [[0, 0], [0.15, 1]]);
    chain(hum, hg, mix);
    chain(air, filter(s, 'highpass', 300), filter(s, 'lowpass', 3400), ag, mix);
    if (glitch) {
      const gate = gain(s, 1);
      const lfo = osc(s, 'square', 7.3, 0);
      const lg = gain(s, 0.5);
      gate.gain.value = 0.5;
      chain(lfo, lg, gate.gain);
      chain(mix, gate, s.out);
      for (let i = 0; i < 6; i++) click(s, 0.3 + s.rng.next() * 3, 0.15, 2000 + s.rng.next() * 1500, 0.01);
    } else mix.connect(s.out);
    return Infinity;
  };
}

/** One lonely step (no rhythm) — used by the UNEASY scheduler. */
function stepSingle(s: SynthCtx): number {
  burst(s, { at: 0, dur: 0.06, vol: 0.5, freq: 1100 + s.rng.next() * 400, q: 2.2, hp: 350 });
  thump(s, 0, 150, 85, 0.06, 0.15);
  return 0.15;
}

/** A ballast "swell" — hum rising then dipping — for PRE_OUTAGE. */
function humSwell(s: SynthCtx): number {
  const dur = 1.8;
  const saw = osc(s, 'sawtooth', 120, 0, dur);
  ramp(saw.frequency, s.t0, [[0, 120], [0.9, 123], [dur, 117]]);
  const g = gain(s, 0);
  ramp(g.gain, s.t0, [[0, 0], [0.7, 0.07], [1.1, 0.03], [1.5, 0.06], [dur, 0]]);
  chain(saw, filter(s, 'lowpass', 1800), g, s.out);
  return dur + 0.05;
}

export const EXTRA_SFX = {
  car_alarm_far: carAlarmFar,
  ballast_click: ballastClick,
  vent_scrape: ventScrape,
  step_single: stepSingle,
  hum_swell: humSwell,
} satisfies Record<string, SfxBuilder>;

export type ExtraSfxName = keyof typeof EXTRA_SFX;
