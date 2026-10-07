/**
 * Shared helpers for the infra prop builders: canvas textures, power-state queries, switchable
 * lamps, power fades (sputter / strike), room-aware sizing and a baker that merges an animated
 * assembly into a few draw calls inside a sub-group.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PowerState, RoomDef } from '../core/types';
import type { SignKind } from '../render/textures';
import type { MeshOpts, PropKit } from './props';

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export const FONT_SANS = '"Bahnschrift", "DIN Alternate", "Franklin Gothic Medium", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const FONT_COND = '"Bahnschrift SemiCondensed", "Bahnschrift", "Arial Narrow", "Franklin Gothic Medium", "Segoe UI", Arial, sans-serif';
export const FONT_MONO = '"Cascadia Mono", Consolas, "JetBrains Mono", "SF Mono", Menlo, monospace';
export const FONT_HAND = '"Segoe Print", "Bradley Hand", "Segoe Script", "Comic Sans MS", cursive';

export const fontStr = (px: number, weight: number | string = 400, family = FONT_SANS): string =>
  `${weight} ${Math.max(1, Math.round(px))}px ${family}`;

export interface Cnv {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function makeCnv(w: number, h: number): Cnv {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('[props.infra] 2D canvas unavailable');
  ctx.textBaseline = 'middle';
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

export function toTexture(c: Cnv, o: { srgb?: boolean; repeat?: boolean; mips?: boolean } = {}): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c.canvas);
  tex.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.anisotropy = 4;
  tex.generateMipmaps = o.mips !== false;
  tex.minFilter = o.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const TEX = new Map<string, THREE.CanvasTexture>();

/** Module-cached canvas texture shared by every instance (identical key gives identical pixels). */
export function sharedTex(key: string, draw: () => Cnv, o?: { srgb?: boolean; repeat?: boolean; mips?: boolean }): THREE.CanvasTexture {
  let t = TEX.get(key);
  if (!t) {
    t = toTexture(draw(), o);
    TEX.set(key, t);
  }
  return t;
}

/** Deterministic [0,1) stream from a string seed (textures must not depend on the prop id). */
export function seeded(seed: string | number): () => number {
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rr = (rnd: () => number, a: number, b: number): number => a + (b - a) * rnd();
export function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

export function textWidth(ctx: CanvasRenderingContext2D, text: string, spacing = 0): number {
  let w = 0;
  for (const ch of Array.from(text)) w += ctx.measureText(ch).width + spacing;
  return Math.max(0, w - spacing);
}

/** Largest font size (at most maxPx) at which every line fits maxW. Leaves ctx.font set. */
export function fitFont(ctx: CanvasRenderingContext2D, lines: string[], maxW: number, maxPx: number, weight: number | string, family = FONT_SANS, spacingEm = 0, minPx = 6): number {
  let px = Math.max(minPx, Math.floor(maxPx));
  while (px > minPx) {
    ctx.font = fontStr(px, weight, family);
    let widest = 0;
    for (const l of lines) widest = Math.max(widest, textWidth(ctx, l, px * spacingEm));
    if (widest <= maxW) break;
    px -= Math.max(1, Math.round(px * 0.06));
  }
  ctx.font = fontStr(px, weight, family);
  return px;
}

/** Text with manual letter spacing. */
export function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: 'left' | 'center' | 'right' = 'center'): void {
  const total = textWidth(ctx, text, spacing);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of Array.from(text)) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  ctx.textAlign = prev;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.lineTo(x + w - q, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + q);
  ctx.lineTo(x + w, y + h - q);
  ctx.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
  ctx.lineTo(x + q, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - q);
  ctx.lineTo(x, y + q);
  ctx.quadraticCurveTo(x, y, x + q, y);
  ctx.closePath();
}

/** Soft blotches (dirt, water marks, fingerprints); `rgb` like '40,30,20'. */
export function blotches(c: Cnv, rnd: () => number, n: number, rgb: string, alphaMax: number, rMin: number, rMax: number, region?: { x: number; y: number; w: number; h: number }): void {
  const { ctx } = c;
  const R = region ?? { x: 0, y: 0, w: c.w, h: c.h };
  for (let i = 0; i < n; i++) {
    const x = R.x + rnd() * R.w;
    const y = R.y + rnd() * R.h;
    const r = rr(rnd, rMin, rMax);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${(alphaMax * rr(rnd, 0.4, 1)).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Fine speckle grain. */
export function speckle(c: Cnv, rnd: () => number, n: number, rgb: string, alpha: number, size = 1.5): void {
  const { ctx } = c;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(${rgb},${(alpha * rnd()).toFixed(3)})`;
    const s = size * rr(rnd, 0.5, 1.5);
    ctx.fillRect(rnd() * c.w, rnd() * c.h, s, s);
  }
}

/** Vertical runs (rust, water, grime) falling from the top part of the region. */
export function runs(c: Cnv, rnd: () => number, n: number, rgb: string, alpha: number, region?: { x: number; y: number; w: number; h: number }): void {
  const { ctx } = c;
  const R = region ?? { x: 0, y: 0, w: c.w, h: c.h };
  for (let i = 0; i < n; i++) {
    const x = R.x + rnd() * R.w;
    const y = R.y + rnd() * R.h * 0.3;
    const len = R.h * rr(rnd, 0.25, 0.9);
    const w = rr(rnd, 1, 5);
    const g = ctx.createLinearGradient(0, y, 0, y + len);
    g.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, len);
  }
}

/** Diagonal hazard stripes across a rect. */
export function hazardStripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, period: number, dark = '#151515', light = '#d1a21c'): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = light;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = dark;
  for (let sx = x - h; sx < x + w + h; sx += period) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.lineTo(sx + h + period / 2, y);
    ctx.lineTo(sx + period / 2, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Per-instance standard material (disposed with the prop), for anything animated. */
export function ownStd(k: PropKit, p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return k.own(new THREE.MeshStandardMaterial(p));
}

/** Shared textured material keyed by name. */
export function texMat(k: PropKit, key: string, tex: () => THREE.Texture, p: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return k.shared(`infra:tm:${key}`, () => new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, ...p, map: tex() }));
}

/** Shared alpha decal (dirt, rust, stains): never writes depth, sits on top of the surface it hugs. */
export function decalMat(k: PropKit, key: string, tex: () => THREE.Texture, p: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return k.shared(`infra:decal:${key}`, () => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, ...p, map: tex() });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  });
}

/**
 * Sign plane from textures.signTexture at a usable resolution (PropKit.sign rasterises at 400 px/m,
 * which leaves small plates like room numbers and call buttons blurry). Shared per text/kind/size.
 */
export function signPlane(k: PropKit, text: string, kind: SignKind, w: number, h: number, x = 0, y = 0, z = 0, o: MeshOpts & { emissive?: number } = {}): THREE.Mesh {
  const pw = Math.min(1536, Math.max(256, Math.round(w * 1000)));
  const ph = Math.max(32, Math.round((pw * h) / w));
  const mat = k.shared(`infra:sign:${kind}:${text}:${pw}x${ph}:${o.emissive ?? 0}`, () => {
    const tex = k.t.signTexture(text, { kind, width: pw, height: ph });
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05, transparent: true });
    if (o.emissive) {
      m.emissive.setHex(0xffffff);
      m.emissiveMap = tex;
      m.emissiveIntensity = o.emissive;
    }
    return m;
  });
  return k.plane(w, h, mat, x, y, z, o);
}

/** Mark an object as animated/swapped: never merged, never picked as the interaction highlight carrier. */
export function live<T extends THREE.Object3D>(o: T): T {
  o.userData.keep = true;
  o.userData.noInteract = true;
  return o;
}

/** A lamp/LED that swaps between shared lit and unlit materials. */
export function switcher(mesh: THREE.Mesh, on: THREE.Material, off: THREE.Material): (lit: boolean) => void {
  live(mesh);
  mesh.material = off;
  return (lit: boolean) => {
    const m = lit ? on : off;
    if (mesh.material !== m) mesh.material = m;
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Scale a geometry's uv in place (repeat per metre for tiling textures). */
export function scaleUv(g: THREE.BufferGeometry, su: number, sv: number): THREE.BufferGeometry {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uv) {
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    uv.needsUpdate = true;
  }
  return g;
}

/** Plane with its uv repeated (owned; merged by finish). */
export function planeRep(k: PropKit, w: number, h: number, mat: THREE.Material, ru: number, rv: number, x = 0, y = 0, z = 0, o: MeshOpts = {}): THREE.Mesh {
  const g = k.own(scaleUv(new THREE.PlaneGeometry(w, h), ru, rv));
  return k.mesh(g, mat, x, y, z, { cast: false, ...o });
}

/** Cylinder along an axis with uv.y repeating per metre (pipes, rails, insulation). */
export function pipe(k: PropKit, r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', x = 0, y = 0, z = 0, o: MeshOpts & { seg?: number; open?: boolean; perMetre?: number } = {}): THREE.Mesh {
  const g = k.own(new THREE.CylinderGeometry(r, r, len, o.seg ?? 12, 1, o.open ?? false));
  if (o.perMetre) scaleUv(g, 1, len * o.perMetre);
  const rot = axis === 'x' ? { rz: Math.PI / 2 } : axis === 'z' ? { rx: Math.PI / 2 } : {};
  return k.mesh(g, mat, x, y, z, { ...rot, ...o });
}

/** Points of a coiled cord running from a to b (helix around the straight line, sagging). */
export function coilPoints(a: [number, number, number], b: [number, number, number], turns: number, radius: number, sag = 0): [number, number, number][] {
  const out: [number, number, number][] = [];
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(dir, up).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const steps = Math.max(8, Math.round(turns * 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * turns * Math.PI * 2;
    const p = A.clone().addScaledVector(dir, t * len);
    p.y -= Math.sin(t * Math.PI) * sag;
    const env = Math.min(1, Math.min(t, 1 - t) * 8);
    p.addScaledVector(u, Math.cos(ang) * radius * env).addScaledVector(v, Math.sin(ang) * radius * env);
    out.push([p.x, p.y, p.z]);
  }
  return out;
}

/** Smooth cord through points (Catmull-Rom, 4-sided; owned, merged by finish). Cheaper than tube() for coils. */
export function cord(k: PropKit, pts: [number, number, number][], r: number, mat: THREE.Material, o: MeshOpts = {}): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const g = k.own(new THREE.TubeGeometry(curve, Math.max(8, Math.round(pts.length * 1.5)), r, 4, false));
  return k.mesh(g, mat, 0, 0, 0, { cast: false, ...o });
}

/**
 * Merge every mesh under a detached staging group into `target`, bucketed by material, so an
 * animated assembly (engine on its mounts, a swaying tag) costs a few draw calls.
 */
export function bakeInto(k: PropKit, stage: THREE.Object3D, target: THREE.Object3D, opts: { noInteract?: boolean } = {}): THREE.Mesh[] {
  stage.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; geos: THREE.BufferGeometry[] }>();
  stage.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = m.material as THREE.Material;
    const key = `${mat.uuid}:${m.castShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) {
      b = { mat, cast: m.castShadow, geos: [] };
      buckets.set(key, b);
    }
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) {
      const ni = g.toNonIndexed();
      g.dispose();
      g = ni;
    }
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    b.geos.push(g);
  });
  const out: THREE.Mesh[] = [];
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    k.own(merged);
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    if (opts.noInteract) mesh.userData.noInteract = true;
    target.add(mesh);
    out.push(mesh);
  }
  return out;
}

/** A detached group for staging parts that bakeInto will merge. */
export const staging = (): THREE.Group => new THREE.Group();

// ---------------------------------------------------------------------------
// Room / placement
// ---------------------------------------------------------------------------

export function roomOf(k: PropKit): RoomDef | undefined {
  return k.s.layout.rooms.find((r) => r.id === k.def.room);
}

/** Local distance from the prop origin up to its room's ceiling. */
export function toCeiling(k: PropKit, fallback = 0.2): number {
  const r = roomOf(k);
  if (!r || r.noCeiling) return fallback;
  return Math.max(0.01, r.ceiling - k.def.pos.y);
}

/**
 * Half-extent available along local x before the prop would leave its room (axis-aligned
 * rotations only). Infinity when unknown or when the origin sits outside the room (facades).
 */
export function halfSpanX(k: PropKit, margin = 0.04): number {
  const r = roomOf(k);
  if (!r) return Infinity;
  const { x, z } = k.def.pos;
  const b = r.bounds;
  if (x < b.x0 - 0.01 || x > b.x1 + 0.01 || z < b.z0 - 0.01 || z > b.z1 + 0.01) return Infinity;
  const s = Math.abs(Math.sin(k.def.rotY));
  const c = Math.abs(Math.cos(k.def.rotY));
  let span = Infinity;
  if (s < 1e-3) span = Math.min(x - b.x0, b.x1 - x);
  else if (c < 1e-3) span = Math.min(z - b.z0, b.z1 - z);
  if (!Number.isFinite(span)) return Infinity;
  span -= margin;
  return span > 0.05 ? span : Infinity;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

export const powerOf = (k: PropKit): PowerState => k.s.store.get().power;
export const onMains = (p: PowerState): boolean => p === 'normal' || p === 'unstable';
export const gentle = (k: PropKit): boolean => k.s.store.get().settings.reducedFlicker;

/** True while the generator is cranking or carrying the load (Lighting switches before the store does). */
export function generatorRunning(k: PropKit): boolean {
  const p = powerOf(k);
  if (p === 'generator') return true;
  let lp: PowerState | undefined;
  try {
    lp = k.s.lighting?.powerState;
  } catch {
    lp = undefined;
  }
  return p === 'blackout' && lp === 'generator';
}

function hash1(n: number, seed: number): number {
  let h = Math.imul((n | 0) ^ Math.imul(seed | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Irregular brownout sag for unstable mains: mostly 1 with occasional short dips. Deterministic in t,
 * smooth inside each dip (never strobing); `soft` halves the depth (reduced-flicker setting).
 */
export function brownout(t: number, seed: number, soft: boolean): number {
  const slot = Math.floor(t * 3);
  const r = hash1(slot, seed);
  if (r > 0.13) return 1;
  const f = t * 3 - slot;
  const depth = (0.35 + 0.5 * hash1(slot + 7, seed)) * (soft ? 0.45 : 1);
  return 1 - depth * Math.sin(Math.PI * f);
}

/** Stable integer seed for a prop (used by brownout / fades so neighbours do not sag in lockstep). */
export function propSeed(k: PropKit): number {
  let h = 7;
  for (let i = 0; i < k.def.id.length; i++) h = (Math.imul(h, 31) + k.def.id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const DIE: [number, number][] = [[0, 0.3], [0.05, 0.95], [0.11, 0.12], [0.19, 0.7], [0.24, 0.04], [0.37, 0.4], [0.43, 0.02], [0.52, 0]];
const STRIKE: [number, number][] = [[0, 0], [0.12, 0.75], [0.17, 0.05], [0.34, 0.9], [0.4, 0.25], [0.55, 1]];

/**
 * Brightness envelope for something on a power circuit: sputters out when power goes, strikes
 * back with a couple of blinks when it returns, and sags with unstable mains.
 */
export class PowerFade {
  level: number;
  private on: boolean;
  private t = 99;
  private readonly speed: number;
  constructor(on: boolean, private readonly seed: number) {
    this.on = on;
    this.level = on ? 1 : 0;
    this.speed = 0.8 + (seed % 1000) / 2000;
  }
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.t = 0;
  }
  get isOn(): boolean {
    return this.on;
  }
  /** Advance; `time` is any monotonic seconds counter. */
  step(dt: number, time: number, unstable: boolean, soft: boolean): number {
    this.t += dt * this.speed;
    const pattern = this.on ? STRIKE : DIE;
    const end = pattern[pattern.length - 1][0];
    if (this.t < end) {
      let v = pattern[0][1];
      for (const [at, lv] of pattern) if (this.t >= at) v = lv;
      const ramp = this.on ? Math.min(1, this.t / end) : 1 - this.t / end;
      this.level = soft ? 0.35 * v + 0.65 * ramp : v;
    } else {
      this.level = this.on ? 1 : 0;
    }
    if (this.on && unstable) this.level *= brownout(time, this.seed, soft);
    return this.level;
  }
}

/** Game-clock pieces for the current store time (minutes since 22:45, fractional). */
export function gameClock(minutesSinceStart: number): { h: number; m: number; s: number } {
  const total = 22 * 60 + 45 + minutesSinceStart;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const s = (total * 60) % 60;
  return { h, m, s };
}
