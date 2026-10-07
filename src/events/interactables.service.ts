/**
 * Back of house, Paul's side of the night: his locker and the cart (the flashlight), the mop and
 * whatever is wet, the supply restock, the radios and the EVS board, the branch panels that are the
 * director's zones, the switchboard log, the transfer switch and its tag, and the generator.
 */
import type { DocumentSwitch } from '../core/contracts';
import { ZONES, type CharacterId, type ZoneId } from '../core/types';
import { CHOICE_META, LINES, OBJECTIVES, SUBFLAGS } from '../story/content';
import * as fx from './anomalies.fx';
import { C, CLUE, F } from './Director.ids';
import { TOO_DARK, bindProp, canRead, flagOn, objectiveIs, propPos, sfx, wait, type Ctx } from './interactables.kit';
import {
  atsDoc,
  fuelGallons,
  fuelPct,
  genRunningMinutes,
  generatorDoc,
  loadPct,
  tagDoc,
  voltageDoc,
  westWingTripped,
  zonePanelDoc,
  zoneSwitches,
  type BreakerState,
} from './interactables.plant';
import { evsDoc, radioDoc } from './interactables.records';

/** Paul's opening route (beats.ts sets the first line at 22:45; these follow it until the night takes over). */
const PAUL_OPENING = OBJECTIVES.paul.normal ?? 'Restock Supply, then check the generator log.';
const PAUL_LOG = 'Check the generator log.';
const PAUL_RESTOCK = 'Restock Supply.';
const PAUL_AFTER = OBJECTIVES.paul.unease ?? 'Finish the service hall.';
/** beats.ts at 00:08 */
const PAUL_TO_GENERATOR = 'Get to the generator.';
const PAUL_PICK_ZONES = 'Pick the three zones the generator carries.';
const MOP_SPOT = 'story_mop_spot';

export function registerService(ctx: Ctx): void {
  const routine = { logged: false };
  const advance = (): void => {
    if (!objectiveIs(ctx, 'paul', [PAUL_OPENING, PAUL_LOG, PAUL_RESTOCK])) return;
    const restocked = flagOn(ctx, SUBFLAGS.paul_restocked);
    ctx.api.objective('paul', restocked && routine.logged ? PAUL_AFTER : restocked ? PAUL_LOG : PAUL_RESTOCK);
  };
  registerFlashlight(ctx);
  registerMop(ctx);
  registerSupply(ctx, advance);
  registerRadiosAndBoard(ctx);
  registerPanels(ctx);
  registerTagsAndSwitch(ctx);
  registerGenerator(ctx, routine, advance);
}

// ---------------------------------------------------------------------------
// The flashlight: Paul's locker, or the spare on the cart once the power starts to go
// ---------------------------------------------------------------------------

function giveFlashlight(ctx: Ctx, toast: string): void {
  ctx.s.store.setChar('paul', { hasFlashlight: true });
  ctx.api.setFlag(F.paul_has_flashlight);
  ctx.s.ui.toast(toast, 3.5);
}

function registerFlashlight(ctx: Ctx): void {
  const { s, api } = ctx;
  const has = (): boolean => s.store.char('paul').hasFlashlight;
  const cartLight = (): boolean => !has() && s.store.get().power !== 'normal';

  bindProp(ctx, 'util_locker', {
    prompt: (c) => (c !== 'paul' ? null : has() ? 'Open locker' : 'Take flashlight'),
    use: async (c) => {
      sfx(ctx, 'keys', propPos(ctx, 'util_locker', 1.2), 0.4);
      await wait(0.7);
      if (!has()) {
        giveFlashlight(ctx, LINES.locker.flashlight);
        return;
      }
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      const note = LINES.notes.paulLocker;
      await api.doc({ kind: 'note', title: note.title, sections: [{ lines: [...note.lines] }] });
    },
  });

  let rolledNoted = false;
  bindProp(ctx, 'svc_cart', {
    prompt: (c) => (c !== 'paul' ? null : cartLight() ? 'Take flashlight' : 'Check cart'),
    use: async (c) => {
      if (cartLight()) {
        sfx(ctx, 'keys', propPos(ctx, 'svc_cart', 0.9), 0.3);
        await wait(0.5);
        giveFlashlight(ctx, LINES.locker.flashlightCart);
        return;
      }
      if (flagOn(ctx, SUBFLAGS.cart_rolled) && !rolledNoted) {
        rolledNoted = true;
        api.say(LINES.notes.cartChecklist.rolled, 3.6);
        return;
      }
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      const list = LINES.notes.cartChecklist;
      await api.doc({ kind: 'note', title: list.title, sections: [{ lines: [...list.lines], style: 'mono' }] });
    },
  });
}

// ---------------------------------------------------------------------------
// The mop: whatever the anomaly pool left wet (anomalies.fx wet spots)
// ---------------------------------------------------------------------------

function registerMop(ctx: Ctx): void {
  const { s, api } = ctx;
  let carrying = false;
  const handled = new Set<string>();
  const wetSpot = (): fx.WetSpot | null => {
    const from = propPos(ctx, 'svc_mop') ?? s.layout.points.service_mid;
    const w = fx.wetSpotNear(from, 80);
    return w && !handled.has(w.id) ? w : null;
  };

  bindProp(ctx, 'svc_mop', {
    prompt: (c) => (c !== 'paul' ? null : !carrying && wetSpot() ? 'Take mop' : 'Check bucket'),
    use: () => {
      const w = wetSpot();
      api.say(LINES.mop.bucket, 2.6);
      if (carrying || !w) return;
      carrying = true;
      sfx(ctx, 'footstep_wet', propPos(ctx, 'svc_mop', 0.3), 0.35, { rate: 0.8 });
      fx.hotspot(s, {
        id: MOP_SPOT,
        pos: { x: w.point.x, y: 0.2, z: w.point.z },
        room: w.room,
        who: ['paul'],
        prompt: w.kind === 'leak' ? 'Mop up' : 'Mop footprints',
        radius: 2.6,
        use: async () => {
          carrying = false;
          handled.add(w.id);
          if (w.kind === 'footprints') {
            api.say(LINES.mop.footprintsNoMop, 4.2);
            api.addClue(CLUE.footprints_out);
            return;
          }
          const at = { x: w.point.x, y: 0.1, z: w.point.z };
          for (let i = 0; i < 3; i++) {
            sfx(ctx, 'footstep_wet', at, 0.4, { rate: 0.7 + i * 0.05 });
            await wait(0.55);
          }
          fx.removeWetSpot(w.id);
          api.setFlag(SUBFLAGS.leak_mopped);
          api.say(LINES.mop.mopped, 3);
        },
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Clean Supply restock (Paul's first job), radios, the EVS board
// ---------------------------------------------------------------------------

function registerSupply(ctx: Ctx, advance: () => void): void {
  const { api } = ctx;
  bindProp(ctx, 'supply_cart', {
    prompt: (c) => (c === 'paul' ? (flagOn(ctx, SUBFLAGS.paul_restocked) ? 'Read checklist' : 'Restock cart') : c === 'susie' ? 'Take supplies' : null),
    use: async (c) => {
      const at = propPos(ctx, 'supply_cart', 0.8);
      if (c === 'susie') {
        sfx(ctx, 'paper', at, 0.3);
        api.say(LINES.supply.susie, 2.6);
        return;
      }
      if (!flagOn(ctx, SUBFLAGS.paul_restocked)) {
        sfx(ctx, 'cart_roll', at, 0.3, { rate: 0.9 });
        await wait(1.4);
        sfx(ctx, 'paper', at, 0.3);
        await wait(1.1);
        api.setFlag(SUBFLAGS.paul_restocked);
        api.say(LINES.supply.paul, 2.6);
        advance();
        return;
      }
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      const sheet = LINES.notes.supplyCart;
      await api.doc({ kind: 'note', title: sheet.title, sections: [{ lines: [...sheet.lines], style: 'mono' }] });
    },
  });
}

function registerRadiosAndBoard(ctx: Ctx): void {
  const { api } = ctx;
  // the handheld charging in the EVS closet, and the base set on the station counter
  for (const id of ['util_radio', 'station_radio']) {
    bindProp(ctx, id, {
      prompt: (c) => (c === 'john' ? null : 'Listen to radio'),
      use: async () => {
        await api.doc(radioDoc(ctx));
      },
    });
  }
  bindProp(ctx, 'util_board', {
    prompt: () => 'Read board',
    use: async (c) => {
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      await api.doc(evsDoc(ctx));
    },
  });
}

// ---------------------------------------------------------------------------
// Branch panels and the switchboard log
// ---------------------------------------------------------------------------

function registerPanels(ctx: Ctx): void {
  const { s, api } = ctx;
  // shared by both panels: a breaker cleared at one is cleared at the other
  const breaker: BreakerState = { cleared: false };

  const toggle = (id: string, on: boolean): DocumentSwitch[] => {
    if (!(ZONES as readonly string[]).includes(id)) return zoneSwitches(ctx, breaker);
    const zone = id as ZoneId;
    if (zone === 'west_wing' && on && westWingTripped(ctx, breaker)) {
      // a tripped breaker resets in two throws: this one only takes the handle to OFF
      breaker.cleared = true;
      return zoneSwitches(ctx, breaker);
    }
    const ok = api.setZone(zone, on);
    // the director records 'reset' only when nothing is recorded; a reset after walking away replaces our 'leave'
    if (ok && zone === 'west_wing' && on && api.choice(C.west_wing_breaker) === 'leave') {
      api.addChoice(C.west_wing_breaker, CHOICE_META.west_wing_breaker.label, 'reset');
    }
    return zoneSwitches(ctx, breaker);
  };

  const open = async (c: CharacterId, which: 'em' | 'gen'): Promise<void> => {
    if (!canRead(ctx, c)) {
      api.say(TOO_DARK, 2);
      return;
    }
    const sawTrip = westWingTripped(ctx, breaker);
    await api.doc(zonePanelDoc(ctx, which, breaker, toggle));
    // seeing the trip and closing the door on it is the other answer to the breaker choice
    if (sawTrip && !s.store.get().zones.west_wing && api.choice(C.west_wing_breaker) === undefined) {
      api.addChoice(C.west_wing_breaker, CHOICE_META.west_wing_breaker.label, 'leave');
    }
  };

  bindProp(ctx, 'elec_panel_zones', { prompt: (c) => (c === 'paul' ? 'Open panel' : null), use: (c) => open(c, 'em') });
  bindProp(ctx, 'gen_panel', { prompt: (c) => (c === 'paul' ? 'Open panel' : null), use: (c) => open(c, 'gen') });

  bindProp(ctx, 'elec_panel_main', {
    prompt: (c) => (c === 'paul' ? 'Read power monitor' : null),
    use: async () => {
      const { view, alarmLogged } = voltageDoc(ctx);
      await api.doc(view);
      if (alarmLogged) {
        api.setFlag(SUBFLAGS.paul_read_voltage_log);
        api.addClue(CLUE.voltage_log);
      }
    },
  });
}

function registerTagsAndSwitch(ctx: Ctx): void {
  const { api } = ctx;
  bindProp(ctx, 'elec_transfer', {
    prompt: (c) => (c === 'paul' ? 'Check transfer switch' : null),
    use: async () => {
      await api.doc(atsDoc(ctx));
      api.addClue(CLUE.transfer_switch);
    },
  });
  const tag = (propId: string, card: { title: string; lines: readonly string[] }, where: string, clue: string): void => {
    bindProp(ctx, propId, {
      prompt: (c) => (c === 'paul' ? 'Read tag' : null),
      use: async (c) => {
        if (!canRead(ctx, c)) {
          api.say(TOO_DARK, 2);
          return;
        }
        await api.doc(tagDoc(card, where));
        api.addClue(clue);
      },
    });
  };
  tag('elec_tag', LINES.tags.transferSwitch, 'FACILITIES · ELECTRICAL ROOM', CLUE.transfer_switch);
  tag('gen_tag', LINES.tags.loadTest, 'FACILITIES · GENERATOR ROOM', CLUE.load_test);
}

// ---------------------------------------------------------------------------
// The generator and its day tank
// ---------------------------------------------------------------------------

function registerGenerator(ctx: Ctx, routine: { logged: boolean }, advance: () => void): void {
  const { s, api } = ctx;
  bindProp(ctx, 'gen_unit', {
    prompt: (c) => (c === 'paul' ? 'Read generator panel' : null),
    use: async () => {
      await api.doc(generatorDoc(ctx));
      const st = s.store.get();
      if (st.power === 'blackout') return;
      const fuel = fuelPct(ctx);
      const entry =
        st.power === 'generator'
          ? `(you log it: RAN ${Math.round(genRunningMinutes(ctx))} MIN. FUEL ${fuel} %. LOAD ${loadPct(ctx)} %.)`
          : `(you log it: STANDBY. FUEL ${fuel} %. NO FAULTS.)`;
      api.say(entry, 3.6);
      routine.logged = true;
      advance();
      if (st.power === 'generator' && objectiveIs(ctx, 'paul', [PAUL_TO_GENERATOR])) api.objective('paul', PAUL_PICK_ZONES);
    },
  });
  bindProp(ctx, 'gen_fuel', {
    prompt: (c) => (c === 'paul' ? 'Read fuel gauge' : null),
    use: (c) => {
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      const pct = fuelPct(ctx);
      api.say(`(day tank sight glass: ${pct} % — about ${fuelGallons(pct)} gallons)`, 3.4);
    },
  });
}
