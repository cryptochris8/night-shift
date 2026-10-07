/**
 * Ending evaluation (CONTRACT §5 Phase 7) and the short summary shown on the ending screen.
 * The summary is a record, not prose: three to five lines — the verdict lines content.ts wrote for
 * the ending, then what this particular night did to each of the three, chosen by flags.
 */
import { formatClock12 } from '../core/clock';
import { CHARACTER_IDS, type CharacterId, type ClueSupport, type EndingId, type GameState, type RoomId } from '../core/types';
import { ENDING_LINES, ENDING_TITLES, LINES } from '../story/content';
import { F } from './Director.ids';

export { ENDING_TITLES };

const ROOM_NAMES: Partial<Record<RoomId, string>> = {
  exam3: 'Bay 3',
  exam2: 'Bay 2',
  exam4: 'Bay 4',
  nurse_station: 'the nurse station',
  corridor: 'the patient hallway',
  generator: 'the generator room',
  electrical: 'the electrical room',
  service_n: 'the service corridor',
  service_e: 'the east service corridor',
  closed_wing: 'the west wing',
  waiting: 'the waiting room',
  elevator: 'the elevator',
};

export function clueCount(st: Readonly<GameState>, supports: ClueSupport): number {
  return st.clues.filter((c) => c.supports === supports).length;
}

export function hasClue(st: Readonly<GameState>, id: string): boolean {
  return st.clues.some((c) => c.id === id);
}

/** §5: missing → came_through (real scenario + 3 supernatural clues) → rational (3 rational clues) → morning. */
export function evaluateEnding(st: Readonly<GameState>): EndingId {
  if (CHARACTER_IDS.some((id) => st.characters[id].missing)) return 'missing';
  const real = st.scenario === 'supernatural' || st.scenario === 'mixed';
  if (real && clueCount(st, 'supernatural') >= 3) return 'came_through';
  if (clueCount(st, 'rational') >= 3) return 'rational';
  return 'morning';
}

/** Which character went missing (first found), for the ending montage. */
export function missingCharacter(st: Readonly<GameState>): CharacterId | null {
  return CHARACTER_IDS.find((id) => st.characters[id].missing) ?? null;
}

export function missingWhere(st: Readonly<GameState>, id: CharacterId): RoomId {
  const v = st.flags[`dir_missing_${id}_where`];
  return typeof v === 'string' ? (v as RoomId) : st.characters[id].location;
}

export function missingWhen(st: Readonly<GameState>, id: CharacterId): number {
  const v = st.flags[`dir_missing_${id}_when`];
  return typeof v === 'number' ? v : st.time;
}

/**
 * Verdict lines from content.ts for this ending. A line may be made conditional with a prefix:
 * `?flag:text` shows only when the flag is set, `?!flag:text` only when it is not.
 */
function verdictLines(st: Readonly<GameState>, ending: EndingId): string[] {
  const raw = (ENDING_LINES as Partial<Record<EndingId, unknown>>)[ending];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const m = /^\?(!?)([a-z0-9_]+):\s*(.*)$/i.exec(item);
    if (!m) {
      out.push(item);
      continue;
    }
    const want = m[1] !== '!';
    if (Boolean(st.flags[m[2]]) === want) out.push(m[3]);
  }
  return out;
}

/** This night's record for each of the three, in content's words, picked by flags. */
function characterLines(st: Readonly<GameState>): string[] {
  const f = (k: string): boolean => Boolean(st.flags[k]);
  const who = missingCharacter(st);
  const R = LINES.resolution;
  const out: string[] = [];
  if (who) {
    const c = st.characters[who];
    const where = ROOM_NAMES[missingWhere(st, who)] ?? missingWhere(st, who);
    out.push(`${c.name} was last seen in ${where} at ${formatClock12(missingWhen(st, who))}.`);
  }
  if (who !== 'john') {
    if (f(F.john_at_station)) out.push(R.johnSafe);
    else if (!f(F.john_left_room)) out.push(R.johnRoom);
  }
  if (who !== 'susie') {
    if (f(F.susie_believed)) out.push(R.susieBelieved);
    else if (!who) out.push(R.susieAccounted);
  }
  if (who !== 'paul') {
    if (f(F.paul_entered_west_wing)) out.push(R.paulEntered);
    else if (f(F.paul_shut_west_wing)) out.push(R.paulWestWing);
    else out.push(R.paulLog);
  }
  return out;
}

/** 3–5 short lines: the verdict first, then the record of the night. */
export function endingSummary(st: Readonly<GameState>, ending: EndingId): string[] {
  const verdict = verdictLines(st, ending);
  const record = characterLines(st);
  const out: string[] = [];
  const push = (l: string): void => {
    if (out.length < 5 && l && !out.includes(l)) out.push(l);
  };
  // the impossible detail of the rational ending always closes the list
  const closer = ending === 'rational' && verdict.length > 0 ? verdict[verdict.length - 1] : null;
  const body = closer ? verdict.slice(0, -1) : verdict;
  for (const l of body.slice(0, ending === 'missing' ? 2 : 3)) push(l);
  for (const l of record.slice(0, closer ? 1 : 2)) push(l);
  for (const l of body.slice(3)) push(l);
  if (closer) {
    if (out.length >= 5) out.pop();
    out.push(closer);
  }
  if (out.length === 0) out.push(ENDING_TITLES[ending]);
  return out.slice(0, 5);
}
