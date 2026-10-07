/**
 * Plumbing and wall fixtures: clinical hand sink (+ restroom lavatory, floor mop basin), sharps
 * container, sanitizer dispenser, wall mirror, bi-level drinking fountain, toilet stall.
 * Floor items: origin at the footprint centre, wall plane at local z = -d/2, front +z.
 * Wall-mounted items: origin on the wall surface at the item's vertical centre, protruding +z.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { arcPts, bar, bev, cablePts, clamp, ledMat, line, mat, pick, rod, rr, soft, vary, wallBehind, watchPower } from './props.clinical.common';

// ---------------------------------------------------------------------------
// Sinks
// ---------------------------------------------------------------------------

const sink: PropBuilder = (k) => {
  const kind = k.str('kind', k.def.room === 'restroom' ? 'lavatory' : 'clinical');
  if (kind === 'mop_sink') {
    mopSink(k);
    return;
  }
  const lav = kind === 'lavatory';
  const w = clamp(k.def.footprint?.w ?? 0.6, 0.45, 0.9);
  const d = clamp(k.def.footprint?.d ?? 0.5, 0.4, 0.6);
  const zb = -clamp(wallBehind(k) ?? d / 2, 0, d / 2 + 0.1);
  const bowlM = lav ? mat.porcelain(k) : mat.stainless(k);
  const chrome = lav ? mat.chrome(k) : bowlM;
  const white = mat.plastic(k, 0xdad8d0, 0.45);
  const dark = mat.dark(k);
  const grey = dark;
  const rimY = 0.86;
  const bw = w - 0.04;
  const bd = d - 0.04;
  const bz = zb + bd / 2 + 0.01;
  // basin: aprons, rim frame with a faucet deck, recessed bowl, closed underside
  bev(k, bw, 0.2, 0.02, bowlM, 0, rimY - 0.1, bz + bd / 2 - 0.01, 0.006);
  for (const s of [-1, 1]) bev(k, 0.02, 0.2, bd, bowlM, s * (bw / 2 - 0.01), rimY - 0.1, bz, 0.006);
  bev(k, bw, 0.025, 0.06, bowlM, 0, rimY - 0.0125, bz + bd / 2 - 0.03, 0.008);
  for (const s of [-1, 1]) bev(k, 0.06, 0.025, bd, bowlM, s * (bw / 2 - 0.03), rimY - 0.0125, bz, 0.008);
  bev(k, bw, 0.025, 0.11, bowlM, 0, rimY - 0.0125, zb + 0.065, 0.008);
  k.box(bw - 0.1, 0.008, bd - 0.16, bowlM, 0, rimY - 0.17, bz + 0.025, { cast: false });
  for (const s of [-1, 1]) k.box(0.006, 0.16, bd - 0.16, bowlM, s * (bw / 2 - 0.058), rimY - 0.09, bz + 0.025, { cast: false });
  k.box(bw - 0.1, 0.16, 0.006, bowlM, 0, rimY - 0.09, bz + bd / 2 - 0.058, { cast: false });
  k.box(bw - 0.1, 0.16, 0.006, bowlM, 0, rimY - 0.09, zb + 0.118, { cast: false });
  bev(k, bw - 0.03, 0.02, bd - 0.03, bowlM, 0, rimY - 0.2, bz, 0.006);
  k.cyl(0.024, 0.024, 0.004, chrome, 0, rimY - 0.164, bz + 0.03, { seg: 12, cast: false });
  bev(k, w, 0.3, 0.02, bowlM, 0, rimY + 0.14, zb + 0.01, 0.006);
  for (const s of [-1, 1]) bev(k, 0.03, 0.16, 0.2, dark, s * (bw / 2 - 0.06), rimY - 0.29, zb + 0.1, 0.006, { cast: false });
  if (lav) {
    // sensor faucet
    k.cyl(0.024, 0.03, 0.12, chrome, 0, rimY + 0.06, zb + 0.07, { seg: 12 });
    rod(k, [0, rimY + 0.105, zb + 0.07], [0, rimY + 0.095, zb + 0.17], 0.013, chrome, { cast: false });
    k.box(0.016, 0.012, 0.004, dark, 0, rimY + 0.08, zb + 0.1, { cast: false });
  } else {
    // gooseneck with wrist blades
    k.cyl(0.022, 0.026, 0.04, chrome, 0, rimY + 0.02, zb + 0.065, { seg: 12, cast: false });
    k.cyl(0.013, 0.013, 0.24, chrome, 0, rimY + 0.16, zb + 0.065, { seg: 10 });
    const arc = arcPts([0, rimY + 0.28, zb + 0.155], [0, 0, 1], [0, 1, 0], 0.09, Math.PI, 0, 8);
    line(k, [...arc, [0, rimY + 0.22, zb + 0.245]], 0.011, chrome, { cast: false });
    for (const s of [-1, 1]) bar(k, [s * 0.025, rimY + 0.04, zb + 0.065], [s * 0.15, rimY + 0.06, zb + 0.085], 0.024, 0.007, chrome, { cast: false });
  }
  // P-trap and supplies back to the wall
  line(k, [[0, rimY - 0.21, bz + 0.03], [0, rimY - 0.38, bz + 0.03], [0, rimY - 0.42, bz - 0.04], [0, rimY - 0.36, zb + 0.08], [0, rimY - 0.36, zb]], 0.019, chrome, { cast: false });
  for (const s of [-1, 1]) {
    line(k, [[s * 0.1, rimY - 0.21, zb + 0.1], [s * 0.1, rimY - 0.42, zb + 0.08], [s * 0.1, rimY - 0.44, zb]], 0.005, chrome, { cast: false });
    k.cyl(0.012, 0.012, 0.04, chrome, s * 0.1, rimY - 0.44, zb + 0.02, { axis: 'z', seg: 8, cast: false });
  }
  // soap: wall dispenser beside the splash (deck pump on a lavatory, whose wall belongs to the mirror);
  // towel dispenser above the sink, or off to the side of a lavatory
  if (lav) {
    k.cyl(0.016, 0.019, 0.05, chrome, -0.16, rimY + 0.025, zb + 0.065, { seg: 10, cast: false });
    rod(k, [-0.16, rimY + 0.05, zb + 0.065], [-0.16, rimY + 0.055, zb + 0.12], 0.006, chrome, { cast: false });
  } else {
    const sx = -(w / 2 - 0.07);
    bev(k, 0.11, 0.2, 0.09, white, sx, rimY + 0.4, zb + 0.045, 0.015);
    bev(k, 0.08, 0.05, 0.02, grey, sx, rimY + 0.33, zb + 0.1, 0.008, { cast: false });
  }
  const tx = lav ? w / 2 + 0.27 : 0;
  const ty = lav ? 1.32 : 1.55;
  bev(k, 0.3, 0.38, 0.1, lav ? mat.stainless(k) : white, tx, ty, zb + 0.05, 0.012);
  k.box(0.22, 0.012, 0.004, dark, tx, ty - 0.165, zb + 0.1, { cast: false });
  k.box(0.2, 0.11, 0.002, mat.paper(k), tx, ty - 0.235, zb + 0.095, { rx: 0.12, cast: false });
  k.box(0.06, 0.02, 0.003, dark, tx + 0.1, ty + 0.12, zb + 0.1, { cast: false });
};

/** Floor-level mop basin with a stainless splash panel, service faucet, hose and a hanging broom. */
function mopSink(k: PropKit): void {
  const w = k.def.footprint?.w ?? 0.8;
  const d = k.def.footprint?.d ?? 0.6;
  const zb = -d / 2;
  const stone = k.std(vary(k, 0xb5b2a8, 0.04), 0.78, 0);
  const steel = mat.stainless(k);
  const chrome = steel;
  const dark = mat.dark(k);
  const hose = mat.plastic(k, pick(k, [0x2f5a35, 0x3b5f8a]), 0.6);
  const h = 0.25;
  bev(k, w, 0.04, d, stone, 0, 0.02, 0, 0.01);
  for (const s of [-1, 1]) bev(k, 0.06, h, d, stone, s * (w / 2 - 0.03), h / 2, 0, 0.01);
  bev(k, w - 0.12, h, 0.06, stone, 0, h / 2, d / 2 - 0.03, 0.01);
  bev(k, w - 0.12, h, 0.04, stone, 0, h / 2, zb + 0.02, 0.008);
  k.box(w - 0.04, 0.006, 0.07, steel, 0, h + 0.003, d / 2 - 0.03, { cast: false });
  for (const s of [-1, 1]) k.box(0.07, 0.006, d - 0.02, steel, s * (w / 2 - 0.03), h + 0.003, 0, { cast: false });
  k.cyl(0.04, 0.04, 0.004, dark, 0, 0.044, 0.01, { seg: 12, cast: false });
  // splash panel and service faucet with vacuum breaker, bucket hook and wall brace
  bev(k, w, 0.62, 0.008, steel, 0, h + 0.31, zb + 0.004, 0.003);
  const fy = 1.0;
  const fz = zb + 0.06;
  k.cyl(0.03, 0.03, 0.18, chrome, 0, fy, fz, { axis: 'x', seg: 10 });
  for (const s of [-1, 1]) {
    k.cyl(0.012, 0.012, 0.06, chrome, s * 0.09, fy, zb + 0.03, { axis: 'z', seg: 8, cast: false });
    k.box(0.06, 0.012, 0.012, chrome, s * 0.09, fy + 0.04, fz + 0.01, { cast: false });
    k.box(0.012, 0.06, 0.012, chrome, s * 0.09, fy + 0.04, fz + 0.01, { cast: false });
  }
  k.cyl(0.022, 0.022, 0.16, chrome, 0, fy + 0.11, fz, { seg: 10, cast: false });
  line(k, [[0, fy - 0.02, fz], [0, fy - 0.06, fz + 0.1], [0, fy - 0.16, fz + 0.12]], 0.014, chrome, { cast: false });
  line(k, [[0, fy - 0.1, fz + 0.1], [0.02, fy - 0.12, fz + 0.13], [0.02, fy - 0.08, fz + 0.15]], 0.004, chrome, { cast: false });
  rod(k, [0, fy - 0.12, fz + 0.11], [0, fy - 0.3, zb + 0.01], 0.006, chrome, { cast: false });
  // hose draped from the spout into the basin and coiled on its floor
  line(k, [...cablePts([0, fy - 0.17, fz + 0.12], [0.12, 0.07, 0.05], 0.05, 6), [0.2, 0.06, 0.12], [0.12, 0.06, 0.18], [0.02, 0.06, 0.1]], 0.012, hose, { cast: false });
  // broom hanging from a clip rail beside the basin
  const bx = w / 2 + 0.14;
  bev(k, 0.3, 0.03, 0.03, steel, bx, 1.42, zb + 0.015, 0.006, { cast: false });
  rod(k, [bx, 1.42, zb + 0.04], [bx + 0.02, 0.42, zb + 0.06], 0.012, hose);
  bev(k, 0.3, 0.06, 0.05, dark, bx + 0.02, 0.38, zb + 0.06, 0.008);
  k.box(0.28, 0.12, 0.04, dark, bx + 0.02, 0.29, zb + 0.06, { cast: false });
}

// ---------------------------------------------------------------------------
// Wall-mounted items
// ---------------------------------------------------------------------------

const sharpsBin: PropBuilder = (k) => {
  const red = k.std(0x8f1e19, 0.35, 0);
  const lid = mat.plastic(k, 0xd8d4ca, 0.4);
  const bracket = mat.plastic(k, vary(k, 0x8e9396, 0.04), 0.5);
  const dark = mat.dark(k);
  const white = lid;
  bev(k, 0.31, 0.38, 0.012, bracket, 0, -0.01, 0.006, 0.004);
  bev(k, 0.31, 0.025, 0.17, bracket, 0, -0.175, 0.087, 0.006);
  for (const s of [-1, 1]) bev(k, 0.012, 0.14, 0.16, bracket, s * 0.15, -0.11, 0.082, 0.004, { cast: false });
  soft(k, 0.27, 0.28, 0.15, red, 0, -0.025, 0.087, 0.02);
  bev(k, 0.276, 0.05, 0.156, lid, 0, 0.135, 0.087, 0.012);
  k.box(0.14, 0.014, 0.004, dark, 0, 0.13, 0.166, { cast: false });
  bev(k, 0.14, 0.03, 0.006, lid, 0, 0.15, 0.17, 0.003, { rx: -0.35, cast: false });
  k.box(0.27, 0.004, 0.002, white, 0, 0.065, 0.163, { cast: false });
  k.box(0.1, 0.07, 0.002, white, 0, -0.05, 0.163, { cast: false });
  k.cyl(0.006, 0.006, 0.004, dark, 0.12, 0.16, 0.013, { axis: 'z', seg: 8, cast: false });
};

const handSanitizer: PropBuilder = (k) => {
  const shell = mat.plastic(k, vary(k, 0xd9d8d2, 0.03), 0.4);
  const grey = mat.plastic(k, 0x7f868b, 0.5);
  const dark = grey;
  const gel = k.phys('clin:gel', { color: 0x9fc6d6, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false });
  bev(k, 0.125, 0.27, 0.01, grey, 0, 0.02, 0.005, 0.004);
  soft(k, 0.12, 0.25, 0.1, shell, 0, 0.02, 0.055, 0.025);
  bev(k, 0.1, 0.07, 0.025, grey, 0, -0.07, 0.11, 0.01);
  k.box(0.05, 0.06, 0.002, gel, 0, 0.05, 0.1055, { cast: false });
  k.box(0.05, 0.03, 0.0025, dark, 0, 0.065, 0.1055, { cast: false });
  k.cyl(0.006, 0.006, 0.015, dark, 0, -0.112, 0.075, { seg: 8, cast: false });
  // drip tray below, with a little dried residue in it and a run down the wall
  bev(k, 0.1, 0.02, 0.07, grey, 0, -0.25, 0.035, 0.006);
  k.box(0.07, 0.002, 0.045, gel, 0, -0.239, 0.04, { cast: false });
};

const mirror: PropBuilder = (k) => {
  const w = k.num('w', 0.6);
  const h = k.num('h', 0.9);
  const frame = mat.stainless(k);
  const glassM = k.shared('clin:mirror', () => new THREE.MeshStandardMaterial({ color: 0x9aa3a6, metalness: 1, roughness: 0.04 }));
  const haze = k.shared('clin:mirror_haze', () => new THREE.MeshStandardMaterial({ color: 0x4a4a42, roughness: 1, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
  const rot = k.shared('clin:mirror_rot', () => new THREE.MeshStandardMaterial({ color: 0x14130f, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.45, depthWrite: false }));
  k.box(w - 0.02, h - 0.02, 0.006, glassM, 0, 0, 0.006, { cast: false });
  for (const s of [-1, 1]) {
    bev(k, w, 0.02, 0.022, frame, 0, s * (h / 2 - 0.01), 0.011, 0.004);
    bev(k, 0.02, h, 0.022, frame, s * (w / 2 - 0.01), 0, 0.011, 0.004);
  }
  // grime: faint haze, desilvering creeping in from the edges, a few spots
  k.plane(w - 0.04, h - 0.04, haze, 0, 0, 0.0095);
  k.plane(w - 0.04, 0.035, rot, 0, -h / 2 + 0.0375, 0.0097);
  k.plane(w - 0.04, 0.018, rot, 0, h / 2 - 0.029, 0.0097);
  for (const s of [-1, 1]) k.plane(0.022, h - 0.08, rot, s * (w / 2 - 0.031), 0, 0.0097);
  for (let i = 0; i < 6; i++) {
    const sx = (k.rand() < 0.5 ? -1 : 1) * rr(k, w / 2 - 0.09, w / 2 - 0.04);
    const sy = rr(k, -h / 2 + 0.05, h / 2 - 0.05);
    k.plane(rr(k, 0.006, 0.02), rr(k, 0.006, 0.03), rot, sx, sy, 0.0098);
  }
};

// ---------------------------------------------------------------------------
// Bi-level drinking fountain with bottle filler
// ---------------------------------------------------------------------------

const waterFountain: PropBuilder = (k) => {
  const d = k.def.footprint?.d ?? 0.45;
  const zb = -clamp(wallBehind(k) ?? d / 2, 0, d / 2 + 0.1);
  const steel = mat.stainless(k);
  const inner = k.std(0x8d9193, 0.25, 0.85);
  const chrome = steel;
  const dark = mat.dark(k);
  const bowl = (x: number, top: number): void => {
    soft(k, 0.38, 0.17, 0.44, steel, x, top - 0.085, zb + 0.22, 0.04);
    k.box(0.28, 0.004, 0.28, inner, x, top + 0.001, zb + 0.24, { cast: false });
    k.cyl(0.018, 0.018, 0.003, dark, x, top + 0.004, zb + 0.24, { seg: 10, cast: false });
    k.cyl(0.011, 0.014, 0.035, chrome, x - 0.09, top + 0.018, zb + 0.16, { seg: 8, cast: false });
    k.sphere(0.016, chrome, x - 0.09, top + 0.04, zb + 0.16, { seg: 8, cast: false });
    bev(k, 0.3, 0.035, 0.025, steel, x, top - 0.065, zb + 0.452, 0.008, { cast: false });
    bev(k, 0.34, 0.14, 0.24, steel, x, top - 0.24, zb + 0.12, 0.02);
  };
  bowl(-0.2, 0.86);
  bowl(0.2, 1.02);
  bev(k, 0.8, 0.56, 0.015, steel, 0, 0.78, zb + 0.0075, 0.004);
  // bottle filler above the high bowl: recess, nozzle, sensor, filter status bar
  bev(k, 0.32, 0.66, 0.11, steel, 0.2, 1.43, zb + 0.055, 0.02);
  bev(k, 0.22, 0.34, 0.012, dark, 0.2, 1.36, zb + 0.111, 0.006, { cast: false });
  k.cyl(0.012, 0.012, 0.03, chrome, 0.2, 1.51, zb + 0.09, { seg: 8, cast: false });
  k.box(0.02, 0.012, 0.004, dark, 0.2, 1.555, zb + 0.112, { cast: false });
  const status = ledMat(k, 0x45d07a, 0.8);
  const count = status;
  k.box(0.09, 0.012, 0.003, status, 0.2, 1.665, zb + 0.112, { cast: false });
  k.box(0.07, 0.022, 0.003, count, 0.2, 1.635, zb + 0.112, { cast: false });
  watchPower(k, (on) => {
    status.emissiveIntensity = on ? 0.8 : 0;
  });
};

// ---------------------------------------------------------------------------
// Toilet stall (partitions, pilasters, door, floor-mounted toilet with flush valve)
// ---------------------------------------------------------------------------

const toiletStall: PropBuilder = (k) => {
  const w = k.num('w', k.def.footprint?.w ?? 1.2);
  const d = k.num('d', k.def.footprint?.d ?? 1.4);
  const panel = mat.painted(k, vary(k, pick(k, [0x8e8a80, 0x7d8580, 0x9a948a]), 0.04), 0.45);
  const hw = mat.stainless(k);
  const alu = hw;
  const china = mat.porcelain(k);
  const chrome = hw;
  const y0 = 0.3;
  const y1 = 1.75;
  const zf = d / 2 - 0.0125;
  // side partitions on wall brackets (skipped where a neighbour shares the panel)
  for (const s of [-1, 1]) {
    if (k.bool(s < 0 ? 'noLeft' : 'noRight', false)) continue;
    const x = s * (w / 2 - 0.0125);
    bev(k, 0.025, y1 - y0, d - 0.05, panel, x, (y0 + y1) / 2, -0.015, 0.006);
    for (const yy of [y0 + 0.15, y1 - 0.15]) k.box(0.05, 0.03, 0.03, hw, x, yy, -d / 2 + 0.015, { cast: false });
  }
  // pilasters on stainless shoes, anti-grip headrail
  const dw = 0.61;
  const pw = (w - dw - 0.012) / 2;
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - pw / 2);
    bev(k, pw, 1.82, 0.025, panel, x, 0.92, zf, 0.006);
    bev(k, pw + 0.008, 0.1, 0.035, hw, x, 0.05, zf, 0.006, { cast: false });
  }
  bev(k, w + 0.02, 0.04, 0.03, alu, 0, 1.85, zf, 0.006);
  // door, hinged on the right pilaster, swinging inward
  const state = k.str('door', k.rand() < 0.3 ? 'closed' : k.rand() < 0.75 ? 'ajar' : 'open');
  const a = state === 'closed' ? 0 : state === 'open' ? rr(k, 1.0, 1.35) : rr(k, 0.18, 0.4);
  const hx = w / 2 - pw - 0.004;
  const hz = zf;
  const at = (u: number, y: number, t: number): [number, number, number] => [hx - u * Math.cos(a) - t * Math.sin(a), y, hz - u * Math.sin(a) + t * Math.cos(a)];
  bev(k, dw - 0.004, y1 - y0, 0.025, panel, ...at(dw / 2, (y0 + y1) / 2, 0), 0.006, { ry: -a });
  for (const yy of [y0 + 0.12, (y0 + y1) / 2, y1 - 0.12]) k.box(0.02, 0.08, 0.03, hw, hx + 0.006, yy, hz, { cast: false });
  bev(k, 0.06, 0.03, 0.012, hw, ...at(dw - 0.05, 1.05, 0.02), 0.004, { ry: -a, cast: false });
  bev(k, 0.035, 0.018, 0.006, k.std(state === 'closed' ? 0x9c2a22 : 0x2f7a46, 0.5, 0), ...at(dw - 0.05, 1.1, 0.015), 0.002, { ry: -a, cast: false });
  bev(k, 0.025, 0.05, 0.03, hw, ...at(dw / 2, 1.55, -0.03), 0.006, { ry: -a, cast: false });
  // floor-mounted elongated toilet against the back wall, exposed flush valve
  const tz = -d / 2 + 0.36;
  const bowl = k.lathe([[0, 0], [0.13, 0], [0.12, 0.05], [0.1, 0.2], [0.16, 0.3], [0.185, 0.37], [0.185, 0.385], [0, 0.385]], china, 0, 0, tz, { seg: 16 });
  bowl.scale.z = 1.22;
  const rim = k.torus(0.16, 0.024, china, 0, 0.385, tz, { rx: Math.PI / 2, seg: 24 });
  rim.scale.y = 1.22;
  const seat = k.torus(0.16, 0.02, china, 0, 0.413, tz + 0.01, { rx: Math.PI / 2, seg: 24, cast: false });
  seat.scale.y = 1.22;
  k.box(0.12, 0.02, 0.05, china, 0, 0.41, tz - 0.21, { cast: false });
  const water = k.cyl(0.11, 0.11, 0.003, k.std(0x23282a, 0.06, 0.1), 0, 0.3, tz + 0.02, { seg: 16, cast: false });
  water.scale.z = 1.18;
  line(k, [[0, 0.86, -d / 2], [0, 0.86, -d / 2 + 0.09]], 0.014, chrome, { cast: false });
  k.cyl(0.03, 0.03, 0.12, chrome, 0, 0.86, -d / 2 + 0.1, { axis: 'x', seg: 10 });
  bar(k, [0.05, 0.86, -d / 2 + 0.1], [0.14, 0.84, -d / 2 + 0.13], 0.012, 0.012, chrome, { cast: false });
  line(k, [[0, 0.82, -d / 2 + 0.1], [0, 0.44, -d / 2 + 0.11], [0, 0.4, -d / 2 + 0.15]], 0.016, chrome, { cast: false });
  // jumbo roll dispenser on the left partition
  const px = -w / 2 + 0.025 + 0.06;
  k.cyl(0.14, 0.14, 0.12, hw, px, 0.62, tz + 0.25, { axis: 'x', seg: 18 });
  k.box(0.04, 0.12, 0.08, china, px, 0.47, tz + 0.25, { cast: false });
};

export const FIXTURE_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  sink,
  sharps_bin: sharpsBin,
  hand_sanitizer: handSanitizer,
  mirror,
  water_fountain: waterFountain,
  toilet_stall: toiletStall,
};
