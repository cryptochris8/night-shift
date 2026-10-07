/**
 * The hospital: one compact emergency wing. All coordinates in metres.
 *   x → east, z → north, y → up.  The main corridor runs east–west along z = 0.
 * Rooms are INTERIOR bounds; the 0.2 m gap between adjacent rooms is the wall.
 *
 *   North (z+)
 *   ┌──────────────────────── utility ─ electrical ─── generator ──────────┐
 *   │  closed_wing ║  service_n  (service hall, z 5.8..8.2)               │ service_e
 *   │   exam1  exam2 ⌶ exam3  exam4  med_room  exam5   imaging            │   ║
 *   ├─────────────────────── corridor (z -1.4..1.4) ──────────────────────┤═══╣ → service door
 *   │ waiting room │ triage │ nurse station │ lounge │ supply │ WC │ elev │
 *   └──────────────┴────────┴───────────────┴────────┴────────┴────┴──────┘
 *   West: exterior / ambulance bay (x < -20)
 */
import type {
  CameraDef,
  CharacterId,
  DoorDef,
  HospitalLayout,
  LightFixtureDef,
  PropDef,
  Rect,
  RoomDef,
  RoomId,
  SpawnDef,
  Vec2,
  Vec3,
  WaypointDef,
  ZoneId,
} from '../core/types';

export const WALL = 0.2;
export const CEIL_CLINICAL = 2.8;
export const CEIL_SERVICE = 2.6;
export const CEIL_WAITING = 3.2;

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({ x0, x1, z0, z1 });

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const ALL: CharacterId[] = ['john', 'susie', 'paul'];
const STAFF: CharacterId[] = ['susie', 'paul'];

export const ROOMS: RoomDef[] = [
  {
    id: 'exterior', name: 'Ambulance Bay', shortName: 'Amb. Bay',
    bounds: r(-34, -20.2, -13, 4), ceiling: 6, floor: 'asphalt', wall: 'concrete',
    access: [], lit: true, emergency: true, outdoor: true, noCeiling: true, tags: ['exterior'],
  },
  {
    id: 'waiting', name: 'Emergency Waiting Room', shortName: 'Waiting',
    bounds: r(-20, -8.2, -10, -1.6), ceiling: CEIL_WAITING, floor: 'vinyl', wall: 'painted',
    sides: { w: { kind: 'glass' } }, wallColor: 0xb9b3a4, floorColor: 0x8f8a80,
    access: ALL, lit: true, emergency: true, tags: ['public'],
  },
  {
    id: 'corridor', name: 'Patient Hallway', shortName: 'Hallway',
    bounds: r(-20, 20, -1.4, 1.4), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    sides: { w: { kind: 'glass' } }, wallColor: 0xc7c2b6, floorColor: 0x9a978f,
    access: ALL, lit: true, emergency: true, tags: ['public', 'clinical'],
  },
  {
    id: 'triage', name: 'Triage', shortName: 'Triage',
    bounds: r(-8, -4.2, -6, -1.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc3cbc6, access: ALL, lit: true, emergency: true, tags: ['clinical'],
  },
  {
    id: 'nurse_station', name: 'Nurse Station', shortName: 'Nurse Stn',
    bounds: r(-4, 4, -5.6, -1.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xbfbcb2, access: STAFF, lit: true, emergency: true, tags: ['clinical'],
  },
  {
    id: 'break_room', name: 'Staff Lounge', shortName: 'Lounge',
    bounds: r(4.2, 8.2, -6, -1.6), ceiling: CEIL_CLINICAL, floor: 'carpet', wall: 'painted',
    wallColor: 0xb5ad9a, access: STAFF, lit: true, emergency: false, tags: ['staff'],
  },
  {
    id: 'supply', name: 'Clean Supply', shortName: 'Supply',
    bounds: r(8.4, 11.4, -6, -1.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc9c9c2, access: STAFF, lit: true, emergency: false, tags: ['staff'],
  },
  {
    id: 'restroom', name: 'Restroom', shortName: 'Restroom',
    bounds: r(11.6, 14.6, -5, -1.6), ceiling: CEIL_CLINICAL, floor: 'tile', wall: 'tile',
    wallColor: 0xd8d6cc, access: ALL, lit: true, emergency: false, tags: ['public'],
  },
  {
    id: 'elevator', name: 'Elevator', shortName: 'Elevator',
    bounds: r(15, 17, -3.2, -1.6), ceiling: 2.4, floor: 'vinyl', wall: 'painted',
    wallColor: 0x8a8d90, access: [], lit: true, emergency: false, tags: ['elevator'],
  },
  // --- north side exam rooms ----------------------------------------------
  {
    id: 'exam1', name: 'Exam 1', shortName: 'Bay 1',
    bounds: r(-19.4, -15.6, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc4ccc4, access: STAFF, lit: true, emergency: false, tags: ['clinical'],
  },
  {
    id: 'exam2', name: 'Exam 2', shortName: 'Bay 2',
    bounds: r(-15.2, -11.4, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc4ccc4, access: STAFF, lit: true, emergency: false, tags: ['clinical'],
  },
  {
    id: 'staff_pass', name: 'Staff Passage', shortName: 'Staff Pass.',
    bounds: r(-11.2, -9.8, 1.6, 5.6), ceiling: CEIL_SERVICE, floor: 'vinyl', wall: 'painted',
    wallColor: 0xb0afa8, access: STAFF, lit: true, emergency: true, tags: ['staff'],
  },
  {
    id: 'exam3', name: 'Exam 3', shortName: 'Bay 3',
    bounds: r(-9.6, -5.8, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc4ccc4, access: ALL, lit: true, emergency: false, tags: ['clinical'],
  },
  {
    id: 'exam4', name: 'Exam 4', shortName: 'Bay 4',
    bounds: r(-5.6, -1.8, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc4ccc4, access: STAFF, lit: true, emergency: false, tags: ['clinical'],
  },
  {
    id: 'med_room', name: 'Medication Room', shortName: 'Med Room',
    bounds: r(-1.6, 2.2, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xd0d4d6, access: ['susie'], lit: true, emergency: true, tags: ['clinical', 'secure'],
  },
  {
    id: 'exam5', name: 'Treatment 1', shortName: 'Treatment',
    bounds: r(2.4, 6.2, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    wallColor: 0xc4ccc4, access: STAFF, lit: true, emergency: false, tags: ['clinical'],
  },
  {
    id: 'imaging', name: 'Imaging (Closed)', shortName: 'Imaging',
    bounds: r(6.4, 13.4, 1.6, 5.6), ceiling: CEIL_CLINICAL, floor: 'vinyl', wall: 'painted',
    sides: { s: { kind: 'glass' } }, wallColor: 0x9ea3a8, access: [], lit: false, emergency: false, tags: ['closed'],
  },
  // --- service areas --------------------------------------------------------
  {
    id: 'service_e', name: 'Service Corridor East', shortName: 'Service E',
    bounds: r(20.2, 22.6, -1.4, 5.6), ceiling: CEIL_SERVICE, floor: 'concrete', wall: 'block',
    wallColor: 0x9c9a92, access: STAFF, lit: true, emergency: true, tags: ['service'],
  },
  {
    id: 'service_n', name: 'Service Corridor', shortName: 'Service Hall',
    bounds: r(-11.2, 22.6, 5.8, 8.2), ceiling: CEIL_SERVICE, floor: 'concrete', wall: 'block',
    wallColor: 0x9c9a92, access: STAFF, lit: true, emergency: true, tags: ['service'],
  },
  {
    id: 'utility', name: 'Environmental Services', shortName: 'EVS Closet',
    bounds: r(-8, -4, 8.4, 11), ceiling: CEIL_SERVICE, floor: 'concrete', wall: 'block',
    wallColor: 0x8f8d86, access: ['paul'], lit: true, emergency: false, tags: ['service'],
  },
  {
    id: 'electrical', name: 'Electrical Room', shortName: 'Electrical',
    bounds: r(2, 6, 8.4, 11.4), ceiling: CEIL_SERVICE, floor: 'concrete', wall: 'block',
    wallColor: 0x8a8880, access: ['paul'], lit: true, emergency: true, tags: ['service'],
  },
  {
    id: 'generator', name: 'Generator Room', shortName: 'Generator',
    bounds: r(10, 18, 8.4, 14), ceiling: 3.4, floor: 'concrete', wall: 'block',
    wallColor: 0x7e7c75, access: ['paul'], lit: true, emergency: true, tags: ['service'],
  },
  {
    id: 'closed_wing', name: 'West Wing (Closed)', shortName: 'West Wing',
    bounds: r(-20, -11.4, 5.8, 8.2), ceiling: CEIL_SERVICE, floor: 'concrete', wall: 'block',
    wallColor: 0x6e6c66, access: ['paul'], lit: false, emergency: false, tags: ['closed'],
  },
];

export const ROOM_BY_ID: Record<RoomId, RoomDef> = Object.fromEntries(ROOMS.map((x) => [x.id, x])) as Record<RoomId, RoomDef>;

// ---------------------------------------------------------------------------
// Doors (pos is the centre of the opening, in the middle of the wall gap)
// ---------------------------------------------------------------------------

export const DOORS: DoorDef[] = [
  // Corridor ↔ exterior (west end)
  { id: 'd_ambulance', a: 'corridor', b: 'exterior', pos: { x: -20.1, z: 0 }, axis: 'z', width: 2.4, kind: 'sliding_glass', access: STAFF, badge: true, label: 'AMBULANCE ENTRANCE — AUTHORIZED PERSONNEL', afterBlackout: 'locked' },
  // Waiting ↔ exterior (main public entrance, locked overnight)
  { id: 'd_entrance', a: 'waiting', b: 'exterior', pos: { x: -20.1, z: -6 }, axis: 'z', width: 2.4, kind: 'sliding_glass', access: 'none', locked: true, label: 'EMERGENCY ENTRANCE — RING FOR ASSISTANCE AFTER 10 PM' },
  // Waiting ↔ corridor (wide archway)
  { id: 'd_waiting', a: 'waiting', b: 'corridor', pos: { x: -14, z: -1.5 }, axis: 'x', width: 3.2, kind: 'open', access: 'all' },
  // South side
  { id: 'd_triage', a: 'corridor', b: 'triage', pos: { x: -6.1, z: -1.5 }, axis: 'x', width: 1.0, kind: 'swing', access: STAFF, label: 'TRIAGE', window: true }, // director widens access to 'all' when John is called
  { id: 'd_station_open', a: 'corridor', b: 'nurse_station', pos: { x: 0, z: -1.5 }, axis: 'x', width: 6.4, kind: 'open', access: 'none' },
  { id: 'd_station_gate', a: 'corridor', b: 'nurse_station', pos: { x: 3.6, z: -1.5 }, axis: 'x', width: 0.7, kind: 'counter_gate', access: STAFF },
  { id: 'd_lounge', a: 'corridor', b: 'break_room', pos: { x: 6.2, z: -1.5 }, axis: 'x', width: 1.0, kind: 'swing', access: STAFF, label: 'STAFF LOUNGE', window: false },
  { id: 'd_supply', a: 'corridor', b: 'supply', pos: { x: 9.9, z: -1.5 }, axis: 'x', width: 1.0, kind: 'service', access: STAFF, badge: true, label: 'CLEAN SUPPLY — STAFF ONLY', afterBlackout: 'unlocked' },
  { id: 'd_restroom', a: 'corridor', b: 'restroom', pos: { x: 13.1, z: -1.5 }, axis: 'x', width: 0.9, kind: 'swing', access: 'all', label: 'RESTROOM' },
  { id: 'd_elevator', a: 'corridor', b: 'elevator', pos: { x: 16, z: -1.5 }, axis: 'x', width: 1.2, kind: 'elevator', access: 'none' },
  // North side
  { id: 'd_exam1', a: 'corridor', b: 'exam1', pos: { x: -17.5, z: 1.5 }, axis: 'x', width: 1.1, kind: 'swing', access: STAFF, label: '1' },
  { id: 'd_exam2', a: 'corridor', b: 'exam2', pos: { x: -13.3, z: 1.5 }, axis: 'x', width: 1.1, kind: 'swing', access: STAFF, label: '2' },
  { id: 'd_staff_pass', a: 'corridor', b: 'staff_pass', pos: { x: -10.5, z: 1.5 }, axis: 'x', width: 1.0, kind: 'service', access: STAFF, badge: true, label: 'STAFF ONLY', window: true, afterBlackout: 'locked' },
  { id: 'd_exam3', a: 'corridor', b: 'exam3', pos: { x: -7.7, z: 1.5 }, axis: 'x', width: 1.1, kind: 'swing', access: STAFF, label: '3' }, // director widens access to 'all' when John is roomed
  { id: 'd_exam4', a: 'corridor', b: 'exam4', pos: { x: -3.7, z: 1.5 }, axis: 'x', width: 1.1, kind: 'swing', access: STAFF, label: '4' },
  { id: 'd_med', a: 'corridor', b: 'med_room', pos: { x: 0.3, z: 1.5 }, axis: 'x', width: 1.0, kind: 'service', access: ['susie'], badge: true, label: 'MEDICATION ROOM — AUTHORIZED PERSONNEL ONLY', afterBlackout: 'unlocked' },
  { id: 'd_exam5', a: 'corridor', b: 'exam5', pos: { x: 4.3, z: 1.5 }, axis: 'x', width: 1.1, kind: 'swing', access: STAFF, label: 'TREATMENT 1' },
  { id: 'd_imaging', a: 'corridor', b: 'imaging', pos: { x: 8, z: 1.5 }, axis: 'x', width: 1.2, kind: 'double', access: 'none', locked: true, label: 'IMAGING — CLOSED', window: true },
  // Corridor east ↔ service
  { id: 'd_service', a: 'corridor', b: 'service_e', pos: { x: 20.1, z: 0 }, axis: 'z', width: 1.0, kind: 'service', access: STAFF, badge: true, label: 'STAFF ONLY — SERVICE', window: true },
  { id: 'd_service_corner', a: 'service_e', b: 'service_n', pos: { x: 21.4, z: 5.7 }, axis: 'x', width: 2.4, kind: 'open', access: 'all' },
  { id: 'd_pass_service', a: 'staff_pass', b: 'service_n', pos: { x: -10.5, z: 5.7 }, axis: 'x', width: 1.4, kind: 'open', access: 'all' },
  // Service rooms
  { id: 'd_utility', a: 'service_n', b: 'utility', pos: { x: -6, z: 8.3 }, axis: 'x', width: 1.0, kind: 'service', access: ['paul'], label: 'ENVIRONMENTAL SERVICES' },
  { id: 'd_electrical', a: 'service_n', b: 'electrical', pos: { x: 4, z: 8.3 }, axis: 'x', width: 1.0, kind: 'service', access: ['paul'], label: 'ELECTRICAL — HIGH VOLTAGE — AUTHORIZED ONLY' },
  { id: 'd_generator', a: 'service_n', b: 'generator', pos: { x: 11, z: 8.3 }, axis: 'x', width: 1.2, kind: 'service', access: ['paul'], label: 'GENERATOR ROOM — HEARING PROTECTION REQUIRED' },
  { id: 'd_closed_wing', a: 'service_n', b: 'closed_wing', pos: { x: -11.3, z: 7 }, axis: 'z', width: 1.8, kind: 'double', access: ['paul'], locked: true, label: 'WEST WING — CLOSED FOR RENOVATION — NO ENTRY' },
];

export const DOOR_BY_ID: Record<string, DoorDef> = Object.fromEntries(DOORS.map((d) => [d.id, d]));

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

const trofferCount: Partial<Record<RoomId, number>> = {};

function troffers(room: RoomId, xs: number[], zs: number[], y: number, zone: ZoneId, opts: Partial<LightFixtureDef> = {}): LightFixtureDef[] {
  const out: LightFixtureDef[] = [];
  // ids continue across calls for the same room (corridor west 0-7, east 8-15)
  let i = trofferCount[room] ?? 0;
  for (const z of zs) for (const x of xs) {
    trofferCount[room] = i + 1;
    out.push({ id: `${room}_fl_${i++}`, room, pos: v3(x, y, z), kind: 'fluorescent', circuit: 'main', zone, size: { w: 1.2, d: 0.6 }, ...opts });
  }
  return out;
}

function strips(room: RoomId, xs: number[], z: number, y: number, zone: ZoneId, opts: Partial<LightFixtureDef> = {}): LightFixtureDef[] {
  return xs.map((x, i) => ({ id: `${room}_strip_${i}`, room, pos: v3(x, y, z), kind: 'strip', circuit: 'main', zone, size: { w: 1.2, d: 0.12 }, ...opts }));
}

export const LIGHTS: LightFixtureDef[] = [
  // Corridor: troffers every 2.5 m. West half = zone corridor_w, east half = corridor_e
  ...troffers('corridor', [-18.75, -16.25, -13.75, -11.25, -8.75, -6.25, -3.75, -1.25], [0], 2.78, 'corridor_w', { rotY: 0 }),
  ...troffers('corridor', [1.25, 3.75, 6.25, 8.75, 11.25, 13.75, 16.25, 18.75], [0], 2.78, 'corridor_e', { rotY: 0 }),
  // Corridor emergency twin-heads (generator) on the north wall
  { id: 'corridor_em_0', room: 'corridor', pos: v3(-15.5, 2.45, 1.3), kind: 'emergency', circuit: 'emergency', zone: 'corridor_w' },
  { id: 'corridor_em_1', room: 'corridor', pos: v3(-6.8, 2.45, 1.3), kind: 'emergency', circuit: 'emergency', zone: 'corridor_w' },
  { id: 'corridor_em_2', room: 'corridor', pos: v3(3.0, 2.45, 1.3), kind: 'emergency', circuit: 'emergency', zone: 'corridor_e' },
  { id: 'corridor_em_3', room: 'corridor', pos: v3(13.0, 2.45, 1.3), kind: 'emergency', circuit: 'emergency', zone: 'corridor_e' },
  // Exit signs (battery)
  { id: 'exit_w', room: 'corridor', pos: v3(-19.6, 2.45, 0), kind: 'exit', circuit: 'always', rotY: Math.PI / 2 },
  { id: 'exit_e', room: 'corridor', pos: v3(19.6, 2.45, 0), kind: 'exit', circuit: 'always', rotY: -Math.PI / 2 },
  { id: 'exit_pass', room: 'corridor', pos: v3(-10.5, 2.45, 1.25), kind: 'exit', circuit: 'always' },
  { id: 'exit_waiting', room: 'waiting', pos: v3(-19.6, 2.6, -6), kind: 'exit', circuit: 'always', rotY: Math.PI / 2 },
  { id: 'exit_service', room: 'service_n', pos: v3(22.3, 2.3, 7), kind: 'exit', circuit: 'always', rotY: -Math.PI / 2 },
  // Waiting room 2x3 grid + emergency + vending glow
  ...troffers('waiting', [-17.5, -14, -10.5], [-8, -4], 3.18, 'public'),
  { id: 'waiting_em', room: 'waiting', pos: v3(-8.4, 2.6, -5.5), kind: 'emergency', circuit: 'emergency', zone: 'public' },
  { id: 'waiting_vend', room: 'waiting', pos: v3(-9.0, 1.2, -9.2), kind: 'vending', circuit: 'main', zone: 'public', color: 0x9fd3ff, intensity: 0.6 },
  // Triage
  ...troffers('triage', [-6.1], [-3.8], 2.78, 'public'),
  { id: 'triage_em', room: 'triage', pos: v3(-4.4, 2.5, -4.5), kind: 'emergency', circuit: 'emergency', zone: 'public' },
  // Nurse station
  ...troffers('nurse_station', [-2, 2], [-3.6], 2.78, 'corridor_e'),
  { id: 'station_desk_0', room: 'nurse_station', pos: v3(-1.5, 1.0, -2.3), kind: 'desk', circuit: 'emergency', zone: 'corridor_e', color: 0xffe9c4, intensity: 0.5 },
  { id: 'station_desk_1', room: 'nurse_station', pos: v3(1.5, 1.0, -2.3), kind: 'desk', circuit: 'emergency', zone: 'corridor_e', color: 0xffe9c4, intensity: 0.5 },
  { id: 'station_em', room: 'nurse_station', pos: v3(3.8, 2.5, -5.4), kind: 'emergency', circuit: 'emergency', zone: 'corridor_e' },
  // Lounge, supply, restroom
  ...troffers('break_room', [6.2], [-3.8], 2.78, 'public', { color: 0xffe6c8 }),
  ...troffers('supply', [9.9], [-3.8], 2.78, 'public'),
  ...troffers('restroom', [13.1], [-3.3], 2.78, 'public', { flickerProne: true }),
  { id: 'elevator_can', room: 'elevator', pos: v3(16, 2.38, -2.4), kind: 'can', circuit: 'main', zone: 'corridor_e', color: 0xfff1dc },
  // Exam rooms (zone exam)
  ...troffers('exam1', [-17.5], [3.6], 2.78, 'exam'),
  ...troffers('exam2', [-13.3], [3.6], 2.78, 'exam'),
  ...troffers('exam3', [-7.7], [3.6], 2.78, 'exam', { flickerProne: true }),
  ...troffers('exam4', [-3.7], [3.6], 2.78, 'exam'),
  ...troffers('exam5', [4.3], [3.6], 2.78, 'exam'),
  ...troffers('med_room', [0.3], [3.6], 2.78, 'exam'),
  { id: 'med_em', room: 'med_room', pos: v3(2.0, 2.5, 5.5), kind: 'emergency', circuit: 'emergency', zone: 'exam' },
  ...strips('staff_pass', [-10.5], 3.6, 2.56, 'service'),
  { id: 'staff_pass_em', room: 'staff_pass', pos: v3(-10.5, 2.3, 5.5), kind: 'emergency', circuit: 'emergency', zone: 'service', rotY: Math.PI },
  // Service corridors (strips, some flicker-prone), emergency cages
  ...strips('service_n', [-9, -5, -1, 3, 7, 11, 15, 19], 7, 2.56, 'service', { flickerProne: true }),
  ...strips('service_e', [21.4], 2, 2.56, 'service'),
  { id: 'service_em_0', room: 'service_n', pos: v3(-3, 2.3, 8.1), kind: 'emergency', circuit: 'emergency', zone: 'service' },
  { id: 'service_em_1', room: 'service_n', pos: v3(9, 2.3, 8.1), kind: 'emergency', circuit: 'emergency', zone: 'service' },
  { id: 'service_em_2', room: 'service_e', pos: v3(22.5, 2.3, 2), kind: 'emergency', circuit: 'emergency', zone: 'service', rotY: -Math.PI / 2 },
  // Utility / electrical / generator
  ...strips('utility', [-6], 9.7, 2.56, 'service'),
  ...strips('electrical', [4], 9.9, 2.56, 'service'),
  { id: 'electrical_em', room: 'electrical', pos: v3(5.8, 2.3, 11.3), kind: 'emergency', circuit: 'emergency', zone: 'service' },
  ...strips('generator', [12, 16], 11.2, 3.36, 'service'),
  { id: 'generator_em', room: 'generator', pos: v3(17.8, 2.8, 9), kind: 'emergency', circuit: 'emergency', zone: 'service', rotY: -Math.PI / 2 },
  // Exterior sodium lamps (always)
  { id: 'ext_sodium_0', room: 'exterior', pos: v3(-23, 4.2, -6), kind: 'sodium', circuit: 'always', color: 0xffa040, intensity: 2.2 },
  { id: 'ext_sodium_1', room: 'exterior', pos: v3(-23, 4.2, 0.5), kind: 'sodium', circuit: 'always', color: 0xffa040, intensity: 1.6 },
  { id: 'ext_pole', room: 'exterior', pos: v3(-31, 6.5, -9), kind: 'sodium', circuit: 'always', color: 0xff9a30, intensity: 1.2 },
  // Imaging standby glow (never on main; a dead monitor)
  { id: 'imaging_standby', room: 'imaging', pos: v3(10, 1.2, 4.5), kind: 'monitor', circuit: 'always', color: 0x3a6a4a, intensity: 0.08 },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const P = (id: string, type: PropDef['type'], room: RoomId, x: number, y: number, z: number, rotY = 0, extra: Partial<PropDef> = {}): PropDef => ({ id, type, room, pos: v3(x, y, z), rotY, ...extra });

const examRoomProps = (room: RoomId, x0: number): PropDef[] => {
  const cx = x0 + 1.9; // room centre x (rooms are 3.8 wide)
  const n = room.replace('exam', '');
  return [
    P(`${room}_bed`, 'bed', room, cx + 0.4, 0, 4.1, 0, { solid: true, footprint: { w: 1.0, d: 2.2 }, params: { occupied: false } }),
    P(`${room}_monitor`, 'monitor', room, cx + 1.4, 1.35, 4.9, -2.6, { params: { screen: 'vitals', patient: room }, interactable: true }),
    P(`${room}_iv`, 'iv_stand', room, cx + 1.2, 0, 3.2, 0, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
    P(`${room}_curtain`, 'curtain', room, cx, 0, 2.6, 0, { params: { open: 0.7, width: 3.4 } }),
    P(`${room}_cabinet`, 'cabinet', room, x0 + 0.4, 0, 5.32, Math.PI, { solid: true, footprint: { w: 0.6, d: 0.5 } }),
    P(`${room}_sink`, 'sink', room, x0 + 0.27, 0, 2.0, Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.5 } }),
    P(`${room}_chair`, 'chair', room, cx - 1.2, 0, 3.4, Math.PI / 2, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
    P(`${room}_sanitizer`, 'hand_sanitizer', room, x0 + 0.01, 1.2, 2.6, Math.PI / 2),
    P(`${room}_call`, 'call_light', 'corridor', cx, 2.35, 1.35, 0, { params: { room } }),
    P(`${room}_sign`, 'sign_board', 'corridor', cx + 0.9, 2.0, 1.39, Math.PI, { params: { text: n, kind: 'room_number' } }),
    P(`${room}_sharps`, 'sharps_bin', room, x0 + 3.55, 1.1, 5.59, Math.PI),
    P(`${room}_poster`, 'poster', room, x0 + 0.01, 1.5, 4.0, Math.PI / 2, { params: { kind: 'handwash' } }),
  ];
};

export const PROPS: PropDef[] = [
  // --- exterior -------------------------------------------------------------
  P('ext_canopy', 'canopy', 'exterior', -23, 4.4, -3, 0, { params: { w: 6, d: 10 } }),
  P('ext_sign', 'sign_board', 'exterior', -26.03, 5.15, -3, -Math.PI / 2, { params: { text: 'EMERGENCY', kind: 'big_red' } }),
  P('ext_sign_name', 'sign_board', 'exterior', -20.21, 5.9, -3, -Math.PI / 2, { params: { text: 'ST. AUGUSTINE REGIONAL MEDICAL CENTER', kind: 'hospital_name' } }),
  P('ext_ambulance', 'ambulance', 'exterior', -26.5, 0, -6.0, Math.PI / 2 - 0.08, { solid: true, footprint: { w: 2.4, d: 6.0 } }),
  P('ext_badge_amb', 'badge_reader', 'exterior', -20.21, 1.2, 1.75, -Math.PI / 2, { params: { door: 'd_ambulance' } }),
  P('ext_bollard_0', 'bollard', 'exterior', -21.5, 0, -8.5, 0, { solid: true, footprint: { w: 0.3, d: 0.3 } }),
  P('ext_bollard_1', 'bollard', 'exterior', -21.5, 0, 2.5, 0, { solid: true, footprint: { w: 0.3, d: 0.3 } }),
  P('ext_bollard_2', 'bollard', 'exterior', -21.5, 0, -3, 0, { solid: true, footprint: { w: 0.3, d: 0.3 } }),
  P('ext_wheelchair', 'wheelchair', 'exterior', -21.1, 0, -10.2, -0.6, { solid: true, footprint: { w: 0.7, d: 1.0 } }),
  P('ext_trash', 'trash', 'exterior', -21, 0, 1.6, 0, { solid: true, footprint: { w: 0.6, d: 0.6 } }),
  P('ext_puddle_0', 'puddle', 'exterior', -25, 0.005, -1, 0, { params: { w: 3, d: 2 } }),
  P('ext_puddle_1', 'puddle', 'exterior', -29, 0.005, -8, 0.5, { params: { w: 4, d: 2.5 } }),
  // --- waiting room -----------------------------------------------------------
  P('wait_chairs_0', 'chair_row', 'waiting', -17.5, 0, -4.2, Math.PI, { solid: true, footprint: { w: 3.0, d: 0.6 }, params: { count: 5 } }),
  P('wait_chairs_1', 'chair_row', 'waiting', -17.5, 0, -6.0, Math.PI, { solid: true, footprint: { w: 3.0, d: 0.6 }, params: { count: 5 } }),
  P('wait_chairs_2', 'chair_row', 'waiting', -12.5, 0, -4.2, Math.PI, { solid: true, footprint: { w: 3.0, d: 0.6 }, params: { count: 5 } }),
  P('wait_chairs_3', 'chair_row', 'waiting', -12.5, 0, -6.0, Math.PI, { solid: true, footprint: { w: 3.0, d: 0.6 }, params: { count: 5 } }),
  P('wait_chairs_4', 'chair_row', 'waiting', -17.5, 0, -9.55, 0, { solid: true, footprint: { w: 2.4, d: 0.6 }, params: { count: 4 } }),
  P('wait_tv', 'tv', 'waiting', -14, 2.2, -9.99, 0, { params: { screen: 'news_muted' }, interactable: true }),
  P('wait_clock', 'clock', 'waiting', -8.21, 2.3, -4, -Math.PI / 2, { params: { digital: true } }),
  P('wait_vending_0', 'vending', 'waiting', -9.0, 0, -9.3, 0, { solid: true, footprint: { w: 1.0, d: 0.8 }, interactable: true, params: { kind: 'snacks' } }),
  P('wait_vending_1', 'vending', 'waiting', -10.1, 0, -9.3, 0, { solid: true, footprint: { w: 1.0, d: 0.8 }, interactable: true, params: { kind: 'drinks' } }),
  P('wait_desk', 'desk', 'waiting', -9.4, 0, -2.75, Math.PI, { solid: true, footprint: { w: 2.4, d: 1.0 }, params: { kind: 'registration', glass: true }, interactable: true }),
  P('wait_desk_terminal', 'terminal', 'waiting', -9.1, 0.76, -2.45, 0, { params: { screen: 'registration' } }),
  P('wait_table', 'table', 'waiting', -15, 0, -8.6, 0, { solid: true, footprint: { w: 1.0, d: 0.6 }, params: { magazines: true } }),
  P('wait_plant', 'plant', 'waiting', -19.4, 0, -9.4, 0, { solid: true, footprint: { w: 0.6, d: 0.6 } }),
  P('wait_trash', 'trash', 'waiting', -8.5, 0, -6.6, 0, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
  P('wait_sanitizer', 'hand_sanitizer', 'waiting', -11.8, 1.2, -1.61, Math.PI),
  P('wait_poster_0', 'poster', 'waiting', -16, 1.6, -9.99, 0, { params: { kind: 'flu' } }),
  P('wait_poster_1', 'poster', 'waiting', -8.21, 1.6, -6.6, -Math.PI / 2, { params: { kind: 'rights' } }),
  P('wait_sign', 'sign_board', 'waiting', -14, 2.75, -1.61, Math.PI, { params: { text: 'TREATMENT AREA →  PLEASE WAIT TO BE CALLED', kind: 'wayfinding' } }),
  P('wait_wheelchair', 'wheelchair', 'waiting', -19.2, 0, -2.4, 0.9, { solid: true, footprint: { w: 0.7, d: 1.0 } }),
  P('wait_fountain', 'water_fountain', 'waiting', -8.21, 0, -7.9, -Math.PI / 2, { solid: true, footprint: { w: 0.8, d: 0.6 } }),
  // --- corridor ---------------------------------------------------------------
  P('hall_wheelchair', 'wheelchair', 'corridor', 7.6, 0, 0.88, Math.PI, { solid: true, footprint: { w: 0.7, d: 1.0 } }),
  P('hall_stretcher', 'stretcher', 'corridor', 18.2, 0, -0.95, Math.PI / 2, { solid: true, footprint: { w: 0.7, d: 2.0 } }),
  P('hall_cart', 'cart', 'corridor', -1.8, 0, 1.05, Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.9 }, params: { kind: 'linen' } }),
  P('hall_extinguisher', 'fire_extinguisher', 'corridor', 15.8, 1.0, 1.39, Math.PI),
  P('hall_fountain', 'water_fountain', 'corridor', 14.2, 0, 1.39, Math.PI, { solid: true, footprint: { w: 0.8, d: 0.6 } }),
  P('hall_wetfloor', 'wet_floor_sign', 'corridor', 11.2, 0, 0.6, 0.4),
  P('hall_clock', 'clock', 'corridor', -4.6, 2.4, -1.39, 0, { params: { digital: false } }),
  P('hall_board', 'whiteboard', 'corridor', 11.85, 1.5, -1.39, 0, { params: { kind: 'notices' } }),
  P('hall_sign_w', 'sign_board', 'corridor', -18.6, 2.25, -1.39, 0, { params: { text: '← AMBULANCE BAY     WAITING ROOM ↓', kind: 'wayfinding' } }),
  P('hall_sign_e', 'sign_board', 'corridor', 17.6, 2.25, 1.39, Math.PI, { params: { text: 'RESTROOMS   ELEVATOR   STAFF ONLY →', kind: 'wayfinding' } }),
  P('hall_sign_imaging', 'sign_board', 'corridor', 8, 2.35, 1.39, Math.PI, { params: { text: 'IMAGING', kind: 'dept' } }),
  P('hall_poster', 'poster', 'corridor', -16, 1.6, -1.39, 0, { params: { kind: 'stroke' } }),
  P('hall_sanitizer_0', 'hand_sanitizer', 'corridor', -6.8, 1.2, 1.39, Math.PI),
  P('hall_sanitizer_1', 'hand_sanitizer', 'corridor', 5.2, 1.2, 1.39, Math.PI),
  P('hall_badge_service', 'badge_reader', 'corridor', 19.99, 1.2, 0.8, -Math.PI / 2, { params: { door: 'd_service' } }),
  P('hall_badge_pass', 'badge_reader', 'corridor', -9.8, 1.2, 1.39, Math.PI, { params: { door: 'd_staff_pass' } }),
  P('hall_badge_med', 'badge_reader', 'corridor', 1.0, 1.2, 1.39, Math.PI, { params: { door: 'd_med' } }),
  P('hall_badge_supply', 'badge_reader', 'corridor', 10.6, 1.2, -1.39, 0, { params: { door: 'd_supply' } }),
  P('elev_doors', 'elevator_doors', 'corridor', 16, 0, -1.5, 0, { params: { door: 'd_elevator' } }),
  P('elev_panel', 'sign_board', 'corridor', 16.9, 1.1, -1.39, 0, { params: { text: '▲ ▼', kind: 'elevator_call' }, interactable: true }),
  // --- triage ----------------------------------------------------------------
  P('triage_desk', 'desk', 'triage', -4.6, 0, -3.8, -Math.PI / 2, { solid: true, footprint: { w: 1.6, d: 0.8 }, params: { kind: 'clinical' } }),
  P('triage_terminal', 'terminal', 'triage', -4.55, 0.76, -3.5, -Math.PI / 2, { params: { screen: 'triage' }, interactable: true }),
  P('triage_chair_pt', 'chair', 'triage', -6.4, 0, -3.4, Math.PI / 2, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
  P('triage_stool', 'stool', 'triage', -5.4, 0, -4.0, Math.PI / 2, { solid: true, footprint: { w: 0.4, d: 0.4 } }),
  P('triage_monitor', 'monitor', 'triage', -7.4, 1.3, -4.6, 0.6, { params: { screen: 'vitals', patient: 'triage' }, interactable: true }),
  P('triage_cabinet', 'cabinet', 'triage', -7.6, 0, -5.7, 0, { solid: true, footprint: { w: 0.8, d: 0.5 } }),
  P('triage_sink', 'sink', 'triage', -4.5, 0, -5.7, 0, { solid: true, footprint: { w: 0.6, d: 0.5 } }),
  P('triage_poster', 'poster', 'triage', -7.99, 1.5, -2.6, Math.PI / 2, { params: { kind: 'pain_scale' } }),
  // --- nurse station ----------------------------------------------------------
  P('station_counter', 'counter', 'nurse_station', 0, 0, -2.05, 0, { solid: true, footprint: { w: 6.4, d: 0.9 }, params: { w: 6.4 } }),
  P('station_terminal_0', 'terminal', 'nurse_station', -1.5, 0.76, -2.3, Math.PI, { params: { screen: 'patients' }, interactable: true }),
  P('station_terminal_1', 'terminal', 'nurse_station', 1.5, 0.76, -2.3, Math.PI, { params: { screen: 'security' }, interactable: true }),
  P('station_chair_0', 'chair', 'nurse_station', -1.5, 0, -3.05, 0, { solid: false, params: { office: true } }),
  P('station_chair_1', 'chair', 'nurse_station', 1.5, 0, -3.05, 0, { solid: false, params: { office: true } }),
  P('station_board', 'whiteboard', 'nurse_station', 0, 1.6, -5.59, 0, { params: { kind: 'assignments' }, interactable: true }),
  P('station_callboard', 'call_light', 'nurse_station', -2.8, 2.0, -5.55, 0, { params: { room: 'board' } }),
  P('station_desk_back', 'desk', 'nurse_station', -3.62, 0, -4.6, Math.PI / 2, { solid: true, footprint: { w: 1.6, d: 0.7 }, params: { kind: 'back' } }),
  P('station_desk_side', 'desk', 'nurse_station', 3.68, 0, -4.8, -Math.PI / 2, { solid: true, footprint: { w: 1.2, d: 0.6 }, params: { kind: 'clinical' } }),
  P('station_security_mon', 'security_monitor', 'nurse_station', 3.62, 0.76, -4.8, -Math.PI / 2 - 0.25, { params: { feeds: 4 }, interactable: true }),
  P('station_phone', 'phone', 'nurse_station', 0.6, 0.76, -2.3, Math.PI, { params: { kind: 'desk' } }),
  P('station_charts', 'rack', 'nurse_station', -3.99, 1.2, -2.6, Math.PI / 2, { params: { kind: 'charts' }, interactable: true }),
  P('station_clock', 'clock', 'nurse_station', 2.5, 2.3, -5.59, 0, { params: { digital: true } }),
  P('station_printer', 'cabinet', 'nurse_station', 3.4, 0, -3.2, -Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.6 }, params: { kind: 'printer' } }),
  P('station_radio', 'radio', 'nurse_station', -0.5, 0.76, -2.3, Math.PI, { params: { kind: 'base' } }),
  // --- lounge ----------------------------------------------------------------
  P('lounge_table', 'table', 'break_room', 6.2, 0, -4.2, 0, { solid: true, footprint: { w: 1.2, d: 0.8 } }),
  P('lounge_chair_0', 'chair', 'break_room', 5.4, 0, -4.2, Math.PI / 2, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
  P('lounge_chair_1', 'chair', 'break_room', 7.0, 0, -4.2, -Math.PI / 2, { solid: true, footprint: { w: 0.5, d: 0.5 } }),
  P('lounge_sofa', 'sofa', 'break_room', 6.2, 0, -5.58, 0, { solid: true, footprint: { w: 1.8, d: 0.8 } }),
  P('lounge_fridge', 'fridge', 'break_room', 4.6, 0, -5.6, Math.PI / 2, { solid: true, footprint: { w: 0.7, d: 0.7 } }),
  P('lounge_counter', 'counter', 'break_room', 7.88, 0, -2.6, -Math.PI / 2, { solid: true, footprint: { w: 1.6, d: 0.6 }, params: { w: 1.6, kitchen: true } }),
  P('lounge_microwave', 'microwave', 'break_room', 7.8, 0.92, -2.2, -Math.PI / 2),
  P('lounge_coffee', 'coffee_maker', 'break_room', 7.8, 0.92, -2.72, -Math.PI / 2, { interactable: true }),
  P('lounge_lockers', 'locker', 'break_room', 4.46, 0, -2.6, Math.PI / 2, { solid: true, footprint: { w: 1.6, d: 0.5 }, params: { count: 4 }, interactable: true }),
  P('lounge_tv', 'tv', 'break_room', 4.95, 1.9, -1.61, Math.PI, { params: { screen: 'off' } }),
  P('lounge_poster', 'poster', 'break_room', 8.19, 1.6, -4.5, -Math.PI / 2, { params: { kind: 'schedule' } }),
  // --- supply ----------------------------------------------------------------
  P('supply_shelf_0', 'shelf', 'supply', 8.66, 0, -4.0, Math.PI / 2, { solid: true, footprint: { w: 3.0, d: 0.5 } }),
  P('supply_shelf_1', 'shelf', 'supply', 11.14, 0, -4.0, -Math.PI / 2, { solid: true, footprint: { w: 3.0, d: 0.5 } }),
  P('supply_cart', 'cart', 'supply', 9.9, 0, -5.3, 0, { solid: true, footprint: { w: 0.6, d: 0.9 }, params: { kind: 'supply' }, interactable: true }),
  P('supply_crates', 'crates', 'supply', 10.35, 0, -3.1, 0.2, { solid: true, footprint: { w: 0.6, d: 0.5 } }),
  // --- restroom ----------------------------------------------------------------
  P('wc_sink', 'sink', 'restroom', 11.87, 0, -2.3, Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.5 }, interactable: true }),
  P('wc_mirror', 'mirror', 'restroom', 11.61, 1.5, -2.3, Math.PI / 2, { params: { w: 0.8, h: 0.9 } }),
  P('wc_stall_0', 'toilet_stall', 'restroom', 13.85, 0, -4.3, 0, { solid: true, footprint: { w: 1.2, d: 1.4 } }),
  P('wc_stall_1', 'toilet_stall', 'restroom', 12.55, 0, -4.3, 0, { solid: true, footprint: { w: 1.2, d: 1.4 } }),
  P('wc_trash', 'trash', 'restroom', 14.3, 0, -2.0, 0, { solid: true, footprint: { w: 0.4, d: 0.4 } }),
  P('wc_drain', 'floor_drain', 'restroom', 13.1, 0.002, -3.0, 0),
  // --- exam rooms ----------------------------------------------------------------
  ...examRoomProps('exam1', -19.4),
  ...examRoomProps('exam2', -15.2),
  ...examRoomProps('exam3', -9.6),
  ...examRoomProps('exam4', -5.6),
  ...examRoomProps('exam5', 2.4),
  // --- med room ----------------------------------------------------------------
  P('med_cabinet_0', 'med_cabinet', 'med_room', -1.28, 0, 3.9, Math.PI / 2, { solid: true, footprint: { w: 1.6, d: 0.6 }, interactable: true }),
  P('med_counter', 'counter', 'med_room', 0.3, 0, 5.24, Math.PI, { solid: true, footprint: { w: 3.0, d: 0.7 }, params: { w: 3.0 } }),
  P('med_terminal', 'terminal', 'med_room', 0.6, 0.92, 5.2, Math.PI, { params: { screen: 'pyxis' }, interactable: true }),
  P('med_fridge', 'fridge', 'med_room', 1.85, 0, 2.4, -Math.PI / 2, { solid: true, footprint: { w: 0.7, d: 0.7 }, params: { kind: 'med' } }),
  P('med_sink', 'sink', 'med_room', 1.93, 0, 4.0, -Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.5 } }),
  P('med_sharps', 'sharps_bin', 'med_room', -1.59, 1.1, 2.2, Math.PI / 2),
  // --- imaging (dark, seen through glass) -------------------------------------------
  P('img_table', 'bed', 'imaging', 10, 0, 3.8, Math.PI / 2, { solid: true, footprint: { w: 1.0, d: 2.2 }, params: { kind: 'imaging_table' } }),
  P('img_terminal', 'terminal', 'imaging', 12.6, 0.76, 5.0, Math.PI, { params: { screen: 'standby' } }),
  P('img_desk', 'desk', 'imaging', 12.6, 0, 5.1, Math.PI, { solid: true, footprint: { w: 1.4, d: 0.7 }, params: { kind: 'clinical' } }),
  P('img_cabinet', 'cabinet', 'imaging', 7.0, 0, 5.32, Math.PI, { solid: true, footprint: { w: 0.8, d: 0.5 } }),
  P('img_sheeting', 'plastic_sheeting', 'imaging', 8.4, 0, 3.6, 0, { params: { w: 2.0, h: 2.7 } }),
  // --- staff passage / service halls ---------------------------------------------
  P('pass_pipes', 'ceiling_pipes', 'staff_pass', -10.5, 2.45, 3.6, Math.PI / 2, { params: { length: 4.0, count: 2 } }),
  P('svc_pipes_0', 'ceiling_pipes', 'service_n', 5.7, 2.45, 7.9, 0, { params: { length: 33.8, count: 3 } }),
  P('svc_pipes_1', 'ceiling_pipes', 'service_e', 22.3, 2.45, 2.1, Math.PI / 2, { params: { length: 7.0, count: 2 } }),
  P('svc_conduit', 'conduit', 'service_n', 0, 1.8, 8.19, Math.PI, { params: { length: 30 } }),
  P('svc_vent_0', 'vent', 'service_n', -2, 2.2, 8.19, Math.PI),
  P('svc_vent_1', 'vent', 'service_n', 14, 2.2, 8.19, Math.PI),
  P('svc_cart', 'cleaning_cart', 'service_n', 9.6, 0, 7.75, -Math.PI / 2, { solid: true, footprint: { w: 0.7, d: 1.1 }, interactable: true }),
  P('svc_mop', 'mop_bucket', 'service_n', 10.65, 0, 7.85, 0, { solid: true, footprint: { w: 0.4, d: 0.5 }, interactable: true }),
  P('svc_ladder', 'ladder', 'service_n', 17, 0, 8.0, Math.PI, { solid: true, footprint: { w: 0.5, d: 0.3 } }),
  P('svc_crates', 'crates', 'service_n', -8.5, 0, 7.82, 0.3, { solid: true, footprint: { w: 1.0, d: 0.7 } }),
  P('svc_rack', 'rack', 'service_n', 21.8, 0, 7.9, Math.PI, { solid: true, footprint: { w: 1.2, d: 0.5 }, params: { kind: 'linen' } }),
  P('svc_extinguisher', 'fire_extinguisher', 'service_n', 1.5, 1.0, 8.19, Math.PI),
  P('svc_sign_closed', 'sign_board', 'service_n', -11.19, 2.35, 7, Math.PI / 2, { params: { text: 'WEST WING CLOSED — AUTHORIZED PERSONNEL ONLY', kind: 'warning' } }),
  P('svc_sheeting', 'plastic_sheeting', 'closed_wing', -12.6, 0, 7, Math.PI / 2, { params: { w: 2.4, h: 2.5 } }),
  P('svc_drain', 'floor_drain', 'service_n', -6, 0.002, 7, 0),
  P('svc_e_bins', 'trash', 'service_e', 22.2, 0, -0.8, 0, { solid: true, footprint: { w: 0.7, d: 0.7 }, params: { kind: 'biohazard' } }),
  P('svc_e_stretcher', 'stretcher', 'service_e', 22.15, 0, 3.4, 0, { solid: true, footprint: { w: 0.7, d: 2.0 } }),
  P('svc_e_badge', 'badge_reader', 'service_e', 20.21, 1.2, -0.8, Math.PI / 2, { params: { door: 'd_service' } }),
  // --- utility ----------------------------------------------------------------
  P('util_shelf', 'shelf', 'utility', -7.73, 0, 9.7, Math.PI / 2, { solid: true, footprint: { w: 2.2, d: 0.5 }, params: { kind: 'chemicals' } }),
  P('util_sink', 'sink', 'utility', -5, 0, 10.68, Math.PI, { solid: true, footprint: { w: 0.8, d: 0.6 }, params: { kind: 'mop_sink' } }),
  P('util_locker', 'locker', 'utility', -4.27, 0, 9.1, -Math.PI / 2, { solid: true, footprint: { w: 0.9, d: 0.5 }, params: { count: 2 }, interactable: true }),
  P('util_table', 'table', 'utility', -6.6, 0, 10.62, Math.PI, { solid: true, footprint: { w: 0.9, d: 0.5 } }),
  P('util_radio', 'radio', 'utility', -6.6, 0.74, 10.62, Math.PI, { params: { kind: 'handheld' }, interactable: true }),
  P('util_board', 'whiteboard', 'utility', -4.01, 1.5, 10.2, -Math.PI / 2, { params: { kind: 'evs_schedule' }, interactable: true }),
  P('util_drain', 'floor_drain', 'utility', -6, 0.002, 9.7, 0),
  // --- electrical ----------------------------------------------------------------
  P('elec_panel_main', 'breaker_panel', 'electrical', 3.0, 1.4, 11.39, Math.PI, { params: { kind: 'main' }, interactable: true }),
  P('elec_panel_zones', 'breaker_panel', 'electrical', 4.45, 1.4, 11.39, Math.PI, { params: { kind: 'zones' }, interactable: true }),
  P('elec_transfer', 'transfer_switch', 'electrical', 5.53, 0, 10.6, -Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.9 }, interactable: true }),
  P('elec_conduit', 'conduit', 'electrical', 4, 2.3, 11.39, Math.PI, { params: { length: 3.6, drops: [1.0, 0.82, -0.36, -0.52], dropLength: 0.38 } }),
  P('elec_sign', 'sign_board', 'electrical', 5.35, 1.75, 11.39, Math.PI, { params: { text: 'DANGER 480V', kind: 'warning' } }),
  P('elec_tag', 'maintenance_tag', 'electrical', 5.03, 1.0, 10.83, -Math.PI / 2, { params: { text: 'TRANSFER SWITCH — PM OVERDUE' }, interactable: true }),
  // --- generator ----------------------------------------------------------------
  P('gen_unit', 'generator', 'generator', 14, 0, 11.6, 0, { solid: true, footprint: { w: 3.6, d: 1.6 }, interactable: true }),
  P('gen_fuel', 'fuel_tank', 'generator', 17.2, 0, 12.8, 0, { solid: true, footprint: { w: 1.2, d: 1.8 }, interactable: true }),
  P('gen_transfer', 'transfer_switch', 'generator', 10.47, 0, 12.5, Math.PI / 2, { solid: true, footprint: { w: 0.6, d: 0.9 } }),
  P('gen_panel', 'breaker_panel', 'generator', 10.01, 1.4, 10.2, Math.PI / 2, { params: { kind: 'generator' }, interactable: true }),
  P('gen_vent', 'vent', 'generator', 14, 2.9, 13.99, Math.PI, { params: { large: true } }),
  P('gen_pipes', 'ceiling_pipes', 'generator', 14, 3.2, 9.0, 0, { params: { length: 7.8, count: 2 } }),
  P('gen_crates', 'crates', 'generator', 11.3, 0, 13.45, 0.2, { solid: true, footprint: { w: 1.0, d: 0.8 } }),
  P('gen_tag', 'maintenance_tag', 'generator', 15.2, 1.028, 10.828, Math.PI, { params: { text: 'LOAD TEST 03/2024 — FAIL — CALL VENDOR' }, interactable: true }),
  P('gen_drain', 'floor_drain', 'generator', 13, 0.002, 10, 0),
  P('gen_puddle', 'puddle', 'generator', 12.4, 0.003, 10.4, 0, { params: { w: 1.4, d: 0.9, oily: true } }),
  P('gen_sign', 'sign_board', 'generator', 12.9, 2.4, 8.41, 0, { params: { text: 'EMERGENCY POWER — DO NOT SHUT DOWN WITHOUT AUTHORIZATION', kind: 'warning' } }),
  P('gen_extinguisher', 'fire_extinguisher', 'generator', 10.01, 1.0, 9.5, Math.PI / 2),
];

// ---------------------------------------------------------------------------
// CCTV cameras
// ---------------------------------------------------------------------------

export const CAMERAS: CameraDef[] = [
  { id: 'cam_waiting', name: 'CAM 01 — WAITING', room: 'waiting', pos: v3(-8.6, 2.9, -9.6), lookAt: v3(-16, 1.0, -4.5), fov: 62, survivesBlackout: false, zone: 'cctv' },
  { id: 'cam_hall_w', name: 'CAM 02 — WEST HALL', room: 'corridor', pos: v3(-19.6, 2.55, 1.2), lookAt: v3(0, 1.1, 0), fov: 58, survivesBlackout: false, zone: 'cctv' },
  { id: 'cam_hall_e', name: 'CAM 03 — EAST HALL', room: 'corridor', pos: v3(19.6, 2.55, -1.2), lookAt: v3(0, 1.1, 0.1), fov: 58, survivesBlackout: true, zone: 'cctv' },
  { id: 'cam_station', name: 'CAM 04 — NURSE STN', room: 'nurse_station', pos: v3(3.7, 2.6, -5.3), lookAt: v3(-1, 1.0, -1.6), fov: 66, survivesBlackout: true, zone: 'cctv' },
  { id: 'cam_elevator', name: 'CAM 05 — ELEVATOR', room: 'corridor', pos: v3(18.6, 2.55, 1.2), lookAt: v3(16, 1.2, -1.6), fov: 60, survivesBlackout: false, zone: 'cctv' },
  { id: 'cam_service', name: 'CAM 06 — SERVICE', room: 'service_n', pos: v3(22.2, 2.4, 8.0), lookAt: v3(0, 1.0, 7.0), fov: 56, survivesBlackout: true, zone: 'cctv' },
  { id: 'cam_bay', name: 'CAM 07 — AMB BAY', room: 'exterior', pos: v3(-20.8, 4.0, -11.5), lookAt: v3(-26, 1.0, -3), fov: 64, survivesBlackout: false, zone: 'cctv' },
  { id: 'cam_generator', name: 'CAM 08 — GENERATOR', room: 'generator', pos: v3(17.6, 3.2, 13.6), lookAt: v3(12, 1.0, 9.5), fov: 64, survivesBlackout: true, zone: 'cctv' },
];

// ---------------------------------------------------------------------------
// Spawns + named points
// ---------------------------------------------------------------------------

export const SPAWN: Record<CharacterId, SpawnDef> = {
  john: { pos: v3(-13.1, 0, -4.2), yaw: 0, room: 'waiting' }, // second row, facing the TV wall (south, -z)
  susie: { pos: v3(-18.5, 0, 0), yaw: -Math.PI / 2, room: 'corridor' }, // just inside the ambulance entrance, facing east
  paul: { pos: v3(8.5, 0, 7), yaw: -Math.PI / 2, room: 'service_n' }, // beside his cart, facing east
};

export const POINTS: Record<string, Vec3> = {
  tv: v3(-14, 2.2, -9.95),
  waiting_clock: v3(-8.3, 2.3, -4),
  waiting_glass: v3(-19.9, 1.5, -6),
  john_seat: v3(-13.1, 0, -4.2),
  registration_desk: v3(-9.4, 1.0, -2.75),
  vending: v3(-9.5, 1.2, -9.3),
  exam3_door: v3(-7.7, 1.0, 1.5),
  exam3_bed: v3(-7.3, 0.6, 4.1),
  exam3_inside: v3(-7.7, 1.65, 3.0),
  corridor_w: v3(-18, 1.65, 0),
  corridor_e: v3(18, 1.65, 0),
  corridor_mid: v3(0, 1.65, 0),
  hall_figure_e: v3(12.4, 0, 0.35), // outside the restroom, backlit by corridor_fl_13 with fl_12 dark in front
  hall_figure_w: v3(-17.5, 0, -0.3),
  station_counter: v3(0, 1.1, -1.95),
  station_inside: v3(0, 1.65, -3.6),
  elevator_doors: v3(16, 1.2, -1.5),
  service_mid: v3(5, 1.65, 7),
  service_w_end: v3(-10.5, 1.65, 7),
  closed_wing_door: v3(-11.3, 1.2, 7),
  electrical_panel: v3(3.7, 1.4, 11.3),
  generator_unit: v3(14, 1.0, 11.6),
  generator_door: v3(11, 1.0, 8.3),
  ambulance: v3(-26.5, 1.2, -6.0),
  canopy_sign: v3(-26.03, 5.15, -3),
  exterior_wide: v3(-31, 2.2, -11),
  wheelchair_hall: v3(7.6, 0, 1.0),
  restroom_mirror: v3(11.65, 1.5, -2.3),
};

// ---------------------------------------------------------------------------
// Waypoint graph (generated): corridor spines + door nodes + room centres
// ---------------------------------------------------------------------------

export function roomCenter(room: RoomDef): Vec2 {
  return { x: (room.bounds.x0 + room.bounds.x1) / 2, z: (room.bounds.z0 + room.bounds.z1) / 2 };
}

export function buildWaypoints(rooms: RoomDef[], doors: DoorDef[]): WaypointDef[] {
  const nodes = new Map<string, WaypointDef>();
  const add = (id: string, pos: Vec2, room: RoomId): WaypointDef => {
    const n: WaypointDef = { id, pos, room, links: [] };
    nodes.set(id, n);
    return n;
  };
  const link = (a: string, b: string): void => {
    const na = nodes.get(a);
    const nb = nodes.get(b);
    if (!na || !nb || a === b) return;
    if (!na.links.includes(b)) na.links.push(b);
    if (!nb.links.includes(a)) nb.links.push(a);
  };

  // Spines
  const corridorXs: number[] = [];
  for (let x = -19; x <= 19; x += 2) corridorXs.push(x);
  corridorXs.forEach((x, i) => {
    add(`c_${i}`, { x, z: 0 }, 'corridor');
    if (i > 0) link(`c_${i}`, `c_${i - 1}`);
  });
  const serviceXs: number[] = [];
  for (let x = -10.5; x <= 21.5; x += 2) serviceXs.push(x);
  serviceXs.forEach((x, i) => {
    add(`s_${i}`, { x, z: 7 }, 'service_n');
    if (i > 0) link(`s_${i}`, `s_${i - 1}`);
  });
  const serviceEZs = [4.6, 2.6, 0.6];
  serviceEZs.forEach((z, i) => {
    add(`se_${i}`, { x: 21.4, z }, 'service_e');
    if (i > 0) link(`se_${i}`, `se_${i - 1}`);
  });
  // waiting room grid
  const waitPts: Vec2[] = [
    { x: -14, z: -3.0 }, { x: -17.5, z: -3.0 }, { x: -10.5, z: -3.0 },
    { x: -15, z: -7.4 }, { x: -11, z: -7.4 }, { x: -18.5, z: -7.4 },
    { x: -10, z: -8.8 }, { x: -18.8, z: -5.1 },
  ];
  waitPts.forEach((p, i) => add(`w_${i}`, p, 'waiting'));
  link('w_0', 'w_1'); link('w_0', 'w_2'); link('w_1', 'w_3'); link('w_2', 'w_4'); link('w_3', 'w_4');
  link('w_3', 'w_5'); link('w_4', 'w_6'); link('w_1', 'w_7'); link('w_5', 'w_7'); link('w_2', 'w_6');
  // exterior
  add('x_0', { x: -22, z: 0 }, 'exterior');
  add('x_1', { x: -22, z: -6 }, 'exterior');
  add('x_2', { x: -27, z: -3 }, 'exterior');
  add('x_3', { x: -30, z: -9 }, 'exterior');
  link('x_0', 'x_1'); link('x_1', 'x_2'); link('x_2', 'x_3'); link('x_0', 'x_2');

  const nearest = (prefix: string, p: Vec2): string | null => {
    let best: string | null = null;
    let bd = Infinity;
    for (const n of nodes.values()) {
      if (!n.id.startsWith(prefix)) continue;
      const d = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
      if (d < bd) {
        bd = d;
        best = n.id;
      }
    }
    return best;
  };
  const spinePrefix: Partial<Record<RoomId, string>> = {
    corridor: 'c_', service_n: 's_', service_e: 'se_', waiting: 'w_', exterior: 'x_',
  };

  // Room centres (non-spine rooms)
  for (const room of rooms) {
    if (spinePrefix[room.id]) continue;
    add(`r_${room.id}`, roomCenter(room), room.id);
  }

  // Door nodes on both sides, linked to spine/centre
  for (const d of doors) {
    const off = 0.75;
    const sideA: Vec2 = d.axis === 'x' ? { x: d.pos.x, z: d.pos.z - off } : { x: d.pos.x - off, z: d.pos.z };
    const sideB: Vec2 = d.axis === 'x' ? { x: d.pos.x, z: d.pos.z + off } : { x: d.pos.x + off, z: d.pos.z };
    // decide which side belongs to which room by proximity to room bounds
    const roomA = rooms.find((rm) => rm.id === d.a)!;
    const inA = (p: Vec2) => p.x >= roomA.bounds.x0 - 0.01 && p.x <= roomA.bounds.x1 + 0.01 && p.z >= roomA.bounds.z0 - 0.01 && p.z <= roomA.bounds.z1 + 0.01;
    const [pa, pb] = inA(sideA) ? [sideA, sideB] : [sideB, sideA];
    const ida = `d_${d.id}_a`;
    const idb = `d_${d.id}_b`;
    add(ida, pa, d.a);
    add(idb, pb, d.b);
    link(ida, idb);
    for (const [id, room, p] of [[ida, d.a, pa], [idb, d.b, pb]] as [string, RoomId, Vec2][]) {
      const prefix = spinePrefix[room];
      const target = prefix ? nearest(prefix, p) : `r_${room}`;
      if (target) link(id, target);
    }
  }
  return Array.from(nodes.values());
}

export const WAYPOINTS: WaypointDef[] = buildWaypoints(ROOMS, DOORS);

export const LAYOUT: HospitalLayout = {
  wallThickness: WALL,
  rooms: ROOMS,
  doors: DOORS,
  lights: LIGHTS,
  props: PROPS,
  cameras: CAMERAS,
  waypoints: WAYPOINTS,
  spawn: SPAWN,
  points: POINTS,
};

// ---------------------------------------------------------------------------
// Geometry helpers shared by world / characters / UI
// ---------------------------------------------------------------------------

export function rectContains(rc: Rect, p: Vec2, pad = 0): boolean {
  return p.x >= rc.x0 - pad && p.x <= rc.x1 + pad && p.z >= rc.z0 - pad && p.z <= rc.z1 + pad;
}

export function roomAt(p: Vec2, rooms: RoomDef[] = ROOMS): RoomId | null {
  for (const rm of rooms) if (rectContains(rm.bounds, p)) return rm.id;
  return null;
}

/** World rect covering a door opening (spans the wall thickness plus a little slack on both sides). */
export function doorPassage(d: DoorDef, wall = WALL): Rect {
  const half = d.width / 2;
  const t = wall / 2 + 0.35;
  return d.axis === 'x'
    ? { x0: d.pos.x - half, x1: d.pos.x + half, z0: d.pos.z - t, z1: d.pos.z + t }
    : { x0: d.pos.x - t, x1: d.pos.x + t, z0: d.pos.z - half, z1: d.pos.z + half };
}

export function doorsOfRoom(room: RoomId, doors: DoorDef[] = DOORS): DoorDef[] {
  return doors.filter((d) => d.a === room || d.b === room);
}

/** Convert a yaw (radians, 0 = facing +z... we use three.js convention: yaw 0 looks toward -z) */
export function forwardFromYaw(yaw: number): Vec2 {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}
