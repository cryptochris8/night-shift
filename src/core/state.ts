/**
 * Central game state store + typed event bus.
 * All major game-state logic flows through here; systems subscribe to the bus rather
 * than reaching into each other.
 */
import {
  CHARACTER_IDS,
  DEFAULT_SETTINGS,
  ZONES,
  type CharacterId,
  type CharacterState,
  type Choice,
  type Clue,
  type EndingId,
  type FlagValue,
  type GamePhase,
  type GameState,
  type PowerState,
  type RoomId,
  type ScenarioType,
  type Screen,
  type Settings,
  type SoundState,
  type ViewId,
  type ZoneId,
} from './types';

// ---------------------------------------------------------------------------
// Event bus
// ---------------------------------------------------------------------------

export interface BusEvents {
  'state:changed': { state: GameState };
  'time:tick': { time: number; dt: number; realDt: number };
  'phase:change': { phase: GamePhase; prev: GamePhase };
  'power:change': { power: PowerState; prev: PowerState };
  'sound:change': { sound: SoundState; prev: SoundState };
  /** fired BEFORE the transition plays — systems may prepare */
  'view:switching': { to: ViewId; from: ViewId };
  /** fired once the new view is active */
  'view:change': { view: ViewId; prev: ViewId };
  'camera:change': { cameraId: string };
  'event:fired': { id: string; witnessed: boolean; view: ViewId };
  'clue:added': { clue: Clue };
  'choice:made': { choice: Choice };
  'flag:set': { key: string; value: FlagValue };
  'door:changed': { id: string; open: boolean; locked: boolean };
  'door:denied': { id: string; by: CharacterId };
  'character:entered': { id: CharacterId; room: RoomId; prev: RoomId };
  'character:danger': { id: CharacterId; danger: number };
  'character:missing': { id: CharacterId };
  'zone:change': { zone: ZoneId; on: boolean };
  'threat:change': { threat: number };
  'screen:change': { screen: Screen; prev: Screen };
  'settings:change': { settings: Settings };
  'interact:used': { id: string; by: CharacterId };
  'subtitle': { text: string; speaker?: string; seconds: number };
  'ending': { ending: EndingId };
  'game:new': { seed: string };
  'game:restart': Record<string, never>;
  'cinematic:start': { id: string };
  'cinematic:end': { id: string };
  'pause': { paused: boolean };
  'input:lock': { locked: boolean };
  'debug:log': { msg: string };
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

export class EventBus {
  private handlers = new Map<keyof BusEvents, Set<Handler<any>>>();

  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  once<K extends keyof BusEvents>(event: K, handler: Handler<K>): () => void {
    const off = this.on(event, (p) => {
      off();
      handler(p);
    });
    return off;
  }

  off<K extends keyof BusEvents>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of Array.from(set)) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[bus] handler for ${String(event)} threw`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// State factory
// ---------------------------------------------------------------------------

export const CHARACTER_META: Record<CharacterId, { name: string; role: string; home: RoomId }> = {
  john: { name: 'John Mercer', role: 'Patient', home: 'waiting' },
  susie: { name: 'Susie Tran', role: 'Nurse', home: 'nurse_station' },
  paul: { name: 'Paul Reyes', role: 'Environmental Services', home: 'service_n' },
};

export function makeCharacter(id: CharacterId): CharacterState {
  const meta = CHARACTER_META[id];
  return {
    id,
    name: meta.name,
    role: meta.role,
    location: meta.home,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    perception: {
      anxiety: id === 'john' ? 0.35 : 0.1,
      fatigue: id === 'paul' ? 0.3 : id === 'john' ? 0.4 : 0.2,
      medication: id === 'john' ? 0.3 : 0,
      fear: 0,
      injury: id === 'john' ? 0.15 : 0,
      stress: id === 'susie' ? 0.2 : 0.1,
    },
    danger: 0,
    alive: true,
    missing: false,
    flashlight: false,
    hasFlashlight: false,
    status: id === 'john' ? 'Waiting to be seen' : id === 'susie' ? 'Arriving for shift' : 'Rounds — service hall',
    lastControlled: 0,
  };
}

export function makeInitialState(seed: string, scenario: ScenarioType, settings?: Partial<Settings>): GameState {
  const zones = Object.fromEntries(ZONES.map((z) => [z, z !== 'west_wing'])) as Record<ZoneId, boolean>;
  return {
    screen: 'boot',
    seed,
    scenario,
    time: 0,
    realElapsed: 0,
    phase: 'normal',
    power: 'normal',
    sound: 'NORMAL',
    activeView: 'john',
    activeCamera: null,
    lastCharacter: 'john',
    characters: {
      john: makeCharacter('john'),
      susie: makeCharacter('susie'),
      paul: makeCharacter('paul'),
    },
    fired: [],
    witnessed: [],
    missed: [],
    clues: [],
    choices: [],
    flags: {},
    threat: 0,
    zones,
    ending: null,
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    paused: false,
    inputLocked: false,
    introDone: false,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'nightshift.settings.v1';

export class Store {
  private s: GameState;
  readonly bus: EventBus;

  constructor(bus: EventBus, initial: GameState) {
    this.bus = bus;
    this.s = initial;
  }

  /** Read-only view. Do not mutate the returned object; use update(). */
  get(): Readonly<GameState> {
    return this.s;
  }

  /** Replace whole state (new run). */
  replace(next: GameState): void {
    this.s = next;
    this.bus.emit('state:changed', { state: this.s });
  }

  /** Mutate in place through a function, then notify. */
  update(fn: (draft: GameState) => void): void {
    fn(this.s);
    this.bus.emit('state:changed', { state: this.s });
  }

  // --- convenience mutators (emit specific events) -------------------------

  setScreen(screen: Screen): void {
    const prev = this.s.screen;
    if (prev === screen) return;
    this.s.screen = screen;
    this.bus.emit('screen:change', { screen, prev });
    this.bus.emit('state:changed', { state: this.s });
  }

  setPhase(phase: GamePhase): void {
    const prev = this.s.phase;
    if (prev === phase) return;
    this.s.phase = phase;
    this.bus.emit('phase:change', { phase, prev });
  }

  setPower(power: PowerState): void {
    const prev = this.s.power;
    if (prev === power) return;
    this.s.power = power;
    this.bus.emit('power:change', { power, prev });
  }

  setSound(sound: SoundState): void {
    const prev = this.s.sound;
    if (prev === sound) return;
    this.s.sound = sound;
    this.bus.emit('sound:change', { sound, prev });
  }

  setView(view: ViewId, cameraId: string | null = null): void {
    const prev = this.s.activeView;
    if (prev !== 'cctv') this.s.lastCharacter = prev;
    this.s.activeView = view;
    this.s.activeCamera = view === 'cctv' ? cameraId ?? this.s.activeCamera : null;
    if (view !== 'cctv') {
      this.s.characters[view].lastControlled = this.s.time;
    }
    this.bus.emit('view:change', { view, prev });
  }

  char(id: CharacterId): CharacterState {
    return this.s.characters[id];
  }

  setChar(id: CharacterId, patch: Partial<CharacterState>): void {
    const c = this.s.characters[id];
    const prevRoom = c.location;
    const prevDanger = c.danger;
    Object.assign(c, patch);
    if (patch.location && patch.location !== prevRoom) {
      this.bus.emit('character:entered', { id, room: patch.location, prev: prevRoom });
    }
    if (patch.danger !== undefined && patch.danger !== prevDanger) {
      this.bus.emit('character:danger', { id, danger: patch.danger });
    }
    if (patch.missing && !c.missing === false) {
      // already handled by markMissing
    }
  }

  markMissing(id: CharacterId): void {
    const c = this.s.characters[id];
    if (c.missing) return;
    c.missing = true;
    c.danger = 1;
    c.status = 'Unaccounted for';
    this.bus.emit('character:missing', { id });
  }

  setPerception(id: CharacterId, patch: Partial<CharacterState['perception']>): void {
    const p = this.s.characters[id].perception;
    for (const [k, v] of Object.entries(patch) as [keyof typeof p, number][]) {
      p[k] = Math.max(0, Math.min(1, v));
    }
  }

  flag(key: string): FlagValue | undefined {
    return this.s.flags[key];
  }

  setFlag(key: string, value: FlagValue = true): void {
    this.s.flags[key] = value;
    this.bus.emit('flag:set', { key, value });
  }

  hasFired(eventId: string): boolean {
    return this.s.fired.includes(eventId);
  }

  recordEvent(id: string, witnessed: boolean): void {
    if (!this.s.fired.includes(id)) this.s.fired.push(id);
    const list = witnessed ? this.s.witnessed : this.s.missed;
    if (!list.includes(id)) list.push(id);
    this.bus.emit('event:fired', { id, witnessed, view: this.s.activeView });
  }

  addClue(clue: Clue): boolean {
    if (this.s.clues.some((c) => c.id === clue.id)) return false;
    this.s.clues.push(clue);
    this.bus.emit('clue:added', { clue });
    return true;
  }

  addChoice(choice: Choice): void {
    const i = this.s.choices.findIndex((c) => c.id === choice.id);
    if (i >= 0) this.s.choices[i] = choice;
    else this.s.choices.push(choice);
    this.bus.emit('choice:made', { choice });
  }

  choice(id: string): string | undefined {
    return this.s.choices.find((c) => c.id === id)?.value;
  }

  setZone(zone: ZoneId, on: boolean): void {
    if (this.s.zones[zone] === on) return;
    this.s.zones[zone] = on;
    this.bus.emit('zone:change', { zone, on });
  }

  setThreat(threat: number): void {
    const t = Math.max(0, Math.min(1, threat));
    if (Math.abs(t - this.s.threat) < 1e-4) return;
    this.s.threat = t;
    this.bus.emit('threat:change', { threat: t });
  }

  setEnding(ending: EndingId): void {
    this.s.ending = ending;
    this.bus.emit('ending', { ending });
  }

  setPaused(paused: boolean): void {
    if (this.s.paused === paused) return;
    this.s.paused = paused;
    this.bus.emit('pause', { paused });
  }

  lockInput(locked: boolean): void {
    if (this.s.inputLocked === locked) return;
    this.s.inputLocked = locked;
    this.bus.emit('input:lock', { locked });
  }

  setSettings(patch: Partial<Settings>): void {
    Object.assign(this.s.settings, patch);
    saveSettings(this.s.settings);
    this.bus.emit('settings:change', { settings: this.s.settings });
  }

  /** All characters that are still accounted for. */
  presentCharacters(): CharacterId[] {
    return CHARACTER_IDS.filter((id) => !this.s.characters[id].missing);
  }
}

export function loadSettings(): Partial<Settings> {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings: Settings): void {
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}
