/**
 * NIGHT SHIFT — scripted camera sequences.
 *
 * Owns its own PerspectiveCamera; main renders through it while `playing`. Shots interpolate
 * position and look-at with easing, carry optional handheld shake (smooth value noise), a
 * per-shot FOV, a per-shot transition (played through PostFX and awaited to its obscuration
 * peak before the camera jumps), captions and onStart hooks. Input is locked, the HUD hidden
 * and letterbox bars shown for the duration; everything is restored on finish or skip.
 */
import * as THREE from 'three';
import type { ICinematicSystem, Services, Shot, TransitionKind } from '../core/contracts';
import { RNG } from '../core/rng';
import type { Vec3 } from '../core/types';

const DEFAULT_FOV = 50;
const SKIP_GRACE_SECONDS = 0.45;

const TRANSITION_SECONDS: Record<TransitionKind, number> = {
  static: 0.5,
  flicker: 0.5,
  cut: 0.04,
  monitor_on: 0.7,
  monitor_off: 0.7,
  fade_black: 1.4,
  fade_in: 1.6,
  whip: 0.55,
};

type Ease = NonNullable<Shot['ease']>;

function ease(kind: Ease, u: number): number {
  const t = Math.max(0, Math.min(1, u));
  switch (kind) {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    case 'inout':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
}

/** 1-D value noise with Hermite interpolation; two octaves give a handheld "breath + tremor". */
class SmoothNoise {
  private readonly lattice: Float32Array;
  constructor(rng: RNG, size = 256) {
    this.lattice = new Float32Array(size);
    for (let i = 0; i < size; i++) this.lattice[i] = rng.range(-1, 1);
  }
  private at(i: number): number {
    const n = this.lattice.length;
    return this.lattice[((i % n) + n) % n];
  }
  sample(t: number): number {
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return this.at(i) * (1 - s) + this.at(i + 1) * s;
  }
  /** slow sway plus a faster, smaller tremor */
  handheld(t: number): number {
    return this.sample(t * 0.8) * 0.7 + this.sample(t * 2.6 + 97.3) * 0.3;
  }
}

interface Run {
  id: string;
  shots: Shot[];
  skippable: boolean;
  letterbox: boolean;
  index: number;
  /** seconds into the current shot */
  t: number;
  /** seconds since play() */
  elapsed: number;
  state: 'transition' | 'running';
  /** previous shot kept on screen (still breathing) while the next shot's transition obscures the frame */
  hold: { shot: Shot; index: number; t: number } | null;
  captionShown: boolean;
  resolve: () => void;
  token: number;
}

export class CinematicSystem implements ICinematicSystem {
  readonly camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 16 / 9, 0.05, 200);
  private s!: Services;
  private rng = new RNG('cinematic');
  private noiseYaw!: SmoothNoise;
  private noisePitch!: SmoothNoise;
  private noiseRoll!: SmoothNoise;
  private noisePos!: SmoothNoise;
  private run: Run | null = null;
  private token = 0;
  private offBus: (() => void)[] = [];

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  get playing(): boolean {
    return this.run !== null;
  }

  init(services: Services): void {
    this.s = services;
    this.reseed();
    const size = services.three.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (size.x > 0 && size.y > 0) {
      this.camera.aspect = size.x / size.y;
      this.camera.updateProjectionMatrix();
    }
    this.offBus.push(services.bus.on('game:new', () => this.reseed()));
  }

  private reseed(): void {
    this.rng = this.s.rng.fork('cinematic');
    this.noiseYaw = new SmoothNoise(this.rng);
    this.noisePitch = new SmoothNoise(this.rng);
    this.noiseRoll = new SmoothNoise(this.rng);
    this.noisePos = new SmoothNoise(this.rng);
  }

  dispose(): void {
    for (const off of this.offBus) off();
    this.offBus = [];
    if (this.run) this.finish();
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  play(id: string, shots: Shot[], opts?: { skippable?: boolean; letterbox?: boolean }): Promise<void> {
    if (this.run) this.finish();
    return new Promise<void>((resolve) => {
      if (shots.length === 0) {
        resolve();
        return;
      }
      const run: Run = {
        id,
        shots,
        skippable: opts?.skippable ?? true,
        letterbox: opts?.letterbox ?? true,
        index: 0,
        t: 0,
        elapsed: 0,
        state: 'running',
        hold: null,
        captionShown: false,
        resolve,
        token: ++this.token,
      };
      this.run = run;
      this.lock(run);
      this.s.bus.emit('cinematic:start', { id });
      this.enterShot(run, 0);
    });
  }

  skip(): void {
    if (!this.run) return;
    // one black frame hides the snap back to the gameplay camera
    void this.s.postfx.transition('cut', 0.04);
    this.finish();
  }

  update(dt: number, _gdt: number): void {
    const run = this.run;
    if (!run) return;
    run.elapsed += dt;

    if (run.skippable && run.elapsed > SKIP_GRACE_SECONDS && (this.s.input.pressed('skip') || this.s.input.pressed('cancel'))) {
      this.skip();
      return;
    }

    const shot = run.shots[run.index];
    if (run.state === 'transition') {
      // hold the previous pose until the transition reaches its obscuration peak
      if (run.hold) {
        run.hold.t += dt;
        this.poseCamera(run.hold.shot, 1);
        this.applyShake(run.hold.shot, run.hold.t, run.hold.index);
      }
      return;
    }

    run.t += dt;
    const seconds = Math.max(0.01, shot.seconds);
    this.poseCamera(shot, run.t / seconds);
    this.applyShake(shot, run.t, run.index);

    if (shot.caption && !run.captionShown && run.t >= (shot.caption.at ?? 0)) {
      run.captionShown = true;
      const remaining = Math.max(1, seconds - run.t - 0.3);
      void this.s.ui.caption(shot.caption.text, remaining, { sub: shot.caption.sub, style: shot.caption.style ?? 'card' });
    }

    if (run.t >= seconds) {
      if (run.index + 1 >= run.shots.length) {
        this.finish();
      } else {
        this.enterShot(run, run.index + 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shots
  // ---------------------------------------------------------------------------

  private enterShot(run: Run, index: number): void {
    run.index = index;
    run.t = 0;
    run.captionShown = false;
    const shot = run.shots[index];
    const kind = shot.transition;

    if (index === 0 || !kind) {
      // first shot: place immediately so the very first frame is already the shot
      if (kind) {
        const k: TransitionKind = kind === 'fade_black' ? 'fade_in' : kind;
        void this.s.postfx.transition(k, TRANSITION_SECONDS[k]);
      }
      this.beginShot(run, shot);
      return;
    }

    const prev = run.shots[index - 1];
    run.hold = { shot: prev, index: index - 1, t: Math.max(0.01, prev.seconds) };
    run.state = 'transition';
    const token = run.token;
    const seconds = TRANSITION_SECONDS[kind];
    void this.s.postfx.transition(kind, seconds).then(() => {
      if (this.run !== run || run.token !== token || run.index !== index || run.state !== 'transition') return;
      if (kind === 'fade_black') {
        // "dip to black": the new shot comes back up from black
        void this.s.postfx.transition('fade_in', seconds * 0.8);
      }
      this.beginShot(run, shot);
    });
  }

  private beginShot(run: Run, shot: Shot): void {
    run.state = 'running';
    run.hold = null;
    run.t = 0;
    const fov = shot.fov ?? DEFAULT_FOV;
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.poseCamera(shot, 0);
    this.applyShake(shot, 0, run.index);
    try {
      shot.onStart?.();
    } catch (err) {
      console.error('[cinematic] onStart threw', err);
    }
  }

  private poseCamera(shot: Shot, u: number): void {
    const k = ease(shot.ease ?? 'inout', u);
    const to = shot.to ?? shot.from;
    lerpVec(this.tmpPos, shot.from.pos, to.pos, k);
    lerpVec(this.tmpLook, shot.from.lookAt, to.lookAt, k);
    this.camera.position.copy(this.tmpPos);
    this.tmpDir.subVectors(this.tmpLook, this.tmpPos);
    if (this.tmpDir.lengthSq() < 1e-8) this.tmpLook.set(this.tmpPos.x, this.tmpPos.y, this.tmpPos.z - 1);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.tmpLook);
  }

  private applyShake(shot: Shot, t: number, shotIndex: number): void {
    const amount = Math.max(0, Math.min(1, shot.shake ?? 0));
    if (amount <= 0) return;
    const scale = this.s.store.get().settings.motionEffects ? 1 : 0.5;
    const a = amount * scale;
    const time = t + shotIndex * 37.1;
    const yaw = this.noiseYaw.handheld(time) * 0.016 * a;
    const pitch = this.noisePitch.handheld(time + 11.7) * 0.012 * a;
    const roll = this.noiseRoll.handheld(time + 23.9) * 0.007 * a;
    this.camera.rotateY(yaw);
    this.camera.rotateX(pitch);
    this.camera.rotateZ(roll);
    const bob = this.noisePos.handheld(time + 41.3) * 0.02 * a;
    this.camera.position.y += bob;
    this.camera.position.x += this.noisePos.handheld(time + 59.9) * 0.012 * a;
  }

  // ---------------------------------------------------------------------------
  // Lock / restore
  // ---------------------------------------------------------------------------

  private lock(run: Run): void {
    const s = this.s;
    s.store.lockInput(true);
    s.characters.setMovementEnabled(false);
    s.characters.setLookEnabled(false);
    s.ui.setHudVisible(false);
    if (run.letterbox) s.three.uiRoot.classList.add('cinematic');
  }

  private finish(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const s = this.s;
    s.three.uiRoot.classList.remove('cinematic');
    s.ui.setHudVisible(true);
    s.characters.setMovementEnabled(true);
    s.characters.setLookEnabled(true);
    s.store.lockInput(false);
    s.bus.emit('cinematic:end', { id: run.id });
    run.resolve();
  }
}

function lerpVec(out: THREE.Vector3, a: Vec3, b: Vec3, k: number): void {
  out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
}
