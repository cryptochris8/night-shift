/**
 * Figure — a procedural humanoid built from primitives: realistic proportions, per-outfit details,
 * shared materials and fully procedural animation (see Figure.anim.ts).
 * Origin at the feet, +y up, faces -z at yaw 0 (three.js convention).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FigureAnim, Outfit } from '../core/contracts';
import { RNG } from '../core/rng';
import { AnimDriver, CH } from './Figure.anim';
import { FACE_POINT, HEAD_R_REF, headGeometry, pickFace, pickHairStyle, type FacePreset } from './Figure.head';
import {
  OUTFITS,
  PROP_MATS,
  computeDims,
  makeMaterial,
  pickHairSpec,
  sharedMaterial,
  type BodyRole,
  type Dims,
  type MatRole,
  type MatSpec,
  type OutfitSpec,
  type PropRole,
} from './Figure.outfits';

export type { Outfit, FigureAnim } from '../core/contracts';

const SEG = 12;
const TAU = Math.PI * 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Q_IDENTITY = new THREE.Quaternion();
/** Supine: face up, head toward the figure's facing direction (-z). */
const Q_LIE = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'XYZ'));
const PHONE_SKIN_GLOW = 0x2b4260;
const PHONE_CLOTH_GLOW = 0x0b1119;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

interface Part {
  mesh: THREE.Mesh;
  role: MatRole;
  shadow: boolean;
}

export class Figure {
  /** Root group: origin at the feet, +y up, faces -z at yaw 0. */
  readonly object = new THREE.Group();
  readonly outfit: Outfit;

  private readonly spec: OutfitSpec;
  private readonly dims: Dims;
  private readonly rng: RNG;
  private readonly face: FacePreset;
  /** sRGB hex, null for the hairless dark figure */
  private hairColor: number | null = null;
  private readonly driver: AnimDriver;
  private readonly parts: Part[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private mats = new Map<MatRole, THREE.MeshStandardMaterial>();
  /** materials that are never shared (mutated per figure) */
  private readonly alwaysOwn = new Set<MatRole>(['phoneScreen']);
  private ownMats = false;
  private opacity = 1;
  private userVisible = true;
  private phoneGlow = false;
  private lastGlow = 0;

  // rig
  private readonly rig = new THREE.Group();
  private hips!: THREE.Group;
  private spine!: THREE.Group;
  private neck!: THREE.Group;
  private head!: THREE.Group;
  private shL!: THREE.Group;
  private shR!: THREE.Group;
  private elL!: THREE.Group;
  private elR!: THREE.Group;
  private handL!: THREE.Group;
  private handR!: THREE.Group;
  private hipL!: THREE.Group;
  private hipR!: THREE.Group;
  private kneeL!: THREE.Group;
  private kneeR!: THREE.Group;
  private footL!: THREE.Group;
  private footR!: THREE.Group;
  private torsoMesh!: THREE.Mesh;
  private torsoZScale = 1;
  /** spine-local y of the torso capsule's top */
  private torsoTop = 0;
  /** spine-local y of the shoulder-girdle capsule's axis */
  private yokeY = 0;
  private started = false;
  private readonly chestAnchor = new THREE.Object3D();
  private phoneGroup!: THREE.Group;
  private mopGroup!: THREE.Group;
  private mopHandle!: THREE.Mesh;
  private mopHead!: THREE.Group;
  private readonly lieY: number;
  private readonly lieZ: number;

  constructor(opts: { outfit: Outfit; scale?: number; seed?: number; face?: FacePreset }) {
    this.outfit = opts.outfit;
    this.spec = OUTFITS[opts.outfit];
    this.rng = new RNG(opts.seed ?? 0x51f);
    this.face = opts.face ?? pickFace(this.rng.fork('face'), opts.outfit);
    const jitter = this.spec.jitterHeight && opts.seed !== undefined ? 1 + (this.rng.next() - 0.5) * 0.06 : 1;
    this.dims = computeDims(this.spec, jitter);
    this.driver = new AnimDriver(this.dims, this.rng.fork('anim'));
    // resting on a 0.6 m mattress: the back (and the elbows beside it) sit one pelvis depth below the rig origin
    this.lieY = 0.6 + this.dims.pelvisHalfD + 0.015;
    this.lieZ = this.dims.height * 0.5;

    this.object.name = `figure_${opts.outfit}`;
    this.object.add(this.rig);
    this.object.scale.setScalar(opts.scale ?? 1);

    this.buildMaterials();
    this.buildRig();
    this.buildDetails();
    this.buildProps();
    this.driver.prime();
    this.applyPose(this.driver.pose);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get anim(): FigureAnim {
    return this.driver.anim;
  }

  set anim(a: FigureAnim) {
    this.setAnim(a);
  }

  setAnim(anim: FigureAnim): void {
    this.driver.setAnim(anim);
    if (!this.started) {
      // configured before its first frame (e.g. a patient already in bed): snap, don't blend in
      this.driver.prime();
      this.applyPose(this.driver.pose);
    }
  }

  /** Per frame. `speed` = current horizontal speed in m/s (0 when idle); drives the gait cycle. */
  update(dt: number, speed: number): void {
    if (!Number.isFinite(dt)) dt = 0;
    dt = Math.min(0.1, Math.max(0, dt));
    if (dt > 0) this.started = true;
    const res = this.driver.update(dt, Number.isFinite(speed) ? Math.max(0, speed) : 0);
    this.applyPose(res.pose);
  }

  /** 0..1. Below 1 the figure gets its own transparent material set (shared ones stay untouched). */
  setOpacity(o: number): void {
    o = Math.min(1, Math.max(0, Number.isFinite(o) ? o : 1));
    if (o === this.opacity) return;
    this.opacity = o;
    if (o < 1) this.ensureOwnMaterials();
    if (this.ownMats) this.applyOpacityToMaterials();
    for (const p of this.parts) if (p.shadow) p.mesh.castShadow = o > 0.15;
    this.object.visible = this.userVisible && o > 0.002;
  }

  setVisible(v: boolean): void {
    this.userVisible = v;
    this.object.visible = v && this.opacity > 0.002;
  }

  /** Yaw only — turns to face a world-space point. */
  lookAt(target: THREE.Vector3): void {
    tmpV.copy(target);
    const parent = this.object.parent;
    if (parent) parent.worldToLocal(tmpV);
    const dx = tmpV.x - this.object.position.x;
    const dz = tmpV.z - this.object.position.z;
    if (dx * dx + dz * dz < 1e-8) return;
    this.setYaw(Math.atan2(-dx, -dz));
  }

  setYaw(yaw: number): void {
    this.object.rotation.y = yaw;
  }

  /** World-space centre of the chest (used for visibility checks). */
  getChestPosition(out: THREE.Vector3): THREE.Vector3 {
    this.chestAnchor.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.chestAnchor.matrixWorld);
  }

  /** Lights the phone screen and tints the face/hands from below while the phone pose is active. */
  setPhoneGlow(on: boolean): void {
    if (this.phoneGlow === on) return;
    this.phoneGlow = on;
    if (on) this.ensureOwnMaterials();
    this.updateGlow(this.driver.pose[CH.phone]);
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.geometries.clear();
    for (const [role, m] of this.mats) {
      if (this.ownMats || this.alwaysOwn.has(role)) m.dispose();
    }
    this.mats.clear();
    this.parts.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------

  private buildMaterials(): void {
    const m = this.mats;
    for (const [role, spec] of Object.entries(this.spec.mats) as [BodyRole, MatSpec][]) m.set(role, sharedMaterial(spec));
    this.hairColor = this.spec.hair ? pickHairSpec(this.rng, this.outfit).color : null;
    // the sculpted head is painted per vertex (skin, hair, brows, eye shadow); the faceless one wears 'skin'
    if (this.face !== 'blank') m.set('head', sharedMaterial({ ...this.spec.mats.skin, color: 0xffffff, vertexColors: true }));
    for (const [role, spec] of Object.entries(PROP_MATS) as [PropRole, MatSpec][]) {
      m.set(role, this.alwaysOwn.has(role) ? makeMaterial(spec) : sharedMaterial(spec));
    }
  }

  /** Swap to per-figure clones so opacity / glow changes never leak onto other figures. */
  private ensureOwnMaterials(): void {
    if (this.ownMats) return;
    this.ownMats = true;
    const next = new Map<MatRole, THREE.MeshStandardMaterial>();
    for (const [role, m] of this.mats) next.set(role, this.alwaysOwn.has(role) ? m : m.clone());
    this.mats = next;
    for (const p of this.parts) {
      const mat = next.get(p.role);
      if (mat) p.mesh.material = mat;
    }
    this.applyOpacityToMaterials();
  }

  private applyOpacityToMaterials(): void {
    const o = this.opacity;
    for (const m of this.mats.values()) {
      m.transparent = o < 1;
      m.opacity = o;
      // keep depth writes so limbs occlude each other instead of bleeding through the torso
      m.depthWrite = true;
    }
  }

  private updateGlow(phoneAmount: number): void {
    const on = this.phoneGlow && phoneAmount > 0.01;
    const screen = this.mats.get('phoneScreen');
    if (screen) screen.emissiveIntensity = on ? 1.8 * phoneAmount : 0;
    const level = on ? phoneAmount : 0;
    if (Math.abs(level - this.lastGlow) < 1e-3) return;
    this.lastGlow = level;
    if (!this.ownMats) return; // shared materials are never tinted
    for (const role of ['skin', 'head'] as const) {
      const skin = this.mats.get(role);
      if (!skin) continue;
      skin.emissive.setHex(level > 0 ? PHONE_SKIN_GLOW : 0x000000);
      skin.emissiveIntensity = 0.9 * level;
    }
    for (const role of ['top', 'sleeve', 'collar'] as const) {
      const m = this.mats.get(role);
      if (!m) continue;
      m.emissive.setHex(level > 0 ? PHONE_CLOTH_GLOW : 0x000000);
      m.emissiveIntensity = 0.6 * level;
    }
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  private reg<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }

  /** Cylinder hanging down from yTop (its axis along -y). */
  private cyl(rTop: number, rBot: number, h: number, yTop = 0, segments = SEG): THREE.CylinderGeometry {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segments, 1);
    g.translate(0, yTop - h / 2, 0);
    return g;
  }

  private sphereAt(r: number, x: number, y: number, z: number, w = SEG, h = 10): THREE.SphereGeometry {
    const g = new THREE.SphereGeometry(r, w, h);
    g.translate(x, y, z);
    return g;
  }

  private box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.reg(new THREE.BoxGeometry(w, h, d));
  }

  /** Merge same-material pieces into one draw call; the inputs are consumed. */
  private merged(...geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const out = mergeGeometries(geoms, false) as THREE.BufferGeometry | null;
    for (const g of geoms) {
      if (g !== out) g.dispose();
    }
    return this.reg(out ?? geoms[0]);
  }

  private part(parent: THREE.Object3D, geometry: THREE.BufferGeometry, role: MatRole, shadow = true): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, this.mats.get(role));
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // the rig animates every frame; skip per-part bounding updates
    parent.add(mesh);
    this.parts.push({ mesh, role, shadow });
    return mesh;
  }

  /** Depth (positive) of the torso surface at a spine-local height, including the shoulder girdle ridge. */
  private torsoDepthAt(y: number): number {
    const d = this.dims;
    const capStart = this.torsoTop - d.chestR;
    let r = d.chestR;
    if (y > capStart) {
      const dy = y - capStart;
      r = Math.sqrt(Math.max(0, d.chestR * d.chestR - dy * dy));
    }
    let depth = r * this.torsoZScale;
    const yr = d.deltR * 1.05;
    const dyk = y - this.yokeY;
    if (Math.abs(dyk) < yr) depth = Math.max(depth, 1.3 * Math.sqrt(yr * yr - dyk * dyk));
    return depth;
  }

  // ---------------------------------------------------------------------------
  // Rig
  // ---------------------------------------------------------------------------

  private buildRig(): void {
    const d = this.dims;
    const G = (): THREE.Group => new THREE.Group();

    // --- pelvis + legs ----------------------------------------------------------
    this.hips = G();
    this.hips.position.y = d.hipY;
    this.rig.add(this.hips);
    const pelvis = new THREE.SphereGeometry(1, 12, 9);
    pelvis.scale(d.pelvisHalfW, d.pelvisHalfH, d.pelvisHalfD);
    pelvis.translate(0, 0.01, 0);
    this.part(this.hips, pelvis, 'trousers');

    const thighGeo = this.merged(this.sphereAt(d.thighR0, 0, 0, 0), this.cyl(d.thighR0, d.thighR1, d.thighLen));
    const shinGeo = this.merged(this.sphereAt(d.thighR1 * 1.03, 0, 0, 0), this.cyl(d.shinR0, d.shinR1, d.shinLen));
    const soleGeo = this.box(d.footW, d.footH * 0.3, d.footL);
    soleGeo.translate(0, -d.footH * 0.85, -d.footL * 0.23);
    const upperGeo = this.box(d.footW * 0.92, d.footH * 0.7, d.footL * 0.9);
    upperGeo.translate(0, -d.footH * 0.35, -d.footL * 0.23);

    const mkLeg = (side: -1 | 1) => {
      const hip = G();
      hip.position.set(side * d.hipHalf, 0, 0);
      hip.rotation.order = 'ZXY';
      this.hips.add(hip);
      this.part(hip, thighGeo, 'trousers');
      const knee = G();
      knee.position.y = -d.thighLen;
      hip.add(knee);
      this.part(knee, shinGeo, 'shin');
      const foot = G();
      foot.position.y = -d.shinLen;
      knee.add(foot);
      this.part(foot, upperGeo, 'shoe');
      this.part(foot, soleGeo, 'sole');
      return { hip, knee, foot };
    };
    const legL = mkLeg(-1);
    const legR = mkLeg(1);
    this.hipL = legL.hip; this.kneeL = legL.knee; this.footL = legL.foot;
    this.hipR = legR.hip; this.kneeR = legR.knee; this.footR = legR.foot;

    // --- torso ------------------------------------------------------------------
    this.spine = G();
    this.spine.position.y = d.spinePivotY - d.hipY;
    this.hips.add(this.spine);
    const top = d.shoulderY + 0.02 - d.spinePivotY;
    this.torsoTop = top;
    const bottom = -d.chestR * 0.9;
    const mid = Math.max(0.01, top - bottom - 2 * d.chestR);
    const torso = this.reg(new THREE.CapsuleGeometry(d.chestR, mid, 4, 14));
    torso.translate(0, (top + bottom) / 2, 0);
    this.torsoMesh = this.part(this.spine, torso, 'top');
    this.torsoZScale = d.chestDepth / (2 * d.chestR);
    this.torsoMesh.scale.z = this.torsoZScale;
    this.chestAnchor.position.set(0, top - 0.16, 0);
    this.spine.add(this.chestAnchor);

    const shoulderJointY = top - 0.02 - d.shoulderDrop;
    // shoulder girdle: a horizontal capsule joining the deltoids through the upper chest/trapezius
    this.yokeY = shoulderJointY + 0.006;
    const yoke = this.reg(new THREE.CapsuleGeometry(d.deltR * 1.05, 2 * d.shoulderHalf - 0.02, 4, 12));
    yoke.rotateZ(Math.PI / 2);
    yoke.scale(1, 1, 1.3);
    yoke.translate(0, this.yokeY, 0);
    this.part(this.spine, yoke, 'top');

    // --- arms -------------------------------------------------------------------
    const midR = (d.upperR0 + d.upperR1) / 2;
    let upperGeoArm: THREE.BufferGeometry;
    let upperSkinGeo: THREE.BufferGeometry | null = null;
    if (this.spec.sleeves === 'short') {
      const sleeveLen = d.upperArmLen * 0.5;
      upperGeoArm = this.merged(this.sphereAt(d.deltR, 0, 0.005, 0), this.cyl(d.upperR0, midR * 1.05, sleeveLen));
      upperSkinGeo = this.reg(this.cyl(midR, d.upperR1, d.upperArmLen - sleeveLen + 0.01, -sleeveLen + 0.01));
    } else {
      upperGeoArm = this.merged(this.sphereAt(d.deltR, 0, 0.005, 0), this.cyl(d.upperR0, d.upperR1, d.upperArmLen));
    }
    const foreGeo = this.merged(this.sphereAt(d.upperR1 * 1.05, 0, 0, 0), this.cyl(d.foreR0, d.foreR1, d.forearmLen));
    const handGeo = this.box(d.handT, d.handL, d.handW);
    handGeo.translate(0, -d.handL / 2, 0);

    const mkArm = (side: -1 | 1) => {
      const sh = G();
      sh.position.set(side * d.shoulderHalf, shoulderJointY, 0);
      sh.rotation.order = 'ZXY';
      this.spine.add(sh);
      this.part(sh, upperGeoArm, 'sleeve');
      if (upperSkinGeo) this.part(sh, upperSkinGeo, 'forearm');
      const el = G();
      el.position.y = -d.upperArmLen;
      sh.add(el);
      this.part(el, foreGeo, 'forearm');
      const hand = G();
      hand.position.y = -d.forearmLen;
      el.add(hand);
      this.part(hand, handGeo, 'skin');
      return { sh, el, hand };
    };
    const armL = mkArm(-1);
    const armR = mkArm(1);
    this.shL = armL.sh; this.elL = armL.el; this.handL = armL.hand;
    this.shR = armR.sh; this.elR = armR.el; this.handR = armR.hand;

    // --- neck + head --------------------------------------------------------------
    this.neck = G();
    this.neck.position.y = top;
    this.spine.add(this.neck);
    const neckGeo = this.cyl(d.neckR * 0.95, d.neckR * 1.15, d.neckLen + 0.03, d.neckLen + 0.005);
    this.part(this.neck, neckGeo, 'skin');

    this.head = G();
    this.head.position.y = d.neckLen + 0.01;
    this.head.rotation.order = 'YXZ';
    this.neck.add(this.head);
    // one sculpted, painted surface (see Figure.head.ts); its neck stub sits just inside the neck
    const scale = d.headR / HEAD_R_REF;
    const hairLine = this.spec.hair ? this.rng.next() : 0.5;
    const stubR = (d.neckR * 0.95 - 0.001) / scale;
    const paint = this.face === 'blank' ? null : {
      skin: this.spec.mats.skin.color,
      hair: this.hairColor,
      style: this.hairColor === null ? null : pickHairStyle(this.rng.fork('hair'), this.outfit, hairLine, this.face),
    };
    this.part(this.head, this.reg(headGeometry(this.face, scale, Math.min(0.051, stubR), paint)), paint ? 'head' : 'skin');
  }

  // ---------------------------------------------------------------------------
  // Outfit details
  // ---------------------------------------------------------------------------

  private buildDetails(): void {
    const d = this.dims;
    const sp = this.spine;
    const top = this.torsoTop;
    const shoulderJointY = top - 0.02 - d.shoulderDrop;
    const frontAt = (y: number, thickness: number): number => -(this.torsoDepthAt(y) + thickness / 2 - 0.002);

    for (const det of this.spec.details) {
      switch (det) {
        case 'vneck_skin':
        case 'vneck_collar': {
          // a slanted triangle following the chest from the neckline down
          const w = 0.085, h = 0.12, y0 = top - 0.02;
          const zTop = -(this.torsoDepthAt(y0) + 0.003);
          const zBot = -(this.torsoDepthAt(y0 - h) + 0.003);
          const g = this.reg(new THREE.BufferGeometry());
          g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, y0, zTop, w / 2, y0, zTop, 0, y0 - h, zBot], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
          g.setIndex([0, 1, 2]);
          g.computeVertexNormals();
          this.part(sp, g, det === 'vneck_skin' ? 'skin' : 'collar', false);
          break;
        }
        case 'collar_ring': {
          // sits on the shoulder-girdle ridge, standing off the neck like a real collar
          const g = new THREE.CylinderGeometry(d.neckR * 1.45, d.neckR * 1.7, 0.035, 14, 1, true);
          g.translate(0, top + 0.035, 0);
          this.part(sp, g, 'collar', false);
          break;
        }
        case 'lanyard': {
          const len = 0.34;
          for (const side of [-1, 1] as const) {
            const g = this.box(0.014, len, 0.005);
            g.translate(0, -len / 2, 0);
            const m = this.part(sp, g, 'lanyard', false);
            m.position.set(side * 0.075, top - 0.03, -(this.torsoDepthAt(top - 0.03) + 0.004));
            m.rotation.z = -side * 0.21;
            m.rotation.x = -0.16;
          }
          const by = top - 0.03 - 0.33;
          const badge = this.box(0.056, 0.086, 0.004);
          badge.translate(0, by - 0.045, frontAt(by - 0.045, 0.004) - 0.002);
          this.part(sp, badge, 'badge', false);
          const clip = this.box(0.02, 0.012, 0.006);
          clip.translate(0, by + 0.004, frontAt(by, 0.006) - 0.002);
          this.part(sp, clip, 'belt', false);
          break;
        }
        case 'pocket_l':
        case 'pocket_r': {
          const side = det === 'pocket_l' ? -1 : 1;
          const y = top - 0.23;
          const g = this.box(0.1, 0.11, 0.006);
          g.translate(side * 0.085, y, frontAt(y, 0.006));
          this.part(sp, g, 'accent', false);
          break;
        }
        case 'pockets_coat': {
          for (const side of [-1, 1] as const) {
            const g = this.box(0.12, 0.13, 0.008);
            g.translate(side * 0.1, -0.08, -(d.pelvisHalfD * 1.25 + 0.006));
            this.part(this.hips, g, 'accent', false);
          }
          break;
        }
        case 'belt': {
          const g = new THREE.CylinderGeometry(1, 1, 0.04, 14, 1, true);
          const m = this.part(this.hips, g, 'belt', false);
          m.scale.set(d.pelvisHalfW * 1.04, 1, d.pelvisHalfD * 1.1);
          m.position.y = d.pelvisHalfH * 0.75;
          const buckle = this.box(0.04, 0.03, 0.01);
          buckle.translate(0, d.pelvisHalfH * 0.75, -(d.pelvisHalfD * 1.1 + 0.004));
          this.part(this.hips, buckle, 'metal', false);
          break;
        }
        case 'utility': {
          for (const side of [-1, 1] as const) {
            const g = this.box(0.09, 0.11, 0.05);
            g.translate(side * (d.pelvisHalfW * 0.95 + 0.012), -0.01, 0.03);
            this.part(this.hips, g, 'belt', false);
          }
          break;
        }
        case 'keyring': {
          const x = d.pelvisHalfW + 0.014, y = -0.03, z = -0.03;
          const ring = this.reg(new THREE.TorusGeometry(0.03, 0.004, 6, 14));
          ring.rotateY(Math.PI / 2);
          ring.translate(x, y, z);
          this.part(this.hips, ring, 'metal', false);
          for (let k = 0; k < 3; k++) {
            const key = this.box(0.012, 0.045, 0.002);
            key.rotateX(this.rng.range(-0.25, 0.25));
            key.translate(x + 0.004 + k * 0.003, y - 0.045, z + (k - 1) * 0.007);
            this.part(this.hips, key, 'metal', false);
          }
          break;
        }
        case 'radio': {
          const y = top - 0.1;
          const z = frontAt(y, 0.045) + 0.004;
          const body = this.box(0.034, 0.085, 0.045);
          body.translate(-0.095, y, z);
          this.part(sp, body, 'radio', false);
          const antenna = new THREE.CylinderGeometry(0.003, 0.003, 0.09, 6, 1);
          antenna.translate(-0.095 - 0.01, y + 0.0425 + 0.045, z + 0.01);
          this.part(sp, antenna, 'radio', false);
          break;
        }
        case 'epaulettes': {
          for (const side of [-1, 1] as const) {
            const g = this.box(0.095, 0.01, 0.05);
            g.translate(side * (d.shoulderHalf + 0.005), shoulderJointY + 0.06, 0);
            this.part(sp, g, 'accent', false);
          }
          break;
        }
        case 'stripes': {
          const band = new THREE.CylinderGeometry(1, 1, 0.045, 14, 1, true);
          const bm = this.part(sp, band, 'stripe', false);
          bm.scale.set(d.chestR * 1.03, 1, (d.chestDepth / 2) * 1.06);
          bm.position.y = top - 0.21;
          for (const el of [this.elL, this.elR]) {
            const cuff = new THREE.CylinderGeometry(d.foreR1 * 1.18, d.foreR1 * 1.12, 0.035, 10, 1, true);
            cuff.translate(0, -d.forearmLen + 0.03, 0);
            this.part(el, cuff, 'stripe', false);
          }
          for (const knee of [this.kneeL, this.kneeR]) {
            const ankle = new THREE.CylinderGeometry(d.shinR1 * 1.22, d.shinR1 * 1.28, 0.04, 10, 1, true);
            ankle.translate(0, -d.shinLen + 0.07, 0);
            this.part(knee, ankle, 'stripe', false);
          }
          break;
        }
        case 'coat_skirt': {
          const g = new THREE.CylinderGeometry(1, 1.12, 0.34, 14, 1, true);
          const m = this.part(this.hips, g, 'coat', true);
          m.scale.set(d.pelvisHalfW * 1.1, 1, d.pelvisHalfD * 1.25);
          m.position.y = d.pelvisHalfH * 0.6 - 0.17;
          break;
        }
        case 'button_band': {
          const y = top - 0.3;
          const g = this.box(0.03, 0.4, 0.006);
          g.translate(0, y, frontAt(y, 0.006));
          this.part(sp, g, 'accent', false);
          break;
        }
        case 'hood': {
          const g = new THREE.SphereGeometry(d.headR * 0.78, 10, 6, 0, TAU, 0, Math.PI * 0.5);
          g.scale(1, 0.5, 1);
          g.rotateX(0.9);
          g.translate(0, top - 0.03, 0.07);
          this.part(sp, g, 'top', false);
          break;
        }
        case 'gown_tie': {
          for (const side of [-1, 1] as const) {
            const g = this.box(0.018, 0.2, 0.004);
            g.translate(0, -0.1, 0);
            const m = this.part(sp, g, 'collar', false);
            m.position.set(side * 0.014, top - 0.04, this.torsoDepthAt(top - 0.04) + 0.004);
            m.rotation.z = side * 0.15;
            m.rotation.x = 0.25;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hand props (phone, mop) — shown only while their animation is active
  // ---------------------------------------------------------------------------

  private buildProps(): void {
    const d = this.dims;
    this.phoneGroup = new THREE.Group();
    this.phoneGroup.position.set(0, -d.handL * 0.6, -0.012);
    this.handR.add(this.phoneGroup);
    const body = this.box(0.07, 0.146, 0.008);
    this.part(this.phoneGroup, body, 'phoneBody', false);
    const screen = this.reg(new THREE.PlaneGeometry(0.062, 0.134));
    screen.translate(0, 0, 0.0045);
    this.part(this.phoneGroup, screen, 'phoneScreen', false);
    this.phoneGroup.visible = false;

    this.mopGroup = new THREE.Group();
    this.rig.add(this.mopGroup);
    const handle = this.reg(new THREE.CylinderGeometry(0.012, 0.014, 1, 8, 1));
    handle.rotateX(Math.PI / 2); // runs along +z, from 0 to 1 (scaled to the handle length)
    handle.translate(0, 0, 0.5);
    this.mopHandle = this.part(this.mopGroup, handle, 'mopHandle');
    this.mopHead = new THREE.Group();
    this.mopGroup.add(this.mopHead);
    const headBox = this.box(0.34, 0.03, 0.11);
    headBox.translate(0, 0.03, 0);
    this.part(this.mopHead, headBox, 'mopHead');
    const strings = this.box(0.36, 0.035, 0.14);
    strings.translate(0, 0.015, -0.01);
    this.part(this.mopHead, strings, 'mopStrings', false);
    this.mopGroup.visible = false;
  }

  // ---------------------------------------------------------------------------
  // Pose application
  // ---------------------------------------------------------------------------

  private applyPose(p: Float32Array): void {
    const d = this.dims;
    this.hips.position.set(p[CH.rootX], d.hipY + p[CH.rootY], p[CH.rootZ]);
    this.hips.rotation.set(0, p[CH.rootYaw], p[CH.rootRoll]);
    this.spine.rotation.set(p[CH.spinePitch], p[CH.spineYaw], p[CH.spineRoll]);
    this.head.rotation.set(p[CH.headPitch], p[CH.headYaw], p[CH.headRoll]);
    this.shL.rotation.set(p[CH.shLPitch], p[CH.shLTwist], p[CH.shLRoll]);
    this.shR.rotation.set(p[CH.shRPitch], p[CH.shRTwist], p[CH.shRRoll]);
    this.elL.rotation.x = p[CH.elbowL];
    this.elR.rotation.x = p[CH.elbowR];
    this.handL.rotation.x = p[CH.wristL];
    this.handR.rotation.x = p[CH.wristR];
    this.hipL.rotation.set(p[CH.hipLPitch], 0, p[CH.hipLRoll]);
    this.hipR.rotation.set(p[CH.hipRPitch], 0, p[CH.hipRRoll]);
    this.kneeL.rotation.x = p[CH.kneeL];
    this.kneeR.rotation.x = p[CH.kneeR];
    this.footL.rotation.x = p[CH.footL];
    this.footR.rotation.x = p[CH.footR];

    const b = p[CH.breath];
    this.torsoMesh.scale.set(1 + 0.025 * b, 1 + 0.004 * b, this.torsoZScale * (1 + 0.03 * b));

    const lie = p[CH.lie];
    if (lie > 0.0005) {
      this.rig.quaternion.slerpQuaternions(Q_IDENTITY, Q_LIE, lie);
      this.rig.position.set(0, this.lieY * lie, this.lieZ * lie);
    } else {
      this.rig.quaternion.identity();
      this.rig.position.set(0, 0, 0);
    }
    this.rig.scale.y = p[CH.scaleY];

    // mop: handle from above the upper hand down to the floor, head lying flat
    const mop = p[CH.mop];
    this.mopGroup.visible = mop > 0.01;
    if (mop <= 0.01) {
      // parked inside the pelvis so hidden props never affect bounds
      this.mopGroup.position.set(0, d.hipY, 0);
      this.mopGroup.quaternion.identity();
      this.mopHandle.scale.setScalar(0.001);
      this.mopHead.position.z = 0;
      this.mopHead.scale.setScalar(0.001);
    } else {
      const m = this.driver.mop;
      tmpV.set(m.floorX - m.topX, m.floorY - m.topY, m.floorZ - m.topZ);
      const len = tmpV.length() || 1;
      tmpV.divideScalar(len);
      this.mopGroup.position.set(m.topX, m.topY, m.topZ);
      this.mopGroup.quaternion.setFromUnitVectors(Z_AXIS, tmpV);
      this.mopHandle.scale.set(mop, mop, len);
      this.mopHead.position.z = len;
      this.mopHead.scale.setScalar(mop);
      tmpQ.setFromAxisAngle(Y_AXIS, Math.atan2(-tmpV.x, -tmpV.z));
      this.mopHead.quaternion.copy(this.mopGroup.quaternion).invert().multiply(tmpQ);
    }

    // phone: held in the right hand, screen turned toward the face
    const ph = p[CH.phone];
    this.phoneGroup.visible = ph > 0.01;
    if (ph <= 0.01) {
      this.phoneGroup.scale.setScalar(0.001);
    } else {
      this.phoneGroup.scale.setScalar(ph);
      this.object.updateWorldMatrix(true, true);
      const s = d.headR / HEAD_R_REF;
      tmpV.set(FACE_POINT[0] * s, FACE_POINT[1] * s, FACE_POINT[2] * s);
      this.head.localToWorld(tmpV);
      this.phoneGroup.lookAt(tmpV);
    }
    this.updateGlow(ph);
  }
}
