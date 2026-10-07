import { describe, expect, it } from 'vitest';
import { makeInitialState } from '../src/core/state';
import type { Clue, EndingId, GameState, ScenarioType } from '../src/core/types';
import { clueCount, endingSummary, evaluateEnding, hasClue, missingCharacter, missingWhen, missingWhere } from '../src/events/endings';
import { CLUES } from '../src/story/content';

function night(scenario: ScenarioType, clueIds: string[] = [], missing: ('john' | 'susie' | 'paul')[] = []): GameState {
  const st = makeInitialState('NS-TST-001', scenario);
  st.time = 178;
  st.clues = clueIds.map((id, i): Clue => ({ ...CLUES[id], time: 10 + i, source: 'susie' }));
  for (const id of missing) {
    st.characters[id].missing = true;
    st.characters[id].danger = 1;
  }
  return st;
}

const RATIONAL3 = ['clue_hydrocodone', 'clue_load_test', 'clue_voltage_log'];
const SUPER3 = ['clue_two_frames', 'clue_drag_marks', 'clue_footprints_out'];

describe('evaluateEnding', () => {
  it('anyone missing overrides everything else', () => {
    expect(evaluateEnding(night('supernatural', [...SUPER3, ...RATIONAL3], ['paul']))).toBe<EndingId>('missing');
  });

  it('came_through needs a real-phenomenon night AND three supernatural clues', () => {
    expect(evaluateEnding(night('supernatural', SUPER3))).toBe('came_through');
    expect(evaluateEnding(night('mixed', SUPER3))).toBe('came_through');
    expect(evaluateEnding(night('supernatural', SUPER3.slice(0, 2)))).toBe('morning');
  });

  it('supernatural evidence on a grounded or psychological night never proves anything', () => {
    expect(evaluateEnding(night('grounded', SUPER3))).toBe('morning');
    expect(evaluateEnding(night('psychological', [...SUPER3, ...RATIONAL3]))).toBe('rational');
  });

  it('rational needs three rational clues; ambiguous clues do not count', () => {
    expect(evaluateEnding(night('grounded', RATIONAL3))).toBe('rational');
    expect(evaluateEnding(night('grounded', ['clue_hydrocodone', 'clue_load_test', 'clue_alvarez_man', 'clue_wheelchair']))).toBe('morning');
  });

  it('came_through outranks rational when both thresholds are met on a real night', () => {
    expect(evaluateEnding(night('mixed', [...SUPER3, ...RATIONAL3]))).toBe('came_through');
  });

  it('defaults to morning', () => {
    expect(evaluateEnding(night('psychological'))).toBe('morning');
  });
});

describe('ending helpers', () => {
  it('clueCount / hasClue', () => {
    const st = night('mixed', ['clue_hydrocodone', 'clue_two_frames', 'clue_load_test']);
    expect(clueCount(st, 'rational')).toBe(2);
    expect(clueCount(st, 'supernatural')).toBe(1);
    expect(hasClue(st, 'clue_two_frames')).toBe(true);
    expect(hasClue(st, 'clue_laughter')).toBe(false);
  });

  it('missingCharacter / missingWhere / missingWhen read the director flags with sensible fallbacks', () => {
    const st = night('mixed', [], ['john']);
    expect(missingCharacter(st)).toBe('john');
    expect(missingWhere(st, 'john')).toBe(st.characters.john.location);
    expect(missingWhen(st, 'john')).toBe(st.time);
    st.flags.dir_missing_john_where = 'exam3';
    st.flags.dir_missing_john_when = 139.5;
    expect(missingWhere(st, 'john')).toBe('exam3');
    expect(missingWhen(st, 'john')).toBe(139.5);
    expect(missingCharacter(night('mixed'))).toBeNull();
  });

  it('endingSummary gives 1-5 short lines for every ending and never names the scenario', () => {
    const cases: [EndingId, GameState][] = [
      ['morning', night('grounded')],
      ['missing', night('mixed', [], ['susie'])],
      ['rational', night('grounded', RATIONAL3)],
      ['came_through', night('supernatural', SUPER3)],
    ];
    for (const [ending, st] of cases) {
      const lines = endingSummary(st, ending);
      expect(lines.length, ending).toBeGreaterThanOrEqual(1);
      expect(lines.length, ending).toBeLessThanOrEqual(5);
      for (const l of lines) {
        expect(l.length, `${ending}: ${l}`).toBeLessThanOrEqual(160);
        expect(l.toLowerCase(), `${ending} leaks the scenario: ${l}`).not.toMatch(/\b(scenario|grounded|psychological|supernatural night|mixed)\b/);
      }
    }
  });
});
