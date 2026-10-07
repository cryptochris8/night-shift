/**
 * Type III ambulance, long along local z: cab at -z, patient module at +z with both rear doors
 * swung open on a lit interior. Wet clear-coated body, reflective livery, dual rear wheels and a
 * light bar whose red/white segments turn slowly (a travelling glow, never a strobe).
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { plate } from './props.infra.power';
import { drawChevrons, drawLivery } from './props.infra.tex2';
import { live, ownStd, sharedTex, texMat } from './props.infra.util';

interface Mats {
  body: THREE.Material;
  glass: THREE.Material;
  trim: THREE.Material;
  chrome: THREE.Material;
  tyre: THREE.Material;
  rim: THREE.Material;
  under: THREE.Material;
}

function mats(k: PropKit): Mats {
  return {
    body: k.phys('infra:amb:body', { color: 0xe2e2dc, roughness: 0.36, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.07 }),
    glass: k.phys('infra:amb:glass', { color: 0x0a0d10, roughness: 0.04, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03 }),
    trim: k.std(0x151618, 0.6, 0.1),
    chrome: k.std(0xc9cdd1, 0.18, 0.95),
    tyre: k.std(0x141414, 0.9, 0),
    rim: k.std(0x7c8084, 0.4, 0.75),
    under: k.std(0x0e0f10, 0.9, 0.2),
  };
}

function wheel(k: PropKit, m: Mats, x: number, z: number, width: number, side: number): void {
  const r = 0.38;
  k.cyl(r, r, width, m.tyre, x, r, z, { axis: 'x', seg: 24 });
  k.torus(r - 0.035, 0.035, m.tyre, x + side * width * 0.42, r, z, { ry: Math.PI / 2, seg: 24 });
  k.cyl(0.25, 0.25, width + 0.01, m.rim, x, r, z, { axis: 'x', seg: 18 });
  k.cyl(0.085, 0.085, width + 0.03, m.chrome, x, r, z, { axis: 'x', seg: 12 });
}

/** Chassis, wheels, nose and cab. Returns the grille light meshes for the flasher. */
function chassisAndCab(k: PropKit, m: Mats, L: number, CW: number): THREE.Mesh[] {
  const zf = -L / 2;
  k.box(CW - 0.25, 0.3, L - 0.7, m.under, 0, 0.6, 0.1);
  for (const sx of [-1, 1]) k.box(0.09, 0.2, L - 0.5, m.trim, sx * 0.45, 0.52, 0.1);
  k.cyl(0.03, 0.03, 1.2, m.rim, 0.55, 0.42, 2.2, { axis: 'z', seg: 8 });
  k.rbox(0.5, 0.32, 0.7, m.trim, -0.55, 0.55, -0.3, 0.04);
  const fz = zf + 0.65;
  for (const sx of [-1, 1]) wheel(k, m, sx * 0.86, fz, 0.24, sx);
  const rz = L / 2 - 1.35;
  for (const sx of [-1, 1]) {
    wheel(k, m, sx * 0.8, rz, 0.22, sx);
    wheel(k, m, sx * 1.04, rz, 0.22, sx);
  }
  // front bumper, nose, grille and lamps
  k.rbox(CW + 0.08, 0.24, 0.16, m.trim, 0, 0.52, zf + 0.08, 0.03);
  k.rbox(CW, 0.46, 0.94, m.body, 0, 1.0, zf + 0.6, 0.07);
  k.plane(CW * 0.56, 0.26, k.std(0x0b0b0c, 0.7, 0.3), 0, 0.92, zf + 0.129);
  for (let i = 0; i < 5; i++) k.box(CW * 0.56, 0.012, 0.01, m.chrome, 0, 0.81 + i * 0.055, zf + 0.124);
  const lens = k.phys('infra:amb:headlens', { color: 0x9aa4ab, roughness: 0.05, metalness: 0.6, clearcoat: 1 });
  for (const sx of [-1, 1]) {
    k.rbox(0.26, 0.15, 0.03, lens, sx * 0.72, 0.95, zf + 0.135, 0.02);
    k.rbox(0.12, 0.05, 0.02, k.std(0x8a5a10, 0.4), sx * 0.72, 0.84, zf + 0.135, 0.01);
  }
  const grille: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) grille.push(live(k.rbox(0.13, 0.035, 0.02, k.std(0x2a0806, 0.4), sx * 0.36, 0.73, zf + 0.135, 0.008, { cast: false })));
  // cab: lower body, upper profile, glass, pillars, roof
  const cz0 = zf + 1.07;
  const cz1 = cz0 + 1.26;
  k.rbox(CW, 0.62, cz1 - cz0, m.body, 0, 1.09, (cz0 + cz1) / 2, 0.05);
  const prof = new THREE.Shape();
  prof.moveTo(cz0, 1.38);
  prof.lineTo(cz0 + 0.42, 2.02);
  prof.lineTo(cz1, 2.05);
  prof.lineTo(cz1, 1.38);
  prof.closePath();
  k.extrude(prof, CW - 0.04, m.body, CW / 2 - 0.02, 0, 0, { ry: -Math.PI / 2, bevel: 0.02 });
  const slope = Math.atan2(0.42, 0.64);
  k.plane(CW - 0.22, 0.72, m.glass, 0, 1.716, cz0 + 0.188, { rx: slope, ry: Math.PI });
  for (const sx of [-1, 1]) {
    k.plane(0.78, 0.5, m.glass, sx * (CW / 2 + 0.003), 1.7, cz0 + 0.78, { ry: sx * Math.PI / 2 });
    k.box(0.02, 0.62, 0.012, m.trim, sx * (CW / 2 + 0.006), 1.09, cz0 + 0.1);
    k.box(0.02, 0.62, 0.012, m.trim, sx * (CW / 2 + 0.006), 1.09, cz1 - 0.06);
    k.box(0.03, 0.025, 0.12, m.chrome, sx * (CW / 2 + 0.012), 1.3, cz1 - 0.2);
    // west-coast mirror on two arms
    const mx = sx * (CW / 2 + 0.24);
    k.tube([[sx * (CW / 2), 1.9, cz0 + 0.5], [mx, 1.85, cz0 + 0.46]], 0.012, m.chrome, { seg: 6 });
    k.tube([[sx * (CW / 2), 1.5, cz0 + 0.5], [mx, 1.55, cz0 + 0.46]], 0.012, m.chrome, { seg: 6 });
    k.rbox(0.07, 0.34, 0.16, m.trim, mx, 1.7, cz0 + 0.46, 0.02);
    k.plane(0.05, 0.3, k.std(0x9aa3aa, 0.05, 1), mx, 1.7, cz0 + 0.541);
    k.torus(0.42, 0.04, m.trim, sx * (CW / 2 - 0.02), 0.38, fz, { ry: Math.PI / 2, arc: Math.PI, seg: 18 });
  }
  return grille;
}

/** Patient module shell (open at the rear), livery, compartments, rear posts and the open doors. */
function moduleShell(k: PropKit, m: Mats, L: number, BW: number): void {
  const z0 = -L / 2 + 2.33;
  const z1 = L / 2 - 0.25;
  const ML = z1 - z0;
  const zc = (z0 + z1) / 2;
  const yb = 0.78;
  const yt = 2.75;
  const T = 0.05;
  const h = yt - yb;
  k.box(T, h, ML, m.body, -BW / 2 + T / 2, yb + h / 2, zc);
  k.box(T, h, ML, m.body, BW / 2 - T / 2, yb + h / 2, zc);
  k.box(BW, T, ML, m.body, 0, yt - T / 2, zc);
  k.box(BW, h, T, m.body, 0, yb + h / 2, z0 + T / 2);
  k.box(BW - 2 * T, 0.05, ML, m.trim, 0, 0.975, zc);
  for (const sx of [-1, 1]) {
    for (const z of [z0, z1]) k.cyl(0.055, 0.055, h, m.body, sx * (BW / 2 - 0.02), yb + h / 2, z, { seg: 10 });
    k.cyl(0.055, 0.055, ML, m.body, sx * (BW / 2 - 0.02), yt - 0.02, zc, { axis: 'z', seg: 10 });
    k.torus(0.45, 0.045, m.trim, sx * (BW / 2 - 0.01), 0.38, L / 2 - 1.35, { ry: Math.PI / 2, arc: Math.PI, seg: 18 });
  }
  for (const z of [z0, z1]) k.cyl(0.055, 0.055, BW - 0.04, m.body, 0, yt - 0.02, z, { axis: 'x', seg: 10 });
  // livery on both flanks
  const liv = k.shared('infra:amb:livery', () => new THREE.MeshStandardMaterial({ map: sharedTex('livery', drawLivery), transparent: true, roughness: 0.3, metalness: 0.05, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  for (const sx of [-1, 1]) k.plane(ML - 0.12, (ML - 0.12) / 2, liv, sx * (BW / 2 + 0.002), 1.72, zc, { ry: sx * Math.PI / 2, cast: false });
  // street-side compartments with stainless D-ring latches
  const seam = k.std(0x2a2b2d, 0.6);
  for (let i = 0; i < 3; i++) {
    const cz = z0 + 0.35 + i * 0.95;
    for (const dz of [-0.4, 0.4]) k.box(0.006, 1.2, 0.012, seam, -BW / 2 - 0.003, 1.45, cz + dz);
    k.box(0.006, 0.012, 0.8, seam, -BW / 2 - 0.003, 2.05, cz);
    k.box(0.006, 0.012, 0.8, seam, -BW / 2 - 0.003, 0.85, cz);
    k.rbox(0.02, 0.05, 0.12, m.chrome, -BW / 2 - 0.01, 1.45, cz + 0.28, 0.008);
  }
  // curb-side entry door with a window and grab handle
  const dz = z0 + 0.55;
  for (const e of [-0.45, 0.45]) k.box(0.006, 1.7, 0.012, seam, BW / 2 + 0.003, 1.75, dz + e);
  k.box(0.006, 0.012, 0.9, seam, BW / 2 + 0.003, 2.6, dz);
  k.plane(0.5, 0.4, m.glass, BW / 2 + 0.004, 2.15, dz, { ry: Math.PI / 2 });
  k.tube([[BW / 2 + 0.01, 1.2, dz + 0.5], [BW / 2 + 0.06, 1.25, dz + 0.5], [BW / 2 + 0.06, 1.75, dz + 0.5], [BW / 2 + 0.01, 1.8, dz + 0.5]], 0.014, m.chrome, { seg: 6 });
  k.rbox(0.2, 0.05, 0.5, m.chrome, BW / 2 + 0.06, 0.6, dz, 0.01);
  // rear: corner panels beside the opening, header, threshold, step bumper, lamps, plate
  const ow = 0.68;
  const pw = BW / 2 - ow;
  for (const sx of [-1, 1]) {
    k.box(pw, h, T, m.body, sx * (ow + pw / 2), yb + h / 2, z1 - T / 2);
    k.rbox(0.13, 0.3, 0.03, k.std(0x5a0c08, 0.3), sx * (BW / 2 - 0.16), 1.25, z1 + 0.012, 0.01);
    k.rbox(0.13, 0.1, 0.03, k.std(0x6a4510, 0.3), sx * (BW / 2 - 0.16), 1.48, z1 + 0.012, 0.01);
    k.rbox(0.13, 0.08, 0.03, k.std(0xb7bcc0, 0.2), sx * (BW / 2 - 0.16), 1.06, z1 + 0.012, 0.01);
  }
  k.box(2 * ow, yt - 2.45, T, m.body, 0, (2.45 + yt) / 2, z1 - T / 2);
  k.box(2 * ow, 0.06, 0.1, m.chrome, 0, 0.99, z1 - 0.03);
  k.rbox(BW, 0.12, 0.28, k.std(0x6a6d70, 0.32, 0.85), 0, 0.56, z1 + 0.12, 0.02);
  for (let i = 0; i < 12; i++) k.box(BW - 0.1, 0.004, 0.012, k.std(0x55585b, 0.4, 0.8), 0, 0.622, z1 + 0.01 + i * 0.022);
  k.box(2 * ow, 0.24, T, m.body, 0, 0.83, z1 - T / 2);
  plate(k, 'ambplate', ['EMS 4417'], 0.3, 0.15, 0, 0.82, z1 + 0.003, { bg: '#e9e7df', fg: '#1d2a5a' });
  doors(k, m, ow, z1);
}

/** Both rear leaves, swung out on their hinges at x = +/- ow, z = z1. */
function doors(k: PropKit, m: Mats, ow: number, z1: number): void {
  const chev = texMat(k, 'chevrons', () => sharedTex('chevrons', drawChevrons), { roughness: 0.3, metalness: 0.1 });
  const inner = k.std(0x9ea3a6, 0.55, 0.1);
  const H = 1.45;
  const yc = 1.0 + H / 2;
  for (const side of [-1, 1]) {
    const ang = side < 0 ? -1.92 : 2.18;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const hx = side * ow;
    const dir = -side;
    const P = (lx: number, ly: number, lz: number): [number, number, number] => [hx + lx * c + lz * s, ly, z1 - lx * s + lz * c];
    const mid = (dir * ow) / 2;
    k.rbox(ow - 0.01, H, 0.06, m.body, ...P(mid, yc, 0.03), 0.02, { ry: ang });
    k.plane(ow - 0.08, 0.4, chev, ...P(mid, 1.3, 0.0605), { ry: ang });
    k.plane(ow * 0.6, 0.36, m.glass, ...P(mid, 2.08, 0.0605), { ry: ang });
    k.plane(ow - 0.06, H - 0.08, inner, ...P(mid, yc, -0.0005), { ry: ang + Math.PI });
    k.box(0.12, 0.03, 0.03, m.chrome, ...P(dir * (ow - 0.1), 1.62, 0.075), { ry: ang });
    for (const hy of [1.25, 2.2]) k.cyl(0.018, 0.018, 0.12, m.chrome, hx, hy, z1 + 0.01, { seg: 8 });
  }
}

/** Lit patient compartment seen through the open rear. */
function interior(k: PropKit, BW: number, z0: number, z1: number): void {
  const wall = k.std(0xd9dcd8, 0.6, 0.02);
  const zc = (z0 + z1) / 2;
  const ML = z1 - z0;
  const iw = BW - 0.1;
  k.plane(iw, ML - 0.08, k.std(0x5d6267, 0.45, 0.05), 0, 1.002, zc, { rx: -Math.PI / 2 });
  k.plane(ML - 0.08, 1.68, wall, -iw / 2 + 0.001, 1.85, zc, { ry: Math.PI / 2 });
  k.plane(ML - 0.08, 1.68, wall, iw / 2 - 0.001, 1.85, zc, { ry: -Math.PI / 2 });
  k.plane(iw, 1.68, wall, 0, 1.85, z0 + 0.051);
  k.plane(iw, ML - 0.08, wall, 0, 2.699, zc, { rx: Math.PI / 2 });
  const cab = k.std(0xbfc4c6, 0.4, 0.15);
  k.rbox(0.36, 0.95, 1.7, cab, -iw / 2 + 0.18, 2.12, z0 + 1.1, 0.01);
  const glassFront = k.phys('infra:amb:cabinetglass', { color: 0xcfe0e6, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.25, depthWrite: false });
  k.plane(1.6, 0.85, glassFront, -iw / 2 + 0.362, 2.12, z0 + 1.1, { ry: Math.PI / 2, keep: true });
  k.rbox(0.42, 0.06, 1.7, cab, -iw / 2 + 0.21, 1.25, z0 + 1.1, 0.01);
  const vinyl = k.std(0x1f3550, 0.5, 0.02);
  k.rbox(0.45, 0.12, 1.5, vinyl, iw / 2 - 0.24, 1.42, z0 + 1.6, 0.04);
  k.rbox(0.1, 0.5, 1.5, vinyl, iw / 2 - 0.05, 1.75, z0 + 1.6, 0.04);
  k.boxOn(0.4, 0.36, 1.5, k.std(0xbfc4c6, 0.45, 0.2), iw / 2 - 0.24, 1.0, z0 + 1.6);
  const frame = k.std(0xa9adb1, 0.3, 0.85);
  k.box(0.56, 0.05, 1.85, frame, -0.12, 1.24, z0 + 1.75);
  k.rbox(0.55, 0.11, 1.85, k.std(0x253a52, 0.6, 0.02), -0.12, 1.32, z0 + 1.75, 0.04);
  k.rbox(0.42, 0.08, 0.3, k.std(0xe8e8e2, 0.9), -0.12, 1.41, z0 + 1.0, 0.03);
  for (const sx of [-1, 1]) k.box(0.02, 0.06, 1.2, frame, -0.12 + sx * 0.3, 1.42, z0 + 1.75);
  k.cyl(0.075, 0.075, 0.9, k.std(0x2e6b3a, 0.45, 0.3), iw / 2 - 0.15, 1.55, z0 + 0.15, { seg: 12 });
  k.cyl(0.03, 0.035, 0.08, k.std(0x9a9ea2, 0.3, 0.85), iw / 2 - 0.15, 2.04, z0 + 0.15, { seg: 8 });
  const panel = k.glowMat(0xe6efff, 1.5);
  for (const z of [z0 + 0.8, z0 + 2.3]) k.plane(0.7, 0.3, panel, 0, 2.697, z, { rx: Math.PI / 2, cast: false });
}

/** Light bar across the module header plus corner beacons; returns each lens (red/white). */
function lights(k: PropKit, BW: number, z0: number, z1: number): { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; red: boolean; phase: number }[] {
  const out: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; red: boolean; phase: number }[] = [];
  const base = k.std(0x1a1b1d, 0.5, 0.3);
  k.rbox(1.92, 0.07, 0.3, base, 0, 2.785, z0 + 0.2, 0.02);
  const pattern = [true, true, false, true, true, true, true, false, true, true];
  pattern.forEach((red, i) => {
    const mat = ownStd(k, { color: red ? 0x4a0a07 : 0x6a6d70, emissive: red ? 0xff2414 : 0xf4f4ff, emissiveIntensity: 0.3, roughness: 0.2 });
    const x = -0.855 + i * 0.19;
    const mesh = live(k.rbox(0.17, 0.08, 0.24, mat, x, 2.86, z0 + 0.2, 0.025, { cast: false }));
    out.push({ mesh, mat, red, phase: i / pattern.length });
  });
  const corners: [number, number, number][] = [[-1, 2.6, z0 - 0.03], [1, 2.6, z0 - 0.03], [-1, 2.6, z1 + 0.03], [1, 2.6, z1 + 0.03]];
  corners.forEach(([sx, y, z], i) => {
    const mat = ownStd(k, { color: 0x4a0a07, emissive: 0xff2414, emissiveIntensity: 0.3, roughness: 0.2 });
    const mesh = live(k.rbox(0.24, 0.14, 0.05, mat, sx * (BW / 2 - 0.2), y, z, 0.015, { cast: false }));
    out.push({ mesh, mat, red: true, phase: i % 2 ? 0.5 : 0 });
  });
  for (const sx of [-1, 1]) k.rbox(0.03, 0.14, 0.3, k.std(0xb7bcc0, 0.2, 0.1), sx * (BW / 2 + 0.012), 2.55, (z0 + z1) / 2, 0.01);
  return out;
}

const ambulance: PropBuilder = (k) => {
  const fp = k.def.footprint ?? { w: 2.4, d: 6.0 };
  const L = Math.max(5.6, Math.max(fp.w, fp.d));
  const BW = Math.min(2.3, Math.min(fp.w, fp.d) - 0.1);
  const CW = 2.0;
  const m = mats(k);
  const grille = chassisAndCab(k, m, L, CW);
  moduleShell(k, m, L, BW);
  const z0 = -L / 2 + 2.33;
  const z1 = L / 2 - 0.25;
  interior(k, BW, z0, z1);
  const lamps = lights(k, BW, z0, z1);
  const grilleMats = grille.map((g) => {
    const mat = ownStd(k, { color: 0x2a0806, emissive: 0xff2414, emissiveIntensity: 0.2, roughness: 0.3 });
    g.material = mat;
    return mat;
  });
  k.glow(0, 1.9, z1 - 0.4, 0xe6efff, 0.5);
  k.glow(0, 3.1, z0 + 0.2, 0xff2a18, 0.3);
  let t = k.rand() * 10;
  k.onUpdate((dt) => {
    t += dt;
    if (k.cameraDistance() > 70) return;
    // a beam that walks along the bar at ~0.5 rev/s: smooth, never a hard flash
    const head = (t * 0.5) % 1;
    for (const l of lamps) {
      let d = Math.abs(head - l.phase);
      d = Math.min(d, 1 - d);
      const beam = Math.pow(Math.max(0, Math.cos(d * Math.PI * 2)), 6);
      l.mat.emissiveIntensity = (l.red ? 0.35 : 0.2) + beam * (l.red ? 2.6 : 2.0);
    }
    const p = 0.5 + 0.5 * Math.sin(t * Math.PI * 1.2);
    grilleMats[0].emissiveIntensity = 0.2 + 2.2 * p * p;
    grilleMats[1].emissiveIntensity = 0.2 + 2.2 * (1 - p) * (1 - p);
  });
};

export const AMBULANCE_BUILDERS: Partial<Record<PropType, PropBuilder>> = { ambulance };
