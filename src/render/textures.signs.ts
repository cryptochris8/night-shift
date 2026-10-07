/**
 * Signage, posters and boards for the texture factory. Crisp hospital typography on
 * procedurally weathered plates; posters/boards carry plausible hospital copy.
 */
import type { RNG } from '../core/rng';
import {
  type Align,
  type Canvas2D,
  type RGB,
  FONT_COND,
  FONT_HAND,
  FONT_SANS,
  bevel,
  blob,
  brushedFill,
  clamp,
  css,
  fitFontSize,
  font,
  grain,
  hash2,
  makeCanvas,
  measureSpaced,
  mix,
  modifyPixels,
  mottle,
  paragraph,
  rgb,
  rngFor,
  rrect,
  screwHead,
  shade,
  spacedText,
  streak,
  textRows,
  vband,
  wrapText,
} from './textures.util';

export type SignKind = 'room_number' | 'wayfinding' | 'dept' | 'warning' | 'big_red' | 'hospital_name' | 'elevator_call' | 'exit';

const SIGN_SIZE: Record<SignKind, [number, number]> = {
  room_number: [256, 256],
  wayfinding: [1024, 256],
  dept: [768, 256],
  warning: [1024, 384],
  big_red: [1024, 256],
  hospital_name: [1024, 192],
  elevator_call: [256, 512],
  exit: [512, 256],
};

/** Values ≤ 8 are metres (400 px/m), larger values are pixels; a single dimension keeps the kind's aspect. */
function resolveSize(kind: SignKind, w?: number, h?: number): [number, number] {
  const [dw, dh] = SIGN_SIZE[kind];
  const conv = (v: number, d: number): number => {
    if (!(v > 0)) return d;
    const px = v <= 8 ? v * 400 : v;
    return clamp(Math.round(px / 2) * 2, 64, 2048);
  };
  if (w !== undefined && h === undefined) {
    const W = conv(w, dw);
    return [W, clamp(Math.round((W * dh) / dw), 32, 2048)];
  }
  if (h !== undefined && w === undefined) {
    const H = conv(h, dh);
    return [clamp(Math.round((H * dw) / dh), 32, 2048), H];
  }
  return [w === undefined ? dw : conv(w, dw), h === undefined ? dh : conv(h, dh)];
}

function splitLines(text: string): string[] {
  const parts = text
    .split(/\n|\s+—\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [text];
}

const DEPT_SUB: Record<string, string> = {
  IMAGING: 'RADIOLOGY · CT · X-RAY',
  TRIAGE: 'NURSING ASSESSMENT',
  'TREATMENT 1': 'PROCEDURES',
  'MEDICATION ROOM': 'AUTHORIZED PERSONNEL ONLY',
  EMERGENCY: 'DEPARTMENT',
  'NURSE STATION': 'EMERGENCY DEPARTMENT',
};

function plate(c: Canvas2D, color: RGB, o: { seed: number; screws?: boolean; bevelSize?: number }): void {
  const { ctx, w, h } = c;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, css(shade(color, 0.06)));
  g.addColorStop(1, css(shade(color, -0.06)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  mottle(c, { seed: o.seed, fx: 2, strength: 0.05, blend: 'overlay', res: 32 });
  bevel(ctx, 0, 0, w, h, o.bevelSize ?? Math.max(2, Math.round(h * 0.012)), 0.25, 0.35);
  if (o.screws) {
    const r = Math.max(3, h * 0.025);
    const m = r * 2.4;
    screwHead(ctx, m, m, r, 0.6);
    screwHead(ctx, w - m, m, r, 2.1);
    screwHead(ctx, m, h - m, r, 1.3);
    screwHead(ctx, w - m, h - m, r, 0.2);
  }
}

function finishSign(c: Canvas2D, seed: number, grime = 0.5): void {
  mottle(c, { seed: seed + 1, fx: 3, strength: 0.06 * grime, blend: 'multiply', res: 32 });
  grain(c, 0.01, seed + 2);
}

/** Black diagonal hazard stripes inside a rect (background shows through as the other colour). */
function stripes(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, period: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#141414';
  for (let sx = x - h; sx < x + w + h; sx += period) {
    ctx.beginPath();
    ctx.moveTo(sx, y + h);
    ctx.lineTo(sx + h, y);
    ctx.lineTo(sx + h + period / 2, y);
    ctx.lineTo(sx + period / 2, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const BRAILLE: Record<string, number[]> = {
  a: [1], b: [1, 2], c: [1, 4], d: [1, 4, 5], e: [1, 5], f: [1, 2, 4], g: [1, 2, 4, 5], h: [1, 2, 5], i: [2, 4], j: [2, 4, 5],
  k: [1, 3], l: [1, 2, 3], m: [1, 3, 4], n: [1, 3, 4, 5], o: [1, 3, 5], p: [1, 2, 3, 4], q: [1, 2, 3, 4, 5], r: [1, 2, 3, 5], s: [2, 3, 4], t: [2, 3, 4, 5],
  u: [1, 3, 6], v: [1, 2, 3, 6], w: [2, 4, 5, 6], x: [1, 3, 4, 6], y: [1, 3, 4, 5, 6], z: [1, 3, 5, 6], '#': [3, 4, 5, 6],
};
const DIGIT_LETTER = 'jabcdefghi';

/** Grade-1 braille row (ADA room signs). */
function braille(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, dot: number, color: string): void {
  const cells: number[][] = [];
  let numeric = false;
  for (const ch of text.toLowerCase()) {
    if (/[0-9]/.test(ch)) {
      if (!numeric) {
        cells.push(BRAILLE['#']);
        numeric = true;
      }
      cells.push(BRAILLE[DIGIT_LETTER[Number(ch)]]);
    } else if (/[a-z]/.test(ch)) {
      numeric = false;
      cells.push(BRAILLE[ch]);
    } else if (ch === ' ') {
      numeric = false;
      cells.push([]);
    }
  }
  if (!cells.length) return;
  const cellW = dot * 2.6;
  const cellH = dot * 4.2;
  const total = cells.length * cellW;
  ctx.fillStyle = color;
  cells.forEach((dots, i) => {
    const x0 = cx - total / 2 + i * cellW + dot * 0.6;
    const y0 = cy - cellH / 2 + dot * 0.6;
    for (const d of dots) {
      const col = d <= 3 ? 0 : 1;
      const row = (d - 1) % 3;
      ctx.beginPath();
      ctx.arc(x0 + col * dot * 1.4, y0 + row * dot * 1.4, dot * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Illuminated channel letters: halo passes then a crisp gradient core. dimIndex marks one ageing letter. */
function drawGlowText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, px: number, spacingEm: number, o: { core: string; body: string; glow: string; dimIndex: number; weight?: number }): void {
  ctx.font = font(px, o.weight ?? 900, FONT_SANS);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const chars = Array.from(text);
  const sp = px * spacingEm;
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  let letterIdx = 0;
  const grad = ctx.createLinearGradient(0, cy - px * 0.5, 0, cy + px * 0.5);
  grad.addColorStop(0, o.core);
  grad.addColorStop(0.45, o.body);
  grad.addColorStop(1, o.body);
  chars.forEach((ch, i) => {
    const isLetter = /\S/.test(ch);
    const dim = isLetter && letterIdx === o.dimIndex;
    if (isLetter) letterIdx++;
    ctx.save();
    ctx.globalAlpha = dim ? 0.72 : 1;
    ctx.shadowColor = o.glow;
    ctx.shadowBlur = px * 0.45;
    ctx.fillStyle = o.body;
    ctx.fillText(ch, x, cy);
    ctx.fillText(ch, x, cy);
    ctx.shadowBlur = px * 0.14;
    ctx.fillStyle = grad;
    ctx.fillText(ch, x, cy);
    ctx.shadowBlur = 0;
    ctx.fillText(ch, x, cy);
    ctx.restore();
    x += widths[i] + sp;
  });
}

// ---------------------------------------------------------------------------
// Signs
// ---------------------------------------------------------------------------

export function buildSign(text: string, kind: SignKind, width?: number, height?: number): HTMLCanvasElement {
  const [W, H] = resolveSize(kind, width, height);
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const rng = rngFor(`sign:${kind}:${text}`, 1);
  ctx.textBaseline = 'middle';

  switch (kind) {
    case 'room_number': {
      plate(c, rgb(0x2b2f33), { seed: 11 });
      ctx.fillStyle = '#f2f3f4';
      ctx.textAlign = 'center';
      const px = fitFontSize(ctx, [text], W * 0.8, H * 0.52, 10, (p) => font(p, 700, FONT_SANS), 0.02);
      spacedText(ctx, text, W / 2, H * 0.42, px * 0.02);
      braille(ctx, text, W / 2, H * 0.78, H * 0.028, '#f2f3f4');
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(H * 0.05 + 0.5, H * 0.05 + 0.5, W - H * 0.1 - 1, H - H * 0.1 - 1);
      finishSign(c, 12, 0.3);
      break;
    }
    case 'wayfinding': {
      plate(c, rgb(0x20272d), { seed: 21, screws: true });
      const lines = splitLines(text);
      ctx.fillStyle = '#eef0f1';
      ctx.textAlign = 'center';
      const maxPx = lines.length > 1 ? H * 0.28 : H * 0.4;
      const px = fitFontSize(ctx, lines, W * 0.88, maxPx, 8, (p) => font(p, 600, FONT_SANS), 0.09);
      const lh = px * 1.3;
      const y0 = H * 0.46 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, i) => spacedText(ctx, l, W / 2, y0 + i * lh, px * 0.09));
      const rule = Math.max(3, H * 0.03);
      ctx.fillStyle = '#4f8f8b';
      ctx.fillRect(W * 0.04, H - rule - H * 0.07, W * 0.92, rule);
      finishSign(c, 22, 0.4);
      break;
    }
    case 'dept': {
      plate(c, rgb(0xe6e3db), { seed: 31 });
      const bar = W * 0.06;
      ctx.fillStyle = '#3f7f86';
      ctx.fillRect(0, 0, bar, H);
      const lines = splitLines(text);
      const sub = DEPT_SUB[lines[0].toUpperCase()] ?? lines[1];
      ctx.fillStyle = '#1d2024';
      ctx.textAlign = 'left';
      const px = fitFontSize(ctx, [lines[0]], W - bar - W * 0.12, H * (sub ? 0.36 : 0.44), 8, (p) => font(p, 700, FONT_SANS), 0.08);
      spacedText(ctx, lines[0], bar + W * 0.06, sub ? H * 0.42 : H * 0.5, px * 0.08, 'left');
      if (sub) {
        ctx.fillStyle = '#5a6066';
        ctx.font = font(Math.max(8, px * 0.42), 500, FONT_SANS);
        spacedText(ctx, sub, bar + W * 0.06, H * 0.72, px * 0.03, 'left');
      }
      finishSign(c, 32, 0.4);
      break;
    }
    case 'warning': {
      plate(c, rgb(0xf0c020), { seed: 41, screws: true });
      const sh = Math.max(8, H * 0.075);
      stripes(ctx, 0, 0, W, sh, sh * 1.2);
      stripes(ctx, 0, H - sh, W, sh, sh * 1.2);
      const lines = splitLines(text);
      let top = sh;
      const bottom = H - sh;
      const headMatch = lines[0].match(/^(DANGER|CAUTION|WARNING|NOTICE)\b/i);
      if (headMatch) {
        const head = headMatch[1].toUpperCase();
        const rest = lines[0].slice(head.length).trim();
        if (rest) lines[0] = rest;
        else lines.shift();
        const hh = H * 0.27;
        const headCol = head === 'DANGER' ? '#b3261e' : head === 'WARNING' ? '#d9821b' : head === 'NOTICE' ? '#1f3a5f' : '#1f1f1f';
        ctx.fillStyle = headCol;
        ctx.fillRect(W * 0.05, sh + H * 0.03, W * 0.9, hh);
        ctx.fillStyle = head === 'CAUTION' ? '#f0c020' : '#ffffff';
        ctx.font = font(hh * 0.68, 900, FONT_SANS);
        ctx.textAlign = 'center';
        spacedText(ctx, head, W / 2, sh + H * 0.03 + hh / 2, hh * 0.06);
        top = sh + H * 0.03 + hh;
      }
      if (lines.length) {
        ctx.fillStyle = '#141414';
        ctx.textAlign = 'center';
        const avail = bottom - top;
        const maxPx = Math.min(avail / (lines.length * 1.25), H * 0.26);
        const px = fitFontSize(ctx, lines, W * 0.86, maxPx, 8, (p) => font(p, 800, FONT_SANS), 0.07);
        const lh = px * 1.25;
        const y0 = (top + bottom) / 2 - ((lines.length - 1) * lh) / 2;
        lines.forEach((l, i) => spacedText(ctx, l, W / 2, y0 + i * lh, px * 0.07));
      }
      for (let i = 0; i < 10; i++) {
        streak(c, rng, { x: rng.next() * W, y: rng.next() * H, len: rng.range(20, 160), angle: rng.range(0, 6.3), width: 1, color: rng.chance(0.5) ? '#ffffff' : '#3a3010', alpha: rng.range(0.1, 0.25), wrap: false });
      }
      finishSign(c, 42, 0.8);
      break;
    }
    case 'big_red': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1b171c');
      g.addColorStop(1, '#0f0d10');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      mottle(c, { seed: 51, fx: 2, strength: 0.06, blend: 'overlay', res: 32 });
      bevel(ctx, 0, 0, W, H, Math.max(2, H * 0.012), 0.12, 0.5);
      const lines = splitLines(text);
      const px = fitFontSize(ctx, lines, W * 0.9, lines.length > 1 ? H * 0.38 : H * 0.6, 8, (p) => font(p, 900, FONT_SANS), 0.12);
      const lh = px * 1.15;
      const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
      const letters = text.replace(/\s/g, '').length;
      const dim = letters > 4 ? rng.int(0, letters - 1) : -1;
      lines.forEach((l, i) => drawGlowText(ctx, l, W / 2, y0 + i * lh, px, 0.12, { core: '#ff7a68', body: '#ff3b2a', glow: 'rgba(255,60,40,0.9)', dimIndex: dim }));
      grain(c, 0.01, 52);
      break;
    }
    case 'hospital_name': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1d1f22');
      g.addColorStop(1, '#15171a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      mottle(c, { seed: 61, fx: 3, strength: 0.07, blend: 'overlay', res: 48 });
      const lines = splitLines(text);
      const px = fitFontSize(ctx, lines, W * 0.92, lines.length > 1 ? H * 0.34 : H * 0.5, 8, (p) => font(p, 400, FONT_SANS), 0.2);
      const lh = px * 1.3;
      const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
      ctx.textAlign = 'center';
      lines.forEach((l, i) => {
        const y = y0 + i * lh;
        ctx.font = font(px, 400, FONT_SANS);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        spacedText(ctx, l, W / 2 + px * 0.05, y + px * 0.08, px * 0.2);
        const mg = ctx.createLinearGradient(0, y - px / 2, 0, y + px / 2);
        mg.addColorStop(0, '#e6e9eb');
        mg.addColorStop(0.5, '#b9bec2');
        mg.addColorStop(0.52, '#d5d9dc');
        mg.addColorStop(1, '#8d9296');
        ctx.fillStyle = mg;
        spacedText(ctx, l, W / 2, y, px * 0.2);
      });
      grain(c, 0.012, 62);
      break;
    }
    case 'elevator_call': {
      brushedFill(c, 0, 0, W, H, rgb(0xb3b7bb), 71, true, 1);
      bevel(ctx, 0, 0, W, H, 3, 0.3, 0.4);
      const r = W * 0.17;
      const up = text.includes('▲') || !text.includes('▼');
      const down = text.includes('▼') || !text.includes('▲');
      const button = (cy: number, pointUp: boolean): void => {
        const rg = ctx.createRadialGradient(W / 2, cy, r * 0.6, W / 2, cy, r * 1.15);
        rg.addColorStop(0, '#2a2d30');
        rg.addColorStop(0.8, '#3a3e42');
        rg.addColorStop(1, '#8a8f94');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(W / 2, cy, r * 1.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,170,70,0.18)';
        ctx.lineWidth = r * 0.12;
        ctx.beginPath();
        ctx.arc(W / 2, cy, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#cfd3d6';
        ctx.beginPath();
        ctx.arc(W / 2, cy, r * 0.82, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#15171a';
        const s = r * 0.5;
        ctx.beginPath();
        if (pointUp) {
          ctx.moveTo(W / 2, cy - s);
          ctx.lineTo(W / 2 + s * 0.9, cy + s * 0.6);
          ctx.lineTo(W / 2 - s * 0.9, cy + s * 0.6);
        } else {
          ctx.moveTo(W / 2, cy + s);
          ctx.lineTo(W / 2 + s * 0.9, cy - s * 0.6);
          ctx.lineTo(W / 2 - s * 0.9, cy - s * 0.6);
        }
        ctx.closePath();
        ctx.fill();
      };
      if (up) button(H * 0.33, true);
      if (down) button(H * 0.57, false);
      const py = H * 0.8;
      ctx.fillStyle = '#23262a';
      ctx.fillRect(W * 0.12, py - H * 0.05, W * 0.76, H * 0.1);
      bevel(ctx, W * 0.12, py - H * 0.05, W * 0.76, H * 0.1, 1, 0.3, 0.4);
      ctx.fillStyle = '#e8eaec';
      ctx.textAlign = 'center';
      ctx.font = font(H * 0.026, 700, FONT_COND);
      spacedText(ctx, 'IN CASE OF FIRE', W / 2, py - H * 0.018, 1);
      spacedText(ctx, 'USE STAIRS', W / 2, py + H * 0.02, 1);
      for (const [sx, sy] of [[W * 0.1, H * 0.05], [W * 0.9, H * 0.05], [W * 0.1, H * 0.95], [W * 0.9, H * 0.95]]) screwHead(ctx, sx, sy, W * 0.02, 1);
      for (let i = 0; i < 5; i++) blob(c, W / 2 + rng.range(-40, 40), rng.range(H * 0.25, H * 0.65), rng.range(10, 20), rgb(0x3a3c40), 0.08, { blend: 'multiply', hard: 0.2, wrap: false });
      finishSign(c, 72, 0.3);
      break;
    }
    case 'exit': {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a2b2e');
      g.addColorStop(1, '#141517');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      bevel(ctx, 0, 0, W, H, Math.max(2, H * 0.02), 0.2, 0.5);
      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(W * 0.06, H * 0.12, W * 0.88, H * 0.76);
      const t = text.replace(/[←→]/g, '').trim() || 'EXIT';
      const left = text.includes('←');
      const right = text.includes('→');
      const px = fitFontSize(ctx, [t], W * (left || right ? 0.6 : 0.76), H * 0.56, 8, (p) => font(p, 900, FONT_SANS), 0.1);
      ctx.textAlign = 'center';
      drawGlowText(ctx, t, W / 2 + (left ? W * 0.07 : 0) - (right ? W * 0.07 : 0), H / 2, px, 0.1, { core: '#ff8a78', body: '#ff2a1e', glow: 'rgba(255,50,30,0.9)', dimIndex: -1 });
      const chevron = (x: number, dir: number): void => {
        ctx.save();
        ctx.shadowColor = 'rgba(255,50,30,0.9)';
        ctx.shadowBlur = H * 0.08;
        ctx.fillStyle = '#ff2a1e';
        const s = H * 0.14;
        ctx.beginPath();
        ctx.moveTo(x + dir * s, H / 2);
        ctx.lineTo(x, H / 2 - s);
        ctx.lineTo(x, H / 2 + s);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };
      if (left) chevron(W * 0.2, -1);
      if (right) chevron(W * 0.8, 1);
      grain(c, 0.01, 82);
      break;
    }
  }
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Posters & boards
// ---------------------------------------------------------------------------

const INK = '#1b1e22';
const INK_SOFT = '#4a515a';
const INK_FAINT = '#7a8088';
const M_BLUE = 'rgba(31,63,143,0.9)';
const M_BLACK = 'rgba(35,37,42,0.9)';
const M_RED = 'rgba(179,38,30,0.92)';
const M_GREEN = 'rgba(46,125,79,0.9)';

export function buildPoster(kind: string, seed: number): HTMLCanvasElement {
  const rng = rngFor(`poster:${kind}`, seed);
  switch (kind) {
    case 'handwash':
      return posterHandwash(rng);
    case 'flu':
      return posterFlu(rng);
    case 'rights':
      return posterRights(rng);
    case 'stroke':
      return posterStroke(rng);
    case 'pain_scale':
      return posterPain(rng);
    case 'schedule':
      return boardSchedule(rng);
    case 'notices':
      return boardNotices(rng);
    case 'assignments':
      return boardAssignments(rng);
    case 'evs_schedule':
      return boardEvs(rng);
    default:
      return posterGeneric(kind, rng);
  }
}

function paperBase(W: number, H: number, rng: RNG, base = 0xf3f0e7): Canvas2D {
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const sn = rng.int(1, 1e9);
  ctx.fillStyle = css(rgb(base));
  ctx.fillRect(0, 0, W, H);
  mottle(c, { seed: sn, fx: 2, strength: 0.05, blend: 'multiply', res: 32 });
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  return c;
}

function tape(ctx: CanvasRenderingContext2D, x: number, y: number, rng: RNG, vertical = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((vertical ? Math.PI / 2 : 0) + rng.range(-0.08, 0.08));
  ctx.fillStyle = 'rgba(255,250,230,0.55)';
  ctx.fillRect(-28, -7, 56, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(-28, 6, 56, 2);
  ctx.restore();
}

function paperFinish(c: Canvas2D, rng: RNG): void {
  const { ctx, w, h } = c;
  const sn = rng.int(1, 1e9);
  if (rng.chance(0.7)) tape(ctx, w * 0.5, 8, rng);
  if (rng.chance(0.5)) tape(ctx, 12, h * 0.5, rng, true);
  if (rng.chance(0.5)) tape(ctx, w - 12, h * 0.5, rng, true);
  vband(ctx, 0, w, h - 40, h, rgb(0x6a6660), 0, 0.1);
  for (let i = 0; i < 3; i++) blob(c, rng.next() * w, rng.next() * h, rng.range(20, 50), rgb(0x55504a), rng.range(0.03, 0.06), { blend: 'multiply', hard: 0.2, wrap: false });
  grain(c, 0.012, sn);
}

function printed(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, weight = 600, align: Align = 'left', family = FONT_SANS): void {
  ctx.font = font(px, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Dry-erase marker handwriting with a tiny random tilt. */
function marker(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, color: string, rng: RNG, align: Align = 'left', tilt = 0.012): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng.range(-tilt, tilt));
  ctx.font = font(px, 400, FONT_HAND);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function handIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, step: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  rrect(ctx, -r * 0.42, -r * 0.1, r * 0.84, r * 0.95, r * 0.25);
  ctx.stroke();
  for (let i = 0; i < 4; i++) {
    const fx = -r * 0.36 + i * r * 0.24;
    const fh = r * (0.55 + (i === 1 || i === 2 ? 0.15 : 0));
    rrect(ctx, fx, -r * 0.1 - fh, r * 0.18, fh + r * 0.1, r * 0.09);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-r * 0.42, r * 0.2);
  ctx.quadraticCurveTo(-r * 0.9, -r * 0.1, -r * 0.7, -r * 0.5);
  ctx.stroke();
  if (step === 0) {
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(r * 0.6 + i * 4, -r * 0.8 + i * 10, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (step === 1 || step === 2) {
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(-r * 0.2 + i * r * 0.14, -r * 0.95 - (i % 2) * 6, 3 + (i % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  if (step === 4) {
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(r * 0.5, -r * 0.9 + i * 8);
      ctx.lineTo(r * 0.5 + 6, -r * 0.7 + i * 8);
      ctx.stroke();
    }
  }
  if (step === 5) {
    rrect(ctx, r * 0.45, -r * 0.6, r * 0.5, r * 0.9, 2);
    ctx.stroke();
  }
  ctx.restore();
}

function posterHandwash(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng);
  const { ctx } = c;
  const teal = '#2f7f86';
  ctx.fillStyle = teal;
  ctx.fillRect(0, 0, W, 118);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = font(34, 800, FONT_SANS);
  spacedText(ctx, 'CLEAN HANDS', W / 2, 46, 3);
  spacedText(ctx, 'SAVE LIVES', W / 2, 86, 3);
  ctx.fillStyle = '#2b2f33';
  ctx.font = font(15, 500, FONT_SANS);
  paragraph(ctx, 'Wash with soap and water for at least 20 seconds. Use alcohol-based hand rub when hands are not visibly soiled.', W / 2, 150, W - 70, 20);
  const steps = ['Wet hands with warm water', 'Apply enough soap to cover', 'Lather palms, backs and wrists', 'Scrub between fingers and under nails', 'Rinse thoroughly', 'Dry with a single-use towel'];
  steps.forEach((s, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = W * 0.28 + col * W * 0.44;
    const cy = 262 + row * 150;
    ctx.strokeStyle = teal;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.stroke();
    handIcon(ctx, cx, cy, 28, teal, i);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx - 34, cy - 34, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = teal;
    ctx.beginPath();
    ctx.arc(cx - 34, cy - 34, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = font(14, 800, FONT_SANS);
    ctx.fillText(String(i + 1), cx - 34, cy - 33);
    ctx.fillStyle = '#2b2f33';
    ctx.font = font(13, 600, FONT_SANS);
    paragraph(ctx, s, cx, cy + 62, 190, 16);
  });
  ctx.fillStyle = teal;
  ctx.fillRect(0, H - 54, W, 54);
  printed(ctx, 'Infection Prevention & Control · Ext. 4411', W / 2, H - 34, 12, '#e9f3f3', 500, 'center');
  printed(ctx, 'St. Augustine Regional Medical Center · Rev. 03/2024', W / 2, H - 16, 10, 'rgba(233,243,243,0.7)', 400, 'center');
  paperFinish(c, rng);
  return c.canvas;
}

function syringeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.7);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.strokeRect(-size * 0.3, -size * 0.1, size * 0.6, size * 0.2);
  ctx.fillRect(-size * 0.3, -size * 0.1, size * 0.25, size * 0.2);
  ctx.fillRect(-size * 0.5, -size * 0.04, size * 0.2, size * 0.08);
  ctx.fillRect(-size * 0.55, -size * 0.14, size * 0.05, size * 0.28);
  ctx.fillRect(size * 0.3, -size * 0.015, size * 0.25, size * 0.03);
  ctx.restore();
}

function posterFlu(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng, 0xf4f3ee);
  const { ctx } = c;
  const navy = '#1f3a5f';
  ctx.fillStyle = navy;
  ctx.fillRect(0, 0, W, 150);
  printed(ctx, 'FLU SEASON', 32, 58, 40, '#ffffff', 800);
  printed(ctx, 'IS HERE.', 32, 104, 40, '#ffffff', 800);
  printed(ctx, 'Get your flu shot.', 32, 200, 30, INK, 700);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(15, 500, FONT_SANS);
  ctx.textAlign = 'left';
  paragraph(ctx, 'Vaccination is the best protection for you, your patients and your family. It takes about two weeks to build immunity, so earlier is better.', 32, 240, W - 170, 21);
  syringeIcon(ctx, W - 100, 240, 80, navy);
  const bullets = ['Free for staff, patients and visitors', 'Ask at Registration or Employee Health — Ext. 2290', 'Cover your cough. Clean your hands.', 'Stay home if you have a fever'];
  let y = 350;
  for (const b of bullets) {
    ctx.fillStyle = navy;
    ctx.beginPath();
    ctx.arc(44, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = font(16, 600, FONT_SANS);
    y = paragraph(ctx, b, 62, y, W - 100, 22) + 16;
  }
  ctx.fillStyle = '#e3eaf3';
  ctx.fillRect(32, 560, W - 64, 110);
  ctx.fillStyle = navy;
  ctx.fillRect(32, 560, 6, 110);
  printed(ctx, 'STAFF CLINIC', 54, 584, 14, navy, 700);
  ctx.fillStyle = '#2b3138';
  ctx.font = font(14, 500, FONT_SANS);
  ctx.textAlign = 'left';
  textRows(ctx, ['Thursdays 14:00 – 18:00 · Staff Lounge', 'Bring your badge. Walk-ins welcome.', 'Declination forms due Nov 1.'], 54, 610, 20);
  printed(ctx, 'St. Augustine Regional Medical Center · Employee Health · Public health advisory, updated annually', 32, H - 24, 10, INK_FAINT, 400);
  paperFinish(c, rng);
  return c.canvas;
}

function seal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(r * 0.5, 800, FONT_SANS);
  ctx.fillText('SA', cx, cy - r * 0.05);
  ctx.font = font(r * 0.2, 600, FONT_SANS);
  ctx.fillText('RMC · 1962', cx, cy + r * 0.38);
  ctx.restore();
}

function posterRights(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng, 0xf6f4ee);
  const { ctx } = c;
  const slate = '#3a4a5c';
  ctx.fillStyle = slate;
  ctx.fillRect(0, 0, W, 96);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(22, 800, FONT_SANS);
  spacedText(ctx, 'PATIENT RIGHTS', 28, 36, 2, 'left');
  spacedText(ctx, '& RESPONSIBILITIES', 28, 66, 2, 'left');
  seal(ctx, W - 60, 48, 34);
  const rights = [
    'Considerate, respectful care in a safe setting, free from abuse, neglect and discrimination.',
    'Know the names and roles of the people treating you.',
    'Receive information about your diagnosis, treatment and prognosis in terms you can understand.',
    'Participate in decisions about your care and refuse treatment to the extent permitted by law.',
    'Privacy and confidentiality of your medical record.',
    'An interpreter or communication aid at no charge.',
    'Have your pain assessed and managed.',
    'Designate a support person and decide who may visit you.',
    'Voice a complaint without fear of reprisal and receive a timely response.',
  ];
  const resp = [
    'Provide accurate and complete information about your health, medications and allergies.',
    'Ask questions when you do not understand instructions or your plan of care.',
    'Follow the treatment plan agreed with your care team, or tell us if you cannot.',
    'Be considerate of other patients, visitors and staff, and respect hospital property.',
    'Keep appointments or notify us when you cannot.',
    'Provide information for insurance and meet financial obligations promptly.',
  ];
  const colW = (W - 70) / 2;
  printed(ctx, 'YOU HAVE THE RIGHT TO:', 28, 124, 11.5, '#2a2f36', 700);
  ctx.fillStyle = '#33383f';
  ctx.font = font(10.5, 400, FONT_SANS);
  ctx.textAlign = 'left';
  let y = 142;
  rights.forEach((t, i) => {
    y = paragraph(ctx, `${i + 1}. ${t}`, 28, y, colW, 13.5) + 6;
  });
  printed(ctx, 'YOUR RESPONSIBILITIES:', 28 + colW + 14, 124, 11.5, '#2a2f36', 700);
  ctx.fillStyle = '#33383f';
  ctx.font = font(10.5, 400, FONT_SANS);
  ctx.textAlign = 'left';
  let y2 = 142;
  resp.forEach((t, i) => {
    y2 = paragraph(ctx, `${i + 1}. ${t}`, 28 + colW + 14, y2, colW, 13.5) + 6;
  });
  ctx.fillStyle = slate;
  ctx.fillRect(28, H - 92, W - 56, 1);
  printed(ctx, 'Questions or concerns?  Patient Relations · Ext. 3100 · Office B-114, Mon–Fri 8–5', 28, H - 72, 11, '#2a2f36', 600);
  ctx.fillStyle = INK_FAINT;
  ctx.font = font(9.5, 400, FONT_SANS);
  ctx.textAlign = 'left';
  paragraph(ctx, 'This notice is provided in accordance with state and federal requirements. Interpreter services are available at no cost. Available in large print and other languages on request.', 28, H - 52, W - 56, 12);
  paperFinish(c, rng);
  return c.canvas;
}

function posterStroke(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng, 0xf5f3ef);
  const { ctx } = c;
  const red = '#b3261e';
  const blue = '#1f3a5f';
  ctx.fillStyle = red;
  ctx.fillRect(0, 0, W, 86);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = font(26, 800, FONT_SANS);
  spacedText(ctx, 'STROKE IS AN EMERGENCY', W / 2, 43, 3);
  const items: [string, string, string][] = [
    ['B', 'BALANCE', 'Sudden loss of balance or coordination'],
    ['E', 'EYES', 'Sudden blurred, double or lost vision'],
    ['F', 'FACE', 'One side of the face droops when smiling'],
    ['A', 'ARMS', 'One arm drifts down when both are raised'],
    ['S', 'SPEECH', 'Slurred, strange or missing words'],
    ['T', 'TIME', 'Call 911 immediately. Note the time symptoms started.'],
  ];
  items.forEach(([l, h, d], i) => {
    const y = 130 + i * 92;
    ctx.fillStyle = i === 5 ? red : blue;
    rrect(ctx, 30, y - 32, 64, 64, 8);
    ctx.fill();
    printed(ctx, l, 62, y + 2, 42, '#ffffff', 900, 'center');
    ctx.fillStyle = INK;
    ctx.font = font(20, 800, FONT_SANS);
    spacedText(ctx, h, 112, y - 14, 2, 'left');
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(13.5, 500, FONT_SANS);
    ctx.textAlign = 'left';
    paragraph(ctx, d, 112, y + 12, W - 140, 17);
  });
  printed(ctx, 'Every minute, nearly two million brain cells are lost.', W / 2, H - 56, 15, INK, 700, 'center');
  printed(ctx, 'Primary Stroke Center · Neurology Service · St. Augustine Regional', W / 2, H - 28, 10, INK_FAINT, 400, 'center');
  paperFinish(c, rng);
  return c.canvas;
}

function faceIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, pain: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  const tone = mix(rgb(0xf3d9a4), rgb(0xe6b088), pain);
  ctx.fillStyle = css(tone);
  ctx.strokeStyle = '#2a2f36';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const eyeY = -r * 0.25;
  ctx.fillStyle = '#2a2f36';
  if (pain > 0.75) {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * r * 0.5, eyeY - 4);
      ctx.lineTo(sx * r * 0.2, eyeY + 2);
      ctx.stroke();
    }
  } else {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * r * 0.36, eyeY, r * 0.08 + pain * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (pain > 0.35) {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * r * 0.52, eyeY - r * 0.35 + pain * 4);
      ctx.lineTo(sx * r * 0.2, eyeY - r * 0.25 - pain * 6);
      ctx.stroke();
    }
  }
  const curve = (0.5 - pain) * 2;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-r * 0.45, r * 0.38 - curve * r * 0.1);
  ctx.quadraticCurveTo(0, r * 0.38 + curve * r * 0.5, r * 0.45, r * 0.38 - curve * r * 0.1);
  ctx.stroke();
  if (pain >= 0.95) {
    ctx.fillStyle = '#4a90d9';
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(sx * r * 0.42, r * 0.05, 4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function posterPain(rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng, 0xf6f5f0);
  const { ctx } = c;
  ctx.fillStyle = '#2f7f86';
  ctx.fillRect(0, 0, W, 90);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = font(30, 800, FONT_SANS);
  spacedText(ctx, 'RATE YOUR PAIN', W / 2, 45, 4);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(14, 500, FONT_SANS);
  paragraph(ctx, 'Point to the face or number that best describes how much you hurt right now.', W / 2, 122, W - 80, 19);
  const levels = [0, 2, 4, 6, 8, 10];
  const labels = ['No pain', 'Mild', 'Moderate', 'Severe', 'Very severe', 'Worst possible'];
  const g = ctx.createLinearGradient(40, 0, W - 40, 0);
  g.addColorStop(0, '#3fa65b');
  g.addColorStop(0.5, '#f2c230');
  g.addColorStop(1, '#c62828');
  ctx.fillStyle = g;
  rrect(ctx, 40, 560, W - 80, 16, 8);
  ctx.fill();
  levels.forEach((lv, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const cx = 92 + col * 164;
    const cy = 240 + row * 160;
    faceIcon(ctx, cx, cy, 44, lv / 10);
    printed(ctx, String(lv), cx, cy + 74, 26, INK, 800, 'center');
    printed(ctx, labels[i], cx, cy + 96, 12.5, INK_SOFT, 600, 'center');
  });
  printed(ctx, '0', 40, 596, 11.5, INK_SOFT, 600, 'left');
  printed(ctx, '10', W - 40, 596, 11.5, INK_SOFT, 600, 'right');
  printed(ctx, 'Tell your nurse if your pain is not controlled.', W / 2, 650, 15, INK, 700, 'center');
  printed(ctx, 'Pain Management Committee · Form PM-14 · Rev. 2023', W / 2, H - 28, 10, INK_FAINT, 400, 'center');
  paperFinish(c, rng);
  return c.canvas;
}

function posterGeneric(kind: string, rng: RNG): HTMLCanvasElement {
  const W = 512;
  const H = 768;
  const c = paperBase(W, H, rng);
  const { ctx } = c;
  ctx.fillStyle = '#3a4a5c';
  ctx.fillRect(0, 0, W, 100);
  const title = kind.replace(/[_-]+/g, ' ').toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  const px = fitFontSize(ctx, [title], W - 60, 32, 14, (p) => font(p, 800, FONT_SANS), 0.06);
  spacedText(ctx, title, W / 2, 50, px * 0.06);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(14, 500, FONT_SANS);
  ctx.textAlign = 'left';
  let y = 140;
  for (const p of [
    'Please read this notice carefully. It applies to all patients, visitors and staff in the Emergency Department.',
    'If you have questions, ask any member of your care team. Interpreter services are available at no cost.',
    'Report hazards, spills or safety concerns to the charge nurse or Facilities at extension 2200.',
  ]) {
    y = paragraph(ctx, p, 32, y, W - 64, 20) + 18;
  }
  printed(ctx, 'St. Augustine Regional Medical Center', W / 2, H - 28, 10, INK_FAINT, 400, 'center');
  paperFinish(c, rng);
  return c.canvas;
}

// --- boards ----------------------------------------------------------------

function whiteboard(W: number, H: number, rng: RNG): Canvas2D {
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const sn = rng.int(1, 1e9);
  ctx.fillStyle = '#f3f4f1';
  ctx.fillRect(0, 0, W, H);
  mottle(c, { seed: sn, fx: 3, strength: 0.04, blend: 'multiply', res: 48 });
  // ghosting of erased marker
  ctx.lineCap = 'round';
  for (let i = 0; i < 30; i++) {
    ctx.strokeStyle = `rgba(60,70,110,${rng.range(0.02, 0.06)})`;
    ctx.lineWidth = rng.range(2, 5);
    const x = rng.range(40, W - 40);
    const y = rng.range(40, H - 40);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rng.range(-120, 120), y + rng.range(-8, 8));
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) blob(c, rng.next() * W, rng.next() * H, rng.range(40, 120), rgb(0x8890a8), rng.range(0.03, 0.06), { squash: 0.3, rot: rng.range(-0.3, 0.3), hard: 0.2, wrap: false, blend: 'multiply' });
  const al = rgb(0xb8bcc0);
  brushedFill(c, 0, 0, W, 10, al, sn + 1, false, 0.8);
  brushedFill(c, 0, H - 10, W, 10, al, sn + 2, false, 0.8);
  brushedFill(c, 0, 0, 10, H, al, sn + 3, true, 0.8);
  brushedFill(c, W - 10, 0, 10, H, al, sn + 4, true, 0.8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(10, 10, W - 20, 2);
  ctx.fillRect(10, 10, 2, H - 20);
  ctx.textBaseline = 'middle';
  return c;
}

function magnet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 7);
  g.addColorStop(0, '#4a4f55');
  g.addColorStop(1, '#15171a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
}

function stickyNote(ctx: CanvasRenderingContext2D, rng: RNG, x: number, y: number, w: number, h: number, color: string, lines: string[], rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  lines.forEach((l, i) => marker(ctx, l, -w / 2 + 12, -h / 2 + 24 + i * 26, i === 0 ? 20 : 17, M_BLACK, rng));
  ctx.restore();
}

function boardSchedule(rng: RNG): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const c = whiteboard(W, H, rng);
  const { ctx } = c;
  const sx = 60;
  const sy = 50;
  const sw = 640;
  const sh = 400;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(sx + 4, sy + 6, sw, sh);
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(sx, sy, sw, sh);
  printed(ctx, 'EMERGENCY DEPARTMENT — NIGHT SHIFT SCHEDULE', sx + 16, sy + 24, 15, INK, 800);
  printed(ctx, 'Week of October 6 · 19:00 – 07:00 · Charge: K. Whitfield · Staffing office x3340', sx + 16, sy + 46, 11, '#5a6066', 500);
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const rows: [string, string][] = [
    ['Charge RN', 'K. Whitfield'],
    ['RN', 'D. Morales'],
    ['RN', 'S. Tran'],
    ['RN (float)', 'A. Petrov'],
    ['ED Tech', 'R. Gill'],
    ['Unit Clerk', 'M. Hale'],
    ['Security', 'R. Dunn'],
    ['EVS', 'P. Reyes'],
  ];
  const pattern = [
    ['N', 'N', 'N', '—', '—', 'N', 'N'],
    ['N', 'N', '—', '—', 'N', 'N', 'N'],
    ['—', 'N', 'N', 'N', '—', '—', 'N'],
    ['N', '—', '—', 'N', 'N', '—', '—'],
    ['N', 'N', 'N', 'N', '—', '—', '—'],
    ['N', 'N', 'N', '—', 'N', 'N', '—'],
    ['N', '—', 'N', '—', 'N', '—', 'N'],
    ['N', 'N', 'N', 'N', 'N', '—', '—'],
  ];
  const gx = sx + 16;
  const gy = sy + 70;
  const nameW = 200;
  const cellW = (sw - 32 - nameW) / 7;
  const rowH = 36;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  for (let r = 0; r <= rows.length; r++) {
    ctx.beginPath();
    ctx.moveTo(gx, gy + r * rowH + 0.5);
    ctx.lineTo(gx + nameW + cellW * 7, gy + r * rowH + 0.5);
    ctx.stroke();
  }
  for (let d = 0; d <= 7; d++) {
    const x = gx + nameW + d * cellW + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gy - 18);
    ctx.lineTo(x, gy + rows.length * rowH);
    ctx.stroke();
  }
  days.forEach((d, i) => printed(ctx, d, gx + nameW + i * cellW + cellW / 2, gy - 9, 10, INK, 700, 'center'));
  rows.forEach(([role, name], r) => {
    const y = gy + r * rowH + rowH / 2;
    printed(ctx, role, gx + 6, y - 7, 9, '#6b7178', 500);
    printed(ctx, name, gx + 6, y + 8, 12, INK, 700);
    pattern[r].forEach((v, d) => printed(ctx, v, gx + nameW + d * cellW + cellW / 2, y, 12, v === 'N' ? INK : '#a0a5aa', 600, 'center'));
  });
  // Dana's Monday circled and struck through
  const dx = gx + nameW + cellW / 2;
  const dy = gy + rowH + rowH / 2;
  ctx.strokeStyle = M_RED;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(dx, dy, cellW * 0.42, rowH * 0.42, 0.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(dx - 12, dy - 8);
  ctx.lineTo(dx + 12, dy + 9);
  ctx.stroke();
  marker(ctx, 'Dana — OUT 10/6 (sick)', sx + sw + 24, sy + 70, 26, M_RED, rng);
  marker(ctx, '→ S. Tran covering', sx + sw + 34, sy + 110, 24, M_RED, rng);
  marker(ctx, 'thank you Susie!!', sx + sw + 44, sy + 146, 20, M_BLUE, rng);
  marker(ctx, 'Pharmacy on-call: x4120', sx + sw + 24, sy + 250, 22, M_BLACK, rng);
  marker(ctx, 'Pt fridge cleaned Fri', sx + sw + 24, sy + 290, 20, 'rgba(35,37,42,0.7)', rng);
  stickyNote(ctx, rng, sx + sw + 150, sy + 370, 160, 110, '#f6e27a', ['COFFEE FUND', '$2 / cup', 'not optional :)'], -0.06);
  for (const [mx, my] of [[sx + 20, sy + 6], [sx + sw - 20, sy + 6], [sx + sw / 2, sy + sh - 6]]) magnet(ctx, mx, my);
  grain(c, 0.01, 7);
  return c.canvas;
}

function pin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, 6, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - 2, y - 2, 1, x, y, 6);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function paperNote(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, color: string, title: string, body: string[], pinColor: string, hand = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.06)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1e2126';
  ctx.font = font(Math.min(15, w * 0.075), 800, hand ? FONT_HAND : FONT_SANS);
  let yy = -h / 2 + 22;
  const lines = wrapText(ctx, title, w - 24);
  textRows(ctx, lines, -w / 2 + 12, yy, 17);
  yy += lines.length * 17 + 4;
  ctx.fillStyle = '#3a3f46';
  ctx.font = font(hand ? Math.min(13, w * 0.065) : Math.min(10.5, w * 0.052), 400, hand ? FONT_HAND : FONT_SANS);
  for (const b of body) {
    yy = paragraph(ctx, b, -w / 2 + 12, yy, w - 24, hand ? 15 : 13) + 3;
    if (yy > h / 2 - 10) break;
  }
  pin(ctx, 0, -h / 2 + 8, pinColor);
  ctx.restore();
}

function boardNotices(rng: RNG): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const c = makeCanvas(W, H);
  const { ctx } = c;
  const sn = rng.int(1, 1e9);
  ctx.fillStyle = '#3c4247';
  ctx.fillRect(0, 0, W, H);
  mottle(c, { seed: sn, fx: 4, strength: 0.12, blend: 'overlay', res: 96 });
  modifyPixels(c, 0, 0, W, H, (px, py, d, i) => {
    const n = (hash2(px, py, sn + 1) - 0.5) * 18;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  });
  ctx.fillStyle = '#23272b';
  ctx.fillRect(0, 0, W, 54);
  ctx.fillStyle = '#e8eaec';
  ctx.font = font(20, 800, FONT_SANS);
  ctx.textBaseline = 'middle';
  spacedText(ctx, 'NOTICES', 30, 27, 4, 'left');
  printed(ctx, 'St. Augustine Regional · Emergency Department · Please do not remove postings', W - 30, 27, 11, '#9aa1a8', 500, 'right');
  const notes: [number, number, number, number, number, string, string, string[], string, boolean?][] = [
    [150, 170, 230, 190, -0.03, '#f4f1e8', 'VISITING HOURS', ['Daily 8:00 AM – 8:00 PM.', 'After 10 PM: one support person per patient. Please check in at Registration and wear your visitor badge at all times.'], '#c62828'],
    [400, 160, 230, 170, 0.02, '#fbe9b8', 'PARKING — GARAGE B LEVEL 2 CLOSED', ['Resurfacing Oct 7–9. Use Level 3 or the surface lot off Mercer St.', 'Shuttle runs every 15 minutes from the main entrance.'], '#1f3f8f'],
    [660, 165, 220, 180, -0.015, '#dbe8f3', 'STAFF FLU CLINIC', ['Thursday 14:00 – 18:00 · Staff Lounge.', 'Bring your badge. Declination forms due Nov 1 to Employee Health.'], '#2e7d4f'],
    [880, 170, 200, 160, 0.04, '#f4f1e8', 'LOST: grey cardigan', ['Left in Exam 2 on 10/3. Sentimental value.', 'Please call ext. 4100 — thank you!'], '#c62828', true],
    [220, 380, 260, 150, 0.015, '#e9d7e8', 'QUIET PLEASE', ['Patients are resting. Keep voices low in the hallway after 10 PM and silence phones in treatment areas.'], '#1f3f8f'],
    [560, 385, 300, 170, -0.02, '#fbe9b8', 'WEST WING RENOVATION — RESTRICTED', ['Contractor access via the service corridor only.', 'Hard hats and respirators required beyond the barrier. Abatement schedule pending — Facilities, ext. 2200.'], '#c62828'],
    [860, 390, 200, 140, 0.03, '#f4f1e8', 'ED Potluck — Oct 18', ['Sign up in the lounge. No seafood this time (we remember).'], '#2e7d4f', true],
  ];
  for (const [x, y, w, h, rot, color, title, body, pc, hand] of notes) paperNote(ctx, x, y, w, h, rot, color, title, body, pc, hand);
  const al = rgb(0x8d9298);
  brushedFill(c, 0, 0, W, 12, al, sn + 2, false, 0.8);
  brushedFill(c, 0, H - 12, W, 12, al, sn + 3, false, 0.8);
  brushedFill(c, 0, 0, 12, H, al, sn + 4, true, 0.8);
  brushedFill(c, W - 12, 0, 12, H, al, sn + 5, true, 0.8);
  grain(c, 0.012, sn + 9);
  return c.canvas;
}

function boardAssignments(rng: RNG): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const c = whiteboard(W, H, rng);
  const { ctx } = c;
  printed(ctx, 'ED PATIENT ASSIGNMENTS', 36, 42, 22, INK, 800);
  marker(ctx, 'DATE  10/6', 540, 42, 26, M_BLACK, rng);
  marker(ctx, 'CHARGE: K. Whitfield (off floor — Peds)', 690, 42, 20, 'rgba(35,37,42,0.85)', rng);
  const cols: [string, number][] = [['BAY', 60], ['PATIENT', 230], ['AGE/SEX', 80], ['CHIEF COMPLAINT / PLAN', 330], ['RN', 110], ['MD', 110]];
  const gx = 36;
  const gy = 70;
  const rowH = 46;
  const rows = ['1', '2', '3', '4', '5', 'TRI', 'WR'];
  const totalW = cols.reduce((a, col) => a + col[1], 0);
  ctx.fillStyle = '#dfe3e6';
  ctx.fillRect(gx, gy, totalW, 26);
  let x = gx;
  cols.forEach(([name, w]) => {
    printed(ctx, name, x + 8, gy + 13, 11, '#2a2f36', 700);
    x += w;
  });
  ctx.strokeStyle = 'rgba(40,45,55,0.5)';
  ctx.lineWidth = 1.2;
  for (let r = 0; r <= rows.length; r++) {
    const y = gy + 26 + r * rowH + 0.5;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + totalW, y);
    ctx.stroke();
  }
  x = gx;
  for (let i = 0; i <= cols.length; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, gy);
    ctx.lineTo(x + 0.5, gy + 26 + rows.length * rowH);
    ctx.stroke();
    if (i < cols.length) x += cols[i][1];
  }
  rows.forEach((r, i) => printed(ctx, r, gx + 30, gy + 26 + i * rowH + rowH / 2, 16, '#2a2f36', 800, 'center'));
  const entry = (row: number, col: number, text: string, color: string, px = 19): void => {
    const cx = gx + cols.slice(0, col).reduce((a, cc) => a + cc[1], 0) + 10;
    const cy = gy + 26 + row * rowH + rowH / 2;
    marker(ctx, text, cx, cy, px, color, rng);
  };
  entry(1, 1, 'ALVAREZ, R.', M_BLUE);
  entry(1, 2, '58 F', M_BLUE);
  entry(1, 3, 'chest pain — obs, repeat trop 00:30', M_BLUE, 17);
  entry(1, 4, 'S. TRAN', M_BLUE);
  entry(1, 5, 'Osei', M_BLUE);
  entry(3, 1, 'OKAFOR, D.', M_BLUE);
  entry(3, 2, '42 M', M_BLUE);
  entry(3, 3, 'lac L hand — sutures pending', M_BLUE, 17);
  entry(3, 4, 'S. TRAN', M_BLUE);
  entry(3, 5, 'Osei', M_BLUE);
  entry(6, 1, 'MERCER, J.', M_BLACK);
  entry(6, 2, '34 M', M_BLACK);
  entry(6, 3, 'HA / dizziness / visual change — to triage', M_BLACK, 17);
  entry(6, 4, '—', M_BLACK);
  entry(5, 3, 'see tracking board', 'rgba(35,37,42,0.6)', 16);
  for (const r of [0, 2, 4]) entry(r, 1, '—', M_BLACK);
  marker(ctx, 'Covering: S. TRAN for D. MORALES (called out)', 40, H - 70, 24, M_RED, rng);
  marker(ctx, 'Census: 3   Holds: 0   Boarding: 0', 40, H - 36, 20, M_BLACK, rng);
  marker(ctx, 'Imaging CLOSED overnight → call CT on-call x4455', 560, H - 70, 20, M_GREEN, rng);
  marker(ctx, 'West wing: NO ENTRY (Facilities)', 560, H - 36, 20, M_BLACK, rng);
  grain(c, 0.01, 9);
  return c.canvas;
}

function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = '#b3261e';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-s / 2, -s / 2, s, s);
  ctx.restore();
  ctx.fillStyle = '#1b1e22';
  ctx.beginPath();
  ctx.moveTo(cx - 5, cy - 6);
  ctx.lineTo(cx + 1, cy + 2);
  ctx.lineTo(cx + 5, cy + 6);
  ctx.lineTo(cx - 1, cy + 1);
  ctx.closePath();
  ctx.fill();
}

function boardEvs(rng: RNG): HTMLCanvasElement {
  const W = 1024;
  const H = 512;
  const c = whiteboard(W, H, rng);
  const { ctx } = c;
  printed(ctx, 'ENVIRONMENTAL SERVICES — NIGHT ROUTE', 36, 42, 22, INK, 800);
  printed(ctx, 'ED / Service Level · Initial each task · Report hazards to Facilities x2200', 36, 66, 11, '#5a6066', 500);
  const tasks: [string, string, boolean][] = [
    ['22:30', 'Waiting room + public restrooms', true],
    ['23:00', 'Exam 1–5 terminal clean (vacant bays only)', true],
    ['23:45', 'Service corridor — sweep & mop', false],
    ['00:15', 'Nurse station / staff lounge', false],
    ['01:00', 'Trash & soiled linen run → dock', false],
    ['01:30', 'Ambulance bay — pressure wash if dry', false],
    ['02:00', 'Restock: towels, soap, sanitizer', false],
  ];
  tasks.forEach(([t, task, done], i) => {
    const y = 110 + i * 40;
    ctx.strokeStyle = '#2a2f36';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(40, y - 11, 22, 22);
    if (done) {
      ctx.strokeStyle = M_BLUE;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(44, y);
      ctx.lineTo(50, y + 7);
      ctx.lineTo(60, y - 9);
      ctx.stroke();
      marker(ctx, 'PR', 520, y, 20, M_BLUE, rng);
    }
    printed(ctx, t, 76, y, 14, INK, 700);
    printed(ctx, task, 130, y, 14, '#2a2f36', 500);
  });
  ctx.strokeStyle = M_RED;
  ctx.lineWidth = 4;
  ctx.strokeRect(600, 100, 390, 150);
  marker(ctx, 'WEST WING: NO ENTRY', 620, 135, 30, 'rgba(179,38,30,0.95)', rng);
  marker(ctx, 'asbestos abatement pending', 620, 178, 22, M_RED, rng);
  marker(ctx, 'do NOT reset the breaker — J.R. 9/28', 620, 216, 20, M_RED, rng);
  marker(ctx, 'Gen room: mop leak by drain (again!)', 610, 300, 22, M_BLACK, rng);
  marker(ctx, 'Cart #3 — wheel sticking', 610, 340, 22, 'rgba(35,37,42,0.85)', rng);
  marker(ctx, 'Wet floor signs: 4 → where are the others??', 610, 380, 20, 'rgba(35,37,42,0.8)', rng);
  const sx = 640;
  const sy = 400;
  const sw = 330;
  const sh = 95;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(sx + 3, sy + 4, sw, sh);
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(sx, sy, sw, sh);
  printed(ctx, 'SAFETY DATA SHEET — Quaternary Disinfectant Conc.', sx + 10, sy + 16, 10, INK, 700);
  ctx.fillStyle = '#5a6066';
  ctx.font = font(8, 400, FONT_SANS);
  ctx.textAlign = 'left';
  paragraph(ctx, 'Hazard: causes serious eye damage. Wear eye protection and gloves. Dilute 1:64 for routine cleaning; 1:32 for terminal clean. Do not mix with bleach. First aid: rinse eyes for 15 minutes and seek medical attention.', sx + 10, sy + 34, sw - 70, 10.5);
  diamond(ctx, sx + sw - 30, sy + 45, 20);
  tape(ctx, sx + 30, sy - 2, rng);
  tape(ctx, sx + sw - 30, sy - 2, rng);
  grain(c, 0.01, 11);
  return c.canvas;
}
