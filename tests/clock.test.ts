import { describe, expect, it } from 'vitest';
import { GameClock, clockParts, formatClock12, formatClock24, minutesAt } from '../src/core/clock';
import { DEFAULT_TIME_SCALE, PHASE_STARTS, SHIFT_LENGTH_MINUTES } from '../src/core/types';

describe('GameClock', () => {
  it('starts at shift start, stopped, at the default scale', () => {
    const c = new GameClock();
    expect(c.time).toBe(0);
    expect(c.running).toBe(false);
    expect(c.timeScale).toBe(DEFAULT_TIME_SCALE);
    expect(c.finished).toBe(false);
  });

  it('does not advance while stopped', () => {
    const c = new GameClock();
    expect(c.advance(5)).toBe(0);
    expect(c.time).toBe(0);
  });

  it('1 real second = 0.1 game minutes at the default scale', () => {
    const c = new GameClock();
    c.running = true;
    expect(c.advance(1)).toBeCloseTo(0.1, 10);
    expect(c.time).toBeCloseTo(0.1, 10);
    expect(c.advance(10)).toBeCloseTo(1, 10);
    expect(c.time).toBeCloseTo(1.1, 10);
  });

  it('returns the minutes actually elapsed and accumulates over frames', () => {
    const c = new GameClock();
    c.running = true;
    let total = 0;
    for (let i = 0; i < 600; i++) total += c.advance(1 / 60); // 10 real seconds of 60 fps frames
    expect(total).toBeCloseTo(1, 6);
    expect(c.time).toBeCloseTo(1, 6);
  });

  it('a 30 real-minute shift covers exactly 180 game minutes', () => {
    const c = new GameClock();
    c.running = true;
    expect(c.advance(30 * 60)).toBe(SHIFT_LENGTH_MINUTES);
    expect(c.time).toBe(180);
    expect(c.finished).toBe(true);
  });

  it('clamps at the end of the shift and reports only the clamped delta', () => {
    const c = new GameClock();
    c.running = true;
    c.set(179.95);
    const d = c.advance(10);
    expect(c.time).toBe(SHIFT_LENGTH_MINUTES);
    expect(d).toBeCloseTo(0.05, 6);
    expect(c.advance(10)).toBe(0);
    expect(c.time).toBe(SHIFT_LENGTH_MINUTES);
    expect(c.finished).toBe(true);
  });

  it('set() clamps into [0, 180]', () => {
    const c = new GameClock();
    c.set(-5);
    expect(c.time).toBe(0);
    c.set(999);
    expect(c.time).toBe(SHIFT_LENGTH_MINUTES);
    c.set(90);
    expect(c.time).toBe(90);
  });

  it('reset() restores the time and stops the clock', () => {
    const c = new GameClock();
    c.running = true;
    c.set(50);
    c.reset();
    expect(c.time).toBe(0);
    expect(c.running).toBe(false);
    c.reset(42);
    expect(c.time).toBe(42);
    expect(c.running).toBe(false);
  });

  it('timeScale scales the advance', () => {
    const c = new GameClock();
    c.running = true;
    c.timeScale = 60; // one game minute per real second
    expect(c.advance(1)).toBeCloseTo(1, 10);
    c.timeScale = 0;
    expect(c.advance(1)).toBe(0);
  });
});

describe('clockParts', () => {
  it('is 22:45:00 at shift start', () => {
    expect(clockParts(0)).toEqual({ h24: 22, m: 45, s: 0 });
  });

  it('wraps past midnight', () => {
    expect(clockParts(74)).toEqual({ h24: 23, m: 59, s: 0 });
    expect(clockParts(75)).toEqual({ h24: 0, m: 0, s: 0 });
    expect(clockParts(76)).toEqual({ h24: 0, m: 1, s: 0 });
    expect(clockParts(179)).toEqual({ h24: 1, m: 44, s: 0 });
    expect(clockParts(180)).toEqual({ h24: 1, m: 45, s: 0 });
  });

  it('derives seconds from fractional minutes', () => {
    expect(clockParts(0.5).s).toBe(30);
    expect(clockParts(0.25).s).toBe(15);
    expect(clockParts(0.75).s).toBe(45);
    expect(clockParts(2.75)).toEqual({ h24: 22, m: 47, s: 45 });
    expect(clockParts(75.5)).toEqual({ h24: 0, m: 0, s: 30 });
  });

  it('never produces out-of-range components across the shift', () => {
    for (let t = 0; t <= 180; t += 0.125) {
      const { h24, m, s } = clockParts(t);
      expect(h24).toBeGreaterThanOrEqual(0);
      expect(h24).toBeLessThan(24);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThan(60);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(60);
    }
  });
});

describe('formatClock12', () => {
  it.each([
    [0, '10:45 PM'],
    [2.5, '10:47 PM'],
    [15, '11:00 PM'],
    [74, '11:59 PM'],
    [75, '12:00 AM'],
    [76, '12:01 AM'],
    [135, '1:00 AM'],
    [179, '1:44 AM'],
    [180, '1:45 AM'],
  ])('formatClock12(%s) → %s', (minutes, expected) => {
    expect(formatClock12(minutes)).toBe(expected);
  });

  it('always matches H:MM AM/PM', () => {
    for (let t = 0; t <= 180; t += 0.5) expect(formatClock12(t)).toMatch(/^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/);
  });
});

describe('formatClock24', () => {
  it.each([
    [0, '22:45:00'],
    [0.5, '22:45:30'],
    [2.25, '22:47:15'],
    [74, '23:59:00'],
    [75, '00:00:00'],
    [179, '01:44:00'],
    [180, '01:45:00'],
  ])('formatClock24(%s) → %s', (minutes, expected) => {
    expect(formatClock24(minutes)).toBe(expected);
  });

  it('can omit seconds', () => {
    expect(formatClock24(0, false)).toBe('22:45');
    expect(formatClock24(75, false)).toBe('00:00');
    expect(formatClock24(179.9, false)).toBe('01:44');
  });

  it('always zero-pads', () => {
    for (let t = 0; t <= 180; t += 0.5) {
      expect(formatClock24(t)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(formatClock24(t, false)).toMatch(/^\d{2}:\d{2}$/);
    }
  });
});

describe('minutesAt', () => {
  it.each([
    ['22:45', 0],
    ['23:00', 15],
    ['23:05', 20],
    ['23:59', 74],
    ['00:00', 75],
    ['00:05', 80],
    ['00:08', 83],
    ['01:30', 165],
    ['01:44', 179],
    ['01:45', 180],
  ])('minutesAt(%s) → %s', (hhmm, expected) => {
    expect(minutesAt(hhmm)).toBe(expected);
  });

  it('agrees with the phase boundaries described in the story spine', () => {
    expect(minutesAt('22:45')).toBe(PHASE_STARTS.normal);
    expect(minutesAt('23:05')).toBe(PHASE_STARTS.unease);
    expect(minutesAt('23:35')).toBe(PHASE_STARTS.contradictions);
    expect(minutesAt('00:05')).toBe(PHASE_STARTS.outage);
    expect(minutesAt('00:08')).toBe(PHASE_STARTS.generator);
    expect(minutesAt('00:50')).toBe(PHASE_STARTS.crisis);
    expect(minutesAt('01:30')).toBe(PHASE_STARTS.resolution);
  });

  it('round-trips formatClock24 for every whole minute of the shift', () => {
    for (let m = 0; m <= SHIFT_LENGTH_MINUTES; m++) expect(minutesAt(formatClock24(m, false))).toBe(m);
  });
});
