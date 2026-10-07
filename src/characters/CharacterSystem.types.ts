/**
 * Shared internal types for the character system helpers (player controller, NPC brains,
 * transient figures). Nothing here is part of the public contract.
 */
import type * as THREE from 'three';
import type { FigureAnim, Outfit, Services } from '../core/contracts';
import type { CharacterId, RoomId, ScheduleEntry, Vec2, Vec3 } from '../core/types';
import type { CollisionContext } from './collision';

/** Shape of the Figure class built in parallel (src/characters/Figure.ts). */
export interface FigureLike {
  readonly object: THREE.Group;
  anim: FigureAnim;
  setAnim(anim: FigureAnim): void;
  update(dt: number, speed: number): void;
  setOpacity(o: number): void;
  setVisible(v: boolean): void;
  lookAt(target: THREE.Vector3): void;
  setYaw(yaw: number): void;
  getChestPosition(out: THREE.Vector3): THREE.Vector3;
  setPhoneGlow(on: boolean): void;
  dispose(): void;
}

export type FigureCtor = new (opts: { outfit: Outfit; scale?: number; seed?: number }) => FigureLike;

export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.3;
export const NPC_RADIUS = 0.28;
export const WALK_SPEED = 1.5;
export const RUN_SPEED = 2.4;
export const NPC_SPEED = 1.3;
export const REACH = 2.2;

/** Everything the system tracks about one of the three main characters. */
export interface CharBody {
  id: CharacterId;
  /** feet position */
  pos: Vec3;
  yaw: number;
  /** first-person look pitch, kept so switching back restores the view */
  pitch: number;
  room: RoomId;
  figure: FigureLike | null;
  anim: FigureAnim;
  /** current idle action name (schedule / setAction) */
  action: string;
  schedule: ScheduleEntry[];
  /** index of the schedule entry currently applied (-1 = none yet) */
  scheduleIndex: number;
  /** schedule entry the body is heading to / performing */
  scheduleYaw: number | null;
  // --- navigation ---
  path: Vec2[] | null;
  pathIndex: number;
  /** door the current path segment passes through (null = none) */
  segmentDoor: string | null;
  speed: number;
  maxSpeed: number;
  vel: Vec2;
  walkResolve: ((ok: boolean) => void) | null;
  walkAction: string | null;
  waitingDoor: string | null;
  waitTime: number;
  doorRequested: string | null;
  stuckTime: number;
  sidestep: { dir: Vec2; left: number } | null;
  lastProgressPos: Vec2;
  /** metres walked since the last footstep */
  footDist: number;
  arrived: boolean;
}

/** Services the helpers need from the main system (kept narrow on purpose). */
export interface Host {
  readonly s: Services;
  readonly camera: THREE.PerspectiveCamera;
  /** real seconds since init */
  readonly now: number;
  readonly motionScale: number;
  collisionContext(id: CharacterId, pos: Vec2, radius: number): CollisionContext;
  canPass(id: CharacterId, doorId: string): boolean;
  isDoorOpen(doorId: string): boolean;
  /** open a door for a character (badge chirp, auto-close bookkeeping) */
  requestDoorOpen(doorId: string, by: CharacterId): void;
  /** rattle / badge deny / bus event, rate-limited per door */
  denyDoor(doorId: string, by: CharacterId): void;
  /** footstep for the surface under `pos`; `own` = the player's feet (non-spatial) */
  footstep(pos: Vec3, room: RoomId | null, volume: number, own: boolean, running: boolean): void;
  roomAt(p: Vec2): RoomId | null;
  /** distance from the active listener (camera) to a point */
  listenerDistance(p: Vec3): number;
}

const ACTION_ANIM: Record<string, FigureAnim> = {
  sit: 'sit',
  stand: 'idle',
  idle: 'idle',
  wait: 'idle',
  work: 'work',
  type: 'work',
  mop: 'mop',
  clean: 'mop',
  phone: 'phone',
  lie: 'lie',
  sleep: 'lie',
  rest: 'lie',
  stand_still: 'stand_still',
  glitch: 'glitch',
};

export function animForAction(action: string | undefined): FigureAnim {
  if (!action) return 'idle';
  return ACTION_ANIM[action] ?? 'idle';
}

export const LOCOMOTION: readonly FigureAnim[] = ['walk', 'limp', 'drag', 'wrong_gait', 'slow'];

export function isLocomotion(anim: FigureAnim): boolean {
  return LOCOMOTION.includes(anim);
}

/** Speed multiplier a locomotion style implies (slow = 0.5× per contract). */
export function gaitSpeedScale(anim: FigureAnim): number {
  switch (anim) {
    case 'slow':
      return 0.5;
    case 'limp':
      return 0.8;
    case 'drag':
      return 0.6;
    case 'wrong_gait':
      return 0.9;
    default:
      return 1;
  }
}

export function dist2(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** yaw that faces from `from` toward `to` (three.js convention: yaw 0 looks toward -z) */
export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

/** shortest signed angular difference b - a in (-π, π] */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function approachAngle(current: number, target: number, maxStep: number): number {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
