/**
 * NIGHT SHIFT — story content. Flags, choices, clues, every line of text, objectives and
 * endings for St. Augustine Regional's emergency wing, 22:45 → 01:45.
 * Plain data only (no three.js / DOM) so the director, interactables and node tests share it.
 */
import type { CharacterId, Clue, EndingId, GamePhase, RoomId, ScenarioType, ZoneId } from '../core/types';

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export const FLAGS = {
  john_called: 'john_called',
  john_triaged: 'john_triaged',
  john_roomed: 'john_roomed',
  john_told_lights: 'john_told_lights',
  john_told_figure: 'john_told_figure',
  john_sedated: 'john_sedated',
  john_left_room: 'john_left_room',
  john_at_station: 'john_at_station',
  john_safe: 'john_safe',
  susie_believed: 'susie_believed',
  susie_checked_cctv: 'susie_checked_cctv',
  susie_went_alvarez: 'susie_went_alvarez',
  susie_went_john: 'susie_went_john',
  susie_held_position: 'susie_held_position',
  susie_investigated_elevator: 'susie_investigated_elevator',
  paul_has_flashlight: 'paul_has_flashlight',
  paul_reset_west_wing: 'paul_reset_west_wing',
  paul_restored_cctv: 'paul_restored_cctv',
  paul_restored_exam: 'paul_restored_exam',
  paul_entered_west_wing: 'paul_entered_west_wing',
  paul_shut_west_wing: 'paul_shut_west_wing',
  blackout_done: 'blackout_done',
  generator_on: 'generator_on',
  west_wing_door_open: 'west_wing_door_open',
  haddad_left: 'haddad_left',
  ambulance_left: 'ambulance_left',
  figure_seen_john: 'figure_seen_john',
  figure_cctv_frames: 'figure_cctv_frames',
} as const;
export type FlagId = keyof typeof FLAGS;

/** Secondary flags set by anomalies / interactables (not part of the canonical story set). */
export const SUBFLAGS = {
  intercom_west_wing: 'intercom_west_wing',
  mirror_lag_armed: 'mirror_lag_armed',
  mirror_lag_done: 'mirror_lag_done',
  exam1_call_on: 'exam1_call_on',
  exam1_cold: 'exam1_cold',
  tx1_bed_moved: 'tx1_bed_moved',
  wheelchair_moved: 'wheelchair_moved',
  vending_dropped: 'vending_dropped',
  elevator_opened_empty: 'elevator_opened_empty',
  alvarez_man: 'alvarez_man',
  alvarez_alarm: 'alvarez_alarm',
  okafor_wandered: 'okafor_wandered',
  john_heard_name: 'john_heard_name',
  john_bought_water: 'john_bought_water',
  john_asked_marcus: 'john_asked_marcus',
  marcus_denied_page: 'marcus_denied_page',
  vitals_impossible_live: 'vitals_impossible_live',
  paul_restocked: 'paul_restocked',
  paul_read_voltage_log: 'paul_read_voltage_log',
  cart_rolled: 'cart_rolled',
  unknown_text: 'unknown_text',
  service_cascade_done: 'service_cascade_done',
  leak_mopped: 'leak_mopped',
  susie_read_dana_note: 'susie_read_dana_note',
  phone_checked: 'phone_checked',
  radio_heard_name: 'radio_heard_name',
  figure_entered_exam5: 'figure_entered_exam5',
  figure_at_glass: 'figure_at_glass',
  watcher_seen_susie: 'watcher_seen_susie',
} as const;

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

export const CHOICES = {
  tell_lights: 'tell_lights',
  tell_figure: 'tell_figure',
  believe_john: 'believe_john',
  west_wing_breaker: 'west_wing_breaker',
  alvarez_or_john: 'alvarez_or_john',
  hold_or_investigate: 'hold_or_investigate',
  enter_west_wing: 'enter_west_wing',
} as const;
export type ChoiceId = keyof typeof CHOICES;

export interface ChoiceMeta {
  /** label stored with the choice (shown on the ending screen) */
  label: string;
  /** canonical option values */
  options: readonly { id: string; label: string }[];
}

export const CHOICE_META: Record<ChoiceId, ChoiceMeta> = {
  tell_lights: {
    label: 'Told Susie about the lights',
    options: [
      { id: 'yes', label: "The lights. They pulse. Like they're breathing." },
      { id: 'no', label: 'No. Just the headache.' },
    ],
  },
  tell_figure: {
    label: 'Told Susie about the man in the hall',
    options: [
      { id: 'yes', label: "There was a man at the end of the hall. He didn't move." },
      { id: 'no', label: "No. I'm fine. It's the headache." },
    ],
  },
  believe_john: {
    label: "Susie's response to John",
    options: [
      { id: 'believe', label: 'Believe him. Note it, check the cameras yourself.' },
      { id: 'sedate', label: 'Reassure him. Offer something to help him rest.' },
    ],
  },
  west_wing_breaker: {
    label: 'West wing breaker',
    options: [
      { id: 'reset', label: 'Reset it.' },
      { id: 'leave', label: 'Leave it tripped.' },
    ],
  },
  alvarez_or_john: {
    label: 'Alarm in Bay 2, call light in Bay 3',
    options: [
      { id: 'alvarez', label: 'Go to Mrs. Alvarez.' },
      { id: 'john', label: 'Go to John.' },
    ],
  },
  hold_or_investigate: {
    label: 'The elevator chimed',
    options: [
      { id: 'hold', label: 'Hold position with the patients.' },
      { id: 'investigate', label: 'Go look.' },
    ],
  },
  enter_west_wing: {
    label: 'The west wing door is open',
    options: [
      { id: 'enter', label: 'Go in.' },
      { id: 'leave', label: 'Shut it and walk away.' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Clues
// ---------------------------------------------------------------------------

export const CLUES: Record<string, Omit<Clue, 'time' | 'source'>> = {
  // rational
  clue_hydrocodone: {
    id: 'clue_hydrocodone',
    title: 'Two hydrocodone at 21:00',
    text: "John took two hydrocodone/APAP tablets from a bottle that isn't his, on an empty stomach, two hours before the lights started breathing.",
    kind: 'record',
    supports: 'rational',
  },
  clue_load_test: {
    id: 'clue_load_test',
    title: 'Failed load test',
    text: 'Maintenance tag on the generator: LOAD TEST 03/2024 — FAIL — CALL VENDOR. Nobody called. The unit sheds load above sixty percent.',
    kind: 'infrastructure',
    supports: 'rational',
  },
  clue_roof_leak: {
    id: 'clue_roof_leak',
    title: 'Roof leak over the service hall',
    text: 'A stained ceiling tile drips onto the concrete by the west wing door. The water runs toward the drain and spreads like footsteps.',
    kind: 'physical',
    supports: 'rational',
  },
  clue_okafor_wander: {
    id: 'clue_okafor_wander',
    title: 'Mr. Okafor in the hallway',
    text: 'Bay 4 was found standing in the hall at 23:10, looking for the bathroom — a tall man in a gown, moving slowly, not answering at first.',
    kind: 'testimony',
    supports: 'rational',
  },
  clue_voltage_log: {
    id: 'clue_voltage_log',
    title: 'Voltage sags since 21:50',
    text: 'The main panel log shows utility voltage sagging six times before midnight. The flickers started upstream of this building.',
    kind: 'record',
    supports: 'rational',
  },
  clue_transfer_switch: {
    id: 'clue_transfer_switch',
    title: 'Transfer switch out of spec',
    text: 'ATS-1 is eleven months past service with the retransfer delay set to zero. Under load it will hunt between sources and drop the floor.',
    kind: 'infrastructure',
    supports: 'rational',
  },
  // supernatural
  clue_two_frames: {
    id: 'clue_two_frames',
    title: 'Two frames',
    text: 'Camera 03 holds a tall figure at the east end of the hall for exactly two frames. The frames before and after are empty.',
    kind: 'footage',
    supports: 'supernatural',
  },
  clue_footprints_out: {
    id: 'clue_footprints_out',
    title: 'Footprints out of a locked door',
    text: 'Wet, bare footprints lead out of the west wing door toward the drain. None lead in. The door has been chained since March.',
    kind: 'physical',
    supports: 'supernatural',
  },
  clue_drag_marks: {
    id: 'clue_drag_marks',
    title: 'Drag marks',
    text: 'Something heavy was dragged from the west wing door along the service hall and into the generator room. The marks stop at the puddle.',
    kind: 'physical',
    supports: 'supernatural',
  },
  clue_west_wing_open: {
    id: 'clue_west_wing_open',
    title: 'The west wing is open',
    text: 'The west wing door stands open. It was chained from the inside. The chain is intact and hanging.',
    kind: 'physical',
    supports: 'supernatural',
  },
  clue_impossible_vitals: {
    id: 'clue_impossible_vitals',
    title: 'Heart rate zero',
    text: "For three seconds Bay 3's monitor read HR 0 — flat line, no artefact — while John was sitting up, talking.",
    kind: 'record',
    supports: 'supernatural',
  },
  clue_timestamp_jump: {
    id: 'clue_timestamp_jump',
    title: 'Timestamp runs backward',
    text: "Camera 03's clock ran backward eleven minutes and kept recording. The hall clock in frame never changed.",
    kind: 'footage',
    supports: 'supernatural',
  },
  clue_laughter: {
    id: 'clue_laughter',
    title: 'Laughter in the closed wing',
    text: 'A child laughing, far off, behind the west wing door. There are no children on the unit. There is no one in the west wing.',
    kind: 'testimony',
    supports: 'supernatural',
  },
  // ambiguous
  clue_alvarez_man: {
    id: 'clue_alvarez_man',
    title: "The man at Mrs. Alvarez's door",
    text: "Bay 2 asked who the man standing at her door was. He didn't speak. There were no visitors on the unit.",
    kind: 'testimony',
    supports: 'ambiguous',
  },
  clue_wheelchair: {
    id: 'clue_wheelchair',
    title: 'Wheelchair moved',
    text: 'The hall wheelchair is three metres from where it stood. Nobody on the footage touches it.',
    kind: 'footage',
    supports: 'ambiguous',
  },
  clue_elevator: {
    id: 'clue_elevator',
    title: 'Elevator opens on nothing',
    text: 'The elevator opened on an empty, lit cab at 23:18. Nobody called it. Nobody got off.',
    kind: 'footage',
    supports: 'ambiguous',
  },
  clue_name_call: {
    id: 'clue_name_call',
    title: 'A voice from the wall side',
    text: 'John heard his name spoken from the wall side of Bay 3 — the side with no door.',
    kind: 'testimony',
    supports: 'ambiguous',
  },
  clue_cab_figure: {
    id: 'clue_cab_figure',
    title: 'Figure in the dark cab',
    text: 'Camera 05: the dead elevator opened and something stood inside it. The camera lost signal before the doors closed.',
    kind: 'footage',
    supports: 'ambiguous',
  },
};

export const RATIONAL_CLUES = ['clue_hydrocodone', 'clue_load_test', 'clue_roof_leak', 'clue_okafor_wander', 'clue_voltage_log', 'clue_transfer_switch'] as const;
export const SUPERNATURAL_CLUES = ['clue_two_frames', 'clue_footprints_out', 'clue_drag_marks', 'clue_west_wing_open', 'clue_impossible_vitals', 'clue_timestamp_jump', 'clue_laughter'] as const;
export const AMBIGUOUS_CLUES = ['clue_alvarez_man', 'clue_wheelchair', 'clue_elevator', 'clue_name_call', 'clue_cab_figure'] as const;

// ---------------------------------------------------------------------------
// People on the unit tonight
// ---------------------------------------------------------------------------

export const STAFF = {
  marcus: { name: 'Marcus Boateng', short: 'Marcus', role: 'Unit clerk' },
  ray: { name: 'Ray Delgado', short: 'Ray', role: 'Security (until 01:00)' },
  dana: { name: 'Dana Morales', short: 'Dana', role: 'RN — called out' },
  patel: { name: 'Dr. A. Patel', short: 'Dr. Patel', role: 'ED attending — covering two floors' },
} as const;

export interface PatientNote {
  /** "23:10" style wall-clock */
  time: string;
  text: string;
  /** game minutes after which the note exists */
  after?: number;
  /** only present when this flag is set */
  requiresFlag?: string;
  /** only present when this flag is NOT set */
  requiresNotFlag?: string;
}

export interface PatientRecord {
  id: 'mercer' | 'alvarez' | 'okafor' | 'haddad';
  name: string;
  short: string;
  mrn: string;
  dob: string;
  age: number;
  sex: 'M' | 'F';
  esi: number;
  room: RoomId | null;
  bayLabel: string;
  complaint: string;
  status: string;
  history: string[];
  meds: string[];
  allergies: string;
  vitals: { bp: string; hr: number; rr: number; spo2: number; temp: string; pain: string };
  notes: PatientNote[];
  /** reading this chart records this clue (for Susie) */
  clueOnRead?: { clue: string; after?: number; requiresFlag?: string };
}

export const PATIENTS: Record<PatientRecord['id'], PatientRecord> = {
  mercer: {
    id: 'mercer',
    name: 'MERCER, JOHN',
    short: 'MERCER, J.',
    mrn: '00447108',
    dob: '03/14/1991',
    age: 35,
    sex: 'M',
    esi: 3,
    room: 'exam3',
    bayLabel: 'Bay 3',
    complaint: 'Headache × 2 days, worse tonight. Dizziness. "The lights look wrong."',
    status: 'WAITING',
    history: ['Migraine with aura since age 20 (per pt).', 'No head injury. No anticoagulants.', 'Last ate 14:00.'],
    meds: [
      'Hydrocodone/APAP 5/325 — pt states took 2 tabs at 21:00 (home supply; bottle labelled for his mother).',
      'Sumatriptan 50 mg PRN — last dose "yesterday, maybe."',
    ],
    allergies: 'NKDA',
    vitals: { bp: '152/94', hr: 104, rr: 18, spo2: 98, temp: '37.1 °C', pain: '6/10' },
    notes: [
      { time: '22:31', text: 'Arrived ambulatory, alone. Sister (Kate) by phone. Placed in waiting.' },
      { time: '23:01', text: 'Triaged. BP 152/94, HR 104. Photophobia. Denies visual changes.', after: 16, requiresNotFlag: FLAGS.john_told_lights },
      { time: '23:01', text: 'Triaged. BP 152/94, HR 104. Pt reports lights "pulsing" that others do not see. Noted for MD.', after: 16, requiresFlag: FLAGS.john_told_lights },
      { time: '23:05', text: 'Roomed Bay 3. Lights dimmed per pt request. Call light within reach.', requiresFlag: FLAGS.john_roomed },
      { time: '23:55', text: 'Pt reports a man standing at the end of the hall. Hall checked — no one. Pt oriented ×3, anxious.', requiresFlag: FLAGS.john_told_figure },
      { time: '23:57', text: 'Lorazepam 0.5 mg PO given for anxiety per standing order. Pt resting. — S.T.', requiresFlag: FLAGS.john_sedated },
      { time: '00:40', text: 'Pt found at nurse station. States he "did not want to be alone in there." Allowed to remain.', requiresFlag: FLAGS.john_at_station },
    ],
    clueOnRead: { clue: 'clue_hydrocodone' },
  },
  alvarez: {
    id: 'alvarez',
    name: 'ALVAREZ, ROSA',
    short: 'ALVAREZ, R.',
    mrn: '00390227',
    dob: '06/02/1954',
    age: 71,
    sex: 'F',
    esi: 2,
    room: 'exam2',
    bayLabel: 'Bay 2',
    complaint: 'Chest pressure × 2 h, resolved after ASA 324 mg. Observation.',
    status: 'OBS — 2nd troponin 00:30',
    history: ['HTN, hyperlipidaemia.', 'Lives alone. Daughter en route from Dayton.'],
    meds: ['Amlodipine 10 mg daily.', 'Atorvastatin 40 mg nightly.', 'ASA 324 mg given 22:12.'],
    allergies: 'Penicillin (rash)',
    vitals: { bp: '141/86', hr: 88, rr: 18, spo2: 96, temp: '36.8 °C', pain: '0/10' },
    notes: [
      { time: '22:20', text: 'Placed on monitor. 12-lead: sinus, no acute changes. Trop 1 negative.' },
      { time: '22:50', text: 'Resting with eyes closed. Asked for the hall door left open "so I can see someone."' },
      { time: '23:30', text: 'Pt asked "who was the man standing at my door." No visitors on unit. Reassured. Will re-check.', requiresFlag: SUBFLAGS.alvarez_man },
      { time: '00:20', text: 'Monitor alarm — HR 130s irregular, pt diaphoretic. Dr. Patel paged on radio.', requiresFlag: SUBFLAGS.alvarez_alarm },
    ],
    clueOnRead: { clue: 'clue_alvarez_man', requiresFlag: SUBFLAGS.alvarez_man },
  },
  okafor: {
    id: 'okafor',
    name: 'OKAFOR, EMEKA',
    short: 'OKAFOR, E.',
    mrn: '00412976',
    dob: '11/19/1967',
    age: 58,
    sex: 'M',
    esi: 4,
    room: 'exam4',
    bayLabel: 'Bay 4',
    complaint: 'Laceration L palm, 4 cm, kitchen knife. Awaiting sutures.',
    status: 'AWAIT SUTURE — PA en route',
    history: ['Type 2 diabetes.', 'Works nights (warehouse). Reports "no sleep since Tuesday."'],
    meds: ['Metformin 1000 mg BID.', 'Tetanus up to date (2022).'],
    allergies: 'NKDA',
    vitals: { bp: '128/82', hr: 76, rr: 16, spo2: 97, temp: '36.9 °C', pain: '3/10' },
    notes: [
      { time: '22:05', text: 'Irrigated, pressure dressing applied. Bleeding controlled.' },
      { time: '23:10', text: 'Pt found ambulatory in hallway near Imaging, states he was looking for the bathroom. Redirected to room. Oriented ×3, tired.', after: 25 },
    ],
    clueOnRead: { clue: 'clue_okafor_wander', after: 25 },
  },
  haddad: {
    id: 'haddad',
    name: 'HADDAD, SAMIR',
    short: 'HADDAD, S.',
    mrn: '00451190',
    dob: '08/30/1970',
    age: 55,
    sex: 'M',
    esi: 4,
    room: 'waiting',
    bayLabel: 'Waiting',
    complaint: 'Cough × 5 days, low-grade fever.',
    status: 'DC PENDING — Rx sent',
    history: ['Smoker, 1 ppd.'],
    meds: ['Azithromycin Z-pak sent to pharmacy.'],
    allergies: 'NKDA',
    vitals: { bp: '134/80', hr: 92, rr: 18, spo2: 95, temp: '38.0 °C', pain: '2/10' },
    notes: [
      { time: '21:50', text: 'Arrived. Seen by Dr. Patel in triage. CXR clear.' },
      { time: '23:20', text: 'Discharged. Walked out the front; Ray locked the door behind him.', after: 35 },
    ],
  },
};

export const PATIENT_ORDER: PatientRecord['id'][] = ['alvarez', 'mercer', 'okafor', 'haddad'];

// ---------------------------------------------------------------------------
// Per-phase text that is indexed by GamePhase
// ---------------------------------------------------------------------------

export const TV_LINES: Record<GamePhase, string[]> = {
  normal: ['MUTED · LOCAL NEWS · Council approves roadway funding · Rain through Thursday · High school playoffs postponed'],
  unease: ['MUTED · WEATHER · Storm cells west of the county · Flood watch for low-lying roads overnight'],
  contradictions: ['MUTED · BREAKING · Scattered outages reported on the east side · Utility says crews dispatched'],
  outage: ['(the screen is dark)'],
  generator: ['(the screen is dark)'],
  crisis: ['(the screen is dark)'],
  resolution: ['(the screen is dark)'],
};

export const PHONE_STATUS: Record<GamePhase, string> = {
  normal: 'LTE · 4 bars',
  unease: 'LTE · 4 bars',
  contradictions: 'LTE · 3 bars',
  outage: 'No Service',
  generator: '1 bar · No Internet',
  crisis: '1 bar · No Internet',
  resolution: 'LTE · 2 bars',
};

export const MARCUS_BY_PHASE: Record<GamePhase, string[]> = {
  normal: ["They're backed up. Shouldn't be long.", "Dr. Patel's covering two floors tonight. You're on the list, I promise."],
  unease: ["You're in 3? Someone'll be in. Patel's finishing a suture upstairs."],
  contradictions: ["Still waiting on the doctor. I know. I'm sorry."],
  outage: ['Stay where you are. Give it a second.'],
  generator: ["Stay where the lights are. Generator's got the hall and the station. That's it."],
  crisis: ["Phones are down. Radios are down. I'm not leaving this desk."],
  resolution: ['Twenty minutes, they said. Then it was over. Then it was morning.'],
};

// ---------------------------------------------------------------------------
// Lines — grouped by scene. Short, grounded, specific.
// ---------------------------------------------------------------------------

export const LINES = {
  intro: {
    title: 'NIGHT SHIFT',
    subtitle: 'St. Augustine Regional — Emergency Department',
    timeCard: '10:47 PM',
    susiePhone: ["Yeah. Yeah, I'm here.", 'Who called out?', '…Dana. Okay.'],
    paulRadio: 'Paul here. Service hall, then the generator log.',
  },
  intercom: {
    johnToTriage: 'John Mercer to triage, please. John Mercer.',
    westWingPage: 'John Mercer to the west wing. John Mercer.',
    blackoutFragment: '—to the west— …please—',
    relief: "Day shift's coming in early. Power company says twenty minutes.",
    susiePage: 'Susie Tran to Bay 2. Susie Tran.',
  },
  marcus: {
    byPhase: MARCUS_BY_PHASE,
    didYouPage: "I didn't page anything. There's no west wing to page to.",
    toSusie: ["Evening. Dana's out, so… welcome back.", 'Bay 2 keeps asking for the door open. Bay 4 keeps wandering.'],
    toSusieLate: ["Generator's holding. Ray's not answering. I don't know where Ray is."],
    toPaul: ['Paul. Lot B lights are out again. Not tonight, just so you know.', "Imaging door's sticking. Ray already told you? Okay."],
    toPaulLate: ['Paul. Whatever you did in there, the station still has lights. Keep doing that.'],
    howLong: 'How long?',
    didYouPageMe: 'Did you page me? To the west wing?',
    neverMind: 'Never mind.',
  },
  triage: {
    seat: 'Have a seat. John, right?',
    vitals: 'Hundred and fifty-two over ninety-four. Heart rate one-oh-four.',
    question: 'Any visual changes? Lights, spots, anything?',
    johnYes: "The lights. They pulse. Like they're breathing.",
    johnNo: 'No. Just the headache.',
    afterYes: "Okay. I'm writing that down. How many of those pills did you take?",
    johnPills: "Two. Around nine. One wasn't doing anything.",
    afterNo: "Okay. We'll get you into a room.",
    rooming: 'Bay 3. Lie down if you want. Someone will be in soon.',
    objectiveAfter: 'Rest in Bay 3. Someone will be in soon.',
  },
  haddad: {
    cough: '(coughing, two seats over)',
    wait: 'They said twenty minutes. An hour ago.',
    leaving: 'Feel better, man.',
  },
  alvarez: {
    question: 'Who was the man standing at my door?',
    detail: "He didn't say anything. He just stood there until the light changed.",
    susieReply: "There's nobody on the unit but staff, Mrs. Alvarez. I'll check.",
    later: 'Is he gone? The man?',
  },
  okafor: {
    hallway: 'Which way is the bathroom? I keep ending up here.',
    redirect: "This way, Mr. Okafor. Bay 4. I'll show you.",
    bed: "I haven't been out of this bed. I'd remember that.",
  },
  susieCheck: {
    prompt: 'Did you see someone in the hall?',
    johnYes: "There was a man at the end of the hall. He didn't move. He wasn't… he wasn't anyone.",
    johnNo: "No. I'm fine. It's the headache.",
    believe: "Okay. I believe you. I'm going to look at the cameras myself.",
    sedate: "You're exhausted. I can give you something to help you rest. Half a milligram.",
    johnAfterSedate: 'Okay. Yeah. Okay.',
  },
  radio: {
    flickers: 'Paul, you seeing these flickers?',
    voltage: "We're getting voltage drops across the floor.",
    generatorUp: "Generator's up. Phones are out. Radios only.",
    paulComeBack: 'Paul. Paul, come back.',
    whereIsRay: 'Anybody know where Ray is?',
  },
  blackout: {
    john: ['(the monitor stops)', 'Hello?'],
    susie: ['Okay. Okay. Emergency protocol.'],
    paulFlashlight: ['(click)'],
    paulDark: ['(your cart rolls, by itself, a metre down the hall)'],
    knock: '(one knock. Distant. Patient.)',
  },
  generator: {
    susie: "Generator. Fifteen seconds. That's… that's within spec.",
    paul: "Three zones. That's all she'll carry.",
    john: 'The light under the door is the wrong colour.',
    panelHint: 'Only three zones can run on the generator.',
    loadShed: 'GENERATOR OVERLOAD — LOAD SHED',
    westWingHum: '(a hum starts behind the closed door)',
  },
  crisis: {
    johnDragging: "Something's dragging. In the hall. Toward the door.",
    johnCurtain: '(the curtain moves. There is no draught.)',
    paulDoor: "The door's open. Nobody has a key to that door.",
    paulGenerator: "She's surging. Come on. Come on.",
    susieElevator: "The elevator's dead. The elevator is dead and it just chimed.",
    signalLost: 'SIGNAL LOST',
    radioStatic: '(radio static)',
  },
  resolution: {
    settle: '(the hum settles)',
    johnSafe: "John is asleep in a chair at the nurse station, under Susie's coat.",
    johnRoom: 'John has not left Bay 3. He has not said anything for an hour.',
    susieAccounted: 'Susie counts heads twice. Everyone she started with.',
    susieBelieved: "Susie writes 'pt report' on the whiteboard and underlines it. Then she wipes it.",
    paulLog: 'Paul writes in the generator log: RAN 97 MIN. FUEL 34 %. NO FAULTS. He looks at the last word for a while.',
    paulWestWing: 'Paul shuts the west wing breaker. The hum behind the door takes a long time to stop.',
    paulEntered: 'Paul does not tell anyone what the west wing looked like inside.',
    missing: (name: string): string => `${name} is unaccounted for. Security pulls the footage.`,
  },
  figure: {
    johnSees: '(at the end of the hall — someone standing. Not moving.)',
    johnGone: '(gone)',
    susieOkafor: 'Mr. Okafor? You need to be in your room.',
    johnWhatWasThat: 'Is that thing supposed to do that?',
  },
  anomalies: {
    footstepsNoOne: '(footsteps in the hall. They stop outside the door.)',
    callLightEmpty: 'Bay 1 call light. Bay 1 is empty.',
    bedMoved: 'The bed is forty centimetres off its floor marks.',
    wheelchair: 'The wheelchair was by Imaging. You are sure it was by Imaging.',
    elevatorEmpty: 'Nobody called it.',
    leakGrounded: '(water dripping from a stained tile — the puddle spreads toward the drain)',
    footprintsOut: '(wet footprints. Bare. They lead out of the locked door.)',
    nameMismatch: 'The monitor header reads MORALES, D. Then ALVAREZ, R.',
    nameCall: '(a voice from behind the wall) …John?',
    vendingDrop: '(a bottle drops. No one is at the machine.)',
    cascade: '(the strips go out one by one, toward you)',
    hrZero: 'HR 0 — — —',
    mirror: 'Your reflection is a half-second late.',
    intercomName: '(the intercom says a name no one paged)',
    wrongDirection: '(footsteps — behind the wall. Moving east.)',
    twoCameras: '(the same person in two places)',
    timestamp: '(the timestamp runs backward)',
    behindPaul: '(two frames: someone behind him)',
    doorGap: '(a shape passes the gap in the door)',
    shadow: '(the shadow behind the curtain moves. The curtain does not.)',
    ceilingDrag: '(something dragging across the ceiling)',
    cold: "It's cold in here. Fifteen degrees colder.",
    bedMovedTx1: 'The bed in Treatment 1 is a metre off its marks. Treatment 1 has been empty all night.',
    wetSign: 'The wet floor sign was by the fountain. It is by the Imaging doors now.',
    elevatorEmptyJohn: '(the elevator opens on an empty, lit car. Nobody gets off.)',
    dragMarks: '(something heavy was dragged through here. The marks stop at the puddle.)',
    childLaugh: '(a child laughing — far off, behind the door)',
    entersRoom: '(someone goes into Treatment 1 ahead of you)',
    emptyRoom: "Nobody. The bed's still made.",
    deadMachineDrop: '(the dead machine drops a bottle)',
    outsideGlass: '(someone standing outside the glass, in the rain. Facing in.)',
    outsideGlassRay: '(Ray, under the canopy, smoking)',
    radioName: '(radio) …Paul…',
    unknownTextReal: 'dont open the door john',
    unknownTextBanal: 'hey is this marco',
    thermostat: 'Thermostat reads 72. The air says otherwise.',
    bottleTray: 'A water bottle sits in the tray. No one bought it.',
    figureWatching: '(at the east end of the hall. Watching the station.)',
  },
  tv: TV_LINES,
  boards: {
    assignments: {
      title: 'ED ASSIGNMENTS — NIGHT 22:45 → 07:00',
      lines: [
        'CHARGE: — (call Dr. Patel ×4471 for consult)',
        'RN: S. TRAN  (covering D. MORALES — called out)',
        'UNIT CLERK: M. BOATENG',
        'SECURITY: R. DELGADO (until 01:00)',
        'EVS: P. REYES',
        '',
        'BAY 1: —',
        'BAY 2: ALVAREZ, R.  obs / trop 2 @ 00:30',
        'BAY 3: —',
        'BAY 4: OKAFOR, E.  await suture',
        'TX 1:  —',
        'WR:    MERCER, J. · HADDAD, S.',
        '',
        'IMAGING CLOSED OVERNIGHT — CT via main campus',
        'WEST WING: NO ENTRY — ABATEMENT',
      ],
    },
    notices: {
      title: 'STAFF NOTICES',
      lines: [
        'Flu shots — Tuesdays 14:00–16:00, Occupational Health.',
        'West wing abatement: contractor on site 10/09. Doors stay chained. — Facilities',
        'Lot B lights out — ticket #4418 open since 09/22.',
        'Potluck 10/14. Sign-up sheet in lounge. (Marcus is bringing the thing again.)',
        'Please do not prop the Imaging doors. They are not sticking. You are propping them.',
      ],
    },
    evs: {
      title: 'EVS — NIGHT ROUTE — P. REYES',
      lines: [
        '2245  Clock in · cart check · radio CH 2',
        '2300  Clean Supply restock (gloves, gowns, chux)',
        '2330  Waiting room floors — after discharge',
        '0015  Trash run — Service E biohazard bins',
        '0100  Generator room — log fuel, check puddle (ticket #4471)',
        '',
        'WEST WING: NO ENTRY — asbestos abatement pending.',
        'Roof leak over service hall reported 09/30 — ticket #4471 OPEN.',
        'Flashlight is in YOUR locker. Not the cart. — P.',
      ],
    },
  },
  tags: {
    loadTest: {
      title: 'EQUIPMENT TAG — GENSET G-1',
      lines: ['LOAD TEST  03/2024', 'RESULT: FAIL — unit shed load at 60 %', 'CALL VENDOR — Hensley Power Systems', 'Tech: R.D.   Ticket 2231 — OPEN'],
    },
    transferSwitch: {
      title: 'EQUIPMENT TAG — ATS-1',
      lines: ['TRANSFER SWITCH — PM OVERDUE', 'Last service 11/2023', 'Retransfer delay set 0 s (spec: 300 s)', 'DO NOT OPERATE MANUALLY WITHOUT LOCKOUT'],
    },
  },
  notes: {
    danaLocker: {
      title: "Sticky note — inside Dana's locker",
      lines: ['S —', 'Sorry about tonight. Food poisoning, not an excuse.', 'Bay 2 lady is sweet. Leave her door open.', 'Watch the Imaging door, it sticks.', "Don't let them put anyone in 1.", '— D'],
    },
    paulLocker: {
      title: 'Locker — P. REYES',
      lines: ['Shift sheet. Spare radio battery.', 'A photo of a kid on a bike, corner bent.', 'Hearing protection you never wear.'],
    },
    cartChecklist: {
      title: 'EVS CART — CHECKLIST',
      lines: ['Neutral cleaner ✓  Disinfectant ✓  Microfibre ×12 ✓', 'Wet-floor sign ✓ (hall)  Liners ✓  Gloves M ✓', 'Flashlight — see locker'],
      rolled: 'The cart is a metre from where you left it. The brake is on.',
    },
    supplyCart: {
      title: 'CLEAN SUPPLY — RESTOCK',
      lines: ['Gloves S/M/L ✓', 'Gowns ✓', 'Chux ✓', 'Flush, tape, 20 g angiocaths ✓', 'Initial: P.R.'],
    },
  },
  phoneStatus: PHONE_STATUS,
  vending: {
    johnWater: 'Cold. Your hands are shaking a little.',
    johnSnack: 'Pretzels. You are not hungry.',
    staff: 'The machine takes the dollar on the second try.',
    dead: 'The machine is dark.',
  },
  coffee: {
    pour: 'Burnt. It works.',
    cold: "The pot's cold.",
  },
  sink: {
    johnWash: 'Cold water. It helps for about ten seconds.',
    staffWash: '(twenty seconds, like the poster says)',
  },
  elevator: {
    called: '(the car arrives. Empty. Lit.)',
    dead: 'The call button is dark.',
  },
  monitors: {
    johnReads: "HR 104. You don't know if that's bad.",
    standby: 'NO PATIENT — STANDBY',
  },
  mop: {
    mopped: 'Mopped. The tile above still drips.',
    bucket: 'Half full. Grey water.',
    footprintsNoMop: "You don't mop these. You take a picture, and then you don't send it to anyone.",
  },
  supply: {
    paul: 'Gloves, gowns, chux. Done.',
    susie: 'Flush, tape, a twenty.',
  },
  locker: {
    flashlight: 'Flashlight — press F',
    flashlightCart: 'Flashlight from the cart — press F',
  },
  cctv: {
    hint: 'Security feeds — Esc to return',
  },
} as const;

// ---------------------------------------------------------------------------
// John's phone — Kate's thread, evolving through the night
// ---------------------------------------------------------------------------

export interface PhoneMessage {
  /** game minutes when it arrives (negative = before the shift) */
  time: number;
  from: 'Kate' | 'John' | 'Unknown';
  text: string;
  requiresFlag?: string;
  requiresNotFlag?: string;
  scenarios?: ScenarioType[];
}

export const PHONE_THREAD: PhoneMessage[] = [
  { time: -40, from: 'Kate', text: 'did they call you yet' },
  { time: -39, from: 'John', text: 'not yet. backed up' },
  { time: -38, from: 'Kate', text: "ok text me when you're in" },
  { time: 8, from: 'Kate', text: 'mom says take the pills WITH food next time' },
  { time: 22, from: 'Kate', text: 'you in yet?' },
  { time: 23, from: 'Kate', text: 'did you tell them about the lights', requiresNotFlag: FLAGS.john_told_lights },
  { time: 23, from: 'Kate', text: 'good. make them write it down', requiresFlag: FLAGS.john_told_lights },
  { time: 40, from: 'Kate', text: 'you still awake?' },
  { time: 56, from: 'Kate', text: 'john?' },
  { time: 84, from: 'Kate', text: 'are you ok?? the news says half the east side is dark' },
  { time: 87, from: 'Kate', text: 'john??' },
  { time: 93, from: 'Unknown', text: LINES.anomalies.unknownTextReal, scenarios: ['supernatural', 'mixed'], requiresFlag: SUBFLAGS.unknown_text },
  { time: 93, from: 'Unknown', text: LINES.anomalies.unknownTextBanal, scenarios: ['grounded', 'psychological'], requiresFlag: SUBFLAGS.unknown_text },
  { time: 126, from: 'Kate', text: "i'm driving over. don't move" },
  { time: 141, from: 'Kate', text: "they won't let me in the lot. there's a truck across the entrance" },
  { time: 166, from: 'Kate', text: 'they said 20 min. i can see the sign from here' },
];

// ---------------------------------------------------------------------------
// Radio log (CH 2 — Facilities / Security)
// ---------------------------------------------------------------------------

export interface RadioMessage {
  time: number;
  from: string;
  to: CharacterId[] | 'all';
  text: string;
  requiresFlag?: string;
}

export const RADIO_LOG: RadioMessage[] = [
  { time: 1, from: 'Marcus', to: ['paul'], text: 'Paul, lot B lights are out again. Not tonight, just so you know.' },
  { time: 6, from: 'Ray', to: ['paul', 'susie'], text: "Ray. Doing a walk. Imaging door's sticking again, Paul." },
  { time: 15, from: 'Marcus', to: 'all', text: 'Paging Mercer to triage in one.' },
  { time: 35, from: 'Ray', to: ['paul', 'susie'], text: "Mr. Haddad's out the front. Locked it behind him." },
  { time: 65, from: 'Marcus', to: ['paul'], text: LINES.radio.flickers },
  { time: 74, from: 'Marcus', to: 'all', text: `${LINES.radio.voltage} ${LINES.radio.whereIsRay}` },
  { time: 83, from: 'Marcus', to: 'all', text: LINES.radio.generatorUp },
  { time: 98, from: 'Marcus', to: ['susie'], text: "Susie — Bay 2's daughter called the main line before it dropped. Twenty minutes out." },
  { time: 112, from: 'Marcus', to: ['paul'], text: "Paul, the station's good. Can you give the exam rooms anything?" },
  { time: 131, from: 'Marcus', to: ['paul'], text: LINES.radio.paulComeBack },
  { time: 167, from: 'Marcus', to: 'all', text: LINES.intercom.relief },
];

// ---------------------------------------------------------------------------
// Breaker zones (Paul's panel) and the utility log
// ---------------------------------------------------------------------------

export const ZONE_LABELS: Record<ZoneId, { label: string; amps: string }> = {
  corridor_w: { label: 'CORRIDOR WEST — EM LTG', amps: '20A' },
  corridor_e: { label: 'CORRIDOR EAST — STATION', amps: '20A' },
  exam: { label: 'EXAM 1–5 / MED ROOM', amps: '30A' },
  public: { label: 'WAITING / TRIAGE / LOUNGE', amps: '30A' },
  service: { label: 'SERVICE HALL / ELEC / GEN AUX', amps: '20A' },
  cctv: { label: 'SECURITY CAMERAS / NVR', amps: '15A' },
  west_wing: { label: 'WEST WING (DECOMM.)', amps: '60A' },
};

/** Utility voltage log on the main panel — entries appear as the night goes on. */
export const VOLTAGE_LOG: { time: number; text: string }[] = [
  { time: 0, text: '21:50  SAG  462 V  0.8 s  (spec 480 ±5 %)' },
  { time: 0, text: '22:12  SAG  458 V  1.1 s' },
  { time: 2, text: '22:47  SAG  455 V  0.9 s' },
  { time: 26, text: '23:11  SAG  449 V  1.4 s' },
  { time: 49, text: '23:34  SAG  441 V  2.0 s  ALARM' },
  { time: 65, text: '23:50  SAG  436 V  2.6 s  ALARM' },
  { time: 74, text: '23:59  SAG  420 V  3.1 s  ALARM  UNDERVOLT' },
  { time: 80, text: '00:05  LOSS OF UTILITY  —  ATS TRANSFER  0.0 s delay' },
];

// ---------------------------------------------------------------------------
// Objectives — one line per character per phase
// ---------------------------------------------------------------------------

export const OBJECTIVES: Record<CharacterId, Partial<Record<GamePhase, string>>> = {
  john: {
    normal: 'Wait to be called.',
    unease: 'Rest in Bay 3. Someone will be in soon.',
    contradictions: 'Try to rest.',
    outage: "Stay put. Or don't.",
    generator: "Stay put… or don't.",
    crisis: 'Get to the nurse station.',
    resolution: 'Wait for morning.',
  },
  susie: {
    normal: 'Badge in. Check the board and your patients.',
    unease: 'Do rounds. Check on Bay 2.',
    contradictions: 'Check on Bay 3.',
    outage: 'Emergency protocol. Check patients.',
    generator: 'Check patients. Account for everyone.',
    crisis: 'Keep everyone where you can see them.',
    resolution: 'Hand off to day shift.',
  },
  paul: {
    normal: 'Restock Supply, then check the generator log.',
    unease: 'Finish the service hall.',
    contradictions: 'Check the electrical room.',
    outage: 'Get to the generator.',
    generator: 'Restore what the generator can carry.',
    crisis: 'Keep the generator running.',
    resolution: 'Log the night. Go home.',
  },
};

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------

export const ENDING_TITLES: Record<EndingId, string> = {
  morning: 'MORNING COMES',
  missing: 'SOMEONE MISSING',
  rational: 'A RATIONAL EXPLANATION',
  came_through: 'SOMETHING CAME THROUGH',
};

export const ENDING_LINES: Record<EndingId, string[]> = {
  morning: [
    '06:04. The rain stopped sometime after four.',
    'Day shift badges in through the ambulance doors, talking about traffic.',
    'Everyone is accounted for. Nobody writes anything down.',
    'The west wing door is closed. It was always closed.',
  ],
  missing: [
    'The shift ends at 01:45 like every other shift.',
    'One bed is empty. The curtain is on the floor.',
    'Security pulls the footage. Camera 03 shows the hall, and then it shows nothing.',
    'The last frame of them is two frames long.',
  ],
  rational: [
    'Two hydrocodone on an empty stomach. Forty hours awake. A migraine with aura.',
    'A failed load test. A transfer switch nobody serviced. Voltage sagging all evening.',
    'A confused patient in the hallway. A roof leaking over the service hall.',
    'It all fits. Facilities closes the ticket by noon.',
    "Camera 03's last timestamp reads 06:12. In the frame, the hall clock says 01:44.",
  ],
  came_through: [
    'Two frames on Camera 03. Wet footprints leading out of a door chained since March.',
    'Drag marks into the generator room. A heart rate of zero on a man who was talking.',
    'The west wing was open. Nobody has a key.',
    'Something came through tonight. In the morning it is still here.',
  ],
};
