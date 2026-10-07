/**
 * Shared helpers for the procedural texture factory: seeded tileable noise, canvas
 * setup, colour maths, wrapped drawing and signage typography. DOM-only — never
 * imported by the node test suite.
 */
import { RNG, hashString } from '../core/rng';

// ---------------------------------------------------------------------------
// Fonts (system stacks; Bahnschrift is the DIN-like face present on Windows 10+)
// ---------------------------------------------------------------------------

export const FONT_SANS = '"Bahnschrift", "DIN Alternate", "Franklin Gothic Medium", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const FONT_COND = '"Bahnschrift SemiCondensed", "Bahnschrift", "Arial Narrow", "Franklin Gothic Medium", "Segoe UI", Arial, sans-serif';
export const FONT_MONO = '"Cascadia Mono", Consolas, "JetBrains Mono", "SF Mono", Menlo, monospace';
export const FONT_HAND = '"Segoe Print", "Bradley Hand", "Segoe Script", "Comic Sans MS", cursive';
export const FONT_SERIF = 'Georgia, Cambria, "Times New Roman", serif';

export const font = (px: number, weight: number | string = 400, family = FONT_SANS): string => `${weight} ${Math.max(1, Math.round(px))}px ${family}`;

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export interface Canvas2D {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export function makeCanvas(w: number, h: number): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('[textures] 2D canvas context unavailable');
  return { canvas, ctx, w: canvas.width, h: canvas.height };
}

/** Independent deterministic stream per texture + seed. */
export function rngFor(label: string, seed: number): RNG {
  return new RNG(hashString(`tex:${label}:${seed}`));
}

// ---------------------------------------------------------------------------
// Maths / colour
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const rgb = (hex: number): RGB => ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });

export function css(c: RGB | number, a = 1): string {
  const k = typeof c === 'number' ? rgb(c) : c;
  return `rgba(${clamp(Math.round(k.r), 0, 255)},${clamp(Math.round(k.g), 0, 255)},${clamp(Math.round(k.b), 0, 255)},${clamp01(a)})`;
}

export const mix = (a: RGB, b: RGB, t: number): RGB => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });
export const mul = (c: RGB, f: number): RGB => ({ r: c.r * f, g: c.g * f, b: c.b * f });
/** amt > 0 lightens toward white, < 0 darkens toward black. */
export const shade = (c: RGB, amt: number): RGB => (amt >= 0 ? mix(c, { r: 255, g: 255, b: 255 }, amt) : mix(c, { r: 0, g: 0, b: 0 }, -amt));
export const luma = (c: RGB): number => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;

// ---------------------------------------------------------------------------
// Seeded, tileable noise
// ---------------------------------------------------------------------------

/** Integer lattice hash → [0,1). Cheap and well distributed. */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Value noise in cell units; the lattice wraps every px × py cells so results tile. */
export function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

/** Tileable fbm over u,v ∈ [0,1). fx/fy = base cells per repeat (integers). Output ≈ 0..1. */
export function fbm(u: number, v: number, fx: number, fy: number, octaves: number, seed: number, gain = 0.5): number {
  let cx = Math.max(1, Math.round(fx));
  let cy = Math.max(1, Math.round(fy));
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * cx, v * cy, cx, cy, seed + o * 101);
    norm += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Pixel layers
// ---------------------------------------------------------------------------

export type PixelFn = (x: number, y: number, out: Float32Array) => void;

/** Replace the whole canvas with per-pixel output (out = r,g,b,a 0..255; a defaults to 255). */
export function fillPixels(c: Canvas2D, fn: PixelFn): void {
  const img = c.ctx.createImageData(c.w, c.h);
  const d = img.data;
  const out = new Float32Array(4);
  let i = 0;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 255;
      fn(x, y, out);
      d[i++] = out[0];
      d[i++] = out[1];
      d[i++] = out[2];
      d[i++] = out[3];
    }
  }
  c.ctx.putImageData(img, 0, 0);
}

/** Per-pixel modification of a rectangle of the existing canvas. px/py are canvas coords. */
export function modifyPixels(c: Canvas2D, x: number, y: number, w: number, h: number, fn: (px: number, py: number, d: Uint8ClampedArray, i: number) => void): void {
  const rx = clamp(Math.floor(x), 0, c.w);
  const ry = clamp(Math.floor(y), 0, c.h);
  const rw = clamp(Math.ceil(w), 0, c.w - rx);
  const rh = clamp(Math.ceil(h), 0, c.h - ry);
  if (rw <= 0 || rh <= 0) return;
  const img = c.ctx.getImageData(rx, ry, rw, rh);
  const d = img.data;
  let i = 0;
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++, i += 4) fn(rx + xx, ry + yy, d, i);
  }
  c.ctx.putImageData(img, rx, ry);
}

export interface MottleOpts {
  seed: number;
  /** base cells across (integer, tileable) */
  fx?: number;
  fy?: number;
  octaves?: number;
  /** evaluation resolution (upscaled → soft) */
  res?: number;
  /** contrast of the layer */
  strength?: number;
  alpha?: number;
  blend?: GlobalCompositeOperation;
  /** when given, draws this colour with noise-driven alpha instead of grey overlay */
  color?: RGB;
  /** alpha bias for coloured layers */
  bias?: number;
  gain?: number;
}

/** Soft low-frequency cloudiness, tileable, drawn through a blend mode. */
export function mottle(c: Canvas2D, o: MottleOpts): void {
  const fx = Math.max(1, Math.round(o.fx ?? 4));
  const fy = Math.max(1, Math.round(o.fy ?? (fx * c.h) / c.w));
  const rw = Math.max(4, Math.round(o.res ?? 96));
  const rh = Math.max(4, Math.round((rw * c.h) / c.w));
  const small = makeCanvas(rw + 2, rh + 2);
  const img = small.ctx.createImageData(rw + 2, rh + 2);
  const d = img.data;
  const strength = o.strength ?? 0.2;
  const col = o.color;
  const blend = o.blend ?? (col ? 'source-over' : 'overlay');
  let i = 0;
  for (let y = 0; y < rh + 2; y++) {
    const v = ((((y - 1) % rh) + rh) % rh) / rh;
    for (let x = 0; x < rw + 2; x++) {
      const u = ((((x - 1) % rw) + rw) % rw) / rw;
      const n = fbm(u, v, fx, fy, o.octaves ?? 4, o.seed, o.gain ?? 0.5);
      if (col) {
        d[i++] = col.r;
        d[i++] = col.g;
        d[i++] = col.b;
        d[i++] = clamp01((n - 0.5) * 2 * strength + (o.bias ?? 0)) * 255;
      } else {
        // neutral value depends on the blend: multiply darkens from white, screen lightens from black
        let g: number;
        if (blend === 'multiply' || blend === 'darken') g = 255 * (1 - strength * (1 - n));
        else if (blend === 'screen' || blend === 'lighten' || blend === 'lighter') g = 255 * strength * n;
        else g = 128 + (n - 0.5) * 2 * strength * 255;
        d[i++] = g;
        d[i++] = g;
        d[i++] = g;
        d[i++] = 255;
      }
    }
  }
  small.ctx.putImageData(img, 0, 0);
  const { ctx } = c;
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small.canvas, 1, 1, rw, rh, 0, 0, c.w, c.h);
  ctx.restore();
}

/** Fine per-pixel grain. amount = peak deviation as a fraction of 255. */
export function grain(c: Canvas2D, amount: number, seed: number, mono = true): void {
  const img = c.ctx.getImageData(0, 0, c.w, c.h);
  const d = img.data;
  const a = amount * 255;
  let i = 0;
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++, i += 4) {
      if (d[i + 3] === 0) continue;
      const n = (hash2(x, y, seed) - 0.5) * a;
      if (mono) {
        d[i] += n;
        d[i + 1] += n;
        d[i + 2] += n;
      } else {
        d[i] += n;
        d[i + 1] += (hash2(x, y, seed + 1) - 0.5) * a;
        d[i + 2] += (hash2(x, y, seed + 2) - 0.5) * a;
      }
    }
  }
  c.ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Wrapped / tileable vector drawing
// ---------------------------------------------------------------------------

/** Runs fn once per translation needed so a mark of radius r at (x,y) also appears across the wrap edges. */
export function wrapped(c: Canvas2D, x: number, y: number, r: number, fn: () => void): void {
  const dx = [0];
  if (x - r < 0) dx.push(c.w);
  if (x + r > c.w) dx.push(-c.w);
  const dy = [0];
  if (y - r < 0) dy.push(c.h);
  if (y + r > c.h) dy.push(-c.h);
  for (const ox of dx) {
    for (const oy of dy) {
      c.ctx.save();
      c.ctx.translate(ox, oy);
      fn();
      c.ctx.restore();
    }
  }
}

export interface StreakOpts {
  x: number;
  y: number;
  len: number;
  angle: number;
  width: number;
  color: string;
  alpha: number;
  /** 0..1 bend */
  curve?: number;
  wrap?: boolean;
  blend?: GlobalCompositeOperation;
}

/** A slightly curved, jittered stroke — scuffs, heel marks, mop streaks, drips. */
export function streak(c: Canvas2D, rng: RNG, o: StreakOpts): void {
  const { ctx } = c;
  const segs = 7;
  const bend = (o.curve ?? 0.35) * (rng.next() - 0.5) * 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = o.angle + bend * (t - 0.5);
    const d = o.len * t;
    const j = (rng.next() - 0.5) * o.width * 0.5;
    pts.push([o.x + Math.cos(a) * d + Math.cos(a + Math.PI / 2) * j, o.y + Math.sin(a) * d + Math.sin(a + Math.PI / 2) * j]);
  }
  const draw = (): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = o.alpha;
    if (o.blend) ctx.globalCompositeOperation = o.blend;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const mx = o.x + (Math.cos(o.angle) * o.len) / 2;
  const my = o.y + (Math.sin(o.angle) * o.len) / 2;
  if (o.wrap === false) draw();
  else wrapped(c, mx, my, o.len / 2 + o.width + 4, draw);
}

export interface BlobOpts {
  blend?: GlobalCompositeOperation;
  /** y radius as a fraction of r */
  squash?: number;
  rot?: number;
  /** 0..1 inner plateau before the fade */
  hard?: number;
  wrap?: boolean;
}

/** Soft radial stain / highlight. */
export function blob(c: Canvas2D, x: number, y: number, r: number, color: RGB, alpha: number, o: BlobOpts = {}): void {
  const { ctx } = c;
  const draw = (): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(o.rot ?? 0);
    ctx.scale(1, o.squash ?? 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, css(color, alpha));
    g.addColorStop(clamp01(o.hard ?? 0.3), css(color, alpha));
    g.addColorStop(1, css(color, 0));
    ctx.globalCompositeOperation = o.blend ?? 'source-over';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  if (o.wrap === false) draw();
  else wrapped(c, x, y, r, draw);
}

/** Irregular closed outline (puddles, stains, patches) as a reusable Path2D in canvas space. */
export function blobPath2D(rng: RNG, cx: number, cy: number, r: number, o: { points?: number; rough?: number; squash?: number; rot?: number } = {}): Path2D {
  const n = o.points ?? 18;
  const rough = o.rough ?? 0.25;
  const seed = rng.int(1, 1e9);
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const nz = vnoise(a * 4, 0.5, 4, 1, seed) * 2 - 1;
    radii.push(r * (1 + rough * nz + (rng.next() - 0.5) * rough * 0.4));
  }
  const rot = o.rot ?? 0;
  const sq = o.squash ?? 1;
  const pt = (i: number): [number, number] => {
    const a = ((i % n) + n) % n;
    const ang = (a / n) * Math.PI * 2;
    const lx = Math.cos(ang) * radii[a];
    const ly = Math.sin(ang) * radii[a] * sq;
    return [cx + lx * Math.cos(rot) - ly * Math.sin(rot), cy + lx * Math.sin(rot) + ly * Math.cos(rot)];
  };
  const path = new Path2D();
  const [sx, sy] = pt(0);
  const [nx, ny] = pt(1);
  path.moveTo((sx + nx) / 2, (sy + ny) / 2);
  for (let i = 1; i <= n; i++) {
    const [ax, ay] = pt(i);
    const [bx, by] = pt(i + 1);
    path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  path.closePath();
  return path;
}

/** Random-walk crack. */
export function crack(ctx: CanvasRenderingContext2D, rng: RNG, x: number, y: number, len: number, angle: number, color: string, alpha: number, width = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = angle;
  let px = x;
  let py = y;
  const steps = Math.max(3, Math.round(len / 6));
  for (let i = 0; i < steps; i++) {
    a += (rng.next() - 0.5) * 0.9;
    px += Math.cos(a) * 6;
    py += Math.sin(a) * 6;
    ctx.lineTo(px, py);
    if (rng.chance(0.12)) {
      // short branch
      const ba = a + (rng.chance(0.5) ? 1 : -1) * rng.range(0.6, 1.4);
      const bl = rng.range(4, 14);
      ctx.lineTo(px + Math.cos(ba) * bl, py + Math.sin(ba) * bl);
      ctx.moveTo(px, py);
    }
  }
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Surface finishes
// ---------------------------------------------------------------------------

/** Brushed-metal streaks inside a rect (streaks run along x unless vertical). */
export function brushedFill(c: Canvas2D, x: number, y: number, w: number, h: number, base: RGB, seed: number, vertical = false, contrast = 1): void {
  c.ctx.fillStyle = css(base);
  c.ctx.fillRect(x, y, w, h);
  modifyPixels(c, x, y, w, h, (px, py, d, i) => {
    const a = vertical ? px : py;
    const b = vertical ? py : px;
    const l =
      1 +
      contrast *
        (0.11 * (hash2(0, a, seed) - 0.5) +
          0.07 * (hash2(b >> 4, a, seed + 1) - 0.5) +
          0.05 * (hash2(b, a, seed + 2) - 0.5) +
          0.06 * (vnoise(b / 40, a / 7, 64, 64, seed + 3) - 0.5));
    d[i] = base.r * l;
    d[i + 1] = base.g * l;
    d[i + 2] = base.b * l;
  });
}

/** Sheet-metal screw head with a slot. */
export function screwHead(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0): void {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#d9dcdf');
  g.addColorStop(0.7, '#8f949a');
  g.addColorStop(1, '#4d5257');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.25);
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(rot) * r * 0.7, y + Math.sin(rot) * r * 0.7);
  ctx.lineTo(x - Math.cos(rot) * r * 0.7, y - Math.sin(rot) * r * 0.7);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

export function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Subtle inset bevel around a rectangle (light top-left, dark bottom-right). */
export function bevel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, size: number, light = 0.25, dark = 0.35): void {
  ctx.fillStyle = `rgba(255,255,255,${light})`;
  ctx.fillRect(x, y, w, size);
  ctx.fillRect(x, y, size, h);
  ctx.fillStyle = `rgba(0,0,0,${dark})`;
  ctx.fillRect(x, y + h - size, w, size);
  ctx.fillRect(x + w - size, y, size, h);
}

export function scanlines(c: Canvas2D, alpha = 0.1, period = 2): void {
  const p = makeCanvas(1, period);
  p.ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  p.ctx.fillRect(0, 0, 1, 1);
  const pat = c.ctx.createPattern(p.canvas, 'repeat');
  if (!pat) return;
  c.ctx.fillStyle = pat;
  c.ctx.fillRect(0, 0, c.w, c.h);
}

export function vignette(c: Canvas2D, strength = 0.4, inner = 0.35): void {
  const { ctx, w, h } = c;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) * 0.55);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** Vertical gradient band helper (grime, shadows). y0→y1 fades a0→a1. */
export function vband(ctx: CanvasRenderingContext2D, x: number, w: number, y0: number, y1: number, color: RGB, a0: number, a1: number, blend: GlobalCompositeOperation = 'multiply'): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, css(color, a0));
  g.addColorStop(1, css(color, a1));
  ctx.save();
  ctx.globalCompositeOperation = blend;
  ctx.fillStyle = g;
  ctx.fillRect(x, Math.min(y0, y1), w, Math.abs(y1 - y0));
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export type Align = 'left' | 'center' | 'right';

export function measureSpaced(ctx: CanvasRenderingContext2D, text: string, spacing: number): number {
  const chars = Array.from(text);
  let w = 0;
  for (const ch of chars) w += ctx.measureText(ch).width;
  return w + spacing * Math.max(0, chars.length - 1);
}

/** fillText with manual letter spacing (works on every canvas implementation). Returns drawn width. */
export function spacedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: Align = 'center'): number {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + spacing;
  }
  ctx.textAlign = prev;
  return total;
}

/** Largest font size (≤ maxPx) at which every line fits maxWidth (letter spacing in em). */
export function fitFontSize(ctx: CanvasRenderingContext2D, lines: string[], maxWidth: number, maxPx: number, minPx: number, fontFor: (px: number) => string, spacingEm = 0): number {
  let px = maxPx;
  while (px > minPx) {
    ctx.font = fontFor(px);
    const sp = px * spacingEm;
    if (lines.every((l) => measureSpaced(ctx, l, sp) <= maxWidth)) return px;
    px -= Math.max(1, Math.round(px * 0.05));
  }
  ctx.font = fontFor(minPx);
  return minPx;
}

/** Greedy word wrap for the current ctx.font. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width <= maxWidth || !line) line = next;
      else {
        out.push(line);
        line = w;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** Draw lines top-down from (x,y) with the current alignment/baseline. */
export function textRows(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number): void {
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x, y + i * lineHeight);
}

/** Paragraph: wraps and draws, returns the y below the last line. */
export function paragraph(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 99): number {
  const lines = wrapText(ctx, text, maxWidth).slice(0, maxLines);
  textRows(ctx, lines, x, y, lineHeight);
  return y + lines.length * lineHeight;
}

/** Stable cache key for an options object (sorted keys). */
export function stableKey(name: string, obj: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .filter((k) => o[k] !== undefined)
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = norm(o[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return `${name}|${JSON.stringify(norm(obj))}`;
}
