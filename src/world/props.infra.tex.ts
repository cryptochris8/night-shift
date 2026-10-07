/**
 * Canvas art for the infra props (part A): vending machine faces, clock dials and LED digits,
 * channel-letter masks, small LCD panels and gauge dials. Deterministic: every function seeds
 * its own stream from its arguments, never from Math.random.
 */
import { type Cnv, FONT_COND, FONT_MONO, FONT_SANS, blotches, fitFont, fontStr, makeCnv, pick, roundRect, rr, seeded, spaced, speckle } from './props.infra.util';

const SNACK_COLORS = ['#b8332a', '#cf7f17', '#2a6fa8', '#2f8f4e', '#6f3a8a', '#d6b11c', '#6b3f1d', '#1f2a33', '#b02a5a', '#3a8f8f'];
const SNACK_WORDS = ['CRUNCH', 'SALTED', 'BBQ', 'ZESTY', 'TWIST', 'CHIPS', 'OATS', 'MINTS', 'CHOCO', 'PEAK', 'JUMBO', 'CRISP', 'NUTS', 'TRAIL', 'GUMMY', 'WAFER'];
const DRINK_LIQUIDS = ['#3b1c0e', '#c46a12', '#c9d27a', '#cfe3ee', '#8a4b12', '#a3122a', '#e7e1c4', '#2b6f2b'];

function snack(ctx: CanvasRenderingContext2D, rnd: () => number, cx: number, base: number, w: number, h: number): void {
  const kind = rnd();
  const col = pick(rnd, SNACK_COLORS);
  const pw = w * rr(rnd, 0.62, 0.78);
  const ph = h * rr(rnd, 0.55, 0.72);
  const x = cx - pw / 2;
  const y = base - ph - 4;
  ctx.save();
  if (kind < 0.55) {
    // chip bag: crimped ends, a band and a burst
    ctx.fillStyle = col;
    roundRect(ctx, x, y + 6, pw, ph - 12, 10);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < pw; i += 6) {
      ctx.fillRect(x + i, y, 3, 8);
      ctx.fillRect(x + i, y + ph - 8, 3, 8);
    }
    ctx.fillStyle = pick(rnd, ['#f2e6c8', '#ffffff', '#1d1d1d', '#e8c23a']);
    ctx.beginPath();
    ctx.ellipse(cx, y + ph * 0.58, pw * 0.34, ph * 0.2, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(x + pw * 0.1, y + ph * 0.12, pw * 0.08, ph * 0.7);
  } else if (kind < 0.8) {
    // candy bar standing in the coil
    ctx.fillStyle = col;
    ctx.fillRect(x + pw * 0.18, y + ph * 0.08, pw * 0.64, ph * 0.92);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + pw * 0.18, y + ph * 0.08, pw * 0.64, 5);
    ctx.fillStyle = '#f4ecd8';
    ctx.fillRect(x + pw * 0.22, y + ph * 0.42, pw * 0.56, ph * 0.18);
  } else {
    // cookie / cracker box with a window
    ctx.fillStyle = col;
    ctx.fillRect(x + pw * 0.06, y + ph * 0.16, pw * 0.88, ph * 0.84);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(x + pw * 0.2, y + ph * 0.5, pw * 0.6, ph * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + pw * 0.2, y + ph * 0.5, pw * 0.6, 3);
  }
  const word = pick(rnd, SNACK_WORDS);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 3;
  const px = fitFont(ctx, [word], pw * 0.86, 22, 900, FONT_COND);
  ctx.textAlign = 'center';
  ctx.strokeText(word, cx, y + ph * 0.3);
  ctx.fillText(word, cx, y + ph * 0.3);
  ctx.font = fontStr(px * 0.55, 600, FONT_SANS);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(pick(rnd, ['ORIGINAL', 'FAMILY', 'LIGHT', 'SPICY', 'CLASSIC']), cx, y + ph * 0.82);
  ctx.restore();
}

function coil(ctx: CanvasRenderingContext2D, cx: number, base: number, w: number, h: number): void {
  const ry = h * 0.36;
  const cy = base - ry - 2;
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(70,74,78,0.9)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, cy + 2, w * 0.43, ry, 0, Math.PI * 0.05, Math.PI * 0.95);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(214,218,222,0.95)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.43, ry, 0, Math.PI * 0.02, Math.PI * 0.98);
  ctx.stroke();
  ctx.restore();
}

function bottle(ctx: CanvasRenderingContext2D, rnd: () => number, cx: number, base: number, w: number, h: number, can: boolean): void {
  const liquid = pick(rnd, DRINK_LIQUIDS);
  const label = pick(rnd, SNACK_COLORS);
  ctx.save();
  if (can) {
    const cw = w * 0.62;
    const ch = h * 0.52;
    const x = cx - cw / 2;
    const y = base - ch - 4;
    const g = ctx.createLinearGradient(x, 0, x + cw, 0);
    g.addColorStop(0, label);
    g.addColorStop(0.35, '#ffffff');
    g.addColorStop(0.5, label);
    g.addColorStop(1, '#202020');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.92;
    ctx.fillRect(x, y + 6, cw, ch - 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#b7bcc0';
    ctx.fillRect(x + 2, y, cw - 4, 7);
  } else {
    const bw = w * 0.5;
    const bh = h * rr(rnd, 0.68, 0.78);
    const x = cx - bw / 2;
    const y = base - bh - 4;
    const neck = bw * 0.36;
    ctx.fillStyle = pick(rnd, ['#d23a2a', '#1f5fa8', '#f2f2f2', '#2c8a3c', '#e2b21c']);
    ctx.fillRect(cx - neck / 2 - 1, y, neck + 2, bh * 0.07);
    ctx.fillStyle = 'rgba(220,230,235,0.55)';
    ctx.fillRect(cx - neck / 2, y + bh * 0.07, neck, bh * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx - neck / 2, y + bh * 0.19);
    ctx.quadraticCurveTo(x, y + bh * 0.24, x, y + bh * 0.36);
    ctx.lineTo(x, base - 6);
    ctx.quadraticCurveTo(x, base - 4, x + 6, base - 4);
    ctx.lineTo(x + bw - 6, base - 4);
    ctx.quadraticCurveTo(x + bw, base - 4, x + bw, base - 6);
    ctx.lineTo(x + bw, y + bh * 0.36);
    ctx.quadraticCurveTo(x + bw, y + bh * 0.24, cx + neck / 2, y + bh * 0.19);
    ctx.closePath();
    ctx.fillStyle = liquid;
    ctx.globalAlpha = 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = label;
    ctx.fillRect(x, y + bh * 0.45, bw, bh * 0.28);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = fontStr(bw * 0.3, 900, FONT_COND);
    ctx.textAlign = 'center';
    ctx.fillText(pick(rnd, ['COLA', 'FIZZ', 'AQUA', 'TEA', 'LIME', 'ORNG', 'SPRT']), cx, y + bh * 0.59);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x + bw * 0.12, y + bh * 0.25, bw * 0.1, bh * 0.68);
  }
  ctx.restore();
}

/** Product window of a vending machine (512 x 1024). Rows end with a dark price rail. */
export function drawVendingProducts(kind: 'snacks' | 'drinks'): Cnv {
  const c = makeCnv(512, 1024);
  const { ctx } = c;
  const rnd = seeded(`vend:${kind}`);
  const bg = ctx.createLinearGradient(0, 0, 512, 0);
  bg.addColorStop(0, '#7f868c');
  bg.addColorStop(0.8, '#c3cace');
  bg.addColorStop(1, '#e9eff1');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 1024);
  const rows = kind === 'snacks' ? 6 : 5;
  const cols = kind === 'snacks' ? 5 : 6;
  const rowH = 1024 / rows;
  const colW = 512 / cols;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH;
    const rail = y0 + rowH - 24;
    const sh = ctx.createLinearGradient(0, y0, 0, y0 + rowH * 0.35);
    sh.addColorStop(0, 'rgba(0,0,0,0.38)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, y0, 512, rowH * 0.35);
    for (let col = 0; col < cols; col++) {
      const cx = col * colW + colW / 2;
      const empty = rnd() < (kind === 'snacks' ? 0.16 : 0.12);
      if (kind === 'snacks') {
        if (!empty) snack(ctx, rnd, cx, rail, colW, rowH);
        coil(ctx, cx, rail, colW, rowH);
      } else if (!empty) {
        bottle(ctx, rnd, cx, rail, colW, rowH, r === rows - 1);
      }
    }
    ctx.fillStyle = '#1c1f23';
    ctx.fillRect(0, rail, 512, 24);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(0, rail, 512, 2);
    ctx.font = fontStr(13, 700, FONT_MONO);
    ctx.textAlign = 'center';
    for (let col = 0; col < cols; col++) {
      const price = kind === 'snacks' ? pick(rnd, ['1.25', '1.50', '1.75', '2.00']) : pick(rnd, ['2.25', '2.50', '2.75']);
      ctx.fillStyle = '#f2f2ee';
      ctx.fillRect(col * colW + 8, rail + 5, colW - 16, 14);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(`${String.fromCharCode(65 + r)}${col + 1}  ${price}`, col * colW + colW / 2, rail + 12.5);
    }
  }
  blotches(c, rnd, 10, '20,22,24', 0.25, 30, 90);
  return c;
}

/** Front control column (192 x 1216): header band, labels and a pair of tired stickers. */
export function drawVendingColumn(kind: 'snacks' | 'drinks'): Cnv {
  const W = 192;
  const H = 1216;
  const c = makeCnv(W, H);
  const { ctx } = c;
  const rnd = seeded(`vendcol:${kind}`);
  ctx.fillStyle = '#25282c';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(255,255,255,${(0.015 + rnd() * 0.02).toFixed(3)})`;
    ctx.fillRect(0, rnd() * H, W, 1);
  }
  const band = kind === 'snacks' ? '#b8332a' : '#1f5fa8';
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, W, 150);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.textAlign = 'center';
  const title = kind === 'snacks' ? 'SNACKS' : 'COLD DRINKS';
  fitFont(ctx, [title], W * 0.86, 38, 900, FONT_COND, 0.06);
  spaced(ctx, title, W / 2, 62, 2);
  ctx.font = fontStr(14, 600, FONT_SANS);
  ctx.fillText(kind === 'snacks' ? 'FRESH · FAST · 24 HRS' : 'ICE COLD · 24 HRS', W / 2, 108);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(0, 146, W, 4);
  // recesses the 3D parts sit in
  ctx.fillStyle = '#121416';
  roundRect(ctx, 14, 168, W - 28, 92, 6);
  ctx.fill();
  roundRect(ctx, 14, 280, W - 28, 250, 8);
  ctx.fill();
  ctx.fillStyle = '#c9ccd0';
  ctx.font = fontStr(13, 700, FONT_SANS);
  ctx.fillText('1  INSERT MONEY', W / 2, 552);
  ctx.fillText('2  ENTER SELECTION', W / 2, 574);
  ctx.font = fontStr(11, 600, FONT_SANS);
  ctx.fillText('COINS          BILLS  $1  $5', W / 2, 612);
  ctx.fillText('CARDS  /  TAP TO PAY', W / 2, 772);
  // stickers
  ctx.save();
  ctx.translate(W / 2, 840);
  ctx.rotate(-0.05);
  ctx.fillStyle = '#d8c23a';
  ctx.fillRect(-74, -22, 148, 44);
  ctx.fillStyle = '#1a1a1a';
  ctx.font = fontStr(16, 900, FONT_COND);
  ctx.fillText('EXACT CHANGE', 0, -6);
  ctx.fillText('ONLY', 0, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(62, -22);
  ctx.lineTo(74, -22);
  ctx.lineTo(74, -10);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2, 925);
  ctx.rotate(0.03);
  ctx.fillStyle = '#e9e6dc';
  ctx.fillRect(-80, -30, 160, 60);
  ctx.fillStyle = '#2a2a2a';
  ctx.font = fontStr(11, 700, FONT_SANS);
  ctx.fillText('FOR SERVICE OR REFUNDS', 0, -14);
  ctx.fillText('CALL 1-800-555-0148', 0, 2);
  ctx.font = fontStr(9, 500, FONT_SANS);
  ctx.fillText('MACHINE ID  ED-0219', 0, 18);
  ctx.restore();
  blotches(c, rnd, 6, '120,110,90', 0.18, 20, 40, { x: 20, y: 820, w: 150, h: 140 });
  // kick marks and coin-hand grime
  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = `rgba(10,10,10,${(0.2 + rnd() * 0.3).toFixed(2)})`;
    ctx.lineWidth = rr(rnd, 1, 3);
    const x = rnd() * W;
    const y = H - rr(rnd, 10, 170);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + rr(rnd, -30, 30), y + rr(rnd, -4, 4));
    ctx.stroke();
  }
  blotches(c, rnd, 12, '200,200,190', 0.06, 10, 30, { x: 0, y: 600, w: W, h: 200 });
  speckle(c, rnd, 500, '255,255,255', 0.08);
  return c;
}

/** Selection keypad (160 x 200): letters and digits, the busiest keys worn darker. */
export function drawKeypad(): Cnv {
  const c = makeCnv(160, 200);
  const { ctx } = c;
  ctx.fillStyle = '#16181b';
  ctx.fillRect(0, 0, 160, 200);
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const worn = new Set(['A', 'B', '1', '2', '4']);
  ctx.textAlign = 'center';
  keys.forEach((key, i) => {
    const x = 10 + (i % 4) * 36;
    const y = 10 + Math.floor(i / 4) * 36;
    ctx.fillStyle = worn.has(key) ? '#8e9194' : '#b9bcbf';
    roundRect(ctx, x, y, 32, 30, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 2, y + 27, 28, 3);
    ctx.fillStyle = '#121314';
    ctx.font = fontStr(16, 800, FONT_SANS);
    ctx.fillText(key, x + 16, y + 15);
  });
  ctx.fillStyle = '#a33a2c';
  roundRect(ctx, 10, 158, 68, 30, 5);
  ctx.fill();
  ctx.fillStyle = '#3f8f52';
  roundRect(ctx, 82, 158, 68, 30, 5);
  ctx.fill();
  ctx.fillStyle = '#f0f0f0';
  ctx.font = fontStr(12, 800, FONT_SANS);
  ctx.fillText('CLEAR', 44, 173);
  ctx.fillText('ENTER', 116, 173);
  return c;
}

/** Small red dot-matrix message panel (256 x 64). */
export function drawDotMatrix(text: string, color = '#ff3a22'): Cnv {
  const c = makeCnv(256, 64);
  const { ctx } = c;
  ctx.fillStyle = '#0b0303';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.textAlign = 'center';
  fitFont(ctx, [text], 236, 26, 700, FONT_MONO);
  ctx.fillText(text, 128, 33);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  for (let x = 0; x < 256; x += 3) ctx.fillRect(x, 0, 1, 64);
  for (let y = 0; y < 64; y += 3) ctx.fillRect(0, y, 256, 1);
  return c;
}

/** Analog wall clock dial (512 x 512): 12h numerals, a small red 24h ring, minute track, dust. */
export function drawClockFace(): Cnv {
  const S = 512;
  const c = makeCnv(S, S);
  const { ctx } = c;
  const rnd = seeded('clockface');
  const cx = S / 2;
  const g = ctx.createRadialGradient(cx, cx, S * 0.1, cx, cx, S * 0.5);
  g.addColorStop(0, '#f5f3ec');
  g.addColorStop(0.85, '#ece8dc');
  g.addColorStop(1, '#d9d3c2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#1b1c1e';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const major = i % 5 === 0;
    const r0 = S * (major ? 0.395 : 0.42);
    const r1 = S * 0.455;
    ctx.lineWidth = major ? 7 : 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * r0, cx - Math.cos(a) * r0);
    ctx.lineTo(cx + Math.sin(a) * r1, cx - Math.cos(a) * r1);
    ctx.stroke();
  }
  ctx.fillStyle = '#18191b';
  ctx.textAlign = 'center';
  ctx.font = fontStr(S * 0.085, 600, FONT_SANS);
  for (let h = 1; h <= 12; h++) {
    const a = (h / 12) * Math.PI * 2;
    ctx.fillText(String(h), cx + Math.sin(a) * S * 0.325, cx - Math.cos(a) * S * 0.325 + 2);
  }
  ctx.fillStyle = '#a3261d';
  ctx.font = fontStr(S * 0.036, 600, FONT_SANS);
  for (let h = 13; h <= 24; h++) {
    const a = (h / 12) * Math.PI * 2;
    ctx.fillText(String(h), cx + Math.sin(a) * S * 0.245, cx - Math.cos(a) * S * 0.245 + 1);
  }
  ctx.fillStyle = '#3a3c40';
  ctx.font = fontStr(S * 0.03, 700, FONT_SANS);
  spaced(ctx, 'MERIDIAN', cx, cx - S * 0.13, 3);
  ctx.font = fontStr(S * 0.022, 500, FONT_SANS);
  spaced(ctx, 'SYNCHRONOUS', cx, cx + S * 0.15, 2);
  blotches(c, rnd, 14, '120,100,60', 0.07, 30, 90);
  const v = ctx.createRadialGradient(cx, cx, S * 0.3, cx, cx, S * 0.52);
  v.addColorStop(0, 'rgba(60,50,30,0)');
  v.addColorStop(1, 'rgba(60,50,30,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, S, S);
  return c;
}

const SEGS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', ' ': '',
};

function segPath(ctx: CanvasRenderingContext2D, seg: string, x: number, y: number, w: number, h: number, t: number, skew: number): void {
  const half = h / 2;
  const P = (px: number, py: number): [number, number] => [x + px + (half - py) * skew, y + py];
  let pts: [number, number][] = [];
  const hz = (yy: number): [number, number][] => [P(t * 0.6, yy), P(t * 1.1, yy - t / 2), P(w - t * 1.1, yy - t / 2), P(w - t * 0.6, yy), P(w - t * 1.1, yy + t / 2), P(t * 1.1, yy + t / 2)];
  const vt = (xx: number, y0: number, y1: number): [number, number][] => [P(xx, y0 + t * 0.6), P(xx + t / 2, y0 + t * 1.1), P(xx + t / 2, y1 - t * 1.1), P(xx, y1 - t * 0.6), P(xx - t / 2, y1 - t * 1.1), P(xx - t / 2, y0 + t * 1.1)];
  switch (seg) {
    case 'a': pts = hz(t / 2); break;
    case 'g': pts = hz(half); break;
    case 'd': pts = hz(h - t / 2); break;
    case 'f': pts = vt(t / 2, 0, half); break;
    case 'b': pts = vt(w - t / 2, 0, half); break;
    case 'e': pts = vt(t / 2, half, h); break;
    case 'c': pts = vt(w - t / 2, half, h); break;
  }
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

/**
 * Red seven-segment clock face into an existing 512 x 160 canvas. `text` like ' 9:05' or '12:00';
 * unlit segments stay faintly visible as on a real display.
 */
export function drawLedClock(c: Cnv, text: string, o: { lit: boolean; colon: boolean; pm: boolean }): void {
  const { ctx } = c;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d0404';
  ctx.fillRect(0, 0, c.w, c.h);
  const digits = text.replace(':', '').padStart(4, ' ').slice(-4);
  const xs = [52, 152, 282, 382];
  const w = 82;
  const h = 122;
  const y = 19;
  const t = 15;
  const ghost = '#2b0806';
  const on = '#ff2e1c';
  digits.split('').forEach((d, i) => {
    const lit = o.lit ? SEGS[d] ?? '' : '';
    for (const seg of 'abcdefg') {
      segPath(ctx, seg, xs[i], y, w, h, t, 0.1);
      const isOn = lit.includes(seg);
      ctx.fillStyle = isOn ? on : ghost;
      ctx.shadowColor = 'rgba(255,40,20,0.85)';
      ctx.shadowBlur = isOn ? 14 : 0;
      ctx.fill();
    }
  });
  ctx.shadowBlur = 0;
  const dot = (cx: number, cy: number, lit: boolean): void => {
    ctx.fillStyle = lit ? on : ghost;
    ctx.shadowBlur = lit ? 10 : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  };
  dot(255, 58, o.lit && o.colon);
  dot(249, 104, o.lit && o.colon);
  dot(26, 128, o.lit && o.pm);
  ctx.fillStyle = o.lit && o.pm ? '#b52a1c' : '#2b0806';
  ctx.font = fontStr(13, 700, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText('PM', 26, 148);
}

export interface LetterBox {
  ch: string;
  /** uv rect (v up) of the glyph inside the mask */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * White-on-black letter mask for cut-out signage (alphaMap + alphaTest) plus the uv box of every
 * glyph, so a sign can be built from per-letter quads (one of them can then misbehave on its own).
 */
export function drawLetterMask(text: string, W: number, H: number, weight: number, spacingEm: number, family = FONT_SANS): { cnv: Cnv; boxes: LetterBox[] } {
  const c = makeCnv(W, H);
  const { ctx } = c;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);
  const px = fitFont(ctx, [text], W * 0.97, H * 0.86, weight, family, spacingEm);
  const sp = px * spacingEm;
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + sp * Math.max(0, chars.length - 1);
  let x = (W - total) / 2;
  const cy = H / 2;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  const boxes: LetterBox[] = [];
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, cy);
    if (/\S/.test(ch)) {
      const m = ctx.measureText(ch);
      const asc = m.actualBoundingBoxAscent || px * 0.4;
      const desc = m.actualBoundingBoxDescent || px * 0.4;
      const pad = px * 0.06;
      const x0 = Math.max(0, x - pad);
      const x1 = Math.min(W, x + widths[i] + pad);
      const y0 = Math.max(0, cy - asc - pad);
      const y1 = Math.min(H, cy + desc + pad);
      boxes.push({ ch, u0: x0 / W, u1: x1 / W, v0: 1 - y1 / H, v1: 1 - y0 / H });
    }
    x += widths[i] + sp;
  });
  return { cnv: c, boxes };
}

/** Backlit LCD / VFD panel with a few lines of text. */
export function drawLcd(lines: string[], o: { w?: number; h?: number; fg?: string; bg?: string; glow?: boolean; family?: string } = {}): Cnv {
  const W = o.w ?? 256;
  const H = o.h ?? 96;
  const c = makeCnv(W, H);
  const { ctx } = c;
  const bg = o.bg ?? '#9db08f';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(0,0,0,0.18)');
  v.addColorStop(0.2, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  const n = Math.max(1, lines.length);
  const lh = (H * 0.84) / n;
  ctx.fillStyle = o.fg ?? '#1d2a1c';
  if (o.glow) {
    ctx.shadowColor = o.fg ?? '#1d2a1c';
    ctx.shadowBlur = 5;
  }
  ctx.textAlign = 'left';
  fitFont(ctx, lines, W * 0.9, lh * 0.8, 700, o.family ?? FONT_MONO);
  lines.forEach((l, i) => ctx.fillText(l, W * 0.05, H * 0.08 + lh * (i + 0.5)));
  ctx.shadowBlur = 0;
  return c;
}

/** Round instrument dial (128 x 128) sweeping 270 degrees; the needle is geometry. */
export function drawGauge(label: string, max: number, red = 0.85, green: [number, number] = [0.3, 0.75]): Cnv {
  const S = 128;
  const c = makeCnv(S, S);
  const { ctx } = c;
  const cx = S / 2;
  ctx.fillStyle = '#1a1b1d';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#efede6';
  ctx.beginPath();
  ctx.arc(cx, cx, S * 0.46, 0, Math.PI * 2);
  ctx.fill();
  const a0 = Math.PI * 0.75;
  const span = Math.PI * 1.5;
  const arc = (f0: number, f1: number, col: string): void => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cx, S * 0.36, a0 + span * f0, a0 + span * f1);
    ctx.stroke();
  };
  arc(green[0], green[1], '#3d8a4a');
  arc(red, 1, '#b3261e');
  ctx.strokeStyle = '#1b1b1b';
  for (let i = 0; i <= 20; i++) {
    const a = a0 + (span * i) / 20;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? 2.2 : 1;
    const r0 = S * (major ? 0.31 : 0.34);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * S * 0.4, cx + Math.sin(a) * S * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'center';
  ctx.font = fontStr(10, 700, FONT_SANS);
  for (let i = 0; i <= 4; i++) {
    const a = a0 + (span * i) / 4;
    ctx.fillText(String(Math.round((max * i) / 4)), cx + Math.cos(a) * S * 0.23, cx + Math.sin(a) * S * 0.23);
  }
  ctx.font = fontStr(9, 700, FONT_COND);
  ctx.fillText(label, cx, cx + S * 0.3);
  return c;
}

/** Needle angle (radians about +z, dial facing +z) for a 0..1 reading on drawGauge's 270 degree sweep. */
export function gaugeAngle(f: number): number {
  const a = Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0, Math.min(1, f));
  // canvas angles run clockwise with y down; the needle mesh points along +x at angle 0
  return -a;
}
