import { describe, expect, it } from 'vitest';
import {
  circleOverlapsRect,
  circleRectResolve,
  clampToRect,
  expandRect,
  pointInRect,
  rectsOverlap,
  resolveMove,
  segmentIntersectsRect,
  type CollisionContext,
  type PassageDef,
} from '../src/characters/collision';
import { DOORS, PROPS, ROOMS, ROOM_BY_ID, SPAWN, doorPassage, roomAt } from '../src/world/layout';
import type { CharacterId, PropDef, Rect, RoomDef, Vec2 } from '../src/core/types';

const R = 0.3; // player capsule radius (CONTRACT §4E)

const room = (id: string, bounds: Rect): RoomDef => ({
  id: id as RoomDef['id'],
  name: id,
  shortName: id,
  bounds,
  ceiling: 2.8,
  floor: 'vinyl',
  wall: 'painted',
  access: ['john', 'susie', 'paul'],
  lit: true,
  emergency: false,
});

const BOX: Rect = { x0: 0, x1: 10, z0: 0, z1: 10 };
const ONE_ROOM: CollisionContext = { rooms: [room('a', BOX)], passages: [], obstacles: [] };

/** Rotated footprint → AABB, per types.ts (w along local x, d along local z). */
function footprintAABB(p: PropDef): Rect | null {
  if (!p.footprint) return null;
  const c = Math.abs(Math.cos(p.rotY));
  const s = Math.abs(Math.sin(p.rotY));
  const hx = (p.footprint.w * c + p.footprint.d * s) / 2;
  const hz = (p.footprint.w * s + p.footprint.d * c) / 2;
  return { x0: p.pos.x - hx, x1: p.pos.x + hx, z0: p.pos.z - hz, z1: p.pos.z + hz };
}

const near = (p: Vec2, x: number, z: number, tol = 0.02): void => {
  expect(Math.abs(p.x - x), `x ${p.x} vs ${x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.z - z), `z ${p.z} vs ${z}`).toBeLessThanOrEqual(tol);
};

describe('rect helpers', () => {
  it('rectsOverlap is strict (touching edges do not overlap)', () => {
    expect(rectsOverlap({ x0: 0, x1: 1, z0: 0, z1: 1 }, { x0: 0.5, x1: 2, z0: 0.5, z1: 2 })).toBe(true);
    expect(rectsOverlap({ x0: 0, x1: 1, z0: 0, z1: 1 }, { x0: 1, x1: 2, z0: 0, z1: 1 })).toBe(false);
    expect(rectsOverlap({ x0: 0, x1: 1, z0: 0, z1: 1 }, { x0: 2, x1: 3, z0: 2, z1: 3 })).toBe(false);
    expect(rectsOverlap({ x0: 0, x1: 1, z0: 0, z1: 1 }, { x0: -1, x1: 2, z0: -1, z1: 2 })).toBe(true);
  });

  it('pointInRect is inclusive and honours padding', () => {
    const r: Rect = { x0: 0, x1: 2, z0: 0, z1: 2 };
    expect(pointInRect({ x: 1, z: 1 }, r)).toBe(true);
    expect(pointInRect({ x: 2, z: 0 }, r)).toBe(true);
    expect(pointInRect({ x: 2.05, z: 1 }, r)).toBe(false);
    expect(pointInRect({ x: 2.05, z: 1 }, r, 0.1)).toBe(true);
    expect(pointInRect({ x: 1.95, z: 1 }, r, -0.1)).toBe(false);
  });

  it('expandRect grows (or shrinks) on every side', () => {
    expect(expandRect({ x0: 0, x1: 1, z0: 2, z1: 3 }, 0.5)).toEqual({ x0: -0.5, x1: 1.5, z0: 1.5, z1: 3.5 });
    expect(expandRect({ x0: 0, x1: 1, z0: 2, z1: 3 }, 0.5, 0.1)).toEqual({ x0: -0.5, x1: 1.5, z0: 1.9, z1: 3.1 });
    expect(expandRect({ x0: 0, x1: 2, z0: 0, z1: 2 }, -0.5)).toEqual({ x0: 0.5, x1: 1.5, z0: 0.5, z1: 1.5 });
  });

  it('clampToRect keeps interior points, clamps exterior ones, and collapses tiny rects to the centre', () => {
    const r: Rect = { x0: 0, x1: 4, z0: 0, z1: 2 };
    expect(clampToRect({ x: 1, z: 1 }, r)).toEqual({ x: 1, z: 1 });
    expect(clampToRect({ x: 9, z: -3 }, r)).toEqual({ x: 4, z: 0 });
    expect(clampToRect({ x: 9, z: -3 }, r, 0.5)).toEqual({ x: 3.5, z: 0.5 });
    expect(clampToRect({ x: 9, z: 9 }, r, 1.5)).toEqual({ x: 2.5, z: 1 }); // z collapses: 2 - 2×1.5 < 0
  });
});

describe('circle helpers', () => {
  const r: Rect = { x0: 2, x1: 4, z0: 2, z1: 4 };

  it('circleOverlapsRect detects overlap but not mere touching', () => {
    expect(circleOverlapsRect({ x: 1.8, z: 3 }, 0.3, r)).toBe(true);
    expect(circleOverlapsRect({ x: 1.7, z: 3 }, 0.3, r)).toBe(false); // exactly touching
    expect(circleOverlapsRect({ x: 1.0, z: 3 }, 0.3, r)).toBe(false);
    expect(circleOverlapsRect({ x: 3, z: 3 }, 0.3, r)).toBe(true); // inside
    expect(circleOverlapsRect({ x: 1.85, z: 1.85 }, 0.3, r)).toBe(true); // corner, within 0.3 of (2,2)
    expect(circleOverlapsRect({ x: 1.75, z: 1.75 }, 0.3, r)).toBe(false); // corner, farther than 0.3
  });

  it('circleRectResolve pushes an overlapping circle out along the shortest axis', () => {
    expect(circleRectResolve({ x: 1, z: 3 }, 0.3, r)).toEqual({ x: 1, z: 3 }); // no overlap → unchanged
    near(circleRectResolve({ x: 1.9, z: 3 }, 0.3, r), 1.7, 3, 1e-9); // from the west face
    near(circleRectResolve({ x: 3, z: 4.1 }, 0.3, r), 3, 4.3, 1e-9); // from the north face
    near(circleRectResolve({ x: 2.2, z: 3 }, 0.3, r), 1.7, 3, 1e-9); // centre inside, nearest face west
    near(circleRectResolve({ x: 3, z: 3.9 }, 0.3, r), 3, 4.3, 1e-9); // centre inside, nearest face north
    const corner = circleRectResolve({ x: 1.9, z: 1.9 }, 0.3, r);
    expect(Math.hypot(corner.x - 2, corner.z - 2)).toBeCloseTo(0.3, 9);
    expect(circleOverlapsRect(corner, 0.3, r)).toBe(false);
  });

  it('circleRectResolve breaks exact-centre ties toward +z (the aisle side of chair rows)', () => {
    const sq: Rect = { x0: 0, x1: 2, z0: 0, z1: 2 };
    expect(circleRectResolve({ x: 1, z: 1 }, 0.3, sq)).toEqual({ x: 1, z: 2.3 });
  });
});

describe('segmentIntersectsRect', () => {
  const r: Rect = { x0: 2, x1: 4, z0: 2, z1: 4 };

  it('detects crossings, containment and touching', () => {
    expect(segmentIntersectsRect({ x: 0, z: 3 }, { x: 6, z: 3 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: 0, z: 0 }, { x: 6, z: 6 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: 2.5, z: 2.5 }, { x: 3.5, z: 3.5 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: 0, z: 2 }, { x: 6, z: 2 }, r)).toBe(true); // along an edge
    expect(segmentIntersectsRect({ x: 0, z: 0 }, { x: 4, z: 0 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: 0, z: 0 }, { x: 1.9, z: 1.9 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: 5, z: 0 }, { x: 5, z: 10 }, r)).toBe(false);
    expect(segmentIntersectsRect({ x: 0, z: 5 }, { x: 1, z: 5 }, r)).toBe(false);
  });

  it('is symmetric in its endpoints', () => {
    const a = { x: 0, z: 1 };
    const b = { x: 6, z: 5 };
    expect(segmentIntersectsRect(a, b, r)).toBe(segmentIntersectsRect(b, a, r));
    const c = { x: 0, z: 0 };
    const d = { x: 1, z: 1 };
    expect(segmentIntersectsRect(c, d, r)).toBe(segmentIntersectsRect(d, c, r));
  });
});

describe('resolveMove — walls', () => {
  it('moves freely inside a room', () => {
    near(resolveMove({ x: 5, z: 5 }, { x: 1, z: -2 }, R, ONE_ROOM), 6, 3, 1e-9);
    expect(resolveMove({ x: 5, z: 5 }, { x: 0, z: 0 }, R, ONE_ROOM)).toEqual({ x: 5, z: 5 });
  });

  it('stops one radius short of a wall', () => {
    near(resolveMove({ x: 5, z: 5 }, { x: 10, z: 0 }, R, ONE_ROOM), 10 - R, 5);
    near(resolveMove({ x: 5, z: 5 }, { x: -10, z: 0 }, R, ONE_ROOM), R, 5);
    near(resolveMove({ x: 5, z: 5 }, { x: 0, z: 10 }, R, ONE_ROOM), 5, 10 - R);
  });

  it('slides along a wall when moving diagonally into it', () => {
    const end = resolveMove({ x: 8.5, z: 5 }, { x: 3, z: 3 }, R, ONE_ROOM);
    near(end, 10 - R, 8);
    const end2 = resolveMove({ x: 5, z: 9.5 }, { x: -4, z: 2 }, R, ONE_ROOM);
    near(end2, 1, 10 - R);
  });

  it('never ends outside the room, whatever the step size', () => {
    for (const delta of [
      { x: 50, z: 0.3 },
      { x: -0.01, z: -7 },
      { x: 0.2, z: 0.2 },
      { x: 6, z: -6 },
    ]) {
      const end = resolveMove({ x: 5, z: 5 }, delta, R, ONE_ROOM);
      expect(pointInRect(end, BOX, -R + 1e-9)).toBe(true);
    }
  });

  it('pushes a body that starts inside a wall back into the room', () => {
    const end = resolveMove({ x: 10.1, z: 5 }, { x: 0, z: 0 }, R, ONE_ROOM);
    near(end, 10 - R, 5);
    const end2 = resolveMove({ x: 9.9, z: 9.9 }, { x: 0, z: 0 }, R, ONE_ROOM);
    near(end2, 10 - R, 10 - R);
  });
});

describe('resolveMove — passages', () => {
  const A: Rect = { x0: 0, x1: 10, z0: 0, z1: 10 };
  const B: Rect = { x0: 10.2, x1: 20, z0: 0, z1: 10 };
  const gapDoor: Rect = { x0: 10.1 - 0.45, x1: 10.1 + 0.45, z0: 4, z1: 6 }; // 2 m wide door at z 4..6
  const ctx = (passable: boolean): CollisionContext => ({
    rooms: [room('a', A), room('b', B)],
    passages: [{ rect: gapDoor, passable }],
    obstacles: [],
  });

  it('passes through a passable passage into the next room', () => {
    const end = resolveMove({ x: 9, z: 5 }, { x: 3, z: 0 }, R, ctx(true));
    near(end, 12, 5);
    expect(pointInRect(end, B)).toBe(true);
    const back = resolveMove(end, { x: -3, z: 0 }, R, ctx(true));
    near(back, 9, 5);
  });

  it('is blocked by a non-passable passage', () => {
    const end = resolveMove({ x: 9, z: 5 }, { x: 3, z: 0 }, R, ctx(false));
    near(end, 10 - R, 5);
    expect(pointInRect(end, A)).toBe(true);
  });

  it('is blocked by the wall beside the opening even when the passage is passable', () => {
    const end = resolveMove({ x: 9, z: 8 }, { x: 3, z: 0 }, R, ctx(true));
    near(end, 10 - R, 8);
  });

  it('keeps a body inside the opening while it is in the wall gap', () => {
    // starting in the gap and pushing sideways: must not slip into the wall beside the door
    const end = resolveMove({ x: 10.1, z: 5 }, { x: 0, z: 3 }, R, ctx(true));
    expect(end.z).toBeLessThanOrEqual(6 + 1e-6);
    expect(end.x).toBeCloseTo(10.1, 6);
  });

  it('a passable passage can be declared with an explicit travel axis', () => {
    const p: PassageDef = { rect: gapDoor, passable: true, along: 'x' };
    const end = resolveMove({ x: 9, z: 5 }, { x: 3, z: 0 }, R, { rooms: [room('a', A), room('b', B)], passages: [p], obstacles: [] });
    near(end, 12, 5);
  });
});

describe('resolveMove — obstacles', () => {
  const ob: Rect = { x0: 4, x1: 6, z0: 4, z1: 6 };
  const ctx: CollisionContext = { rooms: [room('a', BOX)], passages: [], obstacles: [ob] };

  it('blocks head-on movement one radius short of the prop', () => {
    near(resolveMove({ x: 2, z: 5 }, { x: 6, z: 0 }, R, ctx), 4 - R, 5);
    near(resolveMove({ x: 5, z: 8 }, { x: 0, z: -6 }, R, ctx), 5, 6 + R);
  });

  it('lets a body pass beside the prop', () => {
    near(resolveMove({ x: 2, z: 3.5 }, { x: 6, z: 0 }, R, ctx), 8, 3.5, 1e-6);
  });

  it('slides along the prop face and around its corner', () => {
    const start = { x: 3.0, z: 4.5 };
    const end = resolveMove(start, { x: 6, z: 2 }, R, ctx);
    expect(circleOverlapsRect(end, R, ob)).toBe(false);
    expect(end.z).toBeGreaterThan(5.5); // slid north along the west face
    expect(end.x).toBeGreaterThanOrEqual(4 - R - 1e-6);
    expect(end.x).toBeGreaterThan(start.x);
  });

  it('small props (buckets, stools) are stepped around with half the body radius', () => {
    const small: Rect = { x0: 4, x1: 4.5, z0: 4, z1: 4.5 };
    const end = resolveMove({ x: 3, z: 4.25 }, { x: 3, z: 0 }, R, { rooms: [room('a', BOX)], passages: [], obstacles: [small] });
    near(end, 4 - R * 0.5, 4.25);
  });

  it('frees a body that starts inside a prop instead of trapping it', () => {
    const end = resolveMove({ x: 5, z: 5 }, { x: 0, z: 0 }, R, ctx);
    expect(circleOverlapsRect(end, R, ob)).toBe(false);
    const moved = resolveMove({ x: 5, z: 5 }, { x: 0, z: 2 }, R, ctx);
    expect(circleOverlapsRect(moved, R, ob)).toBe(false);
    expect(pointInRect(moved, BOX, -R + 1e-9)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Against the real hospital layout
// ---------------------------------------------------------------------------

describe('resolveMove — hospital layout', () => {
  /** Passages for a character from the layout's initial access lists (no director changes). */
  function passagesFor(c: CharacterId): PassageDef[] {
    return DOORS.map((d) => ({
      rect: doorPassage(d),
      passable: !d.locked && (d.access === 'all' || (Array.isArray(d.access) && d.access.includes(c))),
    }));
  }
  const ctxFor = (c: CharacterId, obstacles: Rect[] = []): CollisionContext => ({ rooms: ROOMS, passages: passagesFor(c), obstacles });

  it('Susie walks from the hallway into Exam 3 through its door', () => {
    const end = resolveMove({ x: -7.7, z: 0.5 }, { x: 0, z: 2.5 }, R, ctxFor('susie'));
    near(end, -7.7, 3.0, 1e-6);
    expect(roomAt(end)).toBe('exam3');
  });

  it('John is stopped at the staff passage door he cannot use', () => {
    const end = resolveMove({ x: -10.5, z: 0.5 }, { x: 0, z: 2 }, R, ctxFor('john'));
    expect(end.z).toBeLessThanOrEqual(ROOM_BY_ID.corridor.bounds.z1 - R + 1e-6);
    expect(end.z).toBeGreaterThan(1.0);
    expect(end.x).toBeCloseTo(-10.5, 6);
    expect(roomAt(end)).toBe('corridor');
  });

  it('John passes the restroom door (public) but not Exam 3 (staff) at shift start', () => {
    const wc = resolveMove({ x: 13.1, z: -0.5 }, { x: 0, z: -2.5 }, R, ctxFor('john'));
    expect(roomAt(wc)).toBe('restroom');
    const exam = resolveMove({ x: -7.7, z: 0.5 }, { x: 0, z: 2.5 }, R, ctxFor('john'));
    expect(roomAt(exam)).toBe('corridor');
    expect(exam.z).toBeLessThanOrEqual(1.4 - R + 1e-6);
  });

  it('nobody walks through the wall between two exam rooms', () => {
    const end = resolveMove({ x: -9.0, z: 3.6 }, { x: -3, z: 0 }, R, ctxFor('susie'));
    expect(roomAt(end)).toBe('exam3');
    expect(end.x).toBeGreaterThanOrEqual(ROOM_BY_ID.exam3.bounds.x0 + R - 1e-6);
  });

  it('a body walking the full corridor stays inside it and slides along its walls', () => {
    const end = resolveMove({ x: -18, z: 0 }, { x: 36, z: 5 }, R, ctxFor('john'));
    expect(roomAt(end)).toBe('corridor');
    expect(end.z).toBeCloseTo(1.4 - R, 2);
    expect(end.x).toBeGreaterThan(17);
  });

  it("John's spawn sits in a chair row; with that prop solid he is nudged into the aisle, not trapped", () => {
    const chairs = PROPS.find((p) => p.id === 'wait_chairs_2')!;
    const aabb = footprintAABB(chairs)!;
    expect(pointInRect({ x: SPAWN.john.pos.x, z: SPAWN.john.pos.z }, aabb)).toBe(true);
    const end = resolveMove({ x: SPAWN.john.pos.x, z: SPAWN.john.pos.z }, { x: 0, z: 0 }, R, ctxFor('john', [aabb]));
    expect(circleOverlapsRect(end, R, aabb)).toBe(false);
    expect(roomAt(end)).toBe('waiting');
    // rows face the TV (south), so the free side is in front of the seats
    expect(end.z).toBeLessThan(aabb.z0);
    // and from there he can walk along the aisle toward the vending machines
    const walk = resolveMove(end, { x: 1.5, z: 0 }, R, ctxFor('john', [aabb]));
    expect(roomAt(walk)).toBe('waiting');
    expect(walk.x).toBeGreaterThan(end.x);
  });
});
