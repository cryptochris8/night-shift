/**
 * Presentation helpers shared by the anomaly pool: timing, positioned sound, CCTV silhouette
 * injection, "inspect" hot-spots that appear where something happened, wet spots for Paul's mop,
 * and flag / clue shorthands that go through the director's StoryApi once it is bound.
 */
import * as THREE from 'three';
import type { FigureHandle, Interactable, Services, SfxHandle, SfxName, SfxOptions } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { CharacterId, FlagValue, PerceptionState, RoomId, Vec2, Vec3 } from '../core/types';
import { roomAt } from '../world/layout';
import { CLUES } from '../story/content';
import type { StoryApi } from './Director';

let api: StoryApi | null = null;

export function setFxApi(a: StoryApi | null): void {
  api = a;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
}

/** Yaw that makes a figure at `from` face `to` (three.js convention: yaw 0 looks toward -z). */
export function yawToward(from: Vec2 | Vec3, to: Vec2 | Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function dist2d(a: Vec2 | Vec3, b: Vec2 | Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// ---------------------------------------------------------------------------
// Story state shorthands (StoryApi when bound, store otherwise)
// ---------------------------------------------------------------------------

export function isReal(s: Services): boolean {
  const sc = api ? api.scenario : s.store.get().scenario;
  return sc === 'supernatural' || sc === 'mixed';
}

export function scenarioOf(s: Services): string {
  return api ? api.scenario : s.store.get().scenario;
}

export function flagOn(s: Services, key: string): boolean {
  const v = api ? api.flag(key) : s.store.flag(key);
  return v !== undefined && v !== false && v !== 0 && v !== '';
}

export function setFlag(s: Services, key: string, value: FlagValue = true): void {
  if (api) api.setFlag(key, value);
  else s.store.setFlag(key, value);
}

export function addClue(s: Services, id: string): boolean {
  if (api) return api.addClue(id);
  const def = CLUES[id];
  if (!def) return false;
  const st = s.store.get();
  return s.store.addClue({ ...def, time: st.time, source: st.activeView });
}

/** Add deltas to a character's perception (clamped by the store). */
export function nudge(s: Services, who: CharacterId, delta: Partial<PerceptionState>): void {
  const p = s.store.char(who).perception;
  const patch: Partial<PerceptionState> = {};
  for (const k of Object.keys(delta) as (keyof PerceptionState)[]) {
    const d = delta[k];
    if (d !== undefined) patch[k] = p[k] + d;
  }
  s.store.setPerception(who, patch);
  if (s.characters.active === who) {
    const next = s.store.char(who).perception;
    s.postfx.setPerception(next, who);
    s.audio.setPerception(next, who);
  }
}

export function say(s: Services, text: string, seconds = 3, speaker?: string): void {
  if (api) api.say(text, seconds, speaker);
  else s.ui.subtitle(text, seconds, speaker);
}

export function sfx(s: Services, name: SfxName, pos: Vec3 | null, volume = 1, extra: Partial<SfxOptions> = {}): SfxHandle | null {
  const opts: SfxOptions = pos ? { pos, volume, ...extra } : { nonSpatial: true, volume, ...extra };
  return s.audio.play(name, opts);
}

// ---------------------------------------------------------------------------
// Who is where
// ---------------------------------------------------------------------------

export function activeChar(s: Services): CharacterId | null {
  return s.characters.active;
}

export function activeIn(s: Services, rooms: RoomId[]): boolean {
  const c = s.characters.active;
  return c !== null && rooms.includes(s.store.char(c).location);
}

export function charIn(s: Services, who: CharacterId, rooms: RoomId[]): boolean {
  return rooms.includes(s.store.char(who).location);
}

export function charPos(s: Services, who: CharacterId): Vec3 {
  const p = s.store.char(who).position;
  return { x: p.x, y: p.y, z: p.z };
}

export function currentCam(s: Services): string | null {
  if (!s.cctv.active) return null;
  return s.cctv.currentCamera ? s.cctv.currentCamera.id : null;
}

export function onCam(s: Services, id: string): boolean {
  return currentCam(s) === id;
}

const tmpV = new THREE.Vector3();
const tmpD = new THREE.Vector3();

export function cameraPos(s: Services): Vec3 {
  s.characters.camera.getWorldPosition(tmpV);
  return { x: tmpV.x, y: tmpV.y, z: tmpV.z };
}

export function cameraForward(s: Services): Vec2 {
  s.characters.camera.getWorldDirection(tmpD);
  const len = Math.hypot(tmpD.x, tmpD.z) || 1;
  return { x: tmpD.x / len, z: tmpD.z / len };
}

/** A point relative to the first-person camera: metres forward, right and up. */
export function offsetFromViewer(s: Services, forward: number, right: number, up: number): Vec3 {
  const p = cameraPos(s);
  const f = cameraForward(s);
  const rx = -f.z;
  const rz = f.x;
  return { x: p.x + f.x * forward + rx * right, y: p.y + up, z: p.z + f.z * forward + rz * right };
}

// ---------------------------------------------------------------------------
// Sound patterns
// ---------------------------------------------------------------------------

/** A line of footsteps from → to. Timing is lightly irregular so it reads as a person. */
export async function footsteps(
  s: Services,
  from: Vec3,
  to: Vec3,
  count: number,
  interval: number,
  name: SfxName = 'footstep_tile',
  volume = 0.5,
  rng?: RNG,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1);
    const heel = i % 2 === 0 ? 1 : 0.8;
    sfx(s, name, lerp3(from, to, t), volume * heel, { rate: rng ? rng.range(0.94, 1.06) : 1 });
    const jitter = rng ? rng.range(0.85, 1.18) : 1 + ((i * 7) % 3) * 0.06;
    await wait(interval * jitter);
  }
}

/** A sound that travels from one point to another (dragging across a ceiling, a cart rolling). */
export async function movingSound(s: Services, name: SfxName, from: Vec3, to: Vec3, seconds: number, volume: number): Promise<void> {
  const h = sfx(s, name, from, volume);
  if (!h) {
    await wait(seconds);
    return;
  }
  const steps = Math.max(2, Math.round(seconds / 0.1));
  for (let i = 1; i <= steps; i++) {
    await wait(seconds / steps);
    if (!h.playing) return;
    h.setPosition(lerp3(from, to, i / steps));
  }
  h.stop(0.3);
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

/** Run `move` the first moment nobody (player view or CCTV) can see `point`, or at the timeout. */
export function moveWhenUnobserved(s: Services, point: Vec3, timeoutSeconds: number, move: () => void | Promise<void>): void {
  const start = performance.now();
  const room = roomAt({ x: point.x, z: point.z }, s.layout.rooms);
  const tick = (): void => {
    const camRoom = s.cctv.active && s.cctv.currentCamera ? s.cctv.currentCamera.room : null;
    const watchedByCam = camRoom !== null && camRoom === room;
    const watched = watchedByCam || s.characters.canSee(point, 85, 30);
    if (!watched || (performance.now() - start) / 1000 > timeoutSeconds) {
      void move();
      return;
    }
    setTimeout(tick, 400);
  };
  tick();
}

/** Resolve true the first time the active view sees the figure (calling onSeen once), false if it is removed or time runs out. */
export function watchSeen(fig: FigureHandle, seconds: number, onSeen: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (): void => {
      if (fig.removed) {
        resolve(false);
        return;
      }
      if (fig.isSeen()) {
        onSeen();
        resolve(true);
        return;
      }
      if ((performance.now() - start) / 1000 > seconds) {
        resolve(false);
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

/** Resolve when the figure is gone (removed or timeout). */
export function untilGone(fig: FigureHandle, seconds: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (): void => {
      if (fig.removed || (performance.now() - start) / 1000 > seconds) {
        resolve();
        return;
      }
      setTimeout(tick, 150);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// CCTV silhouettes (injected for N rendered frames of one feed)
// ---------------------------------------------------------------------------

const silhouettes = new Map<number, THREE.Group>();

function buildSilhouette(color: number): THREE.Group {
  // Unlit, near-black: on a degraded 4:3 feed this reads as "someone" and nothing more.
  const mat = new THREE.MeshBasicMaterial({ color });
  const g = new THREE.Group();
  g.name = 'cctv_silhouette';
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = false;
    m.receiveShadow = false;
    m.userData.noInteract = true;
    g.add(m);
  };
  add(new THREE.CapsuleGeometry(0.17, 0.6, 4, 12), 0, 1.3, 0, 1.3, 1, 0.7); // torso
  add(new THREE.CylinderGeometry(0.05, 0.06, 0.14, 8), 0, 1.66, 0); // neck
  add(new THREE.SphereGeometry(0.115, 14, 10), 0, 1.84, 0, 0.92, 1.08, 0.95); // head
  for (const side of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.075, 0.82, 3, 8), side * 0.11, 0.5, 0); // leg
    add(new THREE.CapsuleGeometry(0.05, 0.72, 3, 8), side * 0.29, 1.12, 0.02); // arm — a touch too long
    add(new THREE.BoxGeometry(0.1, 0.06, 0.26), side * 0.11, 0.03, 0.05); // foot
  }
  return g;
}

export function silhouette(color = 0x07070a): THREE.Group {
  let g = silhouettes.get(color);
  if (!g) {
    g = buildSilhouette(color);
    silhouettes.set(color, g);
  }
  return g;
}

/** Show a dark figure on one camera for `frames` rendered frames of that feed only. */
export function injectSilhouette(s: Services, cameraId: string, pos: Vec3, frames = 2, yaw = 0, color = 0x07070a, scale = 1): void {
  s.cctv.inject(cameraId, frames, (scene) => {
    const g = silhouette(color);
    g.position.set(pos.x, pos.y, pos.z);
    g.rotation.y = yaw;
    g.scale.setScalar(scale);
    scene.add(g);
    return () => {
      scene.remove(g);
    };
  });
}

// ---------------------------------------------------------------------------
// Temporary "inspect" hot-spots left behind by anomalies
// ---------------------------------------------------------------------------

export interface HotSpot {
  id: string;
  pos: Vec3;
  room: RoomId;
  who: CharacterId[] | 'all';
  prompt: string;
  radius?: number;
  /** remove after first use (default true) */
  once?: boolean;
  /** seconds until it disappears on its own */
  expires?: number;
  use: (c: CharacterId) => void | Promise<void>;
}

interface LiveSpot {
  obj: THREE.Object3D;
  remove: () => void;
}

const spots = new Map<string, LiveSpot>();

export function hotspot(s: Services, opts: HotSpot): () => void {
  removeHotspot(s, opts.id);
  const obj = new THREE.Object3D();
  obj.name = `anomaly:${opts.id}`;
  obj.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
  s.three.scene.add(obj);
  const remove = (): void => {
    if (!spots.has(opts.id)) return;
    spots.delete(opts.id);
    s.interact.unregister(opts.id);
    obj.removeFromParent();
  };
  const item: Interactable = {
    id: opts.id,
    object: obj,
    room: opts.room,
    radius: opts.radius ?? 2.4,
    loose: true,
    prompt: (c) => (opts.who === 'all' || opts.who.includes(c) ? opts.prompt : null),
    use: async (c) => {
      await opts.use(c);
      if (opts.once !== false) remove();
    },
  };
  spots.set(opts.id, { obj, remove });
  s.interact.register(item);
  if (opts.expires && opts.expires > 0) {
    setTimeout(() => remove(), opts.expires * 1000);
  }
  return remove;
}

export function removeHotspot(s: Services, id: string): void {
  const live = spots.get(id);
  if (live) live.remove();
  else s.interact.unregister(id);
}

export function clearHotspots(): void {
  for (const live of Array.from(spots.values())) live.remove();
  spots.clear();
}

// ---------------------------------------------------------------------------
// Wet spots (what the mop can act on)
// ---------------------------------------------------------------------------

export interface WetSpot {
  id: string;
  room: RoomId;
  point: Vec2;
  kind: 'leak' | 'footprints';
  /** removes the decal(s) */
  remove: () => void;
}

const wetSpots: WetSpot[] = [];

export function addWetSpot(spot: WetSpot): void {
  removeWetSpot(spot.id);
  wetSpots.push(spot);
}

export function wetSpotNear(p: Vec2 | Vec3, maxDist: number): WetSpot | null {
  let best: WetSpot | null = null;
  let bd = maxDist;
  for (const w of wetSpots) {
    const d = dist2d(w.point, p);
    if (d <= bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

export function removeWetSpot(id: string): void {
  const i = wetSpots.findIndex((w) => w.id === id);
  if (i >= 0) {
    wetSpots[i].remove();
    wetSpots.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Loops + reset
// ---------------------------------------------------------------------------

const loops: SfxHandle[] = [];
const timers: ReturnType<typeof setInterval>[] = [];

export function trackLoop(h: SfxHandle | null): SfxHandle | null {
  if (h) loops.push(h);
  return h;
}

export function trackInterval(t: ReturnType<typeof setInterval>): void {
  timers.push(t);
}

/** New game: stop looping sounds, drop hot-spots and wet spots. Decals are rebuilt by the world. */
export function resetFx(): void {
  for (const h of loops) h.stop(0.2);
  loops.length = 0;
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  clearHotspots();
  for (const w of wetSpots.splice(0)) w.remove();
}
