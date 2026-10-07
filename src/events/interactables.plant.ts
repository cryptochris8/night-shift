/**
 * The building's power plant as Paul reads it: the emergency branch panels (EM-2 in the electrical
 * room, GP-1 in the generator room) whose breakers are the director's zones, the utility event log
 * on the main switchboard, the transfer switch controller, the maintenance tags and the genset's
 * gauges. Fuel and load are modelled from how long the generator has run and which zones it carries.
 */
import type { DocumentSection, DocumentSwitch, DocumentView } from '../core/contracts';
import { PHASE_STARTS, ZONES, type ZoneId } from '../core/types';
import { LINES, VOLTAGE_LOG, ZONE_LABELS } from '../story/content';
import { F } from './Director.ids';
import { drift, flagOn, type Ctx } from './interactables.kit';

/** Raw flag beats.ts sets when the west wing branch trips at 23:50 (Director.ids has no constant for it). */
export const WEST_WING_TRIPPED = 'west_wing_tripped';

/** Share of genset capacity per branch. Any three stay under the 60 % the failed load test allows; any four do not. */
const ZONE_LOAD: Record<ZoneId, number> = { corridor_w: 15, corridor_e: 17, exam: 18, public: 16, service: 15, cctv: 15, west_wing: 18 };
/** Exit signs, fire alarm panel, ATS controls: always on the bus. */
const BASE_LOAD = 6;
/** Day tank at 22:45. At this burn it reads about 34 % by 01:42, as Paul's closing log says. */
const FUEL_AT_START = 78;
const BURN_PER_MIN = 0.45;
const DAY_TANK_GALLONS = 300;
const HOURS_AT_START = 1412.6;

// ---------------------------------------------------------------------------
// Generator model
// ---------------------------------------------------------------------------

export function genRunningMinutes(ctx: Ctx): number {
  const st = ctx.s.store.get();
  if (st.power !== 'generator' && ctx.genStart === null) return 0;
  const start = ctx.genStart ?? PHASE_STARTS.generator - 1.5;
  return Math.max(0, ctx.s.clock.time - start);
}

export function fuelPct(ctx: Ctx): number {
  return Math.max(4, Math.round(FUEL_AT_START - BURN_PER_MIN * genRunningMinutes(ctx)));
}

export function fuelGallons(pct: number): number {
  return Math.round((pct / 100) * DAY_TANK_GALLONS);
}

export function loadPct(ctx: Ctx): number {
  const st = ctx.s.store.get();
  if (st.power !== 'generator') return 0;
  const sum = ZONES.reduce((n, z) => n + (st.zones[z] ? ZONE_LOAD[z] : 0), BASE_LOAD);
  return Math.round(sum + drift(ctx.s.clock.time, 3.1, 1.2));
}

// ---------------------------------------------------------------------------
// Branch panels (the director's zones)
// ---------------------------------------------------------------------------

export interface BreakerState {
  /** the tripped west wing breaker has been thrown to OFF — the first half of a reset */
  cleared: boolean;
}

export function westWingTripped(ctx: Ctx, b: BreakerState): boolean {
  return flagOn(ctx, WEST_WING_TRIPPED) && !b.cleared && !flagOn(ctx, F.paul_reset_west_wing) && !ctx.s.store.get().zones.west_wing;
}

/** Switches re-read from the store, so a refused or tripped breaker shows what really happened. */
export function zoneSwitches(ctx: Ctx, b: BreakerState): DocumentSwitch[] {
  const st = ctx.s.store.get();
  const mains = st.power === 'normal' || st.power === 'unstable';
  const tripped = westWingTripped(ctx, b);
  return ZONES.map((z) => {
    const meta = ZONE_LABELS[z];
    const trip = z === 'west_wing' && tripped;
    let enabled = true;
    let note: string = trip ? 'TRIPPED' : meta.amps;
    if (st.power === 'blackout') {
      enabled = false;
      if (!trip) note = `${meta.amps} · NO SOURCE`;
    } else if (mains && z !== 'west_wing') {
      // life-safety branches wear lock-on clips until there is load to shed
      enabled = false;
      note = `${meta.amps} · LOCK-ON`;
    } else if (mains && !st.zones.west_wing && !flagOn(ctx, WEST_WING_TRIPPED)) {
      // the decommissioned wing stays locked out until its breaker trips on its own at 23:50
      enabled = false;
      note = `${meta.amps} · LOCKED OUT`;
    }
    return { id: z, label: meta.label, on: st.zones[z], enabled, note };
  });
}

export function zonePanelDoc(ctx: Ctx, which: 'em' | 'gen', b: BreakerState, onToggle: (id: string, on: boolean) => DocumentSwitch[]): DocumentView {
  const sections: DocumentSection[] = [];
  switch (ctx.s.store.get().power) {
    case 'normal':
      sections.push({ heading: 'Source', lines: ['UTILITY via ATS-1 — NORMAL', 'Branches locked on. Load shed on generator only.'] });
      break;
    case 'unstable':
      sections.push({ heading: 'Source', style: 'warning', lines: ['UTILITY via ATS-1 — VOLTAGE UNSTABLE', 'See the MSB-1 event log.'] });
      break;
    case 'blackout':
      sections.push({ heading: 'Source', style: 'warning', lines: ['NO SOURCE — BUS DEAD', 'ATS-1 waiting on the generator.'] });
      break;
    case 'generator':
      sections.push({ heading: 'Source', lines: ['GENSET G-1 via ATS-1 — EMERGENCY', LINES.generator.panelHint] });
      break;
  }
  if (westWingTripped(ctx, b)) sections.push({ heading: 'Branch 7', style: 'warning', lines: ['WEST WING (DECOMM.) tripped 23:50.', 'Reset: OFF, then ON.'] });
  return {
    kind: 'panel',
    title: which === 'em' ? 'Panel EM-2 — Emergency branch' : 'Panel GP-1 — Generator distribution',
    subtitle: which === 'em' ? '208Y/120V · 3Ø 4W · 225A MLO · FED FROM ATS-1' : '480/277V · 3Ø 4W · 400A MCB · GENSET G-1',
    sections,
    switches: zoneSwitches(ctx, b),
    onToggle,
  };
}

// ---------------------------------------------------------------------------
// Switchboard log, transfer switch, tags
// ---------------------------------------------------------------------------

/** MSB-1 power monitor: utility voltage now and the sag log so far. `alarmLogged` once a sag has crossed the alarm line. */
export function voltageDoc(ctx: Ctx): { view: DocumentView; alarmLogged: boolean } {
  const st = ctx.s.store.get();
  const t = ctx.s.clock.time;
  const logged = VOLTAGE_LOG.filter((e) => e.time <= t);
  const now =
    st.power === 'blackout' || st.power === 'generator'
      ? 'UTILITY  0 V  — LOST 00:05'
      : st.power === 'unstable'
        ? `UTILITY  ${Math.round(428 + drift(t, 5.3, 9))} V  — UNSTABLE`
        : `UTILITY  ${Math.round(474 - t * 0.06 + drift(t, 2.1, 2))} V  · 60.0 Hz`;
  return {
    view: {
      kind: 'terminal',
      title: 'MSB-1 Power Monitor',
      subtitle: 'BMS · UTILITY EVENT LOG',
      sections: [
        { lines: ['> events --feed utility'] },
        { heading: 'Now', style: 'mono', lines: [now, 'NOMINAL  480 V ±5 %  3Ø  60 Hz'] },
        { heading: 'Events', style: 'mono', lines: logged.length ? logged.map((e) => e.text) : ['No events.'] },
      ],
    },
    alarmLogged: logged.some((e) => e.text.includes('ALARM')),
  };
}

/** ATS-1 controller readout; the settings are the clue. */
export function atsDoc(ctx: Ctx): DocumentView {
  const t = ctx.s.clock.time;
  let status: string[];
  switch (ctx.s.store.get().power) {
    case 'normal':
      status = ['NORMAL SOURCE  AVAILABLE  480 V', 'EMERG SOURCE   STANDBY', 'POSITION       NORMAL'];
      break;
    case 'unstable':
      status = [`NORMAL SOURCE  UNSTABLE  ${Math.round(428 + drift(t, 5.3, 9))} V`, 'EMERG SOURCE   STANDBY — START PENDING', 'POSITION       NORMAL'];
      break;
    case 'blackout':
      status = ['NORMAL SOURCE  LOST', 'EMERG SOURCE   CRANKING', 'POSITION       — NO SOURCE'];
      break;
    default:
      status = ['NORMAL SOURCE  LOST', 'EMERG SOURCE   AVAILABLE  480 V  60.0 Hz', 'POSITION       EMERGENCY'];
  }
  return {
    kind: 'terminal',
    title: 'ATS-1 Controller',
    subtitle: 'BMS · TRANSFER SWITCH',
    sections: [
      { heading: 'Status', style: 'mono', lines: status },
      { heading: 'Settings', style: 'mono', lines: ['TRANSFER DELAY     3 s', 'RETRANSFER DELAY   0 s   (spec 300 s)', 'ENGINE COOLDOWN    5 min', 'EXERCISER          DISABLED'] },
      { heading: 'Service', style: 'warning', lines: ['LAST PM 11/2023 — OVERDUE'] },
    ],
  };
}

export function tagDoc(tag: { title: string; lines: readonly string[] }, where: string): DocumentView {
  return { kind: 'tag', title: tag.title, subtitle: where, sections: [{ lines: [...tag.lines] }] };
}

// ---------------------------------------------------------------------------
// Genset control panel
// ---------------------------------------------------------------------------

/** Gauges and status lamps in the generator renderer's line format ("Fuel 61 %", lamps as plain lines). */
export function generatorDoc(ctx: Ctx): DocumentView {
  const st = ctx.s.store.get();
  const t = ctx.s.clock.time;
  const fuel = fuelPct(ctx);
  const run = genRunningMinutes(ctx);
  const hours = `Engine hours ${(HOURS_AT_START + run / 60).toFixed(1)}`;
  const gauges: string[] = [];
  const lamps: string[] = [];
  if (st.power === 'generator') {
    const load = loadPct(ctx);
    const west = st.zones.west_wing;
    gauges.push(
      `Fuel ${fuel} %`,
      `Load ${load} %`,
      `Volts ${Math.round(479 + drift(t, 4.1, 3))} V`,
      `Freq ${(60 + drift(t, 2.7, west ? 0.5 : 0.15)).toFixed(1)} Hz`,
      `Oil ${Math.round(56 + drift(t, 1.7, 2))} psi`,
      `Coolant ${Math.round(Math.min(92, 74 + run * 0.25) + drift(t, 0.9, 1))} °C`,
      'Battery 27.4 V',
      'RPM 1800 rpm',
      hours,
    );
    lamps.push('RUNNING — ON LOAD', 'LOAD TEST 03/2024 — FAILED');
    if (load >= 55) lamps.push('LOAD NEAR LIMIT — CHECK');
    if (west) lamps.push('BRANCH 7 (DECOMM.) DRAWING — CHECK');
    if (fuel <= 30) lamps.push('FUEL LOW — ORDER DELIVERY');
  } else if (st.power === 'blackout') {
    gauges.push(`Fuel ${fuel} %`, 'Oil 9 psi', 'Battery 21.8 V', 'RPM 640 rpm', hours);
    lamps.push('UTILITY LOST — START SIGNAL', 'CRANKING');
  } else {
    gauges.push(`Fuel ${fuel} %`, 'Coolant 41 °C', 'Battery 27.2 V', hours);
    lamps.push('STANDBY — AUTO', 'BLOCK HEATER ON', 'LOAD TEST 03/2024 — FAILED', 'LAST EXERCISE 09/28 — 30 MIN, NO LOAD');
    if (st.power === 'unstable') lamps.push('UTILITY UNSTABLE — START PENDING');
  }
  return {
    kind: 'generator',
    title: 'Genset G-1',
    subtitle: 'DIESEL 350 kW · 480/277 V · 60 Hz · ATS-1',
    sections: [{ lines: gauges }, { heading: 'Status', lines: lamps }],
  };
}
