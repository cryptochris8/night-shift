/**
 * Transient figures: anomalies, extra staff and patients spawned by the director.
 * Wraps a procedural Figure with fades, path walking, view filtering and vanish rules.
 */
import * as THREE from 'three';
import type { FigureAnim, FigureHandle, FigureOptions } from '../core/contracts';
import type { Vec2, Vec3, ViewId } from '../core/types';
import {
  NPC_SPEED,
  approachAngle,
  dist2,
  gaitSpeedScale,
  isLocomotion,
  yawToward,
  type FigureLike,
} from './CharacterSystem.types';

export interface FigureFrame {
  dt: number;
  view: ViewId;
  /** world position of the camera the player is looking through (null on the title screen) */
  viewerPos: THREE.Vector3 | null;
  cinematic: boolean;
  canSee: (p: THREE.Vector3) => boolean;
}

const FADE_IN = 0.4;
const FADE_OUT = 0.4;

export class TransientFigure implements FigureHandle {
  readonly id: string;
  readonly object: THREE.Object3D;
  removed = false;
  disposed = false;

  private readonly fig: FigureLike;
  private readonly scene: THREE.Scene;
  private readonly opts: FigureOptions;
  private readonly seenTest: (p: THREE.Vector3) => boolean;
  private readonly pos: Vec3;
  private yaw: number;
  private baseAnim: FigureAnim;
  private visibleTo: ViewId[] | null;
  private alpha = 0;
  private appliedAlpha = -1;
  private alphaTarget: number;
  private fadeSeconds = FADE_IN;
  private queue: Vec2[] = [];
  private onInitialPath: boolean;
  private speed: number;
  private curSpeed = 0;
  private walkResolvers: (() => void)[] = [];
  private age = 0;
  private unseen = 0;
  private everSeen = false;
  private readonly chest = new THREE.Vector3();

  constructor(id: string, fig: FigureLike, opts: FigureOptions, scene: THREE.Scene, seenTest: (p: THREE.Vector3) => boolean) {
    this.id = id;
    this.fig = fig;
    this.object = fig.object;
    this.scene = scene;
    this.opts = opts;
    this.seenTest = seenTest;
    this.pos = { x: opts.pos.x, y: opts.pos.y, z: opts.pos.z };
    this.yaw = opts.yaw ?? 0;
    this.visibleTo = opts.visibleTo ? opts.visibleTo.slice() : null;
    this.alphaTarget = 1;
    this.speed = opts.speed ?? NPC_SPEED;
    this.queue = opts.path ? opts.path.map((p) => ({ x: p.x, z: p.z })) : [];
    this.onInitialPath = this.queue.length > 0;
    this.baseAnim = opts.anim ?? (this.queue.length ? 'walk' : 'idle');
    this.fig.setAnim(this.queue.length ? (isLocomotion(this.baseAnim) ? this.baseAnim : 'walk') : this.baseAnim);
    this.fig.setPhoneGlow(this.baseAnim === 'phone');
    this.object.name = `figure:${id}`;
    this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.fig.setYaw(this.yaw);
    this.fig.setOpacity(0);
    this.object.visible = false;
    scene.add(this.object);
  }

  setAnim(anim: FigureAnim): void {
    this.baseAnim = anim;
    this.fig.setPhoneGlow(anim === 'phone');
    if (this.queue.length) {
      if (isLocomotion(anim)) this.fig.setAnim(anim);
    } else {
      this.fig.setAnim(anim);
    }
  }

  walkTo(target: Vec2, speed?: number): Promise<void> {
    if (this.removed) return Promise.resolve();
    this.queue = [{ x: target.x, z: target.z }];
    this.onInitialPath = false;
    if (speed !== undefined) this.speed = speed;
    this.fig.setAnim(isLocomotion(this.baseAnim) ? this.baseAnim : 'walk');
    return new Promise<void>((resolve) => this.walkResolvers.push(resolve));
  }

  setVisibleTo(views: ViewId[]): void {
    this.visibleTo = views.slice();
  }

  isSeen(): boolean {
    if (this.removed || !this.object.visible) return false;
    this.fig.getChestPosition(this.chest);
    return this.seenTest(this.chest);
  }

  remove(fade = FADE_OUT): void {
    if (this.removed) return;
    this.removed = true;
    this.alphaTarget = 0;
    this.fadeSeconds = Math.max(0.01, fade);
    this.resolveWalkers();
  }

  /** Does the current view filter allow this figure at all? */
  allowedIn(view: ViewId): boolean {
    return !this.visibleTo || this.visibleTo.includes(view);
  }

  applyVisibility(view: ViewId): void {
    // Figure combines this with its own opacity threshold
    this.fig.setVisible(!this.disposed && this.allowedIn(view));
  }

  update(frame: FigureFrame): void {
    if (this.disposed) return;
    const dt = frame.dt;
    this.age += dt;

    // auto-removal
    if (!this.removed && this.opts.duration !== undefined && this.opts.duration > 0 && this.age >= this.opts.duration) this.remove(FADE_OUT);

    // walking
    if (this.queue.length) {
      const target = this.queue[0];
      const here: Vec2 = { x: this.pos.x, z: this.pos.z };
      const gait: FigureAnim = isLocomotion(this.baseAnim) ? this.baseAnim : 'walk';
      const sp = this.speed * gaitSpeedScale(gait);
      const d = dist2(here, target);
      const step = sp * dt;
      if (d <= Math.max(0.03, step)) {
        this.pos.x = target.x;
        this.pos.z = target.z;
        this.queue.shift();
        if (!this.queue.length) this.arrive();
      } else {
        this.pos.x += ((target.x - here.x) / d) * step;
        this.pos.z += ((target.z - here.z) / d) * step;
        this.yaw = approachAngle(this.yaw, yawToward(here, target), 8 * dt);
        if (this.fig.anim !== gait) this.fig.setAnim(gait);
      }
      this.curSpeed = sp;
    } else {
      this.curSpeed = 0;
      if (this.opts.faceViewer && frame.viewerPos && !this.removed) {
        const vp: Vec2 = { x: frame.viewerPos.x, z: frame.viewerPos.z };
        this.yaw = approachAngle(this.yaw, yawToward({ x: this.pos.x, z: this.pos.z }, vp), 6 * dt);
      }
    }

    // vanish rules (only while the figure can actually be in frame)
    if (!this.removed && this.allowedIn(frame.view)) {
      if (this.opts.vanishWithin && frame.viewerPos) {
        const dv = Math.hypot(frame.viewerPos.x - this.pos.x, frame.viewerPos.z - this.pos.z);
        if (dv < this.opts.vanishWithin) this.remove(0.3);
      }
      if (this.opts.vanishWhenUnseen && !this.removed) {
        this.fig.getChestPosition(this.chest);
        const seen = this.object.visible && frame.canSee(this.chest);
        if (seen) {
          this.everSeen = true;
          this.unseen = 0;
        } else if (this.everSeen) {
          this.unseen += dt;
          if (this.unseen > this.opts.vanishWhenUnseen) this.remove(0.15);
        }
      }
    } else if (this.opts.vanishWhenUnseen && this.everSeen && !this.removed) {
      // looked away by switching perspective
      this.unseen += dt;
      if (this.unseen > this.opts.vanishWhenUnseen) this.remove(0.15);
    }

    // fade
    if (this.alpha !== this.alphaTarget) {
      const dir = Math.sign(this.alphaTarget - this.alpha);
      this.alpha += (dir * dt) / this.fadeSeconds;
      if ((dir > 0 && this.alpha >= this.alphaTarget) || (dir < 0 && this.alpha <= this.alphaTarget)) this.alpha = this.alphaTarget;
    }
    if (this.alpha !== this.appliedAlpha) {
      this.appliedAlpha = this.alpha;
      this.fig.setOpacity(this.alpha * (this.opts.opacity ?? 1));
    }
    if (this.removed && this.alpha <= 0) {
      this.dispose();
      return;
    }

    this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.fig.setYaw(this.yaw);
    this.fig.update(dt, this.curSpeed);
    this.applyVisibility(frame.view);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removed = true;
    this.resolveWalkers();
    this.scene.remove(this.object);
    this.fig.dispose();
  }

  private arrive(): void {
    this.resolveWalkers();
    if (this.onInitialPath && this.opts.duration === undefined) {
      this.onInitialPath = false;
      this.remove(FADE_OUT);
      return;
    }
    this.onInitialPath = false;
    this.fig.setAnim(isLocomotion(this.baseAnim) ? 'idle' : this.baseAnim);
  }

  private resolveWalkers(): void {
    const list = this.walkResolvers;
    this.walkResolvers = [];
    for (const r of list) r();
  }
}
