/**
 * The clinical side: Susie's terminals (tracking census, triage queue, the security feeds), the
 * paper chart rack, the station whiteboard, every bedside monitor, the medication room (med
 * station profile and the patient-own-meds cabinet), and the staff lounge (coffee, Dana's locker).
 */
import type { DocumentView } from '../core/contracts';
import type { CharacterId } from '../core/types';
import { LINES, SUBFLAGS } from '../story/content';
import { CLUE, F } from './Director.ids';
import { DARK_SCREEN, TOO_DARK, bindProp, canRead, flagOn, nudge, objectiveIs, onMains, propPos, sfx, wait, zoneLive, type Ctx } from './interactables.kit';
import {
  assignmentsDoc,
  censusDoc,
  chartDoc,
  downtimeDoc,
  isPatientId,
  medStationDoc,
  ownMedsDoc,
  rackDoc,
  readMonitor,
  triageDoc,
  type PatientId,
} from './interactables.records';

/** beats.ts gives Susie this once she believes John. */
const CHECK_CAM_03 = 'Check CAM 03 (East Hall) from the station terminal.';
const AFTER_CAM_CHECK = 'Watch the board. Check the bays.';

export function registerClinical(ctx: Ctx): void {
  registerStation(ctx);
  registerCameras(ctx);
  registerMonitors(ctx);
  registerMedRoom(ctx);
  registerLounge(ctx);
}

/** Open a document and, while it is up, record what reading it establishes. */
async function readWithClue(ctx: Ctx, view: DocumentView, clue: string | null): Promise<void> {
  const shown = ctx.api.doc(view);
  if (clue) ctx.api.addClue(clue);
  await shown;
}

async function openChart(ctx: Ctx, id: PatientId): Promise<void> {
  const { view, clue } = chartDoc(ctx, id);
  sfx(ctx, 'clipboard', null, 0.25);
  await readWithClue(ctx, view, clue);
}

/** An index (census or rack) that opens charts until it is put down. */
async function browse(ctx: Ctx, index: () => DocumentView): Promise<void> {
  for (let i = 0; i < 8; i++) {
    const pick = await ctx.api.doc(index());
    if (!isPatientId(pick)) return;
    await openChart(ctx, pick);
  }
}

// ---------------------------------------------------------------------------
// Nurse station and triage
// ---------------------------------------------------------------------------

function registerStation(ctx: Ctx): void {
  const { api } = ctx;

  bindProp(ctx, 'station_terminal_0', {
    prompt: (c) => (c === 'susie' ? 'Open patient list' : null),
    use: async () => {
      if (onMains(ctx)) {
        // Mercer's census row carries his 21:00 dose
        api.addClue(CLUE.hydrocodone);
        await browse(ctx, () => censusDoc(ctx));
        return;
      }
      if (zoneLive(ctx, 'corridor_e')) {
        await api.doc(downtimeDoc());
        return;
      }
      api.say(DARK_SCREEN, 2);
    },
  });

  bindProp(ctx, 'triage_terminal', {
    prompt: (c) => (c === 'susie' ? 'Open triage queue' : null),
    use: async () => {
      if (!onMains(ctx)) {
        api.say(DARK_SCREEN, 2);
        return;
      }
      const { view, triaged } = triageDoc(ctx);
      await readWithClue(ctx, view, triaged ? CLUE.hydrocodone : null);
    },
  });

  bindProp(ctx, 'station_charts', {
    prompt: (c) => (c === 'susie' ? 'Pull a chart' : null),
    use: async (c) => {
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      sfx(ctx, 'clipboard', propPos(ctx, 'station_charts', 0.3), 0.35);
      await browse(ctx, () => rackDoc(ctx));
    },
  });

  bindProp(ctx, 'station_board', {
    prompt: () => 'Read board',
    use: async (c) => {
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      await api.doc(assignmentsDoc(ctx));
    },
  });
}

/** The security terminal and the camera wall: the director's CCTV view. */
function registerCameras(ctx: Ctx): void {
  const { s, api } = ctx;
  const powered = (propId: string): boolean => {
    if (onMains(ctx)) return true;
    if (s.store.get().power !== 'generator') return false;
    // the camera wall runs off the station UPS (static without the NVR); the terminal needs the station branch
    return propId === 'station_security_mon' || zoneLive(ctx, 'corridor_e');
  };
  for (const propId of ['station_terminal_1', 'station_security_mon']) {
    bindProp(ctx, propId, {
      prompt: (c) => (c === 'john' ? null : 'Review cameras'),
      use: async (c) => {
        if (!powered(propId)) {
          api.say(DARK_SCREEN, 2);
          return;
        }
        // following up on John: straight to the east hall
        const followUp = c === 'susie' && objectiveIs(ctx, 'susie', [CHECK_CAM_03]);
        await api.openCCTV(followUp ? 'cam_hall_e' : 'cam_station');
        if (followUp) api.objective('susie', AFTER_CAM_CHECK);
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Bedside monitors (exam 1–5, triage)
// ---------------------------------------------------------------------------

function registerMonitors(ctx: Ctx): void {
  const { s, api } = ctx;
  for (const def of s.layout.props) {
    if (def.type !== 'monitor' || !def.interactable) continue;
    const room = def.room;
    bindProp(ctx, def.id, {
      prompt: (c) => {
        if (c === 'susie') return 'Check monitor';
        if (c !== 'john') return null;
        const john = s.store.char('john');
        if (room === 'triage') return john.location === 'triage' ? 'Look at monitor' : null;
        return room === 'exam3' && john.location === 'exam3' && flagOn(ctx, F.john_roomed) ? 'Look at monitor' : null;
      },
      use: async (c) => {
        const read = readMonitor(ctx, room);
        if (c === 'john') {
          if (read.kind === 'live') api.say(LINES.monitors.johnReads.replace('104', String(read.impossible ? 0 : read.vitals.hr)), 3);
          else api.say(read.kind === 'dark' ? DARK_SCREEN : LINES.monitors.standby, 2.4);
          return;
        }
        switch (read.kind) {
          case 'dark':
            api.say(DARK_SCREEN, 2);
            return;
          case 'standby':
            api.say(LINES.monitors.standby, 2.4);
            return;
          case 'empty':
            api.say(read.text, 3.4);
            nudge(ctx, c, { stress: 0.05, anxiety: 0.03 });
            return;
          case 'live':
            // HR 0 while he talks: the anomaly pool's moment, read off the screen
            await readWithClue(ctx, read.view, read.impossible ? CLUE.impossible_vitals : null);
            return;
        }
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Medication room
// ---------------------------------------------------------------------------

function registerMedRoom(ctx: Ctx): void {
  const { api } = ctx;
  bindProp(ctx, 'med_cabinet_0', {
    prompt: (c) => (c === 'susie' ? 'Open med cabinet' : null),
    use: async (c) => {
      sfx(ctx, 'keys', propPos(ctx, 'med_cabinet_0', 1.2), 0.35);
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      const bag = ownMedsDoc(ctx);
      if (!bag) {
        api.say('(Bay 2: her own amlodipine and atorvastatin, bagged. Bay 3: empty.)', 3.6);
        return;
      }
      await readWithClue(ctx, bag, CLUE.hydrocodone);
    },
  });
  bindProp(ctx, 'med_terminal', {
    prompt: (c) => (c === 'susie' ? 'Open MedStation' : null),
    use: async () => {
      if (!onMains(ctx)) {
        api.say(DARK_SCREEN, 2);
        return;
      }
      await readWithClue(ctx, medStationDoc(ctx), CLUE.hydrocodone);
    },
  });
}

// ---------------------------------------------------------------------------
// Staff lounge
// ---------------------------------------------------------------------------

function registerLounge(ctx: Ctx): void {
  const { s, api } = ctx;
  const lastCup = new Map<CharacterId, number>();
  bindProp(ctx, 'lounge_coffee', {
    prompt: (c) => (c === 'john' ? null : 'Pour coffee'),
    use: async (c) => {
      // the lounge outlets ride the public branch on the generator
      if (!(onMains(ctx) || zoneLive(ctx, 'public'))) {
        api.say(LINES.coffee.cold, 2.2);
        return;
      }
      sfx(ctx, 'coffee', propPos(ctx, 'lounge_coffee', 0.2), 0.5);
      await wait(1.6);
      const t = s.clock.time;
      const prev = lastCup.get(c);
      // one cup's worth of help per half hour or so
      if (prev === undefined || t - prev >= 25) {
        lastCup.set(c, t);
        nudge(ctx, c, { fatigue: -0.15 });
      }
      api.say(LINES.coffee.pour, 2.4);
    },
  });
  bindProp(ctx, 'lounge_lockers', {
    prompt: (c) => (c === 'susie' ? "Open Dana's locker" : null),
    use: async (c) => {
      sfx(ctx, 'keys', propPos(ctx, 'lounge_lockers', 1.2), 0.35);
      if (!canRead(ctx, c)) {
        api.say(TOO_DARK, 2);
        return;
      }
      api.setFlag(SUBFLAGS.susie_read_dana_note);
      const note = LINES.notes.danaLocker;
      await api.doc({ kind: 'note', title: note.title, sections: [{ lines: [...note.lines] }] });
    },
  });
}
