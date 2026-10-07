/**
 * Patient-carrying clinical props: hospital bed (+ imaging table), transport stretcher, wheelchair
 * and IV stand. Long items run along local z with the head end at +z; the wheelchair occupant
 * faces +z.
 */
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { type V3, bar, bev, cablePts, caster, ceilingAbove, clamp, line, mat, pick, rod, rr, soft, starBase, tiltX, vary } from './props.clinical.common';

// ---------------------------------------------------------------------------
// Hospital bed
// ---------------------------------------------------------------------------

const bed: PropBuilder = (k) => {
  if (k.str('kind', 'bed') === 'imaging_table') {
    imagingTable(k);
    return;
  }
  const plastic = mat.plastic(k, vary(k, 0xd8d3c6, 0.04), 0.5);
  const frameM = mat.painted(k, vary(k, 0x7c8184, 0.05), 0.45);
  const dark = mat.plastic(k, 0x33373a, 0.55);
  const vinyl = mat.vinyl(k, 0x3d5060, 0.4);
  const sheet = mat.linen(k);
  const blanket = mat.fabric(k, pick(k, [0x9fb4c2, 0xb7c0c4, 0xa7b8ae]), 0.95);
  const rub = dark;
  const metal = frameM;

  // base: casters, end bars, spine, shroud, lift columns
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(k, sx * 0.34, sz * 0.8, 0.175, 0.064, metal, rub, rr(k, 0, Math.PI * 2), { width: 0.04 });
  for (const sz of [-1, 1]) bev(k, 0.78, 0.05, 0.08, frameM, 0, 0.2, sz * 0.8, 0.01);
  bev(k, 0.1, 0.05, 1.55, frameM, 0, 0.2, 0, 0.01);
  soft(k, 0.68, 0.1, 1.45, plastic, 0, 0.275, 0, 0.035);
  for (const sz of [-1, 1]) bev(k, 0.15, 0.14, 0.13, dark, 0, 0.39, sz * 0.48, 0.02);
  bev(k, 0.26, 0.022, 0.07, dark, 0, 0.145, -0.9, 0.006);
  // sleep frame
  for (const sx of [-1, 1]) bev(k, 0.05, 0.05, 1.98, frameM, sx * 0.41, 0.455, 0, 0.01);
  for (const sz of [-1, 1]) bev(k, 0.86, 0.05, 0.05, frameM, 0, 0.455, sz * 0.97, 0.01);
  k.box(0.84, 0.015, 1.24, dark, 0, 0.478, -0.35);

  // mattress: foot/seat section + head section on its hinge. Flat by default: lying figures
  // (patients, John) are posed flat at mattress height; params.back (radians) raises an empty bed.
  const a = clamp(k.num('back', 0), 0, 1.1);
  const hinge: V3 = [0, 0.485, 0.27];
  const up = (p: V3): V3 => tiltX(p, hinge, -a);
  k.box(0.84, 0.015, 0.7, dark, ...up([0, 0.478, 0.62]), { rx: -a });
  soft(k, 0.86, 0.14, 1.25, vinyl, 0, 0.555, -0.355, 0.04);
  soft(k, 0.86, 0.14, 0.7, vinyl, ...up([0, 0.555, 0.62]), 0.04, { rx: -a });
  soft(k, 0.875, 0.06, 1.262, sheet, 0, 0.598, -0.355, 0.02);
  soft(k, 0.875, 0.06, 0.712, sheet, ...up([0, 0.598, 0.62]), 0.02, { rx: -a });
  const pillowRot = -a + rr(k, -0.06, 0.04);
  soft(k, 0.56, 0.085, 0.34, sheet, ...up([rr(k, -0.04, 0.04), 0.668, 0.75]), 0.04, { rx: pillowRot, ry: rr(k, -0.06, 0.06) });

  // head board (+z) and foot board (-z), molded, with bumpers and a control panel
  soft(k, 0.92, 0.5, 0.05, plastic, 0, 0.73, 1.045, 0.022);
  bev(k, 0.66, 0.26, 0.012, dark, 0, 0.76, 1.074, 0.01);
  for (const sx of [-1, 1]) {
    k.cyl(0.045, 0.045, 0.036, rub, sx * 0.44, 0.44, 1.065, { seg: 12, cast: false });
    k.cyl(0.017, 0.017, 0.07, metal, sx * 0.45, 0.48, 0.99, { seg: 8, cast: false });
  }
  soft(k, 0.92, 0.42, 0.05, plastic, 0, 0.69, -1.045, 0.022);
  bev(k, 0.34, 0.12, 0.012, dark, 0, 0.77, -1.074, 0.008);
  for (let i = 0; i < 4; i++) k.box(0.04, 0.02, 0.004, metal, -0.11 + i * 0.075, 0.77, -1.082, { cast: false });

  // split side rails; one foot rail often left down
  const lowered = k.rand() < 0.45 ? (k.rand() < 0.5 ? -1 : 1) : 0;
  const rail = (side: number, z0: number, z1: number, low: boolean): void => {
    const x = side * 0.468;
    const topY = low ? 0.55 : 0.9;
    const botY = topY - 0.25;
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    bev(k, 0.034, 0.045, len, plastic, x, topY, zc, 0.014);
    bev(k, 0.026, 0.03, len - 0.06, plastic, x, botY, zc, 0.01);
    for (const t of [0.05, 0.5, 0.95]) bev(k, 0.026, topY - botY, 0.035, plastic, x, (topY + botY) / 2, z0 + len * t, 0.01);
    bar(k, [x, botY, zc - len * 0.25], [side * 0.415, 0.47, zc - len * 0.3], 0.03, 0.02, dark, { cast: false });
    bar(k, [x, botY, zc + len * 0.25], [side * 0.415, 0.47, zc + len * 0.2], 0.03, 0.02, dark, { cast: false });
  };
  for (const s of [-1, 1]) {
    rail(s, 0.16, 0.9, false);
    rail(s, -0.9, -0.14, lowered === s);
  }
  // nurse-call pendant clipped over a head rail, cord looping to the frame
  bev(k, 0.055, 0.14, 0.03, dark, 0.495, 0.84, 0.55, 0.01, { cast: false });
  line(k, cablePts([0.49, 0.77, 0.55], [0.415, 0.47, 0.78], 0.12, 6), 0.0035, dark, { cast: false });

  if (k.bool('occupied', false)) {
    // a still shape under the blanket, head turned to the wall
    const skin = mat.plastic(k, 0xa98a74, 0.6);
    const hair = mat.plastic(k, 0x1d1916, 0.8);
    soft(k, 0.5, 0.15, 1.05, blanket, 0, 0.69, -0.46, 0.07);
    for (const sx of [-1, 1]) k.sphere(0.065, blanket, sx * 0.09, 0.73, -0.93, { seg: 10, sy: 0.85 });
    soft(k, 0.54, 0.17, 0.5, blanket, ...up([0, 0.7, 0.45]), 0.08, { rx: -a });
    const hp = up([0.03, 0.78, 0.74]);
    k.sphere(0.09, skin, hp[0], hp[1], hp[2], { seg: 14 });
    k.sphere(0.096, hair, hp[0] - 0.025, hp[1] + 0.012, hp[2] + 0.012, { seg: 14 });
  } else {
    // folded blanket at the foot
    soft(k, 0.82, 0.05, 0.42, blanket, rr(k, -0.03, 0.03), 0.654, -0.73, 0.02, { ry: rr(k, -0.05, 0.05) });
  }
};

/** Imaging (fluoroscopy) table on a pedestal with a ceiling-suspended C-arm over the head half. */
function imagingTable(k: PropKit): void {
  const shell = mat.plastic(k, vary(k, 0xd6d4cc, 0.03), 0.42);
  const grey = mat.plastic(k, 0x878c90, 0.5);
  const dark = mat.plastic(k, 0x2a2d30, 0.5);
  const topM = dark;
  const pad = mat.vinyl(k, 0x4a5a68, 0.45);
  const metal = grey;
  const paper = mat.paper(k);

  // pedestal on the foot half: floor plate, column, bellows
  soft(k, 0.64, 0.05, 0.9, grey, 0, 0.025, -0.45, 0.02);
  soft(k, 0.42, 0.56, 0.56, shell, 0, 0.33, -0.45, 0.06);
  for (let i = 0; i < 4; i++) bev(k, 0.36 - i * 0.01, 0.022, 0.48, dark, 0, 0.625 + i * 0.03, -0.42, 0.006);
  bev(k, 0.014, 0.1, 0.2, dark, 0.216, 0.48, -0.3, 0.004, { cast: false });
  // cantilevered carbon top, pad, paper sheet, head rest, accessory rails
  bev(k, 0.56, 0.05, 2.2, topM, 0, 0.775, 0, 0.02);
  soft(k, 0.5, 0.05, 1.92, pad, 0, 0.825, 0.04, 0.02);
  k.box(0.44, 0.002, 1.5, paper, 0, 0.851, -0.05, { cast: false });
  soft(k, 0.26, 0.06, 0.24, pad, 0, 0.88, 0.94, 0.03);
  for (const sx of [-1, 1]) {
    k.box(0.012, 0.026, 1.8, metal, sx * 0.29, 0.77, 0, { cast: false });
    for (const z of [-0.8, 0, 0.8]) k.box(0.02, 0.02, 0.02, metal, sx * 0.284, 0.77, z, { cast: false });
  }

  // C-arm around the head half, hung from a ceiling carriage
  const ceil = ceilingAbove(k);
  const cz = 0.45;
  const cy = 0.88;
  const R = 0.78;
  k.torus(R, 0.055, shell, 0, cy, cz, { arc: Math.PI * 1.12, rz: Math.PI / 2 - 0.06, seg: 30 });
  bev(k, 0.44, 0.12, 0.44, shell, 0, cy + R - 0.1, cz, 0.03);
  bev(k, 0.36, 0.012, 0.36, dark, 0, cy + R - 0.166, cz, 0.004);
  bev(k, 0.3, 0.16, 0.3, shell, 0, cy - R + 0.13, cz, 0.03);
  bev(k, 0.18, 0.05, 0.18, dark, 0, cy - R + 0.235, cz, 0.008);
  const cx = -R - 0.06;
  bev(k, 0.16, 0.3, 0.22, grey, cx, cy, cz, 0.02);
  const colX = -R - 0.16;
  bar(k, [cx - 0.05, cy, cz], [colX, cy + 0.12, cz], 0.12, 0.1, grey);
  const colTop = ceil - 0.12;
  const colBot = cy + 0.12;
  soft(k, 0.18, (colTop - colBot) * 0.55, 0.18, shell, colX, colTop - (colTop - colBot) * 0.275, cz, 0.03);
  soft(k, 0.14, (colTop - colBot) * 0.5, 0.14, grey, colX, colBot + (colTop - colBot) * 0.25, cz, 0.02);
  bev(k, 0.6, 0.1, 0.42, grey, colX, ceil - 0.08, cz, 0.02);
  for (const s of [-1, 1]) bev(k, 0.06, 0.05, 2.3, metal, colX + s * 0.26, ceil - 0.025, 0.1, 0.008);
  // ceiling monitor boom with two dead displays facing the table
  const mx = 0.75;
  k.cyl(0.03, 0.03, ceil - 1.95, grey, mx, (ceil + 1.95) / 2, 0.8, { seg: 10 });
  bev(k, 0.08, 0.06, 0.9, grey, mx, 1.95, 0.8, 0.01);
  for (const s of [-1, 1]) {
    bev(k, 0.05, 0.36, 0.56, dark, mx - 0.03, 1.72, 0.8 + s * 0.29, 0.01);
    k.box(0.002, 0.32, 0.52, topM, mx - 0.056, 1.72, 0.8 + s * 0.29, { cast: false });
  }
}

// ---------------------------------------------------------------------------
// Transport stretcher
// ---------------------------------------------------------------------------

const stretcher: PropBuilder = (k) => {
  const frameM = mat.satin(k);
  const shell = mat.plastic(k, vary(k, 0xc7c9c4, 0.04), 0.5);
  const dark = mat.plastic(k, 0x2d3033, 0.55);
  const pad = mat.vinyl(k, pick(k, [0x1f2a33, 0x2a2e34]), 0.38);
  const sheet = mat.linen(k);
  const blanket = mat.fabric(k, pick(k, [0xb6c3c8, 0xc3bead]), 0.95);
  const rub = dark;
  const o2 = mat.painted(k, 0x3b6a4a, 0.45);

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(k, sx * 0.22, sz * 0.66, 0.225, 0.1, frameM, rub, rr(k, 0, Math.PI * 2), { width: 0.045 });
  for (const sz of [-1, 1]) bev(k, 0.5, 0.04, 0.07, frameM, 0, 0.235, sz * 0.66, 0.008);
  soft(k, 0.56, 0.1, 1.5, shell, 0, 0.29, 0, 0.03);
  bev(k, 0.5, 0.012, 1.3, dark, 0, 0.346, 0, 0.004);
  // oxygen cylinder riding in the base tray
  k.cyl(0.05, 0.05, 0.6, o2, 0.1, 0.402, -0.12, { axis: 'z', seg: 12 });
  k.sphere(0.05, o2, 0.1, 0.402, 0.18, { seg: 10 });
  k.cyl(0.018, 0.018, 0.05, frameM, 0.1, 0.402, 0.24, { axis: 'z', seg: 8, cast: false });
  k.cyl(0.0505, 0.0505, 0.04, sheet, 0.1, 0.402, 0.12, { axis: 'z', seg: 12, cast: false });
  // twin lift columns with bellows
  for (const sz of [-1, 1]) {
    soft(k, 0.14, 0.3, 0.12, shell, 0, 0.5, sz * 0.42, 0.03);
    for (let i = 0; i < 3; i++) bev(k, 0.15, 0.012, 0.13, dark, 0, 0.42 + i * 0.06, sz * 0.42, 0.004, { cast: false });
  }
  // litter frame and deck
  for (const sx of [-1, 1]) bev(k, 0.04, 0.04, 1.95, frameM, sx * 0.335, 0.68, 0, 0.008);
  for (const sz of [-1, 1]) bev(k, 0.7, 0.04, 0.04, frameM, 0, 0.68, sz * 0.955, 0.008);
  bev(k, 0.64, 0.025, 1.9, shell, 0, 0.71, 0, 0.008);
  // pad: flat foot section, raised backrest
  const a = rr(k, 0.45, 0.7);
  const hinge: V3 = [0, 0.7225, 0.23];
  const up = (p: V3): V3 => tiltX(p, hinge, -a);
  soft(k, 0.62, 0.075, 1.18, pad, 0, 0.76, -0.36, 0.03);
  soft(k, 0.62, 0.075, 0.7, pad, ...up([0, 0.76, 0.58]), 0.03, { rx: -a });
  bev(k, 0.635, 0.03, 1.19, sheet, 0, 0.787, -0.36, 0.012);
  bev(k, 0.635, 0.03, 0.71, sheet, ...up([0, 0.787, 0.58]), 0.012, { rx: -a });
  soft(k, 0.48, 0.1, 0.3, sheet, ...up([0, 0.85, 0.74]), 0.045, { rx: -a + 0.05 });
  soft(k, 0.6, 0.05, 0.38, blanket, rr(k, -0.03, 0.03), 0.825, -0.72, 0.02, { ry: rr(k, -0.08, 0.08) });
  k.box(0.22, 0.004, 0.3, sheet, rr(k, -0.1, 0.1), 0.852, -0.7, { ry: rr(k, -0.4, 0.4), cast: false });
  // tubular side rails (raised), push handle, IV pole, corner bumpers
  for (const s of [-1, 1]) {
    const x = s * 0.37;
    line(k, [[x, 0.69, -0.52], [x, 0.98, -0.52], [x, 0.98, 0.42], [x, 0.69, 0.42]], 0.011, frameM);
    line(k, [[x, 0.86, -0.52], [x, 0.86, 0.42]], 0.008, frameM, { cast: false });
    k.cyl(0.04, 0.04, 0.03, rub, s * 0.355, 0.66, 0.975, { seg: 12, cast: false });
    k.cyl(0.04, 0.04, 0.03, rub, s * 0.355, 0.66, -0.975, { seg: 12, cast: false });
  }
  line(k, [[-0.3, 0.68, 0.955], [-0.3, 0.97, 1.0], [0.3, 0.97, 1.0], [0.3, 0.68, 0.955]], 0.013, frameM);
  k.cyl(0.0105, 0.0105, 1.1, frameM, -0.335, 1.23, 0.94, { seg: 8 });
  for (const s of [-1, 1]) line(k, [[-0.335, 1.77, 0.94], [-0.335 + s * 0.04, 1.75, 0.94], [-0.335 + s * 0.055, 1.78, 0.94]], 0.004, frameM, { cast: false });
};

// ---------------------------------------------------------------------------
// Wheelchair
// ---------------------------------------------------------------------------

const wheelchair: PropBuilder = (k) => {
  const frameM = k.std(0xb7bbbe, 0.3, 0.78);
  const vinyl = mat.vinyl(k, 0x1c1e22, 0.55);
  const rub = vinyl;
  const hubM = frameM;
  const blackM = vinyl;
  const R = 0.3;
  const axY = R;
  const axZ = -0.17;
  const sx = 0.235;
  for (const s of [-1, 1]) {
    const x = s * sx;
    // side frame: front post, seat rail, back post with push handle, lower rail
    line(k, [[x, 0.2, 0.28], [x, 0.49, 0.255], [x, 0.5, 0.2], [x, 0.5, -0.2]], 0.011, frameM);
    line(k, [[x, 0.24, -0.19], [x, 0.5, -0.215], [x, 0.93, -0.26], [x, 0.962, -0.295], [x, 0.968, -0.34]], 0.011, frameM);
    k.cyl(0.0145, 0.0145, 0.1, rub, x, 0.968, -0.39, { axis: 'z', seg: 10, cast: false });
    line(k, [[x, 0.205, 0.28], [x, 0.235, -0.19]], 0.01, frameM, { cast: false });
    // desk-length armrest with pad
    line(k, [[x, 0.5, 0.12], [x, 0.69, 0.11], [x, 0.69, -0.17], [x, 0.5, -0.19]], 0.009, frameM, { cast: false });
    bev(k, 0.05, 0.03, 0.3, vinyl, x, 0.71, -0.03, 0.01);
    // swing-away footrest hanger and plate
    line(k, [[x, 0.48, 0.255], [x, 0.43, 0.32], [x, 0.18, 0.43]], 0.0095, frameM, { cast: false });
    bev(k, 0.16, 0.012, 0.13, blackM, x - s * 0.08, 0.17, 0.47, 0.004, { rx: rr(k, -0.15, 0.25), cast: false });
    // big rear wheel: tyre, rim, hub, spokes, push rim
    const wx = s * 0.3;
    k.torus(R - 0.016, 0.016, rub, wx, axY, axZ, { ry: Math.PI / 2, seg: 20 });
    k.torus(R - 0.034, 0.006, frameM, wx, axY, axZ, { ry: Math.PI / 2, seg: 16, cast: false });
    k.cyl(0.032, 0.032, 0.07, hubM, wx, axY, axZ, { axis: 'x', seg: 12, cast: false });
    const spin = k.rand() * Math.PI;
    for (let i = 0; i < 12; i++) {
      const ang = spin + (i / 12) * Math.PI * 2;
      const side = i % 2 ? 1 : -1;
      rod(k, [wx + side * 0.022, axY + Math.sin(ang + 0.35) * 0.028, axZ + Math.cos(ang + 0.35) * 0.028], [wx + side * 0.004, axY + Math.sin(ang) * 0.262, axZ + Math.cos(ang) * 0.262], 0.0018, frameM, { seg: 4, cast: false });
    }
    k.torus(R - 0.045, 0.0085, frameM, wx + s * 0.034, axY, axZ, { ry: Math.PI / 2, seg: 16, cast: false });
    for (let i = 0; i < 4; i++) {
      const ang = spin + (i / 4) * Math.PI * 2 + 0.4;
      const py = axY + Math.sin(ang) * (R - 0.045);
      const pz = axZ + Math.cos(ang) * (R - 0.045);
      rod(k, [wx + s * 0.004, py, pz], [wx + s * 0.034, py, pz], 0.004, frameM, { seg: 5, cast: false });
    }
    rod(k, [x, axY, axZ], [wx, axY, axZ], 0.009, frameM, { cast: false });
    bev(k, 0.012, 0.09, 0.1, frameM, x + s * 0.012, axY + 0.02, axZ, 0.003, { cast: false });
    // brake lever, anti-tipper, front caster
    bar(k, [x + s * 0.03, 0.42, 0.02], [x + s * 0.042, 0.53, -0.03], 0.012, 0.012, frameM, { cast: false });
    k.sphere(0.012, blackM, x + s * 0.042, 0.535, -0.032, { seg: 8, cast: false });
    line(k, [[x, 0.25, -0.2], [x, 0.1, -0.41]], 0.008, frameM, { cast: false });
    k.cyl(0.025, 0.025, 0.018, rub, x, 0.075, -0.42, { axis: 'x', seg: 10, cast: false });
    caster(k, x, 0.28, 0.2, 0.095, frameM, rub, rr(k, -0.5, 0.5) + (k.rand() < 0.5 ? Math.PI : 0), { width: 0.03 });
  }
  // folding cross brace, seat and back slings
  rod(k, [-sx, 0.49, -0.02], [sx, 0.23, -0.02], 0.009, frameM, { cast: false });
  rod(k, [sx, 0.49, -0.02], [-sx, 0.23, -0.02], 0.009, frameM, { cast: false });
  bev(k, 0.46, 0.014, 0.42, vinyl, 0, 0.494, 0.02, 0.005);
  bev(k, 0.4, 0.01, 0.34, vinyl, 0, 0.484, 0.02, 0.004, { cast: false });
  bev(k, 0.46, 0.36, 0.014, vinyl, 0, 0.74, -0.237, 0.005, { rx: -0.104 });
};

// ---------------------------------------------------------------------------
// IV stand with a half-empty bag and an infusion pump
// ---------------------------------------------------------------------------

const ivStand: PropBuilder = (k) => {
  const chrome = mat.chrome(k);
  const hubM = mat.dark(k);
  const rub = hubM;
  const bagM = mat.clearPlastic(k);
  const fluid = k.phys('clin:ivfluid', { color: 0xcfe2e6, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
  const pumpM = mat.plastic(k, vary(k, 0xc9ccc8, 0.04), 0.45);

  starBase(k, { radius: 0.29, hubR: 0.035, hubY: 0.1, tipY: 0.08, legW: 0.022, legH: 0.022, casterR: 0.028, legMat: chrome, hubMat: hubM, casterMetal: chrome, wheelMat: rub, round: true });
  // pole: lower tube, locking collar, telescoping upper
  const yc = 1.32;
  const top = k.num('height', 2.02);
  k.cyl(0.0125, 0.0125, yc - 0.1, chrome, 0, (yc + 0.1) / 2, 0, { seg: 10 });
  k.cyl(0.0095, 0.0095, top - yc, chrome, 0, (top + yc) / 2, 0, { seg: 10 });
  k.cyl(0.02, 0.02, 0.035, hubM, 0, yc, 0, { seg: 12, cast: false });
  k.cyl(0.007, 0.007, 0.032, hubM, 0.028, yc, 0, { axis: 'x', seg: 8, cast: false });
  k.cyl(0.014, 0.012, 0.022, hubM, 0, top, 0, { seg: 10, cast: false });
  // four ram's-horn hooks
  const yaw0 = k.rand() * Math.PI;
  for (let i = 0; i < 4; i++) {
    const ang = yaw0 + (i * Math.PI) / 2;
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    line(k, [[0, top - 0.012, 0], [dx * 0.05, top - 0.03, dz * 0.05], [dx * 0.07, top - 0.026, dz * 0.07], [dx * 0.078, top - 0.006, dz * 0.078], [dx * 0.071, top + 0.012, dz * 0.071]], 0.0035, chrome, { cast: false });
  }
  // the bag on the first hook: clear sleeve, fluid in its lower half, printed label, drip chamber
  const dx = Math.sin(yaw0);
  const dz = Math.cos(yaw0);
  const hx = dx * 0.075;
  const hz = dz * 0.075;
  const by = top - 0.16;
  k.box(0.03, 0.03, 0.003, bagM, hx, top - 0.035, hz, { ry: yaw0, cast: false });
  bev(k, 0.032, 0.22, 0.13, bagM, hx, by, hz, 0.012, { ry: yaw0 + Math.PI / 2 });
  bev(k, 0.022, 0.1, 0.118, fluid, hx, by - 0.054, hz, 0.008, { ry: yaw0 + Math.PI / 2, cast: false });
  k.box(0.08, 0.06, 0.001, pumpM, hx + dx * 0.017, by + 0.03, hz + dz * 0.017, { ry: yaw0, cast: false });
  k.cyl(0.005, 0.005, 0.03, bagM, hx, by - 0.125, hz, { seg: 6, cast: false });
  k.cyl(0.011, 0.011, 0.06, bagM, hx, by - 0.17, hz, { seg: 10, cast: false });
  k.cyl(0.0095, 0.0095, 0.02, fluid, hx, by - 0.188, hz, { seg: 10, cast: false });
  // infusion pump clamped to the pole, line in at the top and out in a long loop
  const pumpY = 1.12;
  bev(k, 0.13, 0.2, 0.12, pumpM, 0, pumpY, 0.075, 0.015);
  bev(k, 0.05, 0.05, 0.05, hubM, 0, pumpY, 0.0, 0.006, { cast: false });
  k.cyl(0.006, 0.006, 0.05, chrome, 0, pumpY, -0.045, { axis: 'z', seg: 8, cast: false });
  k.box(0.08, 0.034, 0.002, k.glowMat(0x7fd0ff, 0.55), 0, pumpY + 0.05, 0.136, { cast: false });
  for (let i = 0; i < 6; i++) k.box(0.022, 0.012, 0.004, hubM, -0.03 + (i % 3) * 0.03, pumpY - 0.01 - Math.floor(i / 3) * 0.02, 0.136, { cast: false });
  k.box(0.02, 0.15, 0.06, hubM, 0.066, pumpY, 0.075, { cast: false });
  line(k, [[hx, by - 0.2, hz], [hx * 1.2, by - 0.42, hz * 1.2], [0.07, pumpY + 0.16, 0.08], [0.07, pumpY + 0.07, 0.08]], 0.0022, bagM, { cast: false });
  line(k, cablePts([0.07, pumpY - 0.08, 0.08], [0.32, 0.86, 0.26], 0.42, 6), 0.0022, bagM, { cast: false });
  k.box(0.014, 0.034, 0.014, hubM, 0.17, 0.565, 0.152, { cast: false });
};

export const BED_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  bed,
  stretcher,
  wheelchair,
  iv_stand: ivStand,
};

