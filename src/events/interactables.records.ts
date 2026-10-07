/**
 * Paper and screens behind the story interactables: charts and the tracking census, the triage
 * queue, bedside monitors, the med station profile, the patient-own-meds bag, the whiteboards and
 * the radio channel. Built from story/content.ts at the moment they are read, so they always
 * agree with the night so far.
 */
import type { DocumentSection, DocumentView } from '../core/contracts';
import { PHASE_STARTS, type RoomId } from '../core/types';
import { LINES, PATIENTS, PATIENT_ORDER, RADIO_LOG, STAFF, SUBFLAGS, type PatientNote, type PatientRecord } from '../story/content';
import { DF, F } from './Director.ids';
import { clamp01, clock24, drift, flagOn, onMains, wallToGame, zoneLive, type Ctx } from './interactables.kit';

export type PatientId = PatientRecord['id'];

export function isPatientId(v: string | null): v is PatientId {
  return v !== null && Object.prototype.hasOwnProperty.call(PATIENTS, v);
}

/** One-line complaints as the tracking board abbreviates them. */
const BRIEF: Record<PatientId, string> = {
  alvarez: 'chest pain, obs',
  mercer: 'headache / dizziness / visual disturbance · hx migraine · 2× hydrocodone 21:00 per pt',
  okafor: 'hand laceration, awaiting sutures',
  haddad: 'cough × 5 days, low-grade fever',
};

// ---------------------------------------------------------------------------
// Where everyone is, as the unit has charted it
// ---------------------------------------------------------------------------

export function patientWhere(ctx: Ctx, id: PatientId): string {
  if (id === 'mercer') {
    if (flagOn(ctx, F.john_at_station)) return 'Nurse station';
    if (flagOn(ctx, F.john_roomed)) return PATIENTS.mercer.bayLabel;
    if (flagOn(ctx, F.john_called)) return 'Triage';
    return 'Waiting room';
  }
  if (id === 'haddad') return flagOn(ctx, F.haddad_left) ? 'Discharged' : 'Waiting room';
  return PATIENTS[id].bayLabel;
}

export function patientStatus(ctx: Ctx, id: PatientId): string {
  const p = PATIENTS[id];
  switch (id) {
    case 'mercer':
      if (flagOn(ctx, F.john_at_station)) return 'AT NURSE STATION — keep in view';
      if (flagOn(ctx, F.john_sedated)) return 'BAY 3 — resting, lorazepam 23:57';
      if (flagOn(ctx, F.john_roomed)) return 'BAY 3 — awaiting MD';
      if (flagOn(ctx, F.john_triaged)) return 'TRIAGED — awaiting bed';
      if (flagOn(ctx, F.john_called)) return 'CALLED TO TRIAGE';
      return p.status;
    case 'alvarez':
      return flagOn(ctx, DF.alvarez_alarm_live) ? 'MONITOR ALARM — RN responding' : p.status;
    case 'haddad':
      return flagOn(ctx, F.haddad_left) ? 'DISCHARGED 23:20' : p.status;
    default:
      return p.status;
  }
}

export function patientChoices(ctx: Ctx): { id: string; label: string; hint: string }[] {
  return PATIENT_ORDER.map((id) => ({ id, label: `${patientWhere(ctx, id)} — ${PATIENTS[id].short}`, hint: patientStatus(ctx, id) }));
}

function noteShown(ctx: Ctx, id: PatientId, n: PatientNote): boolean {
  const t = ctx.s.clock.time;
  if (n.after !== undefined && t < n.after) return false;
  if (n.requiresFlag && !flagOn(ctx, n.requiresFlag)) return false;
  if (n.requiresNotFlag && flagOn(ctx, n.requiresNotFlag)) return false;
  // the triage note is written when triage happens, not when the clock passes 23:01
  if (id === 'mercer' && n.time === '23:01' && !flagOn(ctx, F.john_triaged)) return false;
  return wallToGame(n.time) <= t + 0.5;
}

function notesOf(ctx: Ctx, id: PatientId): string[] {
  return PATIENTS[id].notes.filter((n) => noteShown(ctx, id, n)).map((n) => `${n.time}  ${n.text}`);
}

function readClue(ctx: Ctx, p: PatientRecord): string | null {
  const c = p.clueOnRead;
  if (!c) return null;
  if (c.after !== undefined && ctx.s.clock.time < c.after) return null;
  if (c.requiresFlag && !flagOn(ctx, c.requiresFlag)) return null;
  return c.clue;
}

// ---------------------------------------------------------------------------
// Charts, census, triage
// ---------------------------------------------------------------------------

/** The clinical record; `clue` is what reading it tonight establishes (content.clueOnRead). */
export function chartDoc(ctx: Ctx, id: PatientId): { view: DocumentView; clue: string | null } {
  const p = PATIENTS[id];
  const v = p.vitals;
  const notes = notesOf(ctx, id);
  return {
    view: {
      kind: 'chart',
      title: p.name,
      subtitle: `MRN ${p.mrn} · DOB ${p.dob} · ${p.age} ${p.sex} · ESI ${p.esi}`,
      sections: [
        { heading: 'Chief complaint', lines: [p.complaint] },
        {
          heading: 'Encounter',
          lines: [
            `Location: ${patientWhere(ctx, id)}`,
            `Status: ${patientStatus(ctx, id)}`,
            `Allergies: ${p.allergies}`,
            `First vitals: BP ${v.bp} · HR ${v.hr} · RR ${v.rr} · SpO2 ${v.spo2} % · T ${v.temp} · Pain ${v.pain}`,
          ],
        },
        { heading: 'History', lines: [...p.history] },
        { heading: 'Medications', lines: [...p.meds] },
        { heading: 'Nursing notes', lines: notes.length ? notes : ['No notes this shift.'] },
      ],
    },
    clue: readClue(ctx, p),
  };
}

/** Station terminal on mains: the tracking census, one choice per patient. Mercer's row carries his dose. */
export function censusDoc(ctx: Ctx): DocumentView {
  const rows = PATIENT_ORDER.map((id) => {
    const p = PATIENTS[id];
    return `${patientWhere(ctx, id).toUpperCase()} · ${p.short} · ${p.age}${p.sex} · ESI ${p.esi} · ${BRIEF[id]} · ${patientStatus(ctx, id)}`;
  });
  return {
    kind: 'terminal',
    title: 'ED Tracking — Census',
    subtitle: 'EDIS · STN-01',
    sections: [
      { lines: ['> census --unit ED'] },
      { heading: `Census ${clock24(ctx.s.clock.time)}`, style: 'mono', lines: rows },
      { style: 'mono', lines: [`ATTENDING  ${STAFF.patel.name} — covering two floors · ext 4471`, 'IMAGING    closed overnight — CT via main campus'] },
    ],
    choices: patientChoices(ctx),
  };
}

/** Station terminal on the generator: the UPS keeps the screen alive, the network is gone. */
export function downtimeDoc(): DocumentView {
  return {
    kind: 'terminal',
    title: 'ED Tracking — Census',
    subtitle: 'EDIS · STN-01 · UPS',
    sections: [
      { lines: ['> census --unit ED'] },
      { style: 'warning', lines: ['NETWORK UNAVAILABLE — DOWNTIME PROCEDURES IN EFFECT', `Last sync ${clock24(PHASE_STARTS.outage)}. Paper charts: rack at the back counter.`] },
    ],
  };
}

/** The paper chart rack: the same choices, readable in any power state. */
export function rackDoc(ctx: Ctx): DocumentView {
  const sections: DocumentSection[] = [
    { heading: 'Slots', lines: PATIENT_ORDER.map((id) => `${patientWhere(ctx, id)}: ${PATIENTS[id].short} — ${patientStatus(ctx, id)}`) },
  ];
  if (!onMains(ctx)) sections.push({ heading: 'Downtime', style: 'warning', lines: ['EHR down. Chart on paper until the network is back.'] });
  return { kind: 'chart', title: 'Chart rack — ED', subtitle: `Paper charts · ${clock24(ctx.s.clock.time)}`, sections, choices: patientChoices(ctx) };
}

/** Triage workstation: who is waiting, and the last triage entry once there is one. */
export function triageDoc(ctx: Ctx): { view: DocumentView; triaged: boolean } {
  const p = PATIENTS.mercer;
  const v = p.vitals;
  const triaged = flagOn(ctx, F.john_triaged);
  const waiting: string[] = [];
  if (!flagOn(ctx, F.john_roomed)) waiting.push(`22:31 · ${p.name} · ${p.age}${p.sex} · ${p.complaint} · ${triaged ? `ESI ${p.esi}, awaiting bed` : 'not yet triaged'}`);
  if (!flagOn(ctx, F.haddad_left)) {
    const h = PATIENTS.haddad;
    waiting.push(`21:50 · ${h.name} · ${h.age}${h.sex} · ${h.complaint} · ${h.status}`);
  }
  const sections: DocumentSection[] = [
    { lines: ['> queue --triage'] },
    { heading: 'Waiting', style: 'mono', lines: waiting.length ? waiting : ['Waiting room clear.'] },
  ];
  if (triaged) {
    const note = p.notes.filter((n) => n.time === '23:01' && noteShown(ctx, 'mercer', n)).map((n) => n.text);
    sections.push({
      heading: `Last triage — ${p.short}`,
      style: 'mono',
      lines: [
        `MRN ${p.mrn} · ESI ${p.esi} · arrived 22:31 · triaged 23:01`,
        `BP ${v.bp} · HR ${v.hr} · RR ${v.rr} · SpO2 ${v.spo2} % · T ${v.temp} · Pain ${v.pain}`,
        ...p.history,
        ...p.meds,
        ...note,
      ],
    });
  }
  return { view: { kind: 'terminal', title: 'Triage — ED Tracking', subtitle: 'EDIS · TRI-01', sections }, triaged };
}

// ---------------------------------------------------------------------------
// Bedside monitors
// ---------------------------------------------------------------------------

export interface Vitals {
  hr: number;
  bp: string;
  rr: number;
  spo2: number;
  temp: string;
}

export type MonitorRead =
  | { kind: 'dark' }
  | { kind: 'standby' }
  | { kind: 'empty'; text: string }
  | { kind: 'live'; view: DocumentView; vitals: Vitals; impossible: boolean };

function baseVitals(p: PatientRecord): Vitals {
  return { hr: p.vitals.hr, bp: p.vitals.bp, rr: p.vitals.rr, spo2: p.vitals.spo2, temp: p.vitals.temp.replace(/\s*°C$/, '') };
}

function shiftBp(bp: string, dSys: number, dDia: number): string {
  const [sys, dia] = bp.split('/').map(Number);
  return `${Math.round(sys + dSys)}/${Math.round(dia + dDia)}`;
}

/** John: hypertensive and fast at triage, settling over the hour, slower once sedated, faster when afraid. */
export function johnVitals(ctx: Ctx): Vitals {
  const base = baseVitals(PATIENTS.mercer);
  const t = ctx.s.clock.time;
  const fear = ctx.s.store.char('john').perception.fear;
  const settle = clamp01((t - 20) / 50);
  const calm = flagOn(ctx, F.john_sedated) ? 1 : 0;
  return {
    hr: Math.round(base.hr - 14 * settle - 12 * calm + 30 * fear + drift(t, 2.3, 2)),
    bp: shiftBp(base.bp, -12 * settle - 10 * calm + 10 * fear, -6 * settle - 6 * calm + 5 * fear),
    rr: Math.round(base.rr - 4 * calm + 4 * fear),
    spo2: base.spo2 - calm,
    temp: base.temp,
  };
}

function alvarezVitals(ctx: Ctx): Vitals {
  const base = baseVitals(PATIENTS.alvarez);
  const t = ctx.s.clock.time;
  if (flagOn(ctx, DF.alvarez_alarm_live)) return { hr: Math.round(134 + drift(t, 7.1, 5)), bp: shiftBp(base.bp, 17, 6), rr: 24, spo2: base.spo2 - 3, temp: base.temp };
  const after = flagOn(ctx, SUBFLAGS.alvarez_alarm) ? 1 : 0;
  return { hr: Math.round(base.hr + 6 * after + drift(t, 1.9, 2)), bp: shiftBp(base.bp, -3 + 5 * after, -2 + 2 * after), rr: base.rr, spo2: base.spo2, temp: base.temp };
}

function okaforVitals(ctx: Ctx): Vitals {
  const base = baseVitals(PATIENTS.okafor);
  return { ...base, hr: Math.round(base.hr + drift(ctx.s.clock.time, 1.3, 2)) };
}

/** Mr. Okafor is out of bed (the director's wander, or the anomaly pool's). */
function okaforUp(ctx: Ctx): boolean {
  return ['npc_okafor_walk', 'okafor_wander'].some((id) => {
    const f = ctx.s.characters.getFigure(id);
    return !!f && !f.removed;
  });
}

function liveRead(ctx: Ctx, bay: string, id: PatientId, v: Vitals, impossible: boolean): MonitorRead {
  const p = PATIENTS[id];
  const cycle = Math.floor(ctx.s.clock.time / 15) * 15;
  const sections: DocumentSection[] = [
    { lines: [`HR ${impossible ? 0 : v.hr}`, `SpO2 ${v.spo2}`, `BP ${v.bp}`, `RR ${v.rr}`, `Temp ${v.temp}`] },
    { lines: [`${clock24(cycle)}  NIBP ${v.bp} · next cycle ${clock24(cycle + 15)}`] },
  ];
  if (id === 'alvarez' && flagOn(ctx, DF.alvarez_alarm_live)) sections.push({ style: 'warning', lines: ['ALARM  HR HIGH · IRREGULAR', 'ALARM  ARRHYTHMIA · CHECK LEADS'] });
  return {
    kind: 'live',
    vitals: v,
    impossible,
    view: { kind: 'monitor', title: `${bay} — ${p.short}`, subtitle: `${p.sex} ${p.age} · MRN ${p.mrn} · ADULT · NIBP AUTO 15`, sections },
  };
}

/** What a bedside monitor shows right now: power first (exam branch on the generator, triage on mains only), then the bed. */
export function readMonitor(ctx: Ctx, room: RoomId): MonitorRead {
  const triage = room === 'triage';
  if (!(onMains(ctx) || (!triage && zoneLive(ctx, 'exam')))) return { kind: 'dark' };
  const john = ctx.s.store.char('john');
  if (triage) return john.location === 'triage' ? liveRead(ctx, 'Triage', 'mercer', johnVitals(ctx), false) : { kind: 'standby' };
  const id = PATIENT_ORDER.find((k) => PATIENTS[k].room === room);
  if (!id) return { kind: 'standby' };
  const bay = PATIENTS[id].bayLabel;
  if (id === 'mercer') {
    if (!flagOn(ctx, F.john_roomed)) return { kind: 'standby' };
    if (john.missing || john.location !== 'exam3') return { kind: 'empty', text: `(${bay}: LEADS OFF — CHECK PATIENT. The bed is empty.)` };
    return liveRead(ctx, bay, id, johnVitals(ctx), flagOn(ctx, SUBFLAGS.vitals_impossible_live));
  }
  if (id === 'okafor' && okaforUp(ctx)) return { kind: 'empty', text: `(${bay}: LEADS OFF — CHECK PATIENT. The bed is empty.)` };
  return liveRead(ctx, bay, id, id === 'alvarez' ? alvarezVitals(ctx) : okaforVitals(ctx), false);
}

// ---------------------------------------------------------------------------
// Medication room
// ---------------------------------------------------------------------------

/** Med station profile for John: what he took at home, and what this unit has given since. */
export function medStationDoc(ctx: Ctx): DocumentView {
  const p = PATIENTS.mercer;
  const sedated = flagOn(ctx, F.john_sedated);
  const given = ['22:12  ASPIRIN 81 MG CHEW ×4 · ALVAREZ, R · EVE RN'];
  if (sedated) given.push('23:57  LORAZEPAM 0.5 MG TAB ×1 · MERCER, J · TRAN, S · OVERRIDE: opioid < 3 h');
  return {
    kind: 'terminal',
    title: 'MedStation 4000 — ED Med Room',
    subtitle: 'USER S. TRAN, RN',
    sections: [
      { lines: [`> profile ${p.mrn}`] },
      { heading: p.name, style: 'warning', lines: ['ALERT: OPIOID TAKEN 21:00 PER PT — REASSESS BEFORE SEDATIVES OR ANALGESIA'] },
      { heading: 'Home medications (per pt)', style: 'mono', lines: [...p.meds] },
      { heading: 'Dispensed on this unit since 22:00', style: 'mono', lines: given },
      { heading: 'Active orders', style: 'mono', lines: [sedated ? 'LORAZEPAM 0.5 MG PO ONCE — standing order — GIVEN' : 'None. Awaiting MD.'] },
    ],
  };
}

/** The patient-own-meds bag in the Bay 3 bin. Null until triage has bagged anything. */
export function ownMedsDoc(ctx: Ctx): DocumentView | null {
  if (!flagOn(ctx, F.john_triaged)) return null;
  const p = PATIENTS.mercer;
  return {
    kind: 'note',
    title: `Patient own meds — ${p.short}`,
    subtitle: `MRN ${p.mrn} · bagged at triage 23:01 · Bay 3 bin`,
    sections: [
      { heading: 'Pharmacy label', style: 'mono', lines: ['HYDROCODONE/APAP 5-325 MG TAB', 'MERCER, CAROL A.', 'TAKE 1 TABLET BY MOUTH EVERY 6 HOURS AS NEEDED FOR PAIN', 'QTY 30 · NO REFILLS'] },
      { heading: 'Bag', style: 'mono', lines: ['Amber bottle, 17 tablets.', 'Sumatriptan 50 mg blister card, 2 left.'] },
      { lines: ['Took 2 at 21:00 per pt. Nothing to eat since 14:00. Not his name on the bottle. — S.T.'] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Whiteboards and the radio channel
// ---------------------------------------------------------------------------

function blocks(lines: readonly string[]): string[][] {
  const out: string[][] = [[]];
  for (const l of lines) {
    if (l === '') {
      if (out[out.length - 1].length) out.push([]);
      continue;
    }
    out[out.length - 1].push(l);
  }
  return out.filter((b) => b.length > 0);
}

/** Station whiteboard: the content board, kept current as patients move. */
export function assignmentsDoc(ctx: Ctx): DocumentView {
  const b = LINES.boards.assignments;
  const [staff = [], bays = [], notes = []] = blocks(b.lines);
  const roomed = flagOn(ctx, F.john_roomed);
  const live = bays.map((l) => {
    if (l.startsWith('BAY 3:') && roomed) return 'BAY 3: MERCER, J.  HA / visual sx — await MD';
    if (l.startsWith('WR:')) {
      const wr = [...(roomed ? [] : ['MERCER, J.']), ...(flagOn(ctx, F.haddad_left) ? [] : ['HADDAD, S.'])];
      return `WR:    ${wr.length ? wr.join(' · ') : '—'}`;
    }
    return l;
  });
  const sections: DocumentSection[] = [{ lines: staff }, { lines: live }, { lines: notes, style: 'warning' }];
  if (ctx.s.store.get().power === 'generator') sections.push({ heading: 'Downtime', style: 'warning', lines: ['ON GENERATOR — EHR DOWN, CHART ON PAPER', 'RADIO CH 2 ONLY'] });
  return { kind: 'board', title: b.title, sections };
}

/** Hall corkboard: one pinned sheet per notice. */
export function noticesDoc(): DocumentView {
  const b = LINES.boards.notices;
  return { kind: 'board', title: b.title, sections: b.lines.map((l) => ({ lines: [l] })) };
}

/** EVS route on the closet whiteboard; Paul ticks what he has done. */
export function evsDoc(ctx: Ctx): DocumentView {
  const b = LINES.boards.evs;
  const [route = [], notes = []] = blocks(b.lines);
  const ticked = route.map((l) => (l.startsWith('2245') || (l.startsWith('2300') && flagOn(ctx, SUBFLAGS.paul_restocked)) ? `${l}  ✓` : l));
  return { kind: 'board', title: b.title, sections: [{ lines: ticked }, { lines: notes, style: 'warning' }] };
}

/** Channel 2 so far tonight (the last few calls). */
export function radioDoc(ctx: Ctx): DocumentView {
  const t = ctx.s.clock.time;
  const heard = RADIO_LOG.filter((m) => m.time <= t && (!m.requiresFlag || flagOn(ctx, m.requiresFlag))).slice(-6);
  return {
    kind: 'radio',
    title: 'CH 2 — Facilities / Security',
    subtitle: 'CH 02 · FACILITIES',
    sections: heard.length ? heard.map((m) => ({ heading: clock24(m.time), lines: [`${m.from}: ${m.text}`] })) : [{ lines: ['(no traffic)'] }],
  };
}
