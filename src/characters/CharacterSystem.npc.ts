/**
 * NPC brains for the three main characters while the player is not controlling them:
 * schedule following, A* path walking with collision, doors (open what they may, wait at what
 * they may not), idle actions and positioned footsteps.
 */
import type { FigureAnim } from '../core/contracts';
import type { RoomId, ScheduleEntry, Vec2 } from '../core/types';
import { doorPassage, roomCenter } from '../world/layout';
import { expandRect, resolveMove, segmentIntersectsRect } from './collision';
import type { NavGraph } from './nav';
import {
  NPC_RADIUS,
  NPC_SPEED,
  animForAction,
  approachAngle,
  damp,
  dist2,
  yawToward,
  type CharBody,
  type Host,
} from './CharacterSystem.types';

const ARRIVE_FINAL = 0.22;
const ARRIVE_MID = 0.4;
const STEP_LENGTH = 0.7;
const DOOR_WAIT_OPEN = 1.4;
const WALK_GIVE_UP = 6;

export function makeBody(id: CharBody['id'], pos: { x: number; y: number; z: number }, yaw: number, room: RoomId): CharBody {
  return {
    id,
    pos: { ...pos },
    yaw,
    pitch: 0,
    room,
    figure: null,
    anim: 'idle',
    action: 'stand',
    schedule: [],
    scheduleIndex: -1,
    scheduleYaw: null,
    path: null,
    pathIndex: 0,
    segmentDoor: null,
    speed: 0,
    maxSpeed: NPC_SPEED,
    vel: { x: 0, z: 0 },
    walkResolve: null,
    walkAction: null,
    waitingDoor: null,
    waitTime: 0,
    doorRequested: null,
    stuckTime: 0,
    sidestep: null,
    lastProgressPos: { x: pos.x, z: pos.z },
    footDist: 0,
    arrived: true,
  };
}

/** A standing spot inside a room: its centre node for small rooms, the nearest spine node otherwise. */
export function roomPoint(room: RoomId, from: Vec2, host: Host, nav: NavGraph): Vec2 {
  const centre = nav.get(`r_${room}`);
  if (centre) return { ...centre.pos };
  const near = nav.nearest(from, room);
  if (near) return { ...near.pos };
  const def = host.s.layout.rooms.find((r) => r.id === room);
  return def ? roomCenter(def) : { ...from };
}

export function cancelWalk(body: CharBody, ok: boolean): void {
  body.path = null;
  body.segmentDoor = null;
  body.waitingDoor = null;
  body.doorRequested = null;
  body.sidestep = null;
  body.stuckTime = 0;
  body.speed = 0;
  body.vel.x = 0;
  body.vel.z = 0;
  const res = body.walkResolve;
  body.walkResolve = null;
  if (res) res(ok);
}

/** Drop waypoints that can be skipped: same convex room and no solid prop across the shortcut. */
function smoothPath(points: Vec2[], host: Host): Vec2[] {
  if (points.length <= 2) return points;
  const obstacles = host.s.world.getObstacles().map((r) => expandRect(r, NPC_RADIUS));
  const rooms = points.map((p) => host.roomAt(p));
  const clear = (a: Vec2, b: Vec2): boolean => {
    for (const ob of obstacles) if (segmentIntersectsRect(a, b, ob)) return false;
    return true;
  };
  const out: Vec2[] = [points[0]];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    for (let k = points.length - 1; k > i + 1; k--) {
      if (rooms[i] !== null && rooms[i] === rooms[k] && clear(points[i], points[k])) {
        j = k;
        break;
      }
    }
    out.push(points[j]);
    i = j;
  }
  return out;
}

function doorCrossedBy(a: Vec2, b: Vec2, host: Host): string | null {
  let found: string | null = null;
  for (const d of host.s.layout.doors) {
    if (!segmentIntersectsRect(a, b, expandRect(doorPassage(d), 0.1))) continue;
    if (d.kind !== 'open') return d.id;
    found = found ?? d.id;
  }
  return found;
}

function beginSegment(body: CharBody, host: Host): void {
  if (!body.path || body.pathIndex >= body.path.length) return;
  const prev = body.pathIndex === 0 ? { x: body.pos.x, z: body.pos.z } : body.path[body.pathIndex - 1];
  body.segmentDoor = doorCrossedBy(prev, body.path[body.pathIndex], host);
  body.doorRequested = null;
  body.waitTime = 0;
  body.waitingDoor = null;
}

/** Plan and start walking toward `target`. Returns false when the body is already there. */
export function planPath(body: CharBody, target: Vec2, host: Host, nav: NavGraph): boolean {
  const from: Vec2 = { x: body.pos.x, z: body.pos.z };
  if (dist2(from, target) < ARRIVE_FINAL) return false;
  const fromRoom = host.roomAt(from) ?? body.room;
  const toRoom = host.roomAt(target) ?? undefined;
  const gate = (door: string): boolean => host.canPass(body.id, door);
  let pts = nav.path(from, target, gate, fromRoom, toRoom);
  // no legal route: walk the ungated route and wait at the first door that will not open
  if (!pts.length) pts = nav.path(from, target, undefined, fromRoom, toRoom);
  if (!pts.length) pts = [from, { ...target }];
  pts = smoothPath(pts, host);
  body.path = pts;
  body.pathIndex = 1;
  body.arrived = false;
  body.stuckTime = 0;
  body.sidestep = null;
  body.lastProgressPos = { ...from };
  beginSegment(body, host);
  return true;
}

function arrive(body: CharBody): void {
  body.path = null;
  body.segmentDoor = null;
  body.speed = 0;
  body.vel.x = 0;
  body.vel.z = 0;
  body.arrived = true;
  if (body.walkAction) {
    body.action = body.walkAction;
    body.walkAction = null;
  }
  const res = body.walkResolve;
  body.walkResolve = null;
  if (res) res(true);
}

function setBodyAnim(body: CharBody, anim: FigureAnim): void {
  if (body.anim === anim) return;
  body.anim = anim;
  body.figure?.setAnim(anim);
}

export function currentScheduleIndex(schedule: ScheduleEntry[], time: number): number {
  let idx = -1;
  for (let i = 0; i < schedule.length; i++) if (schedule[i].time <= time) idx = i;
  return idx;
}

/** Re-evaluate the schedule and head to the current entry if it changed. */
export function applySchedule(body: CharBody, host: Host, nav: NavGraph, time: number): void {
  const idx = currentScheduleIndex(body.schedule, time);
  if (idx === body.scheduleIndex) return;
  body.scheduleIndex = idx;
  if (idx < 0) return;
  const entry = body.schedule[idx];
  const target = entry.pos ? { x: entry.pos.x, z: entry.pos.z } : roomPoint(entry.room, { x: body.pos.x, z: body.pos.z }, host, nav);
  body.scheduleYaw = entry.yaw ?? null;
  const action = entry.action ?? 'stand';
  if (body.walkResolve) cancelWalk(body, false);
  if (planPath(body, target, host, nav)) {
    body.walkAction = action;
  } else {
    body.action = action;
    if (entry.yaw !== undefined) body.yaw = entry.yaw;
  }
}

function probeFree(body: CharBody, dir: Vec2, dist: number, host: Host): number {
  const from: Vec2 = { x: body.pos.x, z: body.pos.z };
  const to = resolveMove(from, { x: dir.x * dist, z: dir.z * dist }, NPC_RADIUS, host.collisionContext(body.id, from, NPC_RADIUS));
  return dist2(from, to);
}

export function updateNpc(body: CharBody, dt: number, host: Host, nav: NavGraph, time: number): void {
  applySchedule(body, host, nav, time);

  let moving = false;
  if (body.path && body.pathIndex < body.path.length) {
    moving = followPath(body, dt, host, nav);
  } else if (body.path) {
    arrive(body);
  }

  if (!moving) {
    body.speed = damp(body.speed, 0, 12, dt);
    if (body.speed < 0.02) body.speed = 0;
    if (body.scheduleYaw !== null && body.arrived) body.yaw = approachAngle(body.yaw, body.scheduleYaw, 4 * dt);
    setBodyAnim(body, animForAction(body.action));
  }

  const room = host.roomAt({ x: body.pos.x, z: body.pos.z });
  if (room) body.room = room;

  const fig = body.figure;
  if (fig) {
    fig.object.position.set(body.pos.x, body.pos.y, body.pos.z);
    fig.setYaw(body.yaw);
    fig.setPhoneGlow(!moving && body.action === 'phone');
    fig.update(dt, body.speed);
  }
}

/** One frame of path following. Returns true while actually walking (not waiting). */
function followPath(body: CharBody, dt: number, host: Host, nav: NavGraph): boolean {
  const path = body.path!;
  const here: Vec2 = { x: body.pos.x, z: body.pos.z };
  const target = path[body.pathIndex];
  const last = body.pathIndex === path.length - 1;
  const d = dist2(here, target);
  if (d < (last ? ARRIVE_FINAL : ARRIVE_MID)) {
    body.pathIndex++;
    if (body.pathIndex >= path.length) {
      arrive(body);
      return false;
    }
    beginSegment(body, host);
    return followPath(body, dt, host, nav);
  }

  // doors on this segment
  if (body.segmentDoor) {
    const def = host.s.layout.doors.find((x) => x.id === body.segmentDoor);
    if (def && def.kind !== 'open') {
      const dd = dist2(here, def.pos);
      const open = host.isDoorOpen(def.id);
      if (dd < 1.3 && !open) {
        if (host.canPass(body.id, def.id)) {
          if (body.doorRequested !== def.id) {
            body.doorRequested = def.id;
            body.waitTime = 0;
            host.requestDoorOpen(def.id, body.id);
          }
          body.waitTime += dt;
          if (body.waitTime < DOOR_WAIT_OPEN) {
            body.speed = damp(body.speed, 0, 14, dt);
            setBodyAnim(body, 'idle');
            body.yaw = approachAngle(body.yaw, yawToward(here, def.pos), 6 * dt);
            return false;
          }
        } else {
          // may not pass: wait at the door, re-checking; the walk promise gives up but the body keeps waiting
          body.waitingDoor = def.id;
          body.waitTime += dt;
          body.speed = damp(body.speed, 0, 14, dt);
          setBodyAnim(body, 'idle');
          body.yaw = approachAngle(body.yaw, yawToward(here, def.pos), 6 * dt);
          if (body.walkResolve && body.waitTime > WALK_GIVE_UP) {
            const res = body.walkResolve;
            body.walkResolve = null;
            res(false);
          }
          return false;
        }
      } else if (body.waitingDoor) {
        body.waitingDoor = null;
        body.waitTime = 0;
      }
    }
  }

  // steer
  let dir: Vec2 = { x: (target.x - here.x) / d, z: (target.z - here.z) / d };
  if (body.sidestep) {
    dir = body.sidestep.dir;
    body.sidestep.left -= dt;
    if (body.sidestep.left <= 0) body.sidestep = null;
  }
  body.speed = damp(body.speed, body.maxSpeed, 6, dt);
  const stepLen = body.speed * dt;
  const ctx = host.collisionContext(body.id, here, NPC_RADIUS);
  const to = resolveMove(here, { x: dir.x * stepLen, z: dir.z * stepLen }, NPC_RADIUS, ctx);
  let moved = dist2(here, to);

  if (moved < stepLen * 0.35) {
    body.stuckTime += dt;
  } else {
    body.stuckTime = Math.max(0, body.stuckTime - dt * 0.5);
  }

  if (body.stuckTime > 0.6 && !body.sidestep) {
    // slip around a prop: step sideways toward whichever side has room
    const leftDir: Vec2 = { x: -dir.z, z: dir.x };
    const rightDir: Vec2 = { x: dir.z, z: -dir.x };
    const l = probeFree(body, leftDir, 0.6, host);
    const r = probeFree(body, rightDir, 0.6, host);
    body.sidestep = { dir: l >= r ? leftDir : rightDir, left: 0.55 };
    body.stuckTime = 0.3;
  }
  if (body.stuckTime > 2.5) {
    // last resort: phase through whatever is blocking rather than freeze forever
    to.x = here.x + dir.x * stepLen;
    to.z = here.z + dir.z * stepLen;
    moved = stepLen;
    if (body.stuckTime > 4 && body.path) {
      const finalTarget = body.path[body.path.length - 1];
      body.stuckTime = 0;
      planPath(body, finalTarget, host, nav);
    }
  }

  body.vel.x = (to.x - here.x) / Math.max(dt, 1e-4);
  body.vel.z = (to.z - here.z) / Math.max(dt, 1e-4);
  body.pos.x = to.x;
  body.pos.z = to.z;
  if (moved > 1e-4) body.yaw = approachAngle(body.yaw, yawToward(here, { x: here.x + dir.x, z: here.z + dir.z }), 7 * dt);
  setBodyAnim(body, 'walk');

  body.footDist += moved;
  if (body.footDist >= STEP_LENGTH) {
    body.footDist -= STEP_LENGTH;
    if (host.listenerDistance(body.pos) < 22) host.footstep(body.pos, body.room, 0.3, false, false);
  }
  return true;
}
