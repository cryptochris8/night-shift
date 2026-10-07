import { describe, expect, it } from 'vitest';
import { LAYOUT, ROOM_BY_ID } from '../src/world/layout';
import { buildOpenings, neighboursAcross, visibleRooms } from '../src/world/visibility';

const openings = buildOpenings(LAYOUT.rooms, LAYOUT.doors);
const closed = () => false;
const openOnly = (...ids: string[]) => (id: string) => ids.includes(id);

describe('neighboursAcross (glass sides)', () => {
  it('finds the ambulance bay beyond the west glass of the waiting room and corridor', () => {
    expect(neighboursAcross(ROOM_BY_ID.waiting, 'w', LAYOUT.rooms).map((r) => r.id)).toEqual(['exterior']);
    expect(neighboursAcross(ROOM_BY_ID.corridor, 'w', LAYOUT.rooms).map((r) => r.id)).toEqual(['exterior']);
  });
  it("finds the corridor beyond imaging's window", () => {
    expect(neighboursAcross(ROOM_BY_ID.imaging, 's', LAYOUT.rooms).map((r) => r.id)).toEqual(['corridor']);
  });
});

describe('visibleRooms', () => {
  it('a room with its only door shut sees nothing else', () => {
    expect([...visibleRooms('exam3', openings, closed)]).toEqual(['exam3']);
    expect([...visibleRooms('generator', openings, closed)]).toEqual(['generator']);
  });

  it('opening a door reveals the room behind it (and onward)', () => {
    const v = visibleRooms('exam3', openings, openOnly('d_exam3'));
    expect(v.has('corridor')).toBe(true);
    expect(v.has('waiting')).toBe(true); // corridor → archway
  });

  it('from the corridor: archways, glass and vision panels are visible, closed solid doors are not', () => {
    const v = visibleRooms('corridor', openings, closed);
    for (const r of ['waiting', 'nurse_station', 'exterior', 'triage', 'staff_pass', 'imaging', 'service_e'] as const) {
      expect(v.has(r), r).toBe(true);
    }
    for (const r of ['exam1', 'exam2', 'exam3', 'exam4', 'exam5', 'med_room', 'break_room', 'supply', 'restroom', 'generator', 'electrical', 'utility', 'closed_wing'] as const) {
      expect(v.has(r), r).toBe(false);
    }
  });

  it('a vision panel shows the next room but not the rooms beyond it', () => {
    const v = visibleRooms('corridor', openings, closed);
    // service_e is glimpsed through d_service's window; the service hall around the corner is not
    expect(v.has('service_e')).toBe(true);
    expect(v.has('service_n')).toBe(false);
    // open the door and the corner opens up
    expect(visibleRooms('corridor', openings, openOnly('d_service')).has('service_n')).toBe(true);
  });

  it('respects the depth limit', () => {
    const v1 = visibleRooms('waiting', openings, closed, 1);
    expect(v1.has('corridor')).toBe(true);
    expect(v1.has('nurse_station')).toBe(false);
    expect(visibleRooms('waiting', openings, closed, 2).has('nurse_station')).toBe(true);
  });

  it('is symmetric for a pair of rooms joined by an archway', () => {
    expect(visibleRooms('waiting', openings, closed).has('corridor')).toBe(true);
    expect(visibleRooms('corridor', openings, closed).has('waiting')).toBe(true);
  });
});
