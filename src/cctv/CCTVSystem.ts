/**
 * CCTV — the surveillance view.
 *
 * One fixed PerspectiveCamera per layout camera. While active, renderFrame() pushes the
 * selected feed through PostFX in cctv mode. The realism comes from what cheap security
 * systems actually do: dropped frames held on screen, burnt-in clock jumps, vertical tears,
 * static bursts, a feed that "rolls back", short signal losses — all scheduled from a seeded
 * RNG and scaled by a phase-driven degradation level so the picture is never constantly
 * misbehaving. Power state and breaker zones decide which feeds are alive at all.
 */
import * as THREE from 'three';
import { formatClock24 } from '../core/clock';
import type { CCTVGlitch, ICCTVSystem, Services } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { CameraDef, GamePhase, GameState, PowerState, RoomId, Vec3, ViewId } from '../core/types';

export interface FootageMark {
  cameraId: string;
  label: string;
  /** game minutes */
  time: number;
}

/** Feed quality loss per phase (0 clean … 1 unwatchable). Resolution settles, but never heals. */
const PHASE_DEGRADATION: Record<GamePhase, number> = {
  normal: 0.1,
  unease: 0.25,
  contradictions: 0.4,
  outage: 0.7,
  generator: 0.7,
  crisis: 0.85,
  resolution: 0.6,
};

/** Noise the supply itself adds: brownouts roll the picture, the generator hums into it. */
const POWER_NOISE: Record<PowerState, number> = { normal: 0, unstable: 0.12, blackout: 0, generator: 0.05 };

const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 120;

interface Injection {
  frames: number;
  setup: (scene: THREE.Scene) => () => void;
}

interface ActiveGlitch {
  kind: CCTVGlitch;
  /** seconds left (also the fallback expiry for frame-counted kinds) */
  remaining: number;
  total: number;
  /** picture noise added while active (static / tear) */
  strength: number;
  /** skip + timestamp count rendered frames instead of seconds */
  framesLeft: number;
  /** game minutes added to the burnt-in clock */
  tsOffset: number;
  /** tear: vertical roll in radians */
  roll: number;
}

interface Feed {
  def: CameraDef;
  camera: THREE.PerspectiveCamera;
  basePos: THREE.Vector3;
  baseLookAt: THREE.Vector3;
  outdoor: boolean;
  /** derived from power state + breaker zones (director overrides live in `overrides`) */
  powered: boolean;
  /** per-feed phase so idle wobble differs between cameras */
  phase: number;
  injections: Injection[];
  glitches: ActiveGlitch[];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class CCTVSystem implements ICCTVSystem {
  private s!: Services;
  private ready = false;

  private feeds: Feed[] = [];
  private byId = new Map<string, Feed>();
  private current: Feed | null = null;
  private _active = false;
  private lastUsed: string | null = null;

  /** director overrides — only kept while they contradict the power-derived state */
  private overrides = new Map<string, boolean>();
  /** burnt-in clock replacement per camera (the ending's impossible timestamp) */
  private tsOverrides = new Map<string, string>();
  private footageLog: FootageMark[] = [];

  /** glitch scheduler stream */
  private rng!: RNG;
  /** per-frame cosmetic stream (kept apart so it never disturbs scheduling) */
  private noise!: RNG;

  private degradation = PHASE_DEGRADATION.normal;
  private degradationTarget = PHASE_DEGRADATION.normal;
  /** transient noise impulse (switches, resyncs, feed loss) — decays fast */
  private spike = 0;
  /** frames to hold the previous image (resync hitch) */
  private holdFramesLeft = 0;
  private frozenTimestamp = '';
  private nextGlitchIn = 0;
  /** no random glitches right after a switch so the picture reads first */
  private settle = 0;
  /** delayed dead-feed tone (-1 = none) */
  private offlineToneIn = -1;
  private listDirty = true;
  private elapsed = 0;

  /** rendered in place of the scene when a feed is dead — the shader paints the NO SIGNAL noise */
  private readonly blankScene = new THREE.Scene();
  private readonly v2 = new THREE.Vector2();
  private readonly v3 = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private offs: (() => void)[] = [];

  get active(): boolean {
    return this._active;
  }

  get currentCamera(): CameraDef | null {
    return this._active && this.current ? this.current.def : null;
  }

  /** Clip markers recorded this run (newest last). */
  get footage(): readonly FootageMark[] {
    return this.footageLog;
  }

  /** Current smoothed degradation 0..1 (before transient spikes). */
  get degradationLevel(): number {
    return this.degradation;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.blankScene.background = new THREE.Color(0x000000);
    this.buildFeeds();
    this.reseed();
    this.ready = true;

    const phase = services.store.get().phase;
    this.degradation = this.degradationTarget = PHASE_DEGRADATION[phase];
    this.recomputePower();

    const bus = services.bus;
    this.offs.push(
      bus.on('phase:change', ({ phase: p }) => this.setDegradation(PHASE_DEGRADATION[p])),
      bus.on('power:change', () => this.recomputePower()),
      bus.on('zone:change', ({ zone }) => {
        if (this.feeds.some((f) => f.def.zone === zone)) this.recomputePower();
      }),
      bus.on('game:new', () => this.resetRun()),
      bus.on('view:change', ({ view }) => {
        if (view !== 'cctv' && this._active) this.exit();
      }),
    );
  }

  update(dt: number, _gdt: number): void {
    if (!this.ready) return;
    const st = this.s.store.get();
    this.elapsed += dt;

    // Degradation eases toward its target; a large step (generator start) is itself an event.
    const diff = this.degradationTarget - this.degradation;
    if (Math.abs(diff) > 0.2) {
      this.spike = Math.max(this.spike, 0.6);
      if (this._active && this.holdFramesLeft === 0) this.holdFramesLeft = 2;
      this.degradation += diff * 0.5;
    } else {
      this.degradation += diff * Math.min(1, dt * 2.5);
    }
    this.spike *= Math.exp(-dt * 9);
    if (this.spike < 0.002) this.spike = 0;

    // Glitch clocks freeze with the game: a paused console shows a frozen picture, not a rolling one.
    const running = st.screen === 'playing' && !st.paused;
    if (!running) return;

    this.settle = Math.max(0, this.settle - dt);

    if (this.offlineToneIn >= 0) {
      this.offlineToneIn -= dt;
      if (this.offlineToneIn < 0) {
        this.offlineToneIn = -1;
        if (this._active) this.s.audio.play('cctv_offline', { nonSpatial: true, volume: 0.45 });
      }
    }

    for (const feed of this.feeds) {
      if (feed.glitches.length === 0) continue;
      for (let i = feed.glitches.length - 1; i >= 0; i--) {
        const g = feed.glitches[i];
        g.remaining -= dt;
        if (g.remaining <= 0) {
          feed.glitches.splice(i, 1);
          this.endGlitch(feed, g);
        }
      }
    }

    const cur = this.current;
    if (
      this._active &&
      cur &&
      this.settle <= 0 &&
      cur.glitches.length === 0 &&
      cur.injections.length === 0 &&
      this.isOnline(cur.def.id)
    ) {
      this.nextGlitchIn -= dt;
      if (this.nextGlitchIn <= 0) {
        this.beginGlitch(cur, this.randomGlitch(st));
        this.nextGlitchIn = this.nextInterval(st);
      }
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this._active) this.exit();
    for (const f of this.feeds) {
      f.injections = [];
      f.glitches = [];
    }
    this.feeds = [];
    this.byId.clear();
    this.current = null;
    this.ready = false;
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  enter(cameraId?: string): void {
    if (!this.ready || this.feeds.length === 0) return;
    const requested = cameraId ? this.byId.get(cameraId) : undefined;
    const last = this.lastUsed ? this.byId.get(this.lastUsed) : undefined;
    const pick = requested ?? last ?? this.feeds.find((f) => this.isOnline(f.def.id)) ?? this.feeds[0];
    this._active = true;
    this.setCurrent(pick, true, true);
    this.settle = 0.8;
    this.nextGlitchIn = this.rng.range(3, 8);
    // The monitor_on transition tail is still playing: let the dead-feed tone land after it.
    this.offlineToneIn = this.isOnline(pick.def.id) ? -1 : 0.4;
  }

  exit(): void {
    if (!this._active) return;
    this._active = false;
    this.holdFramesLeft = 0;
    this.offlineToneIn = -1;
    this.s.ui.setCCTVOverlay({ visible: false });
  }

  select(cameraId: string): void {
    const feed = this.byId.get(cameraId);
    if (!feed) return;
    this.setCurrent(feed, !this._active);
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  list(): CameraDef[] {
    return this.feeds.map((f) => f.def);
  }

  isOnline(cameraId: string): boolean {
    const feed = this.byId.get(cameraId);
    if (!feed) return false;
    const o = this.overrides.get(cameraId);
    return o ?? feed.powered;
  }

  setOnline(cameraId: string, online: boolean): void {
    const feed = this.byId.get(cameraId);
    if (!feed) return;
    const was = this.isOnline(cameraId);
    // An override that agrees with the power state is no override: fall back to following power.
    if (online === feed.powered) this.overrides.delete(cameraId);
    else this.overrides.set(cameraId, online);
    this.listDirty = true;
    if (this._active && this.current === feed) {
      const now = this.isOnline(cameraId);
      if (was && !now) this.onCurrentLost();
      else if (!was && now) this.onCurrentRestored();
    }
  }

  setDegradation(level: number): void {
    this.degradationTarget = clamp01(level);
  }

  cameraObject(cameraId: string): THREE.PerspectiveCamera | undefined {
    return this.byId.get(cameraId)?.camera;
  }

  // ---------------------------------------------------------------------------
  // Glitches
  // ---------------------------------------------------------------------------

  glitch(cameraId: string, kind: CCTVGlitch, seconds: number): void {
    const feed = this.byId.get(cameraId);
    if (!feed || !this.ready) return;
    const sec = Math.max(0.05, Number.isFinite(seconds) ? seconds : 0.2);
    const g = this.blankGlitch(kind, sec);
    switch (kind) {
      case 'static':
        g.strength = clamp(0.45 + sec * 0.5, 0.45, 0.95);
        break;
      case 'skip':
        g.framesLeft = clamp(Math.round(sec * 60), 2, 40);
        g.remaining = g.total = Math.max(sec, g.framesLeft / 20);
        break;
      case 'timestamp':
        g.framesLeft = clamp(Math.round(sec * 60), 3, 90);
        g.tsOffset = (this.rng.chance(0.6) ? -1 : 1) * this.rng.int(1, 11);
        g.remaining = g.total = Math.max(sec, g.framesLeft / 20);
        break;
      case 'tear':
        g.strength = 0.6;
        g.roll = (this.rng.chance(0.5) ? -1 : 1) * this.rng.range(0.005, 0.012);
        break;
      case 'rollback':
        g.remaining = g.total = clamp(sec, 0.5, 4);
        break;
      case 'freeze':
      case 'offline_blip':
        break;
    }
    this.beginGlitch(feed, g);
  }

  /**
   * Scripted burnt-in clock jump (e.g. "cam_hall_e reads 11 minutes earlier"). Negative = backwards.
   * Not part of ICCTVSystem; reach it with a structural cast.
   */
  jumpTimestamp(cameraId: string, offsetMinutes: number, seconds: number): void {
    const feed = this.byId.get(cameraId);
    if (!feed || !this.ready) return;
    const sec = Math.max(0.05, seconds);
    const g = this.blankGlitch('timestamp', sec);
    g.framesLeft = clamp(Math.round(sec * 60), 3, 600);
    g.tsOffset = offsetMinutes;
    g.remaining = g.total = Math.max(sec, g.framesLeft / 20);
    this.beginGlitch(feed, g);
  }

  /** Replace a feed's burnt-in clock with fixed text (null clears). Used for the impossible timestamp. */
  setTimestampOverride(cameraId: string, text: string | null): void {
    if (text === null) this.tsOverrides.delete(cameraId);
    else this.tsOverrides.set(cameraId, text);
  }

  inject(cameraId: string, frames: number, setup: (scene: THREE.Scene) => () => void): void {
    const feed = this.byId.get(cameraId);
    if (!feed) return;
    const n = Math.max(1, Math.floor(frames));
    feed.injections.push({ frames: n, setup });
  }

  markFootage(cameraId: string, label: string): void {
    if (!this.ready) return;
    const feed = this.byId.get(cameraId);
    const time = this.s.store.get().time;
    this.footageLog.push({ cameraId, label, time });
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
    const name = feed?.def.name ?? cameraId.toUpperCase();
    const added = this.s.store.addClue({
      id: `footage:${cameraId}:${slug}`,
      title: label,
      text: `${name} · ${formatClock24(time, false)} — ${label}`,
      source: 'cctv',
      time,
      kind: 'footage',
      supports: 'ambiguous',
    });
    if (added && this._active) this.s.audio.play('monitor_beep', { nonSpatial: true, volume: 0.22 });
  }

  // ---------------------------------------------------------------------------
  // Coverage helpers (for witness logic; not part of ICCTVSystem)
  // ---------------------------------------------------------------------------

  /** Is a world point inside this camera's frustum (no occlusion test)? */
  covers(cameraId: string, p: Vec3, maxDist = 22): boolean {
    const feed = this.byId.get(cameraId);
    if (!feed) return false;
    const cam = feed.camera;
    this.v3.set(p.x, p.y, p.z);
    if (this.v3.distanceTo(cam.position) > maxDist) return false;
    cam.updateMatrixWorld();
    this.mat.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mat);
    return this.frustum.containsPoint(this.v3);
  }

  /** Cameras mounted in a room or whose frustum reaches its centre. */
  camerasFor(room: RoomId): CameraDef[] {
    const def = this.s?.layout.rooms.find((r) => r.id === room);
    if (!def) return [];
    const centre: Vec3 = { x: (def.bounds.x0 + def.bounds.x1) / 2, y: 1.2, z: (def.bounds.z0 + def.bounds.z1) / 2 };
    return this.feeds.filter((f) => f.def.room === room || this.covers(f.def.id, centre)).map((f) => f.def);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  renderFrame(): void {
    if (!this.ready || !this._active || !this.current) return;
    const s = this.s;
    const feed = this.current;
    const st = s.store.get();
    const scene = s.three.scene;

    this.syncAspect(feed);
    const blip = feed.glitches.some((g) => g.kind === 'offline_blip');
    const online = this.isOnline(feed.def.id) && !blip;

    this.poseCamera(feed, online, st);
    const cam = feed.camera;
    cam.getWorldDirection(this.dir);
    s.audio.setListener({ x: cam.position.x, y: cam.position.y, z: cam.position.z }, Math.atan2(-this.dir.x, -this.dir.z));
    // Lighting's pool and anything else that follows "the camera being rendered" should follow the feed.
    s.three.camera = cam;

    const cameras = this.listDirty ? this.overlayList() : undefined;

    // A dead feed has no picture to hold.
    if (!online) this.holdFramesLeft = 0;

    // Dropped frames: hold the last picture (nothing is drawn, the canvas keeps it), then resync with a jolt.
    if (online && feed.injections.length === 0) {
      let hold = false;
      if (this.holdFramesLeft > 0) {
        this.holdFramesLeft--;
        hold = true;
        if (this.holdFramesLeft === 0) this.spike = Math.max(this.spike, 0.3);
      }
      const skip = feed.glitches.find((g) => g.kind === 'skip' && g.framesLeft > 0);
      if (skip) {
        skip.framesLeft--;
        hold = true;
        if (skip.framesLeft <= 0) {
          feed.glitches.splice(feed.glitches.indexOf(skip), 1);
          this.spike = Math.max(this.spike, 0.25);
        }
      }
      if (feed.glitches.some((g) => g.kind === 'freeze')) hold = true;
      if (hold) {
        s.ui.setCCTVOverlay({ visible: true, cameras, timestamp: this.frozenTimestamp, label: feed.def.name, online: true });
        this.listDirty = false;
        return;
      }
    }

    const rollback = feed.glitches.some((g) => g.kind === 'rollback');
    const timestamp = this.timestampFor(feed, st);
    this.frozenTimestamp = timestamp;
    const degradation = this.effectiveDegradation(feed, st);

    s.postfx.setCCTVParams({ degradation, online, label: feed.def.name, timestamp, recording: online && !rollback });
    s.ui.setCCTVOverlay({ visible: true, cameras, timestamp, label: feed.def.name, online });
    this.listDirty = false;

    const prevView: ViewId = st.activeView;
    s.characters.setViewFilter('cctv');
    if (online) {
      const cleanups: (() => void)[] = [];
      for (const inj of feed.injections) {
        try {
          cleanups.push(inj.setup(scene));
        } catch (err) {
          console.error('[cctv] injection setup threw', err);
        }
      }
      s.postfx.render(scene, cam);
      for (const cleanup of cleanups) {
        try {
          cleanup();
        } catch (err) {
          console.error('[cctv] injection cleanup threw', err);
        }
      }
      if (feed.injections.length > 0) {
        for (let i = feed.injections.length - 1; i >= 0; i--) {
          if (--feed.injections[i].frames <= 0) feed.injections.splice(i, 1);
        }
        // The encoder "stumbles" on the frame after something impossible: a faint resync, never a flash.
        if (feed.injections.length === 0) this.spike = Math.max(this.spike, 0.15);
      }
    } else {
      s.postfx.render(this.blankScene, cam);
    }
    s.characters.setViewFilter(prevView);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private buildFeeds(): void {
    this.s.three.renderer.getSize(this.v2);
    const aspect = this.v2.x / Math.max(1, this.v2.y);
    const rooms = this.s.layout.rooms;
    this.feeds = this.s.layout.cameras.map((def, i) => {
      const camera = new THREE.PerspectiveCamera(def.fov, aspect, CAMERA_NEAR, CAMERA_FAR);
      camera.name = def.id;
      const basePos = new THREE.Vector3(def.pos.x, def.pos.y, def.pos.z);
      const baseLookAt = new THREE.Vector3(def.lookAt.x, def.lookAt.y, def.lookAt.z);
      camera.position.copy(basePos);
      camera.lookAt(baseLookAt);
      camera.updateMatrixWorld();
      const room = rooms.find((r) => r.id === def.room);
      return {
        def,
        camera,
        basePos,
        baseLookAt,
        outdoor: !!room?.outdoor,
        powered: true,
        phase: i * 1.7,
        injections: [],
        glitches: [],
      };
    });
    this.byId = new Map(this.feeds.map((f) => [f.def.id, f]));
  }

  private reseed(): void {
    this.rng = this.s.rng.fork('cctv');
    this.noise = this.s.rng.fork('cctv:noise');
  }

  private resetRun(): void {
    this.reseed();
    this.overrides.clear();
    this.tsOverrides.clear();
    this.footageLog = [];
    for (const f of this.feeds) {
      f.injections = [];
      f.glitches = [];
    }
    const st = this.s.store.get();
    this.degradation = this.degradationTarget = PHASE_DEGRADATION[st.phase];
    this.spike = 0;
    this.holdFramesLeft = 0;
    this.offlineToneIn = -1;
    this.lastUsed = null;
    if (this._active) this.exit();
    this.current = null;
    this.recomputePower();
  }

  private recomputePower(): void {
    const st = this.s.store.get();
    const wasOnline = this.current ? this.isOnline(this.current.def.id) : true;
    for (const f of this.feeds) {
      if (st.power === 'blackout') f.powered = false;
      else if (st.power === 'generator') f.powered = f.def.survivesBlackout && (f.def.zone ? st.zones[f.def.zone] : true);
      else f.powered = true;
    }
    this.listDirty = true;
    if (!this._active || !this.current) return;
    const nowOnline = this.isOnline(this.current.def.id);
    if (wasOnline && !nowOnline) this.onCurrentLost();
    else if (!wasOnline && nowOnline) this.onCurrentRestored();
  }

  private onCurrentLost(): void {
    this.spike = Math.max(this.spike, 0.8);
    this.holdFramesLeft = 0;
    this.offlineToneIn = 0.12;
    this.s.postfx.pulse('glitch', 0.5);
  }

  private onCurrentRestored(): void {
    this.spike = Math.max(this.spike, 0.7);
    this.holdFramesLeft = 2;
    this.offlineToneIn = -1;
    this.s.audio.play('static_burst', { nonSpatial: true, volume: 0.3 });
  }

  private setCurrent(feed: Feed, silent: boolean, announce = false): void {
    const changed = feed !== this.current;
    this.current = feed;
    this.lastUsed = feed.def.id;
    this.listDirty = true;
    this.holdFramesLeft = 0;
    const st = this.s.store.get();
    this.frozenTimestamp = formatClock24(st.time);
    this.syncAspect(feed);
    if (this._active) {
      this.s.audio.setRoom(feed.def.room);
      if (st.activeView === 'cctv' && st.activeCamera !== feed.def.id) {
        this.s.store.update((d: GameState) => {
          d.activeCamera = feed.def.id;
        });
      }
    }
    if (changed || announce) this.s.bus.emit('camera:change', { cameraId: feed.def.id });
    if (silent || !changed) return;
    // Channel change on a real switcher: a click, a one-frame roll, then the dead-feed tone if there is nothing there.
    this.settle = 0.35;
    this.nextGlitchIn = Math.max(this.nextGlitchIn, 2.5);
    this.spike = Math.max(this.spike, 0.3);
    this.s.postfx.pulse('glitch', 0.2);
    this.s.audio.play('cctv_switch', { nonSpatial: true, volume: 0.5 });
    this.offlineToneIn = this.isOnline(feed.def.id) ? -1 : 0.2;
  }

  private step(dir: number): void {
    const n = this.feeds.length;
    if (n === 0) return;
    const i = this.current ? this.feeds.indexOf(this.current) : -1;
    const j = i < 0 ? 0 : (((i + dir) % n) + n) % n;
    this.setCurrent(this.feeds[j], !this._active);
  }

  private overlayList(): { id: string; name: string; online: boolean; active: boolean }[] {
    return this.feeds.map((f) => ({
      id: f.def.id,
      name: f.def.name,
      online: this.isOnline(f.def.id),
      active: f === this.current,
    }));
  }

  private syncAspect(feed: Feed): void {
    this.s.three.renderer.getSize(this.v2);
    const aspect = this.v2.x / Math.max(1, this.v2.y);
    if (Math.abs(feed.camera.aspect - aspect) > 1e-4) {
      // Keep every feed consistent so coverage checks match what the player would see.
      for (const f of this.feeds) {
        f.camera.aspect = aspect;
        f.camera.updateProjectionMatrix();
      }
    }
  }

  private poseCamera(feed: Feed, online: boolean, st: Readonly<GameState>): void {
    const cam = feed.camera;
    cam.position.copy(feed.basePos);
    cam.lookAt(feed.baseLookAt);
    if (online && st.settings.motionEffects) {
      let pitch = 0;
      let yaw = 0;
      const e = this.elapsed;
      const ph = feed.phase;
      if (feed.outdoor) {
        // Wind on a pole mount: slow breathing, a couple of pixels at most.
        pitch += 0.002 * Math.sin(e * 0.9 + ph) + 0.001 * Math.sin(e * 2.3 + ph * 2.1);
        yaw += 0.0015 * Math.sin(e * 0.6 + ph);
      }
      for (const g of feed.glitches) {
        if (g.kind === 'tear') {
          const p = 1 - g.remaining / g.total;
          pitch += g.roll * (1 - p) * (p < 0.3 ? p / 0.3 : 1);
        } else if (g.kind === 'rollback') {
          pitch += this.noise.range(-1, 1) * 0.0015;
          yaw += this.noise.range(-1, 1) * 0.001;
        }
      }
      // A degraded link occasionally hops a line or two.
      const hopChance = (this.degradation - 0.5) * 0.03;
      if (hopChance > 0 && this.noise.chance(hopChance)) pitch += this.noise.range(-1, 1) * 0.0014;
      if (pitch !== 0) cam.rotateX(pitch);
      if (yaw !== 0) cam.rotateY(yaw);
    }
    cam.updateMatrixWorld();
  }

  private timestampFor(feed: Feed, st: Readonly<GameState>): string {
    const override = this.tsOverrides.get(feed.def.id);
    if (override !== undefined) return override;
    let t = st.time;
    for (let i = feed.glitches.length - 1; i >= 0; i--) {
      const g = feed.glitches[i];
      if (g.kind === 'timestamp' && g.framesLeft > 0) {
        t += g.tsOffset;
        if (--g.framesLeft <= 0) feed.glitches.splice(i, 1);
      } else if (g.kind === 'rollback') {
        t -= (2 * this.s.clock.timeScale) / 60;
      }
    }
    let text = formatClock24(t);
    // A dying encoder drops the odd digit of the burnt-in clock — one frame, now and then.
    if (this.degradation >= 0.75 && this.noise.chance(0.012)) {
      const digits: number[] = [];
      for (let i = 0; i < text.length; i++) if (text[i] !== ':') digits.push(i);
      const idx = this.noise.pick(digits);
      const glyph = this.noise.pick(['8', ' ', '0']);
      text = text.slice(0, idx) + glyph + text.slice(idx + 1);
    }
    return text;
  }

  private effectiveDegradation(feed: Feed, st: Readonly<GameState>): number {
    const fs = st.settings.reducedFlicker ? 0.6 : 1;
    let d = this.degradation + POWER_NOISE[st.power];
    d += this.spike * 0.85 * fs;
    // The noise floor breathes slowly so even a quiet feed is never a fixed texture.
    d += 0.05 * this.degradation * Math.sin(this.elapsed * 0.7 + feed.phase);
    for (const g of feed.glitches) {
      switch (g.kind) {
        case 'static': {
          const p = 1 - g.remaining / g.total;
          const env = p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85;
          d += g.strength * Math.max(0, env) * fs;
          break;
        }
        case 'tear':
          d += 0.22 * g.strength * fs;
          break;
        case 'rollback':
          d += 0.18;
          break;
        case 'timestamp':
          d += 0.04;
          break;
        case 'skip':
        case 'freeze':
        case 'offline_blip':
          break;
      }
    }
    return clamp01(d);
  }

  private blankGlitch(kind: CCTVGlitch, seconds: number): ActiveGlitch {
    return { kind, remaining: seconds, total: seconds, strength: 0, framesLeft: 0, tsOffset: 0, roll: 0 };
  }

  private nextInterval(st: Readonly<GameState>): number {
    const d = clamp01(this.degradationTarget);
    let base = 26 - 21 * d;
    if (st.power === 'unstable') base *= 0.5;
    return base * this.rng.range(0.55, 1.7);
  }

  private randomGlitch(st: Readonly<GameState>): ActiveGlitch {
    const d = clamp01(this.degradation + POWER_NOISE[st.power]);
    const r = this.rng;
    const kind = r.weighted<CCTVGlitch>([
      { item: 'static', weight: 1.6 + 1.0 * d },
      { item: 'skip', weight: 1.4 + 1.2 * d },
      { item: 'timestamp', weight: 0.5 + 2.0 * d },
      { item: 'tear', weight: 1.0 + 1.2 * d },
      { item: 'freeze', weight: d > 0.5 ? (d - 0.5) * 2.4 : 0 },
      { item: 'rollback', weight: d > 0.6 ? (d - 0.6) / 0.4 : 0 },
      { item: 'offline_blip', weight: d > 0.65 ? (d - 0.65) / 0.35 : 0 },
    ]);
    switch (kind) {
      case 'static': {
        const g = this.blankGlitch(kind, r.range(0.08, 0.35));
        g.strength = clamp01(r.range(0.3, 0.55) + 0.4 * d);
        return g;
      }
      case 'skip': {
        const frames = r.int(2, 6);
        const g = this.blankGlitch(kind, frames / 20);
        g.framesLeft = frames;
        return g;
      }
      case 'timestamp': {
        const frames = r.int(3, 8);
        const g = this.blankGlitch(kind, frames / 20);
        g.framesLeft = frames;
        g.tsOffset = (r.chance(0.6) ? -1 : 1) * r.int(1, 11);
        return g;
      }
      case 'tear': {
        const g = this.blankGlitch(kind, r.range(0.1, 0.3));
        g.strength = r.range(0.4, 0.8);
        g.roll = (r.chance(0.5) ? -1 : 1) * r.range(0.004, 0.012);
        return g;
      }
      case 'freeze':
        return this.blankGlitch(kind, r.range(0.3, 0.8));
      case 'rollback':
        return this.blankGlitch(kind, r.range(1, 2));
      case 'offline_blip':
        return this.blankGlitch(kind, r.range(0.3, 1.2));
    }
  }

  private beginGlitch(feed: Feed, g: ActiveGlitch): void {
    // One of each kind per feed; a new request replaces the old one.
    feed.glitches = feed.glitches.filter((x) => x.kind !== g.kind);
    feed.glitches.push(g);
    if (!this._active || feed !== this.current) return;
    const fs = this.s.store.get().settings.reducedFlicker ? 0.6 : 1;
    switch (g.kind) {
      case 'static':
        this.spike = Math.max(this.spike, 0.25 * g.strength);
        if (g.strength > 0.35) this.s.postfx.pulse('glitch', 0.35 * g.strength * fs);
        if (g.strength > 0.55) this.s.audio.play('static_burst', { nonSpatial: true, volume: 0.1 + 0.25 * g.strength });
        break;
      case 'tear':
        this.s.postfx.pulse('glitch', (0.25 + 0.3 * g.strength) * fs);
        break;
      case 'rollback':
        this.holdFramesLeft = 2;
        this.spike = Math.max(this.spike, 0.35);
        this.s.audio.play('static_burst', { nonSpatial: true, volume: 0.14 });
        break;
      case 'offline_blip':
        this.s.audio.play(g.total >= 0.6 ? 'cctv_offline' : 'static_burst', { nonSpatial: true, volume: 0.3 });
        break;
      case 'skip':
      case 'freeze':
      case 'timestamp':
        break;
    }
  }

  private endGlitch(feed: Feed, g: ActiveGlitch): void {
    if (!this._active || feed !== this.current) return;
    switch (g.kind) {
      case 'freeze':
        this.spike = Math.max(this.spike, 0.45);
        if (g.total >= 0.6) this.s.audio.play('static_burst', { nonSpatial: true, volume: 0.12 });
        break;
      case 'rollback':
        this.spike = Math.max(this.spike, 0.4);
        this.holdFramesLeft = 1;
        break;
      case 'offline_blip':
        this.spike = Math.max(this.spike, 0.6);
        break;
      case 'skip':
        this.spike = Math.max(this.spike, 0.25);
        break;
      case 'static':
      case 'tear':
      case 'timestamp':
        break;
    }
  }
}
