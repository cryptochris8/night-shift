/**
 * Surface builders for the texture factory: architectural finishes (floors, walls,
 * ceilings), door faces, soft goods, the night sky and floor decals. Every builder
 * returns a finished HTMLCanvasElement; textures.ts wraps and caches them.
 *
 * Scale conventions (metres covered by one repeat) are published in textures.ts.
 */
import type { RNG } from '../core/rng';
import {
  type Canvas2D,
  FONT_COND,
  bevel,
  blob,
  blobPath2D,
  brushedFill,
  clamp,
  clamp01,
  crack,
  css,
  fbm,
  fillPixels,
  fitFontSize,
  font,
  grain,
  hash2,
  makeCanvas,
  measureSpaced,
  mix,
  modifyPixels,
  mottle,
  mul,
  rgb,
  rngFor,
  rrect,
  screwHead,
  shade,
  smoothstep,
  spacedText,
  streak,
  vband,
  vnoise,
  wrapped,
} from './textures.util';

const S = 512;
/** Metres covered vertically by one wall repeat (floor → ceiling). */
export const WALL_H = 2.8;

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

/** Speckled vinyl composition tile. One repeat = 4 tiles (1.2 m at the default 30 cm tile). */
export function buildVinyl(o: { tint: number; tile: number; wear: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('vinyl', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  const per = clamp(Math.round(1.2 / Math.max(0.1, o.tile)), 1, 12);
  const tilePx = S / per;
  const light = shade(base, 0.38);
  const dark = shade(base, -0.32);
  const accent = mix(base, rgb(0x8c7f68), 0.55);
  const wear = clamp01(o.wear);

  fillPixels(c, (x, y, out) => {
    const tx = Math.floor(x / tilePx);
    const ty = Math.floor(y / tilePx);
    const tv = (hash2(tx, ty, sn) - 0.5) * 0.07;
    const m = (fbm(x / S, y / S, 5, 5, 3, sn + 7) - 0.5) * 0.14;
    const h = hash2(x >> 1, y >> 1, sn + 11);
    let col = base;
    if (h > 0.905) col = light;
    else if (h > 0.845) col = dark;
    else if (h > 0.82) col = accent;
    // break the 2 px chip cells into irregular flecks
    if (col !== base && hash2(x, y, sn + 13) > 0.78) col = base;
    const l = 1 + tv + m + (hash2(x, y, sn + 17) - 0.5) * 0.05;
    out[0] = col.r * l;
    out[1] = col.g * l;
    out[2] = col.b * l;
  });

  // tile seams
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < per; i++) {
    const p = Math.round(i * tilePx) + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, S);
    ctx.moveTo(0, p);
    ctx.lineTo(S, p);
  }
  ctx.stroke();
  // grime collected in the seams
  const dashes = Math.round(wear * 70);
  ctx.strokeStyle = '#1b1916';
  for (let i = 0; i < dashes; i++) {
    const along = rng.next() * S;
    const seam = Math.round(rng.int(0, per - 1) * tilePx) + 0.5;
    const len = rng.range(6, 44);
    ctx.globalAlpha = rng.range(0.06, 0.28);
    ctx.lineWidth = rng.chance(0.3) ? 2 : 1;
    ctx.beginPath();
    if (rng.chance(0.5)) {
      ctx.moveTo(seam, along);
      ctx.lineTo(seam, along + len);
    } else {
      ctx.moveTo(along, seam);
      ctx.lineTo(along + len, seam);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // scuffs, heel marks, mop streaks, dirt
  const scuffs = Math.round(8 + wear * 36);
  for (let i = 0; i < scuffs; i++) {
    streak(c, rng, {
      x: rng.next() * S,
      y: rng.next() * S,
      len: rng.range(18, 130),
      angle: rng.range(0, Math.PI * 2),
      width: rng.range(1, 3.2),
      color: rng.chance(0.75) ? '#2b2a28' : '#55524c',
      alpha: rng.range(0.05, 0.22),
      curve: 0.6,
    });
  }
  const heels = Math.round(wear * 14);
  for (let i = 0; i < heels; i++) {
    streak(c, rng, { x: rng.next() * S, y: rng.next() * S, len: rng.range(6, 22), angle: rng.range(0, Math.PI * 2), width: rng.range(2.5, 5), color: '#0e0e0f', alpha: rng.range(0.18, 0.4), curve: 1.2 });
  }
  const mopDir = rng.range(-0.25, 0.25);
  for (let i = 0; i < 14; i++) {
    streak(c, rng, { x: rng.next() * S, y: rng.next() * S, len: rng.range(120, 360), angle: mopDir + rng.range(-0.08, 0.08), width: rng.range(6, 18), color: '#ffffff', alpha: rng.range(0.015, 0.045), curve: 0.15 });
  }
  const dots = Math.round(60 + wear * 260);
  ctx.fillStyle = '#17150f';
  for (let i = 0; i < dots; i++) {
    ctx.globalAlpha = rng.range(0.1, 0.35);
    ctx.fillRect(Math.floor(rng.next() * S), Math.floor(rng.next() * S), 1, rng.chance(0.2) ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  mottle(c, { seed: sn + 23, fx: 3, strength: 0.09 + wear * 0.08, blend: 'multiply', res: 64 });
  grain(c, 0.02, sn + 29);
  return c.canvas;
}

/** Glazed 10 cm ceramic floor tile; one repeat = 1 m. grout = joint width as a fraction of a tile. */
export function buildCeramic(o: { tint: number; grout: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('ceramic', o.seed);
  const sn = rng.int(1, 1e9);
  const n = 10;
  const t = S / n;
  const gw = clamp(o.grout, 0.02, 0.2) * t;
  const groutCol = rgb(0x8d8980);
  const tile = rgb(o.tint);
  fillPixels(c, (x, y, out) => {
    const l = 1 + (hash2(x, y, sn) - 0.5) * 0.2 + (fbm(x / S, y / S, 6, 6, 2, sn + 3) - 0.5) * 0.25;
    out[0] = groutCol.r * l;
    out[1] = groutCol.g * l;
    out[2] = groutCol.b * l;
  });
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i * t + gw / 2;
      const y0 = j * t + gw / 2;
      const w = t - gw;
      const tv = 1 + (hash2(i, j, sn + 5) - 0.5) * 0.09;
      const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + w);
      g.addColorStop(0, css(mul(tile, tv * 1.07)));
      g.addColorStop(0.55, css(mul(tile, tv)));
      g.addColorStop(1, css(mul(tile, tv * 0.95)));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, w);
      bevel(ctx, x0, y0, w, w, 1, 0.22, 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x0 + w * 0.14, y0 + 2, w * 0.1, w - 4);
      if (hash2(i, j, sn + 9) > 0.965) {
        const cx = hash2(i, j, sn + 1) > 0.5 ? x0 : x0 + w;
        const cy = hash2(i, j, sn + 2) > 0.5 ? y0 : y0 + w;
        ctx.fillStyle = css(mul(tile, 0.72));
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (cx === x0 ? 7 : -7), cy);
        ctx.lineTo(cx, cy + (cy === y0 ? 9 : -9));
        ctx.closePath();
        ctx.fill();
      }
      if (hash2(i, j, sn + 10) > 0.975) crack(ctx, rng, x0 + w * 0.2, y0 + w * 0.1, w * 0.9, Math.PI / 2 + rng.range(-0.5, 0.5), '#2a2825', 0.55, 1);
    }
  }
  mottle(c, { seed: sn + 20, fx: 3, strength: 0.16, blend: 'multiply', res: 64 });
  ctx.strokeStyle = '#2d2a25';
  for (let i = 0; i < 40; i++) {
    const p = rng.int(0, n - 1) * t;
    const along = rng.next() * S;
    const len = rng.range(10, 70);
    ctx.globalAlpha = rng.range(0.08, 0.25);
    ctx.lineWidth = gw * 0.8;
    ctx.beginPath();
    if (rng.chance(0.5)) {
      ctx.moveTo(p, along);
      ctx.lineTo(p, along + len);
    } else {
      ctx.moveTo(along, p);
      ctx.lineTo(along + len, p);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  mottle(c, { seed: sn + 30, fx: 2, strength: 0.5, color: rgb(0x3b4a3c), alpha: 0.14, blend: 'multiply', res: 48 });
  for (let i = 0; i < 24; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(2, 6), rgb(0xffffff), rng.range(0.05, 0.14), { hard: 0.2 });
  grain(c, 0.028, sn + 40);
  return c.canvas;
}

/** Sealed concrete slab with control joints on the repeat edges; one repeat = 2 m. */
export function buildConcrete(o: { tint: number; stains: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('concrete', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  const stains = clamp01(o.stains);
  fillPixels(c, (x, y, out) => {
    const u = x / S;
    const v = y / S;
    const big = (fbm(u, v, 2, 2, 4, sn) - 0.5) * 0.22;
    const med = (fbm(u, v, 9, 9, 3, sn + 5) - 0.5) * 0.1;
    const h = hash2(x, y, sn + 9);
    let l = 1 + big + med + (h - 0.5) * 0.06;
    if (h > 0.986) l -= 0.18;
    else if (h < 0.006) l += 0.14;
    out[0] = base.r * l;
    out[1] = base.g * l;
    out[2] = base.b * l;
  });
  // trowel sweeps
  for (let i = 0; i < 9; i++) {
    const r = rng.range(140, 420);
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const a0 = rng.range(0, Math.PI * 2);
    const a1 = a0 + rng.range(0.5, 1.6);
    const lw = rng.range(8, 22);
    wrapped(c, cx, cy, r + lw, () => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.strokeStyle = 'rgba(255,255,255,0.045)';
      ctx.lineWidth = lw;
      ctx.stroke();
    });
  }
  const cracks = 2 + Math.round(stains * 3);
  for (let i = 0; i < cracks; i++) crack(ctx, rng, rng.range(40, S - 40), rng.range(40, S - 40), rng.range(60, 220), rng.range(0, Math.PI * 2), '#2a2a27', 0.5, 1);
  const ns = Math.round(stains * 7);
  for (let i = 0; i < ns; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(25, 110);
    const col = rng.chance(0.6) ? rgb(0x3a3025) : rgb(0x24262a);
    const parts = rng.int(2, 5);
    for (let k = 0; k < parts; k++) {
      blob(c, x + rng.range(-r * 0.5, r * 0.5), y + rng.range(-r * 0.5, r * 0.5), r * rng.range(0.5, 1), col, rng.range(0.08, 0.26), { blend: 'multiply', squash: rng.range(0.6, 1), rot: rng.range(0, Math.PI), hard: 0.15 });
    }
  }
  for (let i = 0; i < Math.round(stains * 10); i++) blob(c, rng.next() * S, rng.next() * S, rng.range(3, 9), rgb(0x15161a), rng.range(0.2, 0.5), { blend: 'multiply', hard: 0.5 });
  if (stains > 0.45) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(40, 70);
    wrapped(c, x, y, r + 6, () => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,70,30,0.35)';
      ctx.lineWidth = 4;
      ctx.stroke();
    });
  }
  // saw-cut control joints along the repeat edges (one every 2 m)
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.fillRect(0, 0, S, 3);
  ctx.fillRect(0, 0, 3, S);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, 3, S, 1);
  ctx.fillRect(3, 0, 1, S);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(0, S - 1, S, 1);
  ctx.fillRect(S - 1, 0, 1, S);
  mottle(c, { seed: sn + 31, fx: 4, strength: 0.08, blend: 'multiply', res: 64 });
  grain(c, 0.02, sn + 37);
  return c.canvas;
}

/** Aggregate asphalt, optionally rain-wet; one repeat = 3 m. */
export function buildAsphalt(o: { wet: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('asphalt', o.seed);
  const sn = rng.int(1, 1e9);
  const wet = clamp01(o.wet);
  const base = mix(rgb(0x34363a), rgb(0x1b1d21), wet);
  fillPixels(c, (x, y, out) => {
    const u = x / S;
    const v = y / S;
    const patch = (fbm(u, v, 2, 2, 3, sn) - 0.5) * 0.2;
    const h = hash2(x >> 1, y >> 1, sn + 3);
    const hp = hash2(x, y, sn + 4);
    let l = 1 + patch + (hp - 0.5) * 0.1;
    if (h > 0.72) l += (h - 0.72) * (1.2 - wet * 0.5) * (hp > 0.35 ? 1 : 0.3);
    if (hp > 0.992) l += 0.5;
    out[0] = base.r * l;
    out[1] = base.g * l;
    out[2] = base.b * l;
  });
  // sky reflection pooling in the low spots
  if (wet > 0.05) mottle(c, { seed: sn + 11, fx: 3, strength: 0.7, color: rgb(0x55636f), alpha: 0.28 * wet, blend: 'screen', res: 64, bias: -0.1 });
  const cracks = rng.int(3, 6);
  for (let i = 0; i < cracks; i++) crack(ctx, rng, rng.range(30, S - 30), rng.range(30, S - 30), rng.range(80, 260), rng.range(0, Math.PI * 2), '#07080a', 0.75, rng.range(1, 2.2));
  for (let i = 0; i < 2; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(50, 110), rgb(0x0c0d10), 0.22, { blend: 'multiply', squash: rng.range(0.5, 0.9), rot: rng.range(0, Math.PI), hard: 0.6 });
  for (let i = 0; i < 6; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(8, 20), rgb(0x0a0a0c), rng.range(0.2, 0.45), { blend: 'multiply', hard: 0.4 });
  ctx.fillStyle = '#9aa0a6';
  for (let i = 0; i < 160; i++) {
    ctx.globalAlpha = rng.range(0.1, 0.3);
    ctx.fillRect(Math.floor(rng.next() * S), Math.floor(rng.next() * S), 1, 1);
  }
  ctx.globalAlpha = 1;
  grain(c, 0.03, sn + 21);
  return c.canvas;
}

/** Heathered commercial carpet tile (50 cm, quarter-turned); one repeat = 1 m. */
export function buildCarpet(o: { tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('carpet', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  const light = shade(base, 0.16);
  const dark = shade(base, -0.14);
  const half = S / 2;
  fillPixels(c, (x, y, out) => {
    const tx = x >= half ? 1 : 0;
    const ty = y >= half ? 1 : 0;
    const turned = (tx + ty) % 2 === 1;
    const a = turned ? y : x;
    const b = turned ? x : y;
    const fib = hash2(a >> 1, b, sn) * 0.6 + hash2(a, b >> 2, sn + 1) * 0.4;
    const heather = hash2(x, y, sn + 2);
    let col = fib > 0.62 ? light : fib < 0.3 ? dark : base;
    if (heather > 0.93) col = light;
    else if (heather < 0.05) col = dark;
    const tone = 1 + (((tx + ty * 2) % 3) - 1) * 0.015 + (fbm(x / S, y / S, 3, 3, 2, sn + 4) - 0.5) * 0.06;
    out[0] = col.r * tone;
    out[1] = col.g * tone;
    out[2] = col.b * tone;
  });
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(half, 0, 1, S);
  ctx.fillRect(0, half, S, 1);
  ctx.fillRect(0, 0, 1, S);
  ctx.fillRect(0, 0, S, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(half + 1, 0, 1, S);
  ctx.fillRect(0, half + 1, S, 1);
  // coffee ring
  {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(16, 26);
    const a0 = rng.range(0, Math.PI * 2);
    const a1 = a0 + rng.range(2.5, 5.5);
    wrapped(c, x, y, r + 4, () => {
      ctx.beginPath();
      ctx.arc(x, y, r, a0, a1);
      ctx.strokeStyle = 'rgba(70,46,28,0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();
    });
    blob(c, x, y, r * 0.9, rgb(0x4a3222), 0.12, { blend: 'multiply', hard: 0.2 });
  }
  for (let i = 0; i < 3; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(20, 50), rgb(0x2a2520), rng.range(0.08, 0.18), { blend: 'multiply', squash: rng.range(0.6, 1), rot: rng.range(0, 3), hard: 0.2 });
  ctx.fillStyle = '#e8e4da';
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = rng.range(0.15, 0.4);
    ctx.fillRect(Math.floor(rng.next() * S), Math.floor(rng.next() * S), rng.chance(0.3) ? 2 : 1, 1);
  }
  ctx.globalAlpha = 1;
  grain(c, 0.03, sn + 9);
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Walls (one repeat = 2.8 m × 2.8 m; canvas bottom = floor)
// ---------------------------------------------------------------------------

export function buildPaintedWall(o: { tint: number; railHeight: number; grime: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('wall', o.seed);
  const sn = rng.int(1, 1e9);
  const ppm = S / WALL_H;
  const Y = (m: number): number => S - m * ppm;
  const grime = clamp01(o.grime);
  const upper = rgb(o.tint);
  const lower = mix(mul(upper, 0.86), rgb(0x8a8272), 0.22);
  const rail = mix(mul(upper, 0.62), rgb(0x6a7270), 0.4);
  const railH = clamp(o.railHeight, 0.5, 1.4);
  const railT = 0.14;
  const splitY = Y(railH + railT / 2 + 0.02);

  // two-tone eggshell paint with roller stipple
  fillPixels(c, (x, y, out) => {
    const base = y >= splitY ? lower : upper;
    const st = (hash2(x >> 1, y >> 1, sn) - 0.5) * 0.045 + (hash2(x, y, sn + 1) - 0.5) * 0.02;
    const sheen = (fbm(x / S, y / S, 4, 4, 3, sn + 2) - 0.5) * 0.07;
    const l = 1 + st + sheen;
    out[0] = base.r * l;
    out[1] = base.g * l;
    out[2] = base.b * l;
  });
  vband(ctx, 0, S, 0, 0.14 * ppm, rgb(0x6a665e), 0.12 + grime * 0.12, 0);
  vband(ctx, 0, S, Y(0.1), Y(0.5), rgb(0x4a4640), 0.16 + grime * 0.22, 0);
  for (let i = 0; i < 5; i++) {
    const x = rng.next() * S;
    vband(ctx, x, rng.range(2, 6), 0, rng.range(40, 160), rgb(0x55524c), 0.06 + grime * 0.06, 0);
  }
  if (grime > 0.55) {
    const x = rng.next() * S;
    vband(ctx, x - 8, 16, 0, rng.range(120, 260), rgb(0x8a6a3a), 0.16, 0);
    vband(ctx, x - 3, 6, 0, rng.range(200, 320), rgb(0x7a5a30), 0.12, 0);
  }

  // vinyl crash rail / handrail
  {
    const top = Y(railH + railT / 2);
    const h = railT * ppm;
    vband(ctx, 0, S, top + h, top + h + 9, rgb(0x000000), 0.28, 0);
    vband(ctx, 0, S, top - 10, top, rgb(0x3a3630), 0, 0.08 + grime * 0.1);
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, css(shade(rail, 0.3)));
    g.addColorStop(0.18, css(shade(rail, 0.12)));
    g.addColorStop(0.55, css(rail));
    g.addColorStop(1, css(mul(rail, 0.62)));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, S, h);
    for (const bx of [0.35 * ppm, (0.35 + 1.4) * ppm]) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(bx - 3, top + 2, 6, h - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx - 1, top + 2, 1, h - 4);
    }
    const n = Math.round(4 + grime * 8);
    for (let i = 0; i < n; i++) {
      streak(c, rng, { x: rng.next() * S, y: top + rng.range(2, h - 2), len: rng.range(10, 60), angle: rng.range(-0.1, 0.1), width: rng.range(1, 3), color: rng.chance(0.5) ? '#1c1b1a' : '#d8d6cf', alpha: rng.range(0.1, 0.35), curve: 0.2 });
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(0, top, S, 1);
  }

  // rubber base cove
  {
    const top = Y(0.1);
    const g = ctx.createLinearGradient(0, top, 0, S);
    g.addColorStop(0, '#4a4845');
    g.addColorStop(0.3, '#3a3836');
    g.addColorStop(1, '#2c2a28');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, S, S - top);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, top, S, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, top - 2, S, 2);
  }

  // low scuffs from carts, wheelchairs and shoes
  const scuffs = Math.round(6 + grime * 26);
  for (let i = 0; i < scuffs; i++) {
    streak(c, rng, {
      x: rng.next() * S,
      y: Y(rng.range(0.12, 0.7)),
      len: rng.range(16, 140),
      angle: rng.range(-0.25, 0.25) + (rng.chance(0.5) ? 0 : Math.PI),
      width: rng.range(1, 4),
      color: rng.chance(0.7) ? '#232120' : '#6e6a62',
      alpha: rng.range(0.06, 0.3),
      curve: 0.5,
    });
  }
  for (let i = 0; i < Math.round(grime * 6); i++) {
    streak(c, rng, { x: rng.next() * S, y: Y(rng.range(0.12, 0.45)), len: rng.range(5, 16), angle: rng.range(0, 6.3), width: rng.range(3, 6), color: '#0d0d0e', alpha: rng.range(0.2, 0.42), curve: 1.4 });
  }
  // patches, nail holes, a hairline crack from the ceiling
  for (let i = 0; i < 2; i++) {
    const x = rng.next() * S;
    const y = rng.range(S * 0.1, S * 0.6);
    const w = rng.range(20, 60);
    const h = rng.range(20, 50);
    const col = css(shade(upper, 0.08), 0.5);
    wrapped(c, x, y, Math.max(w, h), () => {
      ctx.fillStyle = col;
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    });
  }
  for (let i = 0; i < 3; i++) {
    const x = rng.next() * S;
    const y = rng.range(S * 0.15, S * 0.65);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x - 1, y - 1, 4, 1);
  }
  crack(ctx, rng, rng.range(20, S - 20), 0, rng.range(30, 90), Math.PI / 2 + rng.range(-0.3, 0.3), '#2a2826', 0.35, 1);
  mottle(c, { seed: sn + 9, fx: 3, strength: 0.06 + grime * 0.06, blend: 'multiply', res: 64 });
  grain(c, 0.014, sn + 13);
  return c.canvas;
}

/** Restroom wall: 20 cm glazed tile to 2.2 m with an accent course, painted above. */
export function buildTileWall(o: { tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('tilewall', o.seed);
  const sn = rng.int(1, 1e9);
  const ppm = S / WALL_H;
  const Y = (m: number): number => S - m * ppm;
  const tile = rgb(o.tint);
  const accent = mix(rgb(0x5f7f7c), tile, 0.25);
  const groutCol = rgb(0xb3afa6);
  const tileM = 0.2;
  const tilePx = tileM * ppm;
  const cols = Math.round(WALL_H / tileM);
  const tileTop = 2.2;
  const rows = Math.round(tileTop / tileM);
  const gw = 3;
  const paint = shade(tile, 0.12);
  fillPixels(c, (x, y, out) => {
    const st = (hash2(x >> 1, y >> 1, sn) - 0.5) * 0.04 + (fbm(x / S, y / S, 4, 4, 2, sn + 1) - 0.5) * 0.06;
    const l = 1 + st;
    out[0] = paint.r * l;
    out[1] = paint.g * l;
    out[2] = paint.b * l;
  });
  vband(ctx, 0, S, 0, 0.12 * ppm, rgb(0x6a665e), 0.14, 0);
  const fieldTop = Y(tileTop + 0.06);
  ctx.fillStyle = css(groutCol);
  ctx.fillRect(0, fieldTop, S, S - fieldTop);
  modifyPixels(c, 0, fieldTop, S, S - fieldTop, (px, py, d, i) => {
    const l = 1 + (hash2(px, py, sn + 3) - 0.5) * 0.2;
    d[i] *= l;
    d[i + 1] *= l;
    d[i + 2] *= l;
  });
  // bullnose cap course
  {
    const top = Y(tileTop + 0.06);
    const h = 0.06 * ppm;
    const g = ctx.createLinearGradient(0, top, 0, top + h);
    g.addColorStop(0, css(shade(tile, 0.25)));
    g.addColorStop(0.5, css(tile));
    g.addColorStop(1, css(mul(tile, 0.75)));
    ctx.fillStyle = g;
    ctx.fillRect(0, top, S, h);
    vband(ctx, 0, S, top - 8, top, rgb(0x000000), 0, 0.25);
  }
  for (let r = 0; r < rows; r++) {
    const y1 = Y(r * tileM);
    const y0 = Y((r + 1) * tileM);
    const isAccent = r === 6;
    for (let ci = 0; ci < cols; ci++) {
      const x0 = ci * tilePx + gw / 2;
      const w = tilePx - gw;
      const yy = y0 + gw / 2;
      const h = y1 - y0 - gw;
      const base = isAccent ? accent : tile;
      const tv = 1 + (hash2(ci, r, sn + 5) - 0.5) * 0.07;
      const g = ctx.createLinearGradient(x0, yy, x0 + w, yy + h);
      g.addColorStop(0, css(mul(base, tv * 1.08)));
      g.addColorStop(0.5, css(mul(base, tv)));
      g.addColorStop(1, css(mul(base, tv * 0.94)));
      ctx.fillStyle = g;
      ctx.fillRect(x0, yy, w, h);
      bevel(ctx, x0, yy, w, h, 1, 0.25, 0.22);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.fillRect(x0 + w * 0.12, yy + 2, w * 0.08, h - 4);
      if (hash2(ci, r, sn + 8) > 0.985) {
        ctx.fillStyle = css(mul(base, 0.7));
        ctx.beginPath();
        ctx.moveTo(x0 + w, yy + h);
        ctx.lineTo(x0 + w - 8, yy + h);
        ctx.lineTo(x0 + w, yy + h - 10);
        ctx.fill();
      }
    }
  }
  vband(ctx, 0, S, Y(0.45), S, rgb(0x3a3630), 0, 0.3);
  ctx.strokeStyle = '#3a352e';
  for (let i = 0; i < 30; i++) {
    const col = rng.int(0, cols - 1);
    const row = rng.int(0, rows - 1);
    const x = col * tilePx;
    const y = Y(row * tileM);
    ctx.globalAlpha = rng.range(0.08, 0.22);
    ctx.lineWidth = gw;
    ctx.beginPath();
    if (rng.chance(0.5)) {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - rng.range(10, tilePx));
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + rng.range(10, tilePx), y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  crack(ctx, rng, rng.range(40, S - 40), Y(rng.range(0.9, 1.6)), rng.range(30, 70), Math.PI / 2 + rng.range(-0.6, 0.6), '#2a2825', 0.45, 1);
  for (let i = 0; i < 30; i++) blob(c, rng.next() * S, Y(rng.range(0.8, 1.5)), rng.range(2, 5), rgb(0xffffff), rng.range(0.05, 0.12), { hard: 0.3 });
  mottle(c, { seed: sn + 11, fx: 3, strength: 0.1, blend: 'multiply', res: 64 });
  grain(c, 0.016, sn + 15);
  return c.canvas;
}

/** Painted CMU block (40 × 20 cm, running bond), darker lower band, service-area grime. */
export function buildBlockWall(o: { tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('block', o.seed);
  const sn = rng.int(1, 1e9);
  const ppm = S / WALL_H;
  const Y = (m: number): number => S - m * ppm;
  const upper = rgb(o.tint);
  const lower = mix(mul(upper, 0.7), rgb(0x4e5560), 0.3);
  const bw = 0.4;
  const bh = 0.2;
  const cols = Math.round(WALL_H / bw);
  const rows = Math.round(WALL_H / bh);
  const splitRow = 6;
  const joint = 3;
  const mortar = rgb(0x7c7a74);
  fillPixels(c, (x, y, out) => {
    const l = 1 + (hash2(x, y, sn) - 0.5) * 0.16;
    out[0] = mortar.r * l;
    out[1] = mortar.g * l;
    out[2] = mortar.b * l;
  });
  const bwPx = bw * ppm;
  for (let r = 0; r < rows; r++) {
    const y1 = Y(r * bh);
    const y0 = Y((r + 1) * bh);
    const offset = r % 2 ? bwPx / 2 : 0;
    const base = r < splitRow ? lower : upper;
    for (let ci = -1; ci <= cols; ci++) {
      const x0 = ci * bwPx + offset + joint / 2;
      const w = bwPx - joint;
      const yy = y0 + joint / 2;
      const h = y1 - y0 - joint;
      if (x0 + w < 0 || x0 > S) continue;
      const key = (ci + cols) % cols;
      const tv = 1 + (hash2(key, r, sn + 5) - 0.5) * 0.08;
      ctx.fillStyle = css(mul(base, tv));
      ctx.fillRect(x0, yy, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x0, yy, w, 1);
      ctx.fillRect(x0, yy, 1, h);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x0, yy + h - 1, w, 1);
      ctx.fillRect(x0 + w - 1, yy, 1, h);
    }
  }
  modifyPixels(c, 0, 0, S, S, (px, py, d, i) => {
    const h = hash2(px, py, sn + 7);
    let l = 1 + (h - 0.5) * 0.09 + (hash2(px >> 1, py >> 1, sn + 8) - 0.5) * 0.05;
    if (h > 0.975) l -= 0.22;
    d[i] *= l;
    d[i + 1] *= l;
    d[i + 2] *= l;
  });
  mottle(c, { seed: sn + 9, fx: 3, strength: 0.09, blend: 'overlay', res: 64 });
  vband(ctx, 0, S, Y(0.05), Y(0.6), rgb(0x3a3834), 0.3, 0);
  vband(ctx, 0, S, 0, 0.1 * ppm, rgb(0x55524c), 0.12, 0);
  for (let i = 0; i < 4; i++) blob(c, rng.next() * S, Y(rng.range(0.05, 0.4)), rng.range(20, 60), rgb(0xe8e6df), rng.range(0.08, 0.16), { squash: 0.5, hard: 0.2 });
  for (let i = 0; i < 2; i++) {
    const x = rng.next() * S;
    const y = Y(rng.range(1.6, 2.6));
    ctx.fillStyle = 'rgba(40,40,44,0.6)';
    ctx.fillRect(x - 2, y - 2, 4, 4);
    vband(ctx, x - 2, 4, y, y + rng.range(40, 140), rgb(0x8a4e22), 0.35, 0);
  }
  for (let i = 0; i < 12; i++) {
    streak(c, rng, { x: rng.next() * S, y: Y(rng.range(0.1, 1.1)), len: rng.range(10, 90), angle: rng.range(-0.2, 0.2), width: rng.range(1, 3), color: rng.chance(0.6) ? '#1e1d1b' : '#c9c6bd', alpha: rng.range(0.08, 0.3), curve: 0.4 });
  }
  for (let i = 0; i < 10; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    ctx.fillStyle = css(shade(upper, 0.2), 0.6);
    ctx.fillRect(x, y, rng.range(2, 5), rng.range(2, 4));
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x - 1, y - 1, 1, 4);
  }
  grain(c, 0.016, sn + 13);
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Ceiling + fixtures
// ---------------------------------------------------------------------------

/** 60 cm fissured acoustic panels on a T-grid; one repeat = 2.4 m (4 × 4 panels). */
export function buildCeiling(o: { stains: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('ceiling', o.seed);
  const sn = rng.int(1, 1e9);
  const n = 4;
  const p = S / n;
  const stains = clamp01(o.stains);
  const base = rgb(0xe4e2da);
  const yellow = rgb(0xd9ceb0);
  fillPixels(c, (x, y, out) => {
    const i = Math.floor(x / p);
    const j = Math.floor(y / p);
    const age = hash2(i, j, sn) * 0.35;
    const col = mix(base, yellow, age);
    const h = hash2(x, y, sn + 1);
    let l = 1 + (h - 0.5) * 0.07 + (fbm(x / S, y / S, 8, 8, 2, sn + 2) - 0.5) * 0.06;
    if (h > 0.935) l -= 0.16;
    out[0] = col.r * l;
    out[1] = col.g * l;
    out[2] = col.b * l;
  });
  ctx.strokeStyle = 'rgba(60,56,50,0.3)';
  ctx.lineWidth = 1;
  for (let k = 0; k < 620; k++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const len = rng.range(2, 9);
    const a = rng.range(0, Math.PI);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  const ns = Math.round(stains * 5);
  for (let k = 0; k < ns; k++) {
    const i = rng.int(0, n - 1);
    const j = rng.int(0, n - 1);
    const cx = i * p + rng.range(p * 0.25, p * 0.75);
    const cy = j * p + rng.range(p * 0.25, p * 0.75);
    const r = rng.range(p * 0.18, p * 0.42);
    const rot = rng.range(0, Math.PI);
    const sq = rng.range(0.6, 1);
    const rings = rng.int(2, 4);
    for (let q = 0; q < rings; q++) {
      const rr = r * (1 - q * 0.22);
      blob(c, cx, cy, rr, rgb(0x9a7a46), 0.06 + q * 0.03, { blend: 'multiply', squash: sq, rot, hard: 0.7, wrap: false });
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(1, sq);
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(120,88,40,0.28)';
      ctx.lineWidth = rng.range(1.5, 3);
      ctx.globalCompositeOperation = 'multiply';
      ctx.stroke();
      ctx.restore();
    }
  }
  if (stains > 0.5) {
    const i = rng.int(0, n - 1);
    const j = rng.int(0, n - 1);
    ctx.fillStyle = 'rgba(80,70,55,0.1)';
    ctx.fillRect(i * p, j * p, p, p);
  }
  // T-grid: recess shadows + white tee with its rolled centre line
  const gw = 5;
  for (let k = 0; k <= n; k++) {
    const pos = Math.round(k * p) - gw / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(pos - 2, 0, 2, S);
    ctx.fillRect(pos + gw, 0, 2, S);
    ctx.fillRect(0, pos - 2, S, 2);
    ctx.fillRect(0, pos + gw, S, 2);
    ctx.fillStyle = '#eceae3';
    ctx.fillRect(pos, 0, gw, S);
    ctx.fillRect(0, pos, S, gw);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(pos + 2, 0, 1, S);
    ctx.fillRect(0, pos + 2, S, 1);
  }
  mottle(c, { seed: sn + 20, fx: 3, strength: 0.06 + stains * 0.05, blend: 'multiply', res: 64 });
  grain(c, 0.012, sn + 21);
  return c.canvas;
}

/** Prismatic-lens troffer face (emissive map), 2:1 for a 1.2 × 0.6 m fixture. */
export function buildFluorescent(o: { on: boolean; warm: number }): HTMLCanvasElement {
  const W = 512;
  const H = 256;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const warm = clamp01(o.warm);
  const lit = mix(rgb(0xdfe9ff), rgb(0xffe6c8), warm);
  const base = o.on ? lit : rgb(0xb4b8bc);
  ctx.fillStyle = css(base);
  ctx.fillRect(0, 0, W, H);
  if (o.on) {
    for (const fy of [0.3, 0.7]) {
      const y = H * fy;
      const g = ctx.createLinearGradient(0, y - 34, 0, y + 34);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(W * 0.04, y - 34, W * 0.92, 68);
    }
    const cap = ctx.createLinearGradient(0, 0, W * 0.08, 0);
    cap.addColorStop(0, 'rgba(60,70,90,0.35)');
    cap.addColorStop(1, 'rgba(60,70,90,0)');
    ctx.fillStyle = cap;
    ctx.fillRect(0, 0, W * 0.08, H);
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.fillStyle = cap;
    ctx.fillRect(0, 0, W * 0.08, H);
    ctx.restore();
  } else {
    for (const fy of [0.3, 0.7]) {
      const y = H * fy;
      const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(W * 0.05, y - 22, W * 0.9, 44);
    }
  }
  // prismatic acrylic: 8 px pyramids with a facet highlight and ridge lines
  const cell = 8;
  const pat = makeCanvas(cell, cell);
  const pg = pat.ctx.createRadialGradient(cell * 0.4, cell * 0.4, 0, cell / 2, cell / 2, cell * 0.7);
  pg.addColorStop(0, 'rgba(255,255,255,0.16)');
  pg.addColorStop(0.7, 'rgba(255,255,255,0)');
  pg.addColorStop(1, 'rgba(0,0,0,0.12)');
  pat.ctx.fillStyle = pg;
  pat.ctx.fillRect(0, 0, cell, cell);
  pat.ctx.fillStyle = 'rgba(0,0,0,0.13)';
  pat.ctx.fillRect(0, 0, cell, 1);
  pat.ctx.fillRect(0, 0, 1, cell);
  const p = ctx.createPattern(pat.canvas, 'repeat');
  if (p) {
    ctx.fillStyle = p;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  mottle(c, { seed: 77, fx: 2, strength: 0.05, blend: 'multiply', res: 32 });
  if (!o.on) {
    for (let i = 0; i < 12; i++) blob(c, (i * 97) % W, (i * 61) % H, 10 + (i % 4) * 6, rgb(0x6a6e72), 0.08, { blend: 'multiply', wrap: false });
  }
  grain(c, 0.01, 78);
  return c.canvas;
}

/** Brushed stainless or galvanised sheet; one repeat = 1 m. */
export function buildMetal(o: { brushed: boolean; tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('metal', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  if (o.brushed) {
    brushedFill(c, 0, 0, S, S, base, sn, false, 1);
    for (let i = 0; i < 18; i++) {
      streak(c, rng, { x: rng.next() * S, y: rng.next() * S, len: rng.range(20, 160), angle: rng.range(-0.2, 0.2) + (rng.chance(0.25) ? rng.range(0, Math.PI) : 0), width: 1, color: rng.chance(0.6) ? '#ffffff' : '#2a2c2f', alpha: rng.range(0.08, 0.2), curve: 0.1 });
    }
    for (let i = 0; i < 4; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(14, 30), rgb(0x3a3c40), rng.range(0.05, 0.1), { blend: 'multiply', squash: rng.range(0.6, 1), rot: rng.range(0, 3), hard: 0.2 });
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(255,255,255,0.08)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else {
    ctx.fillStyle = css(base);
    ctx.fillRect(0, 0, S, S);
    mottle(c, { seed: sn + 3, fx: 8, strength: 0.16, blend: 'overlay', res: 128, octaves: 2 });
    mottle(c, { seed: sn + 4, fx: 24, strength: 0.1, blend: 'overlay', res: 256, octaves: 1 });
    for (let i = 0; i < 160; i++) {
      const lighter = rng.chance(0.5);
      blob(c, rng.next() * S, rng.next() * S, rng.range(8, 26), lighter ? rgb(0xffffff) : rgb(0x000000), rng.range(0.03, 0.07), { hard: 0.6, squash: rng.range(0.7, 1), rot: rng.range(0, 3) });
    }
    for (let i = 0; i < 6; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(20, 50), rgb(0xe8eaec), rng.range(0.06, 0.12), { hard: 0.2 });
    for (let i = 0; i < 8; i++) streak(c, rng, { x: rng.next() * S, y: rng.next() * S, len: rng.range(10, 80), angle: rng.range(0, 6.3), width: 1, color: '#ffffff', alpha: 0.12 });
  }
  modifyPixels(c, 0, 0, S, S, (px, py, d, i) => {
    const n = (hash2(px, py, sn + 9) - 0.5) * 8;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  });
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Doors (512 × 1024; drawn as 1.0 × 2.0 m; hinge side left, handle right)
// ---------------------------------------------------------------------------

export type DoorKindTex = 'wood' | 'steel' | 'glass_frame';

export function buildDoor(o: { kind: DoorKindTex; label?: string; window?: boolean; seed: number }): HTMLCanvasElement {
  const W = 512;
  const H = 1024;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const rng = rngFor(`door:${o.kind}`, o.seed);
  const sn = rng.int(1, 1e9);
  const pp = 512;
  const X = (m: number): number => m * pp;
  const Y = (m: number): number => H - m * pp;

  if (o.kind === 'glass_frame') {
    drawGlassDoor(c, rng, sn);
    return c.canvas;
  }

  if (o.kind === 'wood') {
    const dark = rgb(0x5a3b24);
    const light = rgb(0x9c7448);
    fillPixels(c, (x, y, out) => {
      const g = fbm(x / W, y / H, 30, 2, 3, sn);
      const fine = vnoise((x / W) * 160, (y / H) * 8, 160, 8, sn + 5);
      let t = clamp01(0.25 + g * 0.6 + fine * 0.25);
      if (fine > 0.86) t -= 0.25;
      const col = mix(dark, light, t);
      const l = 1 + (hash2(x, y, sn + 7) - 0.5) * 0.04;
      out[0] = col.r * l;
      out[1] = col.g * l;
      out[2] = col.b * l;
    });
    const edge = ctx.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.28)');
    edge.addColorStop(0.08, 'rgba(0,0,0,0)');
    edge.addColorStop(0.92, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    const sheen = ctx.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.08)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, Y(1.94), W, 2);
  } else {
    const paint = mix(rgb(0x9a978d), rgb(0x8c9094), hash2(1, 2, sn) * 0.6);
    fillPixels(c, (x, y, out) => {
      const peel = (hash2(x >> 1, y >> 1, sn) - 0.5) * 0.05 + (hash2(x, y, sn + 1) - 0.5) * 0.02;
      const band = (fbm(x / W, y / H, 2, 4, 2, sn + 2) - 0.5) * 0.05;
      const l = 1 + peel + band;
      out[0] = paint.r * l;
      out[1] = paint.g * l;
      out[2] = paint.b * l;
    });
    // hollow-metal seams and edge bevels
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, Y(1.95), W, 2);
    ctx.fillRect(0, Y(0.08), W, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(0, Y(1.95) + 2, W, 1);
    ctx.fillRect(0, Y(0.08) + 2, W, 1);
    const edge = ctx.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0.35)');
    edge.addColorStop(0.03, 'rgba(0,0,0,0)');
    edge.addColorStop(0.97, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3; i++) {
      const x = rng.range(60, W - 60);
      const y = rng.range(H * 0.3, H * 0.9);
      blob(c, x, y, rng.range(30, 70), rgb(0x000000), 0.07, { blend: 'multiply', squash: rng.range(0.5, 0.9), rot: rng.range(0, 3), hard: 0.1, wrap: false });
      blob(c, x - 10, y - 10, rng.range(20, 40), rgb(0xffffff), 0.05, { squash: 0.7, hard: 0.1, wrap: false });
    }
    for (let i = 0; i < 7; i++) {
      const x = rng.chance(0.5) ? rng.range(0, 30) : rng.range(W - 30, W);
      const y = rng.range(Y(0.6), H);
      ctx.fillStyle = 'rgba(40,36,34,0.6)';
      ctx.fillRect(x, y, rng.range(2, 6), rng.range(2, 5));
      ctx.fillStyle = 'rgba(150,70,40,0.35)';
      ctx.fillRect(x + 1, y + 2, 2, rng.range(4, 14));
    }
  }

  // hinge shadows
  for (const hy of [0.25, 1.05, 1.85]) {
    const y = Y(hy + 0.06);
    const h = 0.12 * pp;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y, 10, h);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(10, y, 6, h);
  }
  // kick plate
  {
    const top = Y(0.25);
    brushedFill(c, 14, top, W - 28, H - top - 6, rgb(0xaeb3b7), sn + 20, false, 1.2);
    bevel(ctx, 14, top, W - 28, H - top - 6, 2, 0.3, 0.4);
    for (const [sx, sy] of [[30, top + 16], [W - 30, top + 16], [30, H - 22], [W - 30, H - 22]]) screwHead(ctx, sx, sy, 5, rng.range(0, 3));
    for (let i = 0; i < 10; i++) {
      streak(c, rng, { x: rng.range(20, W - 20), y: rng.range(top + 6, H - 10), len: rng.range(20, 120), angle: rng.range(-0.3, 0.3), width: rng.range(1, 3), color: rng.chance(0.6) ? '#1a1a1c' : '#e4e6e8', alpha: rng.range(0.1, 0.35), curve: 0.4, wrap: false });
    }
  }
  // push plate
  {
    const x = X(0.8);
    const y = Y(1.35);
    const w = X(0.12);
    const h = 0.4 * pp;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 3, y + 4, w, h);
    brushedFill(c, x, y, w, h, rgb(0xb4b9bd), sn + 30, true, 1);
    bevel(ctx, x, y, w, h, 2, 0.35, 0.4);
    screwHead(ctx, x + 9, y + 9, 4, 1);
    screwHead(ctx, x + w - 9, y + 9, 4, 2);
    screwHead(ctx, x + 9, y + h - 9, 4, 0.5);
    screwHead(ctx, x + w - 9, y + h - 9, 4, 2.5);
  }
  // lever handle
  {
    const ry = Y(1.05);
    const rx = X(0.86);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(rx + 4, ry + 10, 24, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    rrect(ctx, X(0.6) + 4, ry + 2, X(0.26), 20, 9);
    ctx.fill();
    const rg = ctx.createRadialGradient(rx - 6, ry - 6, 2, rx, ry, 24);
    rg.addColorStop(0, '#d8dcdf');
    rg.addColorStop(0.6, '#8e949a');
    rg.addColorStop(1, '#4b5056');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(rx, ry, 23, 0, Math.PI * 2);
    ctx.fill();
    const lg = ctx.createLinearGradient(0, ry - 12, 0, ry + 10);
    lg.addColorStop(0, '#dfe3e6');
    lg.addColorStop(0.45, '#9ba1a7');
    lg.addColorStop(1, '#3f444a');
    ctx.fillStyle = lg;
    rrect(ctx, X(0.6), ry - 11, X(0.26), 20, 9);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx, ry, 11, 0, Math.PI * 2);
    ctx.fill();
    blob(c, X(0.72), ry, 70, rgb(0x2c2a28), 0.09, { blend: 'multiply', squash: 0.6, hard: 0.1, wrap: false });
  }
  if (o.window) drawWireGlass(c, X(0.5) - 0.1 * pp, Y(1.75), 0.2 * pp, 0.6 * pp);
  if (o.label) drawDoorLabel(c, o.label, X(0.5), o.window ? Y(1.9) : Y(1.62), X(0.56), 0.1 * pp);
  vband(ctx, 0, W, Y(0.02), Y(0.4), rgb(0x3a3733), 0.3, 0);
  mottle(c, { seed: sn + 40, fx: 2, fy: 4, strength: 0.07, blend: 'multiply', res: 48 });
  grain(c, 0.012, sn + 41);
  return c.canvas;
}

/** Narrow wire-glass vision lite with a dark steel frame. Glass pixels keep alpha ≈ 0.5 so a transparent material can see through. */
function drawWireGlass(c: Canvas2D, x: number, y: number, w: number, h: number): void {
  const { ctx } = c;
  ctx.fillStyle = '#2b2e32';
  ctx.fillRect(x - 10, y - 10, w + 20, h + 20);
  bevel(ctx, x - 10, y - 10, w + 20, h + 20, 2, 0.25, 0.4);
  ctx.clearRect(x, y, w, h);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, 'rgba(40,52,60,0.5)');
  g.addColorStop(1, 'rgba(14,18,22,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(200,205,210,0.22)';
  ctx.lineWidth = 1;
  for (let d = -h; d < w + h; d += 12) {
    ctx.beginPath();
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d + h, y + h);
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    ctx.stroke();
  }
  const rg = ctx.createLinearGradient(x, y, x + w, y + h * 0.6);
  rg.addColorStop(0, 'rgba(255,255,255,0)');
  rg.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  rg.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(x, y, w, 1);
}

function drawDoorLabel(c: Canvas2D, label: string, cx: number, cy: number, maxW: number, h: number): void {
  const { ctx } = c;
  const parts = label
    .split(/\s+—\s+|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
  const lines = parts.length ? parts : [label];
  const plateH = h * (1 + 0.55 * (lines.length - 1));
  const px = fitFontSize(ctx, lines, maxW - 24, h * 0.62, 9, (p) => font(p, 700, FONT_COND), 0.08);
  ctx.font = font(px, 700, FONT_COND);
  const plateW = clamp(Math.max(...lines.map((l) => measureSpaced(ctx, l, px * 0.08))) + 28, h * 1.4, maxW);
  const x = cx - plateW / 2;
  const y = cy - plateH / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(x + 2, y + 3, plateW, plateH);
  ctx.fillStyle = '#2a2d31';
  ctx.fillRect(x, y, plateW, plateH);
  bevel(ctx, x, y, plateW, plateH, 1, 0.3, 0.4);
  ctx.fillStyle = '#e9ebec';
  ctx.textBaseline = 'middle';
  const lh = px * 1.18;
  const y0 = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => spacedText(ctx, l, cx, y0 + i * lh, px * 0.08, 'center'));
  screwHead(ctx, x + 7, cy, 2.5, 0.5);
  screwHead(ctx, x + plateW - 7, cy, 2.5, 2);
}

/** Aluminium-framed sliding entrance leaf: glass is semi-transparent (material must be transparent). */
function drawGlassDoor(c: Canvas2D, rng: RNG, sn: number): void {
  const { ctx, w: W, h: H } = c;
  const pp = 512;
  const Y = (m: number): number => H - m * pp;
  ctx.clearRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(150,180,175,0.18)');
  g.addColorStop(1, 'rgba(120,150,150,0.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 3; i++) {
    const x = rng.range(-W * 0.3, W * 0.9);
    const rg = ctx.createLinearGradient(x, 0, x + 140, H);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.5, 'rgba(255,255,255,0.09)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 5; i++) blob(c, rng.range(W * 0.3, W * 0.9), rng.range(Y(1.4), Y(0.9)), rng.range(14, 30), rgb(0xdfe6e6), 0.08, { hard: 0.2, wrap: false });
  // frosted visibility band with safety decals
  {
    const y = Y(1.16);
    const h = 0.1 * pp;
    ctx.fillStyle = 'rgba(235,240,240,0.55)';
    ctx.fillRect(0, y, W, h);
    ctx.fillStyle = 'rgba(40,48,52,0.85)';
    ctx.font = font(h * 0.34, 700, FONT_COND);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    spacedText(ctx, 'AUTOMATIC DOOR', W * 0.5, y + h * 0.36, h * 0.03);
    ctx.font = font(h * 0.22, 500, FONT_COND);
    spacedText(ctx, 'CAUTION · KEEP CLEAR', W * 0.5, y + h * 0.72, h * 0.02);
  }
  const al = rgb(0x5b5f64);
  const frame = (x: number, y: number, w: number, h: number, vertical: boolean): void => {
    brushedFill(c, x, y, w, h, al, sn + 50, vertical, 0.8);
    bevel(ctx, x, y, w, h, 2, 0.22, 0.45);
  };
  frame(0, 0, 44, H, true);
  frame(W - 44, 0, 44, H, true);
  frame(0, 0, W, 44, false);
  frame(0, Y(0.15), W, 0.15 * pp, false);
  frame(0, Y(1.02), W, 0.04 * pp, false);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, H - 6, W, 6);
  for (let i = 0; i < 8; i++) {
    streak(c, rng, { x: rng.range(50, W - 50), y: rng.range(Y(0.15) + 6, H - 10), len: rng.range(20, 90), angle: rng.range(-0.2, 0.2), width: rng.range(1, 3), color: '#141416', alpha: rng.range(0.15, 0.4), wrap: false });
  }
  ctx.fillStyle = '#1b1c1e';
  ctx.fillRect(W - 8, 0, 8, H);
  grain(c, 0.01, sn + 60);
}

// ---------------------------------------------------------------------------
// Soft goods
// ---------------------------------------------------------------------------

/** Pleated cubicle curtain with mesh header and faint printed motif; one repeat = 1 m wide × full drop. */
export function buildCurtain(o: { tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const { ctx } = c;
  const rng = rngFor('curtain', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  const pleats = 7;
  const meshH = Math.round(S * 0.15);
  const mesh = rgb(0xe6e8e4);
  fillPixels(c, (x, y, out) => {
    const drift = Math.sin((y / S) * Math.PI * 2 + (sn % 7)) * 5 + Math.sin((y / S) * Math.PI * 6) * 2.5;
    const ph = ((x + drift) / S) * pleats * Math.PI * 2;
    const fold = Math.pow(0.5 + 0.5 * Math.cos(ph), 1.6);
    const weave = (hash2(x, y, sn) - 0.5) * 0.05 + (hash2(x >> 1, y, sn + 1) - 0.5) * 0.03;
    if (y < meshH) {
      const open = x % 4 === 0 || y % 4 === 0 ? 0.78 : 1.0;
      const ml = (0.86 + fold * 0.18) * open;
      out[0] = mesh.r * ml;
      out[1] = mesh.g * ml;
      out[2] = mesh.b * ml;
      return;
    }
    const l = 0.7 + fold * 0.42 + weave;
    out[0] = base.r * l;
    out[1] = base.g * l;
    out[2] = base.b * l;
  });
  // printed leaf motif on a 64 px grid
  const motif = css(mul(base, 0.84), 0.5);
  for (let gy = meshH + 32; gy < S; gy += 64) {
    for (let gx = 0; gx < S; gx += 64) {
      const x = gx + (Math.floor(gy / 64) % 2) * 32;
      const y = gy;
      wrapped(c, x, y, 20, () => {
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = motif;
        ctx.translate(x, y);
        ctx.rotate(0.6);
        ctx.beginPath();
        ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(1.5);
        ctx.beginPath();
        ctx.ellipse(10, 0, 7, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, S - 14, S, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, S - 8.5);
  ctx.lineTo(S, S - 8.5);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, meshH - 1, S, 3);
  vband(ctx, 0, S, S * 0.48, S * 0.56, rgb(0x3a3834), 0, 0.1);
  vband(ctx, 0, S, S * 0.56, S * 0.64, rgb(0x3a3834), 0.1, 0);
  vband(ctx, 0, S, S * 0.9, S, rgb(0x3a3834), 0, 0.14);
  mottle(c, { seed: sn + 7, fx: 2, strength: 0.06, blend: 'multiply', res: 48 });
  grain(c, 0.015, sn + 9);
  return c.canvas;
}

/** Woven upholstery; one repeat = 0.5 m. */
export function buildFabric(o: { tint: number; seed: number }): HTMLCanvasElement {
  const c = makeCanvas(S, S);
  const rng = rngFor('fabric', o.seed);
  const sn = rng.int(1, 1e9);
  const base = rgb(o.tint);
  const light = shade(base, 0.14);
  const dark = shade(base, -0.16);
  fillPixels(c, (x, y, out) => {
    const warp = Math.sin((x * Math.PI) / 2) * 0.5 + 0.5;
    const weft = Math.sin((y * Math.PI) / 2) * 0.5 + 0.5;
    const thread = warp * weft * 0.12 - 0.06;
    const h = hash2(x >> 1, y >> 1, sn);
    let col = base;
    if (h > 0.9) col = light;
    else if (h < 0.08) col = dark;
    const l = 1 + thread + (hash2(x, y, sn + 1) - 0.5) * 0.06 + (fbm(x / S, y / S, 3, 3, 2, sn + 2) - 0.5) * 0.08;
    out[0] = col.r * l;
    out[1] = col.g * l;
    out[2] = col.b * l;
  });
  mottle(c, { seed: sn + 5, fx: 2, strength: 0.08, blend: 'multiply', res: 48 });
  for (let i = 0; i < 3; i++) blob(c, rng.next() * S, rng.next() * S, rng.range(30, 70), rgb(0x2a2622), rng.range(0.05, 0.1), { blend: 'multiply', squash: rng.range(0.6, 1), rot: rng.range(0, 3), hard: 0.2 });
  grain(c, 0.02, sn + 6);
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Sky (equirectangular 1024 × 512; canvas top = zenith)
// ---------------------------------------------------------------------------

export function buildSky(o: { dawn: number }): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const dawn = clamp01(o.dawn);
  const sn = 4242;
  const lw = 512;
  const lh = 256;
  const low = makeCanvas(lw, lh);
  const zenithN = rgb(0x04060c);
  const horizN = rgb(0x171a23);
  const glowN = rgb(0x6a4320);
  const zenithD = rgb(0x2a3442);
  const horizD = rgb(0x8793a0);
  const bandD = rgb(0xb08a78);
  const cloudDark = rgb(0x0f1218);
  const cloudGlow = rgb(0x5a3c26);
  const cloudDawn = rgb(0x7a8290);
  const ground = rgb(0x060707);
  const phi = 0.9;
  const cover = (u: number, v: number): number => {
    const cn = fbm(u, v * 2, 6, 6, 5, sn);
    return smoothstep(0.42, 0.68, cn + smoothstep(0, 0.5, v) * 0.12);
  };
  fillPixels(low, (x, y, out) => {
    const u = x / lw;
    const v = y / lh;
    const horizon = smoothstep(0, 0.5, v);
    const cityDir = 0.55 + 0.45 * Math.cos(u * Math.PI * 2 - phi);
    const glowBand = Math.exp(-Math.pow((v - 0.5) / 0.09, 2)) * cityDir * (1 - dawn * 0.8);
    const nightSky = mix(mix(zenithN, horizN, horizon), glowN, glowBand * 0.75);
    const dawnSky = mix(mix(zenithD, horizD, horizon), bandD, Math.exp(-Math.pow((v - 0.48) / 0.05, 2)) * 0.6);
    let sky = mix(nightSky, dawnSky, dawn);
    const cv = cover(u, v);
    const cloudN = mix(cloudDark, cloudGlow, glowBand * 0.9 + 0.1 * horizon);
    const cloudC = mix(cloudN, cloudDawn, dawn);
    sky = mix(sky, cloudC, cv * (v < 0.5 ? 1 : 0.3));
    if (v > 0.5) sky = mix(sky, ground, smoothstep(0.5, 0.6, v));
    out[0] = sky.r;
    out[1] = sky.g;
    out[2] = sky.b;
  });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(low.canvas, 0, 0, W, H);
  // sparse stars in the cloud gaps
  const starA = (1 - dawn) * 0.9;
  if (starA > 0.02) {
    for (let y = 0; y < H * 0.46; y++) {
      for (let x = 0; x < W; x++) {
        const h = hash2(x, y, sn + 9);
        if (h < 0.9992) continue;
        const u = x / W;
        const v = y / H;
        const a = starA * (1 - cover(u, v)) * (0.4 + 0.6 * hash2(x, y, sn + 10)) * (1 - v * 1.6);
        if (a <= 0.02) continue;
        ctx.fillStyle = `rgba(220,228,255,${a})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const haze = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.52);
  haze.addColorStop(0, 'rgba(90,96,108,0)');
  haze.addColorStop(1, `rgba(90,96,108,${0.18 + dawn * 0.2})`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, H * 0.4, W, H * 0.12);
  grain(c, 0.012, sn + 11);
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Decals (transparent; toe / travel direction toward the canvas top = +v)
// ---------------------------------------------------------------------------

export type DecalKindTex = 'footprint' | 'puddle' | 'scuff' | 'drag' | 'oil';

export function buildDecal(kind: DecalKindTex): HTMLCanvasElement {
  const rng = rngFor(`decal:${kind}`, 1);
  switch (kind) {
    case 'footprint':
      return decalFootprint(rng);
    case 'puddle':
      return decalPuddle(rng);
    case 'scuff':
      return decalScuff(rng);
    case 'drag':
      return decalDrag(rng);
    case 'oil':
    default:
      return decalOil(rng);
  }
}

function decalFootprint(rng: RNG): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  ctx.clearRect(0, 0, W, H);
  const shape = makeCanvas(W, H);
  const s = shape.ctx;
  s.fillStyle = '#fff';
  s.beginPath();
  s.ellipse(126, 92, 46, 66, -0.08, 0, Math.PI * 2);
  s.fill();
  s.beginPath();
  s.ellipse(122, 48, 36, 26, -0.15, 0, Math.PI * 2);
  s.fill();
  s.beginPath();
  s.ellipse(138, 150, 26, 44, 0.05, 0, Math.PI * 2);
  s.fill();
  s.beginPath();
  s.ellipse(134, 206, 34, 36, 0, 0, Math.PI * 2);
  s.fill();
  // tread grooves
  s.globalCompositeOperation = 'destination-out';
  for (let y = 40; y < 150; y += 14) s.fillRect(70, y, 120, 4);
  for (let y = 180; y < 240; y += 12) s.fillRect(90, y, 90, 4);
  s.fillRect(0, 160, W, 6);
  s.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.shadowColor = 'rgba(14,22,28,0.6)';
  ctx.shadowBlur = 7;
  ctx.drawImage(shape.canvas, 0, 0);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-in';
  const g = ctx.createLinearGradient(0, 30, 0, 240);
  g.addColorStop(0, 'rgba(14,22,28,0.35)');
  g.addColorStop(0.5, 'rgba(14,22,28,0.6)');
  g.addColorStop(1, 'rgba(14,22,28,0.7)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  modifyPixels(c, 0, 0, W, H, (px, py, d, i) => {
    if (d[i + 3] < 8) return;
    const n = (hash2(px, py, 5) - 0.5) * 30;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
    d[i + 3] *= 0.85 + hash2(px >> 1, py >> 1, 6) * 0.15;
  });
  for (let i = 0; i < 14; i++) {
    blob(c, 128 + rng.range(-70, 70), rng.range(30, 240), rng.range(1.5, 4), rgb(0x0e161c), rng.range(0.25, 0.5), { hard: 0.5, wrap: false });
  }
  return c.canvas;
}

function decalPuddle(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const c = makeCanvas(W, W);
  const { ctx } = c;
  ctx.clearRect(0, 0, W, W);
  const path = blobPath2D(rng, 256, 256, 190, { points: 22, rough: 0.28, squash: 0.78, rot: 0.4 });
  const g = ctx.createRadialGradient(236, 246, 20, 256, 256, 200);
  g.addColorStop(0, 'rgba(10,14,18,0.78)');
  g.addColorStop(0.75, 'rgba(10,14,18,0.68)');
  g.addColorStop(1, 'rgba(10,14,18,0.5)');
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  const hl = ctx.createLinearGradient(120, 120, 380, 380);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.42, 'rgba(255,255,255,0.1)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  hl.addColorStop(0.58, 'rgba(255,255,255,0.08)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.ellipse(256 + rng.range(-30, 30), 256 + rng.range(-20, 20), 20 + i * 26, (20 + i * 26) * 0.7, 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(190,200,205,0.22)';
  ctx.lineWidth = 2.5;
  ctx.stroke(path);
  // damp halo around the edge
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.shadowColor = 'rgba(10,14,18,0.4)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = 'rgba(10,14,18,0.3)';
  ctx.fill(path);
  ctx.restore();
  for (let i = 0; i < 20; i++) {
    const a = rng.range(0, 6.3);
    const d = rng.range(195, 240);
    blob(c, 256 + Math.cos(a) * d, 256 + Math.sin(a) * d * 0.78, rng.range(2, 6), rgb(0x0a0e12), rng.range(0.3, 0.6), { hard: 0.5, wrap: false });
  }
  return c.canvas;
}

function decalScuff(rng: RNG): HTMLCanvasElement {
  const W = 256;
  const c = makeCanvas(W, W);
  const { ctx } = c;
  ctx.clearRect(0, 0, W, W);
  const cx = 128;
  const cy = 150;
  const r = 120;
  const a0 = -2.4;
  const a1 = -0.7;
  const segs = 24;
  ctx.lineCap = 'round';
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const taper = Math.sin((Math.PI * (t0 + t1)) / 2);
    ctx.strokeStyle = `rgba(8,8,9,${0.15 + 0.5 * taper})`;
    ctx.lineWidth = 4 + 10 * taper;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0 + (a1 - a0) * t0, a0 + (a1 - a0) * t1 + 0.01);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const rr = r + rng.range(-7, 7);
    ctx.strokeStyle = `rgba(0,0,0,${rng.range(0.3, 0.8)})`;
    ctx.lineWidth = rng.range(0.6, 1.6);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a0 + rng.range(0, 0.6), a1 - rng.range(0, 0.6));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 3; i++) {
    streak(c, rng, { x: rng.range(40, 220), y: rng.range(40, 220), len: rng.range(30, 90), angle: rng.range(0, 6.3), width: rng.range(2, 5), color: '#111112', alpha: rng.range(0.15, 0.35), wrap: false, curve: 0.8 });
  }
  return c.canvas;
}

function decalDrag(rng: RNG): HTMLCanvasElement {
  const W = 256;
  const H = 512;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  ctx.clearRect(0, 0, W, H);
  const lanes = [92, 164];
  ctx.lineCap = 'round';
  for (const lx of lanes) {
    const pts: [number, number][] = [];
    let x = lx + rng.range(-6, 6);
    for (let y = 20; y <= H - 20; y += 16) {
      x += rng.range(-4, 4);
      pts.push([x, y]);
    }
    for (let k = 0; k < 16; k++) {
      const off = rng.range(-11, 11);
      ctx.strokeStyle = `rgba(16,20,24,${rng.range(0.1, 0.32)})`;
      ctx.lineWidth = rng.range(1.5, 6);
      ctx.beginPath();
      pts.forEach(([px, py], i) => {
        const jx = px + off + rng.range(-1.5, 1.5);
        if (i === 0) ctx.moveTo(jx, py);
        else ctx.lineTo(jx, py);
      });
      ctx.stroke();
    }
  }
  for (const lx of lanes) {
    const g = ctx.createLinearGradient(lx - 22, 0, lx + 22, 0);
    g.addColorStop(0, 'rgba(16,20,24,0)');
    g.addColorStop(0.5, 'rgba(16,20,24,0.35)');
    g.addColorStop(1, 'rgba(16,20,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - 22, 10, 44, H - 20);
  }
  // strong at the bottom (origin), fading toward the top (+v)
  ctx.globalCompositeOperation = 'destination-in';
  const f = ctx.createLinearGradient(0, 0, 0, H);
  f.addColorStop(0, 'rgba(0,0,0,0.15)');
  f.addColorStop(0.25, 'rgba(0,0,0,0.6)');
  f.addColorStop(0.9, 'rgba(0,0,0,1)');
  f.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = f;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) {
    const lx = rng.pick(lanes) + rng.range(-24, 24);
    blob(c, lx, rng.range(20, H - 20), rng.range(1, 3), rgb(0x0c1014), rng.range(0.3, 0.6), { hard: 0.5, wrap: false });
  }
  return c.canvas;
}

function decalOil(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const c = makeCanvas(W, W);
  const { ctx } = c;
  ctx.clearRect(0, 0, W, W);
  const path = blobPath2D(rng, 256, 256, 170, { points: 20, rough: 0.35, squash: 0.85, rot: 1.1 });
  const g = ctx.createRadialGradient(240, 250, 10, 256, 256, 180);
  g.addColorStop(0, 'rgba(6,5,4,0.92)');
  g.addColorStop(0.7, 'rgba(8,7,6,0.85)');
  g.addColorStop(1, 'rgba(10,9,8,0.7)');
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  // thin-film iridescence along the edge
  const hues: [number, number][] = [
    [280, 0.16],
    [220, 0.18],
    [160, 0.16],
    [60, 0.14],
    [20, 0.12],
  ];
  hues.forEach(([h, a], i) => {
    ctx.save();
    ctx.translate(256, 256);
    const sc = 1 - i * 0.035;
    ctx.scale(sc, sc);
    ctx.translate(-256, -256);
    ctx.strokeStyle = `hsla(${h},70%,55%,${a})`;
    ctx.lineWidth = 9;
    ctx.stroke(path);
    ctx.restore();
  });
  const hl = ctx.createLinearGradient(150, 150, 330, 330);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, W, W);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.shadowColor = 'rgba(10,8,6,0.45)';
  ctx.shadowBlur = 20;
  ctx.fillStyle = 'rgba(10,8,6,0.3)';
  ctx.fill(path);
  ctx.restore();
  for (let i = 0; i < 10; i++) {
    const a = rng.range(0, 6.3);
    const d = rng.range(170, 215);
    blob(c, 256 + Math.cos(a) * d, 256 + Math.sin(a) * d * 0.85, rng.range(3, 8), rgb(0x080706), rng.range(0.4, 0.75), { hard: 0.6, wrap: false });
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(200,195,185,${rng.range(0.1, 0.3)})`;
    const a = rng.range(0, 6.3);
    const d = rng.range(0, 160);
    ctx.fillRect(256 + Math.cos(a) * d, 256 + Math.sin(a) * d * 0.85, 1, 1);
  }
  return c.canvas;
}
