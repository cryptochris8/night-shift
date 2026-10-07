/**
 * Pure spatial queries for the interaction system. No three.js or DOM here so the
 * logic stays cheap to reason about and testable in node.
 */
import type { CharacterId, DoorDef, Rect, RoomDef, RoomId, Vec3 } from '../core/types';
import { doorPassage, roomAt } from '../world/layout';

export type RoomAdjacency = Map<RoomId, Set<RoomId>>;

const NO_DOORS: readonly DoorDef[] = [];

/** room → rooms that share a door with it (any kind, any access). */
export function buildAdjacency(doors: readonly DoorDef[]): RoomAdjacency {
  const adj: RoomAdjacency = new Map();
  const link = (a: RoomId, b: RoomId): void => {
    let set = adj.get(a);
    if (!set) {
      set = new Set();
      adj.set(a, set);
    }
    set.add(b);
  };
  for (const d of doors) {
    link(d.a, d.b);
    link(d.b, d.a);
  }
  return adj;
}

/** Order-independent key for a pair of rooms. */
export function pairKey(a: RoomId, b: RoomId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** pairKey(a,b) → every door joining those two rooms. */
export function buildDoorIndex(doors: readonly DoorDef[]): Map<string, DoorDef[]> {
  const index = new Map<string, DoorDef[]>();
  for (const d of doors) {
    const key = pairKey(d.a, d.b);
    const list = index.get(key);
    if (list) list.push(d);
    else index.set(key, [d]);
  }
  return index;
}

/** Does the floor-plane segment (ax,az)→(bx,bz) cross the rect? Slab clipping. */
export function segmentIntersectsRect(ax: number, az: number, bx: number, bz: number, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  if (Math.abs(dx) < 1e-9) {
    if (ax < r.x0 || ax > r.x1) return false;
  } else {
    let ta = (r.x0 - ax) / dx;
    let tb = (r.x1 - ax) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < r.z0 || az > r.z1) return false;
  } else {
    let ta = (r.z0 - az) / dz;
    let tb = (r.z1 - az) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return t0 <= t1;
}

export interface SightEnv {
  rooms: readonly RoomDef[];
  wall: number;
  doorsBetween: (a: RoomId, b: RoomId) => readonly DoorDef[];
  /** true when a hand/eye gets through this door right now (open leaf, or no leaf at all). */
  passable: (door: DoorDef) => boolean;
}

/**
 * Can a point be reached from the camera without going through a wall?
 * Same room → yes. Different rooms → only if the segment crosses a passable door joining them.
 * A point inside a wall gap (door leaf, badge reader) has no room and is accepted.
 */
export function hasLineOfSight(env: SightEnv, from: Vec3, to: Vec3): boolean {
  const ra = roomAt({ x: from.x, z: from.z }, env.rooms as RoomDef[]);
  const rb = roomAt({ x: to.x, z: to.z }, env.rooms as RoomDef[]);
  if (!ra || !rb || ra === rb) return true;
  const doors = env.doorsBetween(ra, rb);
  for (const d of doors) {
    if (!segmentIntersectsRect(from.x, from.z, to.x, to.z, doorPassage(d, env.wall))) continue;
    if (env.passable(d)) return true;
  }
  return false;
}

export function noDoors(): readonly DoorDef[] {
  return NO_DOORS;
}

/** Short HUD line explaining why a door refused the active character. */
export function denialPrompt(
  def: DoorDef | undefined,
  live: { locked: boolean; access: CharacterId[] | 'all' | 'none' } | undefined,
): string {
  if (def?.kind === 'elevator') return 'Not in service';
  const locked = live ? live.locked : def?.locked ?? false;
  const access = live ? live.access : def?.access ?? 'none';
  if (locked || access === 'none') return 'Locked';
  return 'Staff only';
}
