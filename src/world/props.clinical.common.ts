/**
 * Shared helpers for the clinical prop builders: palette, primitives the kit lacks (oriented bars,
 * rods, chamfered boxes, casters, star bases), mains-power tracking and runtime-controllable glows.
 * Material keys are shared with the kit cache, so identical parameters reuse one material.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
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
  plastic: (k: PropKit, hex: number, rough = 0.5): THREE.Material => k.std(hex, rough, 0),
  vinyl: (k: PropKit, hex: number, rough = 0.42): THREE.Material => k.std(hex, rough, 0),
  paper: (k: PropKit): THREE.Material => k.std(0xe0ded5, 0.92, 0),
  linen: (k: PropKit): THREE.Material => k.std(0xd5d7d1, 0.9, 0),
  porcelain: (k: PropKit): THREE.Material => k.std(0xe4e4de, 0.16, 0),
  cardboard: (k: PropKit): THREE.Material => k.std(0xa88a5f, 0.9, 0),
  /** switched-off screens and glossy black glass */
  darkGlass: (k: PropKit): THREE.Material => k.std(0x0a0b0d, 0.14, 0.3),
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

/** Chamfered box (one bevel segment): a third of the vertices of kit.rbox, for small manufactured parts. */
export function bev(k: PropKit, w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, r = 0.006, o: MeshOpts = {}): THREE.Mesh {
  const rad = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = k.geo(`clin:bev:${f3(w)}:${f3(h)}:${f3(d)}:${f3(rad)}`, () => new RoundedBoxGeometry(w, h, d, 1, rad));
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
export function cablePts(a: V3, b: V3, sag: number, n = 8): V3[] {
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
  k.cyl(r, r, ww, wheel, ax, cy, az, { axis: 'x', ry: yaw, seg: 12, parent: p, cast: false });
  k.cyl(r * 0.42, r * 0.42, ww + 0.004, metal, ax, cy, az, { axis: 'x', ry: yaw, seg: 8, parent: p, cast: false });
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
    if (o.round) k.tube([a0, a1], o.legW / 2, o.legMat, { seg: 8 });
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
