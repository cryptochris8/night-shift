/**
 * Characters: the first-person player controller, NPC bodies for the three main characters,
 * transient figures, doors as seen from a walking body, visibility tests and the audio listener.
 * Implements ICharacterSystem (core/contracts.ts).
 */
import * as THREE from 'three';
import type {
  FigureHandle,
  FigureOptions,
  ICharacterSystem,
  Outfit,
  Services,
  SfxName,
  SfxOptions,
} from '../core/contracts';
import type { RNG } from '../core/rng';
import { CHARACTER_IDS, type CharacterId, type CharacterState, type DoorDef, type Rect, type RoomId, type ScheduleEntry, type Vec2, type Vec3, type ViewId } from '../core/types';
import { LAYOUT, doorPassage, roomAt as layoutRoomAt } from '../world/layout';
import { Figure } from './Figure';
import { warmHeadShapes } from './Figure.head';
import { NavGraph } from './nav';
import { expandRect, pointInRect, rectsOverlap, type CollisionContext, type PassageDef } from './collision';
import { canSeeFrom, type VisionWorld } from './CharacterSystem.vision';
import { TransientFigure } from './CharacterSystem.figures';
import { PlayerController } from './CharacterSystem.player';
import { cancelWalk, currentScheduleIndex, makeBody, planPath, roomPoint, updateNpc } from './CharacterSystem.npc';
import {
  EYE_HEIGHT,
  NPC_SPEED,
  REACH,
  animForAction,
  type CharBody,
  type FigureCtor,
  type FigureLike,
  type Host,
} from './CharacterSystem.types';

const FigureClass = Figure as unknown as FigureCtor;

const OUTFITS: Record<CharacterId, Outfit> = { john: 'patient', susie: 'scrubs', paul: 'workwear' };
const BODY_SEEDS: Record<CharacterId, number> = { john: 1103, susie: 2311, paul: 3719 };
const DEFAULT_ACTION: Record<CharacterId, string> = { john: 'sit', susie: 'stand', paul: 'mop' };

const DOOR_AUTO_CLOSE = 2.0;
const DENY_COOLDOWN = 1.5;
const READER_RESET = 1.3;
const OBSTACLE_RANGE = 2.6;

interface AutoDoor {
  by: CharacterId;
  requestedAt: number;
  lastOccupied: number;
}

export class CharacterSystem implements ICharacterSystem, Host {
  readonly camera: THREE.PerspectiveCamera;
  readonly reach = REACH;
  s!: Services;
  now = 0;
  motionScale = 1;

  private _active: CharacterId | null = null;
  private bodies!: Record<CharacterId, CharBody>;
  private readonly figures = new Map<string, TransientFigure>();
  private figureCounter = 0;
  private nav!: NavGraph;
  private rng!: RNG;
  private player!: PlayerController;
  private viewFilter: ViewId = 'john';
  private moveEnabled = true;
  private lookEnabled = true;
  private readonly autoDoors = new Map<string, AutoDoor>();
  private readonly denyAt = new Map<string, number>();
  private readonly readerReset = new Map<string, number>();
  private readonly readersByDoor = new Map<string, string[]>();
  private readonly passageRects = new Map<string, Rect>();
  private passageCache: PassageDef[] = [];
  private puddles: Rect[] = [];
  private obstaclesCache: Rect[] = [];
  private obstaclesStamp = -1;
  private visionWorld!: VisionWorld;
  private readonly listenerPos = new THREE.Vector3();
  private listenerYaw = 0;
  private readonly unsubs: (() => void)[] = [];
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  constructor() {
    const aspect = typeof window !== 'undefined' ? window.innerWidth / Math.max(1, window.innerHeight) : 16 / 9;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    const sp = LAYOUT.spawn.john;
    this.camera.position.set(sp.pos.x, sp.pos.y + EYE_HEIGHT, sp.pos.z);
    this.camera.rotation.set(0, sp.yaw, 0);
    this.camera.name = 'fp_camera';
  }

  get active(): CharacterId | null {
    return this._active;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.rng = services.rng.fork('characters');
    this.nav = new NavGraph(services.layout.waypoints);
    this.player = new PlayerController(this);
    this.visionWorld = {
      rooms: services.layout.rooms,
      doors: services.layout.doors,
      isDoorOpen: (id) => this.isDoorOpen(id),
    };

    for (const d of services.layout.doors) this.passageRects.set(d.id, doorPassage(d, services.layout.wallThickness));
    this.passageCache = services.layout.doors.map((d) => ({
      rect: this.passageRects.get(d.id)!,
      passable: false,
      along: d.axis === 'x' ? 'z' : 'x',
    }));

    for (const p of services.layout.props) {
      if (p.type === 'badge_reader') {
        const door = typeof p.params?.door === 'string' ? p.params.door : null;
        if (door) {
          const list = this.readersByDoor.get(door) ?? [];
          list.push(p.id);
          this.readersByDoor.set(door, list);
        }
      } else if (p.type === 'puddle') {
        const w = typeof p.params?.w === 'number' ? p.params.w : 1;
        const d = typeof p.params?.d === 'number' ? p.params.d : 1;
        const c = Math.abs(Math.cos(p.rotY));
        const sn = Math.abs(Math.sin(p.rotY));
        const hx = (c * w + sn * d) / 2;
        const hz = (sn * w + c * d) / 2;
        this.puddles.push({ x0: p.pos.x - hx, x1: p.pos.x + hx, z0: p.pos.z - hz, z1: p.pos.z + hz });
      }
    }

    // sample every face once while loading, so figures spawned mid-game never stall a frame
    warmHeadShapes();
    this.bodies = {
      john: this.makeMainBody('john'),
      susie: this.makeMainBody('susie'),
      paul: this.makeMainBody('paul'),
    };
    this.applyVisibility();

    this.unsubs.push(
      services.bus.on('game:new', () => this.resetForNewGame()),
    );
  }

  private makeMainBody(id: CharacterId): CharBody {
    const sp = this.s.layout.spawn[id];
    const body = makeBody(id, sp.pos, sp.yaw, sp.room);
    body.schedule = this.defaultSchedule(id);
    body.action = DEFAULT_ACTION[id];
    body.anim = animForAction(body.action);
    const fig: FigureLike = new FigureClass({ outfit: OUTFITS[id], seed: BODY_SEEDS[id] });
    fig.object.name = `character:${id}`;
    fig.object.userData.room = sp.room;
    fig.object.position.set(sp.pos.x, sp.pos.y, sp.pos.z);
    fig.setYaw(sp.yaw);
    fig.setAnim(body.anim);
    this.s.three.scene.add(fig.object);
    body.figure = fig;
    return body;
  }

  private defaultSchedule(id: CharacterId): ScheduleEntry[] {
    const sp = this.s.layout.spawn[id];
    return [{ time: 0, room: sp.room, pos: { x: sp.pos.x, z: sp.pos.z }, yaw: sp.yaw, action: DEFAULT_ACTION[id] }];
  }

  private resetForNewGame(): void {
    this.rng = this.s.rng.fork('characters');
    this.autoDoors.clear();
    this.denyAt.clear();
    this.readerReset.clear();
    for (const f of this.figures.values()) f.dispose();
    this.figures.clear();
    for (const id of CHARACTER_IDS) {
      const body = this.bodies[id];
      cancelWalk(body, false);
      const sp = this.s.layout.spawn[id];
      body.pos = { ...sp.pos };
      body.yaw = sp.yaw;
      body.pitch = 0;
      body.room = sp.room;
      body.schedule = this.defaultSchedule(id);
      body.scheduleIndex = -1;
      body.scheduleYaw = null;
      body.action = DEFAULT_ACTION[id];
      body.walkAction = null;
      body.arrived = true;
      body.anim = animForAction(body.action);
      body.figure?.setAnim(body.anim);
      body.figure?.object.position.set(sp.pos.x, sp.pos.y, sp.pos.z);
      body.figure?.setYaw(sp.yaw);
    }
    this.applyVisibility();
  }

  update(dt: number, _gdt: number): void {
    if (!this.s) return;
    this.now += dt;
    const s = this.s;
    const st = s.store.get();
    const cinematic = s.cinematic.playing;
    const simulate = !st.paused && st.screen !== 'paused';
    const time = s.clock.time;

    this.updateDoors();

    // --- player ----------------------------------------------------------------
    if (this._active) {
      const body = this.bodies[this._active];
      const free = st.screen === 'playing' && !st.paused && !st.inputLocked && !s.ui.modalOpen && !cinematic && s.input.enabled;
      this.player.update(body, dt, { canMove: free && this.moveEnabled, canLook: free && this.lookEnabled });
      const fig = body.figure;
      if (fig) {
        fig.object.position.set(body.pos.x, body.pos.y, body.pos.z);
        fig.setYaw(body.yaw);
        if (cinematic) fig.update(dt, 0);
      }
    }

    // --- NPC bodies ----------------------------------------------------------------
    if (simulate) {
      for (const id of CHARACTER_IDS) {
        if (id === this._active) continue;
        updateNpc(this.bodies[id], dt, this, this.nav, time);
      }
    }

    // --- listener pose (CCTV sets its own while active) ---------------------------------
    this.updateListener(cinematic);

    // --- transient figures ----------------------------------------------------------
    if (simulate && this.figures.size) {
      const viewerPos = st.screen === 'title' ? null : this.viewCamera().getWorldPosition(this.tmpV);
      const frame = {
        dt,
        view: this.viewFilter,
        viewerPos,
        cinematic,
        canSee: (p: THREE.Vector3) => this.canSee(p),
      };
      for (const [id, f] of this.figures) {
        f.update(frame);
        if (f.disposed) this.figures.delete(id);
      }
    }

    // --- store sync (emits character:entered on room change) ---------------------------
    for (const id of CHARACTER_IDS) {
      const b = this.bodies[id];
      const room = this.roomAt({ x: b.pos.x, z: b.pos.z });
      if (room) b.room = room;
      if (b.figure) b.figure.object.userData.room = b.room;
      s.store.setChar(id, { position: { x: b.pos.x, y: b.pos.y, z: b.pos.z }, yaw: b.yaw, location: b.room });
    }

    this.applyVisibility();
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    for (const f of this.figures.values()) f.dispose();
    this.figures.clear();
    if (this.bodies) {
      for (const id of CHARACTER_IDS) {
        const fig = this.bodies[id].figure;
        if (fig) {
          this.s.three.scene.remove(fig.object);
          fig.dispose();
        }
        this.bodies[id].figure = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Possession
  // ---------------------------------------------------------------------------

  possess(id: CharacterId): void {
    if (!this.bodies) return;
    if (this._active === id) return;
    if (this._active) this.releaseBody(this._active);
    this._active = id;
    const body = this.bodies[id];
    cancelWalk(body, false);
    body.arrived = true;
    body.walkAction = null;
    this.player.attach(body);
    this.applyVisibility();
  }

  release(): void {
    if (!this.bodies) return;
    if (this._active) this.releaseBody(this._active);
    this._active = null;
    this.player.detach();
    this.applyVisibility();
  }

  /** The NPC body takes over from wherever the player left it and resumes its schedule from there. */
  private releaseBody(id: CharacterId): void {
    const body = this.bodies[id];
    const fig = body.figure;
    if (fig) {
      fig.object.position.set(body.pos.x, body.pos.y, body.pos.z);
      fig.setYaw(body.yaw);
    }
    body.scheduleIndex = -1;
    body.walkAction = null;
    body.arrived = true;
  }

  getState(id: CharacterId): CharacterState {
    return this.s.store.char(id);
  }

  teleport(id: CharacterId, pos: Vec3, yaw?: number): void {
    if (!this.bodies) return;
    const body = this.bodies[id];
    cancelWalk(body, false);
    body.pos = { x: pos.x, y: pos.y, z: pos.z };
    if (yaw !== undefined) body.yaw = yaw;
    body.arrived = true;
    body.walkAction = null;
    body.room = this.roomAt({ x: pos.x, z: pos.z }) ?? body.room;
    const fig = body.figure;
    if (fig) {
      fig.object.position.set(body.pos.x, body.pos.y, body.pos.z);
      fig.setYaw(body.yaw);
    }
    if (this._active === id) this.player.attach(body);
    this.s.store.setChar(id, { position: { ...body.pos }, yaw: body.yaw, location: body.room });
  }

  // ---------------------------------------------------------------------------
  // NPC control
  // ---------------------------------------------------------------------------

  walkTo(id: CharacterId, target: Vec2 | RoomId, opts?: { speed?: number; action?: string }): Promise<boolean> {
    if (!this.bodies) return Promise.resolve(false);
    const body = this.bodies[id];
    if (this._active === id) return Promise.resolve(false);
    if (body.walkResolve) cancelWalk(body, false);
    const here: Vec2 = { x: body.pos.x, z: body.pos.z };
    const dest: Vec2 = typeof target === 'string' ? roomPoint(target, here, this, this.nav) : { x: target.x, z: target.z };
    body.maxSpeed = opts?.speed ?? NPC_SPEED;
    body.scheduleYaw = null;
    // the schedule entry in force now counts as handled, so it does not fight this walk
    body.scheduleIndex = currentScheduleIndex(body.schedule, this.s.clock.time);
    if (!planPath(body, dest, this, this.nav)) {
      if (opts?.action) body.action = opts.action;
      return Promise.resolve(true);
    }
    body.walkAction = opts?.action ?? null;
    return new Promise<boolean>((resolve) => {
      body.walkResolve = resolve;
    });
  }

  setSchedule(id: CharacterId, entries: ScheduleEntry[]): void {
    if (!this.bodies) return;
    const body = this.bodies[id];
    body.schedule = entries.slice().sort((a, b) => a.time - b.time);
    body.scheduleIndex = -1;
  }

  setAction(id: CharacterId, action: string): void {
    if (!this.bodies) return;
    const body = this.bodies[id];
    body.action = action;
    body.walkAction = null;
    if (!body.path && body.figure) {
      body.anim = animForAction(action);
      body.figure.setAnim(body.anim);
      body.figure.setPhoneGlow(action === 'phone');
    }
  }

  // ---------------------------------------------------------------------------
  // Transient figures
  // ---------------------------------------------------------------------------

  spawnFigure(opts: FigureOptions): FigureHandle {
    const id = opts.id ?? `fig_${++this.figureCounter}`;
    const existing = this.figures.get(id);
    if (existing) {
      existing.dispose();
      this.figures.delete(id);
    }
    const fig: FigureLike = new FigureClass({ outfit: opts.outfit, scale: opts.scale, seed: this.rng.int(1, 0x7fffffff), face: opts.face });
    const tf = new TransientFigure(id, fig, opts, this.s.three.scene, (p) => this.canSee(p));
    this.figures.set(id, tf);
    tf.applyVisibility(this.viewFilter);
    return tf;
  }

  getFigure(id: string): FigureHandle | undefined {
    return this.figures.get(id);
  }

  // ---------------------------------------------------------------------------
  // Toggles / queries
  // ---------------------------------------------------------------------------

  setMovementEnabled(enabled: boolean): void {
    this.moveEnabled = enabled;
  }

  setLookEnabled(enabled: boolean): void {
    this.lookEnabled = enabled;
  }

  setMotionScale(scale: number): void {
    this.motionScale = Math.max(0, scale);
  }

  canSee(target: Vec3, fovDeg = 70, maxDist = 40): boolean {
    if (!this.s) return false;
    const t = target instanceof THREE.Vector3 ? target : this.tmpDir.set(target.x, target.y, target.z);
    return canSeeFrom(this.viewCamera(), t, fovDeg, maxDist, this.visionWorld);
  }

  roomOf(id: CharacterId): RoomId {
    return this.bodies ? this.bodies[id].room : this.s.layout.spawn[id].room;
  }

  canPass(id: CharacterId, doorId: string): boolean {
    const h = this.s.world.getDoor(doorId);
    if (h) {
      if (h.locked) return false;
      return h.access === 'all' || (h.access !== 'none' && h.access.includes(id));
    }
    const def = this.doorDef(doorId);
    if (!def || def.locked) return false;
    return def.access === 'all' || (def.access !== 'none' && def.access.includes(id));
  }

  lookToward(target: Vec3, seconds: number): Promise<void> {
    if (!this._active || !this.bodies) return Promise.resolve();
    return this.player.lookToward(this.bodies[this._active], target, seconds);
  }

  setViewFilter(view: ViewId): void {
    this.viewFilter = view;
    this.applyVisibility();
  }

  // ---------------------------------------------------------------------------
  // Host services for the helpers
  // ---------------------------------------------------------------------------

  collisionContext(id: CharacterId, pos: Vec2, radius: number): CollisionContext {
    const doors = this.s.layout.doors;
    const isPlayer = id === this._active;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      const p = this.passageCache[i];
      // a body may always walk through a door that is physically open; otherwise it needs the right to open it
      p.passable = this.canPass(id, d.id) || (isPlayer && d.kind !== 'open' && this.isDoorOpen(d.id));
    }
    const all = this.obstacles();
    const range = radius + OBSTACLE_RANGE;
    const near: Rect[] = [];
    outer: for (const r of all) {
      if (r.x1 < pos.x - range || r.x0 > pos.x + range || r.z1 < pos.z - range || r.z0 > pos.z + range) continue;
      // doorways stay walkable: a prop (or a closed-door collider) intruding into a passage we may use is ignored
      for (const p of this.passageCache) {
        if (p.passable && rectsOverlap(expandRect(p.rect, radius), r)) continue outer;
      }
      near.push(r);
    }
    // other people are solid too (small footprints so nobody wedges in a doorway)
    for (const other of CHARACTER_IDS) {
      if (other === id) continue;
      const o = this.bodies[other];
      if (Math.abs(o.pos.x - pos.x) > range || Math.abs(o.pos.z - pos.z) > range) continue;
      near.push({ x0: o.pos.x - 0.22, x1: o.pos.x + 0.22, z0: o.pos.z - 0.22, z1: o.pos.z + 0.22 });
    }
    return { rooms: this.s.layout.rooms, passages: this.passageCache, obstacles: near };
  }

  private obstacles(): Rect[] {
    if (this.obstaclesStamp !== this.now) {
      this.obstaclesStamp = this.now;
      try {
        this.obstaclesCache = this.s.world.getObstacles() ?? [];
      } catch {
        this.obstaclesCache = [];
      }
    }
    return this.obstaclesCache;
  }

  isDoorOpen(doorId: string): boolean {
    const h = this.s.world.getDoor(doorId);
    if (h) return h.open;
    return this.doorDef(doorId)?.kind === 'open';
  }

  requestDoorOpen(doorId: string, by: CharacterId): void {
    const def = this.doorDef(doorId);
    if (!def) return;
    const entry = this.autoDoors.get(doorId);
    if (entry) {
      entry.lastOccupied = this.now;
      return;
    }
    if (this.isDoorOpen(doorId)) return;
    this.autoDoors.set(doorId, { by, requestedAt: this.now, lastOccupied: this.now });
    void this.s.world.setDoorOpen(doorId, true);
    if (def.badge) {
      this.s.audio.play('badge_ok', { pos: { x: def.pos.x, y: 1.2, z: def.pos.z }, volume: 0.35 });
      this.flashReaders(doorId, 'ok');
    }
  }

  denyDoor(doorId: string, by: CharacterId): void {
    const def = this.doorDef(doorId);
    if (!def) return;
    const last = this.denyAt.get(doorId);
    if (last !== undefined && this.now - last < DENY_COOLDOWN) return;
    this.denyAt.set(doorId, this.now);
    const pos: Vec3 = { x: def.pos.x, y: 1.1, z: def.pos.z };
    this.s.audio.play('door_locked', { pos, volume: 0.6 });
    if (def.badge) {
      this.s.audio.play('badge_deny', { pos: { ...pos, y: 1.2 }, volume: 0.45 });
      this.flashReaders(doorId, 'deny');
    }
    this.s.bus.emit('door:denied', { id: doorId, by });
  }

  footstep(pos: Vec3, room: RoomId | null, volume: number, own: boolean, running: boolean): void {
    const name = this.surfaceSfx(pos, room);
    const opts: SfxOptions = own ? { nonSpatial: true, volume } : { pos: { x: pos.x, y: pos.y + 0.1, z: pos.z }, volume };
    if (running) opts.rate = 1.08;
    const def = room ? this.s.layout.rooms.find((r) => r.id === room) : undefined;
    if (def?.floor === 'carpet') {
      opts.volume = volume * 0.45;
      opts.rate = (opts.rate ?? 1) * 0.85;
    }
    this.s.audio.play(name, opts);
  }

  roomAt(p: Vec2): RoomId | null {
    const r = this.s.world.roomAt(p);
    return r ?? layoutRoomAt(p, this.s.layout.rooms);
  }

  listenerDistance(p: Vec3): number {
    return Math.hypot(p.x - this.listenerPos.x, p.y - this.listenerPos.y, p.z - this.listenerPos.z);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private doorDef(id: string): DoorDef | undefined {
    return this.s.layout.doors.find((d) => d.id === id);
  }

  private surfaceSfx(pos: Vec3, room: RoomId | null): SfxName {
    const p: Vec2 = { x: pos.x, z: pos.z };
    for (const pd of this.puddles) if (pointInRect(p, pd)) return 'footstep_wet';
    const def = room ? this.s.layout.rooms.find((r) => r.id === room) : undefined;
    if (def && (def.floor === 'concrete' || def.floor === 'asphalt')) return 'footstep_concrete';
    return 'footstep_tile';
  }

  private flashReaders(doorId: string, mode: 'ok' | 'deny'): void {
    const readers = this.readersByDoor.get(doorId);
    if (!readers) return;
    for (const r of readers) {
      this.s.world.setScreen(r, mode);
      this.readerReset.set(r, this.now + READER_RESET);
    }
  }

  /** Auto-close doors we opened once nobody has been near them for a while; reset badge readers. */
  private updateDoors(): void {
    for (const [id, entry] of this.autoDoors) {
      const def = this.doorDef(id);
      if (!def) {
        this.autoDoors.delete(id);
        continue;
      }
      if (!this.isDoorOpen(id)) {
        // still swinging open, or shut again by someone else
        if (this.now - entry.requestedAt > 1.5) this.autoDoors.delete(id);
        continue;
      }
      const passage = this.passageRects.get(id)!;
      let occupied = false;
      for (const cid of CHARACTER_IDS) {
        const b = this.bodies[cid];
        const p: Vec2 = { x: b.pos.x, z: b.pos.z };
        if (pointInRect(p, passage, 0.35) || Math.hypot(def.pos.x - p.x, def.pos.z - p.z) < 1.1) {
          occupied = true;
          break;
        }
      }
      if (occupied) entry.lastOccupied = this.now;
      else if (this.now - entry.lastOccupied > DOOR_AUTO_CLOSE) {
        this.autoDoors.delete(id);
        void this.s.world.setDoorOpen(id, false);
      }
    }
    for (const [reader, at] of this.readerReset) {
      if (at <= this.now) {
        this.readerReset.delete(reader);
        this.s.world.setScreen(reader, 'idle');
      }
    }
  }

  /** The camera the player is actually looking through right now. */
  private viewCamera(): THREE.Camera {
    const s = this.s;
    if (s.cinematic?.playing) return s.cinematic.camera;
    if (s.cctv?.active) {
      const cur = s.cctv.currentCamera;
      const cam = cur ? s.cctv.cameraObject(cur.id) : undefined;
      if (cam) return cam;
    }
    return this.camera;
  }

  private updateListener(cinematic: boolean): void {
    const s = this.s;
    if (s.cctv?.active) return; // the CCTV system positions the listener on its own camera
    if (this._active && !cinematic) {
      this.listenerPos.copy(this.camera.position);
      this.listenerYaw = this.bodies[this._active].yaw;
    } else {
      const cam = cinematic ? s.cinematic.camera : this.camera;
      cam.getWorldPosition(this.listenerPos);
      cam.getWorldDirection(this.tmpDir);
      this.listenerYaw = Math.atan2(-this.tmpDir.x, -this.tmpDir.z);
    }
    s.audio.setListener({ x: this.listenerPos.x, y: this.listenerPos.y, z: this.listenerPos.z }, this.listenerYaw);
  }

  private applyVisibility(): void {
    if (!this.bodies) return;
    const cinematic = this.s.cinematic?.playing ?? false;
    for (const id of CHARACTER_IDS) {
      const fig = this.bodies[id].figure;
      if (fig) fig.setVisible(id !== this._active || cinematic);
    }
    for (const f of this.figures.values()) f.applyVisibility(this.viewFilter);
  }
}
