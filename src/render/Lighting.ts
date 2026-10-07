/**
 * Lighting system. Owns scene.fog / background / environment, a dim hemisphere and a
 * FIXED set of lights (14 pool PointLights, a shadow-casting key SpotLight that follows
 * the nearest energised ceiling fixture, the flashlight SpotLight, a dawn
 * DirectionalLight) so shader programs never recompile. Each frame the pool is handed
 * to the most relevant energised fixtures around the active camera; every fixture also
 * has an emissive mesh so the far ones still read as lit.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { ILightingSystem, LightMode, Services } from '../core/contracts';
import { hashString, type RNG } from '../core/rng';
import type { FixtureKind, LightFixtureDef, PowerState, RoomDef, RoomId, Vec2, Vec3, ZoneId } from '../core/types';
import { roomAt } from '../world/layout';
import { fluorescentPanelTexture } from './textures';
import {
  StaticBatcher,
  buildDoorSeamVisual,
  buildFixtureVisual,
  disposeFixtureTextures,
  fallbackLensTexture,
  type FixtureVisual,
  type LensTextures,
} from './Lighting.fixtures';
import {
  BallastFlicker,
  StrikeEnvelope,
  ValueNoise1D,
  approach,
  blackoutStutter,
  bump,
  clamp01,
  dyingLevel,
  hash01,
  smoothstep01,
  type StrikeKind,
} from './Lighting.flicker';

const POOL_SIZE = 14;

type Circuit = LightFixtureDef['circuit'];

interface KindSpec {
  color: number;
  cd: number;
  range: number;
  strike: StrikeKind;
  glowTau: number;
}

/** Colour temperatures and photometry per fixture kind (candela, metres). */
const KIND: Record<FixtureKind, KindSpec> = {
  fluorescent: { color: 0xdfe9ff, cd: 8, range: 7.5, strike: 'fluorescent', glowTau: 0.1 },
  strip: { color: 0xe2ebff, cd: 8, range: 6.5, strike: 'fluorescent', glowTau: 0.1 },
  can: { color: 0xfff1dc, cd: 7, range: 4.5, strike: 'snap', glowTau: 0.04 },
  exit: { color: 0xff3b2a, cd: 0.7, range: 2.6, strike: 'quick', glowTau: 0.03 },
  emergency: { color: 0xfff0d6, cd: 15, range: 7, strike: 'snap', glowTau: 0.03 },
  sodium: { color: 0xffa040, cd: 12, range: 15, strike: 'warm', glowTau: 0.08 },
  lamp: { color: 0xffd9a0, cd: 5, range: 4, strike: 'snap', glowTau: 0.04 },
  desk: { color: 0xffe9c4, cd: 7, range: 3.2, strike: 'quick', glowTau: 0.04 },
  monitor: { color: 0x8fd0ff, cd: 5, range: 3, strike: 'quick', glowTau: 0.03 },
  vending: { color: 0x9fd3ff, cd: 7, range: 3.5, strike: 'quick', glowTau: 0.03 },
};

const SODIUM_EMBER = new THREE.Color(0xff4a10);
const DEFAULT_SECONDS: Record<LightMode, number> = { on: 0, off: 0, dim: 0.6, dying: 8, flicker: 0 };
const ZONE_SNAP_ORDER: ZoneId[] = ['corridor_w', 'corridor_e', 'service', 'exam', 'public', 'cctv', 'west_wing'];

interface Look {
  fog: THREE.Color;
  density: number;
  bg: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
  hemi: number;
  env: number;
  /** brightness floor reported by brightnessAt */
  ambient: number;
}

function look(fog: number, density: number, bg: number, sky: number, ground: number, hemi: number, env: number, ambient: number): Look {
  return { fog: new THREE.Color(fog), density, bg: new THREE.Color(bg), sky: new THREE.Color(sky), ground: new THREE.Color(ground), hemi, env, ambient };
}

const LOOKS: Record<PowerState, Look> = {
  normal: look(0x0b0d10, 0.018, 0x060709, 0x8a96a6, 0x3a3632, 0.8, 0.2, 0.06),
  unstable: look(0x0b0d10, 0.018, 0x060709, 0x8a96a6, 0x3a3632, 0.8, 0.2, 0.06),
  blackout: look(0x020203, 0.05, 0x010102, 0x3b4656, 0x141518, 1.0, 0.0, 0.004),
  generator: look(0x05060a, 0.03, 0x030305, 0x4a5564, 0x1a1816, 0.7, 0.08, 0.015),
};
/** Fixture emissive gain over the per-kind bases (see PostFX bloom threshold). */
const EMISSIVE_GAIN = 1.8;

const DAWN = look(0x6e7c8c, 0.012, 0x7f8c9a, 0xb9c6d4, 0x5a5856, 1.3, 0.45, 0.5);

interface Fixture {
  id: string;
  kind: FixtureKind;
  room: RoomId;
  zone: ZoneId | undefined;
  circuit: Circuit;
  flickerProne: boolean;
  /** not part of a room's switch group (e.g. the west-wing door glow) */
  special: boolean;
  isGlow: boolean;
  glowOn: boolean;
  /** pool-light position */
  pos: THREE.Vector3;
  /** def position (distances, audio) */
  anchor: THREE.Vector3;
  color: THREE.Color;
  liveColor: THREE.Color;
  cd: number;
  range: number;
  strikeKind: StrikeKind;
  glowTau: number;
  seed: number;
  mode: LightMode;
  modeT: number;
  modeSeconds: number;
  modeFrom: number;
  lastEnvelope: number;
  tempRestore: LightMode | null;
  tempLeft: number;
  tempIntensity: number;
  flick: BallastFlicker;
  flutter: ValueNoise1D;
  strike: StrikeEnvelope | null;
  strikeDelay: number;
  powered: boolean;
  gate: number;
  warm: number;
  level: number;
  glow: number;
  visual: FixtureVisual | null;
  light: PoolLight | null;
  score: number;
  keyScore: number;
  dieAt: number;
  camDist2: number;
}

interface PoolLight {
  light: THREE.PointLight;
  /** fixture the light is physically placed at */
  fixture: Fixture | null;
  /** fixture it should move to (null = park) */
  target: Fixture | null;
  gate: number;
}

interface PowerSequence {
  kind: 'blackout' | 'generator';
  t: number;
  from: PowerState;
  snapAt: Map<ZoneId | 'none', number>;
  snapped: Set<ZoneId | 'none'>;
  end: number;
}

interface Pulse {
  t: number;
  T: number;
  depth: number;
}

interface Timer {
  t: number;
  fn: () => void;
}

interface EnvState {
  fog: THREE.Color;
  density: number;
  bg: THREE.Color;
  sky: THREE.Color;
  ground: THREE.Color;
  hemi: number;
  env: number;
}

const V_A = new THREE.Vector3();
const V_B = new THREE.Vector3();
const V_C = new THREE.Vector3();
const V_D = new THREE.Vector3();
const Q_A = new THREE.Quaternion();

export class LightingSystem implements ILightingSystem {
  private s!: Services;
  private rng!: RNG;
  private ready = false;
  private scene!: THREE.Scene;
  private readonly root = new THREE.Group();
  private readonly fixtures: Fixture[] = [];
  private readonly byId = new Map<string, Fixture>();
  private readonly byRoom = new Map<RoomId, Fixture[]>();
  private readonly rooms = new Map<RoomId, RoomDef>();
  private readonly adjacent = new Map<RoomId, Set<RoomId>>();
  private zones: Record<ZoneId, boolean> = {
    corridor_w: true, corridor_e: true, exam: true, public: true, service: true, cctv: true, west_wing: false,
  };

  private readonly pool: PoolLight[] = [];
  private key!: THREE.SpotLight;
  private keyFixture: Fixture | null = null;
  private keyTarget: Fixture | null = null;
  private keyGate = 0;
  private keySwitchTimer = 0;

  private flash!: THREE.SpotLight;
  private flashWanted = false;
  private flashGate = 0;
  private readonly flashPrev = new THREE.Vector3();
  private flashHasPrev = false;
  private flashSpeed = 0;
  private flashNoiseA = new ValueNoise1D(11);
  private flashNoiseB = new ValueNoise1D(29);

  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private fog!: THREE.FogExp2;
  private readonly bg = new THREE.Color();
  private readonly cur: EnvState = {
    fog: new THREE.Color(), density: 0.018, bg: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), hemi: 0.8, env: 0.2,
  };
  private pmremTarget: THREE.WebGLRenderTarget | null = null;
  private statics: THREE.Mesh[] = [];
  private batch: StaticBatcher | null = null;
  private ledMaterial: THREE.MeshStandardMaterial | null = null;
  private lensTex!: LensTextures;

  private _power: PowerState = 'normal';
  private seq: PowerSequence | null = null;
  private globalMult = 1;
  private dawn = 0;
  private reduced = false;
  private motion = true;

  private unstableT = 0;
  private unstableNext = 0;
  private unstableCount = 0;
  private readonly brown = new Map<RoomId, Pulse>();
  private sag: Pulse | null = null;

  private readonly timers: Timer[] = [];
  private readonly offs: (() => void)[] = [];
  private time = 0;
  private readonly camPos = new THREE.Vector3(0, 1.65, 0);
  private camRoom: RoomId | null = null;
  private sfxCooldown = 0;
  private strikeSfxCooldown = 0;

  get powerState(): PowerState {
    return this._power;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.rng = services.rng.fork('lighting');
    this.scene = services.three.scene;
    for (const r of services.layout.rooms) this.rooms.set(r.id, r);
    for (const d of services.layout.doors) {
      this.link(d.a, d.b);
      this.link(d.b, d.a);
    }
    this.zones = { ...services.store.get().zones };
    const settings = services.store.get().settings;
    this.reduced = settings.reducedFlicker;
    this.motion = settings.motionEffects;

    // Fog, background, environment
    const base = LOOKS.normal;
    this.fog = new THREE.FogExp2(base.fog.getHex(), base.density);
    this.scene.fog = this.fog;
    this.bg.copy(base.bg);
    this.scene.background = this.bg;
    this.setupEnvironment();

    // Fixed light set
    this.hemi = new THREE.HemisphereLight(base.sky, base.ground, base.hemi);
    this.hemi.name = 'lighting_hemi';
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xc9d6e6, 0);
    this.sun.name = 'lighting_dawn';
    this.sun.position.set(42, 16, 30);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 6, 2);
      light.name = `lighting_pool_${i}`;
      light.castShadow = false;
      light.position.set(0, -50, 0);
      this.scene.add(light);
      this.pool.push({ light, fixture: null, target: null, gate: 0 });
    }

    this.key = new THREE.SpotLight(0xffffff, 0, 10, 1.05, 0.55, 2);
    this.key.name = 'lighting_key';
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.bias = -0.0003;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.camera.near = 0.3;
    this.key.shadow.autoUpdate = false;
    // Render each shadow map once up front: three r186 binds an un-compared depth texture to
    // sampler2DShadow arrays when a map is still null, which fails every shadow-receiving draw.
    this.key.shadow.needsUpdate = true;
    this.key.position.set(0, -50, 0);
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.flash = new THREE.SpotLight(0xfff2d0, 0, 22, 0.42, 0.5, 2);
    this.flash.name = 'lighting_flashlight';
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(1024, 1024);
    this.flash.shadow.bias = -0.0005;
    this.flash.shadow.normalBias = 0.02;
    this.flash.shadow.camera.near = 0.15;
    this.flash.shadow.autoUpdate = false;
    this.flash.shadow.needsUpdate = true;
    this.flash.position.set(0, -50, 0);
    this.scene.add(this.flash);
    this.scene.add(this.flash.target);

    // Fixtures
    this.root.name = 'lighting_fixtures';
    this.scene.add(this.root);
    this.lensTex = this.makeLensTextures();
    this.batch = new StaticBatcher();
    this.ledMaterial = this.batch.ledMaterial;
    for (const def of services.layout.lights) this.addFixture(def);
    this.addWestWingGlow();
    this.statics = this.batch.build();
    for (const m of this.statics) this.root.add(m);

    // Bus fallbacks (main / director call the methods directly)
    const bus = services.bus;
    this.offs.push(
      bus.on('zone:change', ({ zone, on }) => this.setZone(zone, on)),
      bus.on('power:change', ({ power }) => {
        if (power !== this._power) this.setPowerState(power);
      }),
      bus.on('settings:change', ({ settings: st }) => {
        this.reduced = st.reducedFlicker;
        this.motion = st.motionEffects;
      }),
      bus.on('game:new', () => this.resetForNewGame()),
      bus.on('view:change', ({ view }) => {
        this.flashWanted = view !== 'cctv' ? this.s.store.char(view).flashlight : false;
      }),
    );

    this.ready = true;
    this.setPowerState('normal', { immediate: true });
  }

  update(dtIn: number, _gdt: number): void {
    if (!this.ready) return;
    const dt = Math.min(0.1, Math.max(0, dtIn));
    this.time += dt;
    this.sfxCooldown = Math.max(0, this.sfxCooldown - dt);
    this.strikeSfxCooldown = Math.max(0, this.strikeSfxCooldown - dt);
    this.tickTimers(dt);
    this.updateCamera();
    this.advanceSequence(dt);
    if (this._power === 'unstable' && this.seq === null) this.updateUnstable(dt);
    this.updatePulses(dt);
    for (const f of this.fixtures) this.updateFixture(f, dt);
    this.assignPool(dt);
    this.updateKey(dt);
    this.updateFlashlight(dt);
    this.updateEnvironment(dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const f of this.fixtures) f.visual?.dispose();
    for (const m of this.statics) {
      m.geometry.dispose();
      m.removeFromParent();
    }
    this.batch?.dispose();
    this.root.removeFromParent();
    for (const p of this.pool) p.light.removeFromParent();
    this.key?.target.removeFromParent();
    this.key?.removeFromParent();
    this.flash?.target.removeFromParent();
    this.flash?.removeFromParent();
    this.hemi?.removeFromParent();
    this.sun?.target.removeFromParent();
    this.sun?.removeFromParent();
    if (this.scene) {
      this.scene.environment = null;
      this.scene.fog = null;
    }
    this.pmremTarget?.dispose();
    this.pmremTarget = null;
    disposeFixtureTextures();
    this.fixtures.length = 0;
    this.byId.clear();
    this.byRoom.clear();
    this.ready = false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setPowerState(p: PowerState, opts?: { immediate?: boolean }): void {
    const immediate = opts?.immediate === true;
    if (!this.ready) {
      this._power = p;
      return;
    }
    if (p === this._power && !immediate && this.seq === null) return;
    const from = this._power;
    this._power = p;
    this.seq = null;
    this.brown.clear();
    this.sag = null;
    if (p !== 'unstable') {
      this.unstableT = 0;
      this.unstableNext = 0;
      this.unstableCount = 0;
    }

    if (p === 'blackout' && !immediate) {
      // 0.3 s wing-wide stutter, then a wave of darkness spreading from the electrical room
      const origin = this.s.layout.points.electrical_panel ?? { x: 4, y: 1.4, z: 10 };
      for (const f of this.fixtures) {
        const d = Math.hypot(f.anchor.x - origin.x, f.anchor.z - origin.z);
        f.dieAt = 0.3 + Math.min(0.42, d / 70) + this.rng.range(0, 0.08);
      }
      this.seq = { kind: 'blackout', t: 0, from: from === 'blackout' ? 'normal' : from, snapAt: new Map(), snapped: new Set(), end: 0.95 };
    } else if (p === 'generator' && !immediate) {
      // 2 s of darkness, then energised zones snap on one at a time
      const snapAt = new Map<ZoneId | 'none', number>();
      let t = 2.0;
      snapAt.set('none', t);
      for (const z of ZONE_SNAP_ORDER) {
        if (!this.zones[z] || !this.zoneHasEmergencyFixtures(z)) continue;
        snapAt.set(z, t);
        t += 0.3;
      }
      this.seq = { kind: 'generator', t: 0, from, snapAt, snapped: new Set(), end: t + 0.6 };
    } else if ((p === 'normal' || p === 'unstable') && (from === 'blackout' || from === 'generator') && !immediate) {
      // the wing comes back staggered, tube by tube
      for (const f of this.fixtures) {
        if (f.strikeKind === 'fluorescent') f.strikeDelay = this.rng.range(0, 0.6);
      }
    }

    if (immediate) {
      this.settleImmediate();
      this.snapEnvironment();
    }
  }

  setZone(zone: ZoneId, on: boolean): void {
    if (this.zones[zone] === on) return;
    this.zones[zone] = on;
  }

  setRoomLights(room: RoomId, mode: LightMode, seconds?: number): void {
    let nearest: Fixture | null = null;
    for (const f of this.roomSwitchGroup(room)) {
      this.applyMode(f, mode, seconds, false);
      if (!nearest || f.camDist2 < nearest.camDist2) nearest = f;
    }
    // one sound for the whole room instead of one per fixture
    if (nearest && mode === 'flicker') this.sfx('light_buzz', nearest, 0.3);
  }

  setFixture(id: string, mode: LightMode, seconds?: number): void {
    const f = this.byId.get(id);
    if (f) this.applyMode(f, mode, seconds, true);
  }

  private applyMode(f: Fixture, mode: LightMode, seconds: number | undefined, sound: boolean): void {
    f.tempRestore = null;
    f.tempLeft = 0;
    if (f.mode === mode && mode !== 'dying' && mode !== 'flicker') {
      if (seconds !== undefined) f.modeSeconds = seconds;
      return;
    }
    f.modeFrom = f.lastEnvelope;
    f.mode = mode;
    f.modeT = 0;
    f.modeSeconds = seconds ?? DEFAULT_SECONDS[mode];
    if (mode === 'flicker') {
      f.flick.reset();
      f.tempIntensity = 1;
      if (sound) this.sfx('light_buzz', f, 0.3);
    }
  }

  flicker(room: RoomId, seconds: number, intensity = 1): void {
    let nearest: Fixture | null = null;
    for (const f of this.roomSwitchGroup(room)) {
      if (f.mode === 'off' || f.mode === 'dying') continue;
      this.tempFlicker(f, seconds, intensity, false);
      if (!nearest || f.camDist2 < nearest.camDist2) nearest = f;
    }
    if (nearest) this.sfx('light_buzz', nearest, 0.3);
  }

  cascadeOff(room: RoomId, toward: Vec2, stepSeconds: number): Promise<void> {
    const list = this.roomSwitchGroup(room).filter(
      (f) => f.mode !== 'off' && (f.kind === 'fluorescent' || f.kind === 'strip' || f.kind === 'can' || f.kind === 'lamp' || f.kind === 'desk'),
    );
    const d2 = (f: Fixture): number => (f.anchor.x - toward.x) ** 2 + (f.anchor.z - toward.z) ** 2;
    // farthest first: the darkness walks toward the point
    list.sort((a, b) => d2(b) - d2(a));
    return new Promise<void>((resolve) => {
      let i = 0;
      const next = (): void => {
        if (i >= list.length) {
          resolve();
          return;
        }
        const f = list[i++];
        // a quick sputter, then dark (the dying→off edge plays the pop)
        this.applyMode(f, 'dying', 0.22, false);
        this.timers.push({ t: Math.max(0.05, stepSeconds), fn: next });
      };
      next();
    });
  }

  setFlashlight(on: boolean): void {
    this.flashWanted = on;
  }

  brightnessAt(p: Vec3): number {
    if (!this.ready) return 0;
    let e = LOOKS[this._power].ambient * this.globalMult + this.dawn * 0.6;
    const room = roomAt({ x: p.x, z: p.z }, this.s.layout.rooms);
    for (const f of this.fixtures) {
      if (f.level < 0.01) continue;
      const dx = f.pos.x - p.x;
      const dy = f.pos.y - p.y;
      const dz = f.pos.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 170) continue;
      const w = room === null || f.room === room ? 1 : this.isAdjacent(f.room, room) ? 0.35 : 0.1;
      e += (f.level * f.cd * 0.085 * w) / (d2 + 0.6);
    }
    if (this.flash.intensity > 0.1) {
      V_A.set(p.x, p.y, p.z).sub(this.flash.position);
      const d2 = V_A.lengthSq();
      if (d2 < 200 && d2 > 1e-4) {
        V_B.copy(this.flash.target.position).sub(this.flash.position).normalize();
        const cos = V_A.normalize().dot(V_B);
        const edge = Math.cos(this.flash.angle);
        if (cos > edge) {
          const soft = smoothstep01((cos - edge) / Math.max(1e-3, 1 - edge));
          e += (this.flash.intensity * 0.085 * soft) / (d2 + 0.5);
        }
      }
    }
    return 1 - Math.exp(-e);
  }

  registerGlow(id: string, pos: Vec3, color: number, intensity: number, circuit: 'main' | 'emergency' | 'always'): void {
    const existing = this.byId.get(id);
    if (existing) {
      existing.pos.set(pos.x, pos.y, pos.z);
      existing.anchor.copy(existing.pos);
      if (existing.light && existing.light.fixture === existing) existing.light.light.position.copy(existing.pos);
      existing.color.set(color);
      existing.liveColor.copy(existing.color);
      existing.cd = Math.max(0.05, intensity) * 5;
      existing.circuit = circuit;
      existing.glowOn = true;
      const room = roomAt({ x: pos.x, z: pos.z }, this.s.layout.rooms);
      if (room && room !== existing.room) {
        const list = this.byRoom.get(existing.room);
        const i = list ? list.indexOf(existing) : -1;
        if (list && i >= 0) list.splice(i, 1);
        existing.room = room;
        this.roomList(room).push(existing);
      }
      return;
    }
    const room = roomAt({ x: pos.x, z: pos.z }, this.s.layout.rooms) ?? 'corridor';
    const def: LightFixtureDef = { id, room, pos: { ...pos }, kind: 'monitor', circuit, color, intensity };
    const f = this.makeFixture(def, null, new THREE.Color(color), Math.max(0.05, intensity) * 5, 3.2, true);
    f.strikeKind = 'quick';
    this.register(f);
  }

  setGlow(id: string, on: boolean): void {
    const f = this.byId.get(id);
    if (f) f.glowOn = on;
  }

  setGlobalIntensity(mult: number): void {
    this.globalMult = Math.max(0, Math.min(2, mult));
  }

  setDawn(amount: number): void {
    this.dawn = clamp01(amount);
  }

  // ---------------------------------------------------------------------------
  // Setup helpers
  // ---------------------------------------------------------------------------

  private setupEnvironment(): void {
    try {
      const pmrem = new THREE.PMREMGenerator(this.s.three.renderer);
      const room = new RoomEnvironment();
      this.pmremTarget = pmrem.fromScene(room, 0.04);
      this.scene.environment = this.pmremTarget.texture;
      this.scene.environmentIntensity = LOOKS.normal.env;
      room.dispose();
      pmrem.dispose();
    } catch (err) {
      console.warn('[lighting] environment map unavailable', err);
      this.scene.environment = null;
    }
  }

  private makeLensTextures(): LensTextures {
    const cache = new Map<string, THREE.Texture>();
    const get = (on: boolean, warm: number): THREE.Texture => {
      const key = `${on ? 1 : 0}:${warm}`;
      let t = cache.get(key);
      if (t) return t;
      try {
        const made: unknown = fluorescentPanelTexture({ on, warm });
        t = made instanceof THREE.Texture ? made : fallbackLensTexture(on, warm);
      } catch (err) {
        console.warn('[lighting] fluorescentPanelTexture failed; using fallback lens', err);
        t = fallbackLensTexture(on, warm);
      }
      cache.set(key, t);
      return t;
    };
    return { on: (w) => get(true, w), off: (w) => get(false, w) };
  }

  private link(a: RoomId, b: RoomId): void {
    let set = this.adjacent.get(a);
    if (!set) {
      set = new Set();
      this.adjacent.set(a, set);
    }
    set.add(b);
  }

  private isAdjacent(a: RoomId, b: RoomId): boolean {
    return a === b || (this.adjacent.get(a)?.has(b) ?? false);
  }

  private roomList(room: RoomId): Fixture[] {
    let list = this.byRoom.get(room);
    if (!list) {
      list = [];
      this.byRoom.set(room, list);
    }
    return list;
  }

  /** Fixtures a room's wall switch would control (no exit signs, glows or specials). */
  private roomSwitchGroup(room: RoomId): Fixture[] {
    return (this.byRoom.get(room) ?? []).filter((f) => !f.isGlow && !f.special && f.kind !== 'exit' && f.circuit !== 'none');
  }

  private facingYaw(def: LightFixtureDef, room: RoomDef | undefined): number {
    if (def.rotY !== undefined) return def.rotY;
    if (!room) return 0;
    const b = room.bounds;
    const dx0 = def.pos.x - b.x0;
    const dx1 = b.x1 - def.pos.x;
    const dz0 = def.pos.z - b.z0;
    const dz1 = b.z1 - def.pos.z;
    const m = Math.min(dx0, dx1, dz0, dz1);
    if (m === dz1) return Math.PI; // on the north wall → face south
    if (m === dz0) return 0;
    if (m === dx1) return -Math.PI / 2; // on the east wall → face west
    return Math.PI / 2;
  }

  private makeFixture(def: LightFixtureDef, visual: FixtureVisual | null, color: THREE.Color, cd: number, range: number, isGlow: boolean): Fixture {
    const spec = KIND[def.kind];
    const pos = visual ? visual.lightPos.clone() : new THREE.Vector3(def.pos.x, def.pos.y, def.pos.z);
    return {
      id: def.id,
      kind: def.kind,
      room: def.room,
      zone: def.zone,
      circuit: def.circuit,
      flickerProne: def.flickerProne === true,
      special: false,
      isGlow,
      glowOn: true,
      pos,
      anchor: new THREE.Vector3(def.pos.x, def.pos.y, def.pos.z),
      color: color.clone(),
      liveColor: color.clone(),
      cd,
      range,
      strikeKind: spec.strike,
      glowTau: spec.glowTau,
      seed: hashString(def.id),
      mode: 'on',
      modeT: 0,
      modeSeconds: 0,
      modeFrom: 1,
      lastEnvelope: 1,
      tempRestore: null,
      tempLeft: 0,
      tempIntensity: 1,
      flick: new BallastFlicker(this.rng.fork(`fx:${def.id}`)),
      flutter: new ValueNoise1D(hashString(def.id) % 100000),
      strike: null,
      strikeDelay: 0,
      powered: false,
      gate: 0,
      warm: 0,
      level: 0,
      glow: 0,
      visual,
      light: null,
      score: 0,
      keyScore: 0,
      dieAt: 0,
      camDist2: 0,
    };
  }

  private register(f: Fixture): void {
    this.fixtures.push(f);
    this.byId.set(f.id, f);
    this.roomList(f.room).push(f);
  }

  private addFixture(def: LightFixtureDef): void {
    const room = this.rooms.get(def.room);
    const spec = KIND[def.kind];
    const color = new THREE.Color(def.color ?? spec.color);
    let cd = spec.cd * (def.intensity ?? 1);
    let range = spec.range;
    if (def.kind === 'fluorescent') {
      if (def.room === 'corridor') {
        range = 8;
      } else {
        cd *= 1.1;
        range = 6;
      }
      if (room && room.ceiling > 3) cd *= 1.2;
    }
    const yaw = this.facingYaw(def, room);
    const ceilingY = room?.ceiling ?? def.pos.y + 0.3;
    let visual: FixtureVisual | null = null;
    try {
      visual = buildFixtureVisual(def, yaw, color, ceilingY, this.lensTex, this.batch!);
    } catch (err) {
      console.warn(`[lighting] fixture visual failed for ${def.id}`, err);
    }
    if (visual) this.root.add(visual.group);
    const f = this.makeFixture(def, visual, color, cd, range, def.kind === 'monitor' || def.kind === 'vending');
    this.register(f);
  }

  /** West-wing breaker powers nothing visible except a sick green glow under the closed doors. */
  private addWestWingGlow(): void {
    const door = this.s.layout.doors.find((d) => d.id === 'd_closed_wing');
    if (!door) return;
    const half = door.width / 2;
    const x = door.pos.x + this.s.layout.wallThickness / 2 + 0.006;
    const color = new THREE.Color(0xc4ffd4);
    const visual = buildDoorSeamVisual({ x, z0: door.pos.z - half, z1: door.pos.z + half, color }, this.batch!);
    this.root.add(visual.group);
    const def: LightFixtureDef = {
      id: 'ww_glow', room: 'service_n', pos: { x: x + 0.2, y: 0.25, z: door.pos.z }, kind: 'strip', circuit: 'emergency', zone: 'west_wing', flickerProne: true,
    };
    const f = this.makeFixture(def, visual, color, 1.8, 3.4, false);
    f.special = true;
    this.register(f);
  }

  private resetForNewGame(): void {
    this.rng = this.s.rng.fork('lighting');
    for (const f of this.fixtures) {
      f.mode = 'on';
      f.modeT = 0;
      f.modeSeconds = 0;
      f.modeFrom = 1;
      f.lastEnvelope = 1;
      f.tempRestore = null;
      f.tempLeft = 0;
      f.strike = null;
      f.strikeDelay = 0;
      f.powered = false;
      f.gate = 0;
      f.level = 0;
      f.glow = 0;
      f.warm = 0;
      f.glowOn = true;
      f.flick = new BallastFlicker(this.rng.fork(`fx:${f.id}`));
    }
    this.zones = { ...this.s.store.get().zones };
    this.seq = null;
    this.timers.length = 0;
    this.brown.clear();
    this.sag = null;
    this.dawn = 0;
    this.globalMult = 1;
    this.flashWanted = false;
    this.unstableT = 0;
    this.unstableNext = 0;
    this.unstableCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Power logic
  // ---------------------------------------------------------------------------

  private zoneOn(f: Fixture): boolean {
    return f.zone === undefined ? true : this.zones[f.zone];
  }

  private zoneHasEmergencyFixtures(z: ZoneId): boolean {
    return this.fixtures.some((f) => f.zone === z && (f.circuit === 'emergency' || f.circuit === 'always'));
  }

  /** Would this fixture have power under a given state (ignoring transitions)? */
  private poweredUnder(state: PowerState, f: Fixture): boolean {
    switch (f.circuit) {
      case 'none':
        return false;
      case 'always':
        return state !== 'blackout' || f.kind === 'exit';
      case 'main':
        return (state === 'normal' || state === 'unstable') && this.zoneOn(f);
      case 'emergency':
        if (state === 'blackout') return false;
        if (state === 'generator') return this.zoneOn(f);
        // normal power: emergency heads sit dark on charge; other emergency-circuit fixtures run
        return f.kind !== 'emergency' && this.zoneOn(f);
      default:
        return false;
    }
  }

  private wantOn(f: Fixture): boolean {
    if (f.isGlow && !f.glowOn) return false;
    const seq = this.seq;
    if (!seq) return this.poweredUnder(this._power, f);
    if (f.kind === 'exit' && f.circuit === 'always') return true;
    if (seq.kind === 'blackout') return seq.t < f.dieAt && this.poweredUnder(seq.from, f);
    if (!this.poweredUnder('generator', f)) return false;
    const at = seq.snapAt.get(f.zone ?? 'none') ?? seq.snapAt.get('none') ?? 2.0;
    return seq.t >= at;
  }

  private advanceSequence(dt: number): void {
    const seq = this.seq;
    if (!seq) return;
    seq.t += dt;
    if (seq.kind === 'generator') {
      for (const [z, at] of seq.snapAt) {
        if (seq.t >= at && !seq.snapped.has(z)) {
          seq.snapped.add(z);
          if (z !== 'none') this.onZoneSnap(z);
        }
      }
    }
    if (seq.t >= seq.end) this.seq = null;
  }

  private onZoneSnap(zone: ZoneId): void {
    const panel = this.s.layout.points.electrical_panel ?? { x: 4, y: 1.4, z: 10 };
    this.s.audio.play('breaker_thunk', { pos: { x: panel.x, y: panel.y, z: panel.z }, volume: 0.45 });
    let nearest: Fixture | null = null;
    for (const f of this.fixtures) {
      if (f.zone !== zone || f.kind !== 'emergency') continue;
      if (!nearest || f.camDist2 < nearest.camDist2) nearest = f;
    }
    if (nearest) this.sfx('light_on', nearest, 0.35);
  }

  /** Snap every fixture to its steady state (new game, debug jumps). */
  private settleImmediate(): void {
    for (const f of this.fixtures) {
      const powered = this.wantOn(f) && f.mode !== 'off';
      f.powered = powered;
      f.strike = null;
      f.strikeDelay = 0;
      f.gate = powered ? 1 : 0;
      f.warm = powered ? 1 : 0;
      f.liveColor.copy(f.color);
      const env = f.mode === 'dim' ? 0.33 : f.mode === 'off' ? 0 : 1;
      f.lastEnvelope = env;
      f.level = powered ? env : 0;
      f.glow = f.level;
      this.applyVisual(f);
    }
  }

  // ---------------------------------------------------------------------------
  // Unstable power (brown-outs, random flicker)
  // ---------------------------------------------------------------------------

  private updateUnstable(dt: number): void {
    this.unstableT += dt;
    if (this.unstableT < this.unstableNext) return;
    const k = smoothstep01(this.unstableT / 30); // escalates across the ~30 real seconds before the outage
    this.unstableNext = this.unstableT + (5 - 3.4 * k) * this.rng.range(0.6, 1.4);
    this.unstableCount++;
    const lit = this.fixtures.filter((f) => f.powered && f.level > 0.3 && f.mode === 'on' && !f.isGlow && (f.kind === 'fluorescent' || f.kind === 'strip'));
    if (lit.length === 0) return;
    const prone = lit.filter((f) => f.flickerProne);
    const r = this.rng.next();
    if (r < 0.45 || this.unstableCount <= 3) {
      const src = this.unstableCount <= 4 && prone.length > 0 ? prone : lit;
      const f = this.rng.pick(src);
      this.tempFlicker(f, this.rng.range(1, 3), this.rng.range(0.6, 1) * (0.5 + 0.5 * k), true);
    } else if (r < 0.75) {
      const rooms = Array.from(new Set(lit.map((f) => f.room)));
      const room = this.rng.pick(rooms);
      this.brown.set(room, { t: 0, T: this.rng.range(0.4, 0.9), depth: this.reduced ? 0.2 : 0.35 + 0.15 * k });
    } else {
      this.sag = { t: 0, T: this.rng.range(0.9, 1.6), depth: this.reduced ? 0.08 : 0.16 + 0.08 * k };
      let nearest: Fixture | null = null;
      for (const f of lit) if (!nearest || f.camDist2 < nearest.camDist2) nearest = f;
      if (nearest) this.sfx('light_buzz', nearest, 0.25);
    }
  }

  private tempFlicker(f: Fixture, seconds: number, intensity: number, withSound: boolean): void {
    if (f.tempRestore === null) f.tempRestore = f.mode;
    f.tempLeft = Math.max(f.tempLeft, seconds);
    f.tempIntensity = clamp01(intensity);
    if (f.mode !== 'flicker') {
      f.modeFrom = f.lastEnvelope;
      f.mode = 'flicker';
      f.modeT = 0;
      f.flick.reset();
      if (withSound) this.sfx('light_buzz', f, 0.3);
    }
  }

  private updatePulses(dt: number): void {
    for (const [room, p] of this.brown) {
      p.t += dt;
      if (p.t >= p.T) this.brown.delete(room);
    }
    if (this.sag) {
      this.sag.t += dt;
      if (this.sag.t >= this.sag.T) this.sag = null;
    }
  }

  private pulseMul(room: RoomId): number {
    let m = 1;
    const b = this.brown.get(room);
    if (b) m *= 1 - b.depth * bump(b.t / b.T);
    if (this.sag) m *= 1 - this.sag.depth * bump(this.sag.t / this.sag.T);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Per-fixture simulation
  // ---------------------------------------------------------------------------

  private envelope(f: Fixture, dt: number): number {
    const t = this.time;
    switch (f.mode) {
      case 'on':
        return 1 - 0.015 * f.flutter.at(t * 6 + 3);
      case 'dim': {
        const u = f.modeSeconds > 0 ? smoothstep01(f.modeT / f.modeSeconds) : 1;
        return (f.modeFrom + (0.33 - f.modeFrom) * u) * (1 - 0.02 * f.flutter.at(t * 7));
      }
      case 'flicker': {
        const sample = f.flick.step(dt, f.tempRestore !== null ? f.tempIntensity : 1, this.reduced);
        if (sample.dropped) this.flickerTick(f);
        return sample.level;
      }
      case 'dying': {
        const u = f.modeSeconds > 0 ? f.modeT / f.modeSeconds : 1;
        if (u >= 1) {
          f.mode = 'off';
          f.modeT = 0;
          this.sfx('light_pop', f, 0.5);
          return 0;
        }
        let l = dyingLevel(u, f.flutter.at(t * 5), f.flutter.at(t * 14 + 50));
        if (this.reduced) l = Math.max(l, 0.35 * (1 - u));
        return l;
      }
      case 'off':
      default:
        return 0;
    }
  }

  private updateFixture(f: Fixture, dt: number): void {
    const powered = this.wantOn(f) && f.mode !== 'off';
    if (powered !== f.powered) {
      f.powered = powered;
      if (powered) {
        f.strike = new StrikeEnvelope(this.rng, f.strikeKind, f.strikeDelay);
        f.strikeDelay = 0;
        if (f.strikeKind === 'fluorescent' && f.camDist2 < 200 && this.seq === null && this.strikeSfxCooldown <= 0) {
          this.sfx('light_on', f, 0.18);
          this.strikeSfxCooldown = 0.09;
        }
      } else {
        f.strike = null;
      }
    }

    if (f.tempRestore !== null) {
      f.tempLeft -= dt;
      if (f.tempLeft <= 0) {
        f.mode = f.tempRestore;
        f.tempRestore = null;
        f.modeT = 0;
        f.modeFrom = f.lastEnvelope;
      }
    }
    f.modeT += dt;
    const env = this.envelope(f, dt);
    f.lastEnvelope = env;

    // ballast power gate: fluorescents die almost instantly, the phosphor glow follows later
    f.gate = approach(f.gate, powered ? 1 : 0, dt, powered ? 0.02 : 0.045);

    let strike = 1;
    if (f.strike) {
      const r = f.strike.step(dt);
      strike = r.level;
      if (f.kind === 'sodium') f.warm = r.progress;
      if (r.done) f.strike = null;
    } else if (powered && f.kind === 'sodium') {
      f.warm = 1;
    }
    if (!powered) f.warm = 0;
    if (f.kind === 'sodium') f.liveColor.copy(SODIUM_EMBER).lerp(f.color, smoothstep01(f.warm));

    let level = env * f.gate * strike * this.pulseMul(f.room);
    const seq = this.seq;
    if (seq && seq.kind === 'blackout' && seq.t < 0.3 && powered && f.kind !== 'exit') {
      level *= blackoutStutter(seq.t) * (0.92 + 0.08 * hash01(f.seed + Math.floor(seq.t * 60)));
    }
    if (f.kind === 'sodium') level *= 1 - 0.85 * this.dawn; // photocell
    f.level = Math.max(0, Math.min(1.4, level));

    const tau = f.glowTau * (seq && seq.kind === 'blackout' ? 3.5 : 1);
    f.glow = f.level >= f.glow ? f.level : approach(f.glow, f.level, dt, tau);
    this.applyVisual(f);
  }

  private applyVisual(f: Fixture): void {
    const v = f.visual;
    if (!v) return;
    // EMISSIVE_GAIN keeps lit lenses/tubes/signs well above lit-wall luminance so bloom can isolate them
    const e = v.emissiveBase * EMISSIVE_GAIN * Math.min(1.25, f.glow) * this.globalMult;
    for (const m of v.emissive) {
      if (Math.abs(m.emissiveIntensity - e) > 0.002) m.emissiveIntensity = e;
      if (f.kind === 'sodium') m.emissive.copy(f.liveColor);
    }
    if (v.halo.length > 0) {
      const h = v.haloBase * Math.min(1, f.glow) * this.globalMult;
      for (const m of v.halo) {
        if (Math.abs(m.opacity - h) > 0.002) m.opacity = h;
        if (f.kind === 'sodium') m.color.copy(f.liveColor);
      }
      const vis = h > 0.003;
      for (const mesh of v.haloMeshes) if (mesh.visible !== vis) mesh.visible = vis;
    }
  }

  private flickerTick(f: Fixture): void {
    if (f.camDist2 < 196 && this.sfxCooldown <= 0) {
      this.sfx('light_flicker', f, 0.22);
      this.sfxCooldown = 0.12;
    }
  }

  private sfx(name: 'light_flicker' | 'light_buzz' | 'light_pop' | 'light_on', f: Fixture, volume: number): void {
    this.s.audio.play(name, { pos: { x: f.anchor.x, y: f.anchor.y, z: f.anchor.z }, volume });
  }

  private tickTimers(dt: number): void {
    if (this.timers.length === 0) return;
    const due: Timer[] = [];
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        due.push(tm);
        this.timers.splice(i, 1);
      }
    }
    for (const tm of due) tm.fn();
  }

  // ---------------------------------------------------------------------------
  // Camera, pool, key, flashlight
  // ---------------------------------------------------------------------------

  private updateCamera(): void {
    const cam = this.s.three.camera;
    cam.getWorldPosition(this.camPos);
    const room = roomAt({ x: this.camPos.x, z: this.camPos.z }, this.s.layout.rooms);
    if (room) this.camRoom = room; // keep the last room while crossing a doorway
  }

  private assignPool(dt: number): void {
    const cam = this.camPos;
    const camRoom = this.camRoom;
    const cands: Fixture[] = [];
    for (const f of this.fixtures) {
      const dx = f.pos.x - cam.x;
      const dy = f.pos.y - cam.y;
      const dz = f.pos.z - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      f.camDist2 = d2;
      const active = f.level > 0.003 || (f.powered && f.strike !== null);
      if (!active || d2 > 900) {
        f.score = 0;
        continue;
      }
      const w = camRoom === null ? 0.7 : f.room === camRoom ? 1 : this.isAdjacent(f.room, camRoom) ? 0.6 : 0.28;
      f.score = (f.cd * Math.max(f.level, 0.25) * w) / (d2 + 1.5);
      cands.push(f);
    }
    cands.sort((a, b) => b.score - a.score);
    const desired = cands.length > POOL_SIZE ? cands.slice(0, POOL_SIZE) : cands;
    const desiredSet = new Set(desired);
    const weakest = desired.length === POOL_SIZE ? desired[desired.length - 1].score : 0;

    // release lights whose fixture fell out of the set (with hysteresis against churn)
    for (const L of this.pool) {
      const t = L.target;
      if (t && !desiredSet.has(t) && (t.score === 0 || t.score < weakest * 0.8)) {
        t.light = null;
        L.target = null;
      }
    }
    // hand free lights to the strongest unlit fixtures
    for (const f of desired) {
      if (f.light) continue;
      const L = this.pool.find((p) => p.target === null);
      if (!L) break;
      L.target = f;
      f.light = L;
    }

    for (const L of this.pool) {
      if (L.target !== L.fixture) {
        L.gate = approach(L.gate, 0, dt, 0.05);
        if (L.gate <= 0.02) {
          L.gate = 0;
          L.fixture = L.target;
          if (L.fixture) {
            L.light.position.copy(L.fixture.pos);
            L.light.distance = L.fixture.range;
          } else {
            L.light.position.set(0, -50, 0);
          }
        }
      } else if (L.fixture) {
        L.gate = approach(L.gate, 1, dt, 0.12);
      } else {
        L.gate = 0;
      }
      const f = L.fixture;
      if (f) {
        L.light.color.copy(f.liveColor);
        L.light.intensity = L.gate * f.level * f.cd * this.globalMult * this.keyShare(f);
      } else {
        L.light.intensity = 0;
      }
    }
  }

  private keyShare(f: Fixture): number {
    return this.keyFixture === f ? 1 - 0.45 * this.keyGate : 1;
  }

  private updateKey(dt: number): void {
    const cam = this.camPos;
    const camRoom = this.camRoom;
    let best: Fixture | null = null;
    let bestScore = 0;
    let curScore = 0;
    const cur = this.keyTarget;
    for (const f of this.fixtures) {
      if (!f.visual || !f.visual.keyEligible) continue;
      if (f.level < 0.2 && !(f.powered && f.strike !== null)) continue;
      const w = camRoom === null ? 0.7 : f.room === camRoom ? 1 : this.isAdjacent(f.room, camRoom) ? 0.35 : 0;
      if (w === 0) continue;
      const dx = f.pos.x - cam.x;
      const dz = f.pos.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 64) continue;
      const sc = (f.cd * Math.max(f.level, 0.3) * w) / (d2 + 0.6);
      f.keyScore = sc;
      if (f === cur) curScore = sc;
      if (sc > bestScore) {
        bestScore = sc;
        best = f;
      }
    }
    if (best !== cur) {
      if (cur === null || curScore === 0 || best === null) {
        this.keyTarget = best;
        this.keySwitchTimer = 0;
      } else if (bestScore > curScore * 1.35) {
        this.keySwitchTimer += dt;
        if (this.keySwitchTimer > 0.2) {
          this.keyTarget = best;
          this.keySwitchTimer = 0;
        }
      } else {
        this.keySwitchTimer = 0;
      }
    } else {
      this.keySwitchTimer = 0;
    }

    if (this.keyTarget !== this.keyFixture) {
      this.keyGate = approach(this.keyGate, 0, dt, 0.07);
      if (this.keyGate <= 0.02) {
        this.keyGate = 0;
        this.keyFixture = this.keyTarget;
        if (this.keyFixture) this.placeKey(this.keyFixture);
      }
    } else if (this.keyFixture) {
      this.keyGate = approach(this.keyGate, 1, dt, 0.15);
    } else {
      this.keyGate = 0;
    }

    const f = this.keyFixture;
    const key = this.key;
    if (f) {
      key.color.copy(f.liveColor);
      key.intensity = this.keyGate * f.level * f.cd * 0.65 * this.globalMult;
    } else {
      key.intensity = 0;
    }
    const on = key.intensity > 0.01;
    if (key.shadow.autoUpdate !== on) {
      key.shadow.autoUpdate = on;
      if (on) key.shadow.needsUpdate = true;
    }
  }

  private placeKey(f: Fixture): void {
    const v = f.visual;
    this.key.position.copy(f.pos);
    this.key.position.y -= 0.03;
    if (v && v.facing) {
      this.key.target.position.set(f.pos.x + v.facing.x * 1.7, 0, f.pos.z + v.facing.z * 1.7);
    } else {
      this.key.target.position.set(f.pos.x, 0, f.pos.z);
    }
    this.key.angle = v ? v.keyAngle : 1.0;
    this.key.distance = f.range * 1.3;
  }

  private updateFlashlight(dt: number): void {
    const st = this.s.store.get();
    const effective = this.flashWanted && st.activeView !== 'cctv' && !this.s.cinematic.playing;
    this.flashGate = approach(this.flashGate, effective ? 1 : 0, dt, 0.025);
    if (this.flashGate < 0.01 && !effective) {
      if (this.flash.intensity !== 0) {
        this.flash.intensity = 0;
        this.flash.shadow.autoUpdate = false;
      }
      this.flashHasPrev = false;
      return;
    }

    const cam = this.s.characters.camera;
    cam.getWorldPosition(V_A);
    cam.getWorldQuaternion(Q_A);
    if (this.flashHasPrev && dt > 0) {
      const sp = V_A.distanceTo(this.flashPrev) / dt;
      this.flashSpeed = approach(this.flashSpeed, Math.min(3, sp), dt, 0.25);
    }
    this.flashPrev.copy(V_A);
    this.flashHasPrev = true;

    // held low and to the right of the eye
    V_B.set(0.17, -0.13, 0.04).applyQuaternion(Q_A);
    this.flash.position.copy(V_A).add(V_B);
    const fwd = V_B.set(0, 0, -1).applyQuaternion(Q_A);
    const right = V_C.set(1, 0, 0).applyQuaternion(Q_A);
    const up = V_D.set(0, 1, 0).applyQuaternion(Q_A);
    const motion = this.motion ? 1 : 0.3;
    const amp = (0.012 + 0.07 * smoothstep01(this.flashSpeed / 1.6)) * motion;
    const jx = (this.flashNoiseA.at(this.time * 2.1) - 0.5) * 2;
    const jy = (this.flashNoiseB.at(this.time * 1.6) - 0.5) * 2;
    const breathe = Math.sin(this.time * 2 * Math.PI * 0.27) * 0.01 * motion;
    this.flash.target.position
      .copy(V_A)
      .addScaledVector(fwd, 6)
      .addScaledVector(right, jx * amp * 6 + 0.1)
      .addScaledVector(up, (jy * amp + breathe) * 6 - 0.2);
    this.flash.intensity = this.flashGate * 30 * this.globalMult;
    if (!this.flash.shadow.autoUpdate) {
      this.flash.shadow.autoUpdate = true;
      this.flash.shadow.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Environment (fog / background / hemisphere / IBL / dawn)
  // ---------------------------------------------------------------------------

  private targetLook(out: EnvState): void {
    // the generator's two seconds of darkness keep the blackout look until the first zone snaps on
    const dark = this.seq !== null && this.seq.kind === 'generator' && this.seq.t < 2.0;
    const base = dark ? LOOKS.blackout : LOOKS[this._power];
    const d = this.dawn;
    out.fog.copy(base.fog).lerp(DAWN.fog, d);
    out.bg.copy(base.bg).lerp(DAWN.bg, d);
    out.sky.copy(base.sky).lerp(DAWN.sky, d);
    out.ground.copy(base.ground).lerp(DAWN.ground, d);
    out.density = base.density + (DAWN.density - base.density) * d;
    out.hemi = base.hemi + (DAWN.hemi - base.hemi) * d;
    out.env = base.env + (DAWN.env - base.env) * d;
  }

  private readonly tgt: EnvState = {
    fog: new THREE.Color(), density: 0.018, bg: new THREE.Color(), sky: new THREE.Color(), ground: new THREE.Color(), hemi: 0.8, env: 0.2,
  };

  private updateEnvironment(dt: number): void {
    this.targetLook(this.tgt);
    const tau = this._power === 'blackout' ? 0.45 : 0.7;
    const k = 1 - Math.exp(-dt / tau);
    const c = this.cur;
    c.fog.lerp(this.tgt.fog, k);
    c.bg.lerp(this.tgt.bg, k);
    c.sky.lerp(this.tgt.sky, k);
    c.ground.lerp(this.tgt.ground, k);
    c.density += (this.tgt.density - c.density) * k;
    c.hemi += (this.tgt.hemi - c.hemi) * k;
    c.env += (this.tgt.env - c.env) * k;
    this.applyEnvironment();
  }

  private snapEnvironment(): void {
    this.targetLook(this.tgt);
    const c = this.cur;
    c.fog.copy(this.tgt.fog);
    c.bg.copy(this.tgt.bg);
    c.sky.copy(this.tgt.sky);
    c.ground.copy(this.tgt.ground);
    c.density = this.tgt.density;
    c.hemi = this.tgt.hemi;
    c.env = this.tgt.env;
    this.applyEnvironment();
  }

  private applyEnvironment(): void {
    const c = this.cur;
    const g = this.globalMult;
    this.fog.color.copy(c.fog);
    this.fog.density = c.density;
    this.bg.copy(c.bg).multiplyScalar(Math.min(1, g));
    this.hemi.color.copy(c.sky);
    this.hemi.groundColor.copy(c.ground);
    this.hemi.intensity = c.hemi * g;
    if (this.scene.environment) this.scene.environmentIntensity = c.env * g;
    this.sun.intensity = this.dawn * 2.6 * g;
    if (this.ledMaterial) {
      const charging = this._power === 'normal' || this._power === 'unstable';
      const led = (charging ? 1.6 : 0) * g;
      if (Math.abs(this.ledMaterial.emissiveIntensity - led) > 0.002) this.ledMaterial.emissiveIntensity = led;
    }
  }
}
