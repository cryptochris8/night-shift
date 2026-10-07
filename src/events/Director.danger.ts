/**
 * Crisis danger (CONTRACT §4J / §5 Phase 6). While the player is looking elsewhere, a character in a
 * danger window accrues `danger` at a difficulty-scaled rate; controlling them bleeds it off. The
 * player is told something is wrong without being told what: a portrait ring, a radio click, a
 * camera that drops its signal, a heartbeat. At 1 the character is unaccounted for.
 */
import type { Services } from '../core/contracts';
import type { RNG } from '../core/rng';
import { CHARACTER_IDS, PHASE_STARTS, type CharacterId, type RoomId, type Vec3 } from '../core/types';
import { DANGER_SCALE, F } from './Director.ids';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface DangerWindow {
  id: CharacterId;
  start: number;
  end: number;
  /** danger per game-minute at normal difficulty */
  rate: number;
  /** camera that loses its signal as the second warning */
  nearCam: string;
  hints: [string, string, string];
  active: () => boolean;
}

export interface DangerHooks {
  onPreWarn(w: DangerWindow): void;
  onStage(w: DangerWindow, stage: 1 | 2 | 3): void;
  onMissing(id: CharacterId): void;
}

const PAUL_ROOMS: readonly RoomId[] = ['generator', 'service_n', 'electrical', 'service_e', 'closed_wing'];
const SUSIE_ROOMS: readonly RoomId[] = ['nurse_station', 'corridor'];

export class DangerSystem {
  private stage: Record<CharacterId, number> = { john: 0, susie: 0, paul: 0 };
  private preWarned: Record<CharacterId, boolean> = { john: false, susie: false, paul: false };
  private warnAccum = 0;
  private threat = 0;
  private windows: DangerWindow[];

  constructor(
    private readonly s: Services,
    private readonly rng: RNG,
    private readonly hooks: DangerHooks,
  ) {
    this.windows = this.buildWindows();
  }

  reset(): void {
    this.stage = { john: 0, susie: 0, paul: 0 };
    this.preWarned = { john: false, susie: false, paul: false };
    this.threat = 0;
    this.warnAccum = 0;
  }

  /** The window currently threatening a character, if any. */
  windowFor(id: CharacterId, time: number): DangerWindow | undefined {
    return this.windows.find((w) => w.id === id && time >= w.start && time <= w.end && w.active());
  }

  private buildWindows(): DangerWindow[] {
    const st = () => this.s.store.get();
    const flag = (k: string): boolean => Boolean(st().flags[k]);
    return [
      {
        id: 'john',
        start: 133, // 00:58
        end: 147, // 01:12
        rate: 1 / 7,
        nearCam: 'cam_hall_w',
        hints: ['Bay 3 — something in the hall', 'Bay 3 — monitor flatline', 'Bay 3 — no response'],
        active: () => !flag(F.john_at_station) && !flag(F.john_safe) && st().characters.john.location === 'exam3',
      },
      {
        id: 'paul',
        start: 140, // 01:05
        end: 155, // 01:20
        rate: 1 / 9,
        nearCam: 'cam_generator',
        hints: ['Generator — load surging', 'CAM 08 — signal lost', 'Paul — radio silent'],
        active: () => PAUL_ROOMS.includes(st().characters.paul.location),
      },
      {
        id: 'susie',
        start: 150, // 01:15
        end: 160, // 01:25
        rate: 1 / 8,
        nearCam: 'cam_station',
        hints: ['Nurse station — elevator chime', 'CAM 04 — signal lost', 'Susie — no answer'],
        active: () => !flag(F.susie_held_position) && SUSIE_ROOMS.includes(st().characters.susie.location),
      },
    ];
  }

  /** Rate multiplier beyond difficulty: the west wing makes Paul's window real; deep inside it, more so. */
  private rateScale(w: DangerWindow): number {
    const st = this.s.store.get();
    if (w.id === 'paul') {
      if (st.characters.paul.location === 'closed_wing') return 1.6;
      return st.zones.west_wing ? 1 : 0.35;
    }
    if (w.id === 'susie' && st.flags[F.susie_investigated_elevator]) return 1.4;
    return 1;
  }

  update(dt: number, gdt: number, time: number): void {
    const s = this.s;
    const st = s.store.get();
    const resolution = time >= PHASE_STARTS.resolution;
    const diff = DANGER_SCALE[st.settings.difficulty] ?? 1;
    // Easy warns earlier (more warning before anyone is lost); Hard warns later and skips the heads-up.
    const T = st.settings.difficulty === 'easy' ? [0.12, 0.34, 0.64] : st.settings.difficulty === 'hard' ? [0.3, 0.56, 0.82] : [0.18, 0.42, 0.72];
    let maxOther = 0;

    for (const id of CHARACTER_IDS) {
      const c = st.characters[id];
      if (c.missing) continue;
      const controlled = st.activeView === id;
      const w = resolution ? undefined : this.windowFor(id, time);
      let d = c.danger;
      if (w && !controlled) d += gdt * w.rate * diff * this.rateScale(w);
      else d -= gdt * (resolution ? 0.6 : controlled ? 0.3 : 0.1);
      d = clamp01(d);
      if (Math.abs(d - c.danger) > 0.0015) s.store.setChar(id, { danger: d });
      if (!controlled) maxOther = Math.max(maxOther, d);

      // staged signals on the way up; reset once calm again
      const stage = d >= T[2] ? 3 : d >= T[1] ? 2 : d >= T[0] ? 1 : 0;
      if (w && stage > this.stage[id]) {
        this.stage[id] = stage;
        this.hooks.onStage(w, stage as 1 | 2 | 3);
      } else if (stage === 0 && d < 0.08) {
        this.stage[id] = 0;
      }
      if (d >= 1) {
        this.hooks.onMissing(id);
        continue;
      }
      // two minutes of warning before a window opens
      if (!w && !resolution && !this.preWarned[id] && st.settings.difficulty !== 'hard') {
        const next = this.windows.find((x) => x.id === id && time >= x.start - 2 && time < x.start && x.active());
        if (next) {
          this.preWarned[id] = true;
          this.hooks.onPreWarn(next);
        }
      }
    }

    // global threat follows the worst unattended danger, with a little weight on the active view's own
    const own = st.activeView === 'cctv' ? 0 : st.characters[st.activeView].danger * 0.5;
    const target = resolution ? 0 : Math.max(maxOther, own);
    this.threat += (target - this.threat) * Math.min(1, dt * 1.5);
    s.store.setThreat(this.threat);

    this.warnAccum += dt;
    if (this.warnAccum >= 0.5) {
      this.warnAccum = 0;
      for (const id of CHARACTER_IDS) {
        const c = st.characters[id];
        if (c.missing || c.danger <= 0.04) continue;
        const w = this.windowFor(id, time);
        const hint = w ? w.hints[Math.min(2, Math.max(0, this.stage[id] - 1))] : undefined;
        s.ui.warn(id, c.danger, hint);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Default signal/missing presentations (the director passes these in as hooks)
  // ---------------------------------------------------------------------------

  /** A position the character is not at: where the sound of trouble comes from. */
  static troubleSource(s: Services, id: CharacterId): Vec3 {
    const P = s.layout.points;
    switch (id) {
      case 'john':
        return v3(P.exam3_door.x, 1.1, P.exam3_door.z - 0.6);
      case 'paul':
        return v3(P.generator_unit.x, 1.0, P.generator_unit.z);
      default:
        return v3(P.elevator_doors.x, 1.2, P.elevator_doors.z);
    }
  }

  /** The long-shot soundscape of someone being taken while nobody watches. */
  static missingPresentation(s: Services, rng: RNG, id: CharacterId): void {
    const P = s.layout.points;
    const st = s.store.get();
    const where = st.characters[id].location;
    s.store.setFlag(`dir_missing_${id}_where`, where);
    s.store.setFlag(`dir_missing_${id}_when`, st.time);
    s.store.markMissing(id);

    switch (id) {
      case 'john': {
        const door = P.exam3_door;
        s.audio.play('drag', { pos: v3(door.x, 0.3, door.z - 1), volume: 0.7, rate: 0.75 });
        setTimeout(() => s.audio.play('curtain', { pos: v3(-7.7, 1.2, 2.6), volume: 0.7 }), 2600);
        setTimeout(() => s.audio.play('monitor_flat', { pos: v3(-5.9, 1.35, 4.9), volume: 0.6 }), 3400);
        setTimeout(() => s.audio.play('monitor_off', { pos: v3(-5.9, 1.35, 4.9), volume: 0.6 }), 7400);
        try {
          s.world.setScreen('exam3_monitor', 'dead');
          s.world.setCallLight('exam3', false);
          s.world.addFloorDecal('drag', [{ x: -7.3, z: 3.4 }, { x: -7.6, z: 2.2 }, { x: -7.7, z: 1.0 }, { x: -8.4, z: 0.2 }], {});
          void s.world.moveProp('exam3_curtain', v3(-7.9, 0, 2.3), 0.35, 1.5);
        } catch {
          /* world details are optional here */
        }
        if (st.activeView === 'cctv') s.cctv.glitch('cam_hall_w', 'static', 1.6);
        break;
      }
      case 'paul': {
        s.audio.play('generator_fail', { pos: P.generator_unit, volume: 0.85 });
        s.lighting.flicker('generator', 4, 0.9);
        s.lighting.flicker('service_n', 3, 0.6);
        s.cctv.glitch('cam_generator', 'offline_blip', 8);
        setTimeout(() => s.audio.play('radio_click', { nonSpatial: true, volume: 0.5 }), 1800);
        setTimeout(() => s.audio.play('static_burst', { nonSpatial: true, volume: 0.45 }), 2100);
        setTimeout(() => s.audio.play('flashlight_click', { pos: P.generator_door, volume: 0.6 }), 4200);
        setTimeout(() => s.audio.play('metal_groan', { pos: P.closed_wing_door, volume: 0.5, rate: 0.7 }), 6500);
        if (st.characters.paul.flashlight) {
          s.store.setChar('paul', { flashlight: false });
          s.lighting.setFlashlight(false);
        }
        break;
      }
      case 'susie': {
        s.audio.play('elevator_tone', { pos: P.elevator_doors, volume: 0.6 });
        setTimeout(() => s.audio.play('elevator_doors', { pos: P.elevator_doors, volume: 0.65, rate: 0.85 }), 2200);
        setTimeout(() => s.audio.play('monitor_flat', { pos: P.station_inside, volume: 0.45 }), 4800);
        setTimeout(() => s.audio.play('radio_click', { pos: v3(-0.4, 0.8, -2.5), volume: 0.5 }), 6400);
        s.cctv.glitch('cam_station', 'static', 2.5);
        void s.world.setElevator(false, false);
        break;
      }
    }
    // their body is no longer where a body should be
    const hidden = v3(-19.4 + rng.range(0, 0.4), 0, 6.2 + rng.range(0, 1.4));
    try {
      s.characters.teleport(id, hidden, 0);
      s.store.setChar(id, { location: 'closed_wing', position: hidden, status: 'Unaccounted for' });
    } catch {
      /* the figure may already be gone */
    }
    s.postfx.pulse('glitch', 0.6);
    s.audio.silence(2.5);
    setTimeout(() => s.audio.play('sting_low', { nonSpatial: true, volume: 0.5 }), 2600);
  }
}
