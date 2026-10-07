import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_META,
  EventBus,
  Store,
  loadSettings,
  makeCharacter,
  makeInitialState,
  saveSettings,
  type BusEvents,
} from '../src/core/state';
import { CHARACTER_IDS, DEFAULT_SETTINGS, ZONES, type Choice, type Clue, type PerceptionState } from '../src/core/types';

/** Collects every payload emitted for one bus event. */
function record<K extends keyof BusEvents>(bus: EventBus, event: K): BusEvents[K][] {
  const out: BusEvents[K][] = [];
  bus.on(event, (p) => {
    out.push(p);
  });
  return out;
}

function makeStore(seed = 'NS-TST-001') {
  const bus = new EventBus();
  const store = new Store(bus, makeInitialState(seed, 'mixed'));
  return { bus, store };
}

const clue = (id: string, extra: Partial<Clue> = {}): Clue => ({
  id,
  title: `Clue ${id}`,
  text: '',
  source: 'john',
  time: 0,
  kind: 'physical',
  supports: 'ambiguous',
  ...extra,
});

const choice = (id: string, value: string): Choice => ({ id, label: `Choice ${id}`, time: 0, value });

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  it('delivers payloads to every handler of an event', () => {
    const bus = new EventBus();
    const a = record(bus, 'door:changed');
    const b = record(bus, 'door:changed');
    const other = record(bus, 'door:denied');
    bus.emit('door:changed', { id: 'd_exam3', open: true, locked: false });
    expect(a).toEqual([{ id: 'd_exam3', open: true, locked: false }]);
    expect(b).toEqual(a);
    expect(other).toEqual([]);
  });

  it('unsubscribes via the returned function and via off()', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const h1 = (p: BusEvents['threat:change']): void => {
      seen.push(p.threat);
    };
    const off1 = bus.on('threat:change', h1);
    const h2 = (p: BusEvents['threat:change']): void => {
      seen.push(p.threat * 10);
    };
    bus.on('threat:change', h2);
    bus.emit('threat:change', { threat: 1 });
    off1();
    bus.emit('threat:change', { threat: 2 });
    bus.off('threat:change', h2);
    bus.emit('threat:change', { threat: 3 });
    expect(seen).toEqual([1, 10, 20]);
  });

  it('once() fires a single time', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.once('camera:change', (p) => {
      seen.push(p.cameraId);
    });
    bus.emit('camera:change', { cameraId: 'cam_hall_e' });
    bus.emit('camera:change', { cameraId: 'cam_station' });
    expect(seen).toEqual(['cam_hall_e']);
  });

  it('a throwing handler does not stop the others', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = new EventBus();
    const seen: boolean[] = [];
    bus.on('pause', () => {
      throw new Error('boom');
    });
    bus.on('pause', (p) => {
      seen.push(p.paused);
    });
    expect(() => bus.emit('pause', { paused: true })).not.toThrow();
    expect(seen).toEqual([true]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('emitting with no handlers is a no-op and clear() drops every handler', () => {
    const bus = new EventBus();
    expect(() => bus.emit('debug:log', { msg: 'x' })).not.toThrow();
    const log = record(bus, 'debug:log');
    bus.clear();
    bus.emit('debug:log', { msg: 'after clear' });
    expect(log).toEqual([]);
  });

  it('handlers added during an emit are not invoked by that same emit', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('debug:log', (p) => {
      seen.push(`first:${p.msg}`);
      bus.on('debug:log', (q) => {
        seen.push(`late:${q.msg}`);
      });
    });
    bus.emit('debug:log', { msg: '1' });
    expect(seen).toEqual(['first:1']);
    bus.emit('debug:log', { msg: '2' });
    expect(seen).toContain('late:2');
  });
});

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

describe('makeInitialState', () => {
  it('energises every zone except the decommissioned west wing', () => {
    const s = makeInitialState('NS-AAA-AAA', 'grounded');
    for (const z of ZONES) expect(s.zones[z]).toBe(z !== 'west_wing');
    expect(s.zones.west_wing).toBe(false);
    expect(Object.keys(s.zones).sort()).toEqual([...ZONES].sort());
  });

  it('starts at boot with a clean run record', () => {
    const s = makeInitialState('NS-AAA-AAA', 'supernatural');
    expect(s.seed).toBe('NS-AAA-AAA');
    expect(s.scenario).toBe('supernatural');
    expect(s.screen).toBe('boot');
    expect(s.time).toBe(0);
    expect(s.realElapsed).toBe(0);
    expect(s.phase).toBe('normal');
    expect(s.power).toBe('normal');
    expect(s.sound).toBe('NORMAL');
    expect(s.activeView).toBe('john');
    expect(s.activeCamera).toBeNull();
    expect(s.lastCharacter).toBe('john');
    expect(s.fired).toEqual([]);
    expect(s.witnessed).toEqual([]);
    expect(s.missed).toEqual([]);
    expect(s.clues).toEqual([]);
    expect(s.choices).toEqual([]);
    expect(s.flags).toEqual({});
    expect(s.threat).toBe(0);
    expect(s.ending).toBeNull();
    expect(s.paused).toBe(false);
    expect(s.inputLocked).toBe(false);
    expect(s.introDone).toBe(false);
  });

  it('merges settings over the defaults without mutating DEFAULT_SETTINGS', () => {
    const before = { ...DEFAULT_SETTINGS };
    const s = makeInitialState('NS-AAA-AAA', 'mixed', { difficulty: 'hard', masterVolume: 0.1 });
    expect(s.settings).toEqual({ ...DEFAULT_SETTINGS, difficulty: 'hard', masterVolume: 0.1 });
    expect(DEFAULT_SETTINGS).toEqual(before);
    expect(makeInitialState('x', 'mixed').settings).toEqual(DEFAULT_SETTINGS);
    expect(makeInitialState('x', 'mixed').settings).not.toBe(DEFAULT_SETTINGS);
  });

  it('builds all three characters from CHARACTER_META', () => {
    const s = makeInitialState('NS-AAA-AAA', 'mixed');
    for (const id of CHARACTER_IDS) {
      const c = s.characters[id];
      expect(c.id).toBe(id);
      expect(c.name).toBe(CHARACTER_META[id].name);
      expect(c.role).toBe(CHARACTER_META[id].role);
      expect(c.location).toBe(CHARACTER_META[id].home);
      expect(c.danger).toBe(0);
      expect(c.alive).toBe(true);
      expect(c.missing).toBe(false);
      expect(c.flashlight).toBe(false);
      expect(c.hasFlashlight).toBe(false);
      expect(c.lastControlled).toBe(0);
      for (const v of Object.values(c.perception)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(s.characters.john.perception.medication).toBeGreaterThan(0);
    expect(s.characters.susie.perception.medication).toBe(0);
  });

  it('makeCharacter returns independent objects', () => {
    const a = makeCharacter('john');
    const b = makeCharacter('john');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.perception).not.toBe(b.perception);
    expect(a.position).not.toBe(b.position);
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

describe('Store', () => {
  it('get() exposes the state and replace()/update() notify state:changed', () => {
    const { bus, store } = makeStore();
    const changed = record(bus, 'state:changed');
    expect(store.get().seed).toBe('NS-TST-001');
    store.update((d) => {
      d.time = 12;
    });
    expect(store.get().time).toBe(12);
    expect(changed).toHaveLength(1);
    expect(changed[0].state).toBe(store.get());
    const next = makeInitialState('NS-BBB-BBB', 'grounded');
    store.replace(next);
    expect(store.get()).toBe(next);
    expect(changed).toHaveLength(2);
    expect(changed[1].state).toBe(next);
  });

  it('setScreen emits screen:change with prev (and state:changed) only on change', () => {
    const { bus, store } = makeStore();
    const screens = record(bus, 'screen:change');
    const changed = record(bus, 'state:changed');
    store.setScreen('title');
    store.setScreen('title');
    store.setScreen('playing');
    expect(screens).toEqual([
      { screen: 'title', prev: 'boot' },
      { screen: 'playing', prev: 'title' },
    ]);
    expect(changed).toHaveLength(2);
    expect(store.get().screen).toBe('playing');
  });

  it('setPhase / setPower / setSound emit typed change events with prev, only on change', () => {
    const { bus, store } = makeStore();
    const phases = record(bus, 'phase:change');
    const powers = record(bus, 'power:change');
    const sounds = record(bus, 'sound:change');
    store.setPhase('normal');
    store.setPhase('unease');
    store.setPhase('unease');
    store.setPhase('outage');
    store.setPower('normal');
    store.setPower('blackout');
    store.setPower('generator');
    store.setSound('NORMAL');
    store.setSound('THREAT');
    expect(phases).toEqual([
      { phase: 'unease', prev: 'normal' },
      { phase: 'outage', prev: 'unease' },
    ]);
    expect(powers).toEqual([
      { power: 'blackout', prev: 'normal' },
      { power: 'generator', prev: 'blackout' },
    ]);
    expect(sounds).toEqual([{ sound: 'THREAT', prev: 'NORMAL' }]);
    expect(store.get().phase).toBe('outage');
    expect(store.get().power).toBe('generator');
    expect(store.get().sound).toBe('THREAT');
  });

  it('setView tracks lastCharacter, lastControlled and the CCTV camera', () => {
    const { bus, store } = makeStore();
    const views = record(bus, 'view:change');
    store.update((d) => {
      d.time = 42;
    });

    store.setView('susie');
    expect(store.get().activeView).toBe('susie');
    expect(store.get().lastCharacter).toBe('john');
    expect(store.get().characters.susie.lastControlled).toBe(42);
    expect(store.get().activeCamera).toBeNull();

    store.setView('cctv', 'cam_hall_e');
    expect(store.get().activeView).toBe('cctv');
    expect(store.get().activeCamera).toBe('cam_hall_e');
    expect(store.get().lastCharacter).toBe('susie');

    // re-entering CCTV without a camera keeps the previous one
    store.setView('cctv');
    expect(store.get().activeCamera).toBe('cam_hall_e');
    // ...and CCTV → CCTV must not clobber the character to return to
    expect(store.get().lastCharacter).toBe('susie');

    store.update((d) => {
      d.time = 60;
    });
    store.setView('paul');
    expect(store.get().activeView).toBe('paul');
    expect(store.get().activeCamera).toBeNull();
    expect(store.get().lastCharacter).toBe('susie');
    expect(store.get().characters.paul.lastControlled).toBe(60);
    expect(store.get().characters.john.lastControlled).toBe(0);

    expect(views).toEqual([
      { view: 'susie', prev: 'john' },
      { view: 'cctv', prev: 'susie' },
      { view: 'cctv', prev: 'cctv' },
      { view: 'paul', prev: 'cctv' },
    ]);
  });

  it('char() returns the live character record', () => {
    const { store } = makeStore();
    expect(store.char('paul')).toBe(store.get().characters.paul);
  });

  it('setChar applies the patch and emits character:entered only when the room changes', () => {
    const { bus, store } = makeStore();
    const entered = record(bus, 'character:entered');
    store.setChar('john', { location: 'triage', position: { x: -6, y: 0, z: -3 }, yaw: 1 });
    store.setChar('john', { location: 'triage' });
    store.setChar('john', { yaw: 2 });
    store.setChar('john', { location: 'exam3' });
    expect(entered).toEqual([
      { id: 'john', room: 'triage', prev: 'waiting' },
      { id: 'john', room: 'exam3', prev: 'triage' },
    ]);
    const c = store.char('john');
    expect(c.location).toBe('exam3');
    expect(c.position).toEqual({ x: -6, y: 0, z: -3 });
    expect(c.yaw).toBe(2);
  });

  it('setChar emits character:danger only when danger actually changes', () => {
    const { bus, store } = makeStore();
    const danger = record(bus, 'character:danger');
    store.setChar('paul', { danger: 0.4 });
    store.setChar('paul', { danger: 0.4 });
    store.setChar('paul', { status: 'Checking the panel' });
    store.setChar('paul', { danger: 0.9 });
    expect(danger).toEqual([
      { id: 'paul', danger: 0.4 },
      { id: 'paul', danger: 0.9 },
    ]);
    expect(store.char('paul').status).toBe('Checking the panel');
  });

  it('markMissing is idempotent: one event, danger pinned at 1, status updated', () => {
    const { bus, store } = makeStore();
    const missing = record(bus, 'character:missing');
    store.markMissing('john');
    store.markMissing('john');
    store.markMissing('john');
    expect(missing).toEqual([{ id: 'john' }]);
    const c = store.char('john');
    expect(c.missing).toBe(true);
    expect(c.danger).toBe(1);
    expect(c.status).toBe('Unaccounted for');
    expect(store.presentCharacters()).toEqual(['susie', 'paul']);
    store.markMissing('paul');
    expect(store.presentCharacters()).toEqual(['susie']);
    expect(missing).toHaveLength(2);
  });

  it('setPerception clamps every value into [0, 1] and leaves other keys alone', () => {
    const { store } = makeStore();
    const before: PerceptionState = { ...store.char('john').perception };
    store.setPerception('john', { fear: 2, medication: -1, fatigue: 0.5 });
    const p = store.char('john').perception;
    expect(p.fear).toBe(1);
    expect(p.medication).toBe(0);
    expect(p.fatigue).toBe(0.5);
    expect(p.anxiety).toBe(before.anxiety);
    expect(p.injury).toBe(before.injury);
    expect(p.stress).toBe(before.stress);
  });

  it('setFlag defaults to true, emits flag:set and is readable through flag()', () => {
    const { bus, store } = makeStore();
    const flags = record(bus, 'flag:set');
    expect(store.flag('saw_figure')).toBeUndefined();
    store.setFlag('saw_figure');
    store.setFlag('breaker_resets', 2);
    store.setFlag('note', 'west wing');
    expect(store.flag('saw_figure')).toBe(true);
    expect(store.flag('breaker_resets')).toBe(2);
    expect(store.flag('note')).toBe('west wing');
    expect(flags).toEqual([
      { key: 'saw_figure', value: true },
      { key: 'breaker_resets', value: 2 },
      { key: 'note', value: 'west wing' },
    ]);
  });

  it('recordEvent dedupes fired ids, files witnessed/missed, and emits with the active view', () => {
    const { bus, store } = makeStore();
    const fired = record(bus, 'event:fired');
    expect(store.hasFired('footsteps')).toBe(false);
    store.recordEvent('footsteps', true);
    store.setView('cctv', 'cam_hall_w');
    store.recordEvent('footsteps', true);
    store.recordEvent('wheelchair', false);
    const s = store.get();
    expect(s.fired).toEqual(['footsteps', 'wheelchair']);
    expect(s.witnessed).toEqual(['footsteps']);
    expect(s.missed).toEqual(['wheelchair']);
    expect(store.hasFired('footsteps')).toBe(true);
    expect(fired).toEqual([
      { id: 'footsteps', witnessed: true, view: 'john' },
      { id: 'footsteps', witnessed: true, view: 'cctv' },
      { id: 'wheelchair', witnessed: false, view: 'cctv' },
    ]);
  });

  it('addClue dedupes by id and reports whether it was new', () => {
    const { bus, store } = makeStore();
    const added = record(bus, 'clue:added');
    const first = clue('load_test', { supports: 'rational', kind: 'infrastructure' });
    expect(store.addClue(first)).toBe(true);
    expect(store.addClue(clue('load_test', { title: 'different title' }))).toBe(false);
    expect(store.addClue(clue('footage_2f', { kind: 'footage' }))).toBe(true);
    expect(store.get().clues.map((c) => c.id)).toEqual(['load_test', 'footage_2f']);
    expect(store.get().clues[0].title).toBe(first.title);
    expect(added).toHaveLength(2);
    expect(added[0].clue).toBe(first);
  });

  it('addChoice replaces an earlier choice with the same id and choice() reads the value', () => {
    const { bus, store } = makeStore();
    const made = record(bus, 'choice:made');
    store.addChoice(choice('tell_susie', 'no'));
    store.addChoice(choice('reset_breaker', 'leave'));
    store.addChoice(choice('tell_susie', 'yes'));
    expect(store.get().choices).toHaveLength(2);
    expect(store.get().choices.map((c) => c.id)).toEqual(['tell_susie', 'reset_breaker']);
    expect(store.choice('tell_susie')).toBe('yes');
    expect(store.choice('reset_breaker')).toBe('leave');
    expect(store.choice('nope')).toBeUndefined();
    expect(made).toHaveLength(3);
    expect(made[2].choice.value).toBe('yes');
  });

  it('setZone emits zone:change only when the zone actually flips', () => {
    const { bus, store } = makeStore();
    const zones = record(bus, 'zone:change');
    store.setZone('exam', true); // already on
    store.setZone('west_wing', false); // already off
    expect(zones).toEqual([]);
    store.setZone('exam', false);
    store.setZone('west_wing', true);
    store.setZone('exam', false);
    expect(zones).toEqual([
      { zone: 'exam', on: false },
      { zone: 'west_wing', on: true },
    ]);
    expect(store.get().zones.exam).toBe(false);
    expect(store.get().zones.west_wing).toBe(true);
    expect(store.get().zones.corridor_w).toBe(true);
  });

  it('setThreat clamps into [0, 1] and ignores sub-threshold jitter', () => {
    const { bus, store } = makeStore();
    const threats = record(bus, 'threat:change');
    store.setThreat(2);
    expect(store.get().threat).toBe(1);
    store.setThreat(1.00001);
    store.setThreat(0.99999);
    expect(threats).toHaveLength(1);
    store.setThreat(-3);
    expect(store.get().threat).toBe(0);
    store.setThreat(0.5);
    store.setThreat(0.50005);
    expect(store.get().threat).toBe(0.5);
    expect(threats).toEqual([{ threat: 1 }, { threat: 0 }, { threat: 0.5 }]);
  });

  it('setEnding stores and emits the ending', () => {
    const { bus, store } = makeStore();
    const endings = record(bus, 'ending');
    store.setEnding('rational');
    expect(store.get().ending).toBe('rational');
    expect(endings).toEqual([{ ending: 'rational' }]);
  });

  it('setPaused and lockInput emit only on change', () => {
    const { bus, store } = makeStore();
    const pauses = record(bus, 'pause');
    const locks = record(bus, 'input:lock');
    store.setPaused(false);
    store.setPaused(true);
    store.setPaused(true);
    store.setPaused(false);
    store.lockInput(false);
    store.lockInput(true);
    store.lockInput(true);
    expect(pauses).toEqual([{ paused: true }, { paused: false }]);
    expect(locks).toEqual([{ locked: true }]);
    expect(store.get().paused).toBe(false);
    expect(store.get().inputLocked).toBe(true);
  });

  it('setSettings merges the patch, emits the full settings and survives without localStorage', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    const { bus, store } = makeStore();
    const changes = record(bus, 'settings:change');
    expect(() => store.setSettings({ difficulty: 'easy', reducedFlicker: true })).not.toThrow();
    const s = store.get().settings;
    expect(s.difficulty).toBe('easy');
    expect(s.reducedFlicker).toBe(true);
    expect(s.masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
    expect(changes).toHaveLength(1);
    expect(changes[0].settings).toBe(s);
  });
});

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

describe('loadSettings / saveSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fakeStorage(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
  }

  it('returns {} and does not throw when localStorage is absent (node)', () => {
    expect(typeof globalThis.localStorage).toBe('undefined');
    expect(loadSettings()).toEqual({});
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it('round-trips settings through a storage object', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    saveSettings({ ...DEFAULT_SETTINGS, difficulty: 'hard', invertY: true });
    expect(storage.map.size).toBe(1);
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, difficulty: 'hard', invertY: true });
  });

  it('Store.setSettings persists so a later load sees the change', () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    const { store } = makeStore();
    store.setSettings({ subtitles: false, mouseSensitivity: 1.5 });
    const loaded = loadSettings();
    expect(loaded.subtitles).toBe(false);
    expect(loaded.mouseSensitivity).toBe(1.5);
    expect(makeInitialState('x', 'mixed', loaded).settings).toEqual({ ...DEFAULT_SETTINGS, subtitles: false, mouseSensitivity: 1.5 });
  });

  it('ignores corrupt or non-object payloads', () => {
    const [key] = (() => {
      const storage = fakeStorage();
      vi.stubGlobal('localStorage', storage);
      saveSettings(DEFAULT_SETTINGS);
      return Array.from(storage.map.keys());
    })();
    for (const raw of ['{not json', '42', 'null', '"string"', '']) {
      vi.stubGlobal('localStorage', fakeStorage({ [key]: raw }));
      expect(loadSettings()).toEqual({});
    }
  });

  it('swallows storage access errors', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    });
    expect(loadSettings()).toEqual({});
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });
});
