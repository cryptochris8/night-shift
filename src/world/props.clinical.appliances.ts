/**
 * Small appliances: staff fridge (full or dorm) and glass-door medication fridge, microwave,
 * drip coffee maker. Self-lit parts follow the room's mains power (blackout kills them, the
 * generator only revives emergency rooms whose breaker zone is on). Doors face +z.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { Glow, bev, ledMat, line, mat, pick, rr, soft, vary, watchPower } from './props.clinical.common';

// ---------------------------------------------------------------------------
// Fridges
// ---------------------------------------------------------------------------

const fridge: PropBuilder = (k) => {
  const kind = k.str('kind', 'full');
  if (kind === 'med') medFridge(k);
  else homeFridge(k, kind === 'dorm');
};

function homeFridge(k: PropKit, dorm: boolean): void {
  const W = 0.62;
  const D = 0.66;
  const H = dorm ? 0.86 : 1.66;
  const shell = mat.plastic(k, vary(k, pick(k, [0xd8d6ce, 0xc9c5b9]), 0.03), 0.32);
  const gasket = mat.dark(k);
  const handleM = gasket;
  // cabinet, doors, door gaps, handles, kick grille
  soft(k, W, H - 0.04, D - 0.06, shell, 0, 0.04 + (H - 0.04) / 2, -0.03, 0.02);
  const zf = D / 2 - 0.028;
  const doors: [number, number][] = dorm ? [[0.05, H - 0.01]] : [[0.05, H - 0.47], [H - 0.46, H - 0.01]];
  for (const [y0, y1] of doors) {
    bev(k, W - 0.01, y1 - y0, 0.05, shell, 0, (y0 + y1) / 2, zf, 0.016);
    const hy = dorm ? y1 - 0.2 : y1 - y0 > 0.6 ? y1 - 0.3 : y0 + 0.12;
    const hl = y1 - y0 > 0.6 ? 0.36 : 0.18;
    bev(k, 0.022, hl, 0.022, handleM, W / 2 - 0.06, hy, zf + 0.048, 0.008);
    for (const s of [-1, 1]) k.box(0.016, 0.016, 0.03, handleM, W / 2 - 0.06, hy + s * (hl / 2 - 0.02), zf + 0.033, { cast: false });
  }
  if (!dorm) k.box(W - 0.02, 0.008, 0.012, gasket, 0, H - 0.465, zf + 0.02, { cast: false });
  k.box(W - 0.08, 0.05, 0.01, gasket, 0, 0.03, D / 2 - 0.05, { cast: false });
  // lounge-fridge life: notes and a takeout menu under magnets
  const paper = mat.paper(k);
  const note = mat.plastic(k, 0xd6c56a, 0.9);
  const magnets = [mat.plastic(k, 0x9c2a22, 0.4)];
  const top = dorm ? H - 0.15 : H - 0.62;
  for (let i = 0; i < 4; i++) {
    const big = i === 0;
    const x = rr(k, -W / 2 + 0.14, W / 2 - 0.2);
    const y = top - i * rr(k, 0.13, 0.2);
    k.box(big ? 0.2 : 0.075, big ? 0.28 : 0.075, 0.001, i % 2 ? note : paper, x, y, zf + 0.0258, { rz: rr(k, -0.1, 0.1), cast: false });
    k.box(0.02, 0.02, 0.008, pick(k, magnets), x, y + (big ? 0.12 : 0.03), zf + 0.029, { cast: false });
  }
  if (!dorm) bev(k, 0.32, 0.2, 0.2, mat.cardboard(k), rr(k, -0.1, 0.1), H + 0.1, -0.05, 0.004, { ry: rr(k, -0.3, 0.3) });
}

/** Glass-door pharmacy fridge: lit white interior, stocked shelves, lock, temperature readout. */
function medFridge(k: PropKit): void {
  const W = 0.6;
  const D = 0.62;
  const H = 1.55;
  const shell = mat.plastic(k, vary(k, 0xe0dfd8, 0.02), 0.4);
  const frameM = mat.plastic(k, 0x8a9095, 0.45);
  const dark = mat.dark(k);
  const paper = mat.paper(k);
  const wire = frameM;
  const inner = k.own(new THREE.MeshStandardMaterial({ color: 0xd8e2e8, roughness: 0.6, metalness: 0 }));
  inner.emissive.setHex(0xcfe4ff);
  inner.emissiveIntensity = 0.32;
  const zf = D / 2;
  // carcass open at the front: sides, top console, plinth with grille, lit liner
  for (const s of [-1, 1]) bev(k, 0.035, H - 0.1, D - 0.04, shell, s * (W / 2 - 0.0175), 0.1 + (H - 0.1) / 2, -0.02, 0.006);
  bev(k, W, 0.14, D - 0.04, shell, 0, H - 0.07, -0.02, 0.008);
  bev(k, W, 0.1, D - 0.04, dark, 0, 0.05, -0.02, 0.006);
  for (let i = 0; i < 5; i++) k.box(W - 0.1, 0.006, 0.004, shell, 0, 0.03 + i * 0.012, zf - 0.039, { cast: false });
  const ih = H - 0.26;
  k.box(W - 0.07, ih, 0.01, inner, 0, 0.11 + ih / 2, -D / 2 + 0.03, { cast: false });
  for (const s of [-1, 1]) k.box(0.008, ih, D - 0.1, inner, s * (W / 2 - 0.04), 0.11 + ih / 2, 0.0, { cast: false });
  k.box(W - 0.07, 0.008, D - 0.1, inner, 0, H - 0.145, 0.0, { cast: false });
  // shelves with boxed vials and loose bottles
  const vialCaps = [mat.plastic(k, 0x3a6ea5, 0.4), paper];
  for (const y of [0.32, 0.62, 0.92, 1.18]) {
    k.box(W - 0.08, 0.008, D - 0.12, wire, 0, y, -0.01, { cast: false });
    let x = -W / 2 + 0.07;
    while (x < W / 2 - 0.1) {
      const bw = rr(k, 0.05, 0.11);
      const bh = rr(k, 0.04, 0.12);
      if (k.rand() < 0.7) bev(k, bw - 0.008, bh, rr(k, 0.08, 0.16), paper, x + bw / 2, y + 0.004 + bh / 2, rr(k, -0.12, 0.05), 0.003, { cast: false });
      else for (let v = 0; v < 3; v++) k.cyl(0.012, 0.012, 0.05, pick(k, vialCaps), x + 0.015 + v * 0.026, y + 0.029, 0.08 - v * 0.03, { seg: 8, cast: false });
      x += bw;
    }
  }
  // glass door in a grey frame, handle, lock, label
  const glassM = mat.glass(k);
  const dy0 = 0.11;
  const dy1 = H - 0.15;
  const dz = zf - 0.012;
  for (const s of [-1, 1]) bev(k, 0.045, dy1 - dy0, 0.03, frameM, s * (W / 2 - 0.0225), (dy0 + dy1) / 2, dz, 0.006);
  for (const yy of [dy0 + 0.03, dy1 - 0.03]) bev(k, W - 0.09, 0.06, 0.03, frameM, 0, yy, dz, 0.006);
  k.box(W - 0.09, dy1 - dy0 - 0.12, 0.006, glassM, 0, (dy0 + dy1) / 2, dz, { cast: false });
  bev(k, 0.022, 0.4, 0.025, frameM, -W / 2 + 0.06, 0.82, dz + 0.03, 0.008, { cast: false });
  k.cyl(0.011, 0.011, 0.012, dark, -W / 2 + 0.06, 0.55, dz + 0.02, { axis: 'z', seg: 10, cast: false });
  k.box(0.14, 0.05, 0.001, paper, 0.12, dy1 - 0.12, dz + 0.004, { cast: false });
  k.box(0.008, 0.18, 0.001, paper, W / 2 - 0.002, 0.9, -0.1, { ry: Math.PI / 2, cast: false });
  // control strip: temperature readout, alarm LED
  k.box(0.09, 0.04, 0.003, dark, 0.13, H - 0.07, zf - 0.0185, { cast: false });
  const digits = ledMat(k, 0xff5040, 0.9);
  for (let i = 0; i < 3; i++) k.box(0.014, 0.022, 0.002, digits, 0.105 + i * 0.022, H - 0.07, zf - 0.0168, { cast: false });
  const ok = digits;
  k.box(0.007, 0.007, 0.002, ok, 0.2, H - 0.07, zf - 0.0168, { cast: false });
  const glow = new Glow(k, [0, 0.8, zf + 0.25], 0xcfe2ff, 0.35);
  watchPower(k, (on) => {
    inner.emissiveIntensity = on ? 0.32 : 0;
    digits.emissiveIntensity = on ? 0.9 : 0;
    glow.set(on);
  });
}

// ---------------------------------------------------------------------------
// Microwave (clock blinks 12:00 after a power cut, like they all do)
// ---------------------------------------------------------------------------

const microwave: PropBuilder = (k) => {
  const W = 0.48;
  const H = 0.28;
  const D = 0.36;
  const finish = pick(k, ['black', 'white', 'steel'] as const);
  const shell = finish === 'steel' ? mat.stainless(k) : mat.plastic(k, finish === 'black' ? 0x232527 : 0xd9d7cf, 0.4);
  const dark = mat.plastic(k, 0x121315, 0.35);
  const win = k.std(0x0c0e0f, 0.12, 0.2);
  const keys = win;
  bev(k, W, H, D, shell, 0, H / 2 + 0.008, 0, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl(0.012, 0.012, 0.008, dark, sx * (W / 2 - 0.05), 0.004, sz * (D / 2 - 0.05), { seg: 8, cast: false });
  const dw = W * 0.7;
  const dx = -W / 2 + dw / 2 + 0.005;
  bev(k, dw, H - 0.03, 0.02, shell, dx, H / 2 + 0.008, D / 2 + 0.002, 0.005);
  k.box(dw - 0.08, H - 0.1, 0.004, win, dx - 0.01, H / 2 + 0.008, D / 2 + 0.013, { cast: false });
  k.box(0.012, H - 0.09, 0.006, dark, dx + dw / 2 - 0.025, H / 2 + 0.008, D / 2 + 0.013, { cast: false });
  const px = W / 2 - (W - dw) / 2;
  k.box(W - dw - 0.02, H - 0.04, 0.004, dark, px, H / 2 + 0.008, D / 2 + 0.003, { cast: false });
  const clock = ledMat(k, 0x6fd3ff, 0.8);
  k.box(0.07, 0.022, 0.002, clock, px, H - 0.045, D / 2 + 0.0055, { cast: false });
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) k.box(0.022, 0.014, 0.003, keys, px - 0.03 + c * 0.03, H - 0.09 - r * 0.026, D / 2 + 0.006, { cast: false });
  bev(k, 0.08, 0.025, 0.006, keys, px, 0.05, D / 2 + 0.006, 0.003, { cast: false });
  let lost = false;
  let powered = true;
  let t = 0;
  watchPower(k, (on) => {
    if (!on) lost = true;
    powered = on;
    clock.emissiveIntensity = on ? 0.8 : 0;
  });
  k.onUpdate((dt) => {
    if (!powered || !lost) return;
    t += dt;
    clock.emissiveIntensity = Math.sin(t * Math.PI) > 0 ? 0.8 : 0.05;
  });
};

// ---------------------------------------------------------------------------
// Drip coffee maker with a carafe on the warming plate
// ---------------------------------------------------------------------------

const coffeeMaker: PropBuilder = (k) => {
  const body = mat.plastic(k, pick(k, [0x1f2022, 0x2c2d2f]), 0.45);
  const steel = mat.stainless(k);
  const glassM = mat.glass(k);
  const coffee = k.std(0x1a0f08, 0.08, 0);
  const W = 0.22;
  const D = 0.26;
  bev(k, W, 0.05, D, body, 0, 0.025, 0, 0.01);
  k.cyl(0.078, 0.078, 0.008, steel, 0, 0.054, 0.035, { seg: 18, cast: false });
  const plate = ledMat(k, 0xff3010, 0.7);
  k.torus(0.07, 0.0035, plate, 0, 0.0585, 0.035, { rx: Math.PI / 2, seg: 24, cast: false });
  const pilot = plate;
  k.box(0.012, 0.008, 0.003, pilot, W / 2 - 0.035, 0.03, D / 2 + 0.0015, { cast: false });
  // back column and brew head
  bev(k, W, 0.34, 0.1, body, 0, 0.05 + 0.17, -D / 2 + 0.05, 0.012);
  bev(k, W, 0.08, D - 0.02, body, 0, 0.36, 0.0, 0.015);
  bev(k, W - 0.03, 0.02, D - 0.06, body, 0, 0.405, -0.01, 0.008, { cast: false });
  k.box(0.004, 0.16, 0.04, glassM, W / 2 + 0.001, 0.22, -D / 2 + 0.06, { cast: false });
  // carafe a third full, lid, collar and handle
  k.lathe([[0, 0], [0.06, 0], [0.075, 0.04], [0.078, 0.08], [0.06, 0.13], [0.045, 0.16], [0.05, 0.17], [0, 0.17]], glassM, 0, 0.058, 0.035, { seg: 18, cast: false });
  k.lathe([[0, 0], [0.056, 0], [0.07, 0.035], [0.072, 0.055], [0, 0.055]], coffee, 0, 0.06, 0.035, { seg: 18, cast: false });
  k.torus(0.05, 0.008, body, 0, 0.222, 0.035, { rx: Math.PI / 2, seg: 16, cast: false });
  k.cyl(0.048, 0.05, 0.016, body, 0, 0.236, 0.035, { seg: 14, cast: false });
  line(k, [[0.05, 0.215, 0.035], [0.1, 0.2, 0.035], [0.1, 0.1, 0.035], [0.075, 0.085, 0.035]], 0.01, body, { cast: false });
  // somebody's mug, tucked in front beside the plate
  const mugM = mat.plastic(k, pick(k, [0xd8d3c6, 0x7a2f2a, 0x2f4a5f]), 0.4);
  const mx = -W / 2 + 0.01;
  k.lathe([[0, 0], [0.04, 0], [0.042, 0.095], [0.038, 0.095], [0.036, 0.008], [0, 0.008]], mugM, mx, 0.0, D / 2 + 0.06, { seg: 14, cast: false });
  k.torus(0.022, 0.006, mugM, mx - 0.048, 0.05, D / 2 + 0.06, { seg: 12, cast: false });
  watchPower(k, (on) => {
    plate.emissiveIntensity = on ? 0.7 : 0;
  });
};

export const APPLIANCE_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  fridge,
  microwave,
  coffee_maker: coffeeMaker,
};
