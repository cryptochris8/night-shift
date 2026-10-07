import { describe, expect, it } from 'vitest';
import { RNG, hashString, makeSeedCode, normalizeSeedCode, scenarioForSeed } from '../src/core/rng';
import type { ScenarioType } from '../src/core/types';

/** Night Seed display format; the alphabet deliberately omits I, O, 0 and 1. */
const SEED_CODE_RE = /^NS-[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/;
/** normalizeSeedCode accepts any alphanumerics the player typed, so its output is wider. */
const NORMALIZED_RE = /^NS-[A-Z0-9]{3}-[A-Z0-9]{3}$/;
const SCENARIOS: ScenarioType[] = ['grounded', 'psychological', 'supernatural', 'mixed'];

const draw = (rng: RNG, n: number): number[] => Array.from({ length: n }, () => rng.next());

describe('hashString', () => {
  it('is deterministic and yields a 32-bit unsigned integer', () => {
    for (const s of ['', 'a', 'NS-7F3A-21', 'night shift', '🌙', 'x'.repeat(500)]) {
      const h = hashString(s);
      expect(h).toBe(hashString(s));
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('empty string is the FNV-1a offset basis', () => {
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('separates similar strings', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(hashString(`seed:${i}`));
    expect(seen.size).toBe(2000);
    expect(hashString('abc')).not.toBe(hashString('acb'));
    expect(hashString('NS-AAA-AAB')).not.toBe(hashString('NS-AAA-AAA'));
  });
});

describe('RNG', () => {
  it('produces an identical sequence for the same numeric seed', () => {
    expect(draw(new RNG(12345), 50)).toEqual(draw(new RNG(12345), 50));
  });

  it('produces an identical sequence for the same string seed', () => {
    expect(draw(new RNG('NS-7F3-A21'), 50)).toEqual(draw(new RNG('NS-7F3-A21'), 50));
  });

  it('a string seed behaves like its hash', () => {
    const r = new RNG('hello');
    expect(r.seed).toBe(hashString('hello'));
    expect(draw(r, 20)).toEqual(draw(new RNG(hashString('hello')), 20));
  });

  it('different seeds give different sequences', () => {
    expect(draw(new RNG(1), 20)).not.toEqual(draw(new RNG(2), 20));
    expect(draw(new RNG('NS-AAA-AAA'), 20)).not.toEqual(draw(new RNG('NS-AAA-AAB'), 20));
    // a seed of zero must still produce a usable (non-constant) stream
    const zeros = draw(new RNG(0), 20);
    expect(new Set(zeros).size).toBeGreaterThan(15);
  });

  it('next() stays in [0, 1) and is reasonably spread', () => {
    const r = new RNG('spread');
    const xs = draw(r, 20000);
    let min = 1;
    let max = 0;
    let sum = 0;
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      min = Math.min(min, x);
      max = Math.max(max, x);
      sum += x;
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
    expect(sum / xs.length).toBeGreaterThan(0.48);
    expect(sum / xs.length).toBeLessThan(0.52);
  });

  it('range() stays within [min, max)', () => {
    const r = new RNG('range');
    for (const [lo, hi] of [
      [0, 1],
      [-5, 5],
      [10, 10.5],
      [100, 200],
      [-2, -1],
    ]) {
      for (let i = 0; i < 2000; i++) {
        const v = r.range(lo, hi);
        expect(v).toBeGreaterThanOrEqual(lo);
        expect(v).toBeLessThan(hi);
      }
    }
  });

  it('int() is inclusive on both ends and reaches them', () => {
    const r = new RNG('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 4000; i++) {
      const v = r.int(0, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    for (let i = 0; i < 100; i++) expect(r.int(7, 7)).toBe(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.int(-2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it('chance() honours the extremes and approximates the probability', () => {
    const r = new RNG('chance');
    for (let i = 0; i < 500; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (r.chance(0.3)) hits++;
    expect(hits / 20000).toBeGreaterThan(0.27);
    expect(hits / 20000).toBeLessThan(0.33);
  });

  it('pick() returns members of the array and eventually covers all of them', () => {
    const r = new RNG('pick');
    const items = ['a', 'b', 'c', 'd', 'e'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const p = r.pick(items);
      expect(items).toContain(p);
      seen.add(p);
    }
    expect(seen.size).toBe(items.length);
    expect(r.pick([42])).toBe(42);
  });

  it('shuffle() is a permutation that does not mutate its input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const r = new RNG('shuffle');
    const out = r.shuffle(input);
    expect(out).toHaveLength(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual([...input]);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out).not.toBe(input);
  });

  it('shuffle() is deterministic per seed and actually reorders', () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    expect(new RNG('s1').shuffle(input)).toEqual(new RNG('s1').shuffle(input));
    const a = new RNG('s1').shuffle(input);
    const b = new RNG('s2').shuffle(input);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(input);
    // every item visits more than one position across seeds
    const positions = input.map(() => new Set<number>());
    for (let s = 0; s < 30; s++) new RNG(`shuffle-${s}`).shuffle(input).forEach((v, idx) => positions[v].add(idx));
    for (const set of positions) expect(set.size).toBeGreaterThan(1);
  });

  it('weighted() never returns zero- or negative-weight items', () => {
    const r = new RNG('weighted-zero');
    for (let i = 0; i < 5000; i++) {
      const v = r.weighted([
        { item: 'never', weight: 0 },
        { item: 'sometimes', weight: 1 },
        { item: 'also_never', weight: -3 },
        { item: 'often', weight: 4 },
      ]);
      expect(['sometimes', 'often']).toContain(v);
    }
    for (let i = 0; i < 200; i++) {
      expect(
        r.weighted([
          { item: 'a', weight: 0 },
          { item: 'b', weight: 2 },
          { item: 'c', weight: 0 },
        ]),
      ).toBe('b');
    }
  });

  it('weighted() follows the weights approximately', () => {
    const r = new RNG('weighted-dist');
    let b = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (
        r.weighted([
          { item: 'a', weight: 1 },
          { item: 'b', weight: 3 },
        ]) === 'b'
      )
        b++;
    }
    expect(b / n).toBeGreaterThan(0.72);
    expect(b / n).toBeLessThan(0.78);
  });

  it('fork() derives deterministic, label-dependent sub-streams', () => {
    const a = new RNG('parent').fork('director');
    const b = new RNG('parent').fork('director');
    const c = new RNG('parent').fork('audio');
    expect(draw(a, 20)).toEqual(draw(b, 20));
    expect(draw(new RNG('parent').fork('director'), 20)).not.toEqual(draw(c, 20));
    expect(draw(new RNG('parent').fork('director'), 20)).not.toEqual(draw(new RNG('parent'), 20));
    expect(draw(new RNG('other').fork('director'), 20)).not.toEqual(draw(new RNG('parent').fork('director'), 20));
  });

  it('fork() depends only on the seed, not on how much the parent was consumed, and leaves the parent untouched', () => {
    const fresh = new RNG('parent');
    const consumed = new RNG('parent');
    draw(consumed, 1000);
    expect(draw(consumed.fork('world'), 10)).toEqual(draw(fresh.fork('world'), 10));

    const p1 = new RNG('parent');
    const p2 = new RNG('parent');
    p1.fork('x');
    p1.fork('y');
    expect(draw(p1, 10)).toEqual(draw(p2, 10));
  });
});

describe('makeSeedCode', () => {
  it('formats NS-XXX-XXX with the unambiguous alphabet', () => {
    const sources = [0, 1, 2, 42, 12345, 0xdeadbeef, 2 ** 31, 2 ** 32 - 1, -1, 1.5, Date.UTC(2026, 9, 7), 1759800000000];
    for (const s of sources) expect(makeSeedCode(s)).toMatch(SEED_CODE_RE);
  });

  it('is deterministic', () => {
    for (const s of [0, 7, 99999, 0xffffffff]) expect(makeSeedCode(s)).toBe(makeSeedCode(s));
  });

  it('spreads consecutive sources into distinct codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(makeSeedCode(i));
    expect(codes.size).toBeGreaterThanOrEqual(990);
    const stamps = new Set<string>();
    for (let i = 0; i < 1000; i++) stamps.add(makeSeedCode(1759800000000 + i * 1000));
    expect(stamps.size).toBeGreaterThanOrEqual(990);
  });

  it('only depends on the low 32 bits of the source', () => {
    expect(makeSeedCode(2 ** 32 + 5)).toBe(makeSeedCode(5));
    expect(makeSeedCode(-1)).toBe(makeSeedCode(0xffffffff));
  });
});

describe('normalizeSeedCode', () => {
  const inputs = [
    'NS-ABC-DEF',
    'ns-abc-def',
    'abc',
    'ABCDEF',
    'nsabcdefgh',
    'NS',
    'ns-',
    '',
    '   ',
    'n s - 7 f 3 - a 2 1',
    'NS-NSA-BCD',
    'NSNSAB',
    '!!!@@@###',
    'ns_7f3a21',
    'the quick brown fox',
    makeSeedCode(1),
    makeSeedCode(2 ** 31),
  ];

  it('always produces the display format', () => {
    for (const s of inputs) expect(normalizeSeedCode(s)).toMatch(NORMALIZED_RE);
  });

  it('is idempotent', () => {
    for (const s of inputs) {
      const once = normalizeSeedCode(s);
      expect(normalizeSeedCode(once)).toBe(once);
      expect(normalizeSeedCode(normalizeSeedCode(once))).toBe(once);
    }
  });

  it('round-trips every generated seed code', () => {
    for (let i = 0; i < 500; i++) {
      const code = makeSeedCode(i * 7919);
      expect(normalizeSeedCode(code)).toBe(code);
      expect(normalizeSeedCode(code.toLowerCase())).toBe(code);
      expect(normalizeSeedCode(code.replace(/-/g, ' '))).toBe(code);
    }
  });

  it('canonicalises case and punctuation, strips the NS prefix once, pads and truncates', () => {
    expect(normalizeSeedCode('ns-abc-def')).toBe('NS-ABC-DEF');
    expect(normalizeSeedCode('n s - 7 f 3 - a 2 1')).toBe('NS-7F3-A21');
    expect(normalizeSeedCode('abc')).toBe('NS-ABC-AAA');
    expect(normalizeSeedCode('ABCDEF')).toBe('NS-ABC-DEF');
    expect(normalizeSeedCode('nsabcdefgh')).toBe('NS-ABC-DEF');
    expect(normalizeSeedCode('NS')).toBe('NS-AAA-AAA');
    expect(normalizeSeedCode('NSNSAB')).toBe('NS-NSA-BAA');
  });

  it('falls back to a fixed default for empty input', () => {
    expect(normalizeSeedCode('')).toBe(makeSeedCode(1));
    expect(normalizeSeedCode('   ')).toBe(makeSeedCode(1));
    expect(normalizeSeedCode('---')).toBe(makeSeedCode(1));
  });
});

describe('scenarioForSeed', () => {
  it('is deterministic for a seed code', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeSeedCode(i);
      expect(scenarioForSeed(code)).toBe(scenarioForSeed(code));
    }
  });

  it('returns only valid scenario types', () => {
    for (let i = 0; i < 500; i++) expect(SCENARIOS).toContain(scenarioForSeed(makeSeedCode(i * 31)));
  });

  it('reaches all four scenarios across 2000 seeds, each at least 10 % of the time', () => {
    const counts: Record<ScenarioType, number> = { grounded: 0, psychological: 0, supernatural: 0, mixed: 0 };
    const n = 2000;
    for (let i = 0; i < n; i++) counts[scenarioForSeed(makeSeedCode(i))]++;
    for (const s of SCENARIOS) {
      expect(counts[s], `scenario ${s} too rare: ${counts[s]}/${n}`).toBeGreaterThanOrEqual(n * 0.1);
    }
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(n);
  });

  it('depends on the whole code, not just its prefix', () => {
    const results = new Set<ScenarioType>();
    for (let i = 0; i < 64; i++) results.add(scenarioForSeed(`NS-AAA-A${String(i).padStart(2, '0')}`));
    expect(results.size).toBeGreaterThan(1);
  });
});
