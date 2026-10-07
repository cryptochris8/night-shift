/**
 * Exterior and envelope props: the ambulance-bay canopy (soffit at local y 0, columns down to the
 * asphalt at local y = -pos.y), steel bollards, a generic window unit and framed glass partitions.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawFrost, drawStain, drawStreak } from './props.infra.tex2';
import { PowerFade, decalMat, gentle, ownStd, pipe, planeRep, powerOf, propSeed, sharedTex } from './props.infra.util';

/** Ambulance-bay canopy: params.w (x) x params.d (z); fascia + gutter on the outer (-x) and end edges. */
const canopy: PropBuilder = (k) => {
  const w = k.num('w', 6);
  const d = k.num('d', 10);
  const ground = -k.def.pos.y;
  const tex = k.t.concreteTexture({ tint: 0x8d8c86, stains: 0.95, seed: 4 });
  const conc = k.shared('infra:canopy:conc', () => new THREE.MeshStandardMaterial({ map: tex, color: 0xb9b7b0, roughness: 0.94, metalness: 0 }));
  planeRep(k, w, d, conc, w / 2, d / 2, 0, 0.0, 0, { rx: Math.PI / 2, receive: true });
  k.box(w, 0.3, d, conc, 0, 0.17, 0, { cast: true });
  const mould = decalMat(k, 'stain:water11', () => sharedTex('stain:water11', () => drawStain('water', 11)), { opacity: 0.5 });
  for (let i = 0; i < 4; i++) k.plane(1.6 + k.rand() * 1.4, 1.2 + k.rand(), mould, -w / 2 + 0.6 + k.rand() * 0.8, -0.004, -d / 2 + 1 + k.rand() * (d - 2), { rx: Math.PI / 2, rz: k.rand() * 3 });
  const fascia = k.std(0x3a3531, 0.45, 0.6);
  k.box(0.03, 0.5, d + 0.06, fascia, -w / 2 - 0.015, 0.25, 0);
  k.box(w + 0.03, 0.5, 0.03, fascia, -0.015, 0.25, -d / 2 - 0.015);
  k.box(w + 0.03, 0.5, 0.03, fascia, -0.015, 0.25, d / 2 + 0.015);
  const streak = decalMat(k, 'streak:fascia', () => sharedTex('streak:fascia', () => drawStreak('20,22,24', 9)), { opacity: 0.55 });
  for (let z = -d / 2 + 0.8; z < d / 2 - 0.5; z += 1.9 + k.rand()) k.plane(1.1, 0.5, streak, -w / 2 - 0.0315, 0.25, z, { ry: -Math.PI / 2 });
  // gutter trough along the outer edge
  const gx = -w / 2 - 0.1;
  k.box(0.14, 0.008, d + 0.06, fascia, gx, 0.36, 0);
  k.box(0.008, 0.12, d + 0.06, fascia, gx - 0.066, 0.42, 0);
  // recessed downlights, two rows
  const lens = ownStd(k, { color: 0x2a2620, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.3 });
  const trim = k.std(0xd8d6d0, 0.4, 0.3);
  const rows = Math.max(2, Math.round(d / 2.5));
  for (const lx of [-w / 4, w / 4]) {
    for (let i = 0; i < rows; i++) {
      const lz = -d / 2 + (d * (i + 0.5)) / rows;
      k.torus(0.1, 0.009, trim, lx, -0.004, lz, { rx: Math.PI / 2, seg: 20, cast: false });
      k.mesh(k.geo('infra:downlight', () => new THREE.CircleGeometry(0.09, 20)), lens, lx, -0.002, lz, { rx: Math.PI / 2, cast: false });
    }
  }
  // columns on concrete pedestals along the outer edge
  const n = d <= 10 ? 4 : d <= 14 ? 5 : 6;
  const cx = -w / 2 + 0.35;
  const steel = k.std(0x3c3f42, 0.55, 0.45);
  const ped = k.std(0xb3962c, 0.7, 0.05);
  const colH = -ground - 0.35;
  const rust = decalMat(k, 'streak:rustcol', () => sharedTex('streak:rustcol', () => drawStreak('96,60,30', 12)), { opacity: 0.55 });
  for (let i = 0; i < n; i++) {
    const cz = -d / 2 + 0.6 + ((d - 1.2) * i) / Math.max(1, n - 1);
    k.boxOn(0.46, 0.35, 0.46, ped, cx, ground, cz);
    k.box(0.4, 0.02, 0.4, steel, cx, ground + 0.36, cz);
    for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.012, 0.012, 0.05, steel, cx + bx * 0.15, ground + 0.385, cz + bz * 0.15, { seg: 6 });
    k.rbox(0.25, colH, 0.25, steel, cx, ground + 0.35 + colH / 2, cz, 0.012);
    k.box(0.36, 0.02, 0.36, steel, cx, -0.01, cz);
    k.plane(0.24, 0.9, rust, cx - 0.1255, ground + 0.8, cz, { ry: -Math.PI / 2 });
  }
  const c0 = -d / 2 + 0.6;
  k.tube([[gx, 0.37, c0], [gx, -0.2, c0], [cx - 0.2, -0.35, c0], [cx - 0.2, ground + 0.12, c0], [cx - 0.45, ground + 0.04, c0]], 0.04, fascia, { seg: 8 });
  k.boxOn(0.45, 0.04, 0.3, k.std(0x77756f, 0.95), cx - 0.6, ground, c0);

  const fade = new PowerFade(true, propSeed(k));
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    fade.set(p !== 'blackout');
    lens.emissiveIntensity = 1.6 * fade.step(dt, t, p === 'unstable', gentle(k));
  });
};

/** Yellow steel pipe bollard with reflective bands in a concrete collar. */
const bollard: PropBuilder = (k) => {
  const r = 0.084;
  const h = 1.1;
  const yellow = k.std(0xc39a22, 0.45, 0.25);
  pipe(k, r, h - 0.04, yellow, 'y', 0, (h - 0.04) / 2, 0, { seg: 20 });
  k.sphere(r, yellow, 0, h - 0.04, 0, { seg: 20, sy: 0.45 });
  const tape = k.std(0xdfe3e6, 0.22, 0.35, { emissive: 0x262626, emissiveIntensity: 1 });
  for (const y of [0.84, 0.96]) k.cyl(r + 0.0012, r + 0.0012, 0.05, tape, 0, y, 0, { seg: 20, open: true });
  k.lathe([[r + 0.002, 0.0], [r + 0.11, 0.0], [r + 0.09, 0.035], [r + 0.002, 0.05]], k.std(0x8a8984, 0.95), 0, 0, 0, { seg: 20 });
  const rust = k.std(0x5c3a22, 0.95, 0, { transparent: true, opacity: 0.55, depthWrite: false });
  k.cyl(r + 0.0008, r + 0.0008, 0.18, rust, 0, 0.14, 0, { seg: 20, open: true });
  const scuff = k.std(0x3a3a38, 0.8, 0.3);
  for (let i = 0; i < 4; i++) {
    const a = k.rand() * Math.PI * 2;
    k.box(0.004, 0.02 + k.rand() * 0.06, 0.03 + k.rand() * 0.05, scuff, Math.sin(a) * (r + 0.001), 0.3 + k.rand() * 0.4, Math.cos(a) * (r + 0.001), { ry: a + Math.PI / 2, rx: (k.rand() - 0.5) * 0.6, cast: false });
  }
};

/**
 * Generic exterior window unit on a wall (origin on the wall surface at the window centre, +z out):
 * dark bronze frame, blinds behind tinted glass, a sill; params.w, params.h, params.lit.
 */
const windowUnit: PropBuilder = (k) => {
  const w = k.num('w', 1.2);
  const h = k.num('h', 1.4);
  const lit = k.bool('lit', false);
  const frame = k.std(0x3a3632, 0.42, 0.6);
  const f = 0.055;
  k.rbox(w + 2 * f, f, 0.07, frame, 0, h / 2 + f / 2, 0.035, 0.006);
  k.rbox(w + 2 * f, f, 0.07, frame, 0, -h / 2 - f / 2, 0.035, 0.006);
  k.rbox(f, h, 0.07, frame, -w / 2 - f / 2, 0, 0.035, 0.006);
  k.rbox(f, h, 0.07, frame, w / 2 + f / 2, 0, 0.035, 0.006);
  if (w > 1.0) k.box(0.04, h, 0.05, frame, 0, 0, 0.03);
  const back = lit ? k.std(0x2a2418, 0.9, 0, { emissive: 0x8a7448, emissiveIntensity: 0.45 }) : k.std(0x0b0d10, 0.9);
  k.plane(w, h, back, 0, 0, 0.002);
  const slat = k.std(lit ? 0xb7ae98 : 0x8d8a82, 0.6, 0.1);
  const drop = h * (0.55 + k.rand() * 0.4);
  const bent = Math.floor(k.rand() * 20);
  let i = 0;
  for (let y = h / 2 - 0.02; y > h / 2 - drop; y -= 0.025) {
    k.box(w - 0.01, 0.002, 0.024, slat, 0, y, 0.016, { rx: i === bent ? 0.7 : 0.35, rz: i === bent ? 0.02 : 0, cast: false });
    i++;
  }
  k.box(w - 0.01, 0.012, 0.03, slat, 0, h / 2 - drop, 0.017);
  const glass = k.phys('infra:winglass', { color: 0x1c2328, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.38, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false });
  k.plane(w, h, glass, 0, 0, 0.034, { keep: true });
  k.box(w + 2 * f + 0.06, 0.03, 0.12, k.std(0x7d7b75, 0.85), 0, -h / 2 - f - 0.015, 0.06, { rx: 0.06 });
  const streak = decalMat(k, 'streak:sill', () => sharedTex('streak:sill', () => drawStreak('30,30,28', 13)), { opacity: 0.45 });
  k.plane(w * 0.8, 0.6, streak, 0, -h / 2 - f - 0.33, 0.0008);
};

/** Framed glass partition panel on a base shoe (floor origin); params.w, params.h. */
const glassPartition: PropBuilder = (k) => {
  const w = k.num('w', k.def.footprint?.w ?? 1.2);
  const h = k.num('h', 2.1);
  const alu = k.std(0xa4a8ac, 0.38, 0.75);
  k.boxOn(w, 0.1, 0.07, alu, 0, 0, 0);
  k.box(w, 0.05, 0.05, alu, 0, h - 0.025, 0);
  k.boxOn(0.05, h - 0.1, 0.05, alu, -w / 2 + 0.025, 0.1, 0);
  k.boxOn(0.05, h - 0.1, 0.05, alu, w / 2 - 0.025, 0.1, 0);
  const glass = k.phys('infra:partition', { color: 0xdfece8, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  k.plane(w - 0.1, h - 0.15, glass, 0, 0.1 + (h - 0.15) / 2, 0, { keep: true });
  const frost = k.shared('infra:frost', () => new THREE.MeshStandardMaterial({ map: sharedTex('frost', drawFrost, { repeat: true }), transparent: true, roughness: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  planeRep(k, w - 0.1, 0.12, frost, (w - 0.1) / 0.6, 1, 0, 1.3, 0.004, { keep: true });
  planeRep(k, w - 0.1, 0.12, frost, (w - 0.1) / 0.6, 1, 0, 1.3, -0.004, { keep: true, ry: Math.PI });
};

export const EXTERIOR_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  canopy,
  bollard,
  window: windowUnit,
  glass_partition: glassPartition,
};
