/**
 * The power failure (CONTRACT §4J / §5 Phase 4): three minutes of brownouts, then everything dies,
 * twelve to eighteen real seconds of darkness with one patient knock, then the generator snaps the
 * emergency circuit on one zone at a time. Doors fail to their blackout state, the elevator sticks
 * open on a dark cab, screens die and come back only where their zone is energised.
 */
import type { Services } from '../core/contracts';
import type { RNG } from '../core/rng';
import { PHASE_STARTS, ZONES, type SoundState, type Vec3, type ZoneId } from '../core/types';
import { LINES, SUBFLAGS } from '../story/content';
import { F } from './Director.ids';

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const wait = (seconds: number): Promise<void> => new Promise((r) => setTimeout(r, seconds * 1000));

/** Zones the generator carries by default; everything else is shed until Paul decides otherwise. */
export const GENERATOR_DEFAULT_ZONES: readonly ZoneId[] = ['corridor_w', 'corridor_e', 'service'];
export const GENERATOR_ZONE_LIMIT = 3;

const EXAM_MONITORS = ['exam1_monitor', 'exam2_monitor', 'exam3_monitor', 'exam4_monitor', 'exam5_monitor'] as const;
const PUBLIC_SCREENS = ['wait_tv', 'wait_desk_terminal', 'triage_terminal', 'triage_monitor'] as const;
const STATION_SCREENS = ['station_terminal_0', 'station_terminal_1'] as const;
const OTHER_SCREENS = ['med_terminal', 'lounge_tv', 'img_terminal'] as const;

export interface OutageHooks {
  setSound(state: SoundState): void;
  onBlackoutStart(): void;
  onGeneratorOn(): void;
}

export type OutageStage = 'normal' | 'unstable' | 'blackout' | 'generator';

/** Every screen in the wing follows the power state and its breaker zone. */
export function applyScreens(s: Services): void {
  const st = s.store.get();
  const set = (ids: readonly string[], mode: string): void => {
    for (const id of ids) {
      try {
        s.world.setScreen(id, mode);
      } catch {
        /* prop may not exist in this build of the world */
      }
    }
  };
  switch (st.power) {
    case 'normal':
    case 'unstable':
      set(EXAM_MONITORS, 'vitals');
      set(['wait_tv'], 'news_muted');
      set(['wait_desk_terminal'], 'registration');
      set(['triage_terminal'], 'triage');
      set(['triage_monitor'], 'vitals');
      set(['station_terminal_0'], 'patients');
      set(['station_terminal_1'], 'security');
      set(['station_security_mon'], 'security');
      set(['med_terminal'], 'pyxis');
      set(['lounge_tv', 'img_terminal'], 'standby');
      return;
    case 'blackout':
      set(EXAM_MONITORS, 'off');
      set(PUBLIC_SCREENS, 'off');
      set(STATION_SCREENS, 'off');
      set(OTHER_SCREENS, 'off');
      set(['station_security_mon'], 'off');
      return;
    case 'generator':
      set(EXAM_MONITORS, st.zones.exam ? 'vitals' : 'off');
      set(PUBLIC_SCREENS, 'off');
      set(STATION_SCREENS, st.zones.corridor_e ? 'standby' : 'off');
      set(['station_security_mon'], st.zones.cctv ? 'security' : 'static');
      set(OTHER_SCREENS, 'off');
      return;
  }
}

export class OutageSequencer {
  stage: OutageStage = 'normal';
  private busy = false;
  private readonly P: Record<string, Vec3>;

  constructor(
    private readonly s: Services,
    private readonly rng: RNG,
    private readonly hooks: OutageHooks,
  ) {
    this.P = s.layout.points;
  }

  reset(): void {
    this.stage = 'normal';
    this.busy = false;
  }

  update(time: number): void {
    if (this.busy) return;
    if (this.stage === 'normal' && time >= PHASE_STARTS.outage - 3) this.unstable();
    if ((this.stage === 'normal' || this.stage === 'unstable') && time >= PHASE_STARTS.outage) void this.blackout();
  }

  private unstable(): void {
    this.stage = 'unstable';
    const s = this.s;
    s.lighting.setPowerState('unstable');
    s.store.setPower('unstable');
    s.audio.play('light_buzz', { nonSpatial: true, volume: 0.28 });
    s.audio.play('transformer_hum', { pos: this.P.electrical_panel, volume: 0.5 });
  }

  private async blackout(): Promise<void> {
    this.busy = true;
    this.stage = 'blackout';
    const s = this.s;
    const st = s.store.get();
    const view = st.activeView;
    const started = performance.now();

    // the stutter, then everything dies
    s.audio.play('power_down', { nonSpatial: true, volume: 0.85 });
    s.lighting.setPowerState('blackout');
    s.store.setPower('blackout'); // CCTV takes its feeds offline from this event
    applyScreens(s);
    for (const room of ['exam1', 'exam2', 'exam3', 'exam4', 'exam5'] as const) s.world.setCallLight(room, false);
    s.audio.setPowerState('blackout');
    this.hooks.setSound('BLACKOUT');
    s.postfx.setBlackout(1);
    s.ui.setHudVisible(false);
    s.ui.setPrompt(null);
    this.hooks.onBlackoutStart();

    await wait(1.6);

    // per-view reaction
    const paul = s.store.char('paul');
    switch (view) {
      case 'john':
        s.ui.subtitle(LINES.blackout.john[0], 3);
        await wait(2.2);
        s.audio.play('phone_unlock', { nonSpatial: true, volume: 0.5 });
        s.postfx.setBlackout(0.86); // the phone is the only light
        await wait(1.6);
        s.ui.subtitle(LINES.blackout.john[1], 2, 'John');
        break;
      case 'susie':
        s.ui.subtitle(LINES.blackout.susie[0], 3, 'Susie');
        s.postfx.setBlackout(0.92);
        break;
      case 'paul':
        if (paul.hasFlashlight) {
          await wait(1.1);
          s.audio.play('flashlight_click', { nonSpatial: true, volume: 0.7 });
          s.ui.subtitle(LINES.blackout.paulFlashlight[0], 1.4);
          s.store.setChar('paul', { flashlight: true });
          s.lighting.setFlashlight(true);
          s.postfx.setBlackout(0.3);
        } else {
          s.postfx.setBlackout(0.95);
          await wait(1.4);
          // the cart rolls a metre on its own
          const cart = s.world.getProp('svc_cart');
          if (cart) {
            const to = v3(cart.position.x + 1.0, 0, cart.position.z);
            s.audio.play('cart_roll', { pos: v3(cart.position.x, 0.5, cart.position.z), volume: 0.6, rate: 0.8 });
            void s.world.moveProp('svc_cart', to, cart.rotation.y, 2.4);
          }
          s.store.setFlag(SUBFLAGS.cart_rolled);
          s.ui.subtitle(LINES.blackout.paulDark[0], 3.4);
        }
        break;
      default:
        s.ui.subtitle('(ALL FEEDS LOST)', 3);
        break;
    }

    // breathing, then one distant, patient knock
    if (view !== 'cctv') s.audio.play('breath', { nonSpatial: true, volume: 0.32, rate: 0.95 });
    const knockDelay = this.rng.range(3.5, 6.5);
    await wait(knockDelay);
    if (this.stage !== 'blackout') return;
    const me = view === 'cctv' ? s.store.char(st.lastCharacter) : s.store.char(view);
    const knockFrom = v3(me.position.x > 0 ? -16 : 16, 1.2, me.position.z > 3 ? -0.5 : 7);
    s.audio.play('knock', { pos: knockFrom, volume: 0.55, rate: 0.85 });
    s.ui.subtitle(LINES.blackout.knock, 2.6);

    const total = this.rng.range(12, 18);
    const elapsed = (performance.now() - started) / 1000;
    await wait(Math.max(0.5, total - elapsed));
    if (this.stage !== 'blackout') return;
    await this.generator();
  }

  private async generator(): Promise<void> {
    const s = this.s;
    // the breaker zones the generator can carry
    for (const z of ZONES) {
      const on = GENERATOR_DEFAULT_ZONES.includes(z);
      s.store.setZone(z, on);
      s.lighting.setZone(z, on);
    }
    s.lighting.setPowerState('generator'); // 2 s dark, then zones snap on with gaps
    s.audio.play('generator_start', { pos: this.P.generator_unit, volume: 0.9 });
    await wait(2.1);

    this.stage = 'generator';
    s.store.setPower('generator');
    s.audio.setPowerState('generator');
    this.hooks.setSound('GENERATOR');
    s.audio.play('power_up', { nonSpatial: true, volume: 0.6 });
    const paul = s.store.char('paul');
    s.postfx.setBlackout(s.store.get().activeView === 'paul' && paul.flashlight ? 0 : 0);
    s.ui.setHudVisible(true);

    // doors fail to their blackout state
    for (const d of s.layout.doors) {
      if (d.afterBlackout === 'locked') s.world.setDoorLocked(d.id, true);
      else if (d.afterBlackout === 'unlocked') {
        s.world.setDoorLocked(d.id, false);
        s.world.setDoorAccess(d.id, 'all');
      }
    }
    // the elevator sticks open on a dark cab
    s.audio.play('elevator_doors', { pos: this.P.elevator_doors, volume: 0.55, rate: 0.9 });
    void s.world.setElevator(true, false);
    applyScreens(s);

    s.store.setFlag(F.blackout_done);
    s.store.setFlag(F.generator_on);
    this.busy = false;

    await wait(3.4);
    // the intercom tries to say something
    s.ui.subtitle(LINES.intercom.blackoutFragment, 3.2, 'Intercom');
    void s.audio.intercom('to the west. please.', { glitch: true });
    s.store.setFlag(SUBFLAGS.intercom_west_wing);
    await wait(2.5);
    this.hooks.onGeneratorOn();
  }
}
