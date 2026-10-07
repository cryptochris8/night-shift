/**
 * The anomaly pool. Each entry is a GameEventDef the director schedules by seed. Presentations are
 * per perspective and deliberately small — most are deniable. CCTV `truth` shows the real thing
 * only in scenarios where the event is objectively real (realIn); `cctv` is the clean or merely
 * glitchy version. Physical changes (decals, moved props) happen whoever is watching.
 */
import type { EventPresentation, EventRunContext, GameEventDef, Services } from '../core/contracts';
import type { CharacterId, RoomId, ScenarioType, Vec2, Vec3, ViewId } from '../core/types';
import { ROOM_BY_ID, roomCenter } from '../world/layout';
import { FLAGS, LINES, SUBFLAGS } from '../story/content';
import type { StoryApi } from './Director';
import * as fx from './anomalies.fx';
import { v3 } from './anomalies.fx';

let api: StoryApi | null = null;

/** The director hands over its StoryApi before the schedule runs. */
export function bindAnomalies(a: StoryApi): void {
  api = a;
  fx.setFxApi(a);
}

const REAL: ScenarioType[] = ['supernatural', 'mixed'];
const EVERYONE: CharacterId[] = ['john', 'susie', 'paul'];
const ALL_VIEWS: ViewId[] = ['john', 'susie', 'paul', 'cctv'];

const flag = (s: Services, key: string): boolean => fx.flagOn(s, key);

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

const DRIP = v3(-8.3, 2.45, 7.0);
const LEAK_FLOOR: Vec2 = { x: -8.3, z: 7.0 };
const WING_DOOR_IN: Vec2 = { x: -11.0, z: 7.0 };
const DRAIN: Vec2 = { x: -6.0, z: 7.0 };
const VENDING = v3(-9.5, 1.0, -9.3);
const CAB_CENTRE = v3(16, 0, -2.4);
const CAB_DOORS = v3(16, 1.2, -1.5);
const HALL_FIGURE = v3(14.5, 0, 0.3);
const WATCHER = v3(15.5, 0, 0.3);
const EXAM3_DOOR_OUT = v3(-7.7, 0, 0.6);
const EXAM3_MONITOR = v3(-6.3, 1.35, 4.9);
const EXAM3_BED = v3(-7.3, 1.0, 4.1);
const EXAM2_MONITOR = v3(-11.9, 1.35, 4.9);
const EXAM2_BED = v3(-12.9, 0.8, 4.1);
const EXAM4_DOOR_OUT: Vec2 = { x: -3.7, z: 0.6 };
const EXAM4_INSIDE: Vec2 = { x: -3.7, z: 2.6 };
const TX1_DOOR = v3(4.3, 1.0, 1.5);
const STATION_BOARD = v3(-2.8, 2.0, -5.55);
const GLASS_OUTSIDE = v3(-21.6, 0, -6.5);
const RAY_SMOKE = v3(-22.4, 0, -5.6);
const MIRROR = v3(11.65, 1.5, -2.3);
const GEN_CAM = v3(17.6, 3.2, 13.6);

/** Where each event happens — the director uses this for witness checks. */
const POINT: Record<string, Vec3> = {
  footsteps_exam3: v3(-7.7, 1.2, 0.6),
  call_light_exam1: v3(-17.5, 2.35, 1.35),
  wheelchair_moves: v3(7.6, 0.6, 1.0),
  elevator_empty_cab: CAB_DOORS,
  wet_footprints_service: v3(-8.5, 0.3, 7),
  monitor_name_mismatch: EXAM2_MONITOR,
  name_call_john: v3(-7.7, 1.5, 3.0),
  vending_drop_nobody: VENDING,
  okafor_wander: v3(2, 1.0, 0.4),
  alvarez_question: EXAM2_BED,
  hall_figure_echo: v3(14.5, 1.0, 0.3),
  lights_cascade_service: v3(5, 2.5, 7),
  monitor_hr_zero: EXAM3_MONITOR,
  mirror_lag: MIRROR,
  intercom_wrong_page: v3(0, 2.6, 0),
  wrong_direction_footsteps: v3(0, 1.0, -6.4),
  two_cameras_same_person: v3(0, 1.1, 0),
  figure_outside_glass: v3(-21.6, 1.0, -6.5),
  enters_room_not_inside: TX1_DOOR,
  timestamp_jump: v3(19.6, 2.55, -1.2),
  figure_behind_paul_cam: v3(13, 1.0, 10.5),
  figure_door_gap: v3(-7.7, 1.0, 0.8),
  shadow_wrong: v3(-8.6, 1.0, 2.05),
  ceiling_drag: v3(0, 2.8, -3.6),
  exam1_haze: v3(-17.5, 1.5, 3.6),
  bed_moved_tx1: v3(4.7, 0.6, 4.1),
  wet_floor_sign_moves: v3(11.2, 0.5, 0.6),
  child_laugh_closed_wing: v3(-12.6, 1.2, 7),
  vending_hum_stops_drop: VENDING,
  drag_marks_generator: v3(11.5, 0.3, 9.0),
  unknown_text: EXAM3_BED,
  radio_name_paul: v3(-6.9, 1.1, 10.8),
  figure_watching_station: v3(15.5, 1.0, 0.3),
};

export function anomalyPoint(id: string): Vec3 {
  const p = POINT[id];
  if (p) return { x: p.x, y: p.y, z: p.z };
  const def = ANOMALY_BY_ID.get(id);
  if (def) {
    const c = roomCenter(ROOM_BY_ID[def.room]);
    return { x: c.x, y: 1.5, z: c.z };
  }
  return { x: 0, y: 1.5, z: 0 };
}

// ---------------------------------------------------------------------------
// Shared routines
// ---------------------------------------------------------------------------

function linePts(a: Vec2, b: Vec2, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 0 : i / (n - 1);
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

/** Same presentation for every perspective (physical events that happen whoever is watching). */
function everywhere(run: EventPresentation['run'], subtitle?: string): GameEventDef['presentation'] {
  const p: EventPresentation = subtitle ? { run, subtitle } : { run };
  return { any: p, cctv: p, truth: p };
}

/** The director keeps Mr. Okafor lying in Bay 4; hide that body while our copy walks the hall. */
function hideOkaforBed(s: Services): (() => void) | null {
  for (const id of ['okafor', 'npc_okafor', 'mr_okafor', 'okafor_bed', 'patient_okafor', 'fig_okafor']) {
    const f = s.characters.getFigure(id);
    if (f && !f.removed) {
      f.setVisibleTo([]);
      return () => f.setVisibleTo(ALL_VIEWS);
    }
  }
  return null;
}

/** Mr. Okafor shuffles through the corridor and back to Bay 4. Resolves true if the active view saw him. */
async function okaforInHall(s: Services, opts: { start: Vec2; path: Vec2[]; linger: number; speak: boolean }): Promise<boolean> {
  const restore = hideOkaforBed(s);
  void s.world.setDoorOpen('d_exam4', true);
  const fig = s.characters.spawnFigure({
    id: 'okafor_wander',
    pos: v3(opts.start.x, 0, opts.start.z),
    yaw: fx.yawToward(opts.start, opts.path[0] ?? EXAM4_DOOR_OUT),
    outfit: 'patient',
    anim: 'slow',
    path: opts.path,
    speed: 0.55,
    duration: 0,
    visibleTo: ALL_VIEWS,
    scale: 1.04,
  });
  let seen = false;
  void fx.watchSeen(fig, opts.linger + 25, () => {
    seen = true;
  });
  if (opts.speak) {
    await fx.wait(2.5);
    if (fx.activeIn(s, ['corridor', 'nurse_station'])) {
      const o = fig.object.position;
      s.audio.murmur(v3(o.x, 1.5, o.z), 2.2, { pitch: 0.8 });
      fx.say(s, LINES.okafor.hallway, 3.5, 'Mr. Okafor');
    }
  }
  await fx.wait(opts.linger);
  await fig.walkTo(EXAM4_DOOR_OUT, 0.55);
  await fig.walkTo(EXAM4_INSIDE, 0.55);
  fig.remove(0.5);
  void s.world.setDoorOpen('d_exam4', false);
  if (restore) restore();
  return seen;
}

/** The elevator arrives on its own and opens on a lit, empty cab. */
async function emptyCab(ctx: EventRunContext, withFigure: boolean): Promise<void> {
  const s = ctx.s;
  fx.sfx(s, 'elevator_tone', CAB_DOORS, 0.7);
  await fx.wait(0.6);
  await s.world.setElevator(true, true);
  fx.setFlag(s, SUBFLAGS.elevator_opened_empty);
  if (withFigure) fx.injectSilhouette(s, 'cam_elevator', CAB_CENTRE, 2, Math.PI);
  if (fx.onCam(s, 'cam_elevator')) {
    fx.addClue(s, 'clue_elevator');
    if (withFigure) {
      fx.setFlag(s, FLAGS.figure_cctv_frames);
      s.cctv.markFootage('cam_elevator', 'Cab opens — something inside');
    }
  } else if (fx.activeIn(s, ['corridor', 'nurse_station', 'restroom'])) {
    await fx.wait(1.2);
    const who = fx.activeChar(s);
    if (who === 'john') fx.say(s, LINES.anomalies.elevatorEmptyJohn, 3.5);
    else fx.say(s, LINES.anomalies.elevatorEmpty, 3, who === 'susie' ? 'Susie' : 'Paul');
    if (who) fx.nudge(s, who, { anxiety: 0.04 });
  }
  await fx.wait(7);
  await s.world.setElevator(false, true);
}

/** A bottle drops with nobody at the machine (powered: the glow stutters; dead: it should not be possible). */
async function vendingDrop(ctx: EventRunContext, dead: boolean): Promise<void> {
  const s = ctx.s;
  if (fx.onCam(s, 'cam_waiting')) s.cctv.glitch('cam_waiting', 'skip', 0.4);
  if (!dead) {
    s.lighting.setGlow('waiting_vend', false);
    await fx.wait(0.3);
    s.lighting.setGlow('waiting_vend', true);
  }
  fx.sfx(s, 'vending_drop', VENDING, 0.6);
  fx.setFlag(s, SUBFLAGS.vending_dropped);
  if (fx.activeIn(s, ['waiting'])) {
    await fx.wait(0.4);
    fx.say(s, dead ? LINES.anomalies.deadMachineDrop : LINES.anomalies.vendingDrop, 3);
  }
  if (fx.onCam(s, 'cam_waiting')) s.cctv.markFootage('cam_waiting', 'Vending machine drops a bottle, nobody near');
  fx.hotspot(s, {
    id: 'take_bottle',
    pos: v3(-9.6, 0.5, -8.95),
    room: 'waiting',
    who: 'all',
    prompt: 'Take bottle',
    expires: 900,
    use: (c) => {
      fx.say(s, LINES.anomalies.bottleTray, 3.5);
      fx.nudge(s, c, { anxiety: 0.03 });
    },
  });
}

/** John's reflection in the restroom mirror runs half a second late. Also used by the sink interactable. */
export async function runMirrorLag(s: Services): Promise<void> {
  fx.setFlag(s, SUBFLAGS.mirror_lag_done);
  fx.setFlag(s, SUBFLAGS.mirror_lag_armed, false);
  s.lighting.flicker('restroom', 1.6, 0.7);
  await fx.wait(0.5);
  fx.sfx(s, 'glass_tap', MIRROR, 0.5);
  s.postfx.pulse('glitch', 0.35);
  fx.say(s, LINES.anomalies.mirror, 3.5);
  fx.nudge(s, 'john', { fear: 0.18, anxiety: 0.08 });
}

/** The figure at the waiting-room glass: Ray smoking in grounded nights, something else otherwise. */
async function glassFigure(ctx: EventRunContext): Promise<void> {
  const s = ctx.s;
  const who = ctx.view;
  if (who !== 'john' && who !== 'susie') return;
  const c = s.store.char(who);
  const nearGlass = c.location === 'waiting' || (c.location === 'corridor' && c.position.x < -14);
  if (!nearGlass) return;
  const sc = fx.scenarioOf(s);
  if (sc === 'grounded') {
    if (s.store.get().power !== 'normal') return;
    const ray = s.characters.spawnFigure({ id: 'ray_smoke', pos: RAY_SMOKE, yaw: -Math.PI / 2, outfit: 'security', anim: 'idle', duration: 26, visibleTo: ALL_VIEWS });
    await fx.watchSeen(ray, 26, () => fx.say(s, LINES.anomalies.outsideGlassRay, 3));
    return;
  }
  const real = fx.isReal(s);
  const fig = s.characters.spawnFigure({
    id: 'glass_figure',
    pos: GLASS_OUTSIDE,
    yaw: -Math.PI / 2,
    outfit: 'dark',
    anim: 'stand_still',
    opacity: 0.85,
    visibleTo: real ? ALL_VIEWS : [who],
    vanishWhenUnseen: 2.5,
    duration: 16,
  });
  fx.setFlag(s, SUBFLAGS.figure_at_glass);
  await fx.watchSeen(fig, 16, () => {
    fx.say(s, LINES.anomalies.outsideGlass, 4);
    fx.nudge(s, who, { fear: 0.2, anxiety: 0.08 });
    fx.sfx(s, 'thunder', null, 0.25);
    if (who === 'john') fx.setFlag(s, FLAGS.figure_seen_john);
  });
}

const DOUBLE_SPOTS: Record<string, { pos: Vec3; yaw: number }> = {
  cam_waiting: { pos: v3(-17.6, 0, -3.0), yaw: Math.PI },
  cam_hall_w: { pos: v3(11.5, 0, 0.4), yaw: Math.PI / 2 },
  cam_hall_e: { pos: v3(-12.5, 0, -0.3), yaw: -Math.PI / 2 },
  cam_station: { pos: v3(-3.4, 0, -4.6), yaw: Math.PI / 2 },
  cam_elevator: { pos: v3(12.5, 0, 0.4), yaw: Math.PI / 2 },
  cam_service: { pos: v3(-1, 0, 7), yaw: -Math.PI / 2 },
  cam_bay: { pos: v3(-26, 0, -2.5), yaw: 0 },
  cam_generator: { pos: v3(12.2, 0, 10.2), yaw: 0.4 },
};

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

export const ANOMALIES: GameEventDef[] = [
  // ───────────────────────────── Phase 2 — Unease ─────────────────────────────
  {
    id: 'footsteps_exam3',
    title: 'Footsteps outside Bay 3',
    window: [22, 48],
    scenarios: 'all',
    realIn: REAL,
    room: 'exam3',
    characters: ['john'],
    offscreen: false,
    chance: 0.9,
    priority: 3,
    requires: (s) => flag(s, FLAGS.john_roomed) && !flag(s, FLAGS.john_left_room),
    tags: ['audio', 'subtle'],
    presentation: {
      john: {
        subtitle: LINES.anomalies.footstepsNoOne,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'john', ['exam3'])) return;
          await fx.footsteps(s, v3(-12.5, 0, 0.5), EXAM3_DOOR_OUT, 7, 0.52, 'footstep_tile', 0.42, ctx.rng);
          await fx.wait(1.4);
          fx.say(s, LINES.anomalies.footstepsNoOne, 3);
          fx.nudge(s, 'john', { fear: 0.08, anxiety: 0.04 });
        },
      },
      cctv: {
        run: (ctx) => {
          if (fx.onCam(ctx.s, 'cam_hall_w')) ctx.s.cctv.glitch('cam_hall_w', 'skip', 0.6);
        },
      },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          fx.injectSilhouette(s, 'cam_hall_w', v3(-7.7, 0, 0.5), 2, Math.PI);
          if (fx.onCam(s, 'cam_hall_w')) {
            fx.setFlag(s, FLAGS.figure_cctv_frames);
            s.cctv.markFootage('cam_hall_w', 'Figure outside Bay 3');
          }
        },
      },
    },
  },
  {
    id: 'call_light_exam1',
    title: 'Call light in empty Bay 1',
    window: [24, 46],
    scenarios: 'all',
    room: 'nurse_station',
    characters: ['susie'],
    offscreen: true,
    chance: 0.9,
    priority: 2,
    tags: ['physical'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      s.world.setCallLight('exam1', true);
      fx.sfx(s, 'call_light', STATION_BOARD, 0.5);
      fx.setFlag(s, SUBFLAGS.exam1_call_on);
      // the bed is 40 cm off its marks — moved while nobody can be in there
      void s.world.moveProp('exam1_bed', v3(-16.7, 0, 4.1), 0.12, 0);
      fx.hotspot(s, {
        id: 'exam1_call_reset',
        pos: v3(-17.1, 1.0, 4.1),
        room: 'exam1',
        who: ['susie', 'paul'],
        prompt: 'Reset call light',
        use: (c) => {
          s.world.setCallLight('exam1', false);
          fx.setFlag(s, SUBFLAGS.exam1_call_on, false);
          fx.sfx(s, 'call_light', v3(-17.5, 2.35, 1.35), 0.3);
          fx.say(s, LINES.anomalies.bedMoved, 3.5);
          fx.nudge(s, c, { fear: 0.06, stress: 0.04 });
        },
      });
      await fx.wait(0.8);
      if (fx.activeChar(s) === 'susie' && fx.activeIn(s, ['nurse_station', 'corridor'])) fx.say(s, LINES.anomalies.callLightEmpty, 3.5, 'Susie');
    }),
  },
  {
    id: 'wheelchair_moves',
    title: 'The hall wheelchair is somewhere else',
    window: [26, 49],
    scenarios: 'all',
    room: 'corridor',
    characters: EVERYONE,
    offscreen: true,
    chance: 0.85,
    priority: 1,
    tags: ['physical', 'subtle'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      const doMove = async (): Promise<void> => {
        await s.world.moveProp('hall_wheelchair', v3(4.2, 0, 0.95), Math.PI + 0.9, 0);
        fx.setFlag(s, SUBFLAGS.wheelchair_moved);
        fx.hotspot(s, {
          id: 'wheelchair_look',
          pos: v3(4.2, 0.7, 0.95),
          room: 'corridor',
          who: 'all',
          prompt: 'Look at wheelchair',
          expires: 600,
          use: () => fx.say(s, LINES.anomalies.wheelchair, 3.5),
        });
      };
      const cam = fx.currentCam(s);
      if (cam === 'cam_hall_e' || cam === 'cam_hall_w') {
        // between two frames
        s.cctv.glitch(cam, 'skip', 0.5);
        await fx.wait(0.25);
        await doMove();
        fx.addClue(s, 'clue_wheelchair');
        return;
      }
      fx.moveWhenUnobserved(s, v3(7.6, 0.6, 1.0), 120, doMove);
    }),
  },
  {
    id: 'elevator_empty_cab',
    title: 'Elevator opens on an empty cab',
    window: [33, 34],
    scenarios: 'all',
    realIn: REAL,
    room: 'corridor',
    characters: EVERYONE,
    offscreen: true,
    chance: 1,
    priority: 5,
    tags: ['physical'],
    presentation: {
      any: { run: (ctx) => emptyCab(ctx, false) },
      cctv: { run: (ctx) => emptyCab(ctx, false) },
      truth: { run: (ctx) => emptyCab(ctx, true) },
    },
  },
  {
    id: 'wet_footprints_service',
    title: 'Wet floor by the west wing door',
    window: [24, 48],
    scenarios: 'all',
    realIn: REAL,
    room: 'service_n',
    characters: ['paul'],
    offscreen: true,
    chance: 1,
    priority: 4,
    tags: ['physical', 'clue'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      if (fx.isReal(s)) {
        const remove = s.world.addFloorDecal('footprints', linePts(WING_DOOR_IN, DRAIN, 9));
        fx.addWetSpot({ id: 'wing_footprints', room: 'service_n', point: { x: -8.5, z: 7 }, kind: 'footprints', remove });
        fx.hotspot(s, {
          id: 'inspect_footprints',
          pos: v3(-8.6, 0.3, 7),
          room: 'service_n',
          who: ['paul'],
          prompt: 'Inspect footprints',
          use: () => {
            fx.addClue(s, 'clue_footprints_out');
            fx.say(s, LINES.anomalies.footprintsOut, 4);
            fx.nudge(s, 'paul', { fear: 0.15, anxiety: 0.05 });
          },
        });
        if (fx.activeChar(s) === 'paul' && fx.activeIn(s, ['service_n'])) {
          await fx.wait(1);
          fx.say(s, LINES.anomalies.footprintsOut, 4);
        }
        return;
      }
      // grounded / psychological: a roof leak, dripping onto the concrete
      fx.trackLoop(fx.sfx(s, 'water_drip', DRIP, 0.35, { loop: true, fadeIn: 2 }));
      const puddle = s.world.addFloorDecal('puddle', [LEAK_FLOOR]);
      const smear = s.world.addFloorDecal('scuff', linePts(LEAK_FLOOR, DRAIN, 4));
      fx.addWetSpot({
        id: 'service_leak',
        room: 'service_n',
        point: LEAK_FLOOR,
        kind: 'leak',
        remove: () => {
          puddle();
          smear();
        },
      });
      fx.hotspot(s, {
        id: 'inspect_leak',
        pos: v3(-8.3, 1.3, 7),
        room: 'service_n',
        who: ['paul'],
        prompt: 'Look up',
        use: () => {
          fx.addClue(s, 'clue_roof_leak');
          fx.say(s, LINES.anomalies.leakGrounded, 4);
        },
      });
      if (fx.activeChar(s) === 'paul' && fx.activeIn(s, ['service_n'])) {
        await fx.wait(1);
        fx.say(s, LINES.anomalies.leakGrounded, 4);
      }
    }),
  },
  {
    id: 'monitor_name_mismatch',
    title: "Bay 2's monitor shows the wrong name",
    window: [26, 49],
    scenarios: 'all',
    room: 'exam2',
    characters: ['susie'],
    offscreen: false,
    chance: 0.9,
    priority: 2,
    tags: ['record', 'subtle'],
    presentation: {
      susie: {
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'susie', ['exam2', 'corridor'])) return;
          s.world.setScreen('exam2_monitor', 'mismatch');
          fx.sfx(s, 'monitor_beep', EXAM2_MONITOR, 0.25);
          await fx.wait(2.2);
          s.world.setScreen('exam2_monitor', 'vitals');
          fx.say(s, LINES.anomalies.nameMismatch, 4);
          fx.nudge(s, 'susie', { fear: 0.08, stress: 0.05 });
        },
      },
    },
  },
  {
    id: 'name_call_john',
    title: 'John hears his name from the wall side',
    window: [24, 49],
    scenarios: 'all',
    room: 'exam3',
    characters: ['john'],
    offscreen: false,
    chance: 0.9,
    priority: 3,
    tags: ['audio'],
    presentation: {
      john: {
        subtitle: LINES.anomalies.nameCall,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'john', ['exam3', 'waiting', 'triage'])) return;
          fx.sfx(s, 'name_call', fx.offsetFromViewer(s, -2.6, 0.6, 0.1), 0.55, { rate: 0.96 });
          await fx.wait(0.5);
          fx.say(s, LINES.anomalies.nameCall, 3);
          fx.setFlag(s, SUBFLAGS.john_heard_name);
          fx.addClue(s, 'clue_name_call');
          fx.nudge(s, 'john', { fear: 0.1, anxiety: 0.06 });
        },
      },
    },
  },
  {
    id: 'vending_drop_nobody',
    title: 'Vending machine drops a bottle',
    window: [22, 48],
    scenarios: 'all',
    room: 'waiting',
    characters: EVERYONE,
    offscreen: true,
    chance: 0.85,
    priority: 1,
    tags: ['audio', 'physical'],
    presentation: everywhere((ctx) => vendingDrop(ctx, false)),
  },
  {
    id: 'okafor_wander',
    title: 'Mr. Okafor in the hallway',
    window: [30, 48],
    scenarios: 'all',
    room: 'corridor',
    characters: ['susie'],
    offscreen: true,
    chance: 0.9,
    priority: 2,
    requires: (s) => !flag(s, SUBFLAGS.okafor_wandered),
    tags: ['people', 'clue'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      fx.setFlag(s, SUBFLAGS.okafor_wandered);
      const seen = await okaforInHall(s, {
        start: EXAM4_DOOR_OUT,
        path: [{ x: 2, z: 0.4 }, { x: 8, z: 0.5 }],
        linger: 14,
        speak: true,
      });
      if (seen) fx.addClue(s, 'clue_okafor_wander');
    }),
  },
  {
    id: 'alvarez_question',
    title: 'Mrs. Alvarez asks about the man at her door',
    window: [36, 49],
    scenarios: 'all',
    room: 'exam2',
    characters: ['susie'],
    offscreen: false,
    chance: 1,
    priority: 6,
    requires: (s) => !flag(s, SUBFLAGS.alvarez_man),
    tags: ['dialogue', 'clue'],
    presentation: {
      susie: {
        subtitle: LINES.alvarez.question,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'susie', ['exam2'])) return;
          s.audio.murmur(EXAM2_BED, 2.4, { pitch: 1.15 });
          fx.say(s, LINES.alvarez.question, 3.5, 'Mrs. Alvarez');
          await fx.wait(3.8);
          s.audio.murmur(EXAM2_BED, 2.6, { pitch: 1.15 });
          fx.say(s, LINES.alvarez.detail, 4, 'Mrs. Alvarez');
          await fx.wait(4.3);
          fx.say(s, LINES.alvarez.susieReply, 3.5, 'Susie');
          fx.setFlag(s, SUBFLAGS.alvarez_man);
          fx.addClue(s, 'clue_alvarez_man');
          fx.nudge(s, 'susie', { stress: 0.08, anxiety: 0.05 });
        },
      },
    },
  },

  // ─────────────────────────── Phase 3 — Contradictions ───────────────────────────
  {
    id: 'hall_figure_echo',
    title: 'Someone at the east end of the hall',
    window: [61, 78],
    scenarios: 'all',
    realIn: REAL,
    room: 'exam3',
    characters: ['john', 'susie'],
    offscreen: false,
    chance: 1,
    priority: 9,
    requires: (s) => flag(s, FLAGS.john_roomed) && !flag(s, FLAGS.figure_seen_john),
    tags: ['figure', 'key'],
    presentation: {
      john: {
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'john', ['exam3', 'corridor'])) return;
          void s.world.setDoorOpen('d_exam3', true);
          const fig = s.characters.spawnFigure({
            id: 'hall_figure',
            pos: HALL_FIGURE,
            yaw: Math.PI / 2,
            outfit: 'dark',
            anim: 'stand_still',
            visibleTo: ['john'],
            opacity: 0.96,
            vanishWithin: 7,
            vanishWhenUnseen: 3,
            duration: 45,
          });
          const seen = await fx.watchSeen(fig, 45, () => {
            fx.setFlag(s, FLAGS.figure_seen_john);
            fx.say(s, LINES.figure.johnSees, 4);
            fx.nudge(s, 'john', { fear: 0.25, anxiety: 0.1 });
            s.postfx.pulse('heartbeat', 0.6);
          });
          if (seen) {
            await fx.untilGone(fig, 45);
            fx.say(s, LINES.figure.johnGone, 2);
          }
        },
      },
      susie: {
        run: async (ctx) => {
          const s = ctx.s;
          if (fx.scenarioOf(s) === 'grounded') {
            // the plausible source: a tall patient in a gown, shuffling back to his bay
            const seen = await okaforInHall(s, { start: { x: 9, z: 0.4 }, path: [{ x: 2, z: 0.4 }], linger: 6, speak: false });
            if (seen) {
              fx.say(s, LINES.figure.susieOkafor, 3, 'Susie');
              fx.addClue(s, 'clue_okafor_wander');
            }
            return;
          }
          if (fx.charIn(s, 'susie', ['corridor', 'nurse_station'])) s.lighting.flicker('corridor', 0.9, 0.4);
        },
      },
      cctv: {
        run: (ctx) => {
          if (fx.onCam(ctx.s, 'cam_hall_e')) ctx.s.cctv.glitch('cam_hall_e', 'tear', 0.5);
        },
      },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          fx.injectSilhouette(s, 'cam_hall_e', HALL_FIGURE, 2, Math.PI / 2);
          if (fx.onCam(s, 'cam_hall_e')) {
            fx.setFlag(s, FLAGS.figure_cctv_frames);
            fx.addClue(s, 'clue_two_frames');
            s.cctv.markFootage('cam_hall_e', 'Two frames — figure, east hall');
          }
        },
      },
    },
  },
  {
    id: 'lights_cascade_service',
    title: 'The service hall goes dark toward Paul',
    window: [63, 78],
    scenarios: 'all',
    room: 'service_n',
    characters: ['paul'],
    offscreen: false,
    chance: 1,
    priority: 7,
    tags: ['light'],
    presentation: {
      paul: {
        subtitle: LINES.anomalies.cascade,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'paul', ['service_n'])) return;
          const p = fx.charPos(s, 'paul');
          await s.lighting.cascadeOff('service_n', { x: p.x, z: p.z }, 0.55);
          fx.say(s, LINES.anomalies.cascade, 3);
          fx.nudge(s, 'paul', { fear: 0.12, anxiety: 0.06 });
          fx.setFlag(s, SUBFLAGS.service_cascade_done);
          await fx.wait(1.5);
          fx.sfx(s, 'radio_click', null, 0.5);
          await fx.wait(0.4);
          fx.say(s, LINES.radio.flickers, 3.5, 'Marcus (radio)');
          await fx.wait(5);
          s.lighting.setRoomLights('service_n', 'flicker', 2.5);
          fx.sfx(s, 'light_buzz', v3(p.x, 2.5, 7), 0.4);
          await fx.wait(2.6);
          s.lighting.setRoomLights('service_n', 'on');
          fx.sfx(s, 'light_on', v3(p.x, 2.5, 7), 0.35);
        },
      },
    },
  },
  {
    id: 'monitor_hr_zero',
    title: 'HR 0 while John is talking',
    window: [55, 79],
    scenarios: 'all',
    realIn: REAL,
    room: 'exam3',
    characters: ['susie'],
    offscreen: false,
    chance: 0.95,
    priority: 6,
    requires: (s) => flag(s, FLAGS.john_roomed) && !flag(s, FLAGS.john_left_room),
    tags: ['record', 'clue'],
    presentation: {
      susie: {
        subtitle: LINES.anomalies.hrZero,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'susie', ['exam3'])) return;
          fx.setFlag(s, SUBFLAGS.vitals_impossible_live);
          s.world.setScreen('exam3_monitor', 'flat');
          fx.sfx(s, 'monitor_flat', EXAM3_MONITOR, 0.45);
          fx.say(s, LINES.anomalies.hrZero, 3);
          await fx.wait(1.3);
          s.audio.murmur(EXAM3_BED, 1.6, { pitch: 0.9 });
          fx.say(s, LINES.figure.johnWhatWasThat, 3, 'John');
          await fx.wait(1.9);
          s.world.setScreen('exam3_monitor', 'vitals');
          fx.sfx(s, 'monitor_beep', EXAM3_MONITOR, 0.3);
          fx.setFlag(s, SUBFLAGS.vitals_impossible_live, false);
          fx.addClue(s, 'clue_impossible_vitals');
          fx.nudge(s, 'susie', { stress: 0.12, fear: 0.1 });
        },
      },
    },
  },
  {
    id: 'mirror_lag',
    title: 'Mirror reflection lags',
    window: [52, 79],
    scenarios: 'all',
    room: 'restroom',
    characters: ['john'],
    offscreen: true,
    chance: 0.9,
    priority: 2,
    requires: (s) => !flag(s, SUBFLAGS.mirror_lag_done),
    tags: ['visual', 'subtle'],
    presentation: everywhere((ctx) => {
      const s = ctx.s;
      if (fx.activeChar(s) === 'john' && fx.charIn(s, 'john', ['restroom'])) return runMirrorLag(s);
      // arm it: the next time John uses the restroom sink, it happens
      fx.setFlag(s, SUBFLAGS.mirror_lag_armed);
    }),
  },
  {
    id: 'intercom_wrong_page',
    title: 'Intercom pages John to the west wing',
    window: [54, 78],
    scenarios: 'all',
    room: 'corridor',
    characters: EVERYONE,
    offscreen: true,
    chance: 0.85,
    priority: 4,
    tags: ['audio'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      fx.setFlag(s, SUBFLAGS.intercom_west_wing);
      fx.say(s, LINES.intercom.westWingPage, 4.5, 'Intercom');
      await s.audio.intercom(LINES.intercom.westWingPage, { glitch: true });
      fx.nudge(s, 'john', { fear: 0.08, anxiety: 0.05 });
      fx.nudge(s, 'susie', { stress: 0.05 });
    }),
  },
  {
    id: 'wrong_direction_footsteps',
    title: 'Footsteps behind the station wall',
    window: [52, 78],
    scenarios: 'all',
    room: 'nurse_station',
    characters: ['susie'],
    offscreen: false,
    chance: 0.85,
    priority: 2,
    tags: ['audio', 'subtle'],
    presentation: {
      susie: {
        subtitle: LINES.anomalies.wrongDirection,
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'susie', ['nurse_station'])) return;
          await fx.footsteps(s, v3(-3.2, 1.0, -6.5), v3(3.6, 1.0, -6.5), 6, 0.6, 'footstep_concrete', 0.38, ctx.rng);
          fx.say(s, LINES.anomalies.wrongDirection, 3);
          fx.nudge(s, 'susie', { stress: 0.08, fear: 0.06 });
        },
      },
    },
  },
  {
    id: 'two_cameras_same_person',
    title: 'The same person on two cameras',
    window: [56, 79],
    scenarios: 'all',
    room: 'corridor',
    characters: ['susie'],
    offscreen: false,
    chance: 0.8,
    priority: 3,
    requires: (s) => s.store.get().power === 'normal',
    tags: ['cctv'],
    presentation: (() => {
      const run = async (ctx: EventRunContext): Promise<void> => {
        const s = ctx.s;
        const cam = fx.currentCam(s);
        if (!cam) return;
        const spot = DOUBLE_SPOTS[cam];
        if (!spot) return;
        fx.injectSilhouette(s, cam, spot.pos, 5, spot.yaw, 0x1d383c, 0.92);
        await fx.wait(0.4);
        s.cctv.glitch(cam, 'tear', 0.6);
        fx.say(s, LINES.anomalies.twoCameras, 3);
        s.cctv.markFootage(cam, 'Second figure in frame');
      };
      return { cctv: { run }, truth: { run } };
    })(),
  },
  {
    id: 'figure_outside_glass',
    title: 'Someone outside the waiting room glass',
    window: [58, 124],
    scenarios: 'all',
    realIn: REAL,
    room: 'waiting',
    characters: ['john', 'susie'],
    offscreen: false,
    chance: 0.85,
    priority: 4,
    tags: ['figure'],
    presentation: {
      john: { run: glassFigure },
      susie: { run: glassFigure },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          fx.injectSilhouette(s, 'cam_bay', GLASS_OUTSIDE, 2, -Math.PI / 2);
          if (fx.onCam(s, 'cam_bay')) {
            fx.setFlag(s, FLAGS.figure_cctv_frames);
            s.cctv.markFootage('cam_bay', 'Figure at the waiting room glass');
          }
        },
      },
    },
  },
  {
    id: 'enters_room_not_inside',
    title: 'Someone goes into Treatment 1',
    window: [54, 122],
    scenarios: 'all',
    room: 'corridor',
    characters: ['susie'],
    offscreen: false,
    chance: 0.85,
    priority: 3,
    tags: ['figure'],
    presentation: {
      susie: {
        run: async (ctx) => {
          const s = ctx.s;
          const c = s.store.char('susie');
          if (c.location !== 'corridor' || c.position.x < -3 || c.position.x > 12) return;
          void s.world.setDoorOpen('d_exam5', true);
          fx.sfx(s, 'door_open', TX1_DOOR, 0.4);
          const fig = s.characters.spawnFigure({
            id: 'tx1_walker',
            pos: v3(0.8, 0, 0.3),
            yaw: -Math.PI / 2,
            outfit: 'patient',
            anim: 'walk',
            path: [{ x: 4.3, z: 0.6 }, { x: 4.3, z: 2.8 }],
            speed: 1.0,
            visibleTo: ['susie'],
          });
          await fx.wait(0.6);
          if (fig.isSeen()) fx.say(s, LINES.anomalies.entersRoom, 3);
          fx.setFlag(s, SUBFLAGS.figure_entered_exam5);
          fx.nudge(s, 'susie', { stress: 0.1, anxiety: 0.05 });
          fx.hotspot(s, {
            id: 'look_tx1',
            pos: v3(4.3, 1.2, 3.6),
            room: 'exam5',
            who: ['susie'],
            prompt: 'Look around',
            expires: 300,
            use: () => fx.say(s, LINES.anomalies.emptyRoom, 3),
          });
        },
      },
    },
  },

  // ─────────────────────────── Phase 5 — Generator night ───────────────────────────
  {
    id: 'timestamp_jump',
    title: 'Camera 03 timestamp runs backward',
    window: [90, 124],
    scenarios: 'all',
    realIn: REAL,
    room: 'corridor',
    characters: EVERYONE,
    offscreen: false,
    chance: 1,
    priority: 3,
    tags: ['cctv', 'clue'],
    presentation: {
      cctv: {
        run: (ctx) => {
          const s = ctx.s;
          s.cctv.glitch('cam_hall_e', 'timestamp', 5);
          if (fx.onCam(s, 'cam_hall_e')) s.cctv.markFootage('cam_hall_e', 'Timestamp jump');
        },
      },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          s.cctv.glitch('cam_hall_e', 'timestamp', 5);
          if (fx.onCam(s, 'cam_hall_e')) {
            fx.say(s, LINES.anomalies.timestamp, 3);
            fx.addClue(s, 'clue_timestamp_jump');
          }
        },
      },
    },
  },
  {
    id: 'figure_behind_paul_cam',
    title: 'Two frames: someone behind Paul',
    window: [86, 124],
    scenarios: 'all',
    realIn: REAL,
    room: 'generator',
    characters: ['paul'],
    offscreen: false,
    chance: 1,
    priority: 5,
    requires: (s) => s.store.char('paul').location === 'generator',
    tags: ['cctv', 'figure', 'clue'],
    presentation: {
      cctv: {
        run: (ctx) => {
          if (fx.onCam(ctx.s, 'cam_generator')) ctx.s.cctv.glitch('cam_generator', 'skip', 0.5);
        },
      },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'paul', ['generator'])) return;
          const p = fx.charPos(s, 'paul');
          const dx = p.x - GEN_CAM.x;
          const dz = p.z - GEN_CAM.z;
          const len = Math.hypot(dx, dz) || 1;
          const pos = v3(
            Math.max(10.3, Math.min(17.7, p.x + (dx / len) * 1.7)),
            0,
            Math.max(8.7, Math.min(13.7, p.z + (dz / len) * 1.7)),
          );
          fx.injectSilhouette(s, 'cam_generator', pos, 2, fx.yawToward(pos, GEN_CAM));
          if (fx.onCam(s, 'cam_generator')) {
            fx.setFlag(s, FLAGS.figure_cctv_frames);
            fx.addClue(s, 'clue_two_frames');
            s.cctv.markFootage('cam_generator', 'Two frames — figure behind Paul');
            fx.say(s, LINES.anomalies.behindPaul, 3);
          }
        },
      },
    },
  },
  {
    id: 'figure_door_gap',
    title: 'A shape passes the gap in the door',
    window: [88, 122],
    scenarios: 'all',
    realIn: REAL,
    room: 'exam3',
    characters: ['john'],
    offscreen: false,
    chance: 1,
    priority: 6,
    requires: (s) => flag(s, FLAGS.john_roomed) && !flag(s, FLAGS.john_left_room),
    tags: ['figure'],
    presentation: {
      john: {
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'john', ['exam3'])) return;
          void s.world.setDoorOpen('d_exam3', true);
          const sc = fx.scenarioOf(s);
          const real = sc === 'supernatural' || sc === 'mixed';
          const from = v3(-2.4, 0, 0.5);
          const to: Vec2 = { x: -13.5, z: 0.4 };
          const fig = s.characters.spawnFigure({
            id: 'door_gap_walker',
            pos: from,
            yaw: Math.PI / 2,
            outfit: sc === 'grounded' ? 'workwear' : 'dark',
            anim: sc === 'grounded' ? 'walk' : sc === 'psychological' ? 'wrong_gait' : 'slow',
            path: [to],
            speed: sc === 'grounded' ? 1.2 : 0.7,
            opacity: sc === 'psychological' ? 0.9 : 1,
            visibleTo: real ? ALL_VIEWS : ['john'],
          });
          if (sc === 'grounded') {
            void fx.footsteps(s, from, v3(to.x, 0, to.z), 9, 0.55, 'footstep_tile', 0.35, ctx.rng);
            fx.sfx(s, 'keys', v3(-7.7, 1.0, 0.6), 0.25);
          } else {
            void fx.footsteps(s, from, v3(to.x, 0, to.z), 5, 1.1, 'footstep_tile', 0.22, ctx.rng);
          }
          const seen = await fx.watchSeen(fig, 14, () => {
            fx.say(s, LINES.anomalies.doorGap, 3);
            fx.nudge(s, 'john', { fear: sc === 'grounded' ? 0.1 : 0.2, anxiety: 0.06 });
            if (sc !== 'grounded') fx.setFlag(s, FLAGS.figure_seen_john);
          });
          if (!seen) fx.nudge(s, 'john', { anxiety: 0.03 });
        },
      },
    },
  },
  {
    id: 'shadow_wrong',
    title: 'The shadow behind the curtain',
    window: [95, 124],
    scenarios: 'all',
    room: 'exam3',
    characters: ['john'],
    offscreen: false,
    chance: 0.9,
    priority: 4,
    requires: (s) => flag(s, FLAGS.john_roomed) && !flag(s, FLAGS.john_left_room),
    tags: ['figure', 'subtle'],
    presentation: {
      john: {
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'john', ['exam3'])) return;
          fx.sfx(s, 'curtain', v3(-7.7, 1.5, 2.6), 0.3);
          const fig = s.characters.spawnFigure({
            id: 'curtain_shadow',
            pos: v3(-8.6, 0, 2.05),
            yaw: 0,
            outfit: 'dark',
            anim: 'slow',
            opacity: 0.35,
            visibleTo: ['john'],
            duration: 6.5,
            vanishWhenUnseen: 1.5,
            scale: 1.05,
          });
          await fx.watchSeen(fig, 6.5, () => {
            fx.say(s, LINES.anomalies.shadow, 3.5);
            fx.nudge(s, 'john', { fear: 0.22 });
            s.postfx.pulse('heartbeat', 0.5);
          });
        },
      },
    },
  },
  {
    id: 'ceiling_drag',
    title: 'Dragging across the ceiling',
    window: [86, 124],
    scenarios: 'all',
    room: 'nurse_station',
    characters: EVERYONE,
    offscreen: true,
    chance: 1,
    priority: 3,
    tags: ['audio'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      const who = fx.activeChar(s);
      const base = who ? fx.cameraPos(s) : v3(0, 1.65, -3.6);
      const room: RoomId = who ? s.store.char(who).location : 'nurse_station';
      const ceil = (ROOM_BY_ID[room]?.ceiling ?? 2.8) + 0.25;
      const from = v3(base.x - 3.2, ceil, base.z + 0.8);
      const to = v3(base.x + 2.6, ceil, base.z - 0.4);
      fx.say(s, LINES.anomalies.ceilingDrag, 4);
      await fx.movingSound(s, 'drag', from, to, 4.2, 0.5);
      if (who) fx.nudge(s, who, { fear: 0.08, anxiety: 0.04 });
      await fx.wait(2.5);
      await fx.movingSound(s, 'scratch', to, fx.lerp3(to, from, 0.5), 1.8, 0.3);
    }),
  },
  {
    id: 'exam1_haze',
    title: 'Bay 1 goes cold',
    window: [88, 123],
    scenarios: 'all',
    room: 'exam1',
    characters: ['susie', 'paul'],
    offscreen: true,
    chance: 0.85,
    priority: 2,
    tags: ['visual', 'subtle'],
    presentation: everywhere(async (ctx) => {
      const s = ctx.s;
      fx.setFlag(s, SUBFLAGS.exam1_cold);
      let a = 0;
      const up = setInterval(() => {
        a = Math.min(0.65, a + 0.03);
        s.world.setRoomHaze('exam1', a);
        if (a >= 0.65) clearInterval(up);
      }, 400);
      fx.trackInterval(up);
      fx.hotspot(s, {
        id: 'exam1_thermostat',
        pos: v3(-19.3, 1.4, 3.0),
        room: 'exam1',
        who: ['susie', 'paul'],
        prompt: 'Check thermostat',
        expires: 240,
        use: (c) => {
          fx.say(s, LINES.anomalies.thermostat, 3.5);
          fx.nudge(s, c, { anxiety: 0.05 });
        },
      });
      const onEnter = (id: CharacterId): void => {
        fx.say(s, LINES.anomalies.cold, 3.5, id === 'susie' ? 'Susie' : 'Paul');
        fx.nudge(s, id, { fear: 0.08 });
      };
      const active = fx.activeChar(s);
      if (active && fx.charIn(s, active, ['exam1'])) onEnter(active);
      const off = s.bus.on('character:entered', ({ id, room }) => {
        if (room === 'exam1' && s.characters.active === id) onEnter(id);
      });
      await fx.wait(150);
      off();
      const down = setInterval(() => {
        a = Math.max(0, a - 0.02);
        s.world.setRoomHaze('exam1', a);
        if (a <= 0) clearInterval(down);
      }, 400);
      fx.trackInterval(down);
    }),
  },
  {
    id: 'bed_moved_tx1',
    title: 'The Treatment 1 bed has moved',
    window: [84, 122],
    scenarios: 'all',
    room: 'exam5',
    characters: ['susie'],
    offscreen: true,
    chance: 0.85,
    priority: 2,
    tags: ['physical', 'subtle'],
    presentation: everywhere((ctx) => {
      const s = ctx.s;
      fx.moveWhenUnobserved(s, v3(4.7, 0.6, 4.1), 150, async () => {
        await s.world.moveProp('exam5_bed', v3(4.15, 0, 3.45), 0.35, 0);
        fx.setFlag(s, SUBFLAGS.tx1_bed_moved);
        fx.hotspot(s, {
          id: 'tx1_bed_check',
          pos: v3(4.15, 1.0, 3.45),
          room: 'exam5',
          who: ['susie', 'paul'],
          prompt: 'Check bed',
          expires: 900,
          use: (c) => {
            fx.say(s, LINES.anomalies.bedMovedTx1, 4);
            fx.nudge(s, c, { stress: 0.06, anxiety: 0.04 });
          },
        });
      });
    }),
  },
  {
    id: 'wet_floor_sign_moves',
    title: 'The wet floor sign is somewhere else',
    window: [86, 124],
    scenarios: 'all',
    room: 'corridor',
    characters: EVERYONE,
    offscreen: true,
    chance: 0.8,
    priority: 1,
    tags: ['physical', 'subtle'],
    presentation: everywhere((ctx) => {
      const s = ctx.s;
      if (fx.onCam(s, 'cam_hall_e')) s.cctv.glitch('cam_hall_e', 'skip', 0.5);
      fx.moveWhenUnobserved(s, v3(11.2, 0.5, 0.6), 120, async () => {
        await s.world.moveProp('hall_wetfloor', v3(8.0, 0, 0.9), -0.3, 0);
        fx.hotspot(s, {
          id: 'wet_sign_look',
          pos: v3(8.0, 0.6, 0.9),
          room: 'corridor',
          who: 'all',
          prompt: 'Look at sign',
          expires: 600,
          use: () => fx.say(s, LINES.anomalies.wetSign, 3.5),
        });
      });
    }),
  },
  {
    id: 'child_laugh_closed_wing',
    title: 'A child laughing in the closed wing',
    window: [90, 160],
    scenarios: REAL,
    realIn: REAL,
    room: 'service_n',
    characters: ['paul'],
    offscreen: false,
    chance: 1,
    priority: 6,
    tags: ['audio', 'clue'],
    presentation: {
      paul: {
        subtitle: LINES.anomalies.childLaugh,
        run: async (ctx) => {
          const s = ctx.s;
          const c = s.store.char('paul');
          const near = c.location === 'closed_wing' || (c.location === 'service_n' && c.position.x < -3);
          if (!near) return;
          fx.sfx(s, 'child_laugh', v3(-13.2, 1.1, 7), 0.4, { rate: 0.96 });
          await fx.wait(1.3);
          s.audio.silence(2.5);
          fx.say(s, LINES.anomalies.childLaugh, 4);
          fx.addClue(s, 'clue_laughter');
          fx.nudge(s, 'paul', { fear: 0.25, anxiety: 0.1 });
          s.postfx.pulse('heartbeat', 0.6);
        },
      },
    },
  },
  {
    id: 'vending_hum_stops_drop',
    title: 'The dead vending machine drops a bottle',
    window: [84, 100],
    scenarios: 'all',
    room: 'waiting',
    characters: EVERYONE,
    offscreen: true,
    chance: 0.8,
    priority: 1,
    requires: (s) => s.store.get().power !== 'normal',
    tags: ['audio', 'physical'],
    presentation: everywhere((ctx) => vendingDrop(ctx, true)),
  },
  {
    id: 'drag_marks_generator',
    title: 'Drag marks into the generator room',
    window: [84, 124],
    scenarios: REAL,
    realIn: REAL,
    room: 'service_n',
    characters: ['paul'],
    offscreen: true,
    chance: 1,
    priority: 5,
    tags: ['physical', 'clue'],
    presentation: everywhere((ctx) => {
      const s = ctx.s;
      const pts: Vec2[] = [
        WING_DOOR_IN,
        { x: -6, z: 7.05 },
        { x: 0, z: 6.9 },
        { x: 6, z: 7.1 },
        { x: 10.4, z: 7.3 },
        { x: 11, z: 8.1 },
        { x: 11.6, z: 9.2 },
        { x: 12.3, z: 10.2 },
      ];
      s.world.addFloorDecal('drag', pts);
      const inspect = (): void => {
        fx.addClue(s, 'clue_drag_marks');
        fx.say(s, LINES.anomalies.dragMarks, 4);
        fx.nudge(s, 'paul', { fear: 0.2, anxiety: 0.08 });
        fx.removeHotspot(s, 'inspect_drag_hall');
        fx.removeHotspot(s, 'inspect_drag_gen');
      };
      fx.hotspot(s, { id: 'inspect_drag_hall', pos: v3(0, 0.3, 7), room: 'service_n', who: ['paul'], prompt: 'Inspect marks', use: inspect });
      fx.hotspot(s, { id: 'inspect_drag_gen', pos: v3(11.8, 0.3, 9.4), room: 'generator', who: ['paul'], prompt: 'Inspect marks', use: inspect });
    }),
  },
  {
    id: 'unknown_text',
    title: 'A text from an unknown number',
    window: [92, 110],
    scenarios: 'all',
    realIn: REAL,
    room: 'exam3',
    characters: ['john'],
    offscreen: true,
    chance: 0.9,
    priority: 2,
    tags: ['record'],
    // the phone interactable notices the new message and buzzes
    presentation: everywhere((ctx) => fx.setFlag(ctx.s, SUBFLAGS.unknown_text)),
  },
  {
    id: 'radio_name_paul',
    title: 'The radio says his name',
    window: [100, 150],
    scenarios: 'all',
    room: 'service_n',
    characters: ['paul'],
    offscreen: false,
    chance: 0.85,
    priority: 3,
    requires: (s) => s.store.get().power === 'generator',
    tags: ['audio'],
    presentation: {
      paul: {
        subtitle: LINES.anomalies.radioName,
        run: async (ctx) => {
          const s = ctx.s;
          if (s.characters.active !== 'paul') return;
          fx.sfx(s, 'radio_click', null, 0.5);
          await fx.wait(0.5);
          s.audio.murmur(fx.offsetFromViewer(s, 0.25, 0.3, -0.35), 1.6, { pitch: 0.72, whisper: true });
          fx.say(s, LINES.anomalies.radioName, 3, 'Radio');
          await fx.wait(1.9);
          fx.sfx(s, 'radio_click', null, 0.4);
          fx.setFlag(s, SUBFLAGS.radio_heard_name);
          fx.nudge(s, 'paul', { fear: 0.12, anxiety: 0.06 });
        },
      },
    },
  },

  // ───────────────────────────── Phase 6 — Crisis ─────────────────────────────
  {
    id: 'figure_watching_station',
    title: 'Someone at the east end, watching the station',
    window: [128, 160],
    scenarios: ['psychological', 'supernatural', 'mixed'],
    realIn: REAL,
    room: 'nurse_station',
    characters: ['susie'],
    offscreen: false,
    chance: 0.7,
    priority: 5,
    tags: ['figure'],
    presentation: {
      susie: {
        run: async (ctx) => {
          const s = ctx.s;
          if (!fx.charIn(s, 'susie', ['nurse_station', 'corridor'])) return;
          const real = fx.isReal(s);
          const fig = s.characters.spawnFigure({
            id: 'watcher_e',
            pos: WATCHER,
            yaw: Math.PI / 2,
            outfit: 'dark',
            anim: 'stand_still',
            opacity: 0.9,
            visibleTo: real ? ['susie', 'cctv'] : ['susie'],
            vanishWithin: 9,
            vanishWhenUnseen: 2,
            duration: 32,
          });
          await fx.watchSeen(fig, 32, () => {
            fx.say(s, LINES.anomalies.figureWatching, 4);
            fx.setFlag(s, SUBFLAGS.watcher_seen_susie);
            fx.nudge(s, 'susie', { fear: 0.25, anxiety: 0.1 });
            s.postfx.pulse('heartbeat', 0.6);
          });
        },
      },
      truth: {
        run: (ctx) => {
          const s = ctx.s;
          fx.injectSilhouette(s, 'cam_hall_e', WATCHER, 2, Math.PI / 2);
          if (fx.onCam(s, 'cam_hall_e')) {
            fx.setFlag(s, FLAGS.figure_cctv_frames);
            s.cctv.markFootage('cam_hall_e', 'Figure at the east end, facing the station');
          }
        },
      },
    },
  },
];

export const ANOMALY_BY_ID: Map<string, GameEventDef> = new Map(ANOMALIES.map((a) => [a.id, a]));

/** Is the director's StoryApi bound yet (anomaly presentations work either way). */
export function anomaliesBound(): boolean {
  return api !== null;
}
