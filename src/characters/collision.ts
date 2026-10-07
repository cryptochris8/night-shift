/**
 * Floor-plane collision for characters. Pure TypeScript (no DOM, no three) so tests can import it.
 *
 * Model: a character is a circle of `radius` on the floor plane. Rooms are convex interior
 * rectangles separated by wall gaps; the only way from one room to another is through a
 * door passage rectangle that is currently passable. Solid props are axis-aligned rects.
 * Movement is resolved in sub-steps, each tried as a whole then per axis, so the circle
 * slides along walls and prop faces instead of sticking.
 */
import type { Rect, RoomDef, Vec2 } from '../core/types';

export interface PassageDef {
  /** world rect covering the opening (spans the wall thickness plus a little of each room) */
  rect: Rect;
  passable: boolean;
  /** axis of travel THROUGH the opening (perpendicular to the wall). Inferred from the rooms when omitted. */
  along?: 'x' | 'z';
}

export interface CollisionContext {
  rooms: RoomDef[];
  passages: PassageDef[];
  obstacles: Rect[];
}

const EPS = 1e-6;
/** Narrow openings (counter gate 0.7 m) still need to be walkable: keep at least this much centre clearance. */
const MIN_PASSAGE_CLEARANCE = 0.5;
/** How far a passage region reaches into the rooms beyond the radius, so regions overlap robustly. */
const PASSAGE_REACH = 0.1;
/** Shoulders turn through a doorway: jambs only need half the body radius of clearance. */
const JAMB_CLEARANCE = 0.5;
/** Props this small (buckets, stools, bollards) are stepped around with the feet, not the shoulders. */
const SMALL_OBSTACLE = 0.6;
const SMALL_OBSTACLE_RADIUS = 0.5;

function obstacleRadius(ob: Rect, radius: number): number {
  return ob.x1 - ob.x0 <= SMALL_OBSTACLE && ob.z1 - ob.z0 <= SMALL_OBSTACLE ? radius * SMALL_OBSTACLE_RADIUS : radius;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
}

export function pointInRect(p: Vec2, r: Rect, pad = 0): boolean {
  return p.x >= r.x0 - pad - EPS && p.x <= r.x1 + pad + EPS && p.z >= r.z0 - pad - EPS && p.z <= r.z1 + pad + EPS;
}

export function expandRect(r: Rect, dx: number, dz = dx): Rect {
  return { x0: r.x0 - dx, x1: r.x1 + dx, z0: r.z0 - dz, z1: r.z1 + dz };
}

/** Clamp a point inside a rect shrunk by `pad` on every side (collapses to the centre when the rect is too small). */
export function clampToRect(p: Vec2, r: Rect, pad = 0): Vec2 {
  const x0 = r.x0 + pad;
  const x1 = r.x1 - pad;
  const z0 = r.z0 + pad;
  const z1 = r.z1 - pad;
  return {
    x: x0 > x1 ? (r.x0 + r.x1) / 2 : Math.min(x1, Math.max(x0, p.x)),
    z: z0 > z1 ? (r.z0 + r.z1) / 2 : Math.min(z1, Math.max(z0, p.z)),
  };
}

/** True when a circle overlaps a rect (touching does not count). */
export function circleOverlapsRect(pos: Vec2, radius: number, r: Rect): boolean {
  const cx = Math.min(r.x1, Math.max(r.x0, pos.x));
  const cz = Math.min(r.z1, Math.max(r.z0, pos.z));
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  return dx * dx + dz * dz < radius * radius - EPS;
}

/** Push a circle out of a rect along the minimum translation; returns the (possibly unchanged) new centre. */
export function circleRectResolve(pos: Vec2, radius: number, r: Rect): Vec2 {
  if (!circleOverlapsRect(pos, radius, r)) return { x: pos.x, z: pos.z };
  const inside = pos.x > r.x0 && pos.x < r.x1 && pos.z > r.z0 && pos.z < r.z1;
  if (inside) {
    const toW = pos.x - r.x0 + radius;
    const toE = r.x1 - pos.x + radius;
    const toS = pos.z - r.z0 + radius;
    const toN = r.z1 - pos.z + radius;
    const m = Math.min(toW, toE, toS, toN);
    // ties resolve toward +z (the aisle side of the waiting-room chair rows)
    if (m === toN) return { x: pos.x, z: r.z1 + radius };
    if (m === toS) return { x: pos.x, z: r.z0 - radius };
    if (m === toE) return { x: r.x1 + radius, z: pos.z };
    return { x: r.x0 - radius, z: pos.z };
  }
  const cx = Math.min(r.x1, Math.max(r.x0, pos.x));
  const cz = Math.min(r.z1, Math.max(r.z0, pos.z));
  let dx = pos.x - cx;
  let dz = pos.z - cz;
  let d = Math.hypot(dx, dz);
  if (d < EPS) {
    // centre exactly on an edge: push along the edge normal
    const nx = pos.x <= r.x0 + EPS ? -1 : pos.x >= r.x1 - EPS ? 1 : 0;
    const nz = nx === 0 ? (pos.z <= r.z0 + EPS ? -1 : 1) : 0;
    dx = nx;
    dz = nz;
    d = 1;
  }
  return { x: cx + (dx / d) * radius, z: cz + (dz / d) * radius };
}

/** Segment a→b intersects (or touches) rect r. */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const clip = (p: number, q: number): boolean => {
    // p * t <= q
    if (Math.abs(p) < EPS) return q >= -EPS;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a.x - r.x0) && clip(dx, r.x1 - a.x) && clip(-dz, a.z - r.z0) && clip(dz, r.z1 - a.z) && t0 <= t1;
}

// ---------------------------------------------------------------------------

interface PassageRegion {
  rect: Rect;
  /** rooms whose bounds this passage touches (used to validate which room may be left through it) */
  touches: Rect[];
}

function inferAlong(rect: Rect, rooms: RoomDef[]): 'x' | 'z' {
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  for (const rm of rooms) {
    const b = rm.bounds;
    if (!rectsOverlap(b, rect)) continue;
    // the passage crosses this room's boundary on the axis where the room lies to one side of the centre
    if (b.x1 <= cx + EPS || b.x0 >= cx - EPS) return 'x';
    if (b.z1 <= cz + EPS || b.z0 >= cz - EPS) return 'z';
  }
  // fallback: travel along the shorter extent (door width is usually the longer one)
  return rect.x1 - rect.x0 <= rect.z1 - rect.z0 ? 'x' : 'z';
}

/** The region a circle's CENTRE may occupy while inside a passage: narrowed across, lengthened along. */
function passageRegion(p: PassageDef, radius: number, rooms: RoomDef[]): PassageRegion {
  const along = p.along ?? inferAlong(p.rect, rooms);
  const r = p.rect;
  const w = along === 'x' ? r.z1 - r.z0 : r.x1 - r.x0;
  const lateral = Math.min(radius * JAMB_CLEARANCE, Math.max(0, (w - MIN_PASSAGE_CLEARANCE) / 2));
  const axial = radius + PASSAGE_REACH;
  const rect: Rect =
    along === 'x'
      ? { x0: r.x0 - axial, x1: r.x1 + axial, z0: r.z0 + lateral, z1: r.z1 - lateral }
      : { x0: r.x0 + lateral, x1: r.x1 - lateral, z0: r.z0 - axial, z1: r.z1 + axial };
  const touches: Rect[] = [];
  for (const rm of rooms) if (rectsOverlap(rm.bounds, expandRect(p.rect, 0.05))) touches.push(rm.bounds);
  return { rect, touches };
}

function roomContaining(p: Vec2, rooms: RoomDef[]): RoomDef | null {
  for (const rm of rooms) if (pointInRect(p, rm.bounds)) return rm;
  return null;
}

function inRoomShrunk(p: Vec2, rm: RoomDef, radius: number): boolean {
  return pointInRect(p, rm.bounds, -radius);
}

function blockedByObstacle(p: Vec2, radius: number, obstacles: Rect[]): boolean {
  for (const ob of obstacles) if (circleOverlapsRect(p, obstacleRadius(ob, radius), ob)) return true;
  return false;
}

/**
 * May the circle centre be at `q`, having started the sub-step at `start`?
 * Leaving the start room is only allowed into a passable passage that touches that room.
 */
function allowed(start: Vec2, q: Vec2, radius: number, rooms: RoomDef[], regions: PassageRegion[], obstacles: Rect[]): boolean {
  if (blockedByObstacle(q, radius, obstacles)) return false;
  const startRoom = roomContaining(start, rooms);
  if (startRoom) {
    if (inRoomShrunk(q, startRoom, radius)) return true;
    for (const rg of regions) {
      if (!pointInRect(q, rg.rect)) continue;
      if (rg.touches.includes(startRoom.bounds)) return true;
    }
    return false;
  }
  // started in a wall gap (inside a passage): may stay in a passage or step into any room
  for (const rg of regions) if (pointInRect(q, rg.rect)) return true;
  for (const rm of rooms) if (inRoomShrunk(q, rm, radius)) return true;
  return false;
}

/** Nearest legal spot for a circle that is currently somewhere illegal (inside a wall or a prop). */
function depenetrate(p: Vec2, radius: number, rooms: RoomDef[], regions: PassageRegion[], obstacles: Rect[]): Vec2 {
  let q: Vec2 = { x: p.x, z: p.z };
  for (const ob of obstacles) q = circleRectResolve(q, obstacleRadius(ob, radius), ob);
  const room = roomContaining(q, rooms);
  const inPassage = regions.some((rg) => pointInRect(q, rg.rect));
  if (room && !inRoomShrunk(q, room, radius) && !inPassage) {
    // pick whichever is closer: the shrunk room or a passage region of this room
    const clampedRoom = clampToRect(q, room.bounds, radius);
    let best = clampedRoom;
    let bd = Math.hypot(clampedRoom.x - q.x, clampedRoom.z - q.z);
    for (const rg of regions) {
      if (!rg.touches.includes(room.bounds)) continue;
      const c = clampToRect(q, rg.rect);
      const d = Math.hypot(c.x - q.x, c.z - q.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    q = best;
  } else if (!room && !inPassage) {
    // lost in a wall gap with no passage: snap into the nearest room
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (const rm of rooms) {
      const c = clampToRect(q, rm.bounds, radius);
      const d = Math.hypot(c.x - q.x, c.z - q.z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    if (best) q = best;
  }
  return q;
}

function slideAxis(p: Vec2, dx: number, dz: number, radius: number, rooms: RoomDef[], regions: PassageRegion[], obstacles: Rect[]): Vec2 {
  if (dx === 0 && dz === 0) return p;
  const full: Vec2 = { x: p.x + dx, z: p.z + dz };
  if (allowed(p, full, radius, rooms, regions, obstacles)) return full;
  // bisect the largest legal fraction of the step
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const q: Vec2 = { x: p.x + dx * mid, z: p.z + dz * mid };
    if (allowed(p, q, radius, rooms, regions, obstacles)) lo = mid;
    else hi = mid;
  }
  return lo > 0 ? { x: p.x + dx * lo, z: p.z + dz * lo } : p;
}

/**
 * Move a circle of `radius` from `pos` by `delta`, sliding along walls and solid obstacles.
 * A point may leave a room's bounds only through a passable passage rect; obstacles block.
 */
export function resolveMove(pos: Vec2, delta: Vec2, radius: number, ctx: CollisionContext): Vec2 {
  const regions: PassageRegion[] = [];
  for (const p of ctx.passages) if (p.passable) regions.push(passageRegion(p, radius, ctx.rooms));
  let p: Vec2 = { x: pos.x, z: pos.z };

  const startLegal =
    !blockedByObstacle(p, radius, ctx.obstacles) &&
    (() => {
      const rm = roomContaining(p, ctx.rooms);
      if (rm && inRoomShrunk(p, rm, radius)) return true;
      return regions.some((rg) => pointInRect(p, rg.rect));
    })();
  if (!startLegal) p = depenetrate(p, radius, ctx.rooms, regions, ctx.obstacles);
  // still wedged between props after depenetration: let the body walk out rather than freeze
  const obstacles = blockedByObstacle(p, radius, ctx.obstacles) ? [] : ctx.obstacles;

  const len = Math.hypot(delta.x, delta.z);
  if (len < EPS) return p;
  const stepLen = Math.max(0.05, radius * 0.5);
  const steps = Math.min(64, Math.max(1, Math.ceil(len / stepLen)));
  const sx = delta.x / steps;
  const sz = delta.z / steps;
  for (let i = 0; i < steps; i++) {
    const whole: Vec2 = { x: p.x + sx, z: p.z + sz };
    if (allowed(p, whole, radius, ctx.rooms, regions, obstacles)) {
      p = whole;
      continue;
    }
    p = slideAxis(p, sx, 0, radius, ctx.rooms, regions, obstacles);
    p = slideAxis(p, 0, sz, radius, ctx.rooms, regions, obstacles);
  }
  return p;
}
