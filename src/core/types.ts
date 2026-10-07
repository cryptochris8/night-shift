/**
 * NIGHT SHIFT — shared domain types.
 * Single source of truth for cross-module data shapes.
 * Must stay free of three.js / DOM imports so it can be used in node tests.
 */

export type CharacterId = 'john' | 'susie' | 'paul';
export const CHARACTER_IDS: readonly CharacterId[] = ['john', 'susie', 'paul'] as const;

/** What the player is currently looking through. */
export type ViewId = CharacterId | 'cctv';

/** Hidden scenario selected by the Night Seed. NEVER shown to the player. */
export type ScenarioType = 'grounded' | 'psychological' | 'supernatural' | 'mixed';

export type PowerState = 'normal' | 'unstable' | 'blackout' | 'generator';

export type SoundState =
  | 'NORMAL'
  | 'UNEASY'
  | 'PRE_OUTAGE'
  | 'BLACKOUT'
  | 'GENERATOR'
  | 'THREAT'
  | 'RESOLUTION';

export type GamePhase =
  | 'normal'
  | 'unease'
  | 'contradictions'
  | 'outage'
  | 'generator'
  | 'crisis'
  | 'resolution';

export type Screen =
  | 'boot'
  | 'title'
  | 'intro'
  | 'playing'
  | 'paused'
  | 'settings'
  | 'controls'
  | 'credits'
  | 'ending';

export type EndingId = 'morning' | 'missing' | 'rational' | 'came_through';

export type Difficulty = 'easy' | 'normal' | 'hard';

export type RoomId =
  | 'exterior'
  | 'waiting'
  | 'corridor'
  | 'triage'
  | 'nurse_station'
  | 'break_room'
  | 'supply'
  | 'restroom'
  | 'elevator'
  | 'exam1'
  | 'exam2'
  | 'exam3'
  | 'exam4'
  | 'exam5'
  | 'med_room'
  | 'imaging'
  | 'staff_pass'
  | 'service_e'
  | 'service_n'
  | 'utility'
  | 'electrical'
  | 'generator'
  | 'closed_wing';

export interface Vec2 { x: number; z: number }
export interface Vec3 { x: number; y: number; z: number }
/** Axis-aligned rectangle on the floor plane (x east, z north). */
export interface Rect { x0: number; x1: number; z0: number; z1: number }

export type FloorKind = 'vinyl' | 'tile' | 'concrete' | 'carpet' | 'asphalt';
export type WallKind = 'painted' | 'tile' | 'concrete' | 'block' | 'glass';
export type Side = 'n' | 's' | 'e' | 'w';

export interface RoomDef {
  id: RoomId;
  name: string;
  /** 2-3 word label for HUD / floor diagram */
  shortName: string;
  /** interior bounds (walls sit OUTSIDE these bounds, in the gap between adjacent rooms) */
  bounds: Rect;
  ceiling: number;
  floor: FloorKind;
  wall: WallKind;
  /** per-side override, e.g. glass wall to exterior */
  sides?: Partial<Record<Side, { kind: WallKind }>>;
  /** sRGB hex tints applied over procedural textures */
  wallColor?: number;
  floorColor?: number;
  /** who may be inside (doors enforce; UI uses for the floor diagram) */
  access: CharacterId[];
  /** room normally has working lights */
  lit: boolean;
  /** room has fixtures on the emergency (generator) circuit */
  emergency: boolean;
  outdoor?: boolean;
  /** no ceiling geometry (exterior) */
  noCeiling?: boolean;
  tags?: string[];
}

export type DoorKind =
  | 'swing'
  | 'double'
  | 'sliding_glass'
  | 'open'
  | 'elevator'
  | 'service'
  | 'counter_gate';

export interface DoorDef {
  id: string;
  a: RoomId;
  b: RoomId;
  /** centre of the opening, in the middle of the wall thickness */
  pos: Vec2;
  /** axis the WALL runs along; the opening spans `width` along this axis */
  axis: 'x' | 'z';
  width: number;
  height?: number;
  kind: DoorKind;
  /** who can open it. 'none' = decorative/permanently shut unless unlocked by the director */
  access: CharacterId[] | 'all' | 'none';
  badge?: boolean;
  /** initially locked even for those with access (director may unlock) */
  locked?: boolean;
  label?: string;
  window?: boolean;
  /** what happens to the lock when the generator takes over */
  afterBlackout?: 'locked' | 'unlocked' | 'same';
}

export type FixtureKind =
  | 'fluorescent' // recessed troffer panel
  | 'strip'       // bare tube strip (service areas)
  | 'can'         // recessed downlight
  | 'exit'        // exit sign (battery backed)
  | 'emergency'   // twin-head emergency light (generator circuit)
  | 'sodium'      // exterior sodium lamp
  | 'lamp'        // desk/floor lamp
  | 'desk'        // under-counter task lighting
  | 'monitor'     // glow from a screen (prop-driven)
  | 'vending';    // vending machine glow

export interface LightFixtureDef {
  id: string;
  room: RoomId;
  pos: Vec3;
  kind: FixtureKind;
  /** main = dies in blackout; emergency = returns on generator; always = battery; none = decorative */
  circuit: 'main' | 'emergency' | 'always' | 'none';
  /** breaker zone (load shedding on the generator). See ZONES. */
  zone?: ZoneId;
  size?: { w: number; d: number };
  rotY?: number;
  color?: number;
  intensity?: number;
  /** candidate for flicker anomalies */
  flickerProne?: boolean;
}

export type PropType =
  | 'bed'
  | 'stretcher'
  | 'wheelchair'
  | 'cart'
  | 'cleaning_cart'
  | 'desk'
  | 'counter'
  | 'chair'
  | 'chair_row'
  | 'stool'
  | 'curtain'
  | 'vending'
  | 'monitor'
  | 'iv_stand'
  | 'cabinet'
  | 'sink'
  | 'vent'
  | 'pipe_run'
  | 'conduit'
  | 'breaker_panel'
  | 'generator'
  | 'transfer_switch'
  | 'fuel_tank'
  | 'shelf'
  | 'trash'
  | 'table'
  | 'tv'
  | 'clock'
  | 'exit_sign'
  | 'fire_extinguisher'
  | 'wet_floor_sign'
  | 'phone'
  | 'terminal'
  | 'locker'
  | 'water_fountain'
  | 'ambulance'
  | 'bollard'
  | 'canopy'
  | 'sign_board'
  | 'poster'
  | 'whiteboard'
  | 'mop_bucket'
  | 'ladder'
  | 'elevator_doors'
  | 'window'
  | 'mirror'
  | 'toilet_stall'
  | 'hand_sanitizer'
  | 'call_light'
  | 'sharps_bin'
  | 'med_cabinet'
  | 'fridge'
  | 'microwave'
  | 'coffee_maker'
  | 'sofa'
  | 'plant'
  | 'rack'
  | 'crates'
  | 'plastic_sheeting'
  | 'ceiling_pipes'
  | 'floor_drain'
  | 'badge_reader'
  | 'glass_partition'
  | 'security_monitor'
  | 'radio'
  | 'puddle'
  | 'maintenance_tag';

export interface PropDef {
  id: string;
  type: PropType;
  room: RoomId;
  pos: Vec3;
  rotY: number;
  scale?: number;
  /** type-specific options (e.g. chair_row count, sign text, monitor screen type) */
  params?: Record<string, unknown>;
  /** registered with the interaction system */
  interactable?: boolean;
  /** blocks movement (AABB) */
  solid?: boolean;
  /** approximate footprint for collision (w along local x, d along local z) */
  footprint?: { w: number; d: number };
}

export interface CameraDef {
  id: string;
  /** on-screen label e.g. "CAM 03 — EAST HALL" */
  name: string;
  room: RoomId;
  pos: Vec3;
  lookAt: Vec3;
  fov: number;
  /** stays online when the generator takes over */
  survivesBlackout: boolean;
  /** breaker zone that powers it */
  zone?: ZoneId;
}

export interface WaypointDef {
  id: string;
  pos: Vec2;
  room: RoomId;
  links: string[];
}

export interface SpawnDef { pos: Vec3; yaw: number; room: RoomId }

export interface HospitalLayout {
  wallThickness: number;
  rooms: RoomDef[];
  doors: DoorDef[];
  lights: LightFixtureDef[];
  props: PropDef[];
  cameras: CameraDef[];
  waypoints: WaypointDef[];
  spawn: Record<CharacterId, SpawnDef>;
  /** named points used by the director/cinematics (e.g. 'tv', 'exam3_door') */
  points: Record<string, Vec3>;
}

/** 0..1 each. Drives post-processing, audio filtering, and which presentation of an event a character gets. */
export interface PerceptionState {
  anxiety: number;
  fatigue: number;
  medication: number;
  fear: number;
  injury: number;
  stress: number;
}

export interface CharacterState {
  id: CharacterId;
  name: string;
  role: string;
  location: RoomId;
  position: Vec3;
  yaw: number;
  perception: PerceptionState;
  /** 0..1, rises when something is happening to them off-screen. 1 = lost. */
  danger: number;
  alive: boolean;
  missing: boolean;
  flashlight: boolean;
  hasFlashlight: boolean;
  /** short status line for the switcher UI, e.g. "Waiting — Bay 3" */
  status: string;
  /** last time (game minutes) the player controlled them */
  lastControlled: number;
}

export interface ScheduleEntry {
  /** game minutes since shift start (22:45 = 0) */
  time: number;
  room: RoomId;
  pos?: Vec2;
  yaw?: number;
  /** idle animation hint: 'sit' | 'stand' | 'work' | 'mop' | 'phone' | 'lie' */
  action?: string;
}

export type ClueSupport = 'rational' | 'supernatural' | 'ambiguous';
export type ClueKind = 'physical' | 'record' | 'footage' | 'testimony' | 'infrastructure';

export interface Clue {
  id: string;
  title: string;
  text: string;
  source: ViewId;
  /** game minutes */
  time: number;
  kind: ClueKind;
  supports: ClueSupport;
}

export interface Choice {
  id: string;
  label: string;
  time: number;
  value: string;
}

export type FlagValue = boolean | number | string;
export type Flags = Record<string, FlagValue>;

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  motionEffects: boolean;
  filmGrain: boolean;
  reducedFlicker: boolean;
  subtitles: boolean;
  mouseSensitivity: number;
  invertY: boolean;
  difficulty: Difficulty;
  quality: 'auto' | 'low' | 'medium' | 'high';
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  motionEffects: true,
  filmGrain: true,
  reducedFlicker: false,
  subtitles: true,
  mouseSensitivity: 1,
  invertY: false,
  difficulty: 'normal',
  quality: 'auto',
};

export interface GameState {
  screen: Screen;
  /** Night Seed code shown on the title/ending screen, e.g. "NS-7F3A-21" */
  seed: string;
  /** hidden */
  scenario: ScenarioType;
  /** game minutes since 22:45 (0..180) */
  time: number;
  /** real seconds spent in 'playing' */
  realElapsed: number;
  phase: GamePhase;
  power: PowerState;
  sound: SoundState;
  activeView: ViewId;
  /** CCTV camera id when activeView === 'cctv' */
  activeCamera: string | null;
  /** last character controlled before entering CCTV (returns there on exit) */
  lastCharacter: CharacterId;
  characters: Record<CharacterId, CharacterState>;
  /** event ids */
  fired: string[];
  witnessed: string[];
  missed: string[];
  clues: Clue[];
  choices: Choice[];
  flags: Flags;
  /** global threat level 0..1 (drives THREAT audio and UI warnings) */
  threat: number;
  /** breaker zones currently energised */
  zones: Record<ZoneId, boolean>;
  ending: EndingId | null;
  settings: Settings;
  paused: boolean;
  /** movement/interaction disabled (cinematic, document open, transition) */
  inputLocked: boolean;
  /** true once the opening cinematic has played this run */
  introDone: boolean;
}

/** Shift timeline constants (game minutes). */
export const SHIFT_START_HOUR = 22; // 22:45
export const SHIFT_START_MINUTE = 45;
export const SHIFT_LENGTH_MINUTES = 180; // → 01:45
/** game seconds per real second (6 → a 30 real-minute shift) */
export const DEFAULT_TIME_SCALE = 6;

/** Phase boundaries in game minutes since shift start. */
export const PHASE_STARTS: Record<GamePhase, number> = {
  normal: 0,          // 22:45
  unease: 20,         // 23:05
  contradictions: 50, // 23:35
  outage: 80,         // 00:05
  generator: 83,      // 00:08
  crisis: 125,        // 00:50
  resolution: 165,    // 01:30
};

export const PHASE_ORDER: readonly GamePhase[] = [
  'normal', 'unease', 'contradictions', 'outage', 'generator', 'crisis', 'resolution',
] as const;

export function phaseForTime(t: number): GamePhase {
  let current: GamePhase = 'normal';
  for (const phase of PHASE_ORDER) {
    if (t >= PHASE_STARTS[phase]) current = phase;
  }
  return current;
}

/** Breaker zones available on Paul's panel (load shedding on the generator). */
export const ZONES = [
  'corridor_w',
  'corridor_e',
  'exam',
  'public',
  'service',
  'cctv',
  'west_wing',
] as const;
export type ZoneId = (typeof ZONES)[number];
