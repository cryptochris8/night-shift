/**
 * Storage and clutter: wire shelving (supplies / chemicals), chart and linen racks, stacked crates
 * and cartons, a leaning step ladder, waste bins, a neglected artificial ficus and the wet-floor sign.
 * Floor props: origin at the floor centre of the footprint; front faces +z.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawBiohazard, drawCardboard, drawChemLabel, drawSmallLabel, drawSpine, drawWetFloor } from './props.infra.tex2';
import { bakeInto, pick, pipe, sharedTex, staging, texMat } from './props.infra.util';

function footprint(k: PropKit, w: number, d: number): { L: number; D: number } {
  const fp = k.def.footprint ?? { w, d };
  return { L: Math.max(fp.w, fp.d), D: Math.min(fp.w, fp.d) };
}

const cartonMat = (k: PropKit, v: number): THREE.MeshStandardMaterial => texMat(k, `carton:${v % 8}`, () => sharedTex(`carton:${v % 8}`, () => drawCardboard(v % 8)), { roughness: 0.92 });

/** Cardboard carton sitting on y, with a tape strip across the top. */
function carton(k: PropKit, w: number, h: number, d: number, x: number, y: number, z: number, ry: number, v: number, parent?: THREE.Object3D): void {
  k.rbox(w, h, d, cartonMat(k, v), x, y + h / 2, z, 0.005, { ry, parent });
  k.box(w + 0.002, 0.0015, 0.05, k.std(0xb89a6a, 0.45), x, y + h + 0.0008, z, { ry, parent, cast: false });
}

/** Grey stacking tote, open top, moulded ribs and hand slots. */
function tote(k: PropKit, w: number, h: number, d: number, x: number, y: number, z: number, ry: number, color: number, parent?: THREE.Object3D): void {
  const g = staging();
  const m = k.std(color, 0.62, 0.02);
  const t = 0.008;
  k.boxOn(w, t, d, m, 0, 0, 0, { parent: g });
  k.boxOn(w, h, t, m, 0, 0, d / 2 - t / 2, { parent: g });
  k.boxOn(w, h, t, m, 0, 0, -d / 2 + t / 2, { parent: g });
  k.boxOn(t, h, d, m, w / 2 - t / 2, 0, 0, { parent: g });
  k.boxOn(t, h, d, m, -w / 2 + t / 2, 0, 0, { parent: g });
  k.box(w + 0.01, 0.016, 0.018, m, 0, h - 0.008, d / 2 - 0.004, { parent: g });
  k.box(w + 0.01, 0.016, 0.018, m, 0, h - 0.008, -d / 2 + 0.004, { parent: g });
  k.box(0.018, 0.016, d, m, w / 2 - 0.004, h - 0.008, 0, { parent: g });
  k.box(0.018, 0.016, d, m, -w / 2 + 0.004, h - 0.008, 0, { parent: g });
  for (let rx = -w / 2 + 0.06; rx < w / 2 - 0.04; rx += 0.08) k.boxOn(0.012, h - 0.03, 0.006, m, rx, 0.01, d / 2 + 0.002, { parent: g });
  const slot = k.std(0x0c0c0c, 0.9);
  for (const sx of [-1, 1]) k.plane(0.1, 0.03, slot, sx * (w / 2 + 0.0005), h - 0.05, 0, { ry: sx * Math.PI / 2, parent: g });
  g.position.set(x, y, z);
  g.rotation.y = ry;
  bakeInto(k, g, parent ?? k.group);
}

/** Folded linen stack. */
function linen(k: PropKit, w: number, d: number, n: number, x: number, y: number, z: number, color: number, parent?: THREE.Object3D): number {
  const m = k.std(color, 0.95);
  let yy = y;
  for (let i = 0; i < n; i++) {
    const hh = 0.035 + k.rand() * 0.015;
    k.rbox(w - k.rand() * 0.02, hh, d - k.rand() * 0.02, m, x + (k.rand() - 0.5) * 0.015, yy + hh / 2, z + (k.rand() - 0.5) * 0.015, 0.012, { parent });
    yy += hh;
  }
  return yy;
}

// ---------------------------------------------------------------------------
// Shelving
// ---------------------------------------------------------------------------

const CHEMS: [string, string, number, boolean][] = [
  ['QUAT DISINFECTANT', '#1f5fa8', 0xe9ecef, true],
  ['NEUTRAL FLOOR CLEANER', '#2e7d4f', 0xdfe6d8, false],
  ['GLASS CLEANER', '#3a8fb8', 0x9ec9e0, false],
  ['FLOOR STRIPPER', '#b3261e', 0xe0d4b8, true],
  ['BLEACH 6%', '#d9a21c', 0xf1f1ec, true],
  ['ODOR COUNTERACTANT', '#6f3a8a', 0xd8cfe4, false],
];

function jug(k: PropKit, x: number, y: number, z: number, idx: number): void {
  const [name, band, body, hazard] = CHEMS[idx % CHEMS.length];
  const m = k.std(body, 0.45, 0, { transparent: body === 0x9ec9e0, opacity: 0.85 });
  k.rbox(0.15, 0.25, 0.15, m, x, y + 0.125, z, 0.03);
  k.cyl(0.022, 0.026, 0.04, m, x - 0.035, y + 0.27, z, { seg: 10 });
  k.cyl(0.025, 0.025, 0.025, k.std(0x1d4f8f, 0.5), x - 0.035, y + 0.3, z, { seg: 10 });
  k.torus(0.035, 0.009, m, x + 0.035, y + 0.24, z, { arc: Math.PI, seg: 10, ry: Math.PI / 2 });
  const lbl = texMat(k, `chem:${name}`, () => sharedTex(`chem:${name}`, () => drawChemLabel(name, band, hazard)), { roughness: 0.6 });
  k.plane(0.11, 0.13, lbl, x, y + 0.12, z + 0.0755);
}

function pail(k: PropKit, x: number, y: number, z: number, color: number): void {
  const m = k.std(color, 0.55);
  k.lathe([[0.13, 0], [0.135, 0.02], [0.155, 0.36], [0.162, 0.37], [0.162, 0.385], [0, 0.39]], m, x, y, z, { seg: 18 });
  k.torus(0.15, 0.003, k.std(0x8d9296, 0.4, 0.8), x, y + 0.3, z, { arc: Math.PI, seg: 12, rz: 0 });
}

function supplyBin(k: PropKit, x: number, y: number, z: number, d: number, kind: number): void {
  const bin = k.std(kind % 2 ? 0x2d4c74 : 0x3b6f9a, 0.55);
  k.boxOn(0.24, 0.006, d, bin, x, y, z);
  k.boxOn(0.006, 0.14, d, bin, x - 0.117, y, z);
  k.boxOn(0.006, 0.14, d, bin, x + 0.117, y, z);
  k.boxOn(0.24, 0.16, 0.006, bin, x, y, z - d / 2 + 0.003);
  k.boxOn(0.24, 0.08, 0.006, bin, x, y, z + d / 2 - 0.003);
  const lbls = [['IV SODIUM CHLORIDE', '0.9%  1000 mL'], ['NITRILE GLOVES', 'SIZE M'], ['GAUZE 4x4', 'STERILE'], ['IV START KITS'], ['SALINE FLUSH', '10 mL']];
  const t = lbls[kind % lbls.length];
  const lbl = texMat(k, `bin:${t.join('|')}`, () => sharedTex(`bin:${t.join('|')}`, () => drawSmallLabel(t, { w: 160, h: 64 })), { roughness: 0.6 });
  k.plane(0.12, 0.048, lbl, x, y + 0.045, z + d / 2 + 0.0005);
  if (kind % lbls.length === 0) {
    const bag = k.std(0xdfe8ea, 0.15, 0, { transparent: true, opacity: 0.55 });
    for (let i = 0; i < 4; i++) k.rbox(0.18, 0.03, d * 0.7, bag, x + (k.rand() - 0.5) * 0.02, y + 0.03 + i * 0.03, z - 0.02, 0.012, { rz: (k.rand() - 0.5) * 0.15 });
  } else {
    const box = k.std(kind % 3 ? 0x5b3f8a : 0x2f6fa8, 0.6);
    for (let i = 0; i < 3; i++) k.rbox(0.2, 0.07, 0.11, box, x, y + 0.042 + i * 0.0, z - d / 2 + 0.07 + i * 0.12, 0.006);
  }
}

/** Fill one tier with deterministic clutter, leaving gaps the night shift has not restocked. */
function stock(k: PropKit, chem: boolean, L: number, D: number, y: number, top: number, tier: number): void {
  const end = L / 2 - 0.04;
  let x = -L / 2 + 0.05;
  while (x < end - 0.1) {
    if (k.rand() < 0.16) {
      x += 0.12 + k.rand() * 0.25;
      continue;
    }
    const r = k.rand();
    if (chem) {
      if (tier === 0 && r < 0.5) {
        if (x + 0.34 > end) break;
        pail(k, x + 0.17, y, 0, pick(k.rand, [0xe6e3dc, 0xd06a1c, 0x2d4c74]));
        x += 0.36;
      } else if (r < 0.75) {
        if (x + 0.16 > end) break;
        jug(k, x + 0.08, y, D / 2 - 0.11, Math.floor(k.rand() * CHEMS.length));
        x += 0.18;
      } else {
        if (x + 0.09 > end) break;
        const m = k.std(pick(k.rand, [0xe9ecef, 0x3a8fb8, 0x2e7d4f]), 0.4);
        k.cyl(0.035, 0.04, 0.2, m, x + 0.04, y + 0.1, 0.12, { seg: 10 });
        k.rbox(0.03, 0.06, 0.07, k.std(0x1d1e20, 0.5), x + 0.04, y + 0.23, 0.13, 0.008);
        x += 0.1;
      }
      continue;
    }
    if (top < 0.5 && r < 0.5) {
      const w = 0.3 + k.rand() * 0.15;
      if (x + w > end) break;
      const h = Math.min(top - 0.03, 0.2 + k.rand() * 0.18);
      carton(k, w, h, Math.min(D - 0.08, 0.32 + k.rand() * 0.1), x + w / 2, y, 0, (k.rand() - 0.5) * 0.08, Math.floor(k.rand() * 8));
      x += w + 0.02;
    } else if (r < 0.35) {
      if (x + 0.34 > end) break;
      linen(k, 0.34, Math.min(D - 0.1, 0.3), 3 + Math.floor(k.rand() * 4), x + 0.17, y, 0, pick(k.rand, [0xe8e8e2, 0xe8e8e2, 0x9db4c8, 0xd8e0d4]));
      x += 0.37;
    } else if (r < 0.75) {
      if (x + 0.24 > end) break;
      supplyBin(k, x + 0.12, y, 0, Math.min(D - 0.08, 0.4), Math.floor(k.rand() * 5));
      x += 0.26;
    } else {
      const w = 0.25 + k.rand() * 0.15;
      if (x + w > end) break;
      const h = Math.min(top - 0.03, 0.15 + k.rand() * 0.2);
      carton(k, w, h, Math.min(D - 0.08, 0.3), x + w / 2, y, 0, (k.rand() - 0.5) * 0.1, Math.floor(k.rand() * 8));
      x += w + 0.03;
    }
  }
}

/** Four-tier wire shelving, long along local x (footprint length x depth); params.kind 'chemicals'. */
const shelf: PropBuilder = (k) => {
  const { L, D } = footprint(k, 3.0, 0.5);
  const chem = k.str('kind', '') === 'chemicals';
  const H = 1.85;
  const units = Math.max(1, Math.ceil(L / 1.53));
  const uL = L / units;
  const tiers = [0.14, 0.66, 1.2, 1.76];
  const wire = chem ? k.std(0x56645b, 0.5, 0.35) : k.std(0xc4c8cc, 0.26, 0.9);
  const foot = k.std(0x1b1c1e, 0.6);
  const pz = D / 2 - 0.0125;
  for (let u = 0; u <= units; u++) {
    const x = -L / 2 + 0.0125 + u * (uL - 0.025 / units);
    for (const z of [-pz, pz]) {
      pipe(k, 0.0125, H - 0.02, wire, 'y', x, 0.02 + (H - 0.02) / 2, z, { seg: 8 });
      k.cyl(0.016, 0.019, 0.02, foot, x, 0.01, z, { seg: 8 });
      for (const ty of tiers) k.cyl(0.017, 0.015, 0.035, wire, x, ty - 0.012, z, { seg: 8 });
    }
  }
  for (const ty of tiers) {
    for (let u = 0; u < units; u++) {
      const cx = -L / 2 + (u + 0.5) * uL;
      const w = uL - 0.03;
      k.box(w, 0.026, 0.004, wire, cx, ty - 0.013, pz);
      k.box(w, 0.026, 0.004, wire, cx, ty - 0.013, -pz);
      k.box(0.006, 0.006, D - 0.03, wire, cx - w / 2, ty - 0.003, 0);
      k.box(0.006, 0.006, D - 0.03, wire, cx + w / 2, ty - 0.003, 0);
      for (let x = cx - w / 2 + 0.03; x < cx + w / 2 - 0.02; x += 0.05) k.box(0.0035, 0.0035, D - 0.03, wire, x, ty - 0.002, 0, { cast: false });
      for (const z of [-D / 4, D / 4]) k.box(w, 0.004, 0.004, wire, cx, ty - 0.012, z, { cast: false });
    }
  }
  tiers.forEach((ty, i) => {
    const top = i < tiers.length - 1 ? tiers[i + 1] - ty - 0.04 : 0.42;
    stock(k, chem, L, D, ty, top, i);
  });
  if (chem) {
    const spill = k.std(0x1a1712, 0.2, 0, { transparent: true, opacity: 0.5, depthWrite: false });
    k.mesh(k.own(new THREE.CircleGeometry(0.22, 18)), spill, L * 0.2, 0.0015, 0.05, { rx: -Math.PI / 2, cast: false });
  }
};

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

/** Wall chart rack (origin on the wall at its vertical centre): two rows of patient binders, spines out. */
function chartRack(k: PropKit): void {
  const W = 0.62;
  const H = 0.78;
  const D = 0.3;
  const steel = k.std(0xb3b0a6, 0.5, 0.35);
  k.box(W, H, 0.006, steel, 0, 0, 0.003);
  for (const sx of [-1, 1]) k.box(0.008, H, D, steel, sx * (W / 2 - 0.004), 0, D / 2);
  const labels = ['BAY 1', 'BAY 2', 'BAY 3', 'BAY 4', 'TX 1', 'TRIAGE', 'HALL A', 'HALL B', 'OBS', 'ADMIT'];
  const colors = ['#8f1f1a', '#1f3f7a', '#2e6b3a', '#1d1d1d', '#7a5a1f'];
  for (let row = 0; row < 2; row++) {
    const y0 = H / 2 - 0.02 - (row + 1) * 0.37;
    k.box(W - 0.016, 0.006, D, steel, 0, y0, D / 2, { rx: 0.0 });
    k.box(W - 0.016, 0.04, 0.006, steel, 0, y0 + 0.02, D - 0.003);
    for (let i = 0; i < 5; i++) {
      const idx = row * 5 + i;
      if ((idx === 3 || idx === 8) && k.rand() < 0.85) continue;
      const x = -W / 2 + 0.06 + i * 0.115;
      const col = colors[idx % colors.length];
      const m = k.std(new THREE.Color(col).getHex(), 0.55);
      const lean = (k.rand() - 0.5) * 0.06;
      k.rbox(0.05, 0.3, D - 0.04, m, x, y0 + 0.155, D / 2 - 0.005, 0.006, { rz: lean });
      const spine = texMat(k, `spine:${labels[idx]}`, () => sharedTex(`spine:${labels[idx]}`, () => drawSpine(col, labels[idx])), { roughness: 0.55 });
      k.plane(0.048, 0.29, spine, x - Math.sin(lean) * 0.0, y0 + 0.155, D - 0.024, { rz: lean });
    }
  }
}

/** Covered linen cart: chrome frame on casters, vinyl cover with the front flap rolled half up. */
function linenRack(k: PropKit): void {
  const { L: W, D } = footprint(k, 1.2, 0.5);
  const H = 1.72;
  const chrome = k.std(0xc4c8cc, 0.26, 0.9);
  const black = k.std(0x1a1a1b, 0.6);
  const base = 0.14;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (W / 2 - 0.04);
    const z = sz * (D / 2 - 0.04);
    pipe(k, 0.012, H - base, chrome, 'y', x, base + (H - base) / 2, z, { seg: 8 });
    k.cyl(0.006, 0.006, 0.05, chrome, x, base - 0.03, z, { seg: 6 });
    k.box(0.02, 0.06, 0.05, chrome, x, 0.075, z);
    k.cyl(0.048, 0.048, 0.028, black, x, 0.05, z + 0.012, { axis: 'x', seg: 14 });
  }
  for (const y of [base + 0.04, 0.62, 1.12]) k.box(W - 0.06, 0.012, D - 0.06, chrome, 0, y, 0);
  const vinyl = k.std(0x2a3a52, 0.58, 0.02);
  const t = 0.006;
  k.box(W + 0.03, t, D + 0.03, vinyl, 0, H + 0.01, 0);
  k.boxOn(W + 0.03, H - 0.2, t, vinyl, 0, 0.22, -D / 2 - 0.012);
  k.boxOn(t, H - 0.2, D + 0.03, vinyl, -W / 2 - 0.012, 0.22, 0);
  k.boxOn(t, H - 0.2, D + 0.03, vinyl, W / 2 + 0.012, 0.22, 0);
  const rollY = 0.95;
  k.boxOn(W + 0.03, H - rollY, t, vinyl, 0, rollY, D / 2 + 0.012);
  k.cyl(0.045, 0.045, W - 0.04, vinyl, 0, rollY, D / 2 + 0.05, { axis: 'x', seg: 14 });
  for (const sx of [-0.3, 0.3]) k.box(0.04, 0.12, 0.004, k.std(0x1c1c1d, 0.7), sx * W, rollY + 0.02, D / 2 + 0.097);
  k.box(W + 0.034, 0.02, D + 0.034, k.std(0x1f2b3d, 0.6), 0, 0.22, 0);
  for (const [y, n] of [[base + 0.046, 3], [0.626, 3]] as const) {
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.2 + i * ((W - 0.4) / (n - 1));
      linen(k, 0.3, D - 0.14, 3 + Math.floor(k.rand() * 4), x, y, 0.02, pick(k.rand, [0xe9e9e3, 0xe9e9e3, 0xa9bfd2, 0xe2e6dc]));
    }
  }
  k.tube([[W / 2 + 0.01, 0.9, -0.15], [W / 2 + 0.06, 0.95, -0.15], [W / 2 + 0.06, 0.95, 0.15], [W / 2 + 0.01, 0.9, 0.15]], 0.012, chrome, { seg: 8 });
}

const rack: PropBuilder = (k) => {
  if (k.str('kind', 'linen') === 'charts') chartRack(k);
  else linenRack(k);
};

// ---------------------------------------------------------------------------
// Crates, ladder
// ---------------------------------------------------------------------------

/** Stacked totes and cartons filling the footprint, a little askew. */
const crates: PropBuilder = (k) => {
  const fp = k.def.footprint ?? { w: 0.9, d: 0.6 };
  const W = fp.w;
  const D = fp.d;
  const colors = [0x5d6266, 0x2d4c74, 0x1f2124, 0x6a6e62];
  const pair = W >= 0.85;
  const bw = pair ? W / 2 - 0.03 : W - 0.06;
  const bd = D - 0.06;
  let topY = 0;
  for (let i = 0; i < (pair ? 2 : 1); i++) {
    const x = pair ? (i ? W / 4 : -W / 4) : 0;
    const h = 0.28 + k.rand() * 0.06;
    if (k.rand() < 0.55) tote(k, bw, h, bd, x, 0, 0, (k.rand() - 0.5) * 0.06, pick(k.rand, colors));
    else carton(k, bw, h, bd, x, 0, 0, (k.rand() - 0.5) * 0.06, Math.floor(k.rand() * 8));
    topY = Math.max(topY, h);
  }
  const h2 = 0.24 + k.rand() * 0.1;
  const w2 = Math.min(W - 0.1, 0.5 + k.rand() * 0.2);
  const x2 = (k.rand() - 0.5) * (W - w2) * 0.6;
  if (k.rand() < 0.5) carton(k, w2, h2, bd - 0.05, x2, topY, 0.01, (k.rand() - 0.5) * 0.25, Math.floor(k.rand() * 8));
  else tote(k, w2, h2, bd - 0.05, x2, topY, 0.01, (k.rand() - 0.5) * 0.2, pick(k.rand, colors));
  if (k.rand() < 0.6) {
    const w3 = 0.25 + k.rand() * 0.1;
    carton(k, w3, 0.16 + k.rand() * 0.08, 0.22 + k.rand() * 0.08, x2 + (k.rand() - 0.5) * 0.1, topY + h2, 0, (k.rand() - 0.5) * 0.5, Math.floor(k.rand() * 8));
  } else {
    // a coiled orange extension cord dumped on top
    const cord = k.std(0xd0661c, 0.6);
    for (let i = 0; i < 3; i++) k.torus(0.09 - i * 0.004, 0.011, cord, x2 + i * 0.006, topY + h2 + 0.012 + i * 0.016, i * 0.005, { rx: Math.PI / 2, seg: 18 });
  }
};

/**
 * Closed 6 ft fibreglass step ladder leaning back against a wall. Feet at local z = +0.12; the top
 * cap rests just short of a wall at local z = -0.2.
 */
const ladder: PropBuilder = (k) => {
  const st = staging();
  const o = { parent: st };
  const rail = k.std(0xc39a22, 0.5, 0.05);
  const alu = k.std(0xa4a8ac, 0.4, 0.75);
  const black = k.std(0x161718, 0.7);
  const H = 1.83;
  for (const sx of [-1, 1]) {
    k.boxOn(0.026, H - 0.02, 0.075, rail, sx * 0.21, 0.02, 0, o);
    k.boxOn(0.05, 0.04, 0.09, black, sx * 0.21, 0, 0, o);
    k.boxOn(0.024, H - 0.1, 0.05, rail, sx * 0.2, 0.02, -0.065, o);
    k.boxOn(0.045, 0.04, 0.06, black, sx * 0.2, 0, -0.065, o);
    k.box(0.012, 0.42, 0.02, alu, sx * 0.235, 1.08, -0.03, { rx: 0.08, ...o });
  }
  for (let i = 1; i <= 5; i++) {
    const y = i * 0.3;
    k.box(0.4, 0.024, 0.085, alu, 0, y, 0.004, o);
    for (let r = -1; r <= 1; r++) k.box(0.4, 0.004, 0.006, alu, 0, y + 0.014, r * 0.025, o);
  }
  for (const y of [0.55, 1.05]) k.box(0.38, 0.018, 0.01, alu, 0, y, -0.065, o);
  k.box(0.012, 0.6, 0.008, alu, 0, 0.8, -0.065, { rz: 0.62, ...o });
  k.rbox(0.47, 0.06, 0.16, k.std(0x3a3d40, 0.6), 0, H + 0.01, -0.03, 0.012, o);
  k.plane(0.12, 0.02, k.std(0x0c0c0c, 0.9), -0.1, H + 0.0405, -0.03, { rx: -Math.PI / 2, ...o });
  k.plane(0.05, 0.05, k.std(0x0c0c0c, 0.9), 0.12, H + 0.0405, -0.03, { rx: -Math.PI / 2, ...o });
  const warn = texMat(k, 'ladderwarn', () => sharedTex('ladderwarn', () => drawSmallLabel(['DANGER', 'DO NOT STAND', 'ON OR ABOVE', 'THIS STEP', '225 LB MAX'], { w: 96, h: 320, bg: '#e6c21f', fg: '#141414' })), { roughness: 0.6 });
  k.plane(0.05, 0.17, warn, -0.21, 1.25, 0.0378, o);
  const paint = k.std(0xe6e4dc, 0.7);
  for (let i = 0; i < 7; i++) k.cyl(0.006 + k.rand() * 0.01, 0.006 + k.rand() * 0.01, 0.001, paint, (k.rand() - 0.5) * 0.3, 0.3 * (1 + Math.floor(k.rand() * 5)) + 0.0125, (k.rand() - 0.5) * 0.05, { seg: 8, ...o });
  st.rotation.x = -0.1;
  st.position.z = 0.12;
  bakeInto(k, st, k.group);
};

// ---------------------------------------------------------------------------
// Bins
// ---------------------------------------------------------------------------

function pedalBin(k: PropKit, size: number, bio: boolean): void {
  const R = size * 0.42;
  const H = Math.max(0.45, Math.min(0.8, size * 1.3));
  const service = k.def.room.startsWith('service') || k.def.room === 'utility' || k.def.room === 'generator';
  const body = bio ? k.std(0xc9c9c4, 0.5) : service ? k.std(0x55595c, 0.6, 0.1) : k.std(0xa9adb1, 0.33, 0.85);
  k.lathe([[0, 0.02], [R * 0.9, 0.02], [R * 0.93, 0.035], [R, H * 0.95], [R * 1.02, H * 0.97], [R * 1.0, H - 0.004], [R * 0.9, H - 0.004]], body, 0, 0, 0, { seg: 24 });
  k.cyl(R * 0.94, R * 0.96, 0.035, k.std(0x1b1c1e, 0.7), 0, 0.0175, 0, { seg: 24 });
  const lid = bio ? k.std(0xa8201a, 0.45) : body;
  k.lathe([[0, H + 0.04], [R * 0.55, H + 0.034], [R * 0.92, H + 0.016], [R * 1.035, H + 0.002], [R * 1.03, H - 0.01]], lid, 0, 0, 0, { seg: 24 });
  k.cyl(R * 1.003, R * 1.003, 0.012, k.std(0x111111, 0.7), 0, H - 0.02, 0, { seg: 24, open: true });
  k.box(0.08, 0.02, 0.04, k.std(0x2a2b2d, 0.5), 0, H - 0.005, -R - 0.012);
  k.rbox(0.09, 0.016, 0.07, k.std(0x1b1c1e, 0.6), 0, 0.03, R + 0.03, 0.005);
  if (bio) {
    const lbl = texMat(k, 'biohazard', () => sharedTex('biohazard', drawBiohazard), { roughness: 0.5 });
    k.mesh(k.geo(`infra:biowrap:${R.toFixed(3)}`, () => new THREE.CylinderGeometry(R * 1.004, R * 1.004, R * 0.9, 12, 1, true, -0.55, 1.1)), lbl, 0, H * 0.55, 0, { cast: false });
  }
}

function wheeledBio(k: PropKit, W: number, D: number): void {
  const H = 0.95;
  const bw = W * 0.86;
  const bd = D * 0.8;
  const body = k.std(0xbfc0bb, 0.55);
  k.rbox(bw, H - 0.06, bd, body, 0, 0.06 + (H - 0.06) / 2, 0, 0.03);
  k.rbox(bw + 0.03, 0.05, bd + 0.04, k.std(0xa8201a, 0.45), 0, H + 0.02, 0.01, 0.015);
  k.cyl(0.02, 0.02, bw + 0.04, k.std(0x8a1a14, 0.5), 0, H + 0.01, -bd / 2 - 0.01, { axis: 'x', seg: 10 });
  for (const sx of [-1, 1]) k.cyl(0.1, 0.1, 0.05, k.std(0x161616, 0.85), sx * (bw / 2 - 0.02), 0.1, -bd / 2 + 0.06, { axis: 'x', seg: 16 });
  k.rbox(0.22, 0.03, 0.08, k.std(0x2a2b2d, 0.5), 0, 0.04, bd / 2 + 0.04, 0.008);
  const lbl = texMat(k, 'biohazard', () => sharedTex('biohazard', drawBiohazard), { roughness: 0.5 });
  k.plane(0.26, 0.26, lbl, 0, H * 0.6, bd / 2 + 0.0015);
  k.plane(0.2, 0.2, lbl, 0, H + 0.046, 0.02, { rx: -Math.PI / 2 });
  const grime = k.std(0x5a554a, 0.9, 0, { transparent: true, opacity: 0.35, depthWrite: false });
  k.plane(bw * 0.9, 0.18, grime, 0, 0.16, bd / 2 + 0.0012);
}

function outdoorBin(k: PropKit, size: number): void {
  const R = size * 0.46;
  const H = 0.9;
  const coat = k.std(0x2a2724, 0.55, 0.45);
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.boxOn(0.045, H - 0.08, 0.012, coat, Math.sin(a) * R, 0.04, Math.cos(a) * R, { ry: a });
  }
  for (const y of [0.06, H * 0.5, H - 0.06]) k.torus(R, 0.012, coat, 0, y, 0, { rx: Math.PI / 2, seg: 28 });
  k.cyl(R * 0.97, R * 0.97, 0.01, k.std(0x121212, 0.9), 0, 0.03, 0, { seg: 20 });
  k.lathe([[0, H + 0.2], [R * 0.4, H + 0.18], [R * 0.8, H + 0.1], [R * 1.04, H], [R * 1.04, H - 0.03]], coat, 0, 0, 0, { seg: 24 });
  k.rbox(R * 0.8, 0.13, 0.12, coat, 0, H + 0.05, R * 0.78, 0.012, { rx: -0.45 });
  k.plane(R * 0.66, 0.085, k.std(0x050505, 0.95), 0, H + 0.05 + 0.0265, R * 0.78 + 0.0555, { rx: -0.45 });
  const rust = k.std(0x5c3a22, 0.95, 0, { transparent: true, opacity: 0.6, depthWrite: false });
  k.cyl(R * 1.02, R * 1.03, 0.12, rust, 0, 0.06, 0, { seg: 24, open: true });
}

const trash: PropBuilder = (k) => {
  const fp = k.def.footprint ?? { w: 0.5, d: 0.5 };
  const size = Math.min(fp.w, fp.d);
  const bio = k.str('kind', '') === 'biohazard';
  if (bio && size >= 0.6) return wheeledBio(k, fp.w, fp.d);
  if (k.def.room === 'exterior' || k.str('kind', '') === 'outdoor') return outdoorBin(k, size);
  pedalBin(k, size, bio);
};

// ---------------------------------------------------------------------------
// Plant
// ---------------------------------------------------------------------------

function leafGeo(k: PropKit): THREE.BufferGeometry {
  return k.geo('infra:leaf', () => {
    const v = [
      0, 0, 0, -0.018, 0.028, 0.003, 0, 0.034, 0.007,
      0, 0, 0, 0, 0.034, 0.007, 0.018, 0.028, 0.003,
      -0.018, 0.028, 0.003, 0, 0.075, 0, 0, 0.034, 0.007,
      0, 0.034, 0.007, 0, 0.075, 0, 0.018, 0.028, 0.003,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
    g.computeVertexNormals();
    return g;
  });
}

/** Artificial ficus in a fibreglass planter: dusty leaves, a few faded ones, some fallen. */
const plant: PropBuilder = (k) => {
  const fp = k.def.footprint ?? { w: 0.6, d: 0.6 };
  const s = Math.min(fp.w, fp.d) / 0.6;
  const pot = k.std(0x3b3d3e, 0.62, 0.05);
  k.lathe([[0.18 * s, 0], [0.2 * s, 0.02], [0.24 * s, 0.4], [0.252 * s, 0.415], [0.252 * s, 0.44], [0.236 * s, 0.44], [0.228 * s, 0.41]], pot, 0, 0, 0, { seg: 28 });
  k.cyl(0.226 * s, 0.226 * s, 0.012, k.std(0x2a2119, 0.95), 0, 0.395, 0, { seg: 24 });
  k.sphere(0.03, k.std(0xe6e4dc, 0.9), 0.09 * s, 0.405, -0.05, { sy: 0.55, seg: 8 });
  const bark = k.std(0x5c4c3c, 0.85);
  const ends: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a0 = (i / 3) * Math.PI * 2 + k.rand() * 0.4;
    const pts: [number, number, number][] = [];
    for (let j = 0; j <= 6; j++) {
      const t = j / 6;
      const a = a0 + t * 2.4;
      const r = 0.025 + t * 0.01;
      pts.push([Math.cos(a) * r, 0.4 + t * 0.75, Math.sin(a) * r]);
    }
    k.tube(pts, 0.012 - i * 0.002, bark, { seg: 6 });
    const last = pts[pts.length - 1];
    for (let b = 0; b < 2; b++) {
      const ba = a0 + b * 2.2 + k.rand();
      const reach = 0.18 + k.rand() * 0.14;
      const end: [number, number, number] = [last[0] + Math.cos(ba) * reach, last[1] + 0.25 + k.rand() * 0.35, last[2] + Math.sin(ba) * reach];
      k.tube([last, [(last[0] + end[0]) / 2, (last[1] + end[1]) / 2 + 0.05, (last[2] + end[2]) / 2], end], 0.006, bark, { seg: 5 });
      ends.push(end);
    }
  }
  const greens = [k.std(0x3a5530, 0.82, 0, { side: THREE.DoubleSide }), k.std(0x4a6638, 0.8, 0, { side: THREE.DoubleSide }), k.std(0x33492c, 0.85, 0, { side: THREE.DoubleSide })];
  const faded = k.std(0x7d7c46, 0.85, 0, { side: THREE.DoubleSide });
  const brown = k.std(0x6b5232, 0.9, 0, { side: THREE.DoubleSide });
  const geo = leafGeo(k);
  for (const e of ends) {
    for (let i = 0; i < 26; i++) {
      const u = k.rand();
      const r = 0.06 + k.rand() * 0.18;
      const a = k.rand() * Math.PI * 2;
      const x = e[0] * (0.6 + 0.4 * u) + Math.cos(a) * r;
      const y = e[1] - 0.25 * (1 - u) + (k.rand() - 0.6) * 0.16;
      const z = e[2] * (0.6 + 0.4 * u) + Math.sin(a) * r;
      const roll = k.rand();
      const mat = roll < 0.06 ? brown : roll < 0.16 ? faded : greens[Math.floor(k.rand() * greens.length)];
      const m = k.mesh(geo, mat, x, y, z, { rx: -0.4 - k.rand() * 1.1, ry: a + Math.PI / 2, rz: (k.rand() - 0.5) * 0.8, cast: true });
      m.scale.setScalar(0.85 + k.rand() * 0.5);
    }
  }
  for (let i = 0; i < 5; i++) {
    const a = k.rand() * Math.PI * 2;
    const r = i < 2 ? 0.1 * s : 0.3 + k.rand() * 0.12;
    const y = i < 2 ? 0.403 : 0.002;
    const m = k.mesh(geo, k.rand() < 0.5 ? brown : faded, Math.cos(a) * r, y, Math.sin(a) * r, { rx: -Math.PI / 2 + 0.08, rz: k.rand() * 6.28, cast: false });
    m.scale.setScalar(0.9 + k.rand() * 0.3);
  }
};

// ---------------------------------------------------------------------------
// Wet floor sign
// ---------------------------------------------------------------------------

function aPanel(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.15, 0);
  s.lineTo(0.15, 0);
  s.lineTo(0.124, 0.585);
  s.quadraticCurveTo(0.118, 0.625, 0.08, 0.625);
  s.lineTo(-0.08, 0.625);
  s.quadraticCurveTo(-0.118, 0.625, -0.124, 0.585);
  s.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-0.05, 0.55);
  hole.lineTo(0.05, 0.55);
  hole.quadraticCurveTo(0.066, 0.566, 0.05, 0.582);
  hole.lineTo(-0.05, 0.582);
  hole.quadraticCurveTo(-0.066, 0.566, -0.05, 0.55);
  s.holes.push(hole);
  return s;
}

/** Yellow A-frame caution sign, both faces printed. */
const wetFloorSign: PropBuilder = (k) => {
  const yellow = k.std(0xcfa31f, 0.5, 0.02);
  const face = texMat(k, 'wetfloor', () => sharedTex('wetfloor', drawWetFloor), { roughness: 0.55 });
  const tilt = 0.19;
  for (const side of [1, -1]) {
    const st = staging();
    k.extrude(aPanel(), 0.007, yellow, 0, 0, -0.0035, { bevel: 0.0015, parent: st });
    k.plane(0.215, 0.43, face, 0, 0.29, 0.0054, { parent: st });
    st.position.z = side * 0.12;
    st.rotation.set(side * -tilt, side > 0 ? 0 : Math.PI, 0);
    bakeInto(k, st, k.group);
  }
  k.cyl(0.006, 0.006, 0.17, k.std(0x2a2b2d, 0.5), 0, 0.62, 0, { axis: 'x', seg: 8 });
};

export const STORAGE_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  shelf,
  rack,
  crates,
  ladder,
  trash,
  plant,
  wet_floor_sign: wetFloorSign,
};
