/**
 * NIGHT SHIFT — ambience: looping synthesized layers crossfaded by sound state × room × power,
 * plus the per-state random event scheduler. Everything is seeded (`services.rng.fork('audio')`).
 * The mixer never touches the destination directly: the engine hands it the ambience, music and
 * body buses and a host interface for positioned one-shots and hard silences.
 */
import type { SfxHandle, SfxName, SfxOptions } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { HospitalLayout, PowerState, RoomDef, RoomId, SoundState, Vec2, Vec3, ZoneId } from '../core/types';
import { rectContains } from '../world/layout';
import type { ExtraSfxName, NoiseBank } from './synth';

export interface AmbienceHost {
  play(name: SfxName, opts?: SfxOptions): SfxHandle | null;
  playExtra(name: ExtraSfxName, opts?: SfxOptions): SfxHandle | null;
  silence(seconds: number): void;
  listenerPos(): Vec3;
  listenerRoom(): RoomId | null;
  zones(): Readonly<Record<ZoneId, boolean>>;
}

type LayerName =
  | 'hvac' | 'ballast' | 'genHum' | 'vent' | 'rain' | 'traffic' | 'vending'
  | 'drone' | 'highSine' | 'breath' | 'camHum' | 'elevator' | 'preDrone';

interface Layer {
  gain: GainNode;
  target: number;
  /** time constant for setTargetAtTime (≈ 1 s crossfades by default) */
  tc: number;
}

interface Pending { at: number; fn: () => void }

const VENDING_POS: Vec3 = { x: -9.5, y: 1.2, z: -9.3 };
const GENERATOR_POS: Vec3 = { x: 14, y: 1.0, z: 11.6 };
const ELEVATOR_POS: Vec3 = { x: 16, y: 1.2, z: -1.5 };

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export class AmbienceMixer {
  private layers = {} as Record<LayerName, Layer>;
  private state: SoundState = 'NORMAL';
  private room: RoomId | null = null;
  private power: PowerState = 'normal';
  private cctv = false;
  private tension = 0;
  private fear = 0;
  private medication = 0;
  private fatigue = 0;
  private detuneCents = 0;
  private time = 0;
  private pending: Pending[] = [];
  private nextEvent = 6;
  private nextMonitor = 5;
  private nextDrip = 3;
  private nextKnock = 0;
  private nextBallastClick = 0;
  private nextTraffic = 12;
  private resolutionT = 0;
  private breathPhase = 0;
  private ballastOscs: OscillatorNode[] = [];
  private rainFilter!: BiquadFilterNode;
  private rainDrops!: GainNode;
  private trafficSwell!: GainNode;
  private vendingPanner!: PannerNode;
  private genPanner!: PannerNode;
  private genFilter!: BiquadFilterNode;
  private breathFilter!: BiquadFilterNode;
  private breathEnv!: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private elevatorOsc!: OscillatorNode;
  private roomDef: RoomDef | null = null;
  private roomDetune = 0;
  private disposed = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly musicOut: AudioNode,
    private readonly bodyOut: AudioNode,
    private readonly noise: NoiseBank,
    private rng: RNG,
    private readonly host: AmbienceHost,
    private readonly layout: HospitalLayout,
  ) {
    this.build();
    this.retarget();
  }

  // ---------------------------------------------------------------------------
  // Graph
  // ---------------------------------------------------------------------------

  private layer(name: LayerName, dest: AudioNode, tc = 0.4): GainNode {
    const g = new GainNode(this.ctx, { gain: 0 });
    g.connect(dest);
    this.layers[name] = { gain: g, target: 0, tc };
    return g;
  }

  private loop(kind: keyof NoiseBank, rate = 1): AudioBufferSourceNode {
    const buf = this.noise[kind];
    const n = new AudioBufferSourceNode(this.ctx, { buffer: buf, loop: true, playbackRate: rate });
    n.start(this.ctx.currentTime, this.rng.next() * (buf.duration - 0.1));
    return n;
  }

  private tone(type: OscillatorType, freq: number, dest: AudioNode, level: number): OscillatorNode {
    const o = new OscillatorNode(this.ctx, { type, frequency: freq });
    const g = new GainNode(this.ctx, { gain: level });
    o.connect(g);
    g.connect(dest);
    o.start();
    return o;
  }

  private lfo(freq: number, depth: number, param: AudioParam): OscillatorNode {
    const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: freq });
    const g = new GainNode(this.ctx, { gain: depth });
    o.connect(g);
    g.connect(param);
    o.start();
    return o;
  }

  private panner(pos: Vec3): PannerNode {
    const p = new PannerNode(this.ctx, {
      panningModel: 'equalpower', // ambience beds do not need HRTF, and it is costly
      distanceModel: 'inverse',
      refDistance: 1.5,
      maxDistance: 80,
      rolloffFactor: 1,
      positionX: pos.x,
      positionY: pos.y,
      positionZ: pos.z,
    });
    p.connect(this.out);
    return p;
  }

  private build(): void {
    const ctx = this.ctx;
    // HVAC: brown noise, lowpass 120 Hz, slow breathing LFO on cutoff and level
    {
      const g = this.layer('hvac', this.out);
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 120, Q: 0.7 });
      this.lfo(0.07, 30, lp.frequency);
      const inner = new GainNode(ctx, { gain: 0.8 });
      this.lfo(0.05, 0.15, inner.gain);
      this.loop('brown').connect(lp);
      lp.connect(inner);
      inner.connect(g);
    }
    // Ballast hum: 60/120/180 (+ a faint sawtooth edge at 120 for the buzz)
    {
      const g = this.layer('ballast', this.out);
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1400 });
      lp.connect(g);
      this.ballastOscs.push(this.tone('sine', 60, lp, 0.08));
      this.ballastOscs.push(this.tone('sine', 120, lp, 0.06));
      this.ballastOscs.push(this.tone('sawtooth', 120, lp, 0.012));
      this.ballastOscs.push(this.tone('sine', 180, lp, 0.028));
      this.ballastOscs.push(this.tone('sine', 240, lp, 0.01));
    }
    // Generator hum: positioned at the unit, 50/100/150 + 30 Hz thrum, filtered by room relation
    {
      this.genPanner = this.panner(GENERATOR_POS);
      this.genFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 400 });
      const g = this.layer('genHum', this.genFilter);
      this.genFilter.connect(this.genPanner);
      this.tone('sawtooth', 50, g, 0.12);
      this.tone('sine', 30, g, 0.3);
      this.tone('sawtooth', 100, g, 0.05);
      this.tone('sine', 150, g, 0.025);
      const rattle = this.loop('brown');
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 220, Q: 1.2 });
      const rg = new GainNode(ctx, { gain: 0.25 });
      this.lfo(1.5, 0.12, rg.gain);
      rattle.connect(bp);
      bp.connect(rg);
      rg.connect(g);
    }
    // Ventilation hiss: pink noise bandpass 1.2 kHz, breathy LFO
    {
      const g = this.layer('vent', this.out);
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1200, Q: 0.7 });
      const inner = new GainNode(ctx, { gain: 0.5 });
      this.lfo(0.09, 0.12, inner.gain);
      this.loop('pink').connect(bp);
      bp.connect(inner);
      inner.connect(g);
    }
    // Rain: pink noise with a room-dependent lowpass; droplets are a separate gain fed by scheduled pings
    {
      const g = this.layer('rain', this.out, 0.6);
      this.rainFilter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 6000, Q: 0.5 });
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 500 });
      const body = new GainNode(ctx, { gain: 0.6 });
      this.lfo(0.11, 0.12, body.gain);
      this.loop('pink').connect(hp);
      hp.connect(this.rainFilter);
      this.rainFilter.connect(body);
      body.connect(g);
      this.rainDrops = new GainNode(ctx, { gain: 1 });
      this.rainDrops.connect(this.rainFilter);
    }
    // Far traffic: brown noise bandpass 150 Hz with swells
    {
      const g = this.layer('traffic', this.out, 0.8);
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 150, Q: 0.8 });
      this.trafficSwell = new GainNode(ctx, { gain: 1 });
      this.loop('brown').connect(bp);
      bp.connect(this.trafficSwell);
      this.trafficSwell.connect(g);
    }
    // Vending hum: positioned at the machines
    {
      this.vendingPanner = this.panner(VENDING_POS);
      const g = this.layer('vending', this.vendingPanner);
      this.tone('sine', 60, g, 0.16);
      this.tone('triangle', 120, g, 0.07);
      const hiss = this.loop('brown');
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 320 });
      const hg = new GainNode(ctx, { gain: 0.14 });
      hiss.connect(lp);
      lp.connect(hg);
      hg.connect(g);
    }
    // THREAT sub drone: two detuned sines beating slowly + faint octave
    {
      const g = this.layer('drone', this.musicOut, 1.2);
      this.droneOscs.push(this.tone('sine', 36, g, 0.5));
      this.droneOscs.push(this.tone('sine', 36.45, g, 0.45));
      this.droneOscs.push(this.tone('sine', 72, g, 0.08));
      const n = this.loop('brown');
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 80 });
      const ng = new GainNode(ctx, { gain: 0.25 });
      n.connect(lp);
      lp.connect(ng);
      ng.connect(g);
    }
    // PRE_OUTAGE creeping 40 Hz drone
    {
      const g = this.layer('preDrone', this.musicOut, 2.0);
      this.tone('sine', 40, g, 0.5);
      this.tone('triangle', 40, g, 0.08);
    }
    // RESOLUTION thin high sine, breathing slowly
    {
      const g = this.layer('highSine', this.musicOut, 2.5);
      const inner = new GainNode(ctx, { gain: 0.7 });
      this.lfo(0.05, 0.3, inner.gain);
      this.tone('sine', 1760, inner, 1);
      inner.connect(g);
    }
    // Breath of the active character (body bus — not spatialised, not reverberated)
    {
      const g = this.layer('breath', this.bodyOut, 0.8);
      this.breathFilter = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 800, Q: 0.9 });
      this.breathEnv = new GainNode(ctx, { gain: 0 });
      this.loop('pink').connect(this.breathFilter);
      this.breathFilter.connect(this.breathEnv);
      this.breathEnv.connect(g);
    }
    // CCTV monitoring hum: mains + a high whine + hiss
    {
      const g = this.layer('camHum', this.out, 0.3);
      this.tone('sine', 60, g, 0.12);
      this.tone('sawtooth', 120, g, 0.02);
      this.tone('sine', 12500, g, 0.012);
      const hiss = this.loop('white');
      const bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 2500, Q: 0.4 });
      const hg = new GainNode(ctx, { gain: 0.04 });
      hiss.connect(bp);
      bp.connect(hg);
      hg.connect(g);
    }
    // Elevator motor whine (positioned at the doors; driven by door events)
    {
      const p = this.panner(ELEVATOR_POS);
      const g = this.layer('elevator', p, 0.5);
      this.elevatorOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 85 });
      const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 500, Q: 1.5 });
      const og = new GainNode(ctx, { gain: 0.18 });
      this.lfo(7.3, 1.6, this.elevatorOsc.frequency);
      this.elevatorOsc.connect(lp);
      lp.connect(og);
      og.connect(g);
      this.elevatorOsc.start();
      this.tone('sine', 60, g, 0.2);
    }
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------

  setRng(rng: RNG): void {
    this.rng = rng;
  }

  setState(s: SoundState): void {
    if (s === this.state) return;
    const prev = this.state;
    this.state = s;
    this.pending.length = 0;
    this.resolutionT = 0;
    // let a state change be felt immediately: first event comes sooner
    this.nextEvent = this.time + this.eventInterval() * 0.5;
    if (s === 'THREAT' && prev !== 'THREAT') this.nextEvent = this.time + 3;
    this.retarget();
  }

  setRoom(room: RoomId | null): void {
    this.room = room;
    this.roomDef = room ? this.layout.rooms.find((r) => r.id === room) ?? null : null;
    // per-room ballast detune: deterministic from the room id
    let h = 0;
    for (const ch of room ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    this.roomDetune = ((h % 1300) / 100) - 6.5;
    this.retarget();
  }

  setPower(p: PowerState): void {
    this.power = p;
    this.retarget();
  }

  setCCTV(on: boolean): void {
    this.cctv = on;
    this.retarget();
  }

  setTension(t: number): void {
    this.tension = Math.max(0, Math.min(1, t));
    this.retarget();
  }

  setPerception(fear: number, medication: number, fatigue: number): void {
    this.fear = fear;
    this.medication = medication;
    this.fatigue = fatigue;
    this.retarget();
  }

  /** Extra detune (cents) on top of the room detune — medication. */
  setDetune(cents: number): void {
    this.detuneCents = cents;
    this.applyDetune();
  }

  /** Elevator motor: the car arriving (doors about to open) or leaving (after closing). */
  elevatorMoving(arriving: boolean): void {
    const now = this.ctx.currentTime;
    const g = this.layers.elevator.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    const f = this.elevatorOsc.frequency;
    f.cancelScheduledValues(now);
    if (arriving) {
      g.linearRampToValueAtTime(0.9, now + 0.3);
      g.linearRampToValueAtTime(0.7, now + 1.8);
      g.linearRampToValueAtTime(0, now + 2.6);
      f.setValueAtTime(85, now);
      f.linearRampToValueAtTime(55, now + 2.4);
    } else {
      g.linearRampToValueAtTime(0.8, now + 1.0);
      g.linearRampToValueAtTime(0.6, now + 3.5);
      g.linearRampToValueAtTime(0, now + 5.0);
      f.setValueAtTime(55, now);
      f.linearRampToValueAtTime(90, now + 1.2);
      f.linearRampToValueAtTime(90, now + 4.5);
    }
    this.layers.elevator.target = 0;
  }

  // ---------------------------------------------------------------------------
  // Mix targets
  // ---------------------------------------------------------------------------

  private tags(): string[] {
    return this.roomDef?.tags ?? [];
  }

  private retarget(): void {
    const outdoor = !!this.roomDef?.outdoor;
    const tags = this.tags();
    const service = tags.includes('service') || this.room === 'closed_wing';
    const clinical = tags.includes('clinical');
    const glassToOutside = this.room === 'waiting' || this.room === 'corridor';
    const mains = this.power === 'normal' || this.power === 'unstable';
    const gen = this.power === 'generator';
    const st = this.state;
    const sub = st === 'THREAT' ? 0.55 : st === 'UNEASY' ? 0.9 : st === 'RESOLUTION' ? 0.5 : 1; // escalation is mostly subtraction
    const dull = 1 - 0.3 * this.fatigue;

    // HVAC
    let hvac = 0;
    if (mains) hvac = outdoor ? 0.1 : service ? 0.6 : this.room === 'waiting' ? 0.45 : 0.5;
    else if (gen) hvac = service ? 0.14 : 0.05;
    if (st === 'PRE_OUTAGE') hvac *= 1.1;
    this.set('hvac', hvac * sub * dull);

    // Ballast hum (mains only, lit rooms only)
    let ballast = 0;
    if (mains && !outdoor && (this.roomDef?.lit ?? true)) ballast = service || this.room === 'restroom' ? 0.5 : 0.35;
    if (st === 'PRE_OUTAGE') ballast *= 1.3;
    if (st === 'THREAT') ballast *= 0.7;
    this.set('ballast', ballast);

    // Generator hum: louder near the generator room, lowpassed through walls elsewhere
    let genHum = 0;
    let genLp = 400;
    if (gen) {
      if (this.room === 'generator') { genHum = 0.9; genLp = 1200; }
      else if (this.room === 'electrical' || this.room === 'service_n' || this.room === 'service_e') { genHum = 0.5; genLp = 500; }
      else { genHum = 0.22; genLp = 160; }
    }
    this.set('genHum', genHum);
    this.genFilter.frequency.setTargetAtTime(genLp, this.ctx.currentTime, 0.5);

    // Ventilation
    let vent = 0;
    if (mains) vent = outdoor ? 0 : clinical ? 0.3 : 0.24;
    else if (gen) vent = 0.08;
    this.set('vent', vent * sub * dull);

    // Rain
    let rain: number;
    let rainLp: number;
    if (outdoor) { rain = 1.0; rainLp = 9000; }
    else if (glassToOutside) { rain = 0.35; rainLp = 900; }
    else if (service) { rain = 0.16; rainLp = 600; }
    else { rain = 0.1; rainLp = 450; }
    if (st === 'BLACKOUT') rain *= 1.35;
    if (st === 'RESOLUTION') rain *= Math.max(0.25, 1 - this.resolutionT / 80);
    this.set('rain', rain);
    this.rainFilter.frequency.setTargetAtTime(rainLp, this.ctx.currentTime, 0.4);

    // Traffic
    this.set('traffic', outdoor ? 0.3 : glassToOutside ? 0.12 : 0.03);

    // Vending (positioned; audible from the waiting room / corridor)
    const vendPowered = mains || (gen && this.host.zones().public);
    const vendRoom = this.room === 'waiting' ? 1 : this.room === 'corridor' ? 0.5 : 0;
    this.set('vending', vendPowered ? vendRoom : 0);

    // Drones (music bus)
    let drone = this.tension * 0.4;
    if (st === 'THREAT') drone = 0.5 + 0.5 * this.tension;
    this.set('drone', drone);
    this.set('preDrone', st === 'PRE_OUTAGE' ? 0.3 : 0);
    this.set('highSine', st === 'RESOLUTION' ? 0.05 : 0);

    // Breath: blackout always; fear otherwise (never in CCTV — nobody is breathing there)
    let breath = 0;
    if (!this.cctv) {
      if (st === 'BLACKOUT') breath = 0.3;
      breath = Math.max(breath, this.fear * this.fear * 0.45);
    }
    this.set('breath', breath);

    this.set('camHum', this.cctv ? 0.3 : 0);
    this.applyDetune();
  }

  private set(name: LayerName, target: number): void {
    const l = this.layers[name];
    if (!l || Math.abs(l.target - target) < 1e-4) return;
    l.target = target;
    l.gain.gain.setTargetAtTime(target, this.ctx.currentTime, l.tc);
  }

  private applyDetune(): void {
    const cents = this.roomDetune + this.detuneCents;
    const now = this.ctx.currentTime;
    for (const o of this.ballastOscs) o.detune.setTargetAtTime(cents, now, 0.3);
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const now = this.ctx.currentTime;
    const r = this.rng;

    // deferred callbacks (multi-part events)
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= this.time);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > this.time);
        for (const p of due) p.fn();
      }
    }

    // breathing: inhale / hold / exhale cycle, faster with fear, slower when medicated
    if (this.layers.breath.target > 0.001) {
      const period = Math.max(2.0, 3.8 - this.fear * 1.4 + this.medication * 0.8);
      this.breathPhase = (this.breathPhase + dt / period) % 1;
      const ph = this.breathPhase;
      let env = 0;
      let freq = 800;
      if (ph < 0.34) { env = Math.sin((ph / 0.34) * Math.PI) * 0.9; freq = 1000; }
      else if (ph < 0.42) { env = 0.02; freq = 800; }
      else if (ph < 0.86) { env = Math.sin(((ph - 0.42) / 0.44) * Math.PI); freq = 520; }
      this.breathEnv.gain.setTargetAtTime(env, now, 0.06);
      this.breathFilter.frequency.setTargetAtTime(freq, now, 0.15);
    }

    // PRE_OUTAGE: hum detunes and swells; ballast click rhythm
    if (this.state === 'PRE_OUTAGE') {
      const wob = Math.sin(this.time * 0.7) * 9 + Math.sin(this.time * 2.3) * 4;
      for (const o of this.ballastOscs) o.detune.setTargetAtTime(this.roomDetune + this.detuneCents + wob, now, 0.1);
      const swell = 1 + 0.35 * Math.sin(this.time * 1.9) + (r.chance(0.01) ? -0.5 : 0);
      this.layers.ballast.gain.gain.setTargetAtTime(this.layers.ballast.target * swell, now, 0.12);
      if (this.time >= this.nextBallastClick && this.layers.ballast.target > 0) {
        this.host.playExtra('ballast_click', { pos: this.ceilingPoint(), volume: 0.5 });
        this.nextBallastClick = this.time + (r.chance(0.3) ? 0.12 : 0.3 + r.next() * 0.5);
      }
    }

    // distant monitors: sparse soft beeps, clinical rooms, mains only
    if (this.time >= this.nextMonitor) {
      this.nextMonitor = this.time + 4 + r.next() * 5;
      const mains = this.power === 'normal' || this.power === 'unstable';
      if (mains && this.tags().includes('clinical') && this.state !== 'BLACKOUT') {
        const mon = this.pickMonitorPos();
        if (mon) {
          const n = r.chance(0.3) ? 2 : 1;
          for (let i = 0; i < n; i++) this.defer(i * 0.9, () => this.host.play('monitor_beep', { pos: mon, volume: 0.25 }));
        }
      }
    }

    // dripping in service areas once the building is on the generator (or dark)
    if (this.time >= this.nextDrip) {
      this.nextDrip = this.time + 2.5 + r.next() * 4.5;
      const service = this.tags().includes('service') || this.room === 'closed_wing';
      if (service && (this.power === 'generator' || this.power === 'blackout')) {
        this.host.play('water_drip', { pos: this.floorPointInRoom(), volume: 0.35 + r.next() * 0.3 });
      }
    }

    // generator mechanical knocks (~1.5 Hz, irregular) through the positioned generator layer
    if (this.layers.genHum.target > 0 && this.time >= this.nextKnock) {
      this.nextKnock = this.time + 0.55 + r.next() * 0.25;
      const near = this.room === 'generator' ? 0.5 : this.room === 'service_n' || this.room === 'electrical' ? 0.25 : 0.1;
      if (r.chance(0.85)) this.host.play('knock_soft', { pos: GENERATOR_POS, volume: near, rate: 1.6 + r.next() * 0.3 });
    }

    // far traffic swells
    if (this.time >= this.nextTraffic) {
      this.nextTraffic = this.time + 15 + r.next() * 25;
      const g = this.trafficSwell.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(1, now);
      g.linearRampToValueAtTime(2.6, now + 3);
      g.linearRampToValueAtTime(1, now + 7.5);
    }

    // rain droplets (individual plinks on the canopy / glass) — only where the rain is close
    if (this.layers.rain.target > 0.3 && r.chance(Math.min(1, dt * 9 * this.layers.rain.target))) this.droplet();

    if (this.state === 'RESOLUTION') {
      this.resolutionT += dt;
      if (Math.floor(this.resolutionT) !== Math.floor(this.resolutionT - dt)) this.retarget();
    }

    // random events
    if (this.time >= this.nextEvent) {
      this.nextEvent = this.time + this.eventInterval();
      this.fireEvent();
    }
  }

  private defer(seconds: number, fn: () => void): void {
    this.pending.push({ at: this.time + seconds, fn });
  }

  /** One raindrop hitting something hard: a 30 ms downward sine chirp into the rain layer. */
  private droplet(): void {
    const now = this.ctx.currentTime;
    const f = 2600 + this.rng.next() * 2600;
    const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: f });
    o.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.03);
    const g = new GainNode(this.ctx, { gain: 0 });
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.03 + this.rng.next() * 0.05, now + 0.002);
    g.gain.linearRampToValueAtTime(0, now + 0.03);
    o.connect(g);
    g.connect(this.rainDrops);
    o.start(now);
    o.stop(now + 0.05);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }

  private eventInterval(): number {
    const r = this.rng;
    switch (this.state) {
      case 'NORMAL': return 8 + r.next() * 17;
      case 'UNEASY': return 12 + r.next() * 18;
      case 'PRE_OUTAGE': return 6 + r.next() * 8;
      case 'BLACKOUT': return 10 + r.next() * 12;
      case 'GENERATOR': return 9 + r.next() * 11;
      case 'THREAT': return 7 + r.next() * 11;
      case 'RESOLUTION': return 25 + r.next() * 30;
    }
  }

  private fireEvent(): void {
    const r = this.rng;
    const h = this.host;
    const far = (lo: number, hi: number): Vec3 => this.farPoint(lo, hi);
    type Ev = { w: number; f: () => void };
    const ordinary: Ev[] = [
      { w: 3, f: () => h.play('cart_roll', { pos: far(10, 22), volume: 0.6 }) },
      { w: 3, f: () => h.play('door_close', { pos: this.doorPointFar(), volume: 0.5 }) },
      { w: 2, f: () => { const p = far(6, 14); for (let i = 0; i < 3; i++) this.defer(i * 0.42, () => h.play('footstep_tile', { pos: p, volume: 0.45, rate: 1.1 })); } },
      { w: 2, f: () => h.play('voice_murmur', { pos: this.layout.points.station_counter, volume: 0.35 }) },
      { w: 2, f: () => { const j = this.layout.points.john_seat; h.play('cough', { pos: { x: j.x + 1.3, y: 1.2, z: j.z }, volume: 0.4 }); } }, // two seats over
      { w: 1, f: () => h.play('elevator_tone', { pos: ELEVATOR_POS, volume: 0.35 }) },
      { w: 1, f: () => h.play('intercom_click', { nonSpatial: true, volume: 0.25 }) },
      { w: 2, f: () => h.play('pipe_knock', { pos: this.servicePoint(), volume: 0.4 }) },
      { w: 1, f: () => h.play('typing', { pos: this.layout.points.station_counter, volume: 0.3 }) },
      { w: 1, f: () => h.play('keys', { pos: far(6, 16), volume: 0.3 }) },
      { w: 1, f: () => h.play('phone_buzz', { pos: this.layout.points.station_counter, volume: 0.25 }) },
    ];
    const wrong: Ev[] = [
      { w: 3, f: () => h.play('door_close', { pos: this.wrongDirectionPoint(), volume: 0.4 }) },
      { w: 3, f: () => h.play('knock_soft', { pos: this.wrongDirectionPoint(), volume: 0.5 }) },
      { w: 3, f: () => { const p = far(5, 9); h.playExtra('step_single', { pos: p, volume: 0.5 }); if (r.chance(0.5)) this.defer(0.7 + r.next() * 0.9, () => h.playExtra('step_single', { pos: p, volume: 0.4 })); } },
      { w: 2, f: () => h.play('hvac_thump', { pos: this.ceilingPoint(), volume: 0.5 }) },
      { w: 1, f: () => h.play('light_buzz', { pos: this.ceilingPoint(), volume: 0.35 }) },
      { w: 1, f: () => h.play('whisper', { pos: this.wrongDirectionPoint(), volume: 0.3 }) },
    ];
    let table: Ev[];
    switch (this.state) {
      case 'NORMAL':
        table = ordinary;
        break;
      case 'UNEASY':
        table = [...ordinary.map((e) => ({ w: e.w * 0.4, f: e.f })), ...wrong];
        break;
      case 'PRE_OUTAGE':
        table = [
          { w: 4, f: () => h.play('light_flicker', { pos: this.ceilingPoint(), volume: 0.6 }) },
          { w: 3, f: () => h.playExtra('hum_swell', { pos: this.ceilingPoint(), volume: 0.8 }) },
          { w: 2, f: () => h.play('breaker_click', { pos: this.layout.points.electrical_panel, volume: 0.5 }) },
          { w: 2, f: () => h.play('pipe_knock', { pos: this.servicePoint(), volume: 0.4 }) },
          { w: 2, f: () => h.play('hvac_thump', { pos: this.ceilingPoint(), volume: 0.6 }) },
          { w: 1, f: () => h.play('transformer_hum', { pos: this.layout.points.electrical_panel, volume: 0.4 }) },
        ];
        break;
      case 'BLACKOUT':
        table = [
          { w: 3, f: () => h.playExtra('car_alarm_far', { pos: this.layout.points.exterior_wide, volume: 0.6 }) },
          { w: 2, f: () => h.play('knock_soft', { pos: far(8, 18), volume: 0.5 }) },
          { w: 2, f: () => h.play('water_drip', { pos: far(4, 12), volume: 0.4 }) },
          { w: 1, f: () => h.play('thunder', { pos: this.layout.points.exterior_wide, volume: 0.5 }) },
          { w: 1, f: () => h.play('metal_groan', { pos: far(10, 20), volume: 0.3 }) },
        ];
        break;
      case 'GENERATOR':
        table = [
          { w: 4, f: () => h.play('breaker_click', { pos: this.layout.points.electrical_panel, volume: 0.6 }) },
          { w: 2, f: () => h.play('water_drip', { pos: this.servicePoint(), volume: 0.5 }) },
          { w: 2, f: () => h.play('metal_groan', { pos: far(8, 20), volume: 0.35 }) },
          { w: 2, f: () => h.play('hvac_thump', { pos: this.ceilingPoint(), volume: 0.5 }) },
          { w: 2, f: () => h.play('pipe_knock', { pos: this.servicePoint(), volume: 0.45 }) },
          { w: 1, f: () => h.play('door_creak', { pos: this.doorPointFar(), volume: 0.35 }) },
        ];
        break;
      case 'THREAT':
        table = [
          { w: 4, f: () => h.play('drag', { pos: far(9, 20), volume: 0.6 }) },
          { w: 3, f: () => h.playExtra('vent_scrape', { pos: this.ventPoint(), volume: 0.55 }) },
          { w: 3, f: () => h.play('knock', { pos: this.wrongDirectionPoint(), volume: 0.5 }) },
          { w: 3, f: () => h.silence(2 + r.next() * 2) },
          { w: 2, f: () => h.play('scratch', { pos: this.ventPoint(), volume: 0.45 }) },
          { w: 1, f: () => h.play('whisper', { pos: this.wrongDirectionPoint(), volume: 0.35 }) },
          { w: 1, f: () => h.play('metal_groan', { pos: far(6, 16), volume: 0.4 }) },
          { w: 1, f: () => h.play('bang', { pos: far(12, 22), volume: 0.35 }) },
        ];
        break;
      case 'RESOLUTION':
        table = [
          { w: 2, f: () => h.play('door_close', { pos: this.doorPointFar(), volume: 0.3 }) },
          { w: 1, f: () => h.play('cart_roll', { pos: far(12, 22), volume: 0.35 }) },
        ];
        break;
    }
    const pick = r.weighted(table.map((e) => ({ item: e, weight: e.w })));
    pick.f();
  }

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  private listener(): Vec3 {
    return this.host.listenerPos();
  }

  private pointIn(room: RoomDef, y = 1.2): Vec3 {
    const b = room.bounds;
    return { x: b.x0 + 0.4 + this.rng.next() * Math.max(0.1, b.x1 - b.x0 - 0.8), y, z: b.z0 + 0.4 + this.rng.next() * Math.max(0.1, b.z1 - b.z0 - 0.8) };
  }

  /** A point in some other room at a plausible distance. */
  private farPoint(minD: number, maxD: number): Vec3 {
    const l = this.listener();
    for (let i = 0; i < 12; i++) {
      const room = this.rng.pick(this.layout.rooms);
      if (room.id === this.room || room.outdoor) continue;
      const p = this.pointIn(room);
      const d = dist(p, l);
      if (d >= minD && d <= maxD) return p;
    }
    const a = this.rng.next() * Math.PI * 2;
    return { x: l.x + Math.cos(a) * minD, y: 1.2, z: l.z + Math.sin(a) * minD };
  }

  /** The far side of a door of some other room — "a door closed somewhere". */
  private doorPointFar(): Vec3 {
    const l = this.listener();
    const doors = this.layout.doors.filter((d) => d.kind !== 'open' && d.a !== this.room && d.b !== this.room);
    for (let i = 0; i < 8; i++) {
      const d = this.rng.pick(doors);
      const p = { x: d.pos.x, y: 1.0, z: d.pos.z };
      if (dist(p, l) > 6) return p;
    }
    return this.farPoint(8, 20);
  }

  private servicePoint(): Vec3 {
    const rooms = this.layout.rooms.filter((r) => r.tags?.includes('service'));
    return this.pointIn(this.rng.pick(rooms), 2.0);
  }

  /** Ceiling above/near the listener, in their room. */
  private ceilingPoint(): Vec3 {
    const l = this.listener();
    const h = this.roomDef?.ceiling ?? 2.8;
    return { x: l.x + (this.rng.next() - 0.5) * 3, y: h - 0.1, z: l.z + (this.rng.next() - 0.5) * 3 };
  }

  private floorPointInRoom(): Vec3 {
    if (this.roomDef) return this.pointIn(this.roomDef, 0.05);
    const l = this.listener();
    return { x: l.x + (this.rng.next() - 0.5) * 4, y: 0.05, z: l.z + (this.rng.next() - 0.5) * 4 };
  }

  /** Nearest vent prop, else the ceiling. */
  private ventPoint(): Vec3 {
    const l = this.listener();
    let best: Vec3 | null = null;
    let bd = Infinity;
    for (const p of this.layout.props) {
      if (p.type !== 'vent') continue;
      const d = dist(p.pos, l);
      if (d < bd) { bd = d; best = p.pos; }
    }
    return best && bd < 16 ? best : this.ceilingPoint();
  }

  /** A monitor in another room within earshot. */
  private pickMonitorPos(): Vec3 | null {
    const l = this.listener();
    const cands = this.layout.props.filter((p) => p.type === 'monitor' && p.room !== this.room && dist(p.pos, l) < 14);
    return cands.length ? this.rng.pick(cands).pos : null;
  }

  /**
   * A point behind a wall that has no door — a sound from where nothing could be.
   * Falls back to the side opposite the nearest door.
   */
  private wrongDirectionPoint(): Vec3 {
    const l = this.listener();
    const rd = this.roomDef;
    if (!rd) return this.farPoint(4, 8);
    const b = rd.bounds;
    const doors = this.layout.doors.filter((d) => d.a === rd.id || d.b === rd.id);
    const sideHasDoor = { n: false, s: false, e: false, w: false };
    for (const d of doors) {
      if (d.axis === 'x') { if (Math.abs(d.pos.z - b.z1) < 0.3) sideHasDoor.n = true; else if (Math.abs(d.pos.z - b.z0) < 0.3) sideHasDoor.s = true; }
      else { if (Math.abs(d.pos.x - b.x1) < 0.3) sideHasDoor.e = true; else if (Math.abs(d.pos.x - b.x0) < 0.3) sideHasDoor.w = true; }
    }
    const free = (Object.keys(sideHasDoor) as (keyof typeof sideHasDoor)[]).filter((k) => !sideHasDoor[k]);
    const side = free.length ? this.rng.pick(free) : this.rng.pick(['n', 's', 'e', 'w'] as const);
    const off = 2.2 + this.rng.next() * 1.5;
    const clampX = Math.min(b.x1, Math.max(b.x0, l.x));
    const clampZ = Math.min(b.z1, Math.max(b.z0, l.z));
    switch (side) {
      case 'n': return { x: clampX, y: 1.4, z: b.z1 + off };
      case 's': return { x: clampX, y: 1.4, z: b.z0 - off };
      case 'e': return { x: b.x1 + off, y: 1.4, z: clampZ };
      default: return { x: b.x0 - off, y: 1.4, z: clampZ };
    }
  }

  /** Is a floor point inside the listener's room? (used by the engine for occlusion fallbacks) */
  inListenerRoom(p: Vec2): boolean {
    return !!this.roomDef && rectContains(this.roomDef.bounds, p);
  }

  dispose(): void {
    this.disposed = true;
    for (const l of Object.values(this.layers)) {
      try { l.gain.disconnect(); } catch { /* already gone */ }
    }
  }
}
