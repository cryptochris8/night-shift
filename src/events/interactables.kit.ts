/**
 * Shared plumbing for the story interactables (CONTRACT §4J): binding a layout prop to a
 * role-aware Interactable with a re-entry guard, and the small power / light / clock helpers
 * every part uses. No story text lives here beyond two generic captions.
 */
import * as THREE from 'three';
import type { Interactable, Services, SfxHandle, SfxName, SfxOptions } from '../core/contracts';
import { formatClock12, formatClock24 } from '../core/clock';
import { SHIFT_START_HOUR, SHIFT_START_MINUTE, type CharacterId, type PerceptionState, type RoomId, type Vec3, type ZoneId } from '../core/types';
import type { StoryApi } from './Director';
import { nudge as fxNudge } from './anomalies.fx';

export const DARK_SCREEN = '(the screen is dark)';
export const TOO_DARK = '(too dark to read)';

/** One run's worth of registration state, rebuilt every time the director starts a night. */
export interface Ctx {
  readonly s: Services;
  readonly api: StoryApi;
  /** interactable ids this run registered (unregistered when the next run starts) */
  readonly ids: string[];
  /** bus listeners this run added (dropped when the next run starts) */
  readonly offs: (() => void)[];
  /** game minute the generator took the building, null until it has */
  genStart: number | null;
}

export interface UseSpec {
  /** short verb phrase for this character, or null when they cannot use it */
  prompt(c: CharacterId): string | null;
  use(c: CharacterId): void | Promise<void>;
  radius?: number;
  loose?: boolean;
}

/** Register an interactable around any object. While a use is running the prompt hides and repeats are ignored. */
export function bindObject(ctx: Ctx, id: string, object: THREE.Object3D, room: RoomId, spec: UseSpec): void {
  let busy = false;
  const item: Interactable = {
    id,
    object,
    room,
    radius: spec.radius,
    loose: spec.loose,
    prompt: (c) => (busy ? null : spec.prompt(c)),
    use: async (c) => {
      if (busy) return;
      busy = true;
      try {
        await spec.use(c);
      } finally {
        busy = false;
      }
    },
  };
  ctx.s.interact.register(item);
  if (!ctx.ids.includes(id)) ctx.ids.push(id);
}

/** Bind a layout prop by id (the interactable shares the prop id). A missing prop is skipped with a warning. */
export function bindProp(ctx: Ctx, propId: string, spec: UseSpec): THREE.Object3D | null {
  const obj = ctx.s.world.getProp(propId);
  if (!obj) {
    console.warn(`[interactables] prop "${propId}" is not in the world — skipped`);
    return null;
  }
  const def = ctx.s.layout.props.find((p) => p.id === propId);
  const room = def?.room ?? (obj.userData.room as RoomId | undefined) ?? ctx.s.world.roomAt({ x: obj.position.x, z: obj.position.z }) ?? 'corridor';
  bindObject(ctx, propId, obj, room, spec);
  return obj;
}

// ---------------------------------------------------------------------------
// State shorthands
// ---------------------------------------------------------------------------

export function wait(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
}

export function flagOn(ctx: Ctx, key: string): boolean {
  const v = ctx.api.flag(key);
  return v !== undefined && v !== false && v !== 0 && v !== '';
}

/** Utility power is still feeding the building. */
export function onMains(ctx: Ctx): boolean {
  const p = ctx.s.store.get().power;
  return p === 'normal' || p === 'unstable';
}

/** The generator is carrying this breaker zone. */
export function zoneLive(ctx: Ctx, zone: ZoneId): boolean {
  const st = ctx.s.store.get();
  return st.power === 'generator' && st.zones[zone];
}

/** Paper needs light. In the blackout only John's phone screen and Paul's lit flashlight help. */
export function canRead(ctx: Ctx, c: CharacterId): boolean {
  const st = ctx.s.store.get();
  if (st.power !== 'blackout') return true;
  if (c === 'john') return true;
  return c === 'paul' && st.characters.paul.flashlight;
}

/** Is the character's current objective (owned by the director) one of these lines? */
export function objectiveIs(ctx: Ctx, c: CharacterId, lines: readonly string[]): boolean {
  const cur = ctx.s.director.objectiveFor(c);
  return cur !== null && lines.includes(cur);
}

export function nudge(ctx: Ctx, c: CharacterId, delta: Partial<PerceptionState>): void {
  fxNudge(ctx.s, c, delta);
}

// ---------------------------------------------------------------------------
// Space and sound
// ---------------------------------------------------------------------------

const tmp = new THREE.Vector3();

export function worldPos(obj: THREE.Object3D, lift = 0): Vec3 {
  obj.getWorldPosition(tmp);
  return { x: tmp.x, y: tmp.y + lift, z: tmp.z };
}

/** Where a prop is right now (it may have been moved), lifted to a sensible sound height. */
export function propPos(ctx: Ctx, propId: string, lift = 0): Vec3 | null {
  const obj = ctx.s.world.getProp(propId);
  return obj ? worldPos(obj, lift) : null;
}

export function sfx(ctx: Ctx, name: SfxName, at: Vec3 | null, volume: number, extra: Partial<SfxOptions> = {}): SfxHandle | null {
  try {
    return ctx.s.audio.play(name, at ? { pos: at, volume, ...extra } : { nonSpatial: true, volume, ...extra });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function clock12(t: number): string {
  return formatClock12(t);
}

/** "23:41" */
export function clock24(t: number): string {
  return formatClock24(t, false);
}

/** Game minutes for an "HH:MM" written on the unit tonight; times before 22:45 stay negative (earlier this evening). */
export function wallToGame(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  let d = h * 60 + m - (SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE);
  if (d < -12 * 60) d += 24 * 60;
  return d;
}

/** Small deterministic drift so readings breathe without an RNG. */
export function drift(t: number, rate: number, amp: number): number {
  return Math.sin(t * rate) * amp;
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
