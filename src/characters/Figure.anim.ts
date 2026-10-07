/**
 * Pose generation for Figure. Pure math — no three.js objects — so it stays cheap and testable:
 * gait cycles (walk / limp / wrong_gait / slow / drag), idle with breathing and weight shifts, seated
 * and lying poses, work / mop / phone behaviours (2-bone arm IK), the CCTV glitch, and smooth
 * blending between any two of them.
 *
 * Joint conventions (figure faces -z): limb pitch about x, positive = forward; knees bend negative;
 * elbows bend positive; shoulder/hip joints use Euler order ZXY so (pitch, twist, roll) can be set
 * from a direction vector; head uses YXZ.
 */
import type { FigureAnim } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { Dims } from './Figure.outfits';

export const CH = {
  rootX: 0, rootY: 1, rootZ: 2, rootYaw: 3, rootRoll: 4,
  spinePitch: 5, spineYaw: 6, spineRoll: 7,
  headPitch: 8, headYaw: 9, headRoll: 10,
  shLPitch: 11, shLTwist: 12, shLRoll: 13,
  shRPitch: 14, shRTwist: 15, shRRoll: 16,
  elbowL: 17, elbowR: 18, wristL: 19, wristR: 20,
  hipLPitch: 21, hipLRoll: 22, hipRPitch: 23, hipRRoll: 24,
  kneeL: 25, kneeR: 26, footL: 27, footR: 28,
  /** 0..1 chest expansion */
  breath: 29,
  /** 0..1 lying-down blend (rig rotation + bed height) */
  lie: 30,
  /** 0..1 mop prop presence */
  mop: 31,
  /** 0..1 phone prop presence */
  phone: 32,
  /** rig vertical squash (glitch only) */
  scaleY: 33,
} as const;
export const CHANNELS = 34;

const TAU = Math.PI * 2;
const BLEND_SECONDS = 0.3;
const BLEND_SECONDS_BIG = 0.55;
/** thigh pitch when seated (knees a little below the hips) */
const SIT_HIP = 1.42;

/** scratch vector + active rotations (right-handed) used by the IK frame conversion */
const V = { x: 0, y: 0, z: 0 };
function rotX(a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  const y = V.y * c - V.z * s;
  V.z = V.y * s + V.z * c;
  V.y = y;
}
function rotY(a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  const x = V.x * c + V.z * s;
  V.z = -V.x * s + V.z * c;
  V.x = x;
}
function rotZ(a: number): void {
  const c = Math.cos(a), s = Math.sin(a);
  const x = V.x * c - V.y * s;
  V.y = V.x * s + V.y * c;
  V.x = x;
}

/** channels interpolated linearly; everything else is an angle (shortest arc) */
const LINEAR = new Uint8Array(CHANNELS);
for (const i of [CH.rootX, CH.rootY, CH.rootZ, CH.breath, CH.lie, CH.mop, CH.phone, CH.scaleY]) LINEAR[i] = 1;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** wrap to [-π, π) */
const wrapAngle = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);
const angLerp = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
/** periodic gaussian bump centred on phase c (radians), width w */
const bump = (phi: number, c: number, w: number): number => {
  const d = wrapAngle(phi - c);
  return Math.exp(-(d * d) / (w * w));
};
const approach = (cur: number, target: number, rate: number, dt: number): number => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export function resetPose(p: Float32Array): void {
  p.fill(0);
  p[CH.scaleY] = 1;
}

function mixPose(out: Float32Array, a: Float32Array, b: Float32Array, k: number): void {
  for (let i = 0; i < CHANNELS; i++) out[i] = LINEAR[i] ? lerp(a[i], b[i], k) : angLerp(a[i], b[i], k);
}

/** Mop handle in rig space: top end and the point where it meets the floor. */
export interface MopLine {
  topX: number; topY: number; topZ: number;
  floorX: number; floorY: number; floorZ: number;
}

export interface DriverResult {
  pose: Float32Array;
  /** true when `pose` is a one-frame glitch jump (apply instantly, no smoothing) */
  glitch: boolean;
}

type GaitAnim = 'walk' | 'limp' | 'wrong_gait' | 'slow' | 'drag';

interface Gait {
  /** metres per step */
  stride: number;
  stepsPerCycle: number;
  /** thigh swing amplitude (rad) at walking speed */
  leg: number;
  arm: number;
  /** total vertical travel of the hips (m) */
  bob: number;
  sway: number;
  lean: number;
  kneeSwing: number;
  kneeStance: number;
  /** phase delay of the swing-knee bend (wrong_gait: knees bend too late) */
  kneeLate: number;
  headDown: number;
  /** how much the head cancels pelvis/torso yaw (1 = perfectly stable) */
  headCounter: number;
  sameSideArm: boolean;
  limp: number;
  drag: boolean;
  irregular: boolean;
}

const WALK: Gait = {
  stride: 0.75, stepsPerCycle: 2, leg: 0.48, arm: 0.38, bob: 0.035, sway: 0.02, lean: -0.04,
  kneeSwing: 1.0, kneeStance: 0.2, kneeLate: 0, headDown: 0.03, headCounter: 0.6,
  sameSideArm: false, limp: 0, drag: false, irregular: false,
};

const GAITS: Record<GaitAnim, Gait> = {
  walk: WALK,
  limp: { ...WALK, stride: 0.6, arm: 0.3, lean: -0.08, limp: 0.85, headDown: 0.1 },
  wrong_gait: { ...WALK, kneeLate: 0.65, irregular: true, sameSideArm: true, bob: 0.015, lean: 0, arm: 0.3, headCounter: 1, headDown: 0 },
  slow: { ...WALK, stride: 0.9, leg: 0.55, arm: 0.12, bob: 0.012, lean: -0.02, kneeSwing: 0.8, headDown: 0.12, headCounter: 1 },
  drag: { ...WALK, stride: 0.5, stepsPerCycle: 1, leg: 0.4, arm: 0.2, bob: 0.05, sway: 0.03, lean: -0.18, headDown: 0.3, drag: true, headCounter: 0.3 },
};

function isGait(a: FigureAnim): a is GaitAnim {
  return a === 'walk' || a === 'limp' || a === 'wrong_gait' || a === 'slow' || a === 'drag';
}

// ---------------------------------------------------------------------------
// 2-bone IK
// ---------------------------------------------------------------------------

interface IKResult { p: number; tw: number; r: number; el: number }
const IK: IKResult = { p: 0, tw: 0, r: 0, el: 0 };

/**
 * Solve a hanging 2-bone limb (rest direction -y) so its end lands on target (relative to the root
 * joint, in the parent's frame). Writes shoulder pitch/twist/roll (Euler ZXY) and the hinge angle.
 * `poleSign` pushes the elbow outward on that side of the body (-1 left, +1 right).
 */
function solveLimb(tx: number, ty: number, tz: number, L1: number, L2: number, poleSign: number, res: IKResult): void {
  let d = Math.hypot(tx, ty, tz);
  if (d < 1e-5) {
    tx = 0; ty = -1; tz = 0; d = 1;
  }
  const k = clamp(d, Math.abs(L1 - L2) + 0.02, (L1 + L2) * 0.995) / d;
  tx *= k; ty *= k; tz *= k; d *= k;
  const ux0 = tx / d, uy0 = ty / d, uz0 = tz / d;
  const alpha = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  // pole: elbows go back, down and slightly out
  let hx = poleSign * 0.35, hy = -0.45, hz = 0.82;
  let hd = hx * ux0 + hy * uy0 + hz * uz0;
  hx -= hd * ux0; hy -= hd * uy0; hz -= hd * uz0;
  let hl = Math.hypot(hx, hy, hz);
  if (hl < 1e-4) {
    hx = 0; hy = 0; hz = 1;
    hd = hz * uz0;
    hx -= hd * ux0; hy -= hd * uy0; hz -= hd * uz0;
    hl = Math.hypot(hx, hy, hz) || 1;
  }
  hx /= hl; hy /= hl; hz /= hl;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const ux = ca * ux0 + sa * hx, uy = ca * uy0 + sa * hy, uz = ca * uz0 + sa * hz;
  let fx = tx - ux * L1, fy = ty - uy * L1, fz = tz - uz * L1;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  const p = -Math.asin(clamp(uz, -1, 1));
  const r = Math.atan2(ux, -uy);
  const el = Math.acos(clamp(ux * fx + uy * fy + uz * fz, -1, 1));
  let tw = 0;
  if (el > 1e-3) {
    // hinge axis = bend-plane normal (u × f); find the twist that aligns the joint's local x with it
    let nx = uy * fz - uz * fy, ny = uz * fx - ux * fz, nz = ux * fy - uy * fx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p);
    const x0 = nx * cr + ny * sr; // local x at zero twist
    const x9 = nx * (-sp * sr) + ny * (sp * cr) + nz * (-cp); // local x at 90° twist
    tw = Math.atan2(x9, x0);
  }
  res.p = p; res.tw = tw; res.r = r; res.el = el;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class AnimDriver {
  anim: FigureAnim = 'idle';
  /** blended output pose */
  readonly pose = new Float32Array(CHANNELS);
  readonly mop: MopLine = { topX: 0, topY: 1, topZ: -0.2, floorX: 0, floorY: 0, floorZ: -1 };

  private effective: FigureAnim = 'idle';
  private readonly target = new Float32Array(CHANNELS);
  private readonly from = new Float32Array(CHANNELS);
  private readonly scratch = new Float32Array(CHANNELS);
  private readonly glitchPose = new Float32Array(CHANNELS);
  private blend = 1;
  private blendDur = BLEND_SECONDS;
  private t = 0;
  private phase: number;
  // weight shift / head micro-movements
  private shiftTimer: number;
  private shiftSide = 1;
  private shift = 0;
  private headTimer: number;
  private headTY = 0;
  private headTP = 0;
  private headY = 0;
  private headP = 0;
  // irregular gait
  private gaitMul = 1;
  private gaitTarget = 1;
  private gaitTimer = 0.8;
  // work reaches
  private reachTimer: number;
  private reachT = -1;
  private reachSide = 1;
  // phone
  private phoneSeated = false;
  private thumbTimer: number;
  private thumbT = -1;
  // lying shifts
  private lieTimer: number;
  private lieKnee = 1;
  private lieKneeT = -1;
  // glitch
  private glitchCountdown: number;
  private glitchHold = 0;

  constructor(private readonly dims: Dims, private readonly rng: RNG) {
    this.phase = rng.range(0, TAU);
    this.shiftTimer = rng.range(1, 5);
    this.headTimer = rng.range(2, 6);
    this.reachTimer = rng.range(2, 6);
    this.thumbTimer = rng.range(1, 3);
    this.lieTimer = rng.range(4, 10);
    this.glitchCountdown = rng.int(3, 9);
    resetPose(this.pose);
    resetPose(this.target);
    resetPose(this.from);
  }

  setAnim(a: FigureAnim): void {
    if (a === this.anim) return;
    const prev = this.anim;
    // a phone taken out while seated keeps the figure seated
    this.phoneSeated = a === 'phone' && (prev === 'sit' || (prev === 'phone' && this.phoneSeated));
    this.anim = a;
    this.beginBlend(a, prev);
  }

  /** Skip the blend-in: pose = the current animation's pose right now (used at construction). */
  prime(): void {
    this.update(0, 0);
    this.blend = 1;
    this.pose.set(this.target);
  }

  private beginBlend(next: FigureAnim, prev: FigureAnim): void {
    this.from.set(this.pose);
    this.blend = 0;
    const big = (x: FigureAnim) => x === 'lie' || x === 'sit';
    this.blendDur = big(next) || big(prev) ? BLEND_SECONDS_BIG : BLEND_SECONDS;
    this.effective = next;
  }

  update(dt: number, speed: number): DriverResult {
    this.t += dt;
    // a figure that is moving while flagged idle must not slide on frozen legs
    const eff: FigureAnim = this.anim === 'idle' && speed > 0.2 ? 'walk' : this.anim;
    if (eff !== this.effective) this.beginBlend(eff, this.effective);

    const out = this.target;
    resetPose(out);
    if (isGait(eff)) this.poseGait(out, GAITS[eff], speed, dt);
    else {
      switch (eff) {
        case 'idle': this.poseIdle(out, dt, 1); break;
        case 'sit': this.poseSit(out, dt); break;
        case 'lie': this.poseLie(out, dt); break;
        case 'work': this.poseWork(out, dt); break;
        case 'mop': this.poseMop(out, dt); break;
        case 'phone': this.posePhone(out, dt); break;
        case 'stand_still':
        case 'glitch':
        default: this.poseStill(out); break;
      }
    }

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + (this.blendDur > 0 ? dt / this.blendDur : 1));
      mixPose(this.pose, this.from, out, smooth(this.blend));
    } else {
      this.pose.set(out);
    }

    if (eff === 'glitch' && this.stepGlitch()) return { pose: this.glitchPose, glitch: true };
    return { pose: this.pose, glitch: false };
  }

  // --- shared behaviours ------------------------------------------------------

  private breathing(out: Float32Array, hz: number, amp: number): number {
    const b = 0.5 + 0.5 * Math.sin(TAU * hz * this.t);
    out[CH.breath] = b * amp;
    return b;
  }

  /** Weight shift every 3–6 s onto one foot, easing over ~1 s. */
  private weightShift(out: Float32Array, dt: number, scale: number, legs: boolean): void {
    this.shiftTimer -= dt;
    if (this.shiftTimer <= 0) {
      if (this.rng.chance(0.7)) this.shiftSide = -this.shiftSide;
      this.shiftTimer = this.rng.range(3, 6);
    }
    this.shift = approach(this.shift, this.shiftSide, 2.0, dt);
    const sh = this.shift * scale;
    out[CH.rootX] += 0.028 * sh;
    out[CH.rootRoll] += 0.03 * sh;
    out[CH.spineRoll] += -0.012 * sh;
    if (legs) {
      // the unloaded knee softens and that hip drifts forward a touch
      out[CH.kneeL] += -0.14 * Math.max(0, sh);
      out[CH.kneeR] += -0.14 * Math.max(0, -sh);
      out[CH.hipLPitch] += 0.05 * Math.max(0, sh);
      out[CH.hipRPitch] += 0.05 * Math.max(0, -sh);
    }
  }

  private headMicro(out: Float32Array, dt: number, scale: number, rate = 3): void {
    this.headTimer -= dt;
    if (this.headTimer <= 0) {
      this.headTY = this.rng.range(-0.18, 0.18);
      this.headTP = this.rng.range(-0.08, 0.05);
      this.headTimer = this.rng.range(4, 9);
    }
    this.headY = approach(this.headY, this.headTY, rate, dt);
    this.headP = approach(this.headP, this.headTP, rate, dt);
    out[CH.headYaw] += this.headY * scale;
    out[CH.headPitch] += this.headP * scale;
  }

  private hangArms(out: Float32Array, elbow: number, roll = 0.09): void {
    out[CH.shLRoll] += -roll;
    out[CH.shRRoll] += roll;
    out[CH.shLPitch] += 0.03;
    out[CH.shRPitch] += 0.03;
    out[CH.elbowL] += elbow;
    out[CH.elbowR] += elbow;
    out[CH.wristL] += 0.1;
    out[CH.wristR] += 0.1;
  }

  /** Hip-joint height when seated with the thighs pitched SIT_HIP forward and the shins vertical. */
  private sitHipY(): number {
    const d = this.dims;
    return d.shinLen + d.footH + d.thighLen * Math.cos(SIT_HIP);
  }

  /**
   * Rig-space point → spine-local coordinates for the pose in `out`, inverting the hips
   * (Euler XYZ: yaw, roll) and spine (pitch, yaw, roll) rotations exactly as the rig applies them.
   */
  private rigToChest(out: Float32Array, x: number, y: number, z: number): void {
    const d = this.dims;
    V.x = x - out[CH.rootX];
    V.y = y - (d.hipY + out[CH.rootY]);
    V.z = z - out[CH.rootZ];
    rotY(-out[CH.rootYaw]);
    rotZ(-out[CH.rootRoll]);
    V.y -= d.spinePivotY - d.hipY;
    rotX(-out[CH.spinePitch]);
    rotY(-out[CH.spineYaw]);
    rotZ(-out[CH.spineRoll]);
  }

  /** Put a wrist at a rig-space point. */
  private armIK(out: Float32Array, side: 'L' | 'R', tx: number, ty: number, tz: number): void {
    const d = this.dims;
    const sign = side === 'L' ? -1 : 1;
    this.rigToChest(out, tx, ty, tz);
    const shX = sign * d.shoulderHalf;
    const shY = d.shoulderY - d.spinePivotY - d.shoulderDrop;
    solveLimb(V.x - shX, V.y - shY, V.z, d.upperArmLen, d.forearmLen, sign, IK);
    if (side === 'L') {
      out[CH.shLPitch] = IK.p; out[CH.shLTwist] = IK.tw; out[CH.shLRoll] = IK.r; out[CH.elbowL] = IK.el;
    } else {
      out[CH.shRPitch] = IK.p; out[CH.shRTwist] = IK.tw; out[CH.shRRoll] = IK.r; out[CH.elbowR] = IK.el;
    }
  }

  // --- poses --------------------------------------------------------------------

  private poseIdle(out: Float32Array, dt: number, scale: number): void {
    const b = this.breathing(out, 0.6, 1);
    out[CH.spinePitch] += -0.02 + 0.012 * b;
    out[CH.headPitch] += -0.01 + 0.006 * b;
    this.weightShift(out, dt, scale, true);
    this.headMicro(out, dt, 1);
    this.hangArms(out, 0.14 + 0.02 * b);
    out[CH.shLPitch] += 0.015 * b;
    out[CH.shRPitch] += 0.015 * b;
    out[CH.hipLRoll] += -0.03;
    out[CH.hipRRoll] += 0.03;
  }

  /** Completely motionless — not even breathing. */
  private poseStill(out: Float32Array): void {
    this.hangArms(out, 0.06, 0.07);
    out[CH.hipLRoll] = -0.02;
    out[CH.hipRRoll] = 0.02;
  }

  private poseGait(out: Float32Array, g: Gait, speed: number, dt: number): void {
    const amp = clamp(speed / 1.3, 0, 1.25);
    let mul = 1;
    if (g.irregular) {
      this.gaitTimer -= dt;
      if (this.gaitTimer <= 0) {
        this.gaitTarget = this.rng.range(0.7, 1.35);
        this.gaitTimer = this.rng.range(0.5, 1.4);
      }
      this.gaitMul = approach(this.gaitMul, this.gaitTarget, 4, dt);
      mul = this.gaitMul;
    }
    this.phase = (this.phase + ((TAU * speed) / (g.stride * g.stepsPerCycle)) * mul * dt) % TAU;
    const phi = this.phase;
    const a8 = Math.pow(amp, 0.8);
    const A = g.leg * a8;
    const s = Math.sin(phi), c = Math.cos(phi);

    const kneeOf = (ph: number): number =>
      g.kneeSwing * a8 * bump(ph, -0.45 + g.kneeLate, 0.9) + g.kneeStance * amp * bump(ph, 2.0, 0.6);
    const footOf = (ph: number): number =>
      amp * (-0.4 * bump(ph, -Math.PI / 2 + 0.1, 0.5) + 0.25 * bump(ph, Math.PI / 2 + 0.1, 0.45) + 0.1 * bump(ph, 0, 1.0));

    const phiL = phi, phiR = phi + Math.PI;
    let legL = A * Math.sin(phiL), legR = A * Math.sin(phiR);
    let kneeL = -kneeOf(phiL), kneeR = -kneeOf(phiR);
    let footL = footOf(phiL), footR = footOf(phiR);

    // pelvis: shifts over the stance foot, drops on the swing side, rotates toward the leading leg
    out[CH.rootX] = g.sway * amp * c;
    out[CH.rootRoll] = 0.04 * amp * c;
    out[CH.rootYaw] = -0.07 * amp * s;
    out[CH.rootY] = g.bob * amp * 0.5 * Math.cos(g.stepsPerCycle * phi);
    // torso counter-rotates, head stays level
    out[CH.spinePitch] = g.lean * amp - 0.01;
    out[CH.spineYaw] = -out[CH.rootYaw] * 0.7;
    out[CH.spineRoll] = -out[CH.rootRoll] * 0.6;
    out[CH.headYaw] = -(out[CH.rootYaw] + out[CH.spineYaw]) * g.headCounter;
    out[CH.headRoll] = -(out[CH.rootRoll] + out[CH.spineRoll]) * 0.5;
    out[CH.headPitch] = -g.headDown;

    const armSign = g.sameSideArm ? 1 : -1;
    let shL = armSign * g.arm * amp * s;
    let shR = -armSign * g.arm * amp * s;
    let elL = 0.18 + 0.28 * amp * Math.max(0, armSign * s);
    let elR = 0.18 + 0.28 * amp * Math.max(0, -armSign * s);
    let rollL = -0.1, rollR = 0.1;

    if (g.limp > 0) {
      // bad right leg: short swing, never straightens, the body drops onto it each stance
      const L = g.limp;
      legR *= 1 - 0.5 * L;
      kneeR -= 0.3 * L * (0.6 + 0.4 * amp);
      const onBad = bump(phi, 0, 1.0);
      out[CH.rootY] -= 0.035 * L * amp * onBad;
      out[CH.spineRoll] += -0.08 * L * amp * onBad;
      out[CH.rootRoll] += 0.03 * L * amp * onBad;
      shR *= 1 - 0.5 * L;
      footR *= 0.5;
    }
    if (g.drag) {
      // left leg trails behind, toe scraping; right arm out for balance
      legL = -0.35 - 0.08 * s;
      kneeL = -0.05;
      footL = -0.5;
      out[CH.rootRoll] += 0.05;
      out[CH.rootZ] = -0.02 * Math.max(0, s) * amp;
      shL = 0.15 + 0.05 * s; elL = 0.08; rollL = -0.06;
      shR = 0.25 + 0.15 * s; elR = 0.5; rollR = 0.55;
    }

    out[CH.hipLPitch] = legL; out[CH.hipRPitch] = legR;
    out[CH.hipLRoll] = -0.03; out[CH.hipRRoll] = 0.03;
    out[CH.kneeL] = kneeL; out[CH.kneeR] = kneeR;
    out[CH.footL] = footL; out[CH.footR] = footR;
    out[CH.shLPitch] = shL; out[CH.shRPitch] = shR;
    out[CH.shLRoll] = rollL; out[CH.shRRoll] = rollR;
    out[CH.elbowL] = elL; out[CH.elbowR] = elR;
    out[CH.wristL] = 0.1; out[CH.wristR] = 0.1;
    this.breathing(out, 0.6 + 0.5 * amp, 0.7);

    // standing while flagged as walking: settle into the idle behaviour instead of freezing mid-stride
    const still = 1 - clamp(speed / 0.25, 0, 1);
    if (still > 0) {
      const sc = this.scratch;
      resetPose(sc);
      this.poseIdle(sc, dt, 1);
      mixPose(out, out, sc, still);
    } else {
      this.shiftTimer -= dt;
      this.headTimer -= dt;
    }
  }

  private poseSit(out: Float32Array, dt: number): void {
    const d = this.dims;
    const hipYsit = this.sitHipY();
    out[CH.rootY] = hipYsit - d.hipY;
    out[CH.hipLPitch] = SIT_HIP; out[CH.hipRPitch] = SIT_HIP;
    out[CH.hipLRoll] = -0.1; out[CH.hipRRoll] = 0.1;
    out[CH.kneeL] = -SIT_HIP; out[CH.kneeR] = -SIT_HIP;
    out[CH.spinePitch] = -0.1;
    out[CH.headPitch] = -0.06;
    const b = this.breathing(out, 0.6, 1);
    out[CH.spinePitch] += 0.01 * b;
    this.weightShift(out, dt, 0.35, false);
    this.headMicro(out, dt, 1);
    // hands resting on the thighs
    this.armIK(out, 'L', -0.13, hipYsit + 0.11, -0.27);
    this.armIK(out, 'R', 0.13, hipYsit + 0.11, -0.27);
    out[CH.wristL] = 0.35; out[CH.wristR] = 0.35;
  }

  private poseLie(out: Float32Array, dt: number): void {
    const d = this.dims;
    out[CH.lie] = 1;
    out[CH.hipLPitch] = 0.03; out[CH.hipRPitch] = 0.03;
    out[CH.hipLRoll] = -0.06; out[CH.hipRRoll] = 0.06;
    out[CH.kneeL] = -0.05; out[CH.kneeR] = -0.05;
    out[CH.spinePitch] = -0.06;
    out[CH.headPitch] = -0.28; // pillow
    this.breathing(out, 0.28, 1.3);
    this.lieTimer -= dt;
    if (this.lieTimer <= 0) {
      this.lieTimer = this.rng.range(6, 12);
      if (this.rng.chance(0.5)) this.headTY = this.rng.range(-0.35, 0.35);
      else if (this.lieKneeT < 0) {
        this.lieKnee = this.rng.chance(0.5) ? -1 : 1;
        this.lieKneeT = 0;
      }
    }
    this.headY = approach(this.headY, this.headTY, 1.5, dt);
    out[CH.headYaw] = this.headY;
    if (this.lieKneeT >= 0) {
      // one knee drawn up and lowered again over ~5 s
      this.lieKneeT += dt;
      const dur = 5;
      const k = 0.9 * Math.sin(Math.PI * clamp(this.lieKneeT / dur, 0, 1));
      if (this.lieKnee < 0) { out[CH.hipLPitch] += k * 0.6; out[CH.kneeL] -= k; }
      else { out[CH.hipRPitch] += k * 0.6; out[CH.kneeR] -= k; }
      if (this.lieKneeT >= dur) this.lieKneeT = -1;
    }
    // hands folded on the lower abdomen
    const hz = -(d.pelvisHalfD + 0.06);
    this.armIK(out, 'L', -0.1, d.hipY + 0.14, hz);
    this.armIK(out, 'R', 0.1, d.hipY + 0.14, hz);
    out[CH.wristL] = 0.3; out[CH.wristR] = 0.3;
  }

  private poseWork(out: Float32Array, dt: number): void {
    const t = this.t;
    out[CH.spinePitch] = -0.12;
    out[CH.headPitch] = -0.26 + 0.03 * Math.sin(t * 0.7);
    this.breathing(out, 0.6, 1);
    this.weightShift(out, dt, 0.6, true);
    this.headMicro(out, dt, 0.5);
    // every few seconds one hand reaches aside (a chart, a drawer) and comes back
    this.reachTimer -= dt;
    if (this.reachTimer <= 0 && this.reachT < 0) {
      this.reachT = 0;
      this.reachSide = this.rng.chance(0.5) ? -1 : 1;
      this.reachTimer = this.rng.range(3, 7);
    }
    let env = 0;
    if (this.reachT >= 0) {
      this.reachT += dt;
      const T = this.reachT;
      env = T < 0.4 ? smooth(T / 0.4) : T < 1.2 ? 1 : T < 1.6 ? smooth((1.6 - T) / 0.4) : 0;
      if (T >= 1.6) this.reachT = -1;
    }
    let lx = -0.15 + 0.006 * Math.sin(TAU * 1.3 * t);
    let rx = 0.14 + 0.006 * Math.sin(TAU * 1.7 * t);
    let ly = 0.97 + 0.012 * Math.sin(TAU * 3.1 * t);
    let ry = 0.95 + 0.012 * Math.sin(TAU * 2.7 * t + 1.3);
    const lz = -0.3 + 0.01 * Math.sin(TAU * 2.3 * t);
    const rz = -0.28 + 0.01 * Math.sin(TAU * 1.9 * t + 0.7);
    if (env > 0) {
      if (this.reachSide < 0) { lx = lerp(lx, -0.42, env); ly = lerp(ly, 1.03, env); }
      else { rx = lerp(rx, 0.42, env); ry = lerp(ry, 1.03, env); }
    }
    this.armIK(out, 'L', lx, ly, lz);
    this.armIK(out, 'R', rx, ry, rz);
    out[CH.wristL] = 0.4; out[CH.wristR] = 0.4;
  }

  private poseMop(out: Float32Array, dt: number): void {
    const t = this.t;
    const s = Math.sin(TAU * 0.75 * t);
    const s2 = Math.sin(TAU * 0.75 * t + 0.9);
    out[CH.mop] = 1;
    // wide stance, left foot forward, bent over the handle
    out[CH.hipLPitch] = 0.24; out[CH.hipRPitch] = -0.14;
    out[CH.hipLRoll] = -0.08; out[CH.hipRRoll] = 0.08;
    out[CH.kneeL] = -0.22 - 0.05 * s; out[CH.kneeR] = -0.12 + 0.04 * s;
    out[CH.footR] = -0.05;
    out[CH.rootX] = 0.035 * s2;
    out[CH.rootZ] = -0.03 * s;
    out[CH.rootY] = -0.012 - 0.006 * Math.abs(s);
    out[CH.rootYaw] = 0.04 * s;
    out[CH.spinePitch] = -0.22 - 0.05 * s;
    out[CH.spineRoll] = 0.07 * s;
    out[CH.spineYaw] = 0.06 * s;
    out[CH.headPitch] = -0.32;
    out[CH.headYaw] = 0.05 * s;
    this.breathing(out, 0.9, 0.8);
    this.shiftTimer -= dt;
    this.headTimer -= dt;
    // both hands on the handle (kept within reach through the whole stroke); the handle runs from
    // just above the upper hand down to the floor
    const ux = 0.06 + 0.03 * s2, uy = 1.12 + 0.02 * s, uz = -0.14 + 0.06 * s;
    const lx = -0.04 + 0.02 * s2, ly = 0.93 + 0.02 * s, lz = -0.3 + 0.08 * s;
    let dx = lx - ux, dy = ly - uy, dz = lz - uz;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    const m = this.mop;
    m.topX = ux - dx * 0.12; m.topY = uy - dy * 0.12; m.topZ = uz - dz * 0.12;
    const toFloor = (uy - 0.012) / Math.max(0.2, -dy);
    m.floorX = ux + dx * toFloor; m.floorY = 0.012; m.floorZ = uz + dz * toFloor;
    this.armIK(out, 'R', ux, uy, uz);
    this.armIK(out, 'L', lx, ly, lz);
    out[CH.wristL] = 0.2; out[CH.wristR] = 0.2;
  }

  private posePhone(out: Float32Array, dt: number): void {
    if (this.phoneSeated) this.poseSit(out, dt);
    else this.poseIdle(out, dt, 0.8);
    out[CH.phone] = 1;
    const baseY = this.phoneSeated ? this.sitHipY() + 0.5 : 1.22;
    // thumb-scroll bursts: tiny hand movements every couple of seconds
    this.thumbTimer -= dt;
    if (this.thumbTimer <= 0 && this.thumbT < 0) {
      this.thumbT = 0;
      this.thumbTimer = this.rng.range(1.5, 4);
    }
    let th = 0;
    if (this.thumbT >= 0) {
      this.thumbT += dt;
      th = Math.sin(TAU * 3.5 * this.thumbT) * Math.sin(Math.PI * clamp(this.thumbT / 0.9, 0, 1));
      if (this.thumbT > 0.9) this.thumbT = -1;
    }
    this.armIK(out, 'R', 0.1, baseY + 0.005 * th, this.phoneSeated ? -0.27 : -0.22);
    out[CH.wristR] = 0.5;
    out[CH.headPitch] = (this.phoneSeated ? -0.55 : -0.5) + 0.01 * th;
    out[CH.headYaw] = -0.12 + out[CH.headYaw] * 0.3;
    out[CH.headRoll] = 0.04;
    out[CH.spinePitch] += -0.04;
  }

  /** Every few frames: jump to a random pose for one frame (occasionally two), then snap back. */
  private stepGlitch(): boolean {
    if (this.glitchHold > 0) {
      this.glitchHold--;
      return true;
    }
    if (--this.glitchCountdown > 0) return false;
    this.glitchCountdown = this.rng.int(3, 9);
    this.glitchHold = this.rng.chance(0.2) ? 1 : 0;
    const g = this.glitchPose;
    const r = this.rng;
    resetPose(g);
    g[CH.rootX] = r.range(-0.25, 0.25);
    g[CH.rootZ] = r.range(-0.2, 0.2);
    g[CH.rootY] = r.range(-0.15, 0.05);
    g[CH.rootYaw] = r.range(-0.7, 0.7);
    g[CH.spinePitch] = r.range(-0.35, 0.2);
    g[CH.spineRoll] = r.range(-0.25, 0.25);
    g[CH.headPitch] = r.range(-0.8, 0.5);
    g[CH.headYaw] = r.range(-1.2, 1.2);
    g[CH.headRoll] = r.range(-0.4, 0.4);
    g[CH.shLPitch] = r.range(-0.6, 1.9); g[CH.shLTwist] = r.range(-0.5, 0.5); g[CH.shLRoll] = r.range(-0.9, 0.3); g[CH.elbowL] = r.range(0, 2.2);
    g[CH.shRPitch] = r.range(-0.6, 1.9); g[CH.shRTwist] = r.range(-0.5, 0.5); g[CH.shRRoll] = r.range(-0.3, 0.9); g[CH.elbowR] = r.range(0, 2.2);
    g[CH.hipLPitch] = r.range(-0.5, 0.7); g[CH.hipRPitch] = r.range(-0.5, 0.7);
    g[CH.kneeL] = r.range(-1.2, 0); g[CH.kneeR] = r.range(-1.2, 0);
    g[CH.scaleY] = r.chance(0.3) ? r.range(0.85, 1.15) : 1;
    return true;
  }
}
