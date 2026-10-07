/**
 * Seating and tables: molded-shell clinical chair / task chair, linked waiting-room rows, rolling
 * stool, staff-lounge sofa, break and coffee tables. Occupants face +z; rows run along local x.
 */
import type * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { type V3, bar, bev, line, mat, pick, rod, rr, shade, soft, starBase, vary } from './props.clinical.common';

/** Tilt about the part's own x axis, then swivel about y (rotation order YXZ). */
function orient(m: THREE.Mesh, rx: number, ry: number): THREE.Mesh {
  m.rotation.order = 'YXZ';
  m.rotation.set(rx, ry, 0);
  return m;
}

const swivel = (p: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

// ---------------------------------------------------------------------------
// Chairs
// ---------------------------------------------------------------------------

function shellChair(k: PropKit): void {
  const frameM = mat.painted(k, vary(k, 0x53575a, 0.06), 0.45);
  const shell = mat.plastic(k, vary(k, 0x6c767c, 0.05), 0.55);
  const vinyl = mat.vinyl(k, pick(k, [0x3b4d5d, 0x483d43, 0x3d4842]), 0.45);
  const cap = frameM;
  // sled-arm frame: front leg rises into the arm, runs back, drops to the rear leg
  for (const s of [-1, 1]) {
    const x = s * 0.25;
    line(k, [[x, 0.012, 0.23], [x, 0.6, 0.2], [x, 0.635, 0.16], [x, 0.635, -0.12], [x, 0.6, -0.16], [x, 0.012, -0.23]], 0.012, frameM);
    bev(k, 0.05, 0.026, 0.3, cap, x, 0.655, 0.02, 0.008);
    for (const z of [0.23, -0.23]) k.cyl(0.014, 0.014, 0.012, cap, x, 0.006, z, { seg: 8, cast: false });
  }
  line(k, [[-0.25, 0.4, 0.17], [0.25, 0.4, 0.17]], 0.01, frameM, { cast: false });
  line(k, [[-0.25, 0.4, -0.15], [0.25, 0.4, -0.15]], 0.01, frameM, { cast: false });
  for (const s of [-1, 1]) line(k, [[s * 0.15, 0.4, -0.15], [s * 0.15, 0.6, -0.225]], 0.01, frameM, { cast: false });
  // seat: shell pan + vinyl cushion, tipped back a touch
  bev(k, 0.46, 0.03, 0.44, shell, 0, 0.41, 0.02, 0.01, { rx: -0.05 });
  soft(k, 0.44, 0.05, 0.42, vinyl, 0, 0.445, 0.025, 0.02, { rx: -0.05 });
  // back: shell + pad, reclined
  bev(k, 0.44, 0.38, 0.03, shell, 0, 0.68, -0.235, 0.012, { rx: -0.18 });
  bev(k, 0.4, 0.31, 0.035, vinyl, 0, 0.69, -0.21, 0.015, { rx: -0.18 });
}

function taskChair(k: PropKit): void {
  const black = mat.black(k);
  const fabric = mat.fabric(k, pick(k, [0x2f3640, 0x34302e, 0x2b3530]), 0.95);
  const chrome = mat.chrome(k);
  const rub = black;
  starBase(k, { radius: 0.31, hubR: 0.04, hubY: 0.1, tipY: 0.08, legW: 0.045, legH: 0.035, casterR: 0.03, legMat: black, hubMat: black, casterMetal: black, wheelMat: rub });
  k.cyl(0.024, 0.024, 0.2, chrome, 0, 0.25, 0, { seg: 12 });
  k.cyl(0.032, 0.037, 0.12, black, 0, 0.17, 0, { seg: 12 });
  // everything above the gas lift is swivelled to wherever the last user left it
  const a = rr(k, -0.6, 0.6);
  const at = (p: V3): V3 => swivel(p, a);
  orient(bev(k, 0.2, 0.05, 0.22, black, ...at([0, 0.37, 0]), 0.01), 0, a);
  orient(soft(k, 0.48, 0.08, 0.46, fabric, ...at([0, 0.43, 0.02]), 0.035), -0.03, a);
  orient(bev(k, 0.44, 0.02, 0.42, black, ...at([0, 0.385, 0.02]), 0.006), -0.03, a);
  bar(k, at([0.08, 0.36, 0.06]), at([0.22, 0.345, 0.1]), 0.012, 0.012, black, { cast: false });
  // spine and backrest
  bar(k, at([0, 0.37, -0.08]), at([0, 0.38, -0.25]), 0.06, 0.02, black);
  bar(k, at([0, 0.38, -0.25]), at([0, 0.62, -0.28]), 0.06, 0.02, black);
  orient(soft(k, 0.44, 0.46, 0.07, fabric, ...at([0, 0.79, -0.285]), 0.035), -0.12, a);
  orient(bev(k, 0.42, 0.42, 0.02, black, ...at([0, 0.79, -0.326]), 0.008), -0.12, a);
  // T arms
  for (const s of [-1, 1]) {
    bar(k, at([s * 0.19, 0.39, -0.02]), at([s * 0.25, 0.62, -0.01]), 0.04, 0.02, black, { cast: false });
    orient(bev(k, 0.06, 0.03, 0.24, black, ...at([s * 0.25, 0.64, 0.01]), 0.01), 0, a);
  }
}

const chair: PropBuilder = (k) => {
  if (k.bool('office', false)) taskChair(k);
  else shellChair(k);
};

// ---------------------------------------------------------------------------
// Linked waiting-room seating on a steel beam
// ---------------------------------------------------------------------------

const chairRow: PropBuilder = (k) => {
  const n = Math.max(1, Math.round(k.num('count', 3)));
  const sp = k.num('spacing', 0.6);
  const L = n * sp;
  const steel = mat.painted(k, vary(k, 0x3e4245, 0.06), 0.45);
  const base = vary(k, 0x34495a, 0.05);
  const vinylA = mat.vinyl(k, base, 0.45);
  const vinylB = mat.vinyl(k, shade(base, 0.12), 0.62);
  const shell = mat.plastic(k, 0x2b2e31, 0.55);
  const armM = shell;
  // beam and T legs (ends, plus one mid-span leg on long rows)
  bev(k, L - 0.1, 0.06, 0.08, steel, 0, 0.3, -0.02, 0.008);
  const legs = [-L / 2 + 0.12, L / 2 - 0.12];
  if (n >= 4) legs.push(-L / 2 + Math.floor(n / 2) * sp);
  for (const x of legs) {
    bev(k, 0.05, 0.3, 0.05, steel, x, 0.15, -0.02, 0.006);
    bev(k, 0.05, 0.03, 0.52, steel, x, 0.015, -0.02, 0.006);
    for (const z of [-0.26, 0.22]) k.cyl(0.016, 0.016, 0.01, armM, x, 0.005, z, { seg: 8, cast: false });
  }
  // seats: pan, cushion, back shell + pad; some faded, one maybe split
  const torn = k.rand() < 0.4 ? Math.floor(k.rand() * n) : -1;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + sp / 2 + i * sp;
    const v = k.rand() < 0.3 ? vinylB : vinylA;
    bev(k, 0.07, 0.07, 0.07, steel, x, 0.36, -0.02, 0.006, { cast: false });
    bev(k, 0.5, 0.03, 0.46, shell, x, 0.38, 0.02, 0.008);
    soft(k, 0.48, 0.06, 0.44, v, x, 0.42, 0.025, 0.022, { rx: -0.04 });
    bar(k, [x, 0.33, -0.05], [x, 0.56, -0.25], 0.05, 0.02, steel, { cast: false });
    bev(k, 0.5, 0.4, 0.025, shell, x, 0.665, -0.255, 0.01, { rx: -0.15 });
    bev(k, 0.46, 0.34, 0.04, v, x, 0.67, -0.228, 0.016, { rx: -0.15 });
    if (i === torn) k.box(0.12, 0.004, 0.07, mat.plastic(k, 0xb8a77c, 0.9), x + rr(k, -0.1, 0.1), 0.456, 0.12, { ry: rr(k, -0.5, 0.5), rx: -0.04, cast: false });
  }
  // arm rests on every seam
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + i * sp;
    const xi = i === 0 ? x + 0.03 : i === n ? x - 0.03 : x;
    bar(k, [xi, 0.31, -0.02], [xi, 0.62, 0.04], 0.03, 0.03, steel, { cast: false });
    bev(k, 0.055, 0.03, 0.34, armM, xi, 0.635, 0.03, 0.01);
  }
  // somebody's leftovers
  const r = k.rand();
  if (r < 0.35) {
    const x = -L / 2 + sp / 2 + Math.floor(k.rand() * n) * sp;
    k.box(0.3, 0.012, 0.22, mat.paper(k), x + rr(k, -0.06, 0.06), 0.458, 0.05, { ry: rr(k, -0.6, 0.6), rx: -0.04, cast: false });
  } else if (r < 0.6) {
    const x = -L / 2 + sp / 2 + Math.floor(k.rand() * n) * sp;
    const cup = mat.plastic(k, 0xd9d4c7, 0.7);
    k.cyl(0.04, 0.03, 0.11, cup, x + rr(k, -0.15, 0.15), 0.055, rr(k, 0.0, 0.18), { seg: 10, cast: false });
    k.cyl(0.042, 0.042, 0.008, shell, x, 0.11, 0.08, { seg: 10, cast: false });
  }
};

// ---------------------------------------------------------------------------
// Rolling clinical stool
// ---------------------------------------------------------------------------

const stool: PropBuilder = (k) => {
  const black = mat.black(k);
  const chrome = mat.chrome(k);
  const rub = black;
  const vinyl = mat.vinyl(k, pick(k, [0x26292d, 0x34465a]), 0.4);
  const h = k.num('h', 0.56);
  starBase(k, { radius: 0.26, hubR: 0.04, hubY: 0.095, tipY: 0.075, legW: 0.04, legH: 0.03, casterR: 0.028, legMat: black, hubMat: black, casterMetal: black, wheelMat: rub });
  k.cyl(0.032, 0.036, 0.14, black, 0, 0.18, 0, { seg: 12 });
  k.cyl(0.022, 0.022, h - 0.33, chrome, 0, (h + 0.25) / 2 - 0.05, 0, { seg: 12 });
  // foot ring on three spokes
  k.torus(0.19, 0.009, chrome, 0, 0.3, 0, { rx: Math.PI / 2, seg: 28, cast: false });
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.3;
    rod(k, [0, 0.3, 0], [Math.sin(ang) * 0.185, 0.3, Math.cos(ang) * 0.185], 0.007, chrome, { cast: false });
  }
  k.cyl(0.15, 0.15, 0.02, black, 0, h - 0.085, 0, { seg: 16, cast: false });
  bar(k, [0.05, h - 0.1, 0.02], [0.17, h - 0.11, 0.07], 0.012, 0.012, black, { cast: false });
  k.lathe([[0, 0], [0.165, 0], [0.18, 0.015], [0.182, 0.05], [0.17, 0.07], [0.1, 0.079], [0, 0.08]], vinyl, 0, h - 0.078, 0, { seg: 20 });
};

// ---------------------------------------------------------------------------
// Two-seat lounge sofa
// ---------------------------------------------------------------------------

const sofa: PropBuilder = (k) => {
  const W = Math.min(2.4, Math.max(1.2, k.num('w', k.def.footprint?.w ?? 1.8)));
  const D = 0.8;
  const hex = pick(k, [0x4a3a33, 0x39433f, 0x463930]);
  const vinyl = mat.vinyl(k, hex, 0.5);
  const worn = mat.vinyl(k, shade(hex, 0.16), 0.7);
  const plinth = mat.plastic(k, 0x1e1b19, 0.7);
  // plinth on block feet, upholstered deck, arms, back
  bev(k, W - 0.1, 0.1, D - 0.12, plinth, 0, 0.12, 0, 0.01);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bev(k, 0.05, 0.07, 0.05, plinth, sx * (W / 2 - 0.1), 0.035, sz * (D / 2 - 0.1), 0.006, { cast: false });
  soft(k, W - 0.3, 0.16, D - 0.18, vinyl, 0, 0.25, 0.05, 0.04);
  for (const s of [-1, 1]) {
    soft(k, 0.16, 0.42, D - 0.04, vinyl, s * (W / 2 - 0.08), 0.38, 0, 0.06);
    k.box(0.1, 0.004, 0.16, worn, s * (W / 2 - 0.08), 0.592, D / 2 - 0.14, { cast: false });
  }
  soft(k, W - 0.04, 0.5, 0.18, vinyl, 0, 0.55, -D / 2 + 0.09, 0.06);
  // seat and back cushions, compressed unevenly from years of night-shift naps
  const cw = (W - 0.32) / 2;
  for (let i = 0; i < 2; i++) {
    const x = (i - 0.5) * cw;
    const sag = rr(k, 0.012, 0.03);
    soft(k, cw - 0.01, 0.13, D - 0.26, vinyl, x, 0.395 - sag, 0.06, 0.05, { rz: (i ? -1 : 1) * rr(k, 0.01, 0.03), rx: -0.03 });
    soft(k, cw - 0.02, 0.38, 0.14, vinyl, x, 0.6, -D / 2 + 0.24, 0.06, { rx: -0.2 + rr(k, -0.04, 0.03), rz: rr(k, -0.03, 0.03) });
    k.box(0.16, 0.003, 0.12, worn, x + rr(k, -0.1, 0.1), 0.462 - sag, 0.2, { ry: rr(k, -0.4, 0.4), cast: false });
  }
  // a folded fleece and a flattened pillow
  const s = k.rand() < 0.5 ? -1 : 1;
  const fleece = mat.fabric(k, pick(k, [0x6b5b4e, 0x4f5a66]), 0.95);
  soft(k, 0.42, 0.06, 0.34, fleece, s * (W / 2 - 0.36), 0.49, 0.06, 0.02, { ry: rr(k, -0.25, 0.25) });
  soft(k, 0.42, 0.1, 0.3, fleece, -s * (W / 2 - 0.32), 0.53, -0.08, 0.045, { rx: -0.65, rz: s * 0.18 });
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const table: PropBuilder = (k) => {
  const w = k.num('w', k.def.footprint?.w ?? 1.2);
  const d = k.num('d', k.def.footprint?.d ?? 0.8);
  const mags = k.bool('magazines', false);
  const h = k.num('h', mags ? 0.46 : 0.74);
  const lam = mat.plastic(k, vary(k, mags ? 0x6e675a : 0x8f8a7d, 0.05), 0.5);
  const core = mat.plastic(k, 0x2e2c2a, 0.6);
  const steel = core;
  // laminate top on a dark edge-banded core
  bev(k, w, 0.028, d, core, 0, h - 0.016, 0, 0.004);
  k.box(w - 0.012, 0.003, d - 0.012, lam, 0, h - 0.0005, 0, { cast: false });
  const ix = w / 2 - 0.06;
  const iz = d / 2 - 0.06;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box(0.04, h - 0.042, 0.04, steel, sx * ix, (h - 0.03) / 2 + 0.006, sz * iz);
      k.cyl(0.018, 0.018, 0.012, core, sx * ix, 0.006, sz * iz, { seg: 8, cast: false });
    }
    k.box(0.02, 0.06, d - 0.16, steel, sx * ix, h - 0.06, 0, { cast: false });
  }
  for (const sz of [-1, 1]) k.box(w - 0.16, 0.06, 0.02, steel, 0, h - 0.06, sz * iz, { cast: false });
  if (mags) {
    bev(k, w - 0.1, 0.018, d - 0.1, lam, 0, 0.13, 0, 0.003);
    const covers = [mat.paper(k), mat.plastic(k, 0x3b5a7a, 0.6)];
    const count = 6 + Math.floor(k.rand() * 4);
    for (let i = 0; i < count; i++) {
      const onTop = i < count - 2;
      // every magazine at its own height so overlapping covers never z-fight
      const y = onTop ? h + 0.004 + i * 0.0035 : 0.142 + (i % 2) * 0.0065;
      k.box(0.21, 0.006, 0.28, pick(k, covers), rr(k, -w / 2 + 0.15, w / 2 - 0.15), y, rr(k, -d / 2 + 0.16, d / 2 - 0.16), { ry: rr(k, -0.8, 0.8), cast: false });
    }
  } else {
    // a cold coffee, a crumpled napkin, yesterday's paper
    const mugM = mat.plastic(k, pick(k, [0xd8d3c6, 0x7a2f2a, 0x2f4a5f]), 0.4);
    const mx = rr(k, -w / 2 + 0.15, w / 2 - 0.15);
    const mz = rr(k, -d / 2 + 0.12, d / 2 - 0.12);
    k.lathe([[0, 0], [0.04, 0], [0.042, 0.095], [0.038, 0.095], [0.036, 0.008], [0, 0.008]], mugM, mx, h + 0.001, mz, { seg: 14, cast: false });
    k.torus(0.022, 0.006, mugM, mx + 0.048, h + 0.05, mz, { seg: 12, cast: false });
    k.cyl(0.036, 0.036, 0.002, core, mx, h + 0.07, mz, { seg: 14, cast: false });
    const n = k.sphere(0.035, mat.paper(k), rr(k, -w / 3, w / 3), h + 0.015, rr(k, -d / 3, d / 3), { seg: 8, cast: false });
    n.scale.set(1.2, 0.5, 0.9);
    k.box(0.32, 0.01, 0.26, mat.paper(k), rr(k, -w / 4, w / 4), h + 0.005, rr(k, -d / 4, d / 4), { ry: rr(k, -0.6, 0.6), cast: false });
  }
};

export const SEATING_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  chair,
  chair_row: chairRow,
  stool,
  sofa,
  table,
};
