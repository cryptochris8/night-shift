/**
 * Room-level visibility: which rooms can possibly be seen from the room the camera is in.
 * Walls are opaque and there is no other occlusion culling, so drawing only these rooms removes
 * the props and geometry hidden behind closed doors (the corridor view alone drops by ~half).
 *
 * See-through openings:
 *   - 'open' archways and glass sliding doors: always, and the search continues through them
 *   - any door that is currently open: same
 *   - doors with a vision panel ('window'): the room behind is visible, but the search stops there
 *     (you can glimpse the next room through the panel, not two rooms beyond)
 *   - glass room sides (waiting/corridor west to the ambulance bay, imaging's corridor window)
 * Pure (no three.js / DOM) so it is unit-tested.
 */
import type { DoorDef, RoomDef, RoomId, Side } from '../core/types';

export interface Opening {
  a: RoomId;
  b: RoomId;
  /** visibility passes and the search may continue beyond */
  through: (isOpen: (doorId: string) => boolean) => boolean;
  /** visibility passes but stops at the far room */
  glimpse: boolean;
  doorId?: string;
}

const GAP = 0.2;
const TOL = 0.12;

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 0.1;
}

/** Rooms that share the wall on a given side of `room` (bounds separated by the wall gap). */
export function neighboursAcross(room: RoomDef, side: Side, rooms: RoomDef[]): RoomDef[] {
  const b = room.bounds;
  return rooms.filter((o) => {
    if (o.id === room.id) return false;
    const c = o.bounds;
    switch (side) {
      case 'w':
        return Math.abs(c.x1 - (b.x0 - GAP)) < TOL && overlap(c.z0, c.z1, b.z0, b.z1);
      case 'e':
        return Math.abs(c.x0 - (b.x1 + GAP)) < TOL && overlap(c.z0, c.z1, b.z0, b.z1);
      case 's':
        return Math.abs(c.z1 - (b.z0 - GAP)) < TOL && overlap(c.x0, c.x1, b.x0, b.x1);
      case 'n':
      default:
        return Math.abs(c.z0 - (b.z1 + GAP)) < TOL && overlap(c.x0, c.x1, b.x0, b.x1);
    }
  });
}

export function buildOpenings(rooms: RoomDef[], doors: DoorDef[]): Opening[] {
  const out: Opening[] = [];
  for (const d of doors) {
    const always = d.kind === 'open' || d.kind === 'sliding_glass';
    out.push({
      a: d.a,
      b: d.b,
      doorId: d.id,
      glimpse: Boolean(d.window),
      through: always ? () => true : (isOpen) => isOpen(d.id),
    });
  }
  for (const r of rooms) {
    for (const [side, spec] of Object.entries(r.sides ?? {}) as [Side, { kind: string }][]) {
      if (spec.kind !== 'glass') continue;
      for (const n of neighboursAcross(r, side, rooms)) {
        out.push({ a: r.id, b: n.id, glimpse: false, through: () => true });
      }
    }
  }
  return out;
}

/**
 * Breadth-first search from `start` through see-through openings, at most `maxDepth` openings deep.
 */
export function visibleRooms(start: RoomId, openings: Opening[], isOpen: (doorId: string) => boolean, maxDepth = 3): Set<RoomId> {
  const seen = new Set<RoomId>([start]);
  let frontier: RoomId[] = [start];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    const next: RoomId[] = [];
    for (const room of frontier) {
      for (const o of openings) {
        if (o.a !== room && o.b !== room) continue;
        const other = o.a === room ? o.b : o.a;
        if (seen.has(other)) continue;
        if (o.through(isOpen)) {
          seen.add(other);
          next.push(other);
        } else if (o.glimpse) {
          seen.add(other); // visible through the vision panel, but nothing beyond it
        }
      }
    }
    frontier = next;
  }
  return seen;
}
