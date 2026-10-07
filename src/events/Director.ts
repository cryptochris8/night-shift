/**
 * NIGHT SHIFT — the director (CONTRACT §4J, §5).
 *
 * Reads the seed, builds the night from scripted beats plus a seeded selection of the anomaly pool,
 * runs the shared timeline whichever perspective the player is in, decides who witnessed what and
 * how it looked from there, drives the sound-state machine, perception drift, the power failure,
 * crisis danger, and finally the ending. Other modules reach the story through `StoryApi`.
 */
import type { DialogueOption, DocumentView, EventRunContext, GameEventDef, IEventDirector, Services, SfxHandle } from '../core/contracts';
import type { RNG } from '../core/rng';
import {
  CHARACTER_IDS,
  PHASE_STARTS,
  ZONES,
  phaseForTime,
  type CharacterId,
  type Clue,
  type EndingId,
  type FlagValue,
  type GamePhase,
  type RoomId,
  type ScenarioType,
  type SoundState,
  type Vec3,
  type ViewId,
  type ZoneId,
} from '../core/types';
import { CHOICE_META, CLUES, LINES, OBJECTIVES, PHONE_THREAD } from '../story/content';
import {
  baseSchedules,
  johnSedatedSchedule,
  johnToCounterSchedule,
  paulGeneratorSchedule,
  susieElevatorSchedule,
  susieVisitSchedule,
} from '../story/schedules';
import { ANOMALIES, anomalyPoint } from './anomalies';
import { registerStoryInteractables } from './interactables';
import { beatPoint, buildBeats, optionsFor, type BeatHooks } from './beats';
import { endingSummary as summarise, evaluateEnding as decide } from './endings';
import { cleanupCinematicScene, endingShots, introShots } from './intro';
import { DangerSystem, type DangerWindow } from './Director.danger';
import { C, CLUE, DF, F } from './Director.ids';
import { NpcCast } from './Director.npcs';
import { GENERATOR_ZONE_LIMIT, OutageSequencer, applyScreens } from './Director.power';
import { Silhouette } from './Director.silhouette';

// ---------------------------------------------------------------------------
// StoryApi — what interactables.ts and beats.ts code against
// ---------------------------------------------------------------------------

export interface StoryApi {
  flag(k: string): FlagValue | undefined;
  setFlag(k: string, v?: FlagValue): void;
  choice(id: string): string | undefined;
  addChoice(id: string, label: string, value: string): void;
  /** Looks the clue up in content.CLUES, stamps time + the active view. False if unknown or already found. */
  addClue(id: string): boolean;
  say(text: string, seconds?: number, speaker?: string): void;
  doc(d: DocumentView): Promise<string | null>;
  ask(prompt: string, options: DialogueOption[], opts?: { speaker?: string; timeoutSeconds?: number; defaultId?: string }): Promise<string>;
  /** Energise / shed a breaker zone. Enforces the three-zone generator limit (plays the trip, toasts). */
  setZone(zone: ZoneId, on: boolean): boolean;
  openCCTV(cameraId?: string): Promise<void>;
  objective(c: CharacterId, text: string | null): void;
  rng: RNG;
  readonly time: number;
  readonly scenario: ScenarioType;
  readonly view: ViewId;
}

interface Scheduled {
  def: GameEventDef;
  at: number;
  state: 'pending' | 'fired' | 'expired';
  beat: boolean;
}

interface PendingClue {
  id: string;
  point: Vec3;
  viewers: CharacterId[];
  rooms: RoomId[];
  /** real ms deadline */
  until: number;
  cond?: () => boolean;
}

type CCTVExtras = {
  jumpTimestamp?: (cameraId: string, offsetMinutes: number, seconds: number) => void;
  covers?: (cameraId: string, p: Vec3, maxDist?: number) => boolean;
};

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const REAL: readonly ScenarioType[] = ['supernatural', 'mixed'];
const ENDING_AT = 176.5;
/** How many pool anomalies may land in each phase (CONTRACT §5: "~5 fire" in unease). */
const PHASE_CAPS: Record<GamePhase, number> = { normal: 2, unease: 6, contradictions: 5, outage: 0, generator: 6, crisis: 4, resolution: 1 };
const MIN_SPACING = 1.6;
const isBeat = (def: GameEventDef): boolean => Boolean(def.tags?.includes('beat'));

export class EventDirector implements IEventDirector {
  private s!: Services;
  private rng!: RNG;
  private eventRng!: RNG;
  private storyRng!: RNG;
  private started = false;
  private playing = false;
  private endingStarted = false;

  private beats: GameEventDef[] = [];
  private scheduled: Scheduled[] = [];
  private pending: PendingClue[] = [];
  private objectives = new Map<CharacterId, string | null>();

  private cast!: NpcCast;
  private outage!: OutageSequencer;
  private danger!: DangerSystem;
  private readonly sil = new Silhouette(1.9);

  private westHum: SfxHandle | null = null;
  private drip: SfxHandle | null = null;
  private alarmLive = false;
  private askingEnter = false;
  /** indices into content.PHONE_THREAD already delivered (or dropped) */
  private phoneDone = new Set<number>();
  private requiresAccum = 0;
  private perceptionAccum = 0;
  private slowAccum = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private offs: (() => void)[] = [];

  readonly api: StoryApi;

  constructor() {
    this.api = this.makeApi();
  }

  get phase(): GamePhase {
    return this.s?.store.get().phase ?? 'normal';
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.reseed();
    this.cast = new NpcCast(services, this.rng.fork('cast'));
    this.outage = new OutageSequencer(services, this.rng.fork('outage'), {
      setSound: (st) => this.setSound(st),
      onBlackoutStart: () => this.cast.onBlackout(),
      onGeneratorOn: () => this.pushObjective(),
    });
    this.danger = new DangerSystem(services, this.rng.fork('danger'), {
      onPreWarn: (w) => this.onPreWarn(w),
      onStage: (w, stage) => this.onDangerStage(w, stage),
      onMissing: (id) => this.onMissing(id),
    });
    const bus = services.bus;
    this.offs.push(
      bus.on('view:change', () => {
        this.pushObjective();
        this.pushPerception();
      }),
      bus.on('phase:change', () => this.pushObjective()),
      bus.on('character:entered', ({ id, room, prev }) => this.onEntered(id, room, prev)),
      bus.on('zone:change', () => applyScreens(this.s)),
    );
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.reset();
    this.sil.dispose();
  }

  private reseed(): void {
    this.rng = this.s.rng.fork('director');
    this.eventRng = this.rng.fork('events');
    this.storyRng = this.s.rng.fork('story');
  }

  private reset(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.scheduled = [];
    this.pending = [];
    this.objectives.clear();
    this.westHum?.stop(0.2);
    this.westHum = null;
    this.drip?.stop(0.2);
    this.drip = null;
    this.alarmLive = false;
    this.askingEnter = false;
    this.phoneDone.clear();
    this.endingStarted = false;
    this.playing = false;
    this.requiresAccum = 0;
    this.perceptionAccum = 0;
    this.slowAccum = 0;
    this.cast?.dispose();
    this.outage?.reset();
    this.danger?.reset();
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      if (this.started) fn();
    }, ms);
    this.timers.push(t);
  }

  // ---------------------------------------------------------------------------
  // IEventDirector
  // ---------------------------------------------------------------------------

  start(): void {
    const s = this.s;
    this.reset();
    this.reseed();
    this.started = true;

    const schedules = baseSchedules();
    for (const id of CHARACTER_IDS) s.characters.setSchedule(id, schedules[id]);

    try {
      registerStoryInteractables(s, this.api);
    } catch (err) {
      console.error('[director] registerStoryInteractables failed', err);
    }

    this.cast = new NpcCast(s, this.rng.fork('cast'));
    this.cast.spawnAll();
    this.buildSchedule();
    void this.runIntro();
  }

  async fire(eventId: string): Promise<void> {
    const entry = this.scheduled.find((e) => e.def.id === eventId);
    const def = entry?.def ?? this.beats.find((b) => b.id === eventId) ?? ANOMALIES.find((a) => a.id === eventId);
    if (!def) {
      console.warn('[director] unknown event', eventId);
      return;
    }
    if (entry) entry.state = 'fired';
    await this.runEvent(def);
  }

  schedule(): { id: string; at: number }[] {
    const out = this.scheduled.filter((e) => e.state === 'pending').map((e) => ({ id: e.def.id, at: e.at }));
    if (this.outage.stage === 'normal') out.push({ id: 'power:unstable', at: PHASE_STARTS.outage - 3 });
    if (this.outage.stage === 'normal' || this.outage.stage === 'unstable') out.push({ id: 'power:blackout', at: PHASE_STARTS.outage });
    if (!this.endingStarted) out.push({ id: 'ending', at: ENDING_AT });
    return out.sort((a, b) => a.at - b.at);
  }

  evaluateEnding(): EndingId {
    return decide(this.s.store.get());
  }

  endingSummary(ending: EndingId): string[] {
    return summarise(this.s.store.get(), ending);
  }

  objectiveFor(c: CharacterId): string | null {
    const dyn = this.objectives.get(c);
    if (dyn !== undefined) return dyn;
    const table = (OBJECTIVES as Partial<Record<CharacterId, Partial<Record<GamePhase, string>>>>)[c];
    const text = table?.[this.phase];
    return typeof text === 'string' ? text : null;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, gdt: number): void {
    if (!this.started || !this.playing || this.endingStarted) return;
    const s = this.s;
    const st = s.store.get();
    if (st.screen !== 'playing' || st.paused) return;
    const time = s.clock.time;

    this.cast.update(dt, time, st.power);
    this.outage.update(time);
    this.processEvents(time, dt);
    this.danger.update(dt, gdt, time);
    this.updatePerception(dt, gdt);
    this.updateSound(time);

    this.slowAccum += dt;
    if (this.slowAccum >= 0.5) {
      this.slowAccum = 0;
      this.updatePendingClues();
      this.updateWatchers(time);
      this.updatePhone(time);
    }
    this.checkEnding(time);
  }

  /** Kate's thread (content.PHONE_THREAD) buzzes John's pocket as each message lands. */
  private updatePhone(time: number): void {
    const s = this.s;
    const st = s.store.get();
    PHONE_THREAD.forEach((m, i) => {
      if (this.phoneDone.has(i) || m.time < 0 || time < m.time) return;
      if (m.from === 'John' || (m.scenarios && !m.scenarios.includes(st.scenario))) {
        this.phoneDone.add(i);
        return;
      }
      const gated = (m.requiresFlag && !st.flags[m.requiresFlag]) || (m.requiresNotFlag && st.flags[m.requiresNotFlag]);
      if (gated) {
        // a flag-gated message waits a few minutes for its flag, then never arrives
        if (time > m.time + 6) this.phoneDone.add(i);
        return;
      }
      this.phoneDone.add(i);
      if (st.power === 'blackout') return; // no service
      if (st.activeView === 'john' && !st.characters.john.missing) {
        s.audio.play('phone_buzz', { nonSpatial: true, volume: 0.45 });
        this.api.say(`(phone) ${m.from}: ${m.text}`, 3.6);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Intro and handoff
  // ---------------------------------------------------------------------------

  private async runIntro(): Promise<void> {
    const s = this.s;
    // the clock on the wall reads 10:47 when John looks up
    s.clock.set(2);
    s.store.update((d) => {
      d.time = 2;
    });
    try {
      await s.cinematic.play('intro', introShots(s), { skippable: true, letterbox: true });
    } catch (err) {
      console.error('[director] intro failed', err);
    }
    if (!this.started) return;
    this.handoffToJohn();
  }

  private handoffToJohn(): void {
    const s = this.s;
    const store = s.store;
    s.world.setRain(0.85);
    if (!s.characters.active) s.characters.setAction('john', 'sit');
    s.characters.possess('john');
    store.setView('john');
    const c = store.char('john');
    s.postfx.setMode('world');
    s.postfx.setBlackout(0);
    s.postfx.setPerception(c.perception, 'john');
    s.audio.setCCTVMode(false);
    s.audio.setPerception(c.perception, 'john');
    s.audio.setRoom(c.location);
    s.characters.setViewFilter('john');
    this.setSound('NORMAL');
    applyScreens(s);
    this.playing = true;
    s.game.beginPlay();
    this.pushObjective();
  }

  // ---------------------------------------------------------------------------
  // Schedule
  // ---------------------------------------------------------------------------

  private buildSchedule(): void {
    const s = this.s;
    const scenario = s.store.get().scenario;
    const hooks: BeatHooks = {
      cast: this.cast,
      silhouette: this.sil,
      pendingClue: (id, point, viewers, rooms, seconds = 600, cond) =>
        this.pending.push({ id, point, viewers, rooms, until: performance.now() + seconds * 1000, cond }),
      johnSedated: () => this.johnSedated(),
      johnLeavesRoom: () => this.johnLeavesRoom(),
      susieRedirect: (room, stay) => {
        if (s.store.get().activeView !== 'susie') s.characters.setSchedule('susie', susieVisitSchedule(s.clock.time, room, stay));
      },
      susieToElevator: () => {
        if (s.store.get().activeView !== 'susie') s.characters.setSchedule('susie', susieElevatorSchedule(s.clock.time));
      },
      startAlarm: () => {
        this.alarmLive = true;
      },
      stopAlarm: () => {
        this.alarmLive = false;
      },
      bumpFear: (c, amount) => this.bumpFear(c, amount),
      isWatchingCam: (cam) => this.isWatchingCam(cam),
      jumpTimestamp: this.cctvExtras().jumpTimestamp,
    };
    this.beats = buildBeats(this.api, s, hooks);

    const list: Scheduled[] = [];
    const ats: number[] = [];
    for (const b of this.beats) {
      const span = b.window[1] - b.window[0];
      const at = span > 0 ? b.window[0] + this.rng.range(0, Math.min(1.2, span * 0.35)) : b.window[0];
      list.push({ def: b, at, state: 'pending', beat: true });
      ats.push(at);
    }

    // seeded selection from the pool: scenario filter, chance, per-phase caps, spacing from everything else
    const pool = ANOMALIES.filter((a) => a.scenarios === 'all' || a.scenarios.includes(scenario)).filter((a) => this.rng.chance(a.chance ?? 1));
    const ordered = this.rng.shuffle(pool).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const used: Record<GamePhase, number> = { normal: 0, unease: 0, contradictions: 0, outage: 0, generator: 0, crisis: 0, resolution: 0 };
    for (const a of ordered) {
      const ph = phaseForTime(a.window[0]);
      if (used[ph] >= PHASE_CAPS[ph]) continue;
      const lo = a.window[0];
      const hi = Math.max(lo, a.window[1] - 0.5);
      let at = -1;
      for (let tries = 0; tries < 8; tries++) {
        const cand = lo + (hi - lo) * this.rng.next() * 0.7;
        if (ats.every((t) => Math.abs(t - cand) >= MIN_SPACING)) {
          at = cand;
          break;
        }
      }
      if (at < 0) continue;
      used[ph]++;
      ats.push(at);
      list.push({ def: a, at, state: 'pending', beat: false });
    }
    list.sort((x, y) => x.at - y.at);
    this.scheduled = list;
  }

  private processEvents(time: number, dt: number): void {
    this.requiresAccum += dt;
    const checkRequires = this.requiresAccum >= 0.25;
    if (checkRequires) this.requiresAccum = 0;

    for (const e of this.scheduled) {
      if (e.state !== 'pending') continue;
      if (time < e.at) break;
      const end = e.def.window[1];
      const late = time > end + 1.5;
      if (late) {
        // a time jump (debug / hitch): the night still happened
        if (e.beat) this.catchUp(e);
        else if (e.def.offscreen) this.fireSilently(e);
        else this.expire(e);
        continue;
      }
      if (e.def.requires) {
        if (!checkRequires) continue;
        let ok = false;
        try {
          ok = e.def.requires(this.s);
        } catch (err) {
          console.error('[director] requires threw', e.def.id, err);
        }
        if (!ok) {
          if (time > end) {
            if (e.beat) this.catchUp(e);
            else this.expire(e);
          }
          continue;
        }
      }
      if (!e.def.offscreen && !this.viewMatches(e.def)) {
        if (time > end) this.expire(e);
        continue;
      }
      e.state = 'fired';
      void this.runEvent(e.def);
    }
  }

  private expire(e: Scheduled): void {
    e.state = 'expired';
  }

  /** Beat caught up after a jump: the state it carries, none of the show. */
  private catchUp(e: Scheduled): void {
    e.state = 'fired';
    const ctx = this.context(e.def, false);
    this.s.store.recordEvent(e.def.id, false);
    this.applyConsequences(e.def, ctx);
  }

  /** Offscreen anomaly that happened while nobody was there. */
  private fireSilently(e: Scheduled): void {
    e.state = 'fired';
    const ctx = this.context(e.def, false);
    this.s.store.recordEvent(e.def.id, false);
    this.applyConsequences(e.def, ctx);
  }

  private context(def: GameEventDef, witnessed: boolean): EventRunContext {
    const st = this.s.store.get();
    return { s: this.s, view: st.activeView, time: st.time, witnessed, rng: this.eventRng.fork(def.id) };
  }

  private applyConsequences(def: GameEventDef, ctx: EventRunContext): void {
    try {
      def.consequences?.(ctx);
    } catch (err) {
      console.error('[director] consequences threw', def.id, err);
    }
    if (!ctx.witnessed) {
      try {
        def.missedConsequences?.(ctx);
      } catch (err) {
        console.error('[director] missedConsequences threw', def.id, err);
      }
    }
  }

  private async runEvent(def: GameEventDef): Promise<void> {
    const s = this.s;
    const st = s.store.get();
    const view = st.activeView;
    const witnessed = this.computeWitness(def);
    const ctx = this.context(def, witnessed);
    const pres = this.pickPresentation(def, view);
    s.store.recordEvent(def.id, witnessed);
    if (witnessed && view !== 'cctv' && !isBeat(def)) this.bumpFear(view, view === 'john' ? 0.14 : 0.1);

    // consequences are world state and apply at once; a beat tagged 'after' settles them once its dialogue ends
    const after = Boolean(def.tags?.includes('after'));
    if (!after) this.applyConsequences(def, ctx);
    if (pres) {
      if (pres.subtitle && witnessed) s.ui.subtitle(pres.subtitle, 3.5);
      try {
        await pres.run(ctx);
      } catch (err) {
        console.error('[director] presentation threw', def.id, err);
      }
    }
    if (after) this.applyConsequences(def, ctx);
  }

  private pickPresentation(def: GameEventDef, view: ViewId) {
    const P = def.presentation;
    if (view === 'cctv') {
      const real = def.realIn?.includes(this.s.store.get().scenario) ?? false;
      const pres = real ? P.truth ?? P.cctv : P.cctv;
      return pres ?? (isBeat(def) ? P.any : undefined);
    }
    return P[view] ?? P.any;
  }

  private viewMatches(def: GameEventDef): boolean {
    const st = this.s.store.get();
    const v = st.activeView;
    if (v === 'cctv') {
      const cam = this.s.cctv.currentCamera;
      if (!cam || !this.s.cctv.isOnline(cam.id)) return false;
      return cam.room === def.room || this.covers(cam.id, this.pointFor(def));
    }
    return def.characters.includes(v) && st.characters[v].location === def.room;
  }

  private computeWitness(def: GameEventDef): boolean {
    const s = this.s;
    const st = s.store.get();
    const v = st.activeView;
    const point = this.pointFor(def);
    if (v === 'cctv') {
      const cam = s.cctv.currentCamera;
      if (!cam || !s.cctv.isOnline(cam.id)) return false;
      if (cam.room === def.room) return true;
      return this.covers(cam.id, point);
    }
    const c = st.characters[v];
    const inRoom = c.location === def.room;
    let sees = false;
    try {
      sees = s.characters.canSee(point, inRoom ? 85 : 55, inRoom ? 40 : 28);
    } catch {
      sees = false;
    }
    if (sees) return true;
    if (inRoom) return Math.hypot(c.position.x - point.x, c.position.z - point.z) < 3.2;
    return false;
  }

  private pointFor(def: GameEventDef): Vec3 {
    const fromBeat = beatPoint(def.id);
    if (fromBeat) return fromBeat;
    if (!isBeat(def)) {
      try {
        const p = anomalyPoint(def.id);
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) return p;
      } catch {
        /* fall through to the room centre */
      }
    }
    return this.roomCentre(def.room);
  }

  private roomCentre(room: RoomId): Vec3 {
    const r = this.s.layout.rooms.find((x) => x.id === room);
    if (!r) return v3(0, 1.2, 0);
    return v3((r.bounds.x0 + r.bounds.x1) / 2, 1.2, (r.bounds.z0 + r.bounds.z1) / 2);
  }

  private cctvExtras(): CCTVExtras {
    const c = this.s.cctv as unknown as Record<string, unknown>;
    const out: CCTVExtras = {};
    if (typeof c.jumpTimestamp === 'function') out.jumpTimestamp = (c.jumpTimestamp as CCTVExtras['jumpTimestamp'])!.bind(this.s.cctv);
    if (typeof c.covers === 'function') out.covers = (c.covers as CCTVExtras['covers'])!.bind(this.s.cctv);
    return out;
  }

  private covers(cameraId: string, p: Vec3): boolean {
    const fn = this.cctvExtras().covers;
    if (!fn) return false;
    try {
      return fn(cameraId, p);
    } catch {
      return false;
    }
  }

  private isWatchingCam(cameraId: string): boolean {
    const st = this.s.store.get();
    return st.activeView === 'cctv' && st.activeCamera === cameraId && this.s.cctv.isOnline(cameraId);
  }

  // ---------------------------------------------------------------------------
  // Sound state, perception
  // ---------------------------------------------------------------------------

  private setSound(state: SoundState): void {
    const s = this.s;
    if (s.store.get().sound === state) return;
    s.store.setSound(state);
    s.audio.setSoundState(state);
  }

  private updateSound(time: number): void {
    const st = this.s.store.get();
    let target: SoundState;
    if (st.power === 'blackout') target = 'BLACKOUT';
    else if (time >= PHASE_STARTS.resolution) target = 'RESOLUTION';
    else if (st.power === 'generator') target = st.phase === 'crisis' || st.threat > 0.5 ? 'THREAT' : 'GENERATOR';
    else if (time >= PHASE_STARTS.outage - 6) target = 'PRE_OUTAGE';
    else if (st.threat > 0.5) target = 'THREAT';
    else if (time >= PHASE_STARTS.unease) target = 'UNEASY';
    else target = 'NORMAL';
    this.setSound(target);
  }

  private updatePerception(dt: number, gdt: number): void {
    const s = this.s;
    const st = s.store.get();
    if (gdt > 0) {
      for (const id of CHARACTER_IDS) {
        const c = st.characters[id];
        if (c.missing) continue;
        const p = c.perception;
        const patch: Partial<typeof p> = {};
        patch.fatigue = p.fatigue + gdt * 0.0018;
        let fear = p.fear - gdt * 0.004;
        if (id === 'john') {
          patch.medication = Math.max(0, p.medication - gdt * 0.0035);
          const dark = st.power === 'generator' && !st.zones.exam && c.location === 'exam3';
          if (dark && !st.flags[F.john_sedated]) fear += gdt * 0.012;
          if (st.power === 'generator' && st.zones.exam && c.location === 'exam3') fear -= gdt * 0.006;
          if (st.flags[F.john_sedated]) fear -= gdt * 0.004;
        }
        if (id === 'susie') {
          patch.stress = this.alarmLive ? p.stress + gdt * 0.003 : Math.max(0.2, p.stress - gdt * 0.001);
        }
        if (id === 'paul' && c.location === 'closed_wing') fear += gdt * 0.01;
        patch.fear = fear;
        const anxietyTarget = (id === 'john' ? 0.3 : 0.1) + 0.3 * fear + 0.3 * (patch.stress ?? p.stress);
        patch.anxiety = p.anxiety + (anxietyTarget - p.anxiety) * Math.min(1, gdt * 0.3);
        s.store.setPerception(id, patch);
      }
    }
    this.perceptionAccum += dt;
    if (this.perceptionAccum >= 0.5) {
      this.perceptionAccum = 0;
      this.pushPerception();
    }
  }

  private pushPerception(): void {
    const s = this.s;
    const st = s.store.get();
    const v = st.activeView;
    s.audio.setTension(Math.min(1, st.threat * 0.8));
    if (v === 'cctv') {
      s.audio.setHeartbeat(st.threat > 0.6 ? 60 + 40 * st.threat : 0);
      return;
    }
    const c = st.characters[v];
    s.postfx.setPerception(c.perception, v);
    s.audio.setPerception(c.perception, v);
    const drive = Math.max(st.threat, c.perception.fear - 0.25, c.danger);
    s.audio.setHeartbeat(drive > 0.25 ? 52 + 70 * drive : 0);
  }

  private bumpFear(c: CharacterId, amount: number): void {
    const s = this.s;
    const p = s.store.char(c).perception;
    s.store.setPerception(c, { fear: p.fear + amount, anxiety: p.anxiety + amount * 0.5 });
    if (s.store.get().activeView === c) this.pushPerception();
  }

  private pushObjective(): void {
    const s = this.s;
    const v = s.store.get().activeView;
    s.ui.setObjective(v === 'cctv' ? null : this.objectiveFor(v));
  }

  // ---------------------------------------------------------------------------
  // Pending clues, watchers, room entries
  // ---------------------------------------------------------------------------

  private updatePendingClues(): void {
    if (this.pending.length === 0) return;
    const s = this.s;
    const st = s.store.get();
    const v = st.activeView;
    const now = performance.now();
    const keep: PendingClue[] = [];
    for (const pc of this.pending) {
      if (now > pc.until || st.clues.some((c) => c.id === pc.id)) continue;
      let award = false;
      if (pc.viewers.length === 0) {
        award = Boolean(pc.cond?.());
      } else if (v !== 'cctv' && pc.viewers.includes(v) && (pc.rooms.length === 0 || pc.rooms.includes(st.characters[v].location))) {
        if (!pc.cond || pc.cond()) {
          try {
            award = s.characters.canSee(pc.point, 70, 14);
          } catch {
            award = false;
          }
        }
      }
      if (award) {
        this.api.addClue(pc.id);
        continue;
      }
      keep.push(pc);
    }
    this.pending = keep;
  }

  private updateWatchers(time: number): void {
    const s = this.s;
    const st = s.store.get();
    const john = st.characters.john;
    const paul = st.characters.paul;
    const susie = st.characters.susie;
    const flag = (k: string): FlagValue | undefined => st.flags[k];

    // John reaches the light at the nurse-station counter
    if (!flag(F.john_at_station) && !john.missing && john.location === 'corridor' && Math.hypot(john.position.x - 0.6, john.position.z + 0.8) < 2.8 && st.power === 'generator') {
      s.store.setFlag(F.john_at_station);
      s.store.setFlag(F.john_safe);
      s.store.setFlag(F.john_left_room);
      s.store.setChar('john', { status: 'At the nurse station counter', danger: Math.min(john.danger, 0.1) });
      this.api.objective('john', 'Stay in the light. Someone will come.');
      if (st.activeView === 'john') this.api.say('(the desk lamp is on. You stay in its light.)', 3.5);
    }

    // left alone four minutes: an NPC John goes looking
    const since = flag(DF.john_alone_since);
    if (
      typeof since === 'number' &&
      !flag(F.john_left_room) &&
      !flag(F.john_sedated) &&
      !flag(F.susie_went_john) &&
      st.activeView !== 'john' &&
      john.location === 'exam3' &&
      time - since >= 4
    ) {
      this.johnLeavesRoom();
    }

    // Susie reaches John during his danger window
    if (susie.location === 'exam3' && john.location === 'exam3' && john.danger > 0.05 && !flag(F.john_safe)) {
      s.store.setFlag(F.john_safe);
      s.store.setChar('john', { danger: 0 });
      if (st.activeView === 'susie') this.api.say("John? I'm here. I'm right here.", 3, 'Susie');
    }

    // Paul at the open west wing door
    if (flag(F.west_wing_door_open) && !this.askingEnter && this.api.choice(C.enter_west_wing) === undefined && st.activeView === 'paul' && !s.ui.modalOpen) {
      const d = s.layout.points.closed_wing_door;
      if (paul.location === 'service_n' && Math.hypot(paul.position.x - d.x, paul.position.z - d.z) < 2.8) void this.askEnterWestWing();
    }

    // Susie looks into the elevator
    if (flag(F.susie_investigated_elevator) && !flag('dir_elevator_looked') && st.activeView === 'susie') {
      const e = s.layout.points.elevator_doors;
      if (Math.hypot(susie.position.x - e.x, susie.position.z - e.z) < 3) {
        s.store.setFlag('dir_elevator_looked');
        this.api.say('(empty. The cab light is dead. It smells like rain.)', 3.6);
        this.bumpFear('susie', 0.2);
        s.store.setChar('susie', { danger: 0 });
        s.audio.play('elevator_hum', { pos: e, volume: 0.3, rate: 0.6 });
        this.api.objective('susie', 'Back to the station. Account for everyone.');
      }
    }
  }

  private async askEnterWestWing(): Promise<void> {
    this.askingEnter = true;
    try {
      const value = await this.api.ask(CHOICE_META.enter_west_wing.label, optionsFor('enter_west_wing'), { timeoutSeconds: 20, defaultId: 'leave' });
      this.api.addChoice(C.enter_west_wing, CHOICE_META.enter_west_wing.label, value);
      if (value === 'leave') this.api.objective('paul', 'Shut the WEST WING breaker in the electrical room.');
      else this.api.objective('paul', 'Go in. Find where the dragging came from.');
    } finally {
      this.askingEnter = false;
    }
  }

  private onEntered(id: CharacterId, room: RoomId, prev: RoomId): void {
    if (!this.playing || this.endingStarted) return;
    const s = this.s;
    const st = s.store.get();
    const view = st.activeView;

    if (id === 'susie' && room === 'exam2' && this.alarmLive) {
      this.alarmLive = false;
      s.store.setFlag(DF.alvarez_alarm_live, false);
      this.later(() => {
        if (view === 'susie') this.api.say("Lead came off. You're okay, Mrs. Alvarez. You're okay.", 3.6, 'Susie');
        this.cast.alvarezMurmur(1.8);
      }, 900);
      s.store.setChar('susie', { status: 'Bay 2 — resolved' });
    }

    if (id === 'susie' && room === 'exam3') {
      const john = st.characters.john;
      if (john.missing && !st.flags[DF.john_missing_found]) {
        s.store.setFlag(DF.john_missing_found);
        s.audio.play('curtain', { pos: v3(-7.7, 1.2, 2.6), volume: 0.5 });
        if (view === 'susie') {
          this.api.say('John?', 1.6, 'Susie');
          this.later(() => this.api.say('(the bed is empty. The curtain is torn off its rail.)', 4), 2200);
        }
        this.bumpFear('susie', 0.35);
        s.store.setChar('susie', { status: 'Bay 3 is empty' });
      } else if (st.flags[DF.john_call_light]) {
        s.world.setCallLight('exam3', false);
        s.store.setFlag(DF.john_call_light, false);
        if (john.location === 'exam3') {
          if (view === 'susie') {
            this.api.say('John? You rang.', 2.2, 'Susie');
            this.later(() => this.api.say('I heard someone outside. Right outside.', 3, 'John'), 2600);
          } else if (view === 'john') {
            this.api.say("John? You rang. I'm here.", 2.6, 'Susie');
          }
          s.store.setPerception('john', { fear: john.perception.fear * 0.6 });
          s.store.setChar('susie', { status: 'With John — Bay 3' });
        }
      }
    }

    if (id === 'paul' && room === 'closed_wing') this.westWingEntered();
    if (id === 'paul' && prev === 'closed_wing' && room !== 'closed_wing') {
      this.drip?.stop(1.5);
      this.drip = null;
      if (st.flags[F.paul_entered_west_wing]) this.api.objective('paul', 'Shut the WEST WING breaker, or keep the generator running.');
    }

    if (id === 'john' && prev === 'exam3' && room === 'corridor' && st.power === 'generator' && !st.flags[F.john_left_room]) {
      s.store.setFlag(F.john_left_room);
      s.store.setChar('john', { status: 'In the hallway' });
    }
  }

  private westWingEntered(): void {
    const s = this.s;
    const st = s.store.get();
    if (st.flags[F.paul_entered_west_wing]) return;
    s.store.setFlag(F.paul_entered_west_wing);
    if (this.api.choice(C.enter_west_wing) === undefined) this.api.addChoice(C.enter_west_wing, CHOICE_META.enter_west_wing.label, 'enter');
    this.drip?.stop(0.2);
    this.drip = s.audio.play('water_drip', { pos: v3(-15.5, 2.2, 7), loop: true, volume: 0.5 });
    s.store.setChar('paul', { status: 'Inside the west wing' });
    if (st.activeView === 'paul') this.api.say('(plastic sheeting. Dust. Dripping from somewhere ahead.)', 3.6);
    this.api.objective('paul', 'Find where the dragging came from. Then get out.');
    this.bumpFear('paul', 0.12);

    if (REAL.includes(st.scenario) && !st.flags[DF.west_wing_laugh]) {
      this.later(() => {
        const now = s.store.get();
        if (now.characters.paul.location !== 'closed_wing' || now.characters.paul.missing) return;
        s.store.setFlag(DF.west_wing_laugh);
        s.audio.play('child_laugh', { pos: v3(-19, 1.0, 7.2), volume: 0.42 });
        if (now.activeView === 'paul') {
          this.api.say(LINES.anomalies.childLaugh, 3.6);
          this.api.addClue(CLUE.laughter);
        }
        this.bumpFear('paul', 0.3);
        try {
          s.characters.spawnFigure({
            id: 'anom_wing_figure',
            pos: v3(-19.2, 0, 7.2),
            yaw: -Math.PI / 2,
            outfit: 'dark',
            anim: 'stand_still',
            visibleTo: ['paul'],
            vanishWhenUnseen: 2,
            vanishWithin: 4,
            duration: 30,
          });
        } catch (err) {
          console.error('[director] wing figure failed', err);
        }
      }, 6500);
    }
  }

  private johnSedated(): void {
    const s = this.s;
    if (s.store.get().activeView !== 'john') {
      s.characters.setSchedule('john', johnSedatedSchedule(s.clock.time));
      s.characters.setAction('john', 'lie');
    }
  }

  private johnLeavesRoom(): void {
    const s = this.s;
    const st = s.store.get();
    if (st.flags[F.john_left_room]) return;
    s.store.setFlag(F.john_left_room);
    s.store.setChar('john', { status: 'Left Bay 3' });
    if (st.activeView !== 'john') {
      void s.world.setDoorOpen('d_exam3', true);
      s.characters.setSchedule('john', johnToCounterSchedule(s.clock.time));
    }
  }

  // ---------------------------------------------------------------------------
  // Danger hooks
  // ---------------------------------------------------------------------------

  private onPreWarn(w: DangerWindow): void {
    const s = this.s;
    s.ui.warn(w.id, 0.12, w.hints[0]);
    s.audio.play('radio_click', { nonSpatial: true, volume: 0.32 });
    const src = DangerSystem.troubleSource(s, w.id);
    switch (w.id) {
      case 'john':
        s.audio.play('knock_soft', { pos: src, volume: 0.4 });
        break;
      case 'paul':
        s.audio.play('pipe_knock', { pos: src, volume: 0.45 });
        break;
      case 'susie':
        s.audio.play('elevator_hum', { pos: src, volume: 0.3, rate: 0.7 });
        break;
    }
  }

  private onDangerStage(w: DangerWindow, stage: 1 | 2 | 3): void {
    const s = this.s;
    const src = DangerSystem.troubleSource(s, w.id);
    const st = s.store.get();
    if (stage === 1) {
      if (w.id === 'john') s.audio.play('drag', { pos: src, volume: 0.38, rate: 0.7 });
      else if (w.id === 'paul') s.audio.play('metal_groan', { pos: src, volume: 0.4, rate: 0.8 });
      else s.audio.play('elevator_tone', { pos: src, volume: 0.4 });
      s.ui.warn(w.id, 0.3, w.hints[0]);
      return;
    }
    if (stage === 2) {
      this.signalLost(w.nearCam, 25);
      s.audio.play('radio_click', { nonSpatial: true, volume: 0.5 });
      this.later(() => s.audio.play('static_burst', { nonSpatial: true, volume: 0.4 }), 350);
      if (st.activeView !== 'cctv') this.api.say(LINES.crisis.radioStatic, 2);
      if (w.id === 'john') {
        s.audio.play('monitor_flat', { pos: v3(-5.9, 1.35, 4.9), volume: 0.5 });
        if (st.zones.exam) {
          try {
            s.world.setScreen('exam3_monitor', 'dead');
          } catch {
            /* optional */
          }
        }
      }
      s.ui.warn(w.id, 0.55, w.hints[1]);
      return;
    }
    for (let i = 0; i < 3; i++) this.later(() => s.audio.play('knock', { pos: src, volume: 0.6, rate: 0.9 - i * 0.05 }), i * 900);
    s.postfx.pulse('heartbeat', 0.8);
    s.ui.warn(w.id, 0.85, w.hints[2]);
    if (st.activeView !== 'cctv') {
      const line = w.id === 'john' ? '(Bay 3 — the monitor has stopped)' : w.id === 'paul' ? '(the generator note changes)' : '(the station radio clicks. Nobody answers.)';
      this.api.say(line, 3.2);
    }
  }

  /** A camera drops its feed for a while — only if it was alive, and it comes back to its powered state. */
  private signalLost(cameraId: string, seconds: number): void {
    const s = this.s;
    if (!s.cctv.isOnline(cameraId)) return;
    s.cctv.setOnline(cameraId, false);
    this.later(() => {
      const st = s.store.get();
      const def = s.layout.cameras.find((c) => c.id === cameraId);
      const powered =
        st.power === 'blackout' ? false : st.power === 'generator' ? Boolean(def?.survivesBlackout && (def.zone ? st.zones[def.zone] : true)) : true;
      s.cctv.setOnline(cameraId, powered);
    }, seconds * 1000);
  }

  private onMissing(id: CharacterId): void {
    const s = this.s;
    if (s.store.char(id).missing) return;
    DangerSystem.missingPresentation(s, this.rng, id);
    s.ui.warn(id, 1, 'Unaccounted for');
    this.objectives.set(id, null);
    if (id === 'john') this.api.objective('susie', 'Check on John in Bay 3.');
    if (id === 'paul') this.api.objective('susie', 'Raise Paul on the radio.');
    if (id === 'susie') this.api.objective('paul', 'Raise Susie on the radio.');
    this.pushObjective();
  }

  // ---------------------------------------------------------------------------
  // Ending
  // ---------------------------------------------------------------------------

  private checkEnding(time: number): void {
    if (this.endingStarted) return;
    const anyMissing = this.s.store.presentCharacters().length < CHARACTER_IDS.length;
    if (time >= ENDING_AT || (anyMissing && time >= PHASE_STARTS.resolution)) void this.runEnding();
  }

  private async runEnding(): Promise<void> {
    const s = this.s;
    this.endingStarted = true;
    const ending = this.evaluateEnding();
    s.audio.setHeartbeat(0);
    s.audio.setTension(0);
    this.westHum?.stop(1);
    this.westHum = null;
    this.drip?.stop(1);
    this.drip = null;
    for (const id of CHARACTER_IDS) s.ui.warn(id, 0);
    s.ui.setObjective(null);
    s.ui.setPrompt(null);
    try {
      await s.cinematic.play(`ending_${ending}`, endingShots(s, ending), { skippable: true, letterbox: true });
    } catch (err) {
      console.error('[director] ending cinematic failed', err);
    }
    cleanupCinematicScene(s);
    await s.game.endShift(ending);
  }

  // ---------------------------------------------------------------------------
  // StoryApi implementation
  // ---------------------------------------------------------------------------

  private makeApi(): StoryApi {
    const dir = this;
    const api: StoryApi = {
      flag: (k) => dir.s.store.flag(k),
      setFlag: (k, v = true) => dir.s.store.setFlag(k, v),
      choice: (id) => dir.s.store.choice(id),
      addChoice: (id, label, value) => dir.s.store.addChoice({ id, label, value, time: dir.s.store.get().time }),
      addClue: (id) => dir.addClue(id),
      say: (text, seconds, speaker) => dir.say(text, seconds, speaker),
      doc: (d) => dir.s.ui.showDocument(d),
      ask: (prompt, options, opts) => dir.s.ui.showChoice(prompt, options, opts),
      setZone: (zone, on) => dir.setZone(zone, on),
      openCCTV: (cameraId) => {
        if (dir.s.store.get().activeView === 'susie') dir.s.store.setFlag(F.susie_checked_cctv);
        return dir.s.game.switchView('cctv', cameraId);
      },
      objective: (c, text) => {
        dir.objectives.set(c, text);
        if (dir.s.store.get().activeView === c) dir.s.ui.setObjective(text);
      },
      get rng(): RNG {
        return dir.storyRng;
      },
      get time(): number {
        return dir.s.clock.time;
      },
      get scenario(): ScenarioType {
        return dir.s.store.get().scenario;
      },
      get view(): ViewId {
        return dir.s.store.get().activeView;
      },
    };
    return api;
  }

  private addClue(id: string): boolean {
    const defs = CLUES as Record<string, Omit<Clue, 'time' | 'source'> | undefined>;
    const def = defs[id];
    if (!def) {
      console.warn('[director] unknown clue id', id);
      return false;
    }
    const st = this.s.store.get();
    return this.s.store.addClue({ ...def, id, time: st.time, source: st.activeView });
  }

  private say(text: string, seconds?: number, speaker?: string): void {
    const line = text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text;
    const dur = seconds ?? Math.min(6, Math.max(1.8, 1.2 + line.split(/\s+/).length * 0.36));
    this.s.ui.subtitle(line, dur, speaker);
  }

  private setZone(zone: ZoneId, on: boolean): boolean {
    const s = this.s;
    const st = s.store.get();
    const P = s.layout.points;
    if (st.zones[zone] === on) return true;
    if (on && st.power === 'generator') {
      const live = ZONES.filter((z) => st.zones[z]).length;
      if (live >= GENERATOR_ZONE_LIMIT) {
        s.audio.play('breaker_thunk', { pos: P.electrical_panel, volume: 0.85 });
        s.lighting.flicker('electrical', 1.2, 0.6);
        s.ui.toast(LINES.generator.loadShed, 3);
        return false;
      }
    }
    s.store.setZone(zone, on);
    s.lighting.setZone(zone, on);
    s.audio.play(on ? 'breaker_click' : 'breaker_thunk', { pos: P.electrical_panel, volume: 0.7 });
    applyScreens(s);

    if (zone === 'west_wing') {
      if (on) {
        s.store.setFlag(F.paul_reset_west_wing);
        if (this.api.choice(C.west_wing_breaker) === undefined) this.api.addChoice(C.west_wing_breaker, 'West wing breaker', 'reset');
        this.westHum?.stop(0.2);
        this.westHum = s.audio.play('transformer_hum', { pos: P.closed_wing_door, loop: true, volume: 0.35, fadeIn: 2 });
        if (st.activeView === 'paul') this.later(() => this.api.say(LINES.generator.westWingHum, 3.4), 1800);
      } else {
        this.westHum?.stop(1.2);
        this.westHum = null;
        if (st.flags[F.paul_reset_west_wing]) s.store.setFlag(F.paul_shut_west_wing);
        s.store.setChar('paul', { danger: Math.min(s.store.char('paul').danger, 0.2) });
        if (st.activeView === 'paul') this.api.say('(the hum behind the door stops)', 2.8);
      }
    }
    if (zone === 'cctv' && on) {
      s.store.setFlag(F.paul_restored_cctv);
      s.store.setChar('paul', { status: 'Cameras restored' });
    }
    if (zone === 'exam' && on) {
      s.store.setFlag(F.paul_restored_exam);
      const john = s.store.char('john');
      s.store.setPerception('john', { fear: john.perception.fear * 0.5 });
      if (st.activeView === 'john' && john.location === 'exam3') this.later(() => this.api.say('[the lights come back on in Bay 3]', 3), 1500);
    }
    return true;
  }
}
