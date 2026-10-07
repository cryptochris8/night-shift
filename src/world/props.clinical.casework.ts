/**
 * Casework: registration / clinical / rear desks and counters (nurse-station transaction counter,
 * kitchenette, plain work counter). Long along local x; the public or usable face is +z.
 * Shared cabinet-run helpers are exported for the storage builders.
 */
import type * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { bev, cablePts, mat, pick, rr, vary } from './props.clinical.common';

export interface CaseMats {
  body: THREE.Material;
  front: THREE.Material;
  top: THREE.Material;
  pull: THREE.Material;
  kick: THREE.Material;
}

export function caseMats(k: PropKit, frontHex?: number, topHex = 0xc4c1b8): CaseMats {
  return {
    body: mat.plastic(k, 0xa39d91, 0.6),
    front: mat.plastic(k, frontHex ?? vary(k, 0xb3ac9d, 0.04), 0.55),
    top: mat.plastic(k, topHex, 0.42),
    pull: mat.stainless(k),
    kick: mat.plastic(k, 0x1f2022, 0.7),
  };
}

/** Bar pull on a face at z (f = side the face looks toward). */
export function pull(k: PropKit, x: number, y: number, z: number, len: number, vertical: boolean, m: THREE.Material, f = 1): void {
  const zz = z + f * 0.024;
  if (vertical) bev(k, 0.011, len, 0.011, m, x, y, zz, 0.004, { cast: false });
  else bev(k, len, 0.011, 0.011, m, x, y, zz, 0.004, { cast: false });
  for (const s of [-1, 1]) {
    const dx = vertical ? 0 : s * (len / 2 - 0.01);
    const dy = vertical ? s * (len / 2 - 0.01) : 0;
    k.box(0.008, 0.008, 0.02, m, x + dx, y + dy, z + f * 0.012, { cast: false });
  }
}

export type Bay = 'door' | 'drawers' | 'drawer_door' | 'sink' | 'open';

export interface BaseRunOpts {
  x0: number;
  x1: number;
  /** plane of the cabinet faces; the carcass extends `depth` behind it */
  zFace: number;
  depth: number;
  height: number;
  /** +1: fronts look toward +z, -1: toward -z */
  f?: 1 | -1;
  bays?: Bay[];
  kick?: number;
}

/** Run of base cabinets: carcass, recessed toe kick, doors and drawers with bar pulls. */
export function baseRun(k: PropKit, M: CaseMats, o: BaseRunOpts): void {
  const f = o.f ?? 1;
  const kick = o.kick ?? 0.1;
  const L = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const h = o.height - kick;
  bev(k, L, h, o.depth - 0.01, M.body, cx, kick + h / 2, o.zFace - f * (o.depth / 2 + 0.005), 0.004);
  k.box(L - 0.01, kick, o.depth - 0.08, M.kick, cx, kick / 2, o.zFace - f * (0.075 + (o.depth - 0.08) / 2), { cast: false });
  const bays = o.bays ?? ['drawer_door'];
  const bw = L / bays.length;
  const fz = o.zFace + f * 0.009;
  bays.forEach((bay, i) => {
    const bx = o.x0 + bw * (i + 0.5);
    const w = bw - 0.006;
    const y0 = kick + 0.003;
    const y1 = o.height - 0.003;
    const hingeLeft = i % 2 === 0;
    const door = (top: number, bottom: number, x: number, dw: number, left: boolean): void => {
      bev(k, dw, top - bottom, 0.018, M.front, x, (top + bottom) / 2, fz, 0.003);
      pull(k, x + (left ? 1 : -1) * (dw / 2 - 0.04), top - 0.1, o.zFace + f * 0.018, 0.1, true, M.pull, f);
    };
    switch (bay) {
      case 'open':
        k.box(w, h - 0.02, 0.01, M.kick, bx, kick + h / 2, o.zFace - f * (o.depth - 0.03), { cast: false });
        break;
      case 'drawers': {
        const n = 4;
        const dh = (y1 - y0) / n;
        for (let j = 0; j < n; j++) {
          const yc = y0 + dh * (j + 0.5);
          bev(k, w, dh - 0.006, 0.018, M.front, bx, yc, fz, 0.003);
          pull(k, bx, yc + dh * 0.22, o.zFace + f * 0.018, Math.min(0.16, w * 0.4), false, M.pull, f);
        }
        break;
      }
      case 'sink':
        bev(k, w, 0.14, 0.018, M.front, bx, y1 - 0.07, fz, 0.003);
        door(y1 - 0.146, y0, bx - bw / 4, bw / 2 - 0.006, true);
        door(y1 - 0.146, y0, bx + bw / 4, bw / 2 - 0.006, false);
        break;
      case 'door':
        door(y1, y0, bx, w, hingeLeft);
        break;
      default: {
        bev(k, w, 0.15, 0.018, M.front, bx, y1 - 0.075, fz, 0.003);
        pull(k, bx, y1 - 0.075, o.zFace + f * 0.018, Math.min(0.16, w * 0.4), false, M.pull, f);
        door(y1 - 0.156, y0, bx, w, hingeLeft);
      }
    }
  });
}

/** Wall cabinets: carcass hung off the wall at zBack, doors on the room-side face, pulls low. */
export function upperRun(k: PropKit, M: CaseMats, o: { x0: number; x1: number; zBack: number; depth: number; y0: number; y1: number; f?: 1 | -1 }): void {
  const f = o.f ?? 1;
  const L = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const h = o.y1 - o.y0;
  bev(k, L, h, o.depth - 0.018, M.body, cx, (o.y0 + o.y1) / 2, o.zBack + f * (o.depth - 0.018) / 2, 0.004);
  const n = Math.max(1, Math.round(L / 0.42));
  const dw = L / n;
  const fz = o.zBack + f * (o.depth - 0.009);
  for (let i = 0; i < n; i++) {
    const x = o.x0 + dw * (i + 0.5);
    bev(k, dw - 0.006, h - 0.006, 0.018, M.front, x, (o.y0 + o.y1) / 2, fz, 0.003);
    pull(k, x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), o.y0 + 0.09, o.zBack + f * o.depth, 0.1, true, M.pull, f);
  }
}

/** A little paperwork: a few sheets, a clipboard or a binder, scattered around (x, y, z). */
function paperwork(k: PropKit, x: number, y: number, z: number, spread: number): void {
  const paper = mat.paper(k);
  for (let i = 0; i < 3; i++) k.box(0.21, 0.002, 0.297, paper, x + rr(k, -spread, spread), y + 0.001 + i * 0.002, z + rr(k, -0.05, 0.05), { ry: rr(k, -0.5, 0.5), cast: false });
  const r = k.rand();
  if (r < 0.5) {
    const board = mat.plastic(k, 0x4a3b2c, 0.6);
    const ry = rr(k, -0.4, 0.4);
    const bx = x + rr(k, -spread, spread);
    k.box(0.23, 0.005, 0.32, board, bx, y + 0.01, z, { ry, cast: false });
    k.box(0.2, 0.002, 0.27, paper, bx, y + 0.014, z + 0.015, { ry, cast: false });
    k.box(0.08, 0.012, 0.03, mat.satin(k), bx, y + 0.018, z - 0.14, { ry, cast: false });
  } else {
    const binder = mat.plastic(k, pick(k, [0x2f4b6e, 0x6e2f2f, 0x2f5a3e, 0x2b2b2b]), 0.5);
    bev(k, 0.06, 0.3, 0.26, binder, x + rr(k, -spread, spread), y + 0.15, z, 0.006, { rz: rr(k, -0.15, 0.15) });
  }
}

// ---------------------------------------------------------------------------
// Desks
// ---------------------------------------------------------------------------

const desk: PropBuilder = (k) => {
  const kind = k.str('kind', 'clinical');
  if (kind === 'registration') registrationDesk(k);
  else if (kind === 'back') backCounter(k);
  else clinicalDesk(k);
};

/** Reception desk: high public front with a transaction top (+z), glass sneeze guard, staff work surface behind. */
function registrationDesk(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 2.4);
  const D = k.num('d', k.def.footprint?.d ?? 1.0);
  const M = caseMats(k, vary(k, 0x7d6650, 0.04), 0xb9b6ad);
  const alu = mat.satin(k);
  const zF = D / 2;
  // public front, kick, transaction top
  bev(k, L, 0.96, 0.04, M.front, 0, 0.58, zF - 0.02, 0.006);
  k.box(L - 0.02, 0.1, 0.03, M.kick, 0, 0.05, zF - 0.055, { cast: false });
  k.box(L, 0.012, 0.004, alu, 0, 0.72, zF + 0.001, { cast: false });
  bev(k, L + 0.04, 0.03, 0.34, M.top, 0, 1.075, zF - 0.13, 0.008);
  bev(k, L, 0.33, 0.03, M.body, 0, 0.925, zF - 0.29, 0.004);
  // gables, staff work surface, drawer pedestal, modesty return
  for (const s of [-1, 1]) bev(k, 0.035, 1.06, D - 0.04, M.front, s * (L / 2 - 0.0175), 0.53, -0.02, 0.006);
  bev(k, L - 0.07, 0.03, D - 0.34, M.top, 0, 0.745, -0.17, 0.006);
  baseRun(k, M, { x0: L / 2 - 0.49, x1: L / 2 - 0.035, zFace: -D / 2 + 0.02, depth: D - 0.38, height: 0.73, f: -1, bays: ['drawers'], kick: 0.06 });
  // sneeze guard: glass on posts with a pass-through slot, frosted privacy band
  const gz = zF - 0.2;
  const glass = mat.glass(k);
  const frost = k.phys('clin:frost', { color: 0xdfe6e6, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false, side: 2 });
  const posts = [-L / 2 + 0.03, 0, L / 2 - 0.03];
  for (const x of posts) bev(k, 0.03, 0.66, 0.03, alu, x, 1.42, gz, 0.004);
  bev(k, L, 0.03, 0.04, alu, 0, 1.765, gz, 0.004);
  k.box(L - 0.06, 0.52, 0.008, glass, 0, 1.49, gz, { cast: false });
  k.box(L - 0.06, 0.14, 0.009, frost, 0, 1.32, gz, { cast: false });
  for (const s of [-1, 1]) k.box(0.01, 0.42, D * 0.55, frost, s * (L / 2 - 0.015), 1.3, -0.1, { cast: false });
  // on the transaction top: a bell, a sign-in clipboard with a pen on a chain, sanitizer pump
  const bx = rr(k, -L / 4, L / 4);
  k.cyl(0.04, 0.045, 0.012, M.kick, bx, 1.096, zF - 0.1, { seg: 14, cast: false });
  const bell = k.sphere(0.035, mat.chrome(k), bx, 1.102, zF - 0.1, { seg: 12, cast: false });
  bell.scale.set(1, 0.62, 1);
  k.cyl(0.005, 0.005, 0.012, mat.chrome(k), bx, 1.13, zF - 0.1, { seg: 6, cast: false });
  const cbx = bx + (bx > 0 ? -0.45 : 0.45);
  k.box(0.23, 0.005, 0.32, mat.plastic(k, 0x4a3b2c, 0.6), cbx, 1.093, zF - 0.12, { ry: rr(k, -0.2, 0.2), cast: false });
  k.box(0.2, 0.002, 0.27, mat.paper(k), cbx, 1.097, zF - 0.105, { cast: false });
  k.tube(cablePts([cbx + 0.14, 1.095, zF - 0.2], [cbx + 0.2, 1.093, zF - 0.05], 0.0, 4), 0.003, alu, { cast: false });
  k.lathe([[0, 0], [0.032, 0], [0.032, 0.14], [0.012, 0.16], [0.012, 0.19], [0, 0.19]], mat.plastic(k, 0xdedcd4, 0.4), L / 2 - 0.2, 1.09, zF - 0.14, { seg: 12, cast: false });
  // staff side clutter
  paperwork(k, -L / 2 + 0.45, 0.76, -0.2, 0.15);
}

/** Workstation desk: laminate top, three-drawer pedestal, panel leg, modesty panel. */
function clinicalDesk(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 1.4);
  const D = k.num('d', k.def.footprint?.d ?? 0.7);
  const H = 0.78;
  const M = caseMats(k);
  bev(k, L, 0.028, D, M.top, 0, H - 0.014, 0, 0.004);
  baseRun(k, M, { x0: -L / 2 + 0.01, x1: -L / 2 + 0.45, zFace: D / 2 - 0.02, depth: D - 0.06, height: H - 0.03, bays: ['drawers'], kick: 0.06 });
  bev(k, 0.03, H - 0.03, D - 0.04, M.front, L / 2 - 0.025, (H - 0.03) / 2, 0, 0.005);
  bev(k, L - 0.5, 0.42, 0.02, M.front, 0.22, H - 0.26, -D / 2 + 0.03, 0.004);
  // a glove box, a pen cup, a few forms
  const gl = mat.plastic(k, pick(k, [0x6a5fa6, 0x4a7fb0, 0xd8d6cf]), 0.6);
  bev(k, 0.25, 0.065, 0.125, gl, L / 2 - 0.2, H + 0.0325, -D / 2 + 0.12, 0.004, { ry: rr(k, -0.1, 0.1) });
  k.cyl(0.035, 0.035, 0.1, mat.black(k), L / 2 - 0.42, H + 0.05, -D / 2 + 0.1, { seg: 10, cast: false });
  for (let i = 0; i < 3; i++) k.cyl(0.004, 0.004, 0.14, pick(k, [mat.satin(k), mat.paper(k)]), L / 2 - 0.42 + rr(k, -0.015, 0.015), H + 0.1, -D / 2 + 0.1 + rr(k, -0.015, 0.015), { rz: rr(k, -0.2, 0.2), seg: 5, cast: false });
  paperwork(k, -L / 2 + 0.3, H, 0.05, 0.08);
}

/** Rear work counter at standing height: base cabinets, top, an open shelf of binders above. */
function backCounter(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 1.6);
  const D = k.num('d', k.def.footprint?.d ?? 0.6);
  const H = 0.92;
  const M = caseMats(k);
  const n = Math.max(1, Math.round(L / 0.55));
  const bays: ('drawers' | 'drawer_door')[] = [];
  for (let i = 0; i < n; i++) bays.push(i === 0 ? 'drawers' : 'drawer_door');
  baseRun(k, M, { x0: -L / 2, x1: L / 2, zFace: D / 2 - 0.02, depth: D - 0.02, height: H - 0.03, bays });
  bev(k, L + 0.02, 0.03, D + 0.01, M.top, 0, H - 0.015, 0.005, 0.004);
  bev(k, L, 0.1, 0.015, M.top, 0, H + 0.05, -D / 2 + 0.0075, 0.003);
  // wall shelf with binders and a label printer on the top
  const sy = 1.48;
  bev(k, L, 0.025, 0.3, M.front, 0, sy, -D / 2 + 0.15, 0.004);
  for (const s of [-1, 1]) bev(k, 0.02, 0.18, 0.28, M.front, s * (L / 2 - 0.01), sy - 0.1, -D / 2 + 0.14, 0.004, { cast: false });
  const colors = [0x2f4b6e, 0x6e2f2f, 0x2f5a3e, 0x2b2b2b, 0x7a6a2a];
  let x = -L / 2 + 0.06;
  while (x < L / 2 - 0.12) {
    const w = rr(k, 0.04, 0.075);
    const bh = rr(k, 0.27, 0.31);
    bev(k, w - 0.004, bh, 0.24, mat.plastic(k, pick(k, colors), 0.5), x + w / 2, sy + 0.0125 + bh / 2, -D / 2 + 0.15, 0.005, { rz: k.rand() < 0.15 ? 0.12 : 0 });
    x += w + (k.rand() < 0.1 ? 0.12 : 0);
  }
  bev(k, 0.12, 0.08, 0.18, mat.plastic(k, 0xd2d0c8, 0.5), L / 2 - 0.25, H + 0.04, -0.05, 0.01);
  paperwork(k, -L / 2 + 0.35, H, 0.02, 0.1);
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

const counter: PropBuilder = (k) => {
  const kind = k.bool('kitchen', false) ? 'kitchen' : k.str('kind', k.def.room === 'nurse_station' ? 'station' : 'work');
  if (kind === 'kitchen') kitchenCounter(k);
  else if (kind === 'station') stationCounter(k);
  else workCounter(k);
};

/** Nurse-station counter: raised transaction ledge on the public (+z) side, desk-height work surface on -z. */
function stationCounter(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 3);
  const D = k.num('d', k.def.footprint?.d ?? 0.95);
  const M = caseMats(k, vary(k, 0x8a8478, 0.04), 0xc0bdb4);
  const ledge = mat.plastic(k, 0x55595d, 0.38);
  const alu = mat.satin(k);
  const zF = D / 2;
  const workY = 0.78;
  // public face: panel, recessed kick, reveal line, ledge on an inner riser
  bev(k, L, 0.95, 0.04, M.front, 0, 0.575, zF - 0.02, 0.006);
  k.box(L - 0.02, 0.1, 0.03, M.kick, 0, 0.05, zF - 0.055, { cast: false });
  k.box(L, 0.01, 0.004, alu, 0, 0.62, zF + 0.001, { cast: false });
  bev(k, L + 0.02, 0.03, 0.34, ledge, 0, 1.135, zF - 0.13, 0.008);
  bev(k, L, 1.12 - workY, 0.03, M.body, 0, (1.12 + workY) / 2, zF - 0.285, 0.004);
  // staff work surface, end gables
  const wz0 = -D / 2;
  const wz1 = zF - 0.3;
  bev(k, L - 0.04, 0.03, wz1 - wz0, M.top, 0, workY - 0.015, (wz0 + wz1) / 2, 0.006);
  for (const s of [-1, 1]) bev(k, 0.035, 1.12, D - 0.02, M.front, s * (L / 2 - 0.0175), 0.56, -0.01, 0.006);
  // drawer pedestals under the work surface, CPUs on the floor, cable grommets
  // pedestals at the ends (and the middle of long runs) keep the knee space under the terminals clear
  const peds = L > 3 ? [-L / 2 + 0.45, 0, L / 2 - 0.45] : [-L / 2 + 0.45, L / 2 - 0.45];
  for (const px of peds) {
    baseRun(k, M, { x0: px - 0.21, x1: px + 0.21, zFace: wz0 + 0.03, depth: wz1 - wz0 - 0.08, height: workY - 0.03, f: -1, bays: ['drawers'], kick: 0.06 });
    const tower = px === 0 ? 0.45 : px < 0 ? px + 0.45 : px - 0.45;
    bev(k, 0.18, 0.4, 0.42, mat.plastic(k, 0x1d1e20, 0.6), tower, 0.2, wz0 + 0.3, 0.008);
  }
  for (let i = 0; i < 3; i++) k.cyl(0.03, 0.03, 0.002, M.kick, -L / 2 + ((i + 0.5) * L) / 3, workY + 0.001, wz1 - 0.08, { seg: 12, cast: false });
  // ledge: sign-in clipboard, sanitizer pump, tissues; staff side: paperwork at the ends
  k.lathe([[0, 0], [0.032, 0], [0.032, 0.14], [0.012, 0.16], [0.012, 0.19], [0, 0.19]], mat.plastic(k, 0xdedcd4, 0.4), -L / 2 + 0.3, 1.15, zF - 0.12, { seg: 12, cast: false });
  bev(k, 0.22, 0.09, 0.12, mat.plastic(k, 0x8fa6b8, 0.6), L / 2 - 0.5, 1.195, zF - 0.14, 0.006, { ry: rr(k, -0.2, 0.2) });
  k.box(0.23, 0.005, 0.32, mat.plastic(k, 0x4a3b2c, 0.6), rr(k, -0.6, 0.6), 1.153, zF - 0.13, { ry: rr(k, -0.25, 0.25), cast: false });
  paperwork(k, -L / 2 + 0.35, workY, wz0 + 0.25, 0.1);
  paperwork(k, L / 2 - 0.4, workY, wz0 + 0.25, 0.1);
}

/** Kitchenette: base cabinets with a bar sink, backsplash, wall cabinets, a drying mug and soap. */
function kitchenCounter(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 1.6);
  const D = k.num('d', 0.6);
  const H = 0.92;
  const M = caseMats(k, vary(k, 0x9e9483, 0.04), 0xb7b2a6);
  const steel = mat.stainless(k);
  const sinkX = k.num('sink', -L / 2 + 0.35);
  const bayW = 0.5;
  const bays: Bay[] = [];
  const n = Math.max(1, Math.round(L / bayW));
  const sinkBay = Math.min(n - 1, Math.max(0, Math.floor(((sinkX + L / 2) / L) * n)));
  for (let i = 0; i < n; i++) bays.push(i === sinkBay ? 'sink' : i === n - 1 ? 'drawers' : 'drawer_door');
  baseRun(k, M, { x0: -L / 2, x1: L / 2, zFace: D / 2 - 0.02, depth: D - 0.02, height: H - 0.03, bays });
  // worktop in two pieces around the sink cut-out, bowl, rim, faucet
  const sw = 0.36;
  const sd = 0.32;
  const sz = 0.02;
  const left = sinkX - sw / 2 - (-L / 2 - 0.01);
  const right = L / 2 + 0.01 - (sinkX + sw / 2);
  if (left > 0.005) bev(k, left, 0.03, D + 0.01, M.top, -L / 2 - 0.01 + left / 2, H - 0.015, 0.005, 0.004);
  if (right > 0.005) bev(k, right, 0.03, D + 0.01, M.top, sinkX + sw / 2 + right / 2, H - 0.015, 0.005, 0.004);
  const zA = -D / 2;
  const zB = D / 2 + 0.01;
  bev(k, sw, 0.03, sz - sd / 2 - zA, M.top, sinkX, H - 0.015, (zA + sz - sd / 2) / 2, 0.003);
  bev(k, sw, 0.03, zB - (sz + sd / 2), M.top, sinkX, H - 0.015, (sz + sd / 2 + zB) / 2, 0.003);
  k.box(sw - 0.02, 0.006, sd - 0.02, steel, sinkX, H - 0.17, sz, { cast: false });
  for (const s of [-1, 1]) k.box(0.006, 0.16, sd - 0.02, steel, sinkX + s * (sw / 2 - 0.013), H - 0.09, sz, { cast: false });
  for (const s of [-1, 1]) k.box(sw - 0.02, 0.16, 0.006, steel, sinkX, H - 0.09, sz + s * (sd / 2 - 0.013), { cast: false });
  k.cyl(0.022, 0.022, 0.004, M.kick, sinkX, H - 0.165, sz, { seg: 10, cast: false });
  k.cyl(0.014, 0.016, 0.2, steel, sinkX, H + 0.1, -D / 2 + 0.08, { seg: 10 });
  k.tube([[sinkX, H + 0.19, -D / 2 + 0.08], [sinkX, H + 0.25, -D / 2 + 0.12], [sinkX, H + 0.22, -D / 2 + 0.22], [sinkX, H + 0.15, -D / 2 + 0.24]], 0.011, steel, { cast: false });
  bev(k, 0.014, 0.012, 0.08, steel, sinkX + 0.04, H + 0.2, -D / 2 + 0.09, 0.004, { ry: 0.5, cast: false });
  // backsplash and wall cabinets
  bev(k, L, 0.12, 0.015, M.top, 0, H + 0.06, -D / 2 + 0.0075, 0.003);
  upperRun(k, M, { x0: -L / 2, x1: L / 2, zBack: -D / 2, depth: 0.33, y0: 1.42, y1: 2.1 });
  // paper towels under the wall cabinet, dish soap, a mug drying upside down
  k.cyl(0.055, 0.055, 0.27, mat.paper(k), sinkX + 0.32, 1.33, -D / 2 + 0.12, { axis: 'x', seg: 12, cast: false });
  k.lathe([[0, 0], [0.025, 0], [0.027, 0.15], [0.01, 0.18], [0, 0.18]], mat.plastic(k, pick(k, [0x4f8a4a, 0x3b6fa5, 0xc9a43a]), 0.3), sinkX - sw / 2 - 0.06, H, -D / 2 + 0.12, { seg: 10, cast: false });
  const mugM = mat.plastic(k, pick(k, [0xd8d3c6, 0x7a2f2a, 0x2f4a5f]), 0.4);
  k.box(0.2, 0.006, 0.15, mat.fabric(k, 0x8a9aa2, 0.95), sinkX + sw / 2 + 0.15, H + 0.003, 0.05, { ry: rr(k, -0.3, 0.3), cast: false });
  k.lathe([[0, 0], [0.04, 0], [0.042, 0.095], [0, 0.095]], mugM, sinkX + sw / 2 + 0.14, H + 0.006, 0.05, { seg: 14, cast: false });
}

/** Plain work counter: drawers and doors, top, backsplash, optional wall cabinets, a few supplies. */
function workCounter(k: PropKit): void {
  const L = k.num('w', k.def.footprint?.w ?? 2);
  const D = k.num('d', k.def.footprint?.d ?? 0.65);
  const H = 0.92;
  const M = caseMats(k);
  const n = Math.max(1, Math.round(L / 0.6));
  const bays: Bay[] = [];
  for (let i = 0; i < n; i++) bays.push(i % 3 === 1 ? 'door' : i % 3 === 2 ? 'drawer_door' : 'drawers');
  baseRun(k, M, { x0: -L / 2, x1: L / 2, zFace: D / 2 - 0.02, depth: D - 0.02, height: H - 0.03, bays });
  bev(k, L + 0.02, 0.03, D + 0.01, M.top, 0, H - 0.015, 0.005, 0.004);
  bev(k, L, 0.1, 0.015, M.top, 0, H + 0.05, -D / 2 + 0.0075, 0.003);
  if (k.bool('upper', true)) upperRun(k, M, { x0: -L / 2, x1: L / 2, zBack: -D / 2, depth: 0.33, y0: 1.45, y1: 2.15 });
  // supplies kept clear of the middle, where terminals sit
  const gl = mat.plastic(k, pick(k, [0x6a5fa6, 0x4a7fb0]), 0.6);
  for (let i = 0; i < 3; i++) bev(k, 0.25, 0.065, 0.125, gl, L / 2 - 0.2, H + 0.0325 + i * 0.066, -D / 2 + 0.1, 0.004, { ry: rr(k, -0.06, 0.06) });
  bev(k, 0.3, 0.05, 0.22, mat.plastic(k, 0xd6d3ca, 0.5), L / 2 - 0.55, H + 0.025, -0.02, 0.006);
  for (let i = 0; i < 6; i++) k.cyl(0.02, 0.016, 0.03, mat.plastic(k, 0xe8e6de, 0.4), L / 2 - 0.62 + (i % 3) * 0.05, H + 0.065, -0.06 + Math.floor(i / 3) * 0.05, { seg: 8, cast: false });
  paperwork(k, -L / 2 + 0.3, H, 0.0, 0.08);
}

export const CASEWORK_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  desk,
  counter,
};
