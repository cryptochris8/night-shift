/**
 * Geometry helpers for the world builder: quads with world-space UVs, boxes, tubes,
 * wall splitting around openings and a per-material merge batch (BufferGeometryUtils).
 * All geometry produced here is indexed with position/normal/uv so it can be merged.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Side } from '../core/types';

export type V3 = readonly [number, number, number];
export type UV = readonly [number, number];

/**
 * Indexed quad from four corners given in loop order. The winding is corrected so the
 * triangles face `normal`, which keeps callers from reasoning about CCW per orientation.
 */
export function quad(a: V3, b: V3, c: V3, d: V3, normal: V3, uvs: readonly UV[]): THREE.BufferGeometry {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const flip = nx * normal[0] + ny * normal[1] + nz * normal[2] < 0;
  const corners = flip ? [a, d, c, b] : [a, b, c, d];
  const uv = flip ? [uvs[0], uvs[3], uvs[2], uvs[1]] : [uvs[0], uvs[1], uvs[2], uvs[3]];
  const pos = new Float32Array(12);
  const nrm = new Float32Array(12);
  const uvA = new Float32Array(8);
  for (let i = 0; i < 4; i++) {
    pos[i * 3] = corners[i][0];
    pos[i * 3 + 1] = corners[i][1];
    pos[i * 3 + 2] = corners[i][2];
    nrm[i * 3] = normal[0];
    nrm[i * 3 + 1] = normal[1];
    nrm[i * 3 + 2] = normal[2];
    uvA[i * 2] = uv[i][0];
    uvA[i * 2 + 1] = uv[i][1];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvA, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Vertical wall rectangle for a room side. `k` is the plane coordinate (z for n/s, x for e/w),
 * `u0..u1` the span along the wall axis, `y0..y1` the height range. Normals face INTO the room
 * that owns the side. UVs are world metres divided by `su`/`sv`.
 */
export function wallQuad(side: Side, u0: number, u1: number, y0: number, y1: number, k: number, su: number, sv: number): THREE.BufferGeometry {
  const uvs: UV[] = [
    [u0 / su, y0 / sv],
    [u1 / su, y0 / sv],
    [u1 / su, y1 / sv],
    [u0 / su, y1 / sv],
  ];
  switch (side) {
    case 'n':
      return quad([u0, y0, k], [u1, y0, k], [u1, y1, k], [u0, y1, k], [0, 0, -1], uvs);
    case 's':
      return quad([u0, y0, k], [u1, y0, k], [u1, y1, k], [u0, y1, k], [0, 0, 1], uvs);
    case 'e':
      return quad([k, y0, u0], [k, y0, u1], [k, y1, u1], [k, y1, u0], [-1, 0, 0], uvs);
    case 'w':
    default:
      return quad([k, y0, u0], [k, y0, u1], [k, y1, u1], [k, y1, u0], [1, 0, 0], uvs);
  }
}

/** Horizontal rectangle (floor when `up`, ceiling otherwise) with world-metre UVs. */
export function hQuad(x0: number, x1: number, z0: number, z1: number, y: number, up: boolean, sx: number, sz: number): THREE.BufferGeometry {
  const uvs: UV[] = [
    [x0 / sx, z0 / sz],
    [x1 / sx, z0 / sz],
    [x1 / sx, z1 / sz],
    [x0 / sx, z1 / sz],
  ];
  return quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, up ? 1 : -1, 0], uvs);
}

/** Axis-aligned box from min/max corners; UVs in world metres / `s` so textures tile continuously. */
export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, s = 1): THREE.BufferGeometry {
  const faces = [
    quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], [[z0 / s, y0 / s], [z1 / s, y0 / s], [z1 / s, y1 / s], [z0 / s, y1 / s]]),
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 / s, y0 / s], [z1 / s, y0 / s], [z1 / s, y1 / s], [z0 / s, y1 / s]]),
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], [[x0 / s, z0 / s], [x1 / s, z0 / s], [x1 / s, z1 / s], [x0 / s, z1 / s]]),
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[x0 / s, z0 / s], [x1 / s, z0 / s], [x1 / s, z1 / s], [x0 / s, z1 / s]]),
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 / s, y0 / s], [x1 / s, y0 / s], [x1 / s, y1 / s], [x0 / s, y1 / s]]),
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], [[x0 / s, y0 / s], [x1 / s, y0 / s], [x1 / s, y1 / s], [x0 / s, y1 / s]]),
  ];
  const merged = mergeGeometries(faces, false) ?? faces[0].clone();
  for (const f of faces) f.dispose();
  return merged;
}

/** Centred box (w × h × d) translated to (cx, cy, cz). */
export function boxAt(cx: number, cy: number, cz: number, w: number, h: number, d: number, s = 1): THREE.BufferGeometry {
  return box(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, s);
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** Cylinder between two points (rails, posts, pipes). */
export function tube(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, segments = 8): THREE.BufferGeometry {
  _a.set(ax, ay, az);
  _b.set(bx, by, bz);
  _dir.subVectors(_b, _a);
  const len = _dir.length();
  const g = new THREE.CylinderGeometry(r, r, Math.max(len, 1e-4), segments, 1, false);
  _q.setFromUnitVectors(_up, _dir.normalize());
  g.applyQuaternion(_q);
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return g;
}

/** Translate/rotate a geometry in place and return it (chaining helper). */
export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

export interface Hole { u0: number; u1: number; y0: number; y1: number }
export interface WallRect { u0: number; u1: number; y0: number; y1: number }

/**
 * Split a wall span [u0,u1] × [0,h] around rectangular holes. Returns the solid rectangles:
 * full-height pieces between holes, plus the pieces above/below each hole.
 */
export function splitWall(u0: number, u1: number, h: number, holes: readonly Hole[]): WallRect[] {
  const out: WallRect[] = [];
  const sorted = holes
    .map((o) => ({ u0: Math.max(u0, o.u0), u1: Math.min(u1, o.u1), y0: Math.max(0, o.y0), y1: Math.min(h, o.y1) }))
    .filter((o) => o.u1 - o.u0 > 1e-3 && o.y1 - o.y0 > 1e-3)
    .sort((p, q) => p.u0 - q.u0);
  let cursor = u0;
  for (const o of sorted) {
    if (o.u1 <= cursor + 1e-4) continue;
    const hu0 = Math.max(o.u0, cursor);
    if (hu0 - cursor > 1e-3) out.push({ u0: cursor, u1: hu0, y0: 0, y1: h });
    if (h - o.y1 > 1e-3) out.push({ u0: hu0, u1: o.u1, y0: o.y1, y1: h });
    if (o.y0 > 1e-3) out.push({ u0: hu0, u1: o.u1, y0: 0, y1: o.y0 });
    cursor = o.u1;
  }
  if (u1 - cursor > 1e-3) out.push({ u0: cursor, u1, y0: 0, y1: h });
  return out;
}

export interface FlushOptions {
  receiveShadow?: boolean;
  castShadow?: boolean;
  room?: string;
  namePrefix?: string;
  renderOrder?: number;
}

/** Collects geometry per material key and merges each key into a single mesh. */
export class GeoBatch {
  private lists = new Map<string, THREE.BufferGeometry[]>();

  add(key: string, g: THREE.BufferGeometry | null | undefined): void {
    if (!g) return;
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    list.push(g);
  }

  get size(): number {
    return this.lists.size;
  }

  /** Merge every key into one mesh under `parent`; source geometries are disposed. */
  flush(parent: THREE.Object3D, material: (key: string) => THREE.Material, opts: FlushOptions = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const [key, list] of this.lists) {
      if (list.length === 0) continue;
      const merged = list.length === 1 ? list[0] : (mergeGeometries(list, false) as THREE.BufferGeometry | null);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material(key));
      mesh.name = `${opts.namePrefix ?? ''}${key}`;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.castShadow = opts.castShadow ?? false;
      if (opts.renderOrder !== undefined) mesh.renderOrder = opts.renderOrder;
      if (opts.room) mesh.userData.room = opts.room;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.lists.clear();
    return meshes;
  }
}

/** Smoothstep easing helpers used by door / prop animation. */
export const ease = {
  inOut: (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)),
  out: (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3)),
  in: (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t),
};

/** Dispose a geometry/material tree (textures are owned by the texture cache and are kept). */
export function disposeTree(root: THREE.Object3D, ownedMaterials?: Set<THREE.Material>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && typeof (mesh.geometry as THREE.BufferGeometry).dispose === 'function') {
      (mesh.geometry as THREE.BufferGeometry).dispose();
    }
    const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat];
    for (const m of list) {
      if (ownedMaterials) {
        if (ownedMaterials.has(m)) continue; // kit disposes its own
      }
      m.dispose();
    }
  });
}
