/**
 * Figure heads: one closed, sculpted surface per face preset, painted per figure.
 *
 * The shape is a signed-distance model (cranium, jaw, cheekbones, brow, carved eye sockets, nose,
 * lips, chin, ears) whose parts blend through smooth unions, so there are no seams and no shells
 * crossing each other. It is sampled onto a grid that is densest across the face and cached per
 * preset. Each figure then paints its copy with vertex colours (skin, baked cavity shading, eye
 * shadow, brows, lips, hair) and lifts the hair a few millimetres for volume. The eyes stay soft
 * shadowed hollows: nothing is drawn on.
 *
 * Head space matches the rig: origin at the top of the neck, +y up, the face toward -z. The model
 * is in metres for the standard adult head (radius HEAD_R_REF) and scaled to each figure.
 */
import * as THREE from 'three';
import type { FaceKind, Outfit } from '../core/contracts';
import type { RNG } from '../core/rng';

/** headR of the standard 1.72 m adult; the sculpt is modelled at this size. */
export const HEAD_R_REF = 0.102;
/** Radius of the neck stub that runs up into the skull base, at the standard size. */
export const NECK_STUB_R = 0.051;
/** Between the eyes, at the front of the face: where a phone screen is turned to. */
export const FACE_POINT: readonly [number, number, number] = [0, 0.104, -0.09];

export type FacePreset = FaceKind;

export interface FaceParams {
  /** false: the smooth, faceless head (cranium and jaw only) */
  features: boolean;
  jawW: number;
  /** metres the jaw, lips and chin sit lower */
  jawDrop: number;
  chin: number;
  /** jaw-corner definition: 0 rounded, 1 square */
  gonion: number;
  brow: number;
  cheek: number;
  noseLen: number;
  noseW: number;
  noseP: number;
  lips: number;
  ear: number;
  bun: boolean;
}

const BASE: FaceParams = {
  features: true, jawW: 1, jawDrop: 0, chin: 1, gonion: 0, brow: 1, cheek: 1,
  noseLen: 1, noseW: 1, noseP: 1, lips: 1, ear: 1, bun: false,
};

export const FACE_PRESETS: Readonly<Record<FacePreset, FaceParams>> = {
  plain: BASE,
  strong: { ...BASE, jawW: 1.08, chin: 1.15, gonion: 1, brow: 1.3, noseP: 1.1, noseW: 1.08, lips: 0.9 },
  long: { ...BASE, jawW: 0.94, jawDrop: 0.007, cheek: 0.85, noseLen: 1.15, noseW: 0.95, chin: 1.1 },
  soft: { ...BASE, jawW: 0.9, chin: 0.85, brow: 0.55, cheek: 1.1, noseLen: 0.9, noseW: 0.88, noseP: 0.85, lips: 1.12, ear: 0.92, bun: true },
  blank: { ...BASE, features: false },
};

// ---------------------------------------------------------------------------
// Signed distance model
// ---------------------------------------------------------------------------

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(e0: number, e1: number, v: number): number {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Approximate distance to an axis-aligned ellipsoid centred at the origin (exact sign). */
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

function sphere(x: number, y: number, z: number, r: number): number {
  return Math.sqrt(x * x + y * y + z * z) - r;
}

/** Segment a→b whose radius runs from r0 at a to r1 at b. */
function taperedCapsule(
  x: number, y: number, z: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r0: number, r1: number,
): number {
  const px = x - ax, py = y - ay, pz = z - az;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const h = clamp01((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz));
  const qx = px - dx * h, qy = py - dy * h, qz = pz - dz * h;
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - (r0 + (r1 - r0) * h);
}

/** Smooth union: blends over a band of width k instead of leaving a crease. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Smooth subtraction of b from a. */
function ssub(a: number, b: number, k: number): number {
  return -smin(-a, b, k);
}

// eye sockets tilt so their inner corners sit a little higher (a level brow, not a frown)
const SOCKET_TILT = 0.1;
const cST = Math.cos(SOCKET_TILT), sST = Math.sin(SOCKET_TILT);
// ears flare out at the back and tilt back at the top
const EAR_YAW = 0.22;
const EAR_PITCH = -0.12;
const cEY = Math.cos(EAR_YAW), sEY = Math.sin(EAR_YAW);
const cEP = Math.cos(EAR_PITCH), sEP = Math.sin(EAR_PITCH);

/**
 * Signed distance (metres, negative inside) from a head-space point to the head surface for
 * face `f`, with a neck stub of radius `neckR` running into the skull base.
 */
export function headSdf(x: number, y: number, z: number, f: FaceParams, neckR = NECK_STUB_R): number {
  const ax = Math.abs(x);
  const jd = f.jawDrop;
  // cranium and the lower face, blended at the cheeks and temples
  let d = ellipsoid(x, y - 0.128, z - 0.01, 0.074, 0.092, 0.097);
  d = smin(d, ellipsoid(x, y - 0.06 + jd * 0.5, z + 0.03, 0.054 * f.jawW, 0.066 + jd * 0.5, 0.058), 0.035);
  // the neck carries on up into the skull base, so the nape never shows a gap above the neck
  d = smin(d, taperedCapsule(x, y, z, 0, 0, 0.006, 0, 0.07, 0.006, neckR, neckR), 0.03);
  if (!f.features) return d;

  // cheekbones, jaw corners, chin
  const cs = f.cheek;
  d = smin(d, ellipsoid(ax - 0.045, y - 0.095, z + 0.052, 0.019 * cs, 0.012 * cs, 0.014 * cs), 0.02);
  // fullness under the cheekbones, so the faces never read as gaunt
  d = smin(d, ellipsoid(ax - 0.042, y - 0.07 + jd * 0.5, z + 0.038, 0.02, 0.026, 0.022), 0.025);
  if (f.gonion > 0) {
    d = smin(d, ellipsoid(ax - 0.048 * f.jawW, y - 0.034 + jd, z + 0.002, 0.011 * f.gonion, 0.016, 0.02), 0.022);
  }
  d = smin(d, ellipsoid(x, y - 0.014 + jd, z + 0.07, 0.019, 0.015, 0.014 * f.chin), 0.014);
  // brow ridge: an arch over each eye joined by the bridge between them, then the eye sockets
  // carved under it with the eyes set back inside
  d = smin(d, ellipsoid(ax - 0.026, y - 0.1265, z + 0.078, 0.026, 0.0085, 0.0105 * f.brow), 0.01);
  d = smin(d, ellipsoid(x, y - 0.123, z + 0.08, 0.013, 0.009, 0.0085), 0.008);
  const su = ax - 0.031, sv = y - 0.104;
  d = ssub(d, ellipsoid(su * cST - sv * sST, su * sST + sv * cST, z + 0.083, 0.018, 0.012, 0.014), 0.008);
  d = smin(d, sphere(ax - 0.031, y - 0.104, z + 0.064, 0.012), 0.004);
  // nose: bridge from the root between the eyes, a rounded tip and the two wings
  const tipY = 0.108 - 0.03 * f.noseLen;
  const tipZ = -0.082 - 0.017 * f.noseP;
  let n = taperedCapsule(x, y, z, 0, 0.108, -0.082, 0, tipY, tipZ, 0.0055 * f.noseW, 0.0085 * f.noseW);
  n = smin(n, sphere(x, y - (tipY - 0.004 * f.noseLen), z - (tipZ + 0.002), 0.0105 * f.noseW), 0.006);
  n = smin(n, sphere(ax - 0.011 * f.noseW, y - (tipY - 0.006 * f.noseLen), z - (tipZ + 0.009), 0.0072 * f.noseW), 0.005);
  d = smin(d, n, 0.007);
  // lips
  d = smin(d, ellipsoid(x, y - 0.045 + jd * 0.5, z + 0.08, 0.023, 0.0105 * f.lips, 0.0085 * f.lips), 0.006);
  // ears
  const ex = ax - 0.075, ey = y - 0.098, ez = z - 0.012;
  const lx = ex * cEY - ez * sEY;
  const lz0 = ex * sEY + ez * cEY;
  const ly = ey * cEP - lz0 * sEP;
  const lz = ey * sEP + lz0 * cEP;
  d = smin(d, ellipsoid(lx, ly, lz, 0.011, 0.027 * f.ear, 0.017 * f.ear), 0.008);
  if (f.bun) d = smin(d, sphere(x, y - 0.152, z - 0.098, 0.026), 0.012);
  return d;
}

// ---------------------------------------------------------------------------
// Sampling the surface
// ---------------------------------------------------------------------------

export interface HeadShape {
  /** metres at HEAD_R_REF */
  positions: Float32Array;
  /** unit surface normals (the distance field's gradient) */
  normals: Float32Array;
  /** baked cavity shading: 0 enclosed … 1 open */
  ao: Float32Array;
  index: Uint16Array;
  count: number;
  params: FaceParams;
}

// The template the grid starts on: an ellipsoid hugging the whole head. Each grid point is pushed
// along the template's normal onto the surface.
const TC_Y = 0.105, TC_Z = 0.002;
const TR_X = 0.082, TR_Y = 0.118, TR_Z = 0.104;
/** search range along the template normal: from this far outside … */
const T_OUT = 0.05;
/** … to this far inside */
const T_IN = -0.09;

export const HEAD_SEGMENTS = 80;
export const HEAD_RINGS = 60;
// spacing is tighter at the front (azimuth) and across the hairline-to-chin band (polar angle)
const PHI_WARP = 0.5;
const THETA_WARP = 0.3;
const THETA_FOCUS = 0.52;

function warpPhi(s: number): number {
  return 2 * Math.PI * s - PHI_WARP * Math.sin(2 * Math.PI * s);
}

function warpTheta(t: number): number {
  const k = THETA_WARP / (2 * Math.PI);
  return Math.PI * (t - k * (Math.sin(2 * Math.PI * (t - THETA_FOCUS)) + Math.sin(2 * Math.PI * THETA_FOCUS)));
}

type Field = (x: number, y: number, z: number) => number;

/** Distance along (nx,ny,nz) from (px,py,pz) to the outermost surface crossing. */
function surfaceT(px: number, py: number, pz: number, nx: number, ny: number, nz: number, sdf: Field): number {
  let t = T_OUT;
  let d = sdf(px + nx * t, py + ny * t, pz + nz * t);
  for (let i = 0; i < 20 && d < 0; i++) {
    t += 0.01;
    d = sdf(px + nx * t, py + ny * t, pz + nz * t);
  }
  for (let i = 0; i < 200; i++) {
    const next = t - Math.max(d * 0.7, 0.0003);
    const dn = sdf(px + nx * next, py + ny * next, pz + nz * next);
    if (dn < 0) {
      let lo = next, hi = t;
      for (let k = 0; k < 7; k++) {
        const m = 0.5 * (lo + hi);
        if (sdf(px + nx * m, py + ny * m, pz + nz * m) < 0) lo = m;
        else hi = m;
      }
      return 0.5 * (lo + hi);
    }
    t = next;
    d = dn;
    if (t < T_IN) break;
  }
  return t;
}

/** Sample the surface of `params` (uncached; see headShape). */
export function buildHeadShape(params: FaceParams, neckR = NECK_STUB_R): HeadShape {
  const sdf: Field = (x, y, z) => headSdf(x, y, z, params, neckR);
  const segs = HEAD_SEGMENTS;
  const rings = HEAD_RINGS;
  const count = rings * segs + 2;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const ao = new Float32Array(count);

  const place = (v: number, ux: number, uy: number, uz: number): void => {
    const px = TR_X * ux, py = TC_Y + TR_Y * uy, pz = TC_Z + TR_Z * uz;
    let nx = ux / TR_X, ny = uy / TR_Y, nz = uz / TR_Z;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    const t = surfaceT(px, py, pz, nx, ny, nz, sdf);
    positions[v * 3] = px + nx * t;
    positions[v * 3 + 1] = py + ny * t;
    positions[v * 3 + 2] = pz + nz * t;
  };
  place(0, 0, 1, 0);
  for (let j = 1; j <= rings; j++) {
    const theta = warpTheta(j / (rings + 1));
    const st = Math.sin(theta), ct = Math.cos(theta);
    for (let i = 0; i < segs; i++) {
      const phi = warpPhi(i / segs);
      place(1 + (j - 1) * segs + i, st * Math.sin(phi), ct, -st * Math.cos(phi));
    }
  }
  place(count - 1, 0, -1, 0);

  // normals from the field's gradient, then cavity shading sampled along them
  const h = 0.0003;
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let gx = sdf(x + h, y, z) - sdf(x - h, y, z);
    let gy = sdf(x, y + h, z) - sdf(x, y - h, z);
    let gz = sdf(x, y, z + h) - sdf(x, y, z - h);
    const gl = Math.hypot(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
    let occ = 0, total = 0, w = 1;
    for (let k = 1; k <= 5; k++) {
      const s = 0.0035 * k;
      occ += w * Math.max(0, s - sdf(x + gx * s, y + gy * s, z + gz * s));
      total += w * s;
      w *= 0.75;
    }
    ao[v] = 1 - Math.min(1, (1.2 * occ) / total);
  }

  // triangles, wound counter-clockwise seen from outside
  const index = new Uint16Array(segs * 6 * rings);
  let k = 0;
  const at = (j: number, i: number): number => 1 + (j - 1) * segs + (i % segs);
  for (let i = 0; i < segs; i++) {
    index[k++] = 0; index[k++] = at(1, i + 1); index[k++] = at(1, i);
  }
  for (let j = 1; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = at(j, i), b = at(j, i + 1), c = at(j + 1, i + 1), d = at(j + 1, i);
      index[k++] = a; index[k++] = b; index[k++] = c;
      index[k++] = a; index[k++] = c; index[k++] = d;
    }
  }
  for (let i = 0; i < segs; i++) {
    index[k++] = at(rings, i); index[k++] = at(rings, i + 1); index[k++] = count - 1;
  }
  return { positions, normals, ao, index, count, params };
}

const shapeCache = new Map<string, HeadShape>();

/** Every preset at the standard neck size, so no figure spawned mid-game pays for sampling. */
export function warmHeadShapes(): void {
  for (const preset of Object.keys(FACE_PRESETS) as FacePreset[]) headShape(preset);
}

/** The sampled surface for a preset (built once per preset and neck size, then shared). */
export function headShape(preset: FacePreset, neckR = NECK_STUB_R): HeadShape {
  const r = Math.round(neckR * 2000) / 2000;
  const key = `${preset}:${r}`;
  let shape = shapeCache.get(key);
  if (!shape) {
    shape = buildHeadShape(FACE_PRESETS[preset], r);
    shapeCache.set(key, shape);
  }
  return shape;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

export interface HairStyle {
  /** 0..1: hairline high and short at the nape … low and longer */
  line: number;
  /** metres the front hairline is pushed back */
  recede: number;
  /** 0..1: thinning to bald on the crown */
  bald: number;
}

/** Hairline height (m) by azimuth from the face (0 front … π back). */
const HAIRLINE: readonly (readonly [number, number])[] = [
  [0, 0.17], [0.55, 0.168], [0.95, 0.152], [1.25, 0.142], [1.6, 0.137], [1.88, 0.128], [2.1, 0.095], [2.4, 0.068], [Math.PI, 0.058],
];

function hairlineY(phi: number, s: HairStyle): number {
  let y = HAIRLINE[HAIRLINE.length - 1][1];
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [p1, y1] = HAIRLINE[i];
    if (phi <= p1) {
      const [p0, y0] = HAIRLINE[i - 1];
      const u = (phi - p0) / (p1 - p0);
      y = y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      break;
    }
  }
  const front = 1 - smoothstep(0.8, 1.3, phi);
  return y + front * s.recede - (s.line - 0.5) * (front * 0.01 + (1 - front) * 0.02);
}

const CROWN_UP = new THREE.Vector3(0, 1, -0.3).normalize();

/** 0..1 hair coverage at a head-space point (metres at HEAD_R_REF). */
export function hairMask(x: number, y: number, z: number, s: HairStyle): number {
  const phi = Math.abs(Math.atan2(x, -(z - 0.01)));
  const line = hairlineY(phi, s);
  let m = smoothstep(line - 0.006, line + 0.006, y);
  if (m <= 0) return 0;
  // never on the ears: a margin around each one, in the ear's own frame
  const ex = Math.abs(x) - 0.075, ey = y - 0.098, ez = z - 0.012;
  const lx = ex * cEY - ez * sEY;
  const lz0 = ex * sEY + ez * cEY;
  const ly = ey * cEP - lz0 * sEP;
  const lz = ey * sEP + lz0 * cEP;
  m *= smoothstep(0.75, 1.2, (lx / 0.021) ** 2 + (ly / 0.035) ** 2 + (lz / 0.025) ** 2);
  if (s.bald > 0 && m > 0) {
    const dx = x, dy = y - 0.128, dz = z - 0.01;
    const c = (dx * CROWN_UP.x + dy * CROWN_UP.y + dz * CROWN_UP.z) / (Math.hypot(dx, dy, dz) || 1);
    m *= 1 - s.bald * smoothstep(0.62, 0.72, c);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Painting and the per-figure geometry
// ---------------------------------------------------------------------------

export interface HeadPaint {
  /** sRGB hex */
  skin: number;
  /** sRGB hex; null = no hair (brows then take a darkened skin tone) */
  hair: number | null;
  style: HairStyle | null;
}

export interface FaceMasks {
  eye: number;
  brow: number;
  lips: number;
  mouth: number;
}

const NO_MASKS: FaceMasks = { eye: 0, brow: 0, lips: 0, mouth: 0 };
const tmpColor = new THREE.Color();

/** Linear RGB of an sRGB hex colour, as vertex colours expect. */
function linear(hex: number): [number, number, number] {
  tmpColor.setHex(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/** Cheap stable per-vertex jitter in [0,1). */
function hash01(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Painted face masks (0..1) at a head-space point on a sculpted head. */
export function faceMasks(x: number, y: number, z: number, f: FaceParams): FaceMasks {
  if (!f.features || z > -0.045) return NO_MASKS;
  const ax = Math.abs(x);
  const eu = ax - 0.031, ev = y - 0.106;
  const ex = (eu * cST - ev * sST) / 0.02, ey = (eu * sST + ev * cST) / 0.013;
  const eye = 1 - smoothstep(0.25, 1.05, Math.sqrt(ex * ex + ey * ey));
  const browY = 0.1255 + 0.0035 * Math.sin(Math.PI * clamp01((ax - 0.008) / 0.04));
  const brow = (1 - smoothstep(0.003, 0.0075, Math.abs(y - browY))) * smoothstep(0.006, 0.014, ax) * (1 - smoothstep(0.042, 0.052, ax));
  const lipsY = 0.044 - f.jawDrop * 0.5;
  const lx = x / 0.023, ly = (y - lipsY) / 0.0085;
  const lips = 1 - smoothstep(0.55, 1.0, Math.sqrt(lx * lx + ly * ly));
  const mouth = (1 - smoothstep(0.0018, 0.0045, Math.abs(y - lipsY))) * (1 - smoothstep(0.015, 0.022, ax));
  return { eye, brow, lips, mouth };
}

/**
 * Per-figure head geometry: the preset's surface scaled by `scale` (headR / HEAD_R_REF), with a
 * neck stub of `neckR` (at the reference size). With `paint` it carries vertex colours and lifted
 * hair; without, it is a plain surface (the faceless dark figure keeps its matte material).
 */
export function headGeometry(preset: FacePreset, scale: number, neckR: number, paint: HeadPaint | null): THREE.BufferGeometry {
  const shape = headShape(preset, neckR);
  const f = shape.params;
  const n = shape.count;
  const pos = new Float32Array(n * 3);
  const col = paint ? new Float32Array(n * 3) : null;
  const skin = paint ? linear(paint.skin) : null;
  const hair = paint && paint.hair !== null ? linear(paint.hair) : null;
  const style = hair ? paint?.style ?? null : null;
  const browC = hair ?? (skin ? [skin[0] * 0.45, skin[1] * 0.42, skin[2] * 0.4] : null);
  const lip = skin ? [skin[0] * 0.82, skin[1] * 0.6, skin[2] * 0.58] : null;
  for (let v = 0; v < n; v++) {
    const sx = shape.positions[v * 3], sy = shape.positions[v * 3 + 1], sz = shape.positions[v * 3 + 2];
    const hm = style ? hairMask(sx, sy, sz, style) : 0;
    // hair stands off the scalp: thin at the hairline, fuller on top
    const lift = hm * (0.003 + 0.0045 * smoothstep(0.12, 0.2, sy));
    pos[v * 3] = (sx + shape.normals[v * 3] * lift) * scale;
    pos[v * 3 + 1] = (sy + shape.normals[v * 3 + 1] * lift) * scale;
    pos[v * 3 + 2] = (sz + shape.normals[v * 3 + 2] * lift) * scale;
    if (!col || !skin || !browC || !lip) continue;
    const m = faceMasks(sx, sy, sz, f);
    let r = skin[0], g = skin[1], b = skin[2];
    const lm = 0.55 * m.lips;
    r += (lip[0] - r) * lm; g += (lip[1] - g) * lm; b += (lip[2] - b) * lm;
    const mm = 1 - 0.45 * m.mouth;
    r *= mm; g *= mm; b *= mm;
    const bm = 0.4 * Math.min(1, 0.5 + 0.5 * f.brow) * m.brow;
    r += (browC[0] - r) * bm; g += (browC[1] - g) * bm; b += (browC[2] - b) * bm;
    const em = 1 - 0.34 * m.eye;
    r *= em; g *= em; b *= em;
    if (hair && hm > 0) {
      const j = 0.94 + 0.12 * hash01(v);
      r += (hair[0] * j - r) * hm; g += (hair[1] * j - g) * hm; b += (hair[2] * j - b) * hm;
    }
    const a = 0.6 + 0.4 * shape.ao[v];
    col[v * 3] = r * a;
    col[v * 3 + 1] = g * a;
    col[v * 3 + 2] = b * a;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(shape.index, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Per-figure choices
// ---------------------------------------------------------------------------

/** Face preset for a figure: the dark figure stays faceless; Susie's scrubs get the soft face. */
export function pickFace(rng: RNG, outfit: Outfit): FacePreset {
  if (outfit === 'dark') return 'blank';
  if (outfit === 'scrubs') return 'soft';
  return rng.pick(['plain', 'strong', 'long'] as const);
}

/** Hair style for a figure; `line` is the figure's own hairline draw (0..1). Patients skew older. */
export function pickHairStyle(rng: RNG, outfit: Outfit, line: number, face: FacePreset): HairStyle {
  if (face === 'soft') return { line, recede: 0, bald: 0 };
  const older = outfit === 'patient';
  const recede = rng.chance(older ? 0.5 : 0.25) ? rng.range(0.004, 0.02) : 0;
  const bald = older && rng.chance(0.3) ? rng.range(0.6, 1) : 0;
  return { line, recede, bald };
}
