/**
 * Powered devices: glass-front vending machines (lit product window that sputters out with the
 * mains and stays dark on emergency power), a desk phone and two-way radios (base station and a
 * handheld in its charger, whose tiny LCD keeps glowing on battery).
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawDotMatrix, drawKeypad, drawLcd, drawVendingColumn, drawVendingProducts } from './props.infra.tex';
import { drawStain } from './props.infra.tex2';
import { PowerFade, coilPoints, cord, decalMat, gentle, live, onMains, ownStd, powerOf, propSeed, sharedTex, switcher, texMat } from './props.infra.util';

/** Snack / drink machine, 1.83 m; params.kind 'snacks' | 'drinks'. Front faces +z. */
const vending: PropBuilder = (k) => {
  const kind = k.str('kind', 'snacks') === 'drinks' ? 'drinks' : 'snacks';
  const fp = k.def.footprint ?? { w: 1.0, d: 0.8 };
  const W = Math.min(0.96, fp.w - 0.04);
  const D = Math.min(0.86, fp.d - 0.02);
  const H = 1.83;
  const zf = D / 2;
  const paint = k.std(0x24272b, 0.45, 0.3);
  k.rbox(W, H, D - 0.25, paint, 0, H / 2, -0.125, 0.02);
  const colW = 0.27;
  const cx = W / 2 - colW / 2;
  k.rbox(colW, H - 0.02, 0.25, paint, cx, H / 2, zf - 0.125, 0.012);
  const winL = -W / 2 + 0.04;
  const winR = W / 2 - colW;
  const ww = winR - winL;
  const wx = (winL + winR) / 2;
  const y0 = 0.55;
  const y1 = 1.74;
  const wh = y1 - y0;
  k.box(0.04, H, 0.25, paint, -W / 2 + 0.02, H / 2, zf - 0.125);
  k.box(ww, H - y1, 0.25, paint, wx, (H + y1) / 2, zf - 0.125);
  k.box(ww, y0 - 0.46, 0.25, paint, wx, (y0 + 0.46) / 2, zf - 0.125);
  k.box(ww, 0.14, 0.25, paint, wx, 0.07, zf - 0.125);
  k.box(ww, 0.32, 0.03, k.std(0x0a0a0b, 0.9), wx, 0.3, zf - 0.235);
  const flap = k.std(0x1a1d20, 0.15, 0.1, { transparent: true, opacity: 0.82 });
  k.plane(ww - 0.06, 0.26, flap, wx, 0.31, zf - 0.035, { rx: 0.12 });
  k.box(ww - 0.04, 0.04, 0.03, k.std(0x9a9ea2, 0.3, 0.85), wx, 0.445, zf - 0.02);
  // lit interior: product field, tunnel walls, shelf lips, lamp tube
  const prodTex = sharedTex(`vend:${kind}`, () => drawVendingProducts(kind));
  const prod = ownStd(k, { map: prodTex, emissiveMap: prodTex, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.6 });
  k.plane(ww, wh, prod, wx, (y0 + y1) / 2, zf - 0.245, { cast: false });
  const tunnel = ownStd(k, { color: 0xb9c0c4, emissive: 0xdfe8ec, emissiveIntensity: 0.5, roughness: 0.6 });
  k.plane(0.24, wh, tunnel, winL + 0.0005, (y0 + y1) / 2, zf - 0.125, { ry: Math.PI / 2, cast: false });
  k.plane(0.24, wh, tunnel, winR - 0.0005, (y0 + y1) / 2, zf - 0.125, { ry: -Math.PI / 2, cast: false });
  k.plane(ww, 0.24, tunnel, wx, y1 - 0.0005, zf - 0.125, { rx: Math.PI / 2, cast: false });
  k.plane(ww, 0.24, tunnel, wx, y0 + 0.0005, zf - 0.125, { rx: -Math.PI / 2, cast: false });
  const rows = kind === 'snacks' ? 6 : 5;
  const lip = k.std(0x8d9296, 0.4, 0.6);
  for (let r = 0; r < rows; r++) {
    const y = y1 - ((r + 1) * wh) / rows + (24 / 1024) * wh;
    k.box(ww, 0.008, 0.2, lip, wx, y, zf - 0.14);
  }
  const tube = ownStd(k, { color: 0xffffff, emissive: 0xeaf6ff, emissiveIntensity: 2.4, roughness: 0.3 });
  k.cyl(0.011, 0.011, wh - 0.06, tube, winR - 0.03, (y0 + y1) / 2, zf - 0.05, { seg: 8, cast: false });
  const glass = k.phys('infra:vendglass', { color: 0xdde8ea, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.13, clearcoat: 1, depthWrite: false });
  k.plane(ww, wh, glass, wx, (y0 + y1) / 2, zf - 0.008, { keep: true });
  // control column: printed face, display, keypad, coin / bill / card hardware, coin return
  const colTop = H - 0.04;
  const colH = colTop - 0.15;
  const cy = (py: number): number => colTop - (py / 1216) * colH;
  const face = texMat(k, `vendcol:${kind}`, () => sharedTex(`vendcol:${kind}`, () => drawVendingColumn(kind)), { roughness: 0.45, metalness: 0.2 });
  k.plane(colW - 0.02, colH, face, cx, (colTop + 0.15) / 2, zf + 0.001);
  const dispTex = sharedTex('vend:display', () => drawDotMatrix('MAKE SELECTION'));
  const disp = ownStd(k, { map: dispTex, emissiveMap: dispTex, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.4 });
  k.plane(0.2, 0.052, disp, cx, cy(214), zf + 0.003, { cast: false });
  const keypad = texMat(k, 'vend:keypad', () => sharedTex('vend:keypad', drawKeypad), { roughness: 0.5 });
  k.plane(0.16, 0.2, keypad, cx, cy(405), zf + 0.003);
  const chrome = k.std(0xb9bdc1, 0.25, 0.9);
  k.rbox(0.045, 0.075, 0.014, chrome, cx - 0.06, cy(660), zf + 0.007, 0.004);
  k.box(0.006, 0.04, 0.004, k.std(0x050505, 0.9), cx - 0.06, cy(660), zf + 0.0145);
  k.rbox(0.1, 0.065, 0.035, k.std(0x121315, 0.5), cx + 0.045, cy(660), zf + 0.0175, 0.006);
  k.box(0.07, 0.005, 0.004, k.std(0x050505, 0.9), cx + 0.045, cy(660) + 0.012, zf + 0.0355);
  const billLed = switcher(k.box(0.05, 0.006, 0.003, k.std(0x0d200f, 0.4), cx + 0.045, cy(660) - 0.015, zf + 0.0355, { cast: false }), k.glowMat(0x46ff70, 1.8), k.std(0x0d200f, 0.4));
  k.rbox(0.085, 0.11, 0.03, k.std(0x121315, 0.5), cx, cy(735), zf + 0.015, 0.008);
  k.rbox(0.06, 0.025, 0.04, chrome, cx + 0.05, cy(1000), zf + 0.02, 0.006);
  k.rbox(0.08, 0.06, 0.03, k.std(0x0a0a0b, 0.9), cx, cy(1075), zf + 0.004, 0.008);
  k.cyl(0.016, 0.016, 0.02, chrome, W / 2 - 0.035, 1.0, zf + 0.01, { axis: 'z', seg: 12 });
  // feet, power cord to the wall, scuffing on the plinth
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.02, 0.025, 0.02, k.std(0x111111, 0.7), sx * (W / 2 - 0.06), 0.01, sz * (D / 2 - 0.06), { seg: 8 });
  k.tube([[W / 2 - 0.1, 0.15, -D / 2], [W / 2 - 0.1, 0.06, -D / 2 - 0.12], [W / 2 - 0.08, 0.02, -D / 2 - 0.3]], 0.006, k.std(0x111111, 0.7), { seg: 6 });
  const scuff = decalMat(k, 'stain:dirt14', () => sharedTex('stain:dirt14', () => drawStain('dirt', 14)), { opacity: 0.6 });
  k.plane(ww, 0.14, scuff, wx, 0.07, zf + 0.0008);

  const fade = new PowerFade(onMains(powerOf(k)), propSeed(k));
  let t = 0;
  let last = -1;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    fade.set(onMains(p));
    const lv = fade.step(dt, t, p === 'unstable', gentle(k));
    if (Math.abs(lv - last) < 1e-4) return;
    last = lv;
    prod.emissiveIntensity = 0.85 * lv;
    tunnel.emissiveIntensity = 0.5 * lv;
    tube.emissiveIntensity = 2.4 * lv;
    disp.emissiveIntensity = 1.2 * lv;
    billLed(lv > 0.5);
  });
};

// ---------------------------------------------------------------------------
// Phone
// ---------------------------------------------------------------------------

/** Desk phone on a work surface (origin on the surface). setScreen: 'ring' | 'idle' | 'off'. */
const phone: PropBuilder = (k) => {
  const plastic = k.std(0x1c1d1f, 0.5, 0.05);
  const keyMat = k.std(0x2c2e31, 0.45, 0.05);
  const prof = new THREE.Shape();
  prof.moveTo(0.1, 0);
  prof.lineTo(0.1, 0.03);
  prof.lineTo(-0.1, 0.085);
  prof.lineTo(-0.1, 0);
  prof.closePath();
  k.extrude(prof, 0.205, plastic, 0.1025, 0, 0, { ry: -Math.PI / 2, bevel: 0.004 });
  const a = Math.atan2(0.055, 0.2);
  const top = (z: number): number => 0.034 + ((0.1 - z) * 0.055) / 0.2;
  const lcdMat = (on: boolean): THREE.MeshStandardMaterial => k.shared(`infra:phonelcd:${on}`, () => {
    const t = sharedTex('phonelcd', () => drawLcd(['ED NURSE STN  x2214', 'LINE 1     LINE 2'], { w: 256, h: 96, bg: '#93a88e', fg: '#16201a' }));
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: on ? 0xffffff : 0x000000, emissiveIntensity: on ? 0.45 : 0, roughness: 0.4 });
  });
  const lcd = switcher(k.plane(0.09, 0.034, lcdMat(false), 0.025, top(-0.055) + 0.0015, -0.055, { rx: a - Math.PI / 2, cast: false }), lcdMat(true), lcdMat(false));
  k.rbox(0.1, 0.004, 0.045, keyMat, 0.025, top(-0.055) + 0.001, -0.055, 0.002, { rx: a });
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const z = 0.07 - r * 0.022;
      k.box(0.017, 0.006, 0.014, keyMat, 0.0 + c * 0.024, top(z) + 0.003, z, { rx: a, cast: false });
    }
  }
  for (let r = 0; r < 4; r++) k.box(0.014, 0.005, 0.009, keyMat, 0.085, top(0.05 - r * 0.02) + 0.0025, 0.05 - r * 0.02, { rx: a, cast: false });
  k.cyl(0.011, 0.011, 0.006, keyMat, 0.085, top(-0.02) + 0.003, -0.025, { seg: 12, rx: a });
  const led = k.box(0.008, 0.004, 0.006, k.std(0x2a0806, 0.4), 0.088, top(-0.085) + 0.002, -0.085, { rx: a, cast: false });
  const setLed = switcher(led, k.glowMat(0xff2a1a, 2.2), k.std(0x2a0806, 0.4));
  // handset in the cradle, with its coiled cord
  const hz = 0.0;
  const hy = top(hz) + 0.026;
  k.rbox(0.042, 0.026, 0.2, plastic, -0.07, hy, hz, 0.012, { rx: a });
  k.rbox(0.052, 0.034, 0.065, plastic, -0.07, hy + 0.004 + Math.sin(a) * 0.07, hz - 0.07, 0.014, { rx: a });
  k.rbox(0.052, 0.034, 0.065, plastic, -0.07, hy + 0.004 - Math.sin(a) * 0.07, hz + 0.07, 0.014, { rx: a });
  cord(k, coilPoints([-0.07, hy - 0.01, hz + 0.1], [-0.105, 0.012, -0.02], 9, 0.0055, 0.03), 0.0022, plastic);
  k.tube([[0.0, 0.02, -0.1], [0.0, 0.012, -0.2], [0.03, 0.006, -0.32]], 0.002, k.std(0x9a9a96, 0.6), { seg: 5 });
  let mode = k.bool('message', false) ? 'message' : 'idle';
  k.onScreen((m) => {
    mode = m;
  });
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    const powered = powerOf(k) !== 'blackout' && mode !== 'off';
    lcd(powered);
    if (!powered) return setLed(false);
    if (mode === 'ring') setLed(t % 0.5 < 0.25);
    else if (mode === 'message') setLed(t % 2 < 0.6);
    else setLed(false);
  });
};

// ---------------------------------------------------------------------------
// Radios
// ---------------------------------------------------------------------------

function vfdMat(k: PropKit, key: string, lines: string[], on: boolean, fg: string, bg: string): THREE.MeshStandardMaterial {
  return k.shared(`infra:vfd:${key}:${on}`, () => {
    const t = sharedTex(`vfd:${key}`, () => drawLcd(lines, { w: 256, h: 64, bg, fg, glow: true }));
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: on ? 0xffffff : 0x000000, emissiveIntensity: on ? 1.1 : 0, roughness: 0.35 });
  });
}

/** Desktop base station: radio head on a power-supply tray, palm mic on its hook; occasional chatter. */
function baseRadio(k: PropKit): (lit: boolean, rx: boolean, tx: boolean) => void {
  const dark = k.std(0x2a2c2f, 0.55, 0.25);
  const black = k.std(0x141516, 0.5, 0.1);
  k.rbox(0.24, 0.075, 0.22, dark, 0, 0.0375, 0, 0.008);
  for (let i = 0; i < 7; i++) k.box(0.1, 0.004, 0.002, k.std(0x0a0a0b, 0.9), -0.05, 0.018 + i * 0.007, 0.111);
  k.rbox(0.18, 0.055, 0.17, black, 0, 0.1025, 0.01, 0.01);
  const disp = switcher(k.plane(0.075, 0.02, vfdMat(k, 'base', ['CH2 EVS/MAINT'], false, '#ffb347', '#1a1005'), 0, 0.112, 0.0955, { cast: false }), vfdMat(k, 'base', ['CH2 EVS/MAINT'], true, '#ffb347', '#1a1005'), vfdMat(k, 'base', ['CH2 EVS/MAINT'], false, '#ffb347', '#1a1005'));
  for (const x of [-0.068, 0.068]) k.cyl(0.012, 0.012, 0.016, k.std(0x222325, 0.5, 0.2), x, 0.103, 0.1, { axis: 'z', seg: 14 });
  for (let i = 0; i < 4; i++) k.box(0.012, 0.007, 0.006, k.std(0x3a3c40, 0.5), -0.027 + i * 0.018, 0.091, 0.096);
  const rxLed = switcher(k.box(0.005, 0.005, 0.003, k.std(0x0d200f, 0.4), 0.045, 0.121, 0.0955, { cast: false }), k.glowMat(0x46ff70, 2.2), k.std(0x0d200f, 0.4));
  const txLed = switcher(k.box(0.005, 0.005, 0.003, k.std(0x2a0806, 0.4), 0.055, 0.121, 0.0955, { cast: false }), k.glowMat(0xff3020, 2.2), k.std(0x2a0806, 0.4));
  k.box(0.012, 0.03, 0.02, k.std(0x55595d, 0.4, 0.7), 0.126, 0.06, 0.06);
  k.rbox(0.03, 0.075, 0.05, black, 0.147, 0.06, 0.06, 0.012);
  k.box(0.004, 0.03, 0.03, k.std(0x0a0a0b, 0.9), 0.163, 0.065, 0.06);
  cord(k, coilPoints([0.147, 0.022, 0.06], [0.06, 0.09, 0.095], 7, 0.005, 0.03), 0.002, black);
  k.tube([[0.05, 0.1, -0.075], [0.05, 0.06, -0.16], [0.12, 0.01, -0.3]], 0.0035, black, { seg: 5 });
  return (lit, rx, tx) => {
    disp(lit);
    rxLed(lit && rx);
    txLed(lit && tx);
  };
}

/** Handheld radio standing in its desk charger; the radio's own LCD runs on battery. */
function handheldRadio(k: PropKit): (lit: boolean, rx: boolean, tx: boolean) => void {
  const black = k.std(0x161718, 0.55, 0.1);
  k.rbox(0.085, 0.04, 0.1, k.std(0x222427, 0.5, 0.1), 0, 0.02, 0, 0.01);
  const charge = switcher(k.box(0.012, 0.005, 0.003, k.std(0x0d200f, 0.4), 0.025, 0.028, 0.0505, { cast: false }), k.glowMat(0x46ff70, 2.0), k.std(0x0d200f, 0.4));
  k.rbox(0.058, 0.13, 0.036, black, 0, 0.095, 0, 0.008);
  k.rbox(0.054, 0.07, 0.012, k.std(0x2b2d30, 0.6), 0, 0.075, -0.022, 0.004);
  for (let i = 0; i < 5; i++) k.box(0.034, 0.002, 0.002, k.std(0x050505, 0.9), 0, 0.06 + i * 0.008, 0.0185);
  k.cyl(0.0062, 0.004, 0.16, black, -0.016, 0.24, -0.004, { seg: 8 });
  k.cyl(0.008, 0.008, 0.016, k.std(0x2a2b2d, 0.5), 0.015, 0.168, -0.004, { seg: 10 });
  k.cyl(0.007, 0.007, 0.012, k.std(0xb07a20, 0.5), 0.0, 0.166, -0.004, { seg: 10 });
  k.box(0.006, 0.035, 0.015, k.std(0x2a2b2d, 0.5), -0.031, 0.115, 0);
  const lcdOn = vfdMat(k, 'hh', ['CH 4  EVS'], true, '#d6ff9a', '#203018');
  k.plane(0.032, 0.013, lcdOn, 0, 0.142, 0.0185, { cast: false });
  const busy = switcher(k.box(0.004, 0.004, 0.004, k.std(0x0d200f, 0.4), 0.02, 0.163, -0.004, { cast: false }), k.glowMat(0x46ff70, 2.4), k.std(0x0d200f, 0.4));
  return (lit, rx) => {
    charge(lit);
    busy(rx);
  };
}

/** params.kind 'base' | 'handheld'. setScreen('rx' | 'tx' | 'idle'); idle radios still pick up chatter. */
const radio: PropBuilder = (k) => {
  const set = k.str('kind', 'base') === 'handheld' ? handheldRadio(k) : baseRadio(k);
  let forced: string = 'idle';
  let forcedT = 0;
  let nextChatter = 4 + k.rand() * 8;
  let chatter = 0;
  k.onScreen((m) => {
    forced = m;
    forcedT = m === 'idle' ? 0 : 2.5;
  });
  k.onUpdate((dt) => {
    forcedT = Math.max(0, forcedT - dt);
    nextChatter -= dt;
    if (nextChatter <= 0) {
      chatter = 0.6 + k.rand() * 1.4;
      nextChatter = 7 + k.rand() * 12;
    }
    chatter = Math.max(0, chatter - dt);
    const lit = powerOf(k) !== 'blackout';
    const rx = (forced === 'rx' && forcedT > 0) || chatter > 0;
    const tx = forced === 'tx' && forcedT > 0;
    set(lit, rx, tx);
  });
};

export const DEVICE_BUILDERS: Partial<Record<PropType, PropBuilder>> = { vending, phone, radio };
