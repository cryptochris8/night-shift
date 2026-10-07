/**
 * Storage: base cabinet (+ laser printer on a stand), automated medication-dispensing cabinet,
 * and banks of steel staff lockers. Long along local x; doors and drawers face +z.
 */
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { type CaseMats, baseRun, caseMats } from './props.clinical.casework';
import { bev, cablePts, caster, clamp, ledMat, line, mat, pick, rr, soft, vary, watchPower } from './props.clinical.common';
import { type ScreenLook, screenRig } from './props.clinical.screens';

// ---------------------------------------------------------------------------
// Base cabinet / printer stand
// ---------------------------------------------------------------------------

const cabinet: PropBuilder = (k) => {
  if (k.str('kind', 'base') === 'printer') {
    printerStand(k);
    return;
  }
  const w = k.num('w', k.def.footprint?.w ?? 0.8);
  const d = k.num('d', k.def.footprint?.d ?? 0.5);
  const h = k.num('h', 0.9);
  const steel = k.bool('steel', k.def.room === 'imaging');
  const M: CaseMats = steel
    ? { body: mat.painted(k, 0x8c8f8c, 0.5), front: mat.painted(k, vary(k, 0x9fa29d, 0.04), 0.45), top: mat.stainless(k), pull: mat.stainless(k), kick: mat.plastic(k, 0x1f2022, 0.7) }
    : caseMats(k);
  baseRun(k, M, { x0: -w / 2, x1: w / 2, zFace: d / 2 - 0.02, depth: d - 0.02, height: h - 0.03, bays: w > 0.7 ? ['drawer_door', 'drawer_door'] : ['drawer_door'] });
  bev(k, w + 0.01, 0.03, d + 0.01, M.top, 0, h - 0.015, 0.005, 0.004);
  // exam-room stock on top: glove boxes, tissues, folded gowns
  const stock = mat.plastic(k, 0x4a6fa8, 0.6);
  const n = w > 0.7 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    bev(k, 0.125, 0.065, 0.25, stock, -w / 2 + 0.09 + i * 0.14, h + 0.0325, -d / 2 + 0.15, 0.004, { ry: rr(k, -0.05, 0.05) });
  }
  if (k.rand() < 0.7) bev(k, 0.24, 0.09, 0.12, M.top, w / 2 - 0.15, h + 0.045, 0.05, 0.008, { ry: rr(k, -0.4, 0.4) });
  if (k.rand() < 0.6) bev(k, 0.3, 0.06, 0.22, stock, w / 2 - 0.18, h + 0.03, -0.1, 0.01, { ry: rr(k, -0.2, 0.2) });
};

/** Laser printer on a two-shelf rolling stand with paper stock underneath. */
function printerStand(k: PropKit): void {
  const lam = mat.plastic(k, 0x8a857a, 0.5);
  const shell = mat.plastic(k, vary(k, 0xc7c3b8, 0.03), 0.5);
  const dark = mat.dark(k);
  const steel = dark;
  const paper = mat.paper(k);
  const w = 0.56;
  const d = 0.5;
  const top = 0.64;
  bev(k, w, 0.025, d, lam, 0, top - 0.0125, 0, 0.004);
  bev(k, w, 0.02, d, lam, 0, 0.17, 0, 0.004);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box(0.025, top - 0.11, 0.025, steel, sx * (w / 2 - 0.02), (top + 0.11) / 2 - 0.012, sz * (d / 2 - 0.02));
      caster(k, sx * (w / 2 - 0.035), sz * (d / 2 - 0.035), 0.1, 0.03, steel, dark, rr(k, 0, Math.PI * 2));
    }
  }
  // printer: body, output well with fresh sheets, control panel, paper drawer
  const py = top;
  bev(k, 0.42, 0.3, 0.4, shell, 0, py + 0.15, -0.02, 0.02);
  k.box(0.3, 0.012, 0.22, dark, 0, py + 0.296, -0.05, { cast: false });
  k.box(0.21, 0.004, 0.2, paper, 0, py + 0.305, -0.04, { rx: -0.05, cast: false });
  bev(k, 0.4, 0.07, 0.02, shell, 0, py + 0.04, 0.185, 0.006, { cast: false });
  k.box(0.14, 0.008, 0.008, dark, 0, py + 0.06, 0.197, { cast: false });
  bev(k, 0.13, 0.05, 0.03, dark, 0.12, py + 0.27, 0.17, 0.006, { rx: -0.5, cast: false });
  const lcd = ledMat(k, 0x7fd08a, 0.6);
  k.box(0.05, 0.016, 0.002, lcd, 0.1, py + 0.275, 0.187, { rx: -0.5, cast: false });
  const ready = lcd;
  k.box(0.006, 0.006, 0.004, ready, 0.165, py + 0.268, 0.188, { rx: -0.5, cast: false });
  watchPower(k, (on) => {
    lcd.emissiveIntensity = on ? 0.6 : 0;
  });
  line(k, cablePts([0.15, py + 0.1, -0.22], [0.2, 0.02, -0.3], 0.05, 6), 0.004, dark, { cast: false });
  // reams and a case of paper on the lower shelf
  for (let i = 0; i < 3; i++) bev(k, 0.22, 0.054, 0.29, paper, -0.12 + rr(k, -0.01, 0.01), 0.21 + i * 0.055, -0.04, 0.004, { ry: rr(k, -0.06, 0.06) });
  bev(k, 0.22, 0.28, 0.3, lam, 0.14, 0.32, 0.0, 0.004, { ry: rr(k, -0.1, 0.1) });
}

// ---------------------------------------------------------------------------
// Automated dispensing cabinet: main console with touchscreen between drawer towers
// ---------------------------------------------------------------------------

const medCabinet: PropBuilder = (k) => {
  const w = k.num('w', k.def.footprint?.w ?? 2.0);
  const d = k.num('d', k.def.footprint?.d ?? 0.6);
  const shell = mat.plastic(k, vary(k, 0xd8d7d0, 0.03), 0.45);
  const front = mat.plastic(k, 0xc5c8c4, 0.45);
  const trim = mat.plastic(k, 0x6c747a, 0.5);
  const dark = mat.plastic(k, 0x24272a, 0.5);
  const led = ledMat(k, 0x45d07a, 0.9);
  const amber = ledMat(k, 0xffb030, 1.2);
  const mainW = Math.min(0.72, w * 0.36);
  const auxW = (w - mainW - 0.02) / 2;
  const zf = d / 2;

  /** grid of drawer fronts with recessed pulls; every so often a status LED */
  const drawers = (x: number, tw: number, y0: number, y1: number, rows: number, cols: number, label: boolean): void => {
    const rh = (y1 - y0) / rows;
    const cw = tw / cols;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = x - tw / 2 + cw * (c + 0.5);
        const cy = y1 - rh * (r + 0.5);
        bev(k, cw - 0.01, rh - 0.01, 0.014, front, cx, cy, zf + 0.007, 0.003);
        k.box(Math.min(0.12, cw * 0.5), 0.01, 0.004, dark, cx, cy + rh * 0.3, zf + 0.0145, { cast: false });
        // drawer C2 on the main console is the one with the count discrepancy
        const isC2 = label && r === 2 && c === 1;
        if (isC2 || k.rand() < 0.22) k.box(0.008, 0.008, 0.003, isC2 ? amber : led, cx + cw / 2 - 0.02, cy + rh / 2 - 0.02, zf + 0.0155, { cast: false });
      }
    }
  };

  for (const s of [-1, 1]) {
    // tall auxiliary towers
    const x = s * (mainW / 2 + 0.01 + auxW / 2);
    bev(k, auxW, 0.08, d - 0.04, dark, x, 0.04, -0.01, 0.006);
    bev(k, auxW, 1.72, d, shell, x, 0.08 + 0.86, 0, 0.015);
    drawers(x, auxW - 0.04, 0.12, 1.74, 9, s < 0 ? 1 : 2, false);
    bev(k, auxW + 0.004, 0.035, d + 0.004, trim, x, 1.82, 0, 0.008);
  }
  // main console: matrix drawers, projecting work shelf, keyboard, badge reader, screen riser
  bev(k, mainW, 0.94, d, shell, 0, 0.08 + 0.47, 0, 0.015);
  bev(k, mainW, 0.08, d - 0.04, dark, 0, 0.04, -0.01, 0.006);
  drawers(0, mainW - 0.04, 0.12, 0.98, 5, 3, true);
  bev(k, mainW + 0.02, 0.03, d + 0.12, trim, 0, 1.035, 0.06, 0.008);
  bev(k, 0.4, 0.018, 0.14, dark, -0.02, 1.059, zf - 0.02, 0.005, { cast: false });
  for (let r = 0; r < 4; r++) k.box(0.36, 0.005, 0.022, trim, -0.02, 1.07, zf - 0.075 + r * 0.03, { cast: false });
  bev(k, 0.08, 0.04, 0.1, dark, mainW / 2 - 0.08, 1.07, zf + 0.0, 0.008, { cast: false });
  k.box(0.008, 0.008, 0.003, led, mainW / 2 - 0.08, 1.092, zf + 0.04, { cast: false });
  soft(k, mainW - 0.08, 0.5, 0.2, shell, 0, 1.3, -d / 2 + 0.12, 0.02);
  bev(k, 0.4, 0.31, 0.012, dark, 0, 1.33, -d / 2 + 0.226, 0.004);
  // return-bin slot above the screen
  k.box(0.3, 0.02, 0.01, dark, 0, 1.5, -d / 2 + 0.221, { cast: false });

  let powered = true;
  const offLook: ScreenLook = { kind: 'off', refresh: 0, brightness: 0.4, glow: 0, glowColor: 0x9cc2ea };
  const look = (m: string): ScreenLook => {
    if (!powered || m === 'off') return offLook;
    if (m === 'static') return { kind: 'static', opts: { time: k.screenTime() }, refresh: 0.5, brightness: 0.8, glow: 0.14, glowColor: 0xc9d2da };
    if (m === 'standby') return { kind: 'standby', opts: { lines: ['MEDSTATION  ·  BADGE OR FINGERPRINT TO LOG IN'] }, refresh: 0, brightness: 0.75, glow: 0.06, glowColor: 0x6f907c };
    return { kind: 'pyxis', opts: { time: k.screenTime() }, refresh: 2, brightness: 0.86, glow: 0.16, glowColor: 0x9cc2ea };
  };
  const rig = screenRig(k, { w: 0.352, h: 0.264, x: 0, y: 1.335, z: -d / 2 + 0.2335, initial: k.str('screen', 'pyxis'), look, near: 10 });
  let t = k.rand() * 4;
  k.onUpdate((dt) => {
    if (!powered) return;
    t += dt;
    amber.emissiveIntensity = 0.45 + 0.75 * (0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.5));
  });
  watchPower(k, (on) => {
    powered = on;
    led.emissiveIntensity = on ? 0.9 : 0;
    if (!on) amber.emissiveIntensity = 0;
    rig.set(rig.mode());
  });
};

// ---------------------------------------------------------------------------
// Staff lockers
// ---------------------------------------------------------------------------

const locker: PropBuilder = (k) => {
  const n = Math.max(1, Math.round(k.num('count', 2)));
  const lw = clamp(k.num('lockerW', k.def.footprint ? k.def.footprint.w / n : 0.45), 0.3, 0.6);
  const d = k.num('d', k.def.footprint?.d ?? 0.5);
  const H = 1.8;
  const base = 0.1;
  const L = n * lw;
  const body = mat.painted(k, vary(k, pick(k, [0x6c776f, 0x737a82, 0x868579]), 0.04), 0.5);
  const slot = mat.dark(k);
  const inside = slot;
  const chrome = mat.chrome(k);
  const paper = mat.paper(k);
  const zf = d / 2;
  const first = Math.round(k.num('start', 11 + Math.floor(k.rand() * 30)));
  const ajar = 0;
  // plinth, shared side panels, top
  bev(k, L - 0.02, base, d - 0.06, slot, 0, base / 2, -0.02, 0.006);
  for (let i = 0; i <= n; i++) bev(k, 0.012, H, d - 0.02, body, -L / 2 + i * lw + (i === 0 ? 0.006 : i === n ? -0.006 : 0), base + H / 2, -0.01, 0.003);
  bev(k, L, 0.014, d - 0.02, body, 0, base + H + 0.007, -0.01, 0.003);
  for (let i = 0; i < n; i++) {
    const x0 = -L / 2 + i * lw;
    const cx = x0 + lw / 2;
    if (i === ajar) {
      // open carcass: back, floor, hat shelf, a coat on the hook, a note inside the door
      k.box(lw - 0.012, H, 0.01, inside, cx, base + H / 2, -d / 2 + 0.005);
      k.box(lw - 0.012, 0.01, d - 0.04, inside, cx, base + 0.005, -0.01, { cast: false });
      k.box(lw - 0.012, 0.01, d - 0.06, inside, cx, base + H - 0.3, -0.02, { cast: false });
      k.cyl(0.006, 0.006, 0.05, chrome, cx, base + H - 0.38, -d / 2 + 0.035, { axis: 'z', seg: 6, cast: false });
      soft(k, lw * 0.62, 0.62, 0.16, mat.fabric(k, pick(k, [0x2b2f36, 0x3a342d]), 0.95), cx + 0.01, base + H - 0.72, -d / 2 + 0.11, 0.06, { rz: rr(k, -0.06, 0.06) });
      k.cyl(0.07, 0.065, 0.14, slot, cx - 0.06, base + 0.08, -0.06, { seg: 10, cast: false });
    } else {
      k.box(lw - 0.012, H - 0.004, d - 0.04, inside, cx, base + H / 2, -0.03);
    }
    // door (hinged on its left edge); the first stands slightly ajar
    const ang = i === ajar ? rr(k, 0.22, 0.34) : 0;
    const dw = lw - 0.012;
    const hx = x0 + 0.006;
    const at = (u: number, y: number, t: number): [number, number, number] => [hx + u * Math.cos(ang) - t * Math.sin(ang), y, zf + u * Math.sin(ang) + t * Math.cos(ang)];
    const dh = H - 0.02;
    bev(k, dw, dh, 0.018, body, ...at(dw / 2, base + H / 2, -0.009), 0.004, { ry: -ang });
    // louvres top and bottom
    for (const yy of [base + H - 0.2, base + 0.22]) {
      for (let v = 0; v < 6; v++) k.box(dw * 0.52, 0.007, 0.004, slot, ...at(dw / 2, yy + v * 0.02 - 0.05, 0.001), { ry: -ang, cast: false });
    }
    // recessed lift handle, number plate, maybe a name strip and a padlock
    k.box(0.05, 0.12, 0.004, slot, ...at(dw - 0.06, base + 1.0, 0.001), { ry: -ang, cast: false });
    bev(k, 0.03, 0.08, 0.014, chrome, ...at(dw - 0.06, base + 1.0, 0.008), 0.004, { ry: -ang, cast: false });
    k.sign(String(first + i), 'room_number', 0.05, 0.05, ...at(dw / 2, base + H - 0.08, 0.002), { ry: -ang });
    if (k.rand() < 0.6) k.box(0.12, 0.022, 0.002, paper, ...at(dw / 2, base + H - 0.125, 0.002), { ry: -ang, rz: rr(k, -0.04, 0.04), cast: false });
    if (i !== ajar && k.rand() < 0.45) {
      const p = at(dw - 0.06, base + 0.93, 0.025);
      bev(k, 0.035, 0.04, 0.016, chrome, p[0], p[1], p[2], 0.004, { cast: false });
      k.torus(0.011, 0.003, chrome, p[0], p[1] + 0.028, p[2], { arc: Math.PI, seg: 8, cast: false });
    }
    if (i === ajar) k.box(0.075, 0.075, 0.001, mat.plastic(k, 0xd6c56a, 0.9), ...at(dw * 0.45, base + 1.22, -0.0195), { ry: -ang + Math.PI, rz: rr(k, -0.1, 0.1), cast: false });
  }
};

export const STORAGE_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  cabinet,
  med_cabinet: medCabinet,
  locker,
};

