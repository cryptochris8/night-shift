/**
 * Transient floor decals: wet footprints that alternate left/right along a path, puddles, scuffs
 * and drag marks. Alpha-blended planes 2 mm above the floor that fade in, optionally fade out
 * after `fadeAfter` seconds, and report wetness for footstep audio.
 */
import * as THREE from 'three';
import type { RNG } from '../core/rng';
import type { Vec2 } from '../core/types';

type Tex = typeof import('../render/textures');

export type DecalKind = 'footprints' | 'puddle' | 'scuff' | 'drag';

interface DecalEntry {
  meshes: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  clones: THREE.Texture[];
  extraMats: THREE.Material[];
  age: number;
  fadeAfter: number | null;
  baseOpacity: number;
  wet: boolean;
  /** world footprint for wetness checks */
  spots: { x: number; z: number; r: number }[];
  removed: boolean;
}

const FADE_IN = 0.6;
const FADE_OUT = 3.5;
const BASE_Y = 0.002;

export class DecalLayer {
  readonly group = new THREE.Group();
  private entries = new Set<DecalEntry>();
  private order = 0;

  constructor(private readonly tex: Tex, private readonly rng: RNG) {
    this.group.name = 'decals';
  }

  private texture(kind: 'footprint' | 'puddle' | 'scuff' | 'drag'): THREE.Texture | null {
    try {
      return this.tex.decalTexture(kind);
    } catch (err) {
      console.warn('[decals] texture failed', err);
      return null;
    }
  }

  private material(map: THREE.Texture | null, color: number, roughness: number, metalness: number, opacity: number): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    if (map) m.map = map;
    else m.opacity = opacity * 0.6;
    m.userData.baseOpacity = opacity;
    return m;
  }

  private plane(w: number, l: number, x: number, z: number, yaw: number, mirror: boolean, material: THREE.Material): THREE.Mesh {
    const g = new THREE.PlaneGeometry(w, l);
    const mesh = new THREE.Mesh(g, material);
    // 'YXZ': lay flat first (−90° about X) then face the travel direction (yaw about world Y)
    mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, yaw, 0, 'YXZ'));
    mesh.position.set(x, BASE_Y + (this.order++ % 7) * 0.0004, z);
    if (mirror) mesh.scale.x = -1;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    mesh.frustumCulled = true;
    return mesh;
  }

  add(kind: DecalKind, points: Vec2[], opts: { fadeAfter?: number; room?: string } = {}): () => void {
    if (points.length === 0) return () => undefined;
    const entry: DecalEntry = {
      meshes: [],
      material: null as unknown as THREE.MeshStandardMaterial,
      clones: [],
      extraMats: [],
      age: 0,
      fadeAfter: opts.fadeAfter ?? null,
      baseOpacity: 1,
      wet: kind === 'footprints' || kind === 'puddle',
      spots: [],
      removed: false,
    };
    const holder = new THREE.Group();
    holder.name = `decal:${kind}`;
    if (opts.room) holder.userData.room = opts.room;

    switch (kind) {
      case 'footprints': {
        entry.material = this.material(this.texture('footprint'), 0x4e565a, 0.12, 0.05, 0.85);
        const stride = 0.62;
        const total = pathLength(points);
        const count = Math.max(1, Math.floor((total - 0.2) / stride) + 1);
        for (let i = 0; i < count; i++) {
          const s = Math.min(total, 0.25 + i * stride);
          const { x, z, dx, dz } = pointAt(points, s);
          const side = i % 2 === 0 ? -1 : 1;
          const px = x + -dz * 0.11 * side;
          const pz = z + dx * 0.11 * side;
          const yaw = Math.atan2(-dx, -dz) + this.rng.range(-0.08, 0.08);
          const mesh = this.plane(0.11, 0.27, px, pz, yaw, side > 0, entry.material);
          holder.add(mesh);
          entry.meshes.push(mesh);
          entry.spots.push({ x: px, z: pz, r: 0.2 });
        }
        break;
      }
      case 'puddle': {
        entry.material = this.material(this.texture('puddle'), 0x262c30, 0.04, 0.1, 0.85);
        for (const p of points) {
          const size = this.rng.range(0.9, 1.5);
          const mesh = this.plane(size, size * this.rng.range(0.7, 1.0), p.x, p.z, this.rng.range(0, Math.PI * 2), false, entry.material);
          holder.add(mesh);
          entry.meshes.push(mesh);
          entry.spots.push({ x: p.x, z: p.z, r: size * 0.45 });
        }
        break;
      }
      case 'scuff': {
        entry.material = this.material(this.texture('scuff'), 0x1a1a1a, 0.9, 0, 0.55);
        if (points.length === 1) {
          const p = points[0];
          const mesh = this.plane(0.25, 0.6, p.x, p.z, this.rng.range(0, Math.PI * 2), false, entry.material);
          holder.add(mesh);
          entry.meshes.push(mesh);
        } else {
          const total = pathLength(points);
          for (let s = 0.2; s < total; s += 0.5) {
            const { x, z, dx, dz } = pointAt(points, s);
            const jitter = this.rng.range(-0.1, 0.1);
            const mesh = this.plane(0.25, 0.6, x - dz * jitter, z + dx * jitter, Math.atan2(-dx, -dz) + this.rng.range(-0.3, 0.3), false, entry.material);
            holder.add(mesh);
            entry.meshes.push(mesh);
          }
        }
        break;
      }
      case 'drag': {
        const base = this.texture('drag');
        entry.material = this.material(base, 0x2b2a28, 0.8, 0, 0.8);
        for (let i = 0; i + 1 < Math.max(2, points.length); i++) {
          const a = points[i];
          const b = points[Math.min(points.length - 1, i + 1)];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const len = Math.hypot(dx, dz);
          if (len < 0.05) continue;
          let mat = entry.material;
          if (base) {
            // per-segment clone so the streak texture repeats along the length (shares the GPU source)
            const clone = base.clone();
            clone.repeat.set(1, Math.max(1, len / 0.9));
            clone.wrapS = THREE.RepeatWrapping;
            clone.wrapT = THREE.RepeatWrapping;
            clone.needsUpdate = true;
            entry.clones.push(clone);
            mat = entry.material.clone();
            mat.map = clone;
            mat.opacity = 0;
            mat.userData.baseOpacity = entry.material.userData.baseOpacity;
            entry.extraMats.push(mat);
          }
          const mesh = this.plane(0.38, len, (a.x + b.x) / 2, (a.z + b.z) / 2, Math.atan2(-dx, -dz), false, mat);
          holder.add(mesh);
          entry.meshes.push(mesh);
        }
        break;
      }
    }
    entry.baseOpacity = entry.material.userData.baseOpacity as number;
    if (opts.room) for (const m of entry.meshes) m.userData.room = opts.room;
    this.group.add(holder);
    this.entries.add(entry);
    this.applyOpacity(entry, 0);
    return () => this.remove(entry);
  }

  private applyOpacity(entry: DecalEntry, k: number): void {
    const o = entry.baseOpacity * k;
    entry.material.opacity = entry.material.map ? o : o * 0.6;
    for (const m of entry.meshes) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat !== entry.material) mat.opacity = mat.map ? o : o * 0.6;
    }
  }

  private remove(entry: DecalEntry): void {
    if (entry.removed) return;
    entry.removed = true;
    this.entries.delete(entry);
    const holder = entry.meshes[0]?.parent;
    for (const m of entry.meshes) {
      m.geometry.dispose();
      m.parent?.remove(m);
    }
    if (holder) holder.removeFromParent();
    entry.material.dispose();
    for (const m of entry.extraMats) m.dispose();
    for (const c of entry.clones) c.dispose();
    entry.meshes = [];
    entry.extraMats = [];
    entry.clones = [];
  }

  /** True when `p` stands on a wet decal (footstep_wet). */
  wetAt(p: Vec2): boolean {
    for (const e of this.entries) {
      if (!e.wet) continue;
      for (const s of e.spots) {
        const dx = s.x - p.x;
        const dz = s.z - p.z;
        if (dx * dx + dz * dz <= s.r * s.r) return true;
      }
    }
    return false;
  }

  update(dt: number): void {
    for (const e of Array.from(this.entries)) {
      e.age += dt;
      let k = Math.min(1, e.age / FADE_IN);
      if (e.fadeAfter !== null && e.age > e.fadeAfter) {
        const f = (e.age - e.fadeAfter) / FADE_OUT;
        if (f >= 1) {
          this.remove(e);
          continue;
        }
        k *= 1 - f;
      }
      this.applyOpacity(e, k);
    }
  }

  clear(): void {
    for (const e of Array.from(this.entries)) this.remove(e);
  }

  dispose(): void {
    this.clear();
    this.group.removeFromParent();
  }
}

function pathLength(points: Vec2[]): number {
  let t = 0;
  for (let i = 0; i + 1 < points.length; i++) t += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
  return t;
}

/** Point and unit direction at arc length `s` along a polyline (single point → facing −z). */
function pointAt(points: Vec2[], s: number): { x: number; z: number; dx: number; dz: number } {
  if (points.length === 1) return { x: points[0].x, z: points[0].z, dx: 0, dz: -1 };
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    if (s <= acc + len || i + 2 === points.length) {
      const t = Math.max(0, Math.min(1, (s - acc) / len));
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
    }
    acc += len;
  }
  const last = points[points.length - 1];
  return { x: last.x, z: last.z, dx: 0, dz: -1 };
}
