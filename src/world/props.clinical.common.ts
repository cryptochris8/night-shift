/**
 * Shared helpers for the clinical prop builders: palette, primitives the kit lacks (oriented bars,
 * rods, chamfered boxes, casters, star bases), mains-power tracking and runtime-controllable glows.
 * Material keys are shared with the kit cache, so identical parameters reuse one material.
 */
import * as THREE from 'three';
import type { RoomDef, ZoneId } from '../core/types';
import type { MeshOpts, PropKit } from './props';

export type V3 = [number, number, number];

// ---------------------------------------------------------------------------
// Numbers & colour
// ---------------------------------------------------------------------------

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Lighten (f > 0) or darken (f < 0) a hex colour. */
export function shade(hex: number, f: number): number {
  const ch = (v: number): number => clamp(Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)), 0, 255);
  return (ch((hex >> 16) & 255) << 16) | (ch((hex >> 8) & 255) << 8) | ch(hex & 255);
}

/** Per-prop shade variation, quantised so neighbouring props still share cached materials. */
export function vary(k: PropKit, hex: number, amount = 0.05, steps = 2): number {
  const q = Math.round((k.rand() * 2 - 1) * steps) / steps;
  return shade(hex, q * amount);
}

/** Uniform in [a, b) from the prop's deterministic stream. */
export function rr(k: PropKit, a: number, b: number): number {
  return a + (b - a) * k.rand();
}

export function pick<T>(k: PropKit, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(k.rand() * arr.length))];
}

/** Rotate a local point about a pivot by rx (about x) - for tilted sub-assemblies baked into the merge. */
export function tiltX(p: V3, pivot: V3, rx: number): V3 {
  const y = p[1] - pivot[1];
  const z = p[2] - pivot[2];
  const c = Math.cos(rx);
  const s = Math.sin(rx);
  return [p[0], pivot[1] + y * c - z * s, pivot[2] + y * s + z * c];
}

// ---------------------------------------------------------------------------
// Palette (shared cached materials)
// ---------------------------------------------------------------------------

export const mat = {
  stainless: (k: PropKit): THREE.Material => k.std(0xb4b7ba, 0.32, 0.9),
  satin: (k: PropKit): THREE.Material => k.std(0x9a9ea2, 0.4, 0.82),
  chrome: (k: PropKit): THREE.Material => k.std(0xcfd2d4, 0.16, 1),
  darkMetal: (k: PropKit): THREE.Material => k.std(0x2a2b2d, 0.55, 0.6),
  /** powder-coated / painted steel (dielectric paint over metal) */
  painted: (k: PropKit, hex: number, rough = 0.5): THREE.Material => k.std(hex, rough, 0.18),
  rubber: (k: PropKit): THREE.Material => k.std(0x19191b, 0.9, 0),
  black: (k: PropKit): THREE.Material => k.std(0x222426, 0.5, 0),
  /** one near-black for wheels, knobs, gaskets, kick plates and slots - fewer draw calls per prop */
  dark: (k: PropKit): THREE.Material => k.std(0x1e1f21, 0.72, 0),
  plastic: (k: PropKit, hex: number, rough = 0.5): THREE.Material => k.std(hex, rough, 0),
  vinyl: (k: PropKit, hex: number, rough = 0.42): THREE.Material => k.std(hex, rough, 0),
  paper: (k: PropKit): THREE.Material => k.std(0xe0ded5, 0.92, 0),
  linen: (k: PropKit): THREE.Material => k.std(0xd5d7d1, 0.9, 0),
  porcelain: (k: PropKit): THREE.Material => k.std(0xe4e4de, 0.16, 0),
  cardboard: (k: PropKit): THREE.Material => k.std(0xa88a5f, 0.9, 0),
  glass: (k: PropKit): THREE.Material =>
    k.phys('clin:glass', { color: 0xc6d4d2, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
  /** clear flexible plastic (IV bags, sleeves) */
  clearPlastic: (k: PropKit): THREE.Material =>
    k.phys('clin:clearplastic', { color: 0xe4ece8, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false }),
  /** woven upholstery / canvas from the texture factory */
  fabric: (k: PropKit, tint: number, rough = 0.95): THREE.Material =>
    k.shared(`clin:fabric:${tint}:${rough}`, () => new THREE.MeshStandardMaterial({ map: k.t.fabricTexture({ tint }), roughness: rough, metalness: 0 })),
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const f3 = (n: number): string => (Math.round(n * 1000) / 1000).toString();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Box with 45-degree chamfers on all edges: 44 flat-shaded triangles (132 vertices once merged,
 * versus 324-900 for RoundedBoxGeometry). Planar UVs per dominant normal axis.
 */
function chamferBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const H: V3 = [w / 2, h / 2, d / 2];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const tri = (a: V3, b: V3, c: V3, n: V3): void => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const pts = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [a, b, c] : [a, c, b];
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    for (const p of pts) {
      pos.push(p[0], p[1], p[2]);
      nor.push(n[0], n[1], n[2]);
      if (ax >= ay && ax >= az) uv.push(p[2] / d + 0.5, p[1] / h + 0.5);
      else if (ay >= az) uv.push(p[0] / w + 0.5, p[2] / d + 0.5);
      else uv.push(p[0] / w + 0.5, p[1] / h + 0.5);
    }
  };
  const quad = (a: V3, b: V3, c: V3, e: V3, n: V3): void => {
    tri(a, b, c, n);
    tri(a, c, e, n);
  };
  const pt = (ax: number, av: number, bx: number, bv: number, cx: number, cv: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[ax] = av;
    p[bx] = bv;
    p[cx] = cv;
    return p;
  };
  const inner = (i: number): number => H[i] - r;
  const S = [-1, 1];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    for (const sa of S) {
      // main face
      const n: V3 = [0, 0, 0];
      n[a] = sa;
      quad(pt(a, sa * H[a], b, -inner(b), c, -inner(c)), pt(a, sa * H[a], b, inner(b), c, -inner(c)), pt(a, sa * H[a], b, inner(b), c, inner(c)), pt(a, sa * H[a], b, -inner(b), c, inner(c)), n);
      // chamfer strip between face (a, sa) and face (b, sb), running along c
      for (const sb of S) {
        const e: V3 = [0, 0, 0];
        e[a] = sa * Math.SQRT1_2;
        e[b] = sb * Math.SQRT1_2;
        quad(pt(a, sa * H[a], b, sb * inner(b), c, -inner(c)), pt(a, sa * inner(a), b, sb * H[b], c, -inner(c)), pt(a, sa * inner(a), b, sb * H[b], c, inner(c)), pt(a, sa * H[a], b, sb * inner(b), c, inner(c)), e);
      }
    }
  }
  const k3 = 1 / Math.sqrt(3);
  for (const sx of S) {
    for (const sy of S) {
      for (const sz of S) {
        tri([sx * H[0], sy * inner(1), sz * inner(2)], [sx * inner(0), sy * H[1], sz * inner(2)], [sx * inner(0), sy * inner(1), sz * H[2]], [sx * k3, sy * k3, sz * k3]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/**
 * Rounded box with smooth normals: each face is a 4x4 vertex grid with lines at -H, -(H-r), H-r, H,
 * projected onto the fillet - two segments per quarter round, 108 triangles (324 vertices merged,
 * against ~900 for the RoundedBoxGeometry behind kit.rbox).
 */
function softBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const H: V3 = [w / 2, h / 2, d / 2];
  const I: V3 = [H[0] - r, H[1] - r, H[2] - r];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const P: V3[] = [];
  const N: V3[] = [];
  const U: [number, number][] = [];
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3;
    const c = (a + 2) % 3;
    const cb = [-H[b], -I[b], I[b], H[b]];
    const cc = [-H[c], -I[c], I[c], H[c]];
    for (const s of [-1, 1]) {
      P.length = 0;
      N.length = 0;
      U.length = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const p: V3 = [0, 0, 0];
          p[a] = s * H[a];
          p[b] = cb[i];
          p[c] = cc[j];
          const q: V3 = [clamp(p[0], -I[0], I[0]), clamp(p[1], -I[1], I[1]), clamp(p[2], -I[2], I[2])];
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          const dz = p[2] - q[2];
          const len = Math.hypot(dx, dy, dz) || 1;
          const n: V3 = [dx / len, dy / len, dz / len];
          P.push([q[0] + n[0] * r, q[1] + n[1] * r, q[2] + n[2] * r]);
          N.push(n);
          U.push([(p[b] + H[b]) / (2 * H[b]), (p[c] + H[c]) / (2 * H[c])]);
        }
      }
      const put = (k: number): void => {
        pos.push(P[k][0], P[k][1], P[k][2]);
        nor.push(N[k][0], N[k][1], N[k][2]);
        uv.push(U[k][0], U[k][1]);
      };
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const k00 = i * 4 + j;
          const k10 = k00 + 4;
          const k11 = k10 + 1;
          const k01 = k00 + 1;
          if (s > 0) [k00, k10, k11, k00, k11, k01].forEach(put);
          else [k00, k11, k10, k00, k01, k11].forEach(put);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** Soft rounded box (cushions, mattresses, molded shells): same arguments as kit.rbox, a third of the vertices. */
export function soft(k: PropKit, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, r = 0.02, o: MeshOpts = {}): THREE.Mesh {
  const rad = Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = k.geo(`clin:soft:${f3(w)}:${f3(h)}:${f3(d)}:${f3(rad)}`, () => softBox(w, h, d, rad));
  return k.mesh(g, m, x, y, z, o);
}

/**
 * Chamfered box for manufactured parts. Bevels under 5 mm are invisible at play distance, so
 * those parts become plain boxes (36 vertices).
 */
export function bev(k: PropKit, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, r = 0.006, o: MeshOpts = {}): THREE.Mesh {
  const rad = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  if (rad < 0.0045) return k.box(w, h, d, m, x, y, z, o);
  const g = k.geo(`clin:chamf:${f3(w)}:${f3(h)}:${f3(d)}:${f3(rad)}`, () => chamferBox(w, h, d, rad));
  return k.mesh(g, m, x, y, z, o);
}

/** Box of section w x h stretched between two points (long axis = local z). */
export function bar(k: PropKit, a: V3, b: V3, w: number, h: number, m: THREE.Material, o: MeshOpts = {}): THREE.Mesh {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.max(1e-4, Math.hypot(dx, dy, dz));
  const mesh = k.box(w, h, len, m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, o);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.set(-Math.asin(clamp(dy / len, -1, 1)), Math.atan2(dx, dz), 0);
  return mesh;
}

/** Cylinder between two points. */
export function rod(k: PropKit, a: V3, b: V3, r: number, m: THREE.Material, o: MeshOpts & { seg?: number } = {}): THREE.Mesh {
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = Math.max(1e-4, dir.length());
  const mesh = k.cyl(r, r, len, m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, { seg: o.seg ?? 8, ...o });
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

/** Tube along a polyline with radial segments scaled to its thickness (thin cables need few). */
export function line(k: PropKit, pts: V3[], r: number, m: THREE.Material, o: MeshOpts & { closed?: boolean } = {}): THREE.Mesh {
  return k.tube(pts, r, m, { seg: r < 0.006 ? 4 : r < 0.013 ? 6 : 8, ...o });
}

/** Points along a circular arc in the plane spanned by unit axes u, v around centre c. */
export function arcPts(c: V3, u: V3, v: V3, r: number, a0: number, a1: number, n: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const cs = Math.cos(a) * r;
    const sn = Math.sin(a) * r;
    out.push([c[0] + u[0] * cs + v[0] * sn, c[1] + u[1] * cs + v[1] * sn, c[2] + u[2] * cs + v[2] * sn]);
  }
  return out;
}

/** Drooping cable between two points (parabolic sag below the chord). */
export function cablePts(a: V3, b: V3, sag: number, n = 6): V3[] {
  const out: V3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

export interface CasterOpts {
  floor?: number;
  parent?: THREE.Object3D;
  /** wheel width (default r * 0.5) */
  width?: number;
}

/**
 * Swivel caster: mounting plate whose top is at y = top, stem, fork and a wheel resting on the floor.
 * yaw turns the fork - parked equipment has its casters trailing every which way.
 */
export function caster(k: PropKit, x: number, z: number, top: number, r: number, metal: THREE.Material, wheel: THREE.Material, yaw = 0, o: CasterOpts = {}): void {
  const floor = o.floor ?? 0;
  const ww = o.width ?? Math.max(0.016, r * 0.5);
  const trail = r * 0.45;
  const ax = x + Math.sin(yaw) * trail;
  const az = z + Math.cos(yaw) * trail;
  const cy = floor + r;
  const crownY = floor + 2 * r + 0.012;
  const p = o.parent;
  k.cyl(r, r, ww, wheel, ax, cy, az, { axis: 'x', ry: yaw, seg: 10, parent: p, cast: false });
  k.cyl(r * 0.42, r * 0.42, ww + 0.004, metal, ax, cy, az, { axis: 'x', ry: yaw, seg: 6, parent: p, cast: false });
  const cheekH = crownY - cy + 0.006;
  const ux = Math.cos(yaw);
  const uz = -Math.sin(yaw);
  for (const s of [-1, 1]) {
    const off = s * (ww / 2 + 0.004);
    k.box(0.004, cheekH, r * 0.8 + trail * 0.6, metal, (x + ax) / 2 + ux * off, (cy + crownY) / 2, (z + az) / 2 + uz * off, { ry: yaw, parent: p, cast: false });
  }
  k.box(ww + 0.014, 0.01, r * 0.8 + trail * 0.6, metal, (x + ax) / 2, crownY, (z + az) / 2, { ry: yaw, parent: p, cast: false });
  if (top > crownY + 0.008) k.cyl(0.008, 0.008, top - crownY, metal, x, (top + crownY) / 2, z, { seg: 6, parent: p, cast: false });
  k.box(0.048, 0.005, 0.048, metal, x, top - 0.0025, z, { parent: p, cast: false });
}

export interface StarBaseOpts {
  x?: number;
  z?: number;
  floor?: number;
  legs?: number;
  /** leg tip radius from the centre */
  radius: number;
  hubR: number;
  /** leg centre height at the hub / at the tip */
  hubY: number;
  tipY: number;
  legW: number;
  legH: number;
  casterR: number;
  legMat: THREE.Material;
  hubMat: THREE.Material;
  casterMetal: THREE.Material;
  wheelMat: THREE.Material;
  yaw?: number;
  /** round tubular legs instead of flat bars */
  round?: boolean;
}

/** Radial wheeled base (IV pole, monitor stand, task chair, stool). */
export function starBase(k: PropKit, o: StarBaseOpts): void {
  const n = o.legs ?? 5;
  const cx = o.x ?? 0;
  const cz = o.z ?? 0;
  const floor = o.floor ?? 0;
  const yaw0 = o.yaw ?? k.rand() * Math.PI;
  for (let i = 0; i < n; i++) {
    const a = yaw0 + (i / n) * Math.PI * 2;
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const a0: V3 = [cx + dx * o.hubR * 0.8, o.hubY, cz + dz * o.hubR * 0.8];
    const a1: V3 = [cx + dx * o.radius, o.tipY, cz + dz * o.radius];
    if (o.round) line(k, [a0, a1], o.legW / 2, o.legMat);
    else bar(k, a0, a1, o.legW, o.legH, o.legMat);
    caster(k, cx + dx * (o.radius - 0.012), cz + dz * (o.radius - 0.012), o.tipY - o.legH / 2, o.casterR, o.casterMetal, o.wheelMat, a + rr(k, -1.2, 1.2), { floor });
  }
  k.cyl(o.hubR, o.hubR * 1.08, o.legH * 1.6, o.hubMat, cx, o.hubY, cz, { seg: 14 });
}

// ---------------------------------------------------------------------------
// Mains power
// ---------------------------------------------------------------------------

const ROOMS = new Map<string, RoomDef>();
const ROOM_ZONE = new Map<string, ZoneId | null>();

function roomDef(k: PropKit): RoomDef | undefined {
  if (!ROOMS.size) for (const r of k.s.layout.rooms) ROOMS.set(r.id, r);
  return ROOMS.get(k.def.room);
}

/**
 * Distance from the origin to the room wall behind the prop (along local -z), or null when the
 * room is unknown. Lets wall-hung fixtures sit flush whichever way the layout positions them.
 */
export function wallBehind(k: PropKit): number | null {
  const room = roomDef(k);
  if (!room) return null;
  const bx = -Math.sin(k.def.rotY);
  const bz = -Math.cos(k.def.rotY);
  const p = k.def.pos;
  const b = room.bounds;
  let t = Infinity;
  if (bx > 1e-6) t = Math.min(t, (b.x1 - p.x) / bx);
  if (bx < -1e-6) t = Math.min(t, (b.x0 - p.x) / bx);
  if (bz > 1e-6) t = Math.min(t, (b.z1 - p.z) / bz);
  if (bz < -1e-6) t = Math.min(t, (b.z0 - p.z) / bz);
  return Number.isFinite(t) && t > -0.05 ? Math.max(0, t) : null;
}

/** Interior ceiling height above the prop's origin (falls back to 2.8 m). */
export function ceilingAbove(k: PropKit): number {
  return (roomDef(k)?.ceiling ?? 2.8) - k.def.pos.y;
}

/** Breaker zone of the prop's room (taken from the room's light fixtures). */
export function roomZone(k: PropKit): ZoneId | null {
  const room = k.def.room;
  if (!ROOM_ZONE.has(room)) {
    const f = k.s.layout.lights.find((l) => l.room === room && l.zone);
    ROOM_ZONE.set(room, f?.zone ?? null);
  }
  return ROOM_ZONE.get(room) ?? null;
}

/** Wall power for an appliance: blackout kills everything; the generator only feeds emergency rooms whose zone is energised. */
export function mainsOn(k: PropKit): boolean {
  const st = k.s.store.get();
  if (st.power === 'normal' || st.power === 'unstable') return true;
  if (st.power === 'blackout') return false;
  const room = roomDef(k);
  if (!room || !room.emergency) return false;
  const z = roomZone(k);
  return z ? st.zones[z] === true : true;
}

/**
 * Calls fn(on) on the first update and whenever the room's mains state changes. setLit(on)
 * overrides until the next real change in mains power.
 */
export function watchPower(k: PropKit, fn: (on: boolean) => void): void {
  let shown: boolean | null = null;
  let mains: boolean | null = null;
  let forced: boolean | null = null;
  const show = (on: boolean): void => {
    if (on === shown) return;
    shown = on;
    fn(on);
  };
  k.onLit((on) => {
    forced = on;
    show(on);
  });
  k.onUpdate(() => {
    const m = mainsOn(k);
    if (m !== mains) {
      mains = m;
      forced = null;
    }
    show(forced ?? m);
  });
}

/** Per-instance self-lit material (LEDs, displays) whose brightness can be changed at runtime. */
export function ledMat(k: PropKit, color: number, intensity = 1): THREE.MeshStandardMaterial {
  const m = k.own(new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.35, metalness: 0 }));
  m.emissive.setHex(color);
  m.emissiveIntensity = intensity;
  return m;
}

// ---------------------------------------------------------------------------
// Runtime glow
// ---------------------------------------------------------------------------

/**
 * A Lighting glow owned by the prop whose state, colour and strength can change at runtime.
 * The kit registers it lazily (first update once parented); until then changes are only queued,
 * because setGlow on an unregistered id is a no-op and registration switches the glow on.
 */
export class Glow {
  readonly id: string;
  private ready = false;
  private dirty = true;
  private on = true;
  private color: number;
  private intensity: number;
  private appliedColor: number;
  private appliedIntensity: number;
  private readonly local: V3;
  private readonly k: PropKit;

  constructor(k: PropKit, local: V3, color: number, intensity: number) {
    this.k = k;
    this.local = local;
    this.color = color;
    this.intensity = Math.max(0.02, intensity);
    this.appliedColor = color;
    this.appliedIntensity = this.intensity;
    this.id = k.glow(local[0], local[1], local[2], color, this.intensity);
    k.onUpdate(() => {
      if (!this.ready && this.k.group.parent) {
        this.ready = true;
        this.dirty = true;
      }
      if (this.ready && this.dirty) this.apply();
    });
  }

  set(on: boolean, color = this.color, intensity = this.intensity): void {
    const i = Math.max(0.02, intensity);
    if (on === this.on && color === this.color && i === this.intensity) return;
    this.on = on;
    this.color = color;
    this.intensity = i;
    this.dirty = true;
    if (this.ready) this.apply();
  }

  private apply(): void {
    this.dirty = false;
    const L = this.k.s.lighting;
    if (this.on && (this.color !== this.appliedColor || this.intensity !== this.appliedIntensity)) {
      const p = this.k.worldPoint(this.local[0], this.local[1], this.local[2]);
      L.registerGlow(this.id, { x: p.x, y: p.y, z: p.z }, this.color, this.intensity, 'always');
      this.appliedColor = this.color;
      this.appliedIntensity = this.intensity;
    }
    L.setGlow(this.id, this.on);
  }
}

/**
 * kit.finish buckets static meshes by material AND shadow flags, so a material used by both big
 * (shadow-casting) and small (non-casting) parts costs two draw calls. Give every opaque material
 * one cast flag (cast if any of its parts casts); transparent materials never cast.
 */
export function unifyShadows(k: PropKit): void {
  const cast = new Map<string, boolean>();
  const meshes: THREE.Mesh[] = [];
  for (const c of k.group.children) {
    if (!(c instanceof THREE.Mesh) || c.userData.keep || Array.isArray(c.material)) continue;
    const m = c.material as THREE.Material;
    meshes.push(c);
    cast.set(m.uuid, !m.transparent && ((cast.get(m.uuid) ?? false) || c.castShadow));
  }
  for (const m of meshes) m.castShadow = cast.get((m.material as THREE.Material).uuid) ?? false;
}
