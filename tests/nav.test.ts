import { describe, expect, it } from 'vitest';
import { NavGraph, doorIdOfNode } from '../src/characters/nav';
import { DOORS, DOOR_BY_ID, ROOM_BY_ID, SPAWN, WAYPOINTS, doorPassage, rectContains, roomAt } from '../src/world/layout';
import type { CharacterId, DoorDef, Vec2 } from '../src/core/types';

const nav = new NavGraph(WAYPOINTS);
const allDoors = (): boolean => true;
const noDoors = (): boolean => false;

/** Door gating a character would get from the layout's initial access lists. */
const canUse =
  (c: CharacterId, overrides: Record<string, Partial<DoorDef>> = {}) =>
  (doorId: string): boolean => {
    const d = { ...DOOR_BY_ID[doorId], ...(overrides[doorId] ?? {}) };
    if (!DOOR_BY_ID[doorId]) return false;
    if (d.locked) return false;
    if (d.access === 'all') return true;
    if (d.access === 'none') return false;
    return d.access.includes(c);
  };

const v2 = (p: { x: number; z: number }): Vec2 => ({ x: p.x, z: p.z });

/** Every point of a path must be inside a room or inside a door passage (never inside a wall). */
function expectPathAvoidsWalls(path: Vec2[]): void {
  for (const p of path) {
    const ok = roomAt(p) !== null || DOORS.some((d) => rectContains(doorPassage(d), p, 0.1));
    expect(ok, `path point (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is inside a wall`).toBe(true);
  }
}

describe('doorIdOfNode', () => {
  it('extracts the door id from door waypoints and ignores everything else', () => {
    expect(doorIdOfNode('d_d_exam3_a')).toBe('d_exam3');
    expect(doorIdOfNode('d_d_waiting_b')).toBe('d_waiting');
    expect(doorIdOfNode('d_d_closed_wing_a')).toBe('d_closed_wing');
    expect(doorIdOfNode('c_3')).toBeNull();
    expect(doorIdOfNode('r_exam3')).toBeNull();
    expect(doorIdOfNode('s_0')).toBeNull();
    expect(doorIdOfNode('d_x')).toBeNull();
  });

  it('agrees with the layout for every door node', () => {
    for (const d of DOORS) {
      expect(doorIdOfNode(`d_${d.id}_a`)).toBe(d.id);
      expect(doorIdOfNode(`d_${d.id}_b`)).toBe(d.id);
    }
  });
});

describe('NavGraph basics', () => {
  it('indexes every waypoint', () => {
    expect(nav.all()).toHaveLength(WAYPOINTS.length);
    for (const w of WAYPOINTS) expect(nav.get(w.id)).toBe(w);
    expect(nav.get('nope')).toBeUndefined();
  });

  it('nearest() finds the closest node, optionally within a room', () => {
    const n = nav.nearest({ x: 1.0, z: -0.05 });
    expect(n?.id).toBe('c_10'); // spine nodes every 2 m from x = -19: c_10 sits at (1, 0)
    expect(n?.pos).toEqual({ x: 1, z: 0 });
    const inExam3 = nav.nearest({ x: 0, z: 0 }, 'exam3');
    expect(inExam3?.room).toBe('exam3');
    expect(nav.nearest({ x: 0, z: 0 }, 'exterior')?.room).toBe('exterior');
    expect(new NavGraph([]).nearest({ x: 0, z: 0 })).toBeNull();
  });

  it('an empty graph degrades to a straight line', () => {
    expect(new NavGraph([]).path({ x: 0, z: 0 }, { x: 3, z: 4 })).toEqual([
      { x: 0, z: 0 },
      { x: 3, z: 4 },
    ]);
  });
});

describe('NavGraph.path', () => {
  it('starts at from and ends at to, and returns copies', () => {
    const from = { x: -18, z: 0 };
    const to = { x: 18, z: 0 };
    const path = nav.path(from, to, allDoors);
    expect(path[0]).toEqual(from);
    expect(path[0]).not.toBe(from);
    expect(path[path.length - 1]).toEqual(to);
    expect(path[path.length - 1]).not.toBe(to);
  });

  it('between two corridor points is monotonic along x and stays in the corridor', () => {
    const path = nav.path({ x: -18, z: 0 }, { x: 18, z: 0 }, allDoors);
    expect(path.length).toBeGreaterThan(5);
    for (let i = 1; i < path.length; i++) expect(path[i].x, `step ${i}`).toBeGreaterThanOrEqual(path[i - 1].x - 1e-9);
    const corridor = ROOM_BY_ID.corridor.bounds;
    for (const p of path) expect(rectContains(corridor, p), `(${p.x}, ${p.z}) left the corridor`).toBe(true);

    const back = nav.path({ x: 18, z: 0 }, { x: -18, z: 0 }, allDoors);
    for (let i = 1; i < back.length; i++) expect(back[i].x).toBeLessThanOrEqual(back[i - 1].x + 1e-9);
  });

  it('short-circuits trips inside one room when both room hints agree', () => {
    const path = nav.path({ x: -18, z: 0 }, { x: 18, z: 0 }, allDoors, 'corridor', 'corridor');
    expect(path).toEqual([
      { x: -18, z: 0 },
      { x: 18, z: 0 },
    ]);
  });

  it('from the waiting room to Exam 3 goes through the d_waiting archway and the d_exam3 door', () => {
    const from = v2(SPAWN.john.pos);
    const to = { x: -7.3, z: 3.0 };
    const ids = nav.pathIds(from, to, allDoors, 'waiting', 'exam3');
    expect(ids).toContain('d_d_waiting_a');
    expect(ids).toContain('d_d_waiting_b');
    expect(ids).toContain('d_d_exam3_a');
    expect(ids).toContain('d_d_exam3_b');
    expect(ids.indexOf('d_d_waiting_a')).toBeLessThan(ids.indexOf('d_d_waiting_b'));
    expect(ids.indexOf('d_d_waiting_b')).toBeLessThan(ids.indexOf('d_d_exam3_a'));
    expect(ids.indexOf('d_d_exam3_a')).toBeLessThan(ids.indexOf('d_d_exam3_b'));
    // no other door is crossed
    const crossed = new Set(ids.map(doorIdOfNode).filter((x): x is string => x !== null));
    expect([...crossed].sort()).toEqual(['d_exam3', 'd_waiting']);

    const path = nav.path(from, to, allDoors, 'waiting', 'exam3');
    expect(path[0]).toEqual(from);
    expect(path[path.length - 1]).toEqual(to);
    expectPathAvoidsWalls(path);
    expect(roomAt(path[path.length - 2])).toBe('exam3');
  });

  it('is unreachable when canUseDoor denies the only door into the room', () => {
    const from = v2(SPAWN.john.pos);
    const to = { x: -7.3, z: 3.0 };
    expect(nav.path(from, to, (id) => id !== 'd_exam3', 'waiting', 'exam3')).toEqual([]);
    expect(nav.pathIds(from, to, (id) => id !== 'd_exam3', 'waiting', 'exam3')).toEqual([]);
    expect(nav.path(from, to, noDoors, 'waiting', 'exam3')).toEqual([]);
  });

  it("respects the layout's access lists: John cannot reach Exam 3 until the director opens the door", () => {
    const from = v2(SPAWN.john.pos);
    const to = { x: -7.3, z: 3.0 };
    expect(nav.path(from, to, canUse('john'), 'waiting', 'exam3')).toEqual([]);
    expect(nav.path(from, to, canUse('susie'), 'waiting', 'exam3').length).toBeGreaterThan(2);
    const opened = nav.pathIds(from, to, canUse('john', { d_exam3: { access: 'all' } }), 'waiting', 'exam3');
    expect(opened).toContain('d_d_exam3_b');
  });

  it('routes around a denied door when another way exists', () => {
    const from = v2(SPAWN.john.pos);
    const to = { x: 0, z: 0 };
    const direct = nav.pathIds(from, to, allDoors, 'waiting', 'corridor');
    expect(direct).toContain('d_d_waiting_b');
    const detour = nav.pathIds(from, to, (id) => id !== 'd_waiting', 'waiting', 'corridor');
    expect(detour.length).toBeGreaterThan(0);
    expect(detour).not.toContain('d_d_waiting_a');
    expect(detour).toContain('d_d_entrance_a');
    expect(detour).toContain('d_d_ambulance_b');
    expect(nav.path(from, to, (id) => id !== 'd_waiting', 'waiting', 'corridor').length).toBeGreaterThan(nav.path(from, to, allDoors, 'waiting', 'corridor').length);
  });

  it('never crosses a door the gate rejects, for any character and destination', () => {
    const targets: { to: Vec2; room: 'exam1' | 'generator' | 'nurse_station' | 'restroom' | 'closed_wing' | 'med_room' }[] = [
      { to: { x: -17.5, z: 3.6 }, room: 'exam1' },
      { to: { x: 14, z: 11, }, room: 'generator' },
      { to: { x: 0, z: -3.6 }, room: 'nurse_station' },
      { to: { x: 13.1, z: -3.3 }, room: 'restroom' },
      { to: { x: -15.7, z: 7 }, room: 'closed_wing' },
      { to: { x: 0.3, z: 3.6 }, room: 'med_room' },
    ];
    for (const c of ['john', 'susie', 'paul'] as const) {
      const gate = canUse(c);
      const from = v2(SPAWN[c].pos);
      for (const { to, room } of targets) {
        const ids = nav.pathIds(from, to, gate, SPAWN[c].room, room);
        for (let i = 1; i < ids.length; i++) {
          const da = doorIdOfNode(ids[i - 1]);
          const db = doorIdOfNode(ids[i]);
          if (da && da === db) expect(gate(da), `${c} crossed ${da} on the way to ${room}`).toBe(true);
        }
      }
    }
  });

  it('Paul can walk from the service hall to the generator and the electrical room', () => {
    const from = v2(SPAWN.paul.pos);
    const gen = nav.pathIds(from, { x: 14, z: 11 }, canUse('paul'), 'service_n', 'generator');
    expect(gen).toContain('d_d_generator_a');
    expect(gen).toContain('d_d_generator_b');
    const elec = nav.pathIds(from, { x: 3.7, z: 10.5 }, canUse('paul'), 'service_n', 'electrical');
    expect(elec).toContain('d_d_electrical_b');
    expect(nav.path(from, { x: -15.7, z: 7 }, canUse('paul'), 'service_n', 'closed_wing')).toEqual([]);
    expect(nav.path(from, { x: -15.7, z: 7 }, canUse('paul', { d_closed_wing: { locked: false } }), 'service_n', 'closed_wing').length).toBeGreaterThan(2);
  });

  it('Susie can reach the nurse station from the ambulance entrance through the counter gate', () => {
    const ids = nav.pathIds(v2(SPAWN.susie.pos), { x: 0, z: -3.6 }, canUse('susie'), 'corridor', 'nurse_station');
    expect(ids).toContain('d_d_station_gate_a');
    expect(ids).toContain('d_d_station_gate_b');
    expect(ids).not.toContain('d_d_station_open_a');
  });

  it('pathIds reports only waypoint ids, in path order', () => {
    const from = v2(SPAWN.susie.pos);
    const to = { x: 14, z: 11 };
    const path = nav.path(from, to, allDoors, 'corridor', 'generator');
    const ids = nav.pathIds(from, to, allDoors, 'corridor', 'generator');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(path.length);
    let cursor = 0;
    for (const id of ids) {
      const w = nav.get(id)!;
      const idx = path.findIndex((p, i) => i >= cursor && Math.abs(p.x - w.pos.x) < 1e-9 && Math.abs(p.z - w.pos.z) < 1e-9);
      expect(idx, `${id} is out of order`).toBeGreaterThanOrEqual(cursor);
      cursor = idx;
    }
  });
});
