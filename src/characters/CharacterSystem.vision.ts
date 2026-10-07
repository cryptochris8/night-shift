/**
 * Line-of-sight on the floor plan: a sight line may cross a room boundary only through an open
 * door passage (or an archway) or through a glass wall. Walls are full height, so y is ignored
 * for occlusion; the cone test uses the real camera.
 */
import * as THREE from 'three';
import type { DoorDef, RoomDef, RoomId, Side, Vec2 } from '../core/types';
import { doorPassage } from '../world/layout';
import { pointInRect } from './collision';

export interface VisionWorld {
  rooms: RoomDef[];
  doors: DoorDef[];
  isDoorOpen(doorId: string): boolean;
}

interface Interval {
  t0: number;
  t1: number;
  room: RoomDef;
}

const SIDE_EPS = 0.03;
/** widest wall gap a sight line may bridge between two rooms (wall + door-frame slack) */
const MAX_GAP = 0.2 + 0.5;

function slab(a: Vec2, b: Vec2, room: RoomDef): Interval | null {
  const r = room.bounds;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < 1e-9) {
    if (a.x < r.x0 || a.x > r.x1) return null;
  } else {
    let ta = (r.x0 - a.x) / dx;
    let tb = (r.x1 - a.x) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (Math.abs(dz) < 1e-9) {
    if (a.z < r.z0 || a.z > r.z1) return null;
  } else {
    let ta = (r.z0 - a.z) / dz;
    let tb = (r.z1 - a.z) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  if (t1 < t0 - 1e-9) return null;
  return { t0, t1, room };
}

function sideOf(room: RoomDef, p: Vec2): Side | null {
  const r = room.bounds;
  if (Math.abs(p.x - r.x0) < SIDE_EPS) return 'w';
  if (Math.abs(p.x - r.x1) < SIDE_EPS) return 'e';
  if (Math.abs(p.z - r.z0) < SIDE_EPS) return 's';
  if (Math.abs(p.z - r.z1) < SIDE_EPS) return 'n';
  return null;
}

/** Can a sight line cross the boundary of `room` at point `p`? */
function crossingOpen(room: RoomDef, p: Vec2, world: VisionWorld): boolean {
  for (const d of world.doors) {
    if (d.a !== room.id && d.b !== room.id) continue;
    if (!pointInRect(p, doorPassage(d), 0.08)) continue;
    // archways are always open; sliding glass doors are see-through even when shut
    if (d.kind === 'open' || d.kind === 'sliding_glass' || world.isDoorOpen(d.id)) return true;
  }
  const side = sideOf(room, p);
  if (side && room.sides?.[side]?.kind === 'glass') return true;
  return false;
}

/** True when nothing solid stands between a and b on the floor plan. */
export function lineOfSight(a: Vec2, b: Vec2, world: VisionWorld): boolean {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-6) return true;
  const intervals: Interval[] = [];
  for (const rm of world.rooms) {
    const iv = slab(a, b, rm);
    if (iv) intervals.push(iv);
  }
  if (intervals.length === 0) return false;
  intervals.sort((p, q) => p.t0 - q.t0);

  let cur: Interval | undefined = intervals.find((iv) => iv.t0 <= 1e-6 && iv.t1 >= -1e-6);
  let idx = 0;
  if (!cur) {
    // viewer stands in a wall gap (doorway): continue from the first room ahead
    cur = intervals[0];
    if (cur.t0 * len > MAX_GAP) return false;
  }
  const at = (t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

  for (let guard = 0; guard < 64; guard++) {
    if (cur.t1 >= 1 - 1e-6) return true;
    const exit = at(cur.t1);
    const exitOk = crossingOpen(cur.room, exit, world);
    // next room along the line
    let next: Interval | undefined;
    while (idx < intervals.length) {
      const iv = intervals[idx++];
      if (iv === cur) continue;
      if (iv.t1 <= cur.t1 + 1e-6) continue;
      next = iv;
      break;
    }
    if (!next) {
      // target lies in the gap just beyond this room (e.g. standing in a doorway)
      return exitOk && (1 - cur.t1) * len <= MAX_GAP;
    }
    if ((next.t0 - cur.t1) * len > MAX_GAP) return false;
    // one shared wall: it is see-through if either room says so (open door, archway, glass)
    const entry = at(Math.max(next.t0, cur.t1));
    if (!exitOk && !crossingOpen(next.room, entry, world)) return false;
    cur = next;
  }
  return false;
}

const _pos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();

/** Is `target` inside the camera's view cone (full angle `fovDeg`) and within `maxDist`? */
export function inViewCone(camera: THREE.Camera, target: THREE.Vector3, fovDeg: number, maxDist: number): boolean {
  camera.getWorldPosition(_pos);
  camera.getWorldDirection(_dir);
  _to.subVectors(target, _pos);
  const d = _to.length();
  if (d > maxDist) return false;
  if (d < 0.35) return true;
  _to.divideScalar(d);
  const cosHalf = Math.cos(THREE.MathUtils.degToRad(fovDeg) / 2);
  return _dir.dot(_to) >= cosHalf;
}

/** Full visibility test: view cone + floor-plan occlusion. */
export function canSeeFrom(camera: THREE.Camera, target: THREE.Vector3, fovDeg: number, maxDist: number, world: VisionWorld): boolean {
  if (!inViewCone(camera, target, fovDeg, maxDist)) return false;
  camera.getWorldPosition(_pos);
  return lineOfSight({ x: _pos.x, z: _pos.z }, { x: target.x, z: target.z }, world);
}

export function roomIdAt(p: Vec2, rooms: RoomDef[]): RoomId | null {
  for (const rm of rooms) if (pointInRect(p, rm.bounds)) return rm.id;
  return null;
}
