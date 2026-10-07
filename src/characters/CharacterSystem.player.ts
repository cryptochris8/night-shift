/**
 * First-person controller for the possessed character: mouse/gamepad/touch look, WASD/stick
 * movement with capsule collision, head bob, footsteps and door interaction.
 */
import * as THREE from 'three';
import type { Vec2, Vec3 } from '../core/types';
import { forwardFromYaw } from '../world/layout';
import { resolveMove } from './collision';
import {
  EYE_HEIGHT,
  PLAYER_RADIUS,
  RUN_SPEED,
  WALK_SPEED,
  angleDelta,
  damp,
  dist2,
  type CharBody,
  type Host,
} from './CharacterSystem.types';

const PITCH_LIMIT = 1.45;
const MOUSE_RAD_PER_PX = 0.0022;
const PAD_YAW_RATE = 2.4;
const PAD_PITCH_RATE = 1.8;
const SEATED_EYE = 1.2;
const LYING_EYE = 0.75;

interface LookTween {
  fromYaw: number;
  fromPitch: number;
  toYaw: number;
  toPitch: number;
  t: number;
  dur: number;
  resolve: () => void;
}

export interface ControlFlags {
  canMove: boolean;
  canLook: boolean;
}

export class PlayerController {
  private readonly host: Host;
  private readonly vel: Vec2 = { x: 0, z: 0 };
  private bobPhase = 0;
  private bobAmp = 0;
  private eye = EYE_HEIGHT;
  private eyeTarget = EYE_HEIGHT;
  private idleT = 0;
  private tween: LookTween | null = null;
  private readonly tmpDir = new THREE.Vector3();

  constructor(host: Host) {
    this.host = host;
  }

  /** Snap the camera onto a body (possess). Seated/lying bodies start low and stand up on first move. */
  attach(body: CharBody): void {
    this.cancelTween();
    this.vel.x = 0;
    this.vel.z = 0;
    this.bobAmp = 0;
    this.eyeTarget = EYE_HEIGHT;
    this.eye = body.anim === 'sit' ? SEATED_EYE : body.anim === 'lie' ? LYING_EYE : EYE_HEIGHT;
    this.placeCamera(body, 0, 0, 0);
  }

  detach(): void {
    this.cancelTween();
    this.vel.x = 0;
    this.vel.z = 0;
  }

  /** Smoothly turn the view toward a world point over `seconds`. */
  lookToward(body: CharBody, target: Vec3, seconds: number): Promise<void> {
    this.cancelTween();
    const cam = this.host.camera;
    const dx = target.x - cam.position.x;
    const dy = target.y - cam.position.y;
    const dz = target.z - cam.position.z;
    const toYaw = Math.atan2(-dx, -dz);
    const toPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(dy, Math.hypot(dx, dz))));
    return new Promise<void>((resolve) => {
      this.tween = {
        fromYaw: body.yaw,
        fromPitch: body.pitch,
        toYaw: body.yaw + angleDelta(body.yaw, toYaw),
        toPitch,
        t: 0,
        dur: Math.max(0.05, seconds),
        resolve,
      };
    });
  }

  update(body: CharBody, dt: number, flags: ControlFlags): void {
    const s = this.host.s;
    const settings = s.store.get().settings;
    const input = s.input;

    // --- look -------------------------------------------------------------
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(tw.dur, tw.t + dt);
      const u = tw.t / tw.dur;
      const e = u * u * (3 - 2 * u);
      body.yaw = tw.fromYaw + (tw.toYaw - tw.fromYaw) * e;
      body.pitch = tw.fromPitch + (tw.toPitch - tw.fromPitch) * e;
      if (tw.t >= tw.dur) {
        this.tween = null;
        tw.resolve();
      }
    } else if (flags.canLook) {
      const sens = MOUSE_RAD_PER_PX * settings.mouseSensitivity;
      const inv = settings.invertY ? -1 : 1;
      body.yaw -= input.look.dx * sens;
      body.pitch -= input.look.dy * sens * inv;
      const curve = (v: number): number => Math.sign(v) * v * v;
      body.yaw -= curve(input.padLook.x) * PAD_YAW_RATE * settings.mouseSensitivity * dt;
      body.pitch -= curve(input.padLook.y) * PAD_PITCH_RATE * settings.mouseSensitivity * inv * dt;
    }
    body.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, body.pitch));
    if (body.yaw > Math.PI || body.yaw <= -Math.PI) body.yaw = Math.atan2(Math.sin(body.yaw), Math.cos(body.yaw));

    // --- move -------------------------------------------------------------
    const axis = flags.canMove ? input.moveAxis() : { x: 0, y: 0 };
    const running = flags.canMove && input.down('run') && axis.y > 0.1;
    const maxSpeed = running ? RUN_SPEED : WALK_SPEED;
    const f = forwardFromYaw(body.yaw);
    const r: Vec2 = { x: -f.z, z: f.x };
    const wish: Vec2 = {
      x: (f.x * axis.y + r.x * axis.x) * maxSpeed,
      z: (f.z * axis.y + r.z * axis.x) * maxSpeed,
    };
    const wishLen = Math.hypot(wish.x, wish.z);
    const lambda = wishLen > Math.hypot(this.vel.x, this.vel.z) ? 9 : 14;
    this.vel.x = damp(this.vel.x, wish.x, lambda, dt);
    this.vel.z = damp(this.vel.z, wish.z, lambda, dt);
    let speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed < 0.02 && wishLen === 0) {
      this.vel.x = 0;
      this.vel.z = 0;
      speed = 0;
    }

    let moved = 0;
    if (speed > 0) {
      const from: Vec2 = { x: body.pos.x, z: body.pos.z };
      const ctx = this.host.collisionContext(body.id, from, PLAYER_RADIUS);
      const to = resolveMove(from, { x: this.vel.x * dt, z: this.vel.z * dt }, PLAYER_RADIUS, ctx);
      moved = dist2(from, to);
      body.pos.x = to.x;
      body.pos.z = to.z;
      // pressing into a wall: bleed velocity so bob and footsteps settle
      if (moved < speed * dt * 0.3) {
        this.vel.x *= 0.5;
        this.vel.z *= 0.5;
      }
      if (wishLen > 0) this.eyeTarget = EYE_HEIGHT;
    }
    const room = this.host.roomAt({ x: body.pos.x, z: body.pos.z });
    if (room) body.room = room;

    if (flags.canMove) this.handleDoors(body, speed, f);

    // --- head bob + footsteps ---------------------------------------------------
    const effSpeed = moved / Math.max(dt, 1e-4);
    const stride = running ? 0.95 : 0.72;
    const amp01 = Math.min(1.6, effSpeed / WALK_SPEED);
    this.bobAmp = damp(this.bobAmp, amp01, 8, dt);
    const prevPhase = this.bobPhase;
    this.bobPhase += (moved / stride) * Math.PI * 2;
    const k = (ph: number): number => Math.floor((ph - Math.PI * 1.5) / (Math.PI * 2));
    if (k(this.bobPhase) > k(prevPhase) && effSpeed > 0.3) {
      this.host.footstep(body.pos, body.room, running ? 0.55 : 0.38, true, running);
    }
    this.idleT += dt;
    const ms = this.host.motionScale;
    const bobY = (Math.sin(this.bobPhase) * 0.028 * this.bobAmp + Math.sin(this.idleT * 1.6) * 0.003) * ms;
    const bobX = Math.sin(this.bobPhase * 0.5) * 0.012 * this.bobAmp * ms;
    const roll = Math.sin(this.bobPhase * 0.5) * 0.006 * this.bobAmp * ms;
    this.eye = damp(this.eye, this.eyeTarget, 6, dt);
    this.placeCamera(body, bobX, bobY, roll);
  }

  /** Current horizontal velocity (for door look-ahead and listener). */
  get velocity(): Readonly<Vec2> {
    return this.vel;
  }

  private placeCamera(body: CharBody, bobX: number, bobY: number, roll: number): void {
    const cam = this.host.camera;
    const f = forwardFromYaw(body.yaw);
    const rx = -f.z;
    const rz = f.x;
    cam.position.set(body.pos.x + rx * bobX, body.pos.y + this.eye + bobY, body.pos.z + rz * bobX);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(body.pitch, body.yaw, roll);
    cam.updateMatrixWorld();
  }

  private handleDoors(body: CharBody, speed: number, forward: Vec2): void {
    const moving = speed > 0.15;
    if (!moving) return;
    const dir: Vec2 = { x: this.vel.x / speed, z: this.vel.z / speed };
    for (const d of this.host.s.layout.doors) {
      if (d.kind === 'open') continue;
      if (d.a !== body.room && d.b !== body.room) continue;
      // nearest point of the opening itself (wide doors are approached off-centre)
      const half = d.width / 2;
      const nx = d.axis === 'x' ? Math.min(d.pos.x + half, Math.max(d.pos.x - half, body.pos.x)) : d.pos.x;
      const nz = d.axis === 'z' ? Math.min(d.pos.z + half, Math.max(d.pos.z - half, body.pos.z)) : d.pos.z;
      const dx = nx - body.pos.x;
      const dz = nz - body.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 1.7) continue;
      const toward = (dx * dir.x + dz * dir.z) / Math.max(dist, 1e-6);
      const facing = (dx * forward.x + dz * forward.z) / Math.max(dist, 1e-6);
      if (toward < 0.45 && facing < 0.6) continue; // walking past, not into
      const open = this.host.isDoorOpen(d.id);
      if (this.host.canPass(body.id, d.id)) {
        if (!open && dist - speed * 0.3 < 0.9) this.host.requestDoorOpen(d.id, body.id);
      } else if (!open && dist < 0.85 && toward > 0.45) {
        this.host.denyDoor(d.id, body.id);
      }
    }
    void this.tmpDir;
  }

  private cancelTween(): void {
    if (!this.tween) return;
    const tw = this.tween;
    this.tween = null;
    tw.resolve();
  }
}
