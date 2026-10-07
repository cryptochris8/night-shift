/**
 * Procedural props (CONTRACT §4B) — shared core.
 *
 * WorldBuilder calls `buildProp(def, ctx)` for every layout prop (except call_light / elevator_doors,
 * which it builds itself), then positions the returned object at def.pos / def.rotY / def.scale.
 * Builders therefore build at the LOCAL origin: floor centre of the footprint, +y up, the prop's
 * "front" facing +z unless a builder documents otherwise (rotY in the layout turns it).
 *
 * Builders live in props.clinical.ts and props.infra.ts and receive a PropKit: cached shared
 * materials/geometries, small mesh helpers, screen/glow helpers and per-instance resource
 * tracking. kit.finish() merges every static mesh by material so a prop costs a handful of draw
 * calls instead of dozens.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Services } from '../core/contracts';
import type { PropDef, PropType, Rect, Vec3 } from '../core/types';
import type * as Textures from '../render/textures';
import type { ScreenOpts, SignKind } from '../render/textures';
import { CLINICAL_BUILDERS } from './props.clinical';
import { INFRA_BUILDERS } from './props.infra';

// ---------------------------------------------------------------------------
// Public API (consumed by WorldBuilder)
// ---------------------------------------------------------------------------

export interface PropContext {
  textures: typeof Textures;
  services: Services;
}

export interface PropInstance {
  object: THREE.Object3D;
  def: PropDef;
  /** world-space AABB on the floor if solid (WorldBuilder falls back to footprintToRect) */
  obstacle?: Rect;
  setScreen?(mode: string): void;
  setLit?(on: boolean): void;
  update?(dt: number): void;
  dispose(): void;
}

/** A builder adds meshes to kit.group (local origin = floor centre) and registers behaviour on the kit. */
export type PropBuilder = (k: PropKit) => void;

export function buildProp(def: PropDef, ctx: PropContext): PropInstance {
  const kit = new PropKit(def, ctx);
  const builder = CLINICAL_BUILDERS[def.type] ?? INFRA_BUILDERS[def.type];
  if (builder) {
    builder(kit);
  } else {
    warnOnce(def.type);
    fallbackBuilder(kit);
  }
  return kit.finish();
}

/** Rotate def.footprint (w along local x, d along local z) by rotY and return the world AABB around def.pos. */
export function footprintToRect(def: PropDef): Rect | undefined {
  if (!def.footprint) return undefined;
  const s = def.scale ?? 1;
  const w = def.footprint.w * s;
  const d = def.footprint.d * s;
  const c = Math.abs(Math.cos(def.rotY));
  const sn = Math.abs(Math.sin(def.rotY));
  const hw = (c * w + sn * d) / 2;
  const hd = (sn * w + c * d) / 2;
  return { x0: def.pos.x - hw, x1: def.pos.x + hw, z0: def.pos.z - hd, z1: def.pos.z + hd };
}

/** Drop every cached shared material/geometry (only on full teardown; rebuilds reuse the caches). */
export function disposePropCaches(): void {
  for (const m of MATERIALS.values()) m.dispose();
  for (const g of GEOMETRIES.values()) g.dispose();
  MATERIALS.clear();
  GEOMETRIES.clear();
}

// ---------------------------------------------------------------------------
// Shared caches
// ---------------------------------------------------------------------------

const MATERIALS = new Map<string, THREE.Material>();
const GEOMETRIES = new Map<string, THREE.BufferGeometry>();
const warned = new Set<string>();

function warnOnce(type: PropType): void {
  if (warned.has(type)) return;
  warned.add(type);
  console.warn(`[props] no builder for '${type}', using a neutral block`);
}

function fallbackBuilder(k: PropKit): void {
  const w = k.def.footprint?.w ?? 0.5;
  const d = k.def.footprint?.d ?? 0.5;
  k.rbox(w, 0.9, d, k.std(0x5d5f60, 0.7, 0.1), 0, 0.45, 0, 0.02);
}

export interface MeshOpts {
  /** rotation (radians) */
  rx?: number;
  ry?: number;
  rz?: number;
  /** parent (default kit.group). Meshes not parented directly to kit.group are never merged. */
  parent?: THREE.Object3D;
  /** cast shadows (default: largest dimension > 0.3 m) */
  cast?: boolean;
  receive?: boolean;
  /** keep as its own mesh (animated, swapped material, interactable highlight target) */
  keep?: boolean;
  name?: string;
}

export interface ScreenHandle {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** swap the displayed texture */
  show(kind: string, opts?: ScreenOpts): void;
  /** 0..1 brightness multiplier (dead screens go to ~0.02) */
  setBrightness(b: number): void;
}

const tmpV = new THREE.Vector3();

/**
 * Per-build toolkit. Shared materials/geometries come from module caches and are never disposed
 * per instance; anything created with own() (screen materials, clones, merged geometry) is.
 */
export class PropKit {
  readonly group = new THREE.Group();
  readonly def: PropDef;
  readonly ctx: PropContext;
  /** textures module */
  readonly t: typeof Textures;
  /** services (store, audio, lighting, clock …) */
  readonly s: Services;
  /** def.params (never undefined) */
  readonly p: Record<string, unknown>;
  /** stable per-prop pseudo-random stream in [0,1) (deterministic from the prop id) */
  readonly rand: () => number;

  private owned: { dispose(): void }[] = [];
  private updaters: ((dt: number) => void)[] = [];
  private screenFns: ((mode: string) => void)[] = [];
  private litFns: ((on: boolean) => void)[] = [];
  private glows: { id: string; local: THREE.Vector3; color: number; intensity: number; registered: boolean }[] = [];
  private finished = false;

  constructor(def: PropDef, ctx: PropContext) {
    this.def = def;
    this.ctx = ctx;
    this.t = ctx.textures;
    this.s = ctx.services;
    this.p = (def.params ?? {}) as Record<string, unknown>;
    let h = 2166136261;
    for (let i = 0; i < def.id.length; i++) {
      h ^= def.id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    let state = h >>> 0;
    this.rand = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // --- params --------------------------------------------------------------

  num(key: string, fallback: number): number {
    const v = this.p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  str(key: string, fallback: string): string {
    const v = this.p[key];
    return typeof v === 'string' ? v : fallback;
  }

  bool(key: string, fallback: boolean): boolean {
    const v = this.p[key];
    return typeof v === 'boolean' ? v : fallback;
  }

  // --- materials (shared, cached) ---------------------------------------------

  /** Shared MeshStandardMaterial keyed by its parameters. */
  std(color: number, roughness = 0.6, metalness = 0, extra?: { emissive?: number; emissiveIntensity?: number; transparent?: boolean; opacity?: number; side?: THREE.Side; flatShading?: boolean; depthWrite?: boolean }): THREE.MeshStandardMaterial {
    const key = `std:${color}:${roughness}:${metalness}:${extra ? JSON.stringify(extra) : ''}`;
    let m = MATERIALS.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...(extra ?? {}) });
      if (extra?.emissive !== undefined) m.emissive.setHex(extra.emissive);
      MATERIALS.set(key, m);
    }
    return m;
  }

  /** Shared physical material (glass, glossy plastic). */
  phys(key: string, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
    const k = `phys:${key}`;
    let m = MATERIALS.get(k) as THREE.MeshPhysicalMaterial | undefined;
    if (!m) {
      m = new THREE.MeshPhysicalMaterial(params);
      MATERIALS.set(k, m);
    }
    return m;
  }

  /** Shared self-lit material for LEDs, indicator lamps, light lenses (unaffected by scene lights). */
  glowMat(color: number, intensity = 1): THREE.MeshStandardMaterial {
    return this.std(0x000000, 0.4, 0, { emissive: color, emissiveIntensity: intensity });
  }

  /** Any shared material built once by key (textured materials etc). */
  shared<T extends THREE.Material>(key: string, make: () => T): T {
    let m = MATERIALS.get(key) as T | undefined;
    if (!m) {
      m = make();
      MATERIALS.set(key, m);
    }
    return m;
  }

  /** Track a per-instance resource so it is disposed with the prop. Returns it. */
  own<T extends { dispose(): void }>(x: T): T {
    this.owned.push(x);
    return x;
  }

  /** Shared geometry built once by key. */
  geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = GEOMETRIES.get(key);
    if (!g) {
      g = make();
      GEOMETRIES.set(key, g);
    }
    return g;
  }

  // --- mesh helpers (positions are CENTRES unless stated) ----------------------

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    if (o.rx || o.ry || o.rz) m.rotation.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const big = (geometry.boundingSphere?.radius ?? 0) * 2 > 0.3;
    m.castShadow = o.cast ?? big;
    m.receiveShadow = o.receive ?? true;
    if (o.keep) m.userData.keep = true;
    if (o.name) m.name = o.name;
    (o.parent ?? this.group).add(m);
    return m;
  }

  box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
    const g = this.geo(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
    return this.mesh(g, mat, x, y, z, o);
  }

  /** Box sitting on y (bottom face at y). */
  boxOn(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
    return this.box(w, h, d, mat, x, y + h / 2, z, o);
  }

  /** Rounded box (bevel radius r) — use for anything manufactured; hard boxes read as placeholder. */
  rbox(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0, r = 0.015, o: MeshOpts = {}): THREE.Mesh {
    const rr = Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
    const g = this.geo(`rbox:${r3(w)}:${r3(h)}:${r3(d)}:${r3(rr)}`, () => new RoundedBoxGeometry(w, h, d, 2, rr));
    return this.mesh(g, mat, x, y, z, o);
  }

  /** Cylinder along an axis (default y). */
  cyl(rTop: number, rBottom: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts & { axis?: 'x' | 'y' | 'z'; seg?: number; open?: boolean } = {}): THREE.Mesh {
    const seg = o.seg ?? 14;
    const g = this.geo(`cyl:${r3(rTop)}:${r3(rBottom)}:${r3(h)}:${seg}:${o.open ? 1 : 0}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, o.open ?? false));
    const axisRot = o.axis === 'x' ? { rz: Math.PI / 2 } : o.axis === 'z' ? { rx: Math.PI / 2 } : {};
    return this.mesh(g, mat, x, y, z, { ...axisRot, ...o });
  }

  sphere(r: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts & { seg?: number; sy?: number } = {}): THREE.Mesh {
    const seg = o.seg ?? 12;
    const g = this.geo(`sph:${r3(r)}:${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.75))));
    const m = this.mesh(g, mat, x, y, z, o);
    if (o.sy !== undefined) m.scale.y = o.sy;
    return m;
  }

  torus(r: number, tube: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts & { arc?: number; seg?: number } = {}): THREE.Mesh {
    const seg = o.seg ?? 28;
    const arc = o.arc ?? Math.PI * 2;
    const g = this.geo(`tor:${r3(r)}:${r3(tube)}:${seg}:${r3(arc)}`, () => new THREE.TorusGeometry(r, tube, 8, seg, arc));
    return this.mesh(g, mat, x, y, z, o);
  }

  /** Flat plane (faces +z before rotation). */
  plane(w: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
    const g = this.geo(`pl:${r3(w)}:${r3(h)}`, () => new THREE.PlaneGeometry(w, h));
    return this.mesh(g, mat, x, y, z, { cast: false, ...o });
  }

  /** Tube through points (polyline with small rounded bends). Not cached (unique paths). */
  tube(points: [number, number, number][], radius: number, mat: THREE.Material, o: MeshOpts & { seg?: number; closed?: boolean } = {}): THREE.Mesh {
    const path = new THREE.CurvePath<THREE.Vector3>();
    const v = points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (let i = 0; i < v.length - 1; i++) path.add(new THREE.LineCurve3(v[i], v[i + 1]));
    if (o.closed && v.length > 2) path.add(new THREE.LineCurve3(v[v.length - 1], v[0]));
    const segs = Math.max(2, (v.length - 1) * 4);
    const g = this.own(new THREE.TubeGeometry(path, segs, radius, o.seg ?? 8, false));
    return this.mesh(g, mat, 0, 0, 0, o);
  }

  /** Lathe profile [radius, y][] around +y. */
  lathe(profile: [number, number][], mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts & { seg?: number } = {}): THREE.Mesh {
    const key = `lathe:${profile.map(([a, b]) => `${r3(a)},${r3(b)}`).join(';')}:${o.seg ?? 16}`;
    const g = this.geo(key, () => new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), o.seg ?? 16));
    return this.mesh(g, mat, x, y, z, o);
  }

  /** Extruded 2D shape (shape in the XY plane, extruded along +z by depth). Not cached. */
  extrude(shape: THREE.Shape, depth: number, mat: THREE.Material, x = 0, y = 0, z = 0, o: MeshOpts & { bevel?: number } = {}): THREE.Mesh {
    const bevel = o.bevel ?? 0;
    const g = this.own(
      new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 1,
        curveSegments: 10,
      }),
    );
    return this.mesh(g, mat, x, y, z, o);
  }

  /** Sub-group (for animated assemblies). Meshes inside are never merged. */
  sub(x = 0, y = 0, z = 0, name?: string, parent?: THREE.Object3D): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (name) g.name = name;
    (parent ?? this.group).add(g);
    return g;
  }

  // --- textured surfaces ---------------------------------------------------------

  /** A sign/label plane using textures.signTexture (shared material per text+kind). */
  sign(text: string, kind: SignKind, w: number, h: number, x = 0, y = 0, z = 0, o: MeshOpts & { emissive?: number } = {}): THREE.Mesh {
    const mat = this.shared(`sign:${kind}:${text}:${w}:${h}:${o.emissive ?? 0}`, () => {
      const tex = this.t.signTexture(text, { kind, width: Math.max(64, Math.round(w * 400)), height: Math.max(64, Math.round(h * 400)) });
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05, transparent: true });
      if (o.emissive) {
        m.emissive.setHex(0xffffff);
        m.emissiveMap = tex;
        m.emissiveIntensity = o.emissive;
      }
      return m;
    });
    return this.plane(w, h, mat, x, y, z, o);
  }

  /**
   * An emissive screen plane (faces +z before rotation). Per-instance material (owned).
   * glow → a faint Lighting glow that follows the screen being on/off.
   */
  screen(w: number, h: number, kind: string, x = 0, y = 0, z = 0, o: MeshOpts & { opts?: ScreenOpts; glow?: { color: number; intensity: number } } = {}): ScreenHandle {
    const tex = this.t.screenTexture(kind, o.opts);
    const material = this.own(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    material.color.setScalar(0.85);
    const mesh = this.plane(w, h, material, x, y, z, { keep: true, ...o });
    mesh.userData.noInteractHighlight = true;
    let glowId: string | null = null;
    if (o.glow) {
      glowId = `${this.def.id}:glow:${this.glows.length}`;
      const local = new THREE.Vector3(x, y, z + 0.25);
      this.glows.push({ id: glowId, local, color: o.glow.color, intensity: o.glow.intensity, registered: false });
    }
    const gid = glowId;
    return {
      mesh,
      material,
      show: (k: string, opts?: ScreenOpts) => {
        material.map = this.t.screenTexture(k, opts);
        material.needsUpdate = true;
        if (gid) this.s.lighting.setGlow(gid, k !== 'off' && !opts?.dead);
      },
      setBrightness: (b: number) => {
        material.color.setScalar(Math.max(0, Math.min(1.2, b)));
      },
    };
  }

  /** Register an extra light glow at a local point (registered lazily on the first update, after Lighting.init). */
  glow(localX: number, localY: number, localZ: number, color: number, intensity: number): string {
    const id = `${this.def.id}:glow:${this.glows.length}`;
    this.glows.push({ id, local: new THREE.Vector3(localX, localY, localZ), color, intensity, registered: false });
    return id;
  }

  // --- behaviour ------------------------------------------------------------------

  onUpdate(fn: (dt: number) => void): void {
    this.updaters.push(fn);
  }

  onScreen(fn: (mode: string) => void): void {
    this.screenFns.push(fn);
  }

  onLit(fn: (on: boolean) => void): void {
    this.litFns.push(fn);
  }

  /** World position of a local point (valid after WorldBuilder has placed the object). */
  worldPoint(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  /** Distance from the camera currently being rendered to this prop (metres). */
  cameraDistance(): number {
    const cam = this.s.three.camera;
    this.group.getWorldPosition(tmpV);
    return cam ? cam.position.distanceTo(tmpV) : Infinity;
  }

  /** Current game time formatted for screens (HH:MM:SS). */
  screenTime(): string {
    const t = this.s.store.get().time;
    const total = 22 * 60 + 45 + t;
    const h = Math.floor(total / 60) % 24;
    const m = Math.floor(total % 60);
    const sec = Math.floor((total - Math.floor(total)) * 60);
    return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
  }

  // --- finish -------------------------------------------------------------------------

  finish(): PropInstance {
    if (this.finished) throw new Error('PropKit.finish called twice');
    this.finished = true;
    this.mergeStatic();
    this.group.userData.propId = this.def.id;
    this.group.userData.type = this.def.type;

    const updaters = this.updaters;
    const screenFns = this.screenFns;
    const litFns = this.litFns;
    const glows = this.glows;
    const owned = this.owned;
    const def = this.def;
    const s = this.s;
    const group = this.group;
    const needsUpdate = updaters.length > 0 || glows.length > 0;

    const inst: PropInstance = {
      object: group,
      def,
      dispose: () => {
        for (const o of owned) {
          try {
            o.dispose();
          } catch {
            /* already disposed */
          }
        }
        owned.length = 0;
        for (const g of glows) if (g.registered) s.lighting.setGlow(g.id, false);
        group.removeFromParent();
      },
    };
    if (screenFns.length) inst.setScreen = (mode: string) => screenFns.forEach((f) => f(mode));
    if (litFns.length) inst.setLit = (on: boolean) => litFns.forEach((f) => f(on));
    if (needsUpdate) {
      inst.update = (dt: number) => {
        for (const g of glows) {
          if (g.registered || !group.parent) continue;
          group.updateWorldMatrix(true, false);
          const wp = g.local.clone().applyMatrix4(group.matrixWorld);
          s.lighting.registerGlow(g.id, { x: wp.x, y: wp.y, z: wp.z } as Vec3, g.color, g.intensity, 'always');
          g.registered = true;
        }
        for (const f of updaters) f(dt);
      };
    }
    return inst;
  }

  /**
   * Merge meshes that are direct children of the group, not flagged keep, with a single material,
   * bucketed by material + shadow flags. Geometry is baked into prop-local space.
   */
  private mergeStatic(): void {
    const buckets = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }>();
    for (const child of [...this.group.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      if (child.userData.keep || Array.isArray(child.material) || child.children.length) continue;
      const mat = child.material as THREE.Material;
      const key = `${mat.uuid}:${child.castShadow ? 1 : 0}:${child.receiveShadow ? 1 : 0}`;
      let b = buckets.get(key);
      if (!b) {
        b = { mat, cast: child.castShadow, receive: child.receiveShadow, geos: [], meshes: [] };
        buckets.set(key, b);
      }
      child.updateMatrix();
      let g = child.geometry.clone();
      g.applyMatrix4(child.matrix);
      if (g.index) {
        const ni = g.toNonIndexed();
        g.dispose();
        g = ni;
      }
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      }
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      b.geos.push(g);
      b.meshes.push(child);
    }
    for (const b of buckets.values()) {
      if (b.meshes.length < 2) {
        b.geos.forEach((g) => g.dispose());
        continue;
      }
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      for (const m of b.meshes) {
        this.group.remove(m);
        // tube/extrude geometries were owned per instance and are now baked in
        const ownedIdx = this.owned.indexOf(m.geometry);
        if (ownedIdx >= 0) {
          m.geometry.dispose();
          this.owned.splice(ownedIdx, 1);
        }
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.mat);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = b.receive;
      mesh.name = `${this.def.id}:merged`;
      this.group.add(mesh);
      this.own(merged);
    }
  }
}

function r3(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
