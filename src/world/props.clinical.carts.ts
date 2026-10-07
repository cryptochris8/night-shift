/**
 * Wheeled service props: linen hamper / wire supply cart, janitor cart and mop bucket.
 * Carts are long along local z; the usable (shelf) side of the janitor cart faces -x.
 */
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { type V3, bev, caster, mat, pick, rod, rr, vary } from './props.clinical.common';

const rect = (x: number, y: number, z: number): V3[] => [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]];

// ---------------------------------------------------------------------------
// Linen hamper (canvas bin on a tube frame) / wire-shelf supply cart
// ---------------------------------------------------------------------------

function linenCart(k: PropKit): void {
  const frameM = mat.satin(k);
  const canvas = mat.fabric(k, pick(k, [0x5f6f7c, 0x6c7267, 0x56606e]), 0.95);
  const linen = mat.linen(k);
  const rub = mat.rubber(k);
  const W = 0.58;
  const L = 0.86;
  const H = 0.92;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(k, sx * (W / 2 - 0.04), sz * (L / 2 - 0.05), 0.135, 0.05, frameM, rub, rr(k, 0, Math.PI * 2));
  k.tube(rect(W / 2, 0.15, L / 2), 0.011, frameM, { closed: true });
  k.tube(rect(W / 2, H, L / 2), 0.012, frameM, { closed: true });
  for (const [x, , z] of rect(W / 2, 0, L / 2)) k.cyl(0.011, 0.011, H - 0.15, frameM, x, (H + 0.15) / 2, z, { seg: 8 });
  // canvas liner bulging between the posts, folded over the top rim
  k.rbox(W - 0.05, H - 0.2, L - 0.05, canvas, 0, (H + 0.16) / 2, 0, 0.06);
  k.rbox(W - 0.02, H - 0.42, L - 0.02, canvas, 0, (H + 0.16) / 2 - 0.02, 0, 0.1);
  for (const sz of [-1, 1]) k.box(W + 0.012, 0.07, 0.014, canvas, 0, H - 0.025, sz * (L / 2 + 0.002), { cast: false });
  for (const sx of [-1, 1]) k.box(0.014, 0.07, L + 0.012, canvas, sx * (W / 2 + 0.002), H - 0.025, 0, { cast: false });
  // used linen heaped in the mouth, a sheet trailing over one side
  for (let i = 0; i < 7; i++) {
    const m = k.sphere(rr(k, 0.09, 0.15), linen, rr(k, -0.16, 0.16), H - 0.01 + rr(k, 0, 0.05), rr(k, -0.3, 0.3), { seg: 10 });
    m.scale.set(rr(k, 1.1, 1.6), rr(k, 0.35, 0.6), rr(k, 0.9, 1.3));
    m.rotation.y = rr(k, 0, Math.PI);
  }
  const side = k.rand() < 0.5 ? -1 : 1;
  k.box(0.012, 0.32, 0.3, linen, side * (W / 2 + 0.02), H - 0.14, rr(k, -0.2, 0.2), { rz: side * 0.12, cast: false });
  // canvas cover thrown back over the -z end
  k.box(W + 0.03, 0.012, L * 0.42, canvas, 0, H + 0.035, -L * 0.29, { rx: 0.1 });
  k.box(W + 0.03, 0.3, 0.012, canvas, 0, H - 0.12, -L / 2 - 0.03, { rx: 0.06 });
}

function supplyCart(k: PropKit): void {
  const wire = mat.chrome(k);
  const rub = mat.rubber(k);
  const box = mat.cardboard(k);
  const white = mat.paper(k);
  const bin = mat.plastic(k, pick(k, [0x3b5f8a, 0x4d6a58]), 0.5);
  const W = 0.6;
  const L = 0.9;
  const px = W / 2 - 0.02;
  const pz = L / 2 - 0.02;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.cyl(0.0125, 0.0125, 1.36, wire, sx * px, 0.13 + 0.68, sz * pz, { seg: 8 });
      caster(k, sx * px, sz * pz, 0.13, 0.045, wire, rub, rr(k, 0, Math.PI * 2));
    }
  }
  const shelves = [0.26, 0.66, 1.06, 1.46];
  for (const y of shelves) {
    for (const sz of [-1, 1]) k.box(W, 0.025, 0.008, wire, 0, y, sz * (L / 2), { cast: false });
    for (const sx of [-1, 1]) k.box(0.008, 0.025, L, wire, sx * (W / 2), y, 0, { cast: false });
    for (let i = 1; i < 8; i++) k.box(0.004, 0.004, L - 0.02, wire, -W / 2 + (i * W) / 8, y - 0.008, 0, { cast: false });
    for (const sz of [-1, 1]) k.box(W, 0.01, 0.006, wire, 0, y - 0.012, sz * (L / 4), { cast: false });
  }
  // stock: cases on the bottom, bins and packs in the middle, odds and ends on top
  bev(k, 0.42, 0.26, 0.34, box, rr(k, -0.05, 0.05), 0.4, -0.2, 0.004, { ry: rr(k, -0.06, 0.06) });
  bev(k, 0.36, 0.2, 0.3, box, rr(k, -0.06, 0.06), 0.37, 0.24, 0.004, { ry: rr(k, -0.08, 0.08) });
  bev(k, 0.5, 0.16, 0.36, bin, 0, 0.75, -0.2, 0.012);
  for (let i = 0; i < 3; i++) bev(k, 0.12, 0.012, 0.2, mat.clearPlastic(k), -0.13 + i * 0.13, 0.84, -0.2, 0.004, { rx: rr(k, -0.3, 0.3), cast: false });
  for (let i = 0; i < 3; i++) bev(k, 0.25, 0.095, 0.13, white, -0.15 + (i % 2) * 0.3, 0.72 + Math.floor(i / 2) * 0.1, 0.25, 0.004, { ry: rr(k, -0.1, 0.1) });
  for (let i = 0; i < 4; i++) bev(k, 0.12, 0.08, 0.24, i % 2 ? white : box, -0.2 + i * 0.13, 1.115, rr(k, -0.15, 0.15), 0.003, { ry: rr(k, -0.15, 0.15) });
  bev(k, 0.3, 0.18, 0.22, box, 0.1, 1.56, -0.2, 0.004, { ry: rr(k, -0.15, 0.15) });
  k.cyl(0.05, 0.05, 0.025, white, -0.15, 1.485, 0.22, { seg: 12, cast: false });
}

const cart: PropBuilder = (k) => {
  if (k.str('kind', 'linen') === 'supply') supplyCart(k);
  else linenCart(k);
};

// ---------------------------------------------------------------------------
// Janitor cart
// ---------------------------------------------------------------------------

const cleaningCart: PropBuilder = (k) => {
  const body = mat.plastic(k, vary(k, 0x55595c, 0.05), 0.62);
  const yellow = mat.vinyl(k, 0xb3902c, 0.55);
  const black = mat.black(k);
  const metal = mat.satin(k);
  const rub = mat.rubber(k);
  const white = mat.plastic(k, 0xd3cfc3, 0.7);
  const blue = mat.plastic(k, 0x3a6ea5, 0.35);
  const green = mat.plastic(k, 0x5b8a4a, 0.35);

  // base deck, rear wheels, front casters
  k.rbox(0.55, 0.08, 1.1, body, 0, 0.17, 0, 0.025);
  for (const sx of [-1, 1]) {
    k.cyl(0.1, 0.1, 0.045, rub, sx * 0.3, 0.1, -0.4, { axis: 'x', seg: 14 });
    k.cyl(0.04, 0.04, 0.05, body, sx * 0.3, 0.1, -0.4, { axis: 'x', seg: 10, cast: false });
    caster(k, sx * 0.2, 0.44, 0.13, 0.045, metal, rub, rr(k, 0, Math.PI * 2));
  }
  // shelving body: closed +x side, open -x side
  const z0 = -0.12;
  const z1 = 0.2;
  const zc = (z0 + z1) / 2;
  const bl = z1 - z0;
  bev(k, 0.025, 0.72, bl, body, 0.262, 0.57, zc, 0.008);
  bev(k, 0.55, 0.72, 0.025, body, 0, 0.57, z0, 0.008);
  for (const y of [0.52, 0.92]) bev(k, 0.53, 0.025, bl, body, 0, y, zc, 0.006);
  bev(k, 0.022, 0.06, bl, body, -0.265, 0.95, zc, 0.006);
  bev(k, 0.022, 0.05, bl, body, -0.265, 0.56, zc, 0.006);
  bev(k, 0.55, 0.06, 0.022, body, 0, 0.95, z1, 0.006);
  // push handle arching over the bag end
  k.tube([[-0.25, 0.9, z0], [-0.25, 1.0, -0.45], [0.25, 1.0, -0.45], [0.25, 0.9, z0]], 0.014, metal);
  // yellow vinyl bag on its frame, black liner in the mouth
  k.tube([[-0.21, 0.8, z0 - 0.02], [-0.21, 0.8, -0.53], [0.21, 0.8, -0.53], [0.21, 0.8, z0 - 0.02]], 0.009, metal, { cast: false });
  k.rbox(0.42, 0.6, 0.38, yellow, 0, 0.5, -0.33, 0.08);
  k.box(0.38, 0.01, 0.32, black, 0, 0.787, -0.33, { cast: false });
  for (const sx of [-1, 1]) k.box(0.006, 0.06, 0.36, black, sx * 0.215, 0.775, -0.33, { cast: false });
  // round grey bin on the front deck with a liner folded over its rim
  k.lathe([[0, 0], [0.15, 0], [0.165, 0.02], [0.18, 0.5], [0.19, 0.54], [0.175, 0.54], [0.165, 0.06], [0, 0.06]], body, 0, 0.21, 0.39, { seg: 16 });
  k.torus(0.185, 0.012, black, 0, 0.745, 0.39, { rx: Math.PI / 2, seg: 20, cast: false });
  k.cyl(0.172, 0.172, 0.005, black, 0, 0.72, 0.39, { seg: 16, cast: false });
  // spray bottles on the top tray
  const bottle = (x: number, z: number, m: typeof blue, ry: number): void => {
    k.lathe([[0, 0], [0.034, 0], [0.036, 0.015], [0.036, 0.14], [0.026, 0.17], [0.014, 0.185], [0, 0.185]], m, x, 0.932, z, { seg: 12 });
    bev(k, 0.026, 0.05, 0.06, white, x, 1.14, z + Math.cos(ry) * 0.012, 0.006, { ry, cast: false });
    bev(k, 0.012, 0.045, 0.014, white, x, 1.1, z + Math.cos(ry) * 0.03, 0.003, { ry, rx: 0.3, cast: false });
  };
  bottle(-0.15, -0.04, blue, rr(k, -0.4, 0.4));
  bottle(-0.05, 0.08, green, rr(k, -0.4, 0.4) + Math.PI);
  bottle(0.1, -0.05, blue, rr(k, -0.4, 0.4));
  bev(k, 0.16, 0.1, 0.12, white, 0.12, 0.985, 0.1, 0.006, { ry: rr(k, -0.2, 0.2) });
  // supplies on the open shelves
  for (let i = 0; i < 4; i++) k.cyl(0.055, 0.055, 0.1, white, -0.12 + (i % 2) * 0.12, 0.585 + Math.floor(i / 2) * 0.1, -0.02 + (i % 2) * 0.1, { seg: 12, cast: false });
  bev(k, 0.24, 0.12, 0.2, mat.cardboard(k), 0.08, 0.27, 0.05, 0.004);
  bev(k, 0.2, 0.09, 0.12, blue, 0.1, 0.58, 0.06, 0.006);
  // wet mop parked head-down in its clip on the closed side, handle leaning
  const mx = 0.36;
  const mz = 0.06;
  k.cyl(0.075, 0.1, 0.24, white, mx, 0.125, mz, { seg: 10 });
  k.cyl(0.03, 0.03, 0.05, black, mx, 0.27, mz, { seg: 10, cast: false });
  rod(k, [mx, 0.27, mz], [mx - 0.04, 1.42, mz - 0.1], 0.012, metal);
  bev(k, 0.05, 0.05, 0.06, black, 0.295, 0.82, mz - 0.07, 0.006, { cast: false });
};

// ---------------------------------------------------------------------------
// Mop bucket with side-press wringer
// ---------------------------------------------------------------------------

const mopBucket: PropBuilder = (k) => {
  const yellow = mat.plastic(k, vary(k, 0xb3902c, 0.05), 0.5);
  const grey = mat.plastic(k, 0x494d51, 0.6);
  const metal = mat.satin(k);
  const water = k.std(0x29271f, 0.08, 0.1);
  const mop = mat.plastic(k, 0xb3ae9f, 0.95);
  const rub = mat.rubber(k);
  // open tub: floor, four walls, rolled lip; murky water inside
  bev(k, 0.36, 0.03, 0.46, yellow, 0, 0.095, 0, 0.01);
  for (const sx of [-1, 1]) bev(k, 0.022, 0.3, 0.48, yellow, sx * 0.18, 0.23, 0, 0.008);
  for (const sz of [-1, 1]) bev(k, 0.38, 0.3, 0.022, yellow, 0, 0.23, sz * 0.235, 0.008);
  for (const sx of [-1, 1]) k.box(0.03, 0.022, 0.5, yellow, sx * 0.19, 0.384, 0, { cast: false });
  for (const sz of [-1, 1]) k.box(0.4, 0.022, 0.03, yellow, 0, 0.384, sz * 0.245, { cast: false });
  k.box(0.34, 0.002, 0.45, water, 0, 0.29, 0, { cast: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(k, sx * 0.14, sz * 0.19, 0.08, 0.03, metal, rub, rr(k, 0, Math.PI * 2));
  // side-press wringer straddling the -z half, lever up
  bev(k, 0.32, 0.22, 0.2, grey, 0, 0.5, -0.12, 0.02);
  bev(k, 0.26, 0.04, 0.16, grey, 0, 0.63, -0.12, 0.01);
  k.tube([[-0.165, 0.58, -0.04], [-0.165, 0.94, -0.26], [0.165, 0.94, -0.26], [0.165, 0.58, -0.04]], 0.012, grey);
  k.cyl(0.018, 0.018, 0.22, rub, 0, 0.94, -0.26, { axis: 'x', seg: 10, cast: false });
  // mop soaking in the front half, strands over the rim, handle against the lever
  k.cyl(0.08, 0.11, 0.12, mop, 0.02, 0.32, 0.11, { seg: 10 });
  for (let i = 0; i < 4; i++) k.box(0.014, 0.16, 0.012, mop, -0.08 + i * 0.05, 0.33, 0.248, { rx: rr(k, -0.15, 0.15), cast: false });
  k.cyl(0.026, 0.026, 0.06, grey, 0.02, 0.4, 0.1, { seg: 10, cast: false });
  rod(k, [0.02, 0.4, 0.1], [-0.06, 1.48, -0.2], 0.012, metal);
};

export const CART_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  cart,
  cleaning_cart: cleaningCart,
  mop_bucket: mopBucket,
};
