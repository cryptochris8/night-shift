import { describe, expect, it } from 'vitest';
import { minutesAt } from '../src/core/clock';
import {
  CHARACTER_IDS,
  DEFAULT_SETTINGS,
  DEFAULT_TIME_SCALE,
  PHASE_ORDER,
  PHASE_STARTS,
  SHIFT_LENGTH_MINUTES,
  SHIFT_START_HOUR,
  SHIFT_START_MINUTE,
  ZONES,
  phaseForTime,
  type GamePhase,
} from '../src/core/types';

describe('phaseForTime', () => {
  it('returns each phase exactly at its start minute', () => {
    for (const phase of PHASE_ORDER) expect(phaseForTime(PHASE_STARTS[phase])).toBe(phase);
  });

  it('returns the previous phase just before each boundary', () => {
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      const start = PHASE_STARTS[PHASE_ORDER[i]];
      expect(phaseForTime(start - 1e-9)).toBe(PHASE_ORDER[i - 1]);
      expect(phaseForTime(start - 0.5)).toBe(PHASE_ORDER[i - 1]);
    }
  });

  it('holds a phase until the next boundary', () => {
    for (let i = 0; i < PHASE_ORDER.length - 1; i++) {
      const mid = (PHASE_STARTS[PHASE_ORDER[i]] + PHASE_STARTS[PHASE_ORDER[i + 1]]) / 2;
      expect(phaseForTime(mid)).toBe(PHASE_ORDER[i]);
    }
  });

  it('is normal before the shift and resolution at and after its end', () => {
    expect(phaseForTime(-1)).toBe('normal');
    expect(phaseForTime(0)).toBe('normal');
    expect(phaseForTime(SHIFT_LENGTH_MINUTES)).toBe('resolution');
    expect(phaseForTime(1e9)).toBe('resolution');
  });

  it('never goes backwards as time advances', () => {
    let last = -1;
    for (let t = -5; t <= 190; t += 0.25) {
      const idx = PHASE_ORDER.indexOf(phaseForTime(t));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe('timeline constants', () => {
  it('PHASE_ORDER lists every phase once, in strictly increasing start order', () => {
    const keys = Object.keys(PHASE_STARTS) as GamePhase[];
    expect([...PHASE_ORDER].sort()).toEqual(keys.sort());
    expect(new Set(PHASE_ORDER).size).toBe(PHASE_ORDER.length);
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      expect(PHASE_STARTS[PHASE_ORDER[i]]).toBeGreaterThan(PHASE_STARTS[PHASE_ORDER[i - 1]]);
    }
    expect(PHASE_STARTS[PHASE_ORDER[0]]).toBe(0);
    expect(PHASE_STARTS[PHASE_ORDER[PHASE_ORDER.length - 1]]).toBeLessThan(SHIFT_LENGTH_MINUTES);
  });

  it('phase starts match the wall-clock times of the story spine', () => {
    expect(PHASE_STARTS).toEqual({
      normal: minutesAt('22:45'),
      unease: minutesAt('23:05'),
      contradictions: minutesAt('23:35'),
      outage: minutesAt('00:05'),
      generator: minutesAt('00:08'),
      crisis: minutesAt('00:50'),
      resolution: minutesAt('01:30'),
    });
  });

  it('the shift runs 22:45 → 01:45 in 30 real minutes', () => {
    expect(SHIFT_START_HOUR).toBe(22);
    expect(SHIFT_START_MINUTE).toBe(45);
    expect(SHIFT_LENGTH_MINUTES).toBe(180);
    expect((SHIFT_LENGTH_MINUTES * 60) / DEFAULT_TIME_SCALE).toBe(30 * 60);
  });
});

describe('core enumerations and defaults', () => {
  it('has three distinct playable characters', () => {
    expect(CHARACTER_IDS).toEqual(['john', 'susie', 'paul']);
    expect(new Set(CHARACTER_IDS).size).toBe(3);
  });

  it('zones are unique and include every circuit the panel can shed', () => {
    expect(new Set(ZONES).size).toBe(ZONES.length);
    for (const z of ['corridor_w', 'corridor_e', 'exam', 'public', 'service', 'cctv', 'west_wing']) expect(ZONES).toContain(z);
  });

  it('default settings are sane (difficulty Normal, volumes 0..1, quality auto)', () => {
    expect(DEFAULT_SETTINGS.difficulty).toBe('normal');
    expect(DEFAULT_SETTINGS.quality).toBe('auto');
    for (const v of [DEFAULT_SETTINGS.masterVolume, DEFAULT_SETTINGS.musicVolume, DEFAULT_SETTINGS.sfxVolume]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(DEFAULT_SETTINGS.mouseSensitivity).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.subtitles).toBe(true);
  });
});
