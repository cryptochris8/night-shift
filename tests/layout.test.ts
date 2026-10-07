import { describe, expect, it } from 'vitest';
import {
  CAMERAS,
  DOORS,
  DOOR_BY_ID,
  LAYOUT,
  LIGHTS,
  POINTS,
  PROPS,
  ROOMS,
  ROOM_BY_ID,
  SPAWN,
  WALL,
  WAYPOINTS,
  buildWaypoints,
  doorPassage,
  doorsOfRoom,
  forwardFromYaw,
  rectContains,
  roomAt,
  roomCenter,
} from '../src/world/layout';
import { CHARACTER_IDS, type CharacterId, type DoorDef, type PropDef, type Rect, type RoomId, type Vec2 } from '../src/core/types';

const EPS = 1e-6;
/** Player capsule radius (CONTRACT §4E). */
const BODY_RADIUS = 0.3;
/** Shoulder clearance the collision module keeps from door jambs (radius × 0.5). */
const JAMB_CLEARANCE = BODY_RADIUS * 0.5;
/** Placement slack allowed for props/lights whose origin sits on a wall surface. */
const SLACK = 0.3;

const fmt = (n: number): string => n.toFixed(2);
const fmtRect = (r: Rect): string => `x[${fmt(r.x0)}, ${fmt(r.x1)}] z[${fmt(r.z0)}, ${fmt(r.z1)}]`;

function rectsOverlap(a: Rect, b: Rect, tol = 0): boolean {
  return a.x0 < b.x1 - tol && a.x1 > b.x0 + tol && a.z0 < b.z1 - tol && a.z1 > b.z0 + tol;
}

function rectInside(inner: Rect, outer: Rect, slack = 0): boolean {
  return inner.x0 >= outer.x0 - slack - EPS && inner.x1 <= outer.x1 + slack + EPS && inner.z0 >= outer.z0 - slack - EPS && inner.z1 <= outer.z1 + slack + EPS;
}

/** Axis-aligned footprint of a solid prop, per types.ts: w along local x, d along local z, rotated by rotY. */
function footprintAABB(p: PropDef): Rect | null {
  if (!p.footprint) return null;
  const { w, d } = p.footprint;
  const c = Math.abs(Math.cos(p.rotY));
  const s = Math.abs(Math.sin(p.rotY));
  const hx = (w * c + d * s) / 2;
  const hz = (w * s + d * c) / 2;
  return { x0: p.pos.x - hx, x1: p.pos.x + hx, z0: p.pos.z - hz, z1: p.pos.z + hz };
}

function circleHitsRect(cx: number, cz: number, radius: number, r: Rect): boolean {
  const nx = Math.min(r.x1, Math.max(r.x0, cx));
  const nz = Math.min(r.z1, Math.max(r.z0, cz));
  const dx = cx - nx;
  const dz = cz - nz;
  return dx * dx + dz * dz < radius * radius - EPS;
}

/** The 0.2 m gap a door sits in, derived from its two rooms. */
function doorGap(d: DoorDef): { lo: number; hi: number; perp: number } {
  const a = ROOM_BY_ID[d.a].bounds;
  const b = ROOM_BY_ID[d.b].bounds;
  if (d.axis === 'x') {
    const [south, north] = a.z1 <= b.z0 ? [a, b] : [b, a];
    return { lo: south.z1, hi: north.z0, perp: d.pos.z };
  }
  const [west, east] = a.x1 <= b.x0 ? [a, b] : [b, a];
  return { lo: west.x1, hi: east.x0, perp: d.pos.x };
}

const openingInterval = (d: DoorDef): [number, number] =>
  d.axis === 'x' ? [d.pos.x - d.width / 2, d.pos.x + d.width / 2] : [d.pos.z - d.width / 2, d.pos.z + d.width / 2];

const alongExtent = (r: Rect, axis: 'x' | 'z'): [number, number] => (axis === 'x' ? [r.x0, r.x1] : [r.z0, r.z1]);

const SOLID_PROPS = PROPS.filter((p) => p.solid);
const SOLID_AABBS = SOLID_PROPS.map((p) => ({ prop: p, rect: footprintAABB(p) })).filter((x): x is { prop: PropDef; rect: Rect } => x.rect !== null);

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

describe('rooms', () => {
  it('have unique ids and ROOM_BY_ID indexes every one of them', () => {
    const ids = ROOMS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of ROOMS) expect(ROOM_BY_ID[r.id]).toBe(r);
    expect(Object.keys(ROOM_BY_ID)).toHaveLength(ROOMS.length);
  });

  it('have well-formed bounds and plausible ceilings', () => {
    for (const r of ROOMS) {
      expect(r.bounds.x0, r.id).toBeLessThan(r.bounds.x1);
      expect(r.bounds.z0, r.id).toBeLessThan(r.bounds.z1);
      expect(r.ceiling, r.id).toBeGreaterThanOrEqual(2.2);
      expect(r.name.length, r.id).toBeGreaterThan(0);
      expect(r.shortName.length, r.id).toBeGreaterThan(0);
    }
  });

  it('interiors never overlap', () => {
    for (let i = 0; i < ROOMS.length; i++) {
      for (let j = i + 1; j < ROOMS.length; j++) {
        const a = ROOMS[i];
        const b = ROOMS[j];
        expect(rectsOverlap(a.bounds, b.bounds), `${a.id} ${fmtRect(a.bounds)} overlaps ${b.id} ${fmtRect(b.bounds)}`).toBe(false);
      }
    }
  });

  it('neighbouring rooms are separated by at least one wall thickness', () => {
    for (let i = 0; i < ROOMS.length; i++) {
      for (let j = i + 1; j < ROOMS.length; j++) {
        const a = ROOMS[i].bounds;
        const b = ROOMS[j].bounds;
        const xOverlap = a.x0 < b.x1 && a.x1 > b.x0;
        const zOverlap = a.z0 < b.z1 && a.z1 > b.z0;
        if (xOverlap) {
          const gap = Math.max(a.z0, b.z0) - Math.min(a.z1, b.z1);
          expect(gap, `${ROOMS[i].id} / ${ROOMS[j].id} z-gap`).toBeGreaterThanOrEqual(WALL - EPS);
        }
        if (zOverlap) {
          const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
          expect(gap, `${ROOMS[i].id} / ${ROOMS[j].id} x-gap`).toBeGreaterThanOrEqual(WALL - EPS);
        }
      }
    }
  });

  it('access lists only name real characters, once each', () => {
    for (const r of ROOMS) {
      expect(new Set(r.access).size, r.id).toBe(r.access.length);
      for (const c of r.access) expect(CHARACTER_IDS).toContain(c);
    }
  });

  it('every room has at least one door', () => {
    for (const r of ROOMS) expect(doorsOfRoom(r.id).length, `${r.id} has no door`).toBeGreaterThan(0);
  });

  it('roomCenter lies inside the room', () => {
    for (const r of ROOMS) {
      const c = roomCenter(r);
      expect(rectContains(r.bounds, c)).toBe(true);
      expect(roomAt(c)).toBe(r.id);
    }
  });
});

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

describe('doors', () => {
  it('have unique ids, join two different existing rooms, and DOOR_BY_ID indexes them', () => {
    expect(new Set(DOORS.map((d) => d.id)).size).toBe(DOORS.length);
    for (const d of DOORS) {
      expect(d.a, d.id).not.toBe(d.b);
      expect(ROOM_BY_ID[d.a], `${d.id}: room ${d.a}`).toBeDefined();
      expect(ROOM_BY_ID[d.b], `${d.id}: room ${d.b}`).toBeDefined();
      expect(d.width, d.id).toBeGreaterThan(0);
      expect(DOOR_BY_ID[d.id]).toBe(d);
    }
  });

  it('sit in the 0.2 m gap between their two rooms (pos within 0.1 of the gap centre)', () => {
    for (const d of DOORS) {
      const { lo, hi, perp } = doorGap(d);
      expect(hi - lo, `${d.id}: rooms ${d.a}/${d.b} are not separated by a wall gap along ${d.axis === 'x' ? 'z' : 'x'}`).toBeGreaterThanOrEqual(WALL - EPS);
      expect(hi - lo, `${d.id}: gap suspiciously wide`).toBeLessThanOrEqual(0.5);
      const mid = (lo + hi) / 2;
      expect(Math.abs(perp - mid), `${d.id}: pos ${fmt(perp)} vs gap centre ${fmt(mid)}`).toBeLessThanOrEqual(0.1 + EPS);
      expect(perp).toBeGreaterThanOrEqual(lo - 0.1 - EPS);
      expect(perp).toBeLessThanOrEqual(hi + 0.1 + EPS);
    }
  });

  it('openings fit inside both rooms along the wall axis', () => {
    for (const d of DOORS) {
      const [o0, o1] = openingInterval(d);
      for (const room of [d.a, d.b]) {
        const [r0, r1] = alongExtent(ROOM_BY_ID[room].bounds, d.axis);
        expect(o0, `${d.id}: opening starts outside ${room}`).toBeGreaterThanOrEqual(r0 - EPS);
        expect(o1, `${d.id}: opening ends outside ${room}`).toBeLessThanOrEqual(r1 + EPS);
      }
    }
  });

  it('doorPassage spans the wall gap, is as wide as the door, and intersects both rooms', () => {
    for (const d of DOORS) {
      const p = doorPassage(d);
      const along = d.axis === 'x' ? p.x1 - p.x0 : p.z1 - p.z0;
      const across = d.axis === 'x' ? p.z1 - p.z0 : p.x1 - p.x0;
      expect(along, d.id).toBeCloseTo(d.width, 9);
      expect(across, d.id).toBeCloseTo(WALL + 0.7, 9);
      expect(rectContains(p, d.pos), d.id).toBe(true);
      expect(rectsOverlap(p, ROOM_BY_ID[d.a].bounds), `${d.id}: passage misses ${d.a}`).toBe(true);
      expect(rectsOverlap(p, ROOM_BY_ID[d.b].bounds), `${d.id}: passage misses ${d.b}`).toBe(true);
      // the passage reaches into each room, but never deeper than the body radius + slack
      const [lo, hi] = [doorGap(d).lo, doorGap(d).hi];
      const [p0, p1] = d.axis === 'x' ? [p.z0, p.z1] : [p.x0, p.x1];
      expect(lo - p0, d.id).toBeGreaterThan(0);
      expect(p1 - hi, d.id).toBeGreaterThan(0);
      expect(lo - p0, d.id).toBeLessThan(0.5);
      expect(p1 - hi, d.id).toBeLessThan(0.5);
    }
  });

  it('openings on the same wall line never overlap', () => {
    for (let i = 0; i < DOORS.length; i++) {
      for (let j = i + 1; j < DOORS.length; j++) {
        const a = DOORS[i];
        const b = DOORS[j];
        if (a.axis !== b.axis) continue;
        const pa = a.axis === 'x' ? a.pos.z : a.pos.x;
        const pb = b.axis === 'x' ? b.pos.z : b.pos.x;
        if (Math.abs(pa - pb) > 0.05) continue;
        const [a0, a1] = openingInterval(a);
        const [b0, b1] = openingInterval(b);
        expect(a0 < b1 && a1 > b0, `${a.id} [${fmt(a0)}, ${fmt(a1)}] overlaps ${b.id} [${fmt(b0)}, ${fmt(b1)}]`).toBe(false);
      }
    }
  });

  it('access lists are well-formed and locked doors are explained by a label or director hook', () => {
    for (const d of DOORS) {
      if (Array.isArray(d.access)) {
        expect(d.access.length, `${d.id}: empty access array — use 'none'`).toBeGreaterThan(0);
        expect(new Set(d.access).size, d.id).toBe(d.access.length);
        for (const c of d.access) expect(CHARACTER_IDS).toContain(c);
      } else {
        expect(['all', 'none']).toContain(d.access);
      }
      if (d.kind === 'open') expect(d.locked ?? false, `${d.id}: an open archway cannot be locked`).toBe(false);
    }
  });

  it('story-critical doors exist with the expected initial gating', () => {
    expect(DOOR_BY_ID.d_triage.access).toEqual(['susie', 'paul']);
    expect(DOOR_BY_ID.d_exam3.access).toEqual(['susie', 'paul']);
    expect(DOOR_BY_ID.d_closed_wing.locked).toBe(true);
    expect(DOOR_BY_ID.d_closed_wing.access).toEqual(['paul']);
    expect(DOOR_BY_ID.d_waiting.access).toBe('all');
    expect(DOOR_BY_ID.d_restroom.access).toBe('all');
    expect(DOOR_BY_ID.d_entrance.locked).toBe(true);
    expect(DOOR_BY_ID.d_elevator.kind).toBe('elevator');
    expect(DOOR_BY_ID.d_ambulance.afterBlackout).toBe('locked');
    expect(DOOR_BY_ID.d_staff_pass.afterBlackout).toBe('locked');
    expect(DOOR_BY_ID.d_med.afterBlackout).toBe('unlocked');
    expect(DOOR_BY_ID.d_supply.afterBlackout).toBe('unlocked');
  });

  it('every badge door has a badge reader prop and every reader points at a badge door', () => {
    const readers = PROPS.filter((p) => p.type === 'badge_reader');
    for (const r of readers) {
      const doorId = r.params?.door;
      expect(typeof doorId, `${r.id}: params.door`).toBe('string');
      const door = DOOR_BY_ID[doorId as string];
      expect(door, `${r.id}: unknown door ${String(doorId)}`).toBeDefined();
      expect(door.badge, `${r.id}: ${door.id} is not a badge door`).toBe(true);
    }
    const badgeDoors = DOORS.filter((d) => d.badge);
    const missing = badgeDoors.filter((d) => !readers.some((r) => r.params?.door === d.id)).map((d) => d.id);
    expect(missing, `badge doors without a badge_reader prop: ${missing.join(', ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

describe('lights', () => {
  it('have unique ids', () => {
    const counts = new Map<string, number>();
    for (const l of LIGHTS) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
    const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`);
    expect(dupes, `duplicate fixture ids: ${dupes.join(', ')}`).toEqual([]);
  });

  it('sit inside their room and below its ceiling', () => {
    for (const l of LIGHTS) {
      const room = ROOM_BY_ID[l.room];
      expect(room, `${l.id}: room ${l.room}`).toBeDefined();
      expect(rectContains(room.bounds, l.pos, SLACK), `${l.id} at (${fmt(l.pos.x)}, ${fmt(l.pos.z)}) is outside ${l.room} ${fmtRect(room.bounds)}`).toBe(true);
      expect(l.pos.y, `${l.id}: y`).toBeGreaterThan(0);
      if (!room.noCeiling) expect(l.pos.y, `${l.id}: y ${fmt(l.pos.y)} above ceiling ${fmt(room.ceiling)} of ${l.room}`).toBeLessThanOrEqual(room.ceiling + EPS);
    }
  });

  it('every main/emergency fixture belongs to a breaker zone', () => {
    for (const l of LIGHTS) {
      if (l.circuit === 'main' || l.circuit === 'emergency') expect(l.zone, `${l.id} (${l.circuit}) has no zone`).toBeDefined();
    }
  });

  it('room lit/emergency flags are backed by fixtures', () => {
    const working = new Set(['fluorescent', 'strip', 'can', 'sodium', 'lamp', 'desk']);
    for (const r of ROOMS) {
      const fx = LIGHTS.filter((l) => l.room === r.id);
      if (r.lit) {
        expect(
          fx.some((l) => working.has(l.kind) && (l.circuit === 'main' || l.circuit === 'always')),
          `${r.id} is lit but has no working main fixture`,
        ).toBe(true);
      }
      if (r.emergency) {
        expect(fx.some((l) => l.circuit === 'emergency' || l.circuit === 'always'), `${r.id} is flagged emergency but has no emergency-circuit fixture`).toBe(true);
      }
    }
  });

  it('the corridor is lit on both breaker halves and the exit signs are battery backed', () => {
    const corridor = LIGHTS.filter((l) => l.room === 'corridor' && l.kind === 'fluorescent');
    expect(corridor.filter((l) => l.zone === 'corridor_w' && l.pos.x < 0).length).toBeGreaterThanOrEqual(4);
    expect(corridor.filter((l) => l.zone === 'corridor_e' && l.pos.x > 0).length).toBeGreaterThanOrEqual(4);
    for (const l of LIGHTS.filter((x) => x.kind === 'exit')) expect(l.circuit, l.id).toBe('always');
  });
});

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

describe('props', () => {
  it('have unique ids and reference existing rooms', () => {
    expect(new Set(PROPS.map((p) => p.id)).size).toBe(PROPS.length);
    for (const p of PROPS) expect(ROOM_BY_ID[p.room], `${p.id}: room ${p.room}`).toBeDefined();
  });

  it('every prop origin lies inside its room (±0.3 m)', () => {
    for (const p of PROPS) {
      const b = ROOM_BY_ID[p.room].bounds;
      expect(rectContains(b, p.pos, SLACK), `${p.id} at (${fmt(p.pos.x)}, ${fmt(p.pos.z)}) is outside ${p.room} ${fmtRect(b)}`).toBe(true);
    }
  });

  it('corridor-mounted exam props (call lights, room numbers) lie inside the corridor', () => {
    const corridor = ROOM_BY_ID.corridor.bounds;
    const mounted = PROPS.filter((p) => /^exam\d_(call|sign)$/.test(p.id));
    expect(mounted.length).toBe(10);
    for (const p of mounted) {
      expect(p.room, p.id).toBe('corridor');
      expect(rectContains(corridor, p.pos, SLACK), `${p.id} at (${fmt(p.pos.x)}, ${fmt(p.pos.z)})`).toBe(true);
      expect(p.pos.z).toBeGreaterThan(0); // on the north (exam) wall
    }
    for (const room of ['exam1', 'exam2', 'exam3', 'exam4', 'exam5']) {
      const call = PROPS.find((p) => p.type === 'call_light' && p.params?.room === room);
      expect(call, `no call light for ${room}`).toBeDefined();
    }
  });

  it('every solid prop declares a footprint', () => {
    for (const p of SOLID_PROPS) {
      expect(p.footprint, `${p.id} is solid without a footprint`).toBeDefined();
      expect(p.footprint!.w).toBeGreaterThan(0);
      expect(p.footprint!.d).toBeGreaterThan(0);
    }
  });

  it('solid footprints (rotated AABB) stay inside their room (±0.3 m)', () => {
    const offenders: string[] = [];
    for (const { prop, rect } of SOLID_AABBS) {
      const b = ROOM_BY_ID[prop.room].bounds;
      if (!rectInside(rect, b, SLACK)) offenders.push(`${prop.id} (rotY ${fmt(prop.rotY)}, w ${prop.footprint!.w} d ${prop.footprint!.d}) → ${fmtRect(rect)} vs ${prop.room} ${fmtRect(b)}`);
    }
    expect(offenders, `solid footprints poking through walls:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('solid footprints do not overlap each other by more than 0.1 m', () => {
    const offenders: string[] = [];
    for (let i = 0; i < SOLID_AABBS.length; i++) {
      for (let j = i + 1; j < SOLID_AABBS.length; j++) {
        const a = SOLID_AABBS[i];
        const b = SOLID_AABBS[j];
        if (rectsOverlap(a.rect, b.rect, 0.1)) offenders.push(`${a.prop.id} ${fmtRect(a.rect)} ∩ ${b.prop.id} ${fmtRect(b.rect)}`);
      }
    }
    expect(offenders, `overlapping solid props:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('a body can stand just inside each usable door on both sides without hitting a solid prop', () => {
    const blocked: string[] = [];
    for (const d of DOORS) {
      if (d.access === 'none') continue;
      const [o0, o1] = openingInterval(d);
      const lateral: number[] = [];
      for (let t = o0 + JAMB_CLEARANCE; t <= o1 - JAMB_CLEARANCE + EPS; t += 0.05) lateral.push(t);
      if (lateral.length === 0) lateral.push((o0 + o1) / 2);
      const { lo, hi } = doorGap(d);
      for (const room of [d.a, d.b]) {
        const b = ROOM_BY_ID[room].bounds;
        // the room's edge that touches the gap, stepped one body radius inward
        const edge = d.axis === 'x' ? (Math.abs(b.z1 - lo) < EPS ? b.z1 : b.z0) : Math.abs(b.x1 - lo) < EPS ? b.x1 : b.x0;
        const inward = d.axis === 'x' ? (edge === b.z1 ? -BODY_RADIUS : BODY_RADIUS) : edge === b.x1 ? -BODY_RADIUS : BODY_RADIUS;
        const depth = edge + inward;
        const free = lateral.some((t) => {
          const cx = d.axis === 'x' ? t : depth;
          const cz = d.axis === 'x' ? depth : t;
          return !SOLID_AABBS.some(({ rect }) => circleHitsRect(cx, cz, BODY_RADIUS, rect));
        });
        if (!free) {
          const culprits = SOLID_AABBS.filter(({ rect }) =>
            lateral.some((t) => circleHitsRect(d.axis === 'x' ? t : depth, d.axis === 'x' ? depth : t, BODY_RADIUS, rect)),
          ).map(({ prop, rect }) => `${prop.id} ${fmtRect(rect)}`);
          blocked.push(`${d.id} → ${room} side (${d.axis === 'x' ? 'z' : 'x'} = ${fmt(depth)}): ${culprits.join(', ')}`);
        }
      }
      void hi;
    }
    expect(blocked, `doorways blocked by solid props:\n${blocked.join('\n')}`).toEqual([]);
  });

  it('interactable story props exist where the director expects them', () => {
    const byId = Object.fromEntries(PROPS.map((p) => [p.id, p]));
    for (const id of [
      'wait_vending_0',
      'wait_vending_1',
      'wait_tv',
      'wait_desk',
      'station_terminal_0',
      'station_terminal_1',
      'station_board',
      'lounge_lockers',
      'lounge_coffee',
      'svc_cart',
      'svc_mop',
      'util_radio',
      'util_board',
      'util_locker',
      'elec_panel_zones',
      'gen_unit',
      'gen_fuel',
      'gen_tag',
      'elec_tag',
      'elev_panel',
      'wc_sink',
      'med_cabinet_0',
      'exam3_monitor',
    ]) {
      expect(byId[id], `missing prop ${id}`).toBeDefined();
      expect(byId[id].interactable, `${id} should be interactable`).toBe(true);
    }
    expect(byId.hall_wheelchair.solid).toBe(true);
    expect(byId.ext_ambulance.solid).toBe(true);
    expect(byId.elev_doors.params?.door).toBe('d_elevator');
  });
});

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

describe('cameras', () => {
  it('have unique ids and names', () => {
    expect(new Set(CAMERAS.map((c) => c.id)).size).toBe(CAMERAS.length);
    expect(new Set(CAMERAS.map((c) => c.name)).size).toBe(CAMERAS.length);
    expect(CAMERAS.length).toBe(8);
  });

  it('are mounted high inside their room, looking down into it', () => {
    for (const c of CAMERAS) {
      const room = ROOM_BY_ID[c.room];
      expect(room, `${c.id}: room ${c.room}`).toBeDefined();
      expect(rectContains(room.bounds, c.pos), `${c.id} at (${fmt(c.pos.x)}, ${fmt(c.pos.z)}) is outside ${c.room} ${fmtRect(room.bounds)}`).toBe(true);
      expect(c.pos.y, `${c.id}: mount height`).toBeGreaterThanOrEqual(1.8);
      if (!room.noCeiling) expect(c.pos.y, `${c.id}: above ceiling`).toBeLessThanOrEqual(room.ceiling + EPS);
      expect(c.lookAt.y, `${c.id}: should look downward`).toBeLessThan(c.pos.y);
      expect(Math.hypot(c.lookAt.x - c.pos.x, c.lookAt.z - c.pos.z), `${c.id}: degenerate look direction`).toBeGreaterThan(1);
      expect(c.fov).toBeGreaterThanOrEqual(40);
      expect(c.fov).toBeLessThanOrEqual(90);
      expect(c.zone).toBe('cctv');
    }
  });

  it('some cameras survive the blackout so CCTV stays usable on generator power', () => {
    const survivors = CAMERAS.filter((c) => c.survivesBlackout).map((c) => c.id);
    expect(survivors.length).toBeGreaterThanOrEqual(3);
    expect(survivors).toContain('cam_hall_e');
    expect(survivors).toContain('cam_generator');
    expect(CAMERAS.some((c) => !c.survivesBlackout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawns, points, helpers
// ---------------------------------------------------------------------------

describe('spawns and named points', () => {
  it('roomAt returns the spawn room for every character', () => {
    for (const id of CHARACTER_IDS) {
      const sp = SPAWN[id];
      expect(roomAt(sp.pos), id).toBe(sp.room);
      expect(rectContains(ROOM_BY_ID[sp.room].bounds, sp.pos, -BODY_RADIUS), `${id} spawns too close to a wall`).toBe(true);
    }
  });

  it('spawn facings match their descriptions', () => {
    const john = forwardFromYaw(SPAWN.john.yaw);
    expect(john.x).toBeCloseTo(0, 9);
    expect(john.z).toBeCloseTo(-1, 9); // facing the TV wall (south)
    for (const id of ['susie', 'paul'] as const) {
      const f = forwardFromYaw(SPAWN[id].yaw);
      expect(f.x, `${id} faces east`).toBeCloseTo(1, 9);
      expect(f.z, `${id} faces east`).toBeCloseTo(0, 9);
    }
  });

  it('every named point is inside a room or in a doorway gap', () => {
    for (const [name, p] of Object.entries(POINTS)) {
      const near = ROOMS.some((r) => rectContains(r.bounds, p, 0.2));
      expect(near, `point ${name} (${fmt(p.x)}, ${fmt(p.z)}) is nowhere near a room`).toBe(true);
    }
    expect(roomAt(POINTS.john_seat)).toBe('waiting');
    expect(roomAt(POINTS.exam3_bed)).toBe('exam3');
    expect(roomAt(POINTS.generator_unit)).toBe('generator');
    expect(roomAt(POINTS.station_inside)).toBe('nurse_station');
  });

  it('LAYOUT bundles the shared tables', () => {
    expect(LAYOUT.wallThickness).toBe(WALL);
    expect(LAYOUT.rooms).toBe(ROOMS);
    expect(LAYOUT.doors).toBe(DOORS);
    expect(LAYOUT.lights).toBe(LIGHTS);
    expect(LAYOUT.props).toBe(PROPS);
    expect(LAYOUT.cameras).toBe(CAMERAS);
    expect(LAYOUT.waypoints).toBe(WAYPOINTS);
    expect(LAYOUT.spawn).toBe(SPAWN);
    expect(LAYOUT.points).toBe(POINTS);
  });
});

describe('geometry helpers', () => {
  it('forwardFromYaw follows the three.js convention (yaw 0 → −z)', () => {
    const f0 = forwardFromYaw(0);
    expect(f0.x).toBeCloseTo(0, 12);
    expect(f0.z).toBeCloseTo(-1, 12);
    const fw = forwardFromYaw(-Math.PI / 2);
    expect(fw.x).toBeCloseTo(1, 12);
    expect(fw.z).toBeCloseTo(0, 12);
    const fe = forwardFromYaw(Math.PI / 2);
    expect(fe.x).toBeCloseTo(-1, 12);
    expect(fe.z).toBeCloseTo(0, 12);
    const fb = forwardFromYaw(Math.PI);
    expect(fb.x).toBeCloseTo(0, 12);
    expect(fb.z).toBeCloseTo(1, 12);
    for (let yaw = -7; yaw <= 7; yaw += 0.37) {
      const f = forwardFromYaw(yaw);
      expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 12);
    }
  });

  it('rectContains honours padding (positive and negative)', () => {
    const r: Rect = { x0: 0, x1: 2, z0: 0, z1: 2 };
    expect(rectContains(r, { x: 1, z: 1 })).toBe(true);
    expect(rectContains(r, { x: 2, z: 2 })).toBe(true);
    expect(rectContains(r, { x: 2.1, z: 1 })).toBe(false);
    expect(rectContains(r, { x: 2.1, z: 1 }, 0.2)).toBe(true);
    expect(rectContains(r, { x: 1.9, z: 1 }, -0.2)).toBe(false);
    expect(rectContains(r, { x: 1.7, z: 1 }, -0.2)).toBe(true);
  });

  it('roomAt returns null in wall gaps and outside the building, and accepts a custom room list', () => {
    expect(roomAt({ x: -7.7, z: 1.5 })).toBeNull(); // in the gap under d_exam3
    expect(roomAt({ x: 0, z: 1.5 })).toBeNull();
    expect(roomAt({ x: 0, z: 50 })).toBeNull();
    expect(roomAt({ x: 100, z: 0 })).toBeNull();
    expect(roomAt({ x: 0, z: 0 })).toBe('corridor');
    expect(roomAt({ x: -7.7, z: 3 })).toBe('exam3');
    expect(roomAt({ x: 0, z: 0 }, ROOMS.filter((r) => r.id !== 'corridor'))).toBeNull();
    expect(roomAt({ x: -7.7, z: 3 }, [ROOM_BY_ID.exam3])).toBe('exam3');
  });

  it('doorsOfRoom lists exactly the doors touching a room', () => {
    expect(doorsOfRoom('exam3').map((d) => d.id)).toEqual(['d_exam3']);
    expect(doorsOfRoom('service_n').map((d) => d.id).sort()).toEqual(['d_closed_wing', 'd_electrical', 'd_generator', 'd_pass_service', 'd_service_corner', 'd_utility'].sort());
    expect(doorsOfRoom('exterior').map((d) => d.id).sort()).toEqual(['d_ambulance', 'd_entrance']);
  });
});

// ---------------------------------------------------------------------------
// Waypoint graph
// ---------------------------------------------------------------------------

const NODE_BY_ID = new Map(WAYPOINTS.map((w) => [w.id, w]));
const DOOR_NODE_RE = /^d_(.+)_([ab])$/;
const doorIdOfNode = (id: string): string | null => DOOR_NODE_RE.exec(id)?.[1] ?? null;

/** BFS over the waypoint graph; `canCross` gates the edge between the two sides of one door. */
function reachableFrom(startId: string, canCross: ((door: DoorDef) => boolean) | null): Set<string> {
  const seen = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift()!;
    const node = NODE_BY_ID.get(cur)!;
    for (const next of node.links) {
      if (seen.has(next)) continue;
      const da = doorIdOfNode(cur);
      const db = doorIdOfNode(next);
      if (canCross && da && da === db) {
        const door = DOOR_BY_ID[da];
        if (!door || !canCross(door)) continue;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

const roomsReached = (ids: Set<string>): Set<RoomId> => new Set([...ids].map((id) => NODE_BY_ID.get(id)!.room));

function spawnNode(id: CharacterId): string {
  const sp = SPAWN[id];
  let best = '';
  let bd = Infinity;
  for (const w of WAYPOINTS) {
    if (w.room !== sp.room) continue;
    const d = Math.hypot(w.pos.x - sp.pos.x, w.pos.z - sp.pos.z);
    if (d < bd) {
      bd = d;
      best = w.id;
    }
  }
  expect(best, `no waypoint in ${sp.room} for ${id}`).not.toBe('');
  return best;
}

const accessFilter =
  (c: CharacterId, overrides: Partial<Record<string, Partial<DoorDef>>> = {}) =>
  (door: DoorDef): boolean => {
    const d = { ...door, ...(overrides[door.id] ?? {}) };
    if (d.locked) return false;
    if (d.access === 'all') return true;
    if (d.access === 'none') return false;
    return d.access.includes(c);
  };

const roomsAccessibleTo = (c: CharacterId): RoomId[] => ROOMS.filter((r) => r.access.includes(c)).map((r) => r.id);

describe('waypoint graph', () => {
  it('has unique node ids with symmetric links to existing nodes and no self-links', () => {
    expect(new Set(WAYPOINTS.map((w) => w.id)).size).toBe(WAYPOINTS.length);
    for (const w of WAYPOINTS) {
      expect(w.links.length, `${w.id} is isolated`).toBeGreaterThan(0);
      expect(new Set(w.links).size, `${w.id} has duplicate links`).toBe(w.links.length);
      for (const l of w.links) {
        expect(l, `${w.id} links to itself`).not.toBe(w.id);
        const other = NODE_BY_ID.get(l);
        expect(other, `${w.id} links to unknown ${l}`).toBeDefined();
        expect(other!.links, `${l} does not link back to ${w.id}`).toContain(w.id);
      }
    }
  });

  it('labels every node with the room that actually contains it', () => {
    for (const w of WAYPOINTS) expect(roomAt(w.pos), `${w.id} at (${fmt(w.pos.x)}, ${fmt(w.pos.z)}) labelled ${w.room}`).toBe(w.room);
  });

  it('gives every room at least one node and keeps each room internally connected', () => {
    for (const r of ROOMS) {
      const nodes = WAYPOINTS.filter((w) => w.room === r.id);
      expect(nodes.length, `${r.id} has no waypoint`).toBeGreaterThan(0);
      // BFS restricted to this room's nodes
      const inRoom = new Set(nodes.map((n) => n.id));
      const seen = new Set<string>([nodes[0].id]);
      const queue = [nodes[0].id];
      while (queue.length) {
        const cur = queue.shift()!;
        for (const l of NODE_BY_ID.get(cur)!.links) {
          if (inRoom.has(l) && !seen.has(l)) {
            seen.add(l);
            queue.push(l);
          }
        }
      }
      expect(seen.size, `${r.id}'s waypoints are not connected inside the room`).toBe(inRoom.size);
    }
  });

  it('has a node on each side of every door, placed in the right room and linked across the door', () => {
    for (const d of DOORS) {
      const a = NODE_BY_ID.get(`d_${d.id}_a`);
      const b = NODE_BY_ID.get(`d_${d.id}_b`);
      expect(a, `missing node d_${d.id}_a`).toBeDefined();
      expect(b, `missing node d_${d.id}_b`).toBeDefined();
      expect(a!.room, `${d.id} side a`).toBe(d.a);
      expect(b!.room, `${d.id} side b`).toBe(d.b);
      expect(rectContains(ROOM_BY_ID[d.a].bounds, a!.pos, 0.01), `${d.id}: node a not inside ${d.a}`).toBe(true);
      expect(rectContains(ROOM_BY_ID[d.b].bounds, b!.pos, 0.01), `${d.id}: node b not inside ${d.b}`).toBe(true);
      expect(a!.links).toContain(b!.id);
      // each side also connects onward into its own room
      expect(a!.links.some((l) => NODE_BY_ID.get(l)!.room === d.a), `${d.id}: side a dead-ends`).toBe(true);
      expect(b!.links.some((l) => NODE_BY_ID.get(l)!.room === d.b), `${d.id}: side b dead-ends`).toBe(true);
      // the door crossing is the only edge that leaves a room
      for (const w of WAYPOINTS) {
        for (const l of w.links) {
          const other = NODE_BY_ID.get(l)!;
          if (other.room !== w.room) {
            const da = doorIdOfNode(w.id);
            expect(da && da === doorIdOfNode(l), `${w.id} (${w.room}) → ${l} (${other.room}) crosses rooms without a door`).toBeTruthy();
          }
        }
      }
    }
  });

  it('door node ids parse back to real doors', () => {
    for (const w of WAYPOINTS) {
      const doorId = doorIdOfNode(w.id);
      if (doorId) expect(DOOR_BY_ID[doorId], `${w.id} names unknown door ${doorId}`).toBeDefined();
    }
  });

  it('is one connected component when doors are ignored', () => {
    const all = reachableFrom(WAYPOINTS[0].id, null);
    expect(all.size).toBe(WAYPOINTS.length);
    for (const id of CHARACTER_IDS) {
      const rooms = roomsReached(reachableFrom(spawnNode(id), null));
      for (const r of ROOMS) expect(rooms.has(r.id), `${id} cannot reach ${r.id} even ignoring access`).toBe(true);
    }
  });

  it('buildWaypoints is deterministic', () => {
    const again = buildWaypoints(ROOMS, DOORS);
    expect(again).toEqual(WAYPOINTS);
    expect(again).not.toBe(WAYPOINTS);
  });

  describe('reachability under door access', () => {
    it('John starts confined to the public rooms', () => {
      const rooms = roomsReached(reachableFrom(spawnNode('john'), accessFilter('john')));
      for (const r of ['waiting', 'corridor', 'restroom'] as RoomId[]) expect(rooms.has(r), `john should reach ${r}`).toBe(true);
      for (const r of ['closed_wing', 'nurse_station', 'service_n', 'service_e', 'med_room', 'exterior', 'elevator', 'imaging', 'triage', 'exam3', 'supply', 'break_room'] as RoomId[]) {
        expect(rooms.has(r), `john should NOT reach ${r} before the director opens doors`).toBe(false);
      }
    });

    it('John reaches triage and Exam 3 once the director widens those doors', () => {
      const widened = accessFilter('john', { d_triage: { access: 'all' }, d_exam3: { access: 'all' } });
      const rooms = roomsReached(reachableFrom(spawnNode('john'), widened));
      expect(rooms.has('triage')).toBe(true);
      expect(rooms.has('exam3')).toBe(true);
      expect(rooms.has('closed_wing')).toBe(false);
      expect(rooms.has('nurse_station')).toBe(false);
    });

    it('Susie reaches every room on her access list, and nothing reserved for Paul', () => {
      const rooms = roomsReached(reachableFrom(spawnNode('susie'), accessFilter('susie')));
      for (const r of roomsAccessibleTo('susie')) expect(rooms.has(r), `susie should reach ${r}`).toBe(true);
      expect(rooms.has('exterior'), 'susie badges in through the ambulance doors').toBe(true);
      for (const r of ['closed_wing', 'utility', 'electrical', 'generator', 'imaging', 'elevator'] as RoomId[]) {
        expect(rooms.has(r), `susie should NOT reach ${r}`).toBe(false);
      }
    });

    it('Paul reaches every room on his access list except the locked west wing', () => {
      const rooms = roomsReached(reachableFrom(spawnNode('paul'), accessFilter('paul')));
      for (const r of roomsAccessibleTo('paul')) {
        if (r === 'closed_wing') continue;
        expect(rooms.has(r), `paul should reach ${r}`).toBe(true);
      }
      expect(rooms.has('closed_wing'), 'the west wing door is locked at shift start').toBe(false);
      expect(rooms.has('med_room'), 'the med room is Susie-only').toBe(false);
      expect(rooms.has('imaging')).toBe(false);
    });

    it('Paul can enter the west wing once the director unlocks it', () => {
      const unlocked = accessFilter('paul', { d_closed_wing: { locked: false } });
      const rooms = roomsReached(reachableFrom(spawnNode('paul'), unlocked));
      expect(rooms.has('closed_wing')).toBe(true);
    });

    it("locked doors stay shut even for characters on the door's access list", () => {
      for (const d of DOORS.filter((x) => x.locked)) {
        for (const c of CHARACTER_IDS) expect(accessFilter(c)(d), `${c} through locked ${d.id}`).toBe(false);
      }
    });
  });
});
