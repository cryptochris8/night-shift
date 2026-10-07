/**
 * NIGHT SHIFT — AudioEngine (module F). 100% Web Audio synthesis, nothing fetched.
 *
 * Graph:  voices → buses(ambience/sfx/music) → perception filters (lowpass/highpass, CCTV band + mono)
 *                → duck → menu duck → master → compressor → destination
 *         body bus (heartbeat/breath) → duck;  ui bus → master (never ducked)
 *         voices → wet sends → 4 convolvers (generated IRs, crossfaded per room class) → perception filters
 * Positioned sounds use HRTF PannerNodes in world space; the listener follows `setListener`.
 * Every method is a safe no-op before `unlock()`; state set earlier is applied on unlock.
 */
import type { IAudioEngine, Services, SfxHandle, SfxName, SfxOptions } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { CharacterId, PerceptionState, PowerState, RoomId, Settings, SoundState, Vec3 } from '../core/types';
import { DOOR_BY_ID, roomAt } from '../world/layout';
import { AmbienceMixer, type AmbienceHost } from './ambience';
import {
  EXTRA_SFX,
  SFX,
  intercomBedBuilder,
  makeImpulseResponse,
  makeNoiseBank,
  murmurBuilder,
  sfxMeta,
  type BusName,
  type ExtraSfxName,
  type NoiseBank,
  type ReverbClass,
  type SfxBuilder,
  type SfxMeta,
  type SynthCtx,
} from './synth';

const MAX_VOICES = 24;
const EYE = 1.65;
const REVERB_CLASSES: ReverbClass[] = ['small_room', 'corridor', 'hall', 'outdoors'];

interface Graph {
  master: GainNode;
  comp: DynamicsCompressorNode;
  duck: GainNode;
  menu: GainNode;
  menuLp: BiquadFilterNode;
  buses: Record<BusName, GainNode>;
  percIn: GainNode;
  lp: BiquadFilterNode;
  hp: BiquadFilterNode;
  stereoPath: GainNode;
  monoPath: GainNode;
  monoComp: DynamicsCompressorNode;
  percOut: GainNode;
  reverbIn: GainNode;
  reverbs: Record<ReverbClass, { conv: ConvolverNode; gain: GainNode }>;
  noise: NoiseBank;
}

interface Occlusion { lp: number; gain: number }

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Room class for the convolver crossfade + the base wet level of that room. */
function reverbClassFor(room: RoomId | null): { cls: ReverbClass; wet: number } {
  switch (room) {
    case 'exterior': return { cls: 'outdoors', wet: 0.6 };
    case 'corridor': case 'service_n': case 'service_e': case 'staff_pass': return { cls: 'corridor', wet: 1 };
    case 'generator': case 'electrical': case 'utility': case 'closed_wing': case 'imaging': return { cls: 'hall', wet: 1 };
    case 'waiting': return { cls: 'hall', wet: 0.7 };
    case 'restroom': return { cls: 'small_room', wet: 1.3 };
    case null: return { cls: 'corridor', wet: 0.8 };
    default: return { cls: 'small_room', wet: 1 };
  }
}

// ---------------------------------------------------------------------------
// Voice: one playing sound (a handle the caller may keep)
// ---------------------------------------------------------------------------

class Voice implements SfxHandle {
  playing = true;
  /** context time after which the nodes can be torn down (Infinity = sustained) */
  endAt = Infinity;
  /** finite-duration builders asked to loop are re-triggered at this time */
  nextTrigger = Infinity;
  period = 0;
  /** set when a finite builder was asked to loop (re-triggered by the engine) */
  builder: SfxBuilder | null = null;
  stopping = false;
  readonly nodes: AudioNode[] = [];
  sources: AudioScheduledSourceNode[] = [];
  pos: Vec3 | null = null;

  constructor(
    readonly label: string,
    readonly meta: SfxMeta,
    readonly ctx: AudioContext,
    readonly voiceGain: GainNode,
    readonly volGain: GainNode,
    readonly occl: BiquadFilterNode | null,
    readonly occlGain: GainNode | null,
    readonly panner: PannerNode | null,
    readonly started: number,
    private readonly occlusionFn: (pos: Vec3) => Occlusion,
  ) {}

  stop(fadeSeconds = 0.08): void {
    if (!this.playing || this.stopping) return;
    this.stopping = true;
    const now = this.ctx.currentTime;
    const f = Math.max(0.01, fadeSeconds);
    const g = this.voiceGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + f);
    for (const s of this.sources) {
      try { s.stop(now + f + 0.05); } catch { /* already stopped */ }
    }
    this.nextTrigger = Infinity;
    this.endAt = Math.min(this.endAt, now + f + 0.1);
  }

  setPosition(pos: Vec3): void {
    this.pos = pos;
    if (!this.panner) return;
    const now = this.ctx.currentTime;
    this.panner.positionX.setTargetAtTime(pos.x, now, 0.05);
    this.panner.positionY.setTargetAtTime(pos.y, now, 0.05);
    this.panner.positionZ.setTargetAtTime(pos.z, now, 0.05);
    this.refreshOcclusion();
  }

  setVolume(v: number): void {
    this.volGain.gain.setTargetAtTime(Math.max(0, v) * this.meta.vol, this.ctx.currentTime, 0.03);
  }

  refreshOcclusion(): void {
    if (!this.pos || !this.occl || !this.occlGain) return;
    const o = this.occlusionFn(this.pos);
    const now = this.ctx.currentTime;
    this.occl.frequency.setTargetAtTime(o.lp, now, 0.12);
    this.occlGain.gain.setTargetAtTime(o.gain, now, 0.12);
  }

  teardown(): void {
    this.playing = false;
    for (const s of this.sources) {
      try { s.stop(); } catch { /* not started / already stopped */ }
      try { s.disconnect(); } catch { /* fine */ }
    }
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* fine */ }
    }
    this.sources.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class AudioEngine implements IAudioEngine {
  private s!: Services;
  private ctx: AudioContext | null = null;
  private g: Graph | null = null;
  private ambience: AmbienceMixer | null = null;
  private _unlocked = false;
  private unlocking: Promise<void> | null = null;
  private rng!: RNG;
  private sfxRng!: RNG;
  private voices: Voice[] = [];
  private time = 0;

  // listener
  private listenerPos: Vec3 = { x: 0, y: EYE, z: 0 };
  private listenerYaw = 0;
  private listenerRoom: RoomId | null = null;
  private lastListenerSet = -10;

  // remembered state (applied when the context exists)
  private soundState: SoundState = 'NORMAL';
  private room: RoomId | null = null;
  private power: PowerState = 'normal';
  private cctv = false;
  private settings: Settings | null = null;
  private perception: PerceptionState | null = null;
  private perceptionChar: CharacterId | null = null;
  private tension = 0;

  // heartbeat / duck / silence
  private heartbeatOverride = 0;
  private autoBpm = 0;
  private nextBeat = 0;
  private duckUntil = -1;
  private duckAmount = 0;
  private silenceUntil = -1;
  private lastResumeTry = 0;
  private lastOcclusionRefresh = 0;
  private detuneTimer = 0;

  // intercom
  private speaking = 0;
  private voicesCache: SpeechSynthesisVoice[] = [];

  private roomAdj = new Map<RoomId, Map<RoomId, string[]>>();
  private unsubs: (() => void)[] = [];

  get unlocked(): boolean {
    return this._unlocked;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.forkRng();
    for (const d of services.layout.doors) {
      this.adj(d.a, d.b, d.id);
      this.adj(d.b, d.a, d.id);
    }
    const bus = services.bus;
    this.unsubs.push(
      bus.on('game:new', () => {
        this.forkRng();
        this.heartbeatOverride = 0;
        this.tension = 0;
        this.soundState = 'NORMAL';
        this.power = 'normal';
        this.cctv = false;
        this.ambience?.setRng(this.rng);
        this.ambience?.setState('NORMAL');
        this.ambience?.setPower('normal');
        this.ambience?.setTension(0);
        this.ambience?.setCCTV(false);
        for (const v of this.voices) v.stop(0.1);
      }),
      bus.on('door:changed', ({ id, open }) => {
        if (id === 'd_elevator') this.ambience?.elevatorMoving(open);
      }),
    );
    const ss = globalThis.speechSynthesis;
    if (ss) {
      const load = (): void => {
        try { this.voicesCache = ss.getVoices(); } catch { this.voicesCache = []; }
      };
      load();
      try { ss.addEventListener('voiceschanged', load); } catch { /* older browsers */ }
    }
  }

  private forkRng(): void {
    this.rng = this.s.rng.fork('audio');
    this.sfxRng = this.s.rng.fork('audio:sfx');
  }

  private adj(a: RoomId, b: RoomId, door: string): void {
    let m = this.roomAdj.get(a);
    if (!m) {
      m = new Map();
      this.roomAdj.set(a, m);
    }
    const list = m.get(b) ?? [];
    list.push(door);
    m.set(b, list);
  }

  async unlock(): Promise<void> {
    if (this.unlocking) return this.unlocking;
    this.unlocking = (async () => {
      try {
        if (!this.ctx) {
          const Ctor = globalThis.AudioContext;
          if (!Ctor) return;
          try {
            this.ctx = new Ctor({ latencyHint: 'interactive' });
          } catch (err) {
            console.warn('[audio] AudioContext unavailable', err);
            return;
          }
        }
        if (this.ctx.state === 'suspended') {
          // never hang newGame on a context the browser refuses to start: update() keeps retrying
          try { await Promise.race([this.ctx.resume(), wait(1500)]); } catch { /* needs a gesture */ }
        }
        if (!this.g) this.buildGraph(this.ctx);
        this._unlocked = true;
        this.applySettingsNow();
        this.applyRoom(this.room, true);
        this.applyPerception();
        this.ambience?.setState(this.soundState);
        this.ambience?.setPower(this.power);
        this.ambience?.setTension(this.tension);
      } finally {
        this.unlocking = null;
      }
    })();
    return this.unlocking;
  }

  private buildGraph(ctx: AudioContext): void {
    const noise = makeNoiseBank(ctx, this.s.rng.fork('audio:noise'));
    const master = new GainNode(ctx, { gain: 0.7 });
    const comp = new DynamicsCompressorNode(ctx, { threshold: -14, knee: 12, ratio: 3, attack: 0.01, release: 0.25 });
    master.connect(comp);
    comp.connect(ctx.destination);

    const menuLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.5 });
    const menu = new GainNode(ctx, { gain: 1 });
    const duck = new GainNode(ctx, { gain: 1 });
    duck.connect(menu);
    menu.connect(menuLp);
    menuLp.connect(master);

    // perception chain
    const percIn = new GainNode(ctx, { gain: 1 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 20000, Q: 0.6 });
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 40, Q: 0.6 });
    const stereoPath = new GainNode(ctx, { gain: 1 });
    const monoPath = new GainNode(ctx, { gain: 0, channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
    const monoComp = new DynamicsCompressorNode(ctx, { threshold: -30, knee: 10, ratio: 4, attack: 0.004, release: 0.12 });
    const percOut = new GainNode(ctx, { gain: 1 });
    percIn.connect(lp);
    lp.connect(hp);
    hp.connect(stereoPath);
    hp.connect(monoPath);
    monoPath.connect(monoComp);
    stereoPath.connect(percOut);
    monoComp.connect(percOut);
    percOut.connect(duck);

    const buses: Record<BusName, GainNode> = {
      ambience: new GainNode(ctx, { gain: 0.8 }),
      sfx: new GainNode(ctx, { gain: 0.9 }),
      music: new GainNode(ctx, { gain: 0.7 }),
      ui: new GainNode(ctx, { gain: 0.8 }),
      body: new GainNode(ctx, { gain: 0.9 }),
    };
    buses.ambience.connect(percIn);
    buses.sfx.connect(percIn);
    buses.music.connect(percIn);
    buses.body.connect(duck);
    buses.ui.connect(master);

    // reverbs
    const reverbIn = new GainNode(ctx, { gain: 1 });
    const irRng = this.s.rng.fork('audio:ir');
    const reverbs = {} as Graph['reverbs'];
    for (const cls of REVERB_CLASSES) {
      const conv = new ConvolverNode(ctx, { buffer: makeImpulseResponse(ctx, cls, irRng), disableNormalization: false });
      const gain = new GainNode(ctx, { gain: 0 });
      reverbIn.connect(conv);
      conv.connect(gain);
      gain.connect(percIn);
      reverbs[cls] = { conv, gain };
    }
    // ambience room tone gets a little space too
    const ambSend = new GainNode(ctx, { gain: 0.12 });
    buses.ambience.connect(ambSend);
    ambSend.connect(reverbIn);

    this.g = { master, comp, duck, menu, menuLp, buses, percIn, lp, hp, stereoPath, monoPath, monoComp, percOut, reverbIn, reverbs, noise };

    const host: AmbienceHost = {
      play: (name, opts) => this.play(name, opts),
      playExtra: (name, opts) => this.playExtra(name, opts),
      silence: (seconds) => this.silence(seconds),
      listenerPos: () => this.listenerPos,
      listenerRoom: () => this.listenerRoom,
      zones: () => this.s.store.get().zones,
    };
    this.ambience = new AmbienceMixer(ctx, buses.ambience, buses.music, buses.body, noise, this.rng, host, this.s.layout);
    this.ambience.setRoom(this.room);
    this.ambience.setCCTV(this.cctv);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const v of this.voices) v.teardown();
    this.voices = [];
    this.ambience?.dispose();
    this.ambience = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.g = null;
    this._unlocked = false;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // One-shots
  // ---------------------------------------------------------------------------

  play(name: SfxName, opts?: SfxOptions): SfxHandle | null {
    const builder = SFX[name];
    if (!builder) return null;
    return this.spawn(builder, sfxMeta(name), opts ?? {}, name);
  }

  private playExtra(name: ExtraSfxName, opts?: SfxOptions): SfxHandle | null {
    const meta: SfxMeta = { bus: 'sfx', wet: name === 'car_alarm_far' ? 0.1 : 0.5, vol: 1, priority: 1 };
    return this.spawn(EXTRA_SFX[name], meta, opts ?? {}, name);
  }

  private spawn(builder: SfxBuilder, meta: SfxMeta, opts: SfxOptions, label: string, startAt?: number): Voice | null {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g || !this._unlocked) return null;
    const now = ctx.currentTime;
    // the same sound twice in one frame is a double trigger, not a design choice
    if (startAt === undefined && this.voices.some((v) => v.label === label && now - v.started < 0.03 && !v.stopping)) return null;
    if (!this.makeRoom(meta.priority)) return null;

    const t0 = startAt ?? now + 0.005;
    const pos = opts.nonSpatial ? undefined : opts.pos;
    const vol = Math.max(0, opts.volume ?? 1) * meta.vol;
    const voiceGain = new GainNode(ctx, { gain: 1 });
    const volGain = new GainNode(ctx, { gain: opts.fadeIn ? 0 : vol });
    if (opts.fadeIn) {
      volGain.gain.setValueAtTime(0, t0);
      volGain.gain.linearRampToValueAtTime(vol, t0 + opts.fadeIn);
    }
    voiceGain.connect(volGain);
    const bus = g.buses[meta.bus];
    let occl: BiquadFilterNode | null = null;
    let occlGain: GainNode | null = null;
    let panner: PannerNode | null = null;
    const nodes: AudioNode[] = [voiceGain, volGain];
    if (pos) {
      const o = this.occlusion(pos);
      occl = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: o.lp, Q: 0.5 });
      occlGain = new GainNode(ctx, { gain: o.gain });
      panner = new PannerNode(ctx, {
        panningModel: this.settings?.quality === 'low' ? 'equalpower' : 'HRTF',
        distanceModel: 'inverse',
        refDistance: 1.5,
        maxDistance: 80,
        rolloffFactor: 1,
        positionX: pos.x,
        positionY: pos.y,
        positionZ: pos.z,
      });
      volGain.connect(occl);
      occl.connect(occlGain);
      occlGain.connect(panner);
      panner.connect(bus);
      nodes.push(occl, occlGain, panner);
    } else {
      const sp = new StereoPannerNode(ctx, { pan: Math.max(-1, Math.min(1, opts.pan ?? 0)) });
      volGain.connect(sp);
      sp.connect(bus);
      nodes.push(sp);
    }
    if (meta.wet > 0) {
      const d = pos ? Math.hypot(pos.x - this.listenerPos.x, pos.z - this.listenerPos.z) : 0;
      const wet = new GainNode(ctx, { gain: meta.wet * reverbClassFor(this.listenerRoom).wet * Math.min(1.6, 0.7 + d * 0.06) });
      volGain.connect(wet);
      wet.connect(g.reverbIn);
      nodes.push(wet);
    }

    const voice = new Voice(label, meta, ctx, voiceGain, volGain, occl, occlGain, panner, now, (p) => this.occlusion(p));
    voice.pos = pos ?? null;
    voice.nodes.push(...nodes);
    const synth: SynthCtx = { ctx, out: voiceGain, t0, rng: this.sfxRng, noise: g.noise, rate: Math.max(0.25, opts.rate ?? 1), loop: !!opts.loop, sources: voice.sources };
    let dur: number;
    try {
      dur = builder(synth);
    } catch (err) {
      console.warn('[audio] builder failed', label, err);
      voice.teardown();
      return null;
    }
    if (Number.isFinite(dur)) {
      if (opts.loop) {
        voice.period = Math.max(0.05, dur);
        voice.nextTrigger = t0 + voice.period;
        voice.builder = builder;
      } else {
        voice.endAt = t0 + dur + 0.15;
      }
    }
    this.voices.push(voice);
    return voice;
  }

  /** Keep the voice count bounded: steal the oldest lowest-priority voice if needed. */
  private makeRoom(priority: number): boolean {
    this.pruneVoices();
    if (this.voices.length < MAX_VOICES) return true;
    let victim: Voice | null = null;
    for (const v of this.voices) {
      if (v.stopping) continue;
      if (!victim || v.meta.priority < victim.meta.priority || (v.meta.priority === victim.meta.priority && v.started < victim.started)) victim = v;
    }
    if (!victim || victim.meta.priority > priority) return false;
    victim.stop(0.03);
    return true;
  }

  private pruneVoices(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (now >= v.endAt) {
        v.teardown();
        this.voices.splice(i, 1);
      }
    }
  }

  /** Lowpass + attenuation for a source relative to the listener's room (walls, doors). */
  private occlusion(pos: Vec3): Occlusion {
    const src = roomAt({ x: pos.x, z: pos.z });
    const lr = this.listenerRoom;
    if (!src || !lr || src === lr) return { lp: 20000, gain: 1 };
    const doors = this.roomAdj.get(lr)?.get(src);
    if (doors) {
      let anyOpen = false;
      for (const id of doors) {
        const def = DOOR_BY_ID[id];
        if (def?.kind === 'open') { anyOpen = true; break; }
        try {
          if (this.s.world.getDoor(id)?.open) { anyOpen = true; break; }
        } catch { /* world not built yet */ }
      }
      return anyOpen ? { lp: 5000, gain: 0.85 } : { lp: 1100, gain: 0.5 };
    }
    return { lp: 480, gain: 0.3 };
  }

  // ---------------------------------------------------------------------------
  // Listener / room / state
  // ---------------------------------------------------------------------------

  setListener(pos: Vec3, yaw: number): void {
    this.listenerPos = { x: pos.x, y: pos.y, z: pos.z };
    this.listenerYaw = yaw;
    this.lastListenerSet = this.time;
    this.applyListener();
  }

  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const p = this.listenerPos;
    const fx = -Math.sin(this.listenerYaw);
    const fz = -Math.cos(this.listenerYaw);
    const L = ctx.listener;
    const now = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, now, 0.02);
      L.positionY.setTargetAtTime(p.y, now, 0.02);
      L.positionZ.setTargetAtTime(p.z, now, 0.02);
      L.forwardX.setTargetAtTime(fx, now, 0.02);
      L.forwardY.setTargetAtTime(0, now, 0.02);
      L.forwardZ.setTargetAtTime(fz, now, 0.02);
      L.upX.setTargetAtTime(0, now, 0.02);
      L.upY.setTargetAtTime(1, now, 0.02);
      L.upZ.setTargetAtTime(0, now, 0.02);
    } else {
      const legacy = L as AudioListener & { setPosition?: (x: number, y: number, z: number) => void; setOrientation?: (...v: number[]) => void };
      legacy.setPosition?.(p.x, p.y, p.z);
      legacy.setOrientation?.(fx, 0, fz, 0, 1, 0);
    }
    const room = roomAt({ x: p.x, z: p.z });
    if (room !== this.listenerRoom) {
      this.listenerRoom = room;
      // acoustics follow where the ears actually are
      if (room) this.applyRoom(room);
      for (const v of this.voices) v.refreshOcclusion();
    }
  }

  setSoundState(st: SoundState): void {
    this.soundState = st;
    this.ambience?.setState(st);
    this.applyPerception();
  }

  setRoom(room: RoomId | null): void {
    this.applyRoom(room);
  }

  private applyRoom(room: RoomId | null, immediate = false): void {
    this.room = room;
    const g = this.g;
    if (!g || !this.ctx) return;
    const { cls } = reverbClassFor(room);
    const now = this.ctx.currentTime;
    for (const c of REVERB_CLASSES) {
      const target = c === cls ? 1 : 0;
      if (immediate) g.reverbs[c].gain.gain.setValueAtTime(target, now);
      else g.reverbs[c].gain.gain.setTargetAtTime(target, now, 0.35);
    }
    this.ambience?.setRoom(room);
  }

  setCCTVMode(on: boolean): void {
    this.cctv = on;
    this.ambience?.setCCTV(on);
    this.applyPerception();
  }

  setPowerState(p: PowerState): void {
    this.power = p;
    this.ambience?.setPower(p);
    this.applyPerception();
  }

  applySettings(st: Settings): void {
    this.settings = st;
    this.applySettingsNow();
  }

  private applySettingsNow(): void {
    const g = this.g;
    const st = this.settings;
    if (!g || !st || !this.ctx) return;
    const now = this.ctx.currentTime;
    const curve = (v: number): number => Math.pow(clamp01(v), 1.5);
    const sfx = curve(st.sfxVolume);
    g.master.gain.setTargetAtTime(this.masterLevel(), now, 0.05);
    g.buses.sfx.gain.setTargetAtTime(0.9 * sfx, now, 0.05);
    g.buses.ambience.gain.setTargetAtTime(0.8 * sfx, now, 0.05);
    g.buses.body.gain.setTargetAtTime(0.9 * sfx, now, 0.05);
    g.buses.ui.gain.setTargetAtTime(0.8 * sfx, now, 0.05);
    g.buses.music.gain.setTargetAtTime(0.7 * curve(st.musicVolume), now, 0.05);
  }

  private masterLevel(): number {
    const base = Math.pow(clamp01(this.settings?.masterVolume ?? 0.8), 1.5);
    return base * (this.speaking > 0 ? 0.7 : 1);
  }

  setPerception(p: PerceptionState | null, character: CharacterId | null): void {
    this.perception = p ? { ...p } : null;
    this.perceptionChar = character;
    this.applyPerception();
  }

  private applyPerception(): void {
    const g = this.g;
    if (!g || !this.ctx) return;
    const p = this.perception;
    const med = p?.medication ?? 0;
    const fear = p?.fear ?? 0;
    const fat = p?.fatigue ?? 0;
    let lp = 20000 * Math.pow(0.2, med) * (1 - 0.25 * fat); // 20 kHz → 4 kHz at med 1, duller when tired
    let hp = 40 + 260 * fear * fear;
    if (this.cctv) {
      lp = Math.min(lp, 3400);
      hp = Math.max(hp, 300);
    }
    const now = this.ctx.currentTime;
    g.lp.frequency.setTargetAtTime(lp, now, 0.5);
    g.hp.frequency.setTargetAtTime(hp, now, 0.5);
    g.stereoPath.gain.setTargetAtTime(this.cctv ? 0 : 1, now, 0.15);
    g.monoPath.gain.setTargetAtTime(this.cctv ? 1 : 0, now, 0.15);
    this.ambience?.setPerception(fear, med, fat);
    this.ambience?.setDetune(3 * med);
    // fear brings the heart into the mix; blackout alone slows it to something you notice
    let bpm = fear > 0.3 ? 58 + fear * 52 : 0;
    if (this.soundState === 'BLACKOUT' && !this.cctv) bpm = Math.max(bpm, 50);
    this.autoBpm = this.perceptionChar || this.soundState === 'BLACKOUT' ? bpm : 0;
  }

  // ---------------------------------------------------------------------------
  // Intercom / voices
  // ---------------------------------------------------------------------------

  async intercom(text: string, opts?: { glitch?: boolean }): Promise<void> {
    if (!this.ctx || !this.g || !this._unlocked) return;
    const glitch = !!opts?.glitch;
    this.play('intercom_click', { nonSpatial: true, volume: 0.8 });
    const bed = this.spawn(intercomBedBuilder(glitch), { bus: 'sfx', wet: 0.4, vol: 0.9, priority: 3 }, { nonSpatial: true }, 'intercom_bed');
    this.speaking++;
    this.g.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.1); // ~3 dB under: the PA sits on top of the room
    await wait(380);
    let spoken = false;
    try {
      spoken = await this.speak(text, glitch);
    } catch {
      spoken = false;
    }
    if (!spoken) {
      // PA-filtered murmur fallback for the estimated speaking time
      const seconds = Math.min(12, 0.9 + text.length * 0.065);
      const m = this.spawn(murmurBuilder(seconds, 150, false, 0.8), { bus: 'sfx', wet: 0.5, vol: 0.9, priority: 3 }, { nonSpatial: true }, 'intercom_murmur');
      if (glitch) this.play('intercom_static', { nonSpatial: true, volume: 0.4 });
      await wait(seconds * 1000);
      m?.stop(0.2);
    }
    await wait(250);
    bed?.stop(0.25);
    this.play('intercom_click', { nonSpatial: true, volume: 0.6 });
    this.speaking = Math.max(0, this.speaking - 1);
    if (this.ctx && this.g) this.g.master.gain.setTargetAtTime(this.masterLevel(), this.ctx.currentTime, 0.3);
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = this.voicesCache.length ? this.voicesCache : (() => {
      try { return globalThis.speechSynthesis?.getVoices() ?? []; } catch { return []; }
    })();
    const en = voices.filter((v) => /^en[-_]/i.test(v.lang) || v.lang === 'en');
    if (!en.length) return voices[0] ?? null;
    const preferred = /Google UK English Female|Google US English|Microsoft (Zira|Hazel|Susan|Libby|Aria|Jenny)|Samantha|Karen|Moira|Daniel/i;
    return en.find((v) => preferred.test(v.name)) ?? en.find((v) => /GB/i.test(v.lang)) ?? en[0];
  }

  private speak(text: string, glitch: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const ss = globalThis.speechSynthesis;
      if (!ss || typeof SpeechSynthesisUtterance === 'undefined') {
        resolve(false);
        return;
      }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92;
      u.pitch = 0.9;
      u.volume = clamp01(0.95 * Math.pow(this.settings?.masterVolume ?? 0.8, 0.7));
      const voice = this.pickVoice();
      if (voice) u.voice = voice;
      let done = false;
      let timer = 0;
      const finish = (ok: boolean): void => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      // onend is unreliable in some browsers: estimate as a backstop
      timer = window.setTimeout(() => finish(true), 1500 + text.length * 95);
      try {
        ss.cancel();
        ss.speak(u);
      } catch {
        finish(false);
        return;
      }
      if (glitch) {
        const stutters = 1 + this.rng.int(0, 1);
        for (let i = 0; i < stutters; i++) {
          window.setTimeout(() => {
            if (done) return;
            try {
              ss.pause();
              this.play('intercom_static', { nonSpatial: true, volume: 0.35 });
              window.setTimeout(() => { try { ss.resume(); } catch { /* ignore */ } }, 120 + this.rng.int(0, 160));
            } catch { /* ignore */ }
          }, 500 + i * 900 + this.rng.int(0, 600));
        }
      }
    });
  }

  murmur(pos: Vec3, seconds: number, opts?: { pitch?: number; whisper?: boolean }): SfxHandle | null {
    const pitch = opts?.pitch ?? 1;
    const hz = pitch > 20 ? pitch : 135 * pitch;
    const meta: SfxMeta = { bus: 'sfx', wet: opts?.whisper ? 0.25 : 0.4, vol: opts?.whisper ? 0.6 : 0.75, priority: 3 };
    return this.spawn(murmurBuilder(seconds, hz, !!opts?.whisper, 1), meta, { pos }, 'murmur');
  }

  // ---------------------------------------------------------------------------
  // Heartbeat / ducking / tension
  // ---------------------------------------------------------------------------

  setHeartbeat(bpm: number): void {
    this.heartbeatOverride = Math.max(0, bpm);
  }

  duck(seconds: number, amount = 0.6): void {
    const g = this.g;
    if (!g || !this.ctx) return;
    this.duckAmount = clamp01(amount);
    this.duckUntil = this.time + Math.max(0, seconds);
    if (this.silenceUntil > this.time) return;
    g.duck.gain.setTargetAtTime(1 - this.duckAmount, this.ctx.currentTime, 0.03);
  }

  silence(seconds: number): void {
    const g = this.g;
    if (!g || !this.ctx) return;
    this.silenceUntil = this.time + Math.max(0.2, seconds);
    const now = this.ctx.currentTime;
    g.duck.gain.cancelScheduledValues(now);
    g.duck.gain.setValueAtTime(g.duck.gain.value, now);
    g.duck.gain.linearRampToValueAtTime(0.0001, now + 0.04);
  }

  setTension(t: number): void {
    this.tension = clamp01(t);
    this.ambience?.setTension(this.tension);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(dt: number, _gdt: number): void {
    this.time += dt;
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g || !this._unlocked) return;
    const now = ctx.currentTime;

    // autoplay policy / tab suspension: keep trying to run
    if (ctx.state === 'suspended' && this.time - this.lastResumeTry > 2) {
      this.lastResumeTry = this.time;
      void ctx.resume().catch(() => undefined);
    }

    // listener fallback: follow the active character when nobody is feeding us a pose
    if (this.time - this.lastListenerSet > 0.5) {
      const st = this.s.store.get();
      if (st.activeView !== 'cctv') {
        const c = st.characters[st.activeView];
        this.listenerPos = { x: c.position.x, y: c.position.y + EYE, z: c.position.z };
        this.listenerYaw = c.yaw;
        this.applyListener();
      }
    }

    // menus: pull the world back behind the UI
    const st = this.s.store.get();
    const inWorld = (st.screen === 'playing' && !st.paused) || st.screen === 'intro' || st.screen === 'ending';
    g.menu.gain.setTargetAtTime(inWorld ? 1 : 0.35, now, 0.2);
    g.menuLp.frequency.setTargetAtTime(inWorld ? 20000 : 1800, now, 0.2);

    // duck / silence release
    if (this.silenceUntil >= 0 && this.time >= this.silenceUntil) {
      this.silenceUntil = -1;
      g.duck.gain.cancelScheduledValues(now);
      g.duck.gain.setValueAtTime(g.duck.gain.value, now);
      g.duck.gain.setTargetAtTime(this.duckUntil > this.time ? 1 - this.duckAmount : 1, now, 0.45);
    } else if (this.duckUntil >= 0 && this.time >= this.duckUntil && this.silenceUntil < 0) {
      this.duckUntil = -1;
      g.duck.gain.setTargetAtTime(1, now, 0.4);
    }

    // medication wobble on the ambience detune (slow, queasy)
    const med = this.perception?.medication ?? 0;
    this.detuneTimer += dt;
    if (med > 0.35 && this.detuneTimer > 0.25) {
      this.detuneTimer = 0;
      this.ambience?.setDetune(3 * med + Math.sin(this.time * 0.6) * 2.5 * med);
    }

    // heartbeat
    const bpm = this.heartbeatOverride > 0 ? this.heartbeatOverride : this.autoBpm;
    if (bpm > 0 && this.silenceUntil < 0) {
      if (this.nextBeat < now) this.nextBeat = now + 0.1;
      const vol = 0.45 + 0.55 * clamp01((bpm - 50) / 90);
      while (this.nextBeat < now + 0.25) {
        this.spawn(SFX.heartbeat, { ...sfxMeta('heartbeat'), vol }, { nonSpatial: true }, 'heartbeat', this.nextBeat);
        this.nextBeat += 60 / bpm;
      }
    } else {
      this.nextBeat = 0;
    }

    // finite builders asked to loop: re-trigger seamlessly ahead of time
    for (const v of this.voices) {
      const b = v.builder;
      if (!b || v.stopping || v.nextTrigger === Infinity) continue;
      if (v.nextTrigger < now + 0.12) {
        const synth: SynthCtx = { ctx, out: v.voiceGain, t0: v.nextTrigger, rng: this.sfxRng, noise: g.noise, rate: 1, loop: true, sources: v.sources };
        try {
          const d = b(synth);
          v.nextTrigger += Number.isFinite(d) ? Math.max(0.05, d) : Infinity;
        } catch {
          v.nextTrigger = Infinity;
        }
      }
    }

    // moving listener → doors open/close behind sources: refresh occlusion a few times a second
    if (this.time - this.lastOcclusionRefresh > 0.3) {
      this.lastOcclusionRefresh = this.time;
      for (const v of this.voices) if (v.pos && (v.nextTrigger !== Infinity || v.endAt === Infinity)) v.refreshOcclusion();
    }

    this.pruneVoices();
    this.ambience?.update(dt);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
