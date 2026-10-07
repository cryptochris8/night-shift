/**
 * Screen content for monitors, terminals and the waiting-room TV. Cheap (512 px wide)
 * because the director refreshes vitals/news as time passes. Variants: alarm, dead
 * (black with a phosphor dot) and glitch (tearing, chroma split, noise).
 */
import { type RNG, hashString } from '../core/rng';
import {
  type Canvas2D,
  FONT_MONO,
  FONT_SANS,
  clamp01,
  fillPixels,
  font,
  grain,
  hash2,
  makeCanvas,
  modifyPixels,
  rngFor,
  rrect,
  scanlines,
  spacedText,
  vignette,
} from './textures.util';

export interface ScreenOpts {
  time?: string;
  lines?: string[];
  alarm?: boolean;
  dead?: boolean;
  glitch?: number;
}

export function buildScreen(kind: string, o: ScreenOpts): HTMLCanvasElement {
  const wide = kind === 'news_muted';
  const W = 512;
  const H = wide ? 288 : 384;
  const c = makeCanvas(W, H);
  const rng = rngFor(`screen:${kind}`, hashString(`${o.time ?? ''}|${(o.lines ?? []).join('|')}|${o.alarm ? 1 : 0}`));
  c.ctx.textBaseline = 'middle';
  if (o.dead) {
    screenDead(c);
    return c.canvas;
  }
  switch (kind) {
    case 'vitals':
      screenVitals(c, o);
      break;
    case 'news_muted':
      screenNews(c, o, rng);
      break;
    case 'registration':
      screenRegistration(c, o);
      break;
    case 'triage':
      screenTriage(c, o);
      break;
    case 'patients':
      screenPatients(c, o);
      break;
    case 'security':
      screenSecurity(c, o, rng);
      break;
    case 'pyxis':
      screenPyxis(c, o);
      break;
    case 'standby':
      screenStandby(c, o);
      break;
    case 'off':
      screenOff(c);
      break;
    case 'static':
      screenStatic(c, rng);
      break;
    default:
      screenTerminalGeneric(c, kind, o);
  }
  if (kind !== 'off' && kind !== 'static') {
    scanlines(c, 0.1, 2);
    vignette(c, 0.35, 0.3);
  }
  if (o.glitch && o.glitch > 0) applyGlitch(c, clamp01(o.glitch), rng);
  return c.canvas;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Seconds-of-day derived phase so refreshes animate traces/tickers continuously. */
function timeSeconds(time?: string): number {
  if (!time) return 1337;
  const m = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return hashString(time) % 86400;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (m[4]) {
    const pm = m[4].toUpperCase() === 'PM';
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  return h * 3600 + min * 60 + s;
}

function uiChrome(c: Canvas2D, title: string, time: string | undefined, accent: string): void {
  const { ctx, w: W, h: H } = c;
  ctx.fillStyle = '#0b1014';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, 30);
  g.addColorStop(0, '#182229');
  g.addColorStop(1, '#111920');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 30);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 30, W, 2);
  ctx.textBaseline = 'middle';
  ctx.font = font(12, 700, FONT_SANS);
  ctx.fillStyle = '#dbe4e8';
  spacedText(ctx, title, 12, 15, 0.6, 'left');
  ctx.textAlign = 'right';
  ctx.font = font(12, 600, FONT_MONO);
  ctx.fillStyle = '#8fa3ad';
  ctx.fillText(time ?? '22:47', W - 12, 15);
  ctx.textAlign = 'left';
}

function statusBar(ctx: CanvasRenderingContext2D, W: number, H: number, text: string): void {
  ctx.fillStyle = '#0e151a';
  ctx.fillRect(0, H - 20, W, 20);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillStyle = '#5f7580';
  ctx.fillText(text, 12, H - 10);
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function statusColor(s: string): { bg: string; fg: string } {
  const u = s.toUpperCase();
  if (u.includes('WAIT') || u.includes('PEND')) return { bg: 'rgba(242,177,52,0.18)', fg: '#f2b134' };
  if (u.includes('OFFLINE') || u.includes('NO SIGNAL') || u.includes('ALARM') || u.includes('CRIT') || u.includes('OVERDUE') || u.includes('LOST')) return { bg: 'rgba(255,74,58,0.18)', fg: '#ff4a3a' };
  if (u.includes('ROOM') || u.includes('ONLINE') || u.includes('OK') || u.includes('STABLE') || u.includes('CLEAN')) return { bg: 'rgba(95,211,138,0.16)', fg: '#5fd38a' };
  if (u.includes('ADMIT') || u.includes('OBS')) return { bg: 'rgba(111,179,255,0.16)', fg: '#6fb3ff' };
  return { bg: 'rgba(140,151,158,0.14)', fg: '#8c979e' };
}

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  const col = statusColor(text);
  ctx.font = font(9.5, 800, FONT_MONO);
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = col.bg;
  rrect(ctx, x, y - 8, w, 16, 3);
  ctx.fill();
  ctx.fillStyle = col.fg;
  ctx.textAlign = 'left';
  ctx.fillText(text, x + 6, y + 0.5);
}

interface TableSpec {
  x: number;
  y: number;
  w: number;
  cols: [string, number][];
  rows: string[][];
  rowH: number;
  statusCol?: number;
  maxRows?: number;
  boldCol?: number;
}

function table(ctx: CanvasRenderingContext2D, t: TableSpec): number {
  const totalW = t.cols.reduce((a, col) => a + col[1], 0);
  const scale = t.w / totalW;
  ctx.fillStyle = '#131c22';
  ctx.fillRect(t.x, t.y, t.w, 20);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = font(10, 700, FONT_MONO);
  ctx.fillStyle = '#86a0ac';
  let x = t.x;
  for (const [name, w] of t.cols) {
    ctx.fillText(name, x + 6, t.y + 10);
    x += w * scale;
  }
  let y = t.y + 20;
  const rows = t.rows.slice(0, t.maxRows ?? 99);
  rows.forEach((row, i) => {
    if (i % 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.025)';
      ctx.fillRect(t.x, y, t.w, t.rowH);
    }
    let cx = t.x;
    row.forEach((cell, ci) => {
      const cw = (t.cols[ci]?.[1] ?? 60) * scale;
      if (ci === t.statusCol) chip(ctx, cx + 6, y + t.rowH / 2, cell);
      else {
        const bold = ci === (t.boldCol ?? 1);
        ctx.fillStyle = bold ? '#e6edf0' : '#aebbc2';
        ctx.font = font(11, bold ? 700 : 500, FONT_MONO);
        ctx.textAlign = 'left';
        ctx.fillText(fit(ctx, cell, cw - 10), cx + 6, y + t.rowH / 2);
      }
      cx += cw;
    });
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(t.x, y + t.rowH - 1, t.w, 1);
    y += t.rowH;
  });
  return y;
}

/** "a | b | c" or "a · b · c" or two-space separated cells. */
function parseRow(line: string): string[] {
  const parts = line.includes('|') ? line.split('|') : line.split(/\s{2,}|\s·\s/);
  return parts.map((s) => s.trim());
}

function button(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, primary: boolean): void {
  ctx.fillStyle = primary ? '#2f7f86' : 'rgba(255,255,255,0.08)';
  rrect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.fillStyle = primary ? '#eaf6f7' : '#aebbc2';
  ctx.font = font(10.5, 700, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------------------
// Vitals monitor
// ---------------------------------------------------------------------------

interface Vitals {
  bay: string;
  name: string;
  hr: number;
  spo2: number;
  sys: number;
  dia: number;
  rr: number;
  temp: number;
  alarmText: string;
}

function num(val: string, def: number): number {
  const m = val.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : def;
}

function parseVitals(lines?: string[]): Vitals {
  const v: Vitals = { bay: 'BAY 3', name: 'MERCER, J', hr: 104, spo2: 97, sys: 152, dia: 94, rr: 18, temp: 37.1, alarmText: 'HR HIGH' };
  for (const raw of lines ?? []) {
    const line = raw.trim();
    const m = line.match(/^([A-Za-z0-9]+)\s*[:=]?\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const val = m[2].trim();
    switch (key) {
      case 'HR':
      case 'PULSE':
        v.hr = num(val, v.hr);
        break;
      case 'SPO2':
      case 'SAT':
        v.spo2 = num(val, v.spo2);
        break;
      case 'BP':
      case 'NIBP': {
        const mm = val.match(/(\d+)\s*\/\s*(\d+)/);
        if (mm) {
          v.sys = Number(mm[1]);
          v.dia = Number(mm[2]);
        }
        break;
      }
      case 'RR':
      case 'RESP':
        v.rr = num(val, v.rr);
        break;
      case 'TEMP':
      case 'T':
        v.temp = num(val, v.temp);
        break;
      case 'PT':
      case 'NAME':
      case 'PATIENT':
        if (val) v.name = val;
        break;
      case 'BAY':
        v.bay = `BAY ${val}`.trim();
        break;
      case 'ALARM':
        if (val) v.alarmText = val;
        break;
      default:
        if (line.includes(',')) v.name = line;
    }
  }
  return v;
}

const gauss = (t: number, c: number, w: number): number => {
  const d = (t - c) / w;
  return Math.exp(-d * d);
};

/** One PQRST complex per beat; tb in beats. */
function ecg(tb: number, x: number): number {
  const t = tb - Math.floor(tb);
  const p = 0.12 * gauss(t, 0.14, 0.03);
  const q = -0.1 * gauss(t, 0.245, 0.008);
  const r = 1.0 * gauss(t, 0.265, 0.009);
  const s = -0.25 * gauss(t, 0.29, 0.011);
  const tw = 0.3 * gauss(t, 0.47, 0.05);
  const wander = (hash2(x >> 3, 0, 11) - 0.5) * 0.03;
  return p + q + r + s + tw + wander - 0.05;
}

function pleth(tb: number): number {
  const t = tb - Math.floor(tb);
  return (1.0 * gauss(t, 0.22, 0.09) + 0.4 * gauss(t, 0.5, 0.12)) * 0.9 - 0.2;
}

const resp = (tb: number): number => Math.sin(tb * Math.PI * 2) * 0.6;

function screenVitals(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  const v = parseVitals(o.lines);
  const secs = timeSeconds(o.time);
  const flat = v.hr <= 0;
  const alarm = !!o.alarm || flat;
  ctx.fillStyle = '#05080b';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0c1318';
  ctx.fillRect(0, 0, W, 30);
  ctx.textAlign = 'left';
  ctx.font = font(13, 700, FONT_MONO);
  ctx.fillStyle = '#a9bcc6';
  ctx.fillText(`${v.bay}   ${v.name}`, 10, 15);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7d919b';
  ctx.fillText(o.time ?? '', W - 10, 15);
  ctx.textAlign = 'left';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillStyle = '#4f626c';
  ctx.fillText('ADULT  ·  ECG II  ·  NIBP AUTO 15 min  ·  SpO2', 10, 42);
  if (alarm) {
    ctx.fillStyle = flat ? '#c0160f' : '#b3261e';
    ctx.fillRect(W * 0.55, 32, W * 0.45 - 6, 20);
    ctx.fillStyle = '#ffffff';
    ctx.font = font(12, 800, FONT_MONO);
    ctx.textAlign = 'center';
    ctx.fillText(flat ? '** ASYSTOLE **' : `** ${v.alarmText} **`, W * 0.775, 42);
    ctx.textAlign = 'left';
  }
  const colR = W * 0.68;
  const tx0 = 10;
  const tx1 = colR - 12;
  const tw = tx1 - tx0;
  const pxPerSec = tw / 6;
  const sweepX = tx0 + ((secs % 6) / 6) * tw;
  const rows = [
    { y: 56, h: 104, color: alarm ? '#ff4a3a' : '#6cff9a', label: 'HR', unit: 'bpm', value: flat ? '0' : String(v.hr), kind: 'ecg' as const, lead: 'II' },
    { y: 160, h: 86, color: '#55d8ff', label: 'SpO2', unit: '%', value: flat ? '--' : String(v.spo2), kind: 'pleth' as const, lead: 'PLETH' },
    { y: 246, h: 70, color: '#ffe27a', label: 'RR', unit: '/min', value: flat ? '--' : String(v.rr), kind: 'resp' as const, lead: 'RESP' },
  ];
  for (const r of rows) {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = tx0; gx <= tx1 + 0.5; gx += tw / 12) {
      ctx.moveTo(gx, r.y);
      ctx.lineTo(gx, r.y + r.h);
    }
    ctx.stroke();
    ctx.fillStyle = r.color;
    ctx.font = font(10, 700, FONT_MONO);
    ctx.fillText(r.lead, tx0 + 2, r.y + 8);
    const mid = r.y + r.h * 0.62;
    const amp = r.h * 0.38;
    const yAt = (x: number): number => {
      const t = (x - tx0) / pxPerSec + secs;
      let yv: number;
      if (flat) yv = (hash2(x, 1, 3) - 0.5) * 0.02;
      else if (r.kind === 'ecg') yv = ecg((t * v.hr) / 60, x);
      else if (r.kind === 'pleth') yv = pleth((t * v.hr) / 60);
      else yv = resp((t * v.rr) / 60);
      return mid - yv * amp;
    };
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let x = tx0; x <= tx1; x++) {
      const y = yAt(x);
      if (x === tx0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // erase bar ahead of the newest sample
    const eraseW = tw * 0.12;
    ctx.fillStyle = 'rgba(5,8,11,0.88)';
    ctx.fillRect(sweepX, r.y, Math.min(eraseW, tx1 - sweepX), r.h);
    if (sweepX + eraseW > tx1) ctx.fillRect(tx0, r.y, sweepX + eraseW - tx1, r.h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sweepX - 1.5, yAt(sweepX) - 1.5, 3, 3);
    // numerics
    ctx.fillStyle = r.color;
    ctx.font = font(11, 700, FONT_MONO);
    ctx.fillText(r.label, colR, r.y + 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = font(9, 500, FONT_MONO);
    ctx.fillText(r.unit, colR + 44, r.y + 12);
    ctx.fillStyle = r.color;
    ctx.font = font(r.kind === 'ecg' ? 54 : 40, 800, FONT_MONO);
    ctx.fillText(r.value, colR, r.y + r.h * 0.6);
    if (r.kind === 'ecg') {
      ctx.font = font(9, 500, FONT_MONO);
      ctx.fillStyle = alarm ? '#ff4a3a' : 'rgba(255,255,255,0.4)';
      ctx.fillText('50 – 120', colR + 100, r.y + 12);
    }
  }
  const by = 322;
  ctx.fillStyle = '#0c1318';
  ctx.fillRect(0, by, W, H - by);
  ctx.fillStyle = '#e8eef1';
  ctx.font = font(11, 700, FONT_MONO);
  ctx.fillText('NIBP', 12, by + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = font(9, 500, FONT_MONO);
  ctx.fillText(`mmHg   ${(o.time ?? '22:58').slice(0, 5)}`, 50, by + 14);
  ctx.fillStyle = '#f2f5f7';
  ctx.font = font(34, 800, FONT_MONO);
  ctx.fillText(flat ? '--/--' : `${v.sys}/${v.dia}`, 12, by + 42);
  ctx.font = font(14, 600, FONT_MONO);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  if (!flat) ctx.fillText(`(${Math.round((v.sys + 2 * v.dia) / 3)})`, 150, by + 46);
  ctx.fillStyle = '#e8eef1';
  ctx.font = font(11, 700, FONT_MONO);
  ctx.fillText('TEMP', 290, by + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = font(9, 500, FONT_MONO);
  ctx.fillText('°C  oral', 335, by + 14);
  ctx.fillStyle = '#f2f5f7';
  ctx.font = font(28, 800, FONT_MONO);
  ctx.fillText(v.temp.toFixed(1), 290, by + 42);
  ctx.fillStyle = '#131c22';
  ctx.fillRect(0, H - 18, W, 18);
  ctx.font = font(9, 600, FONT_MONO);
  ctx.fillStyle = '#6f838d';
  ctx.textAlign = 'center';
  ['ALARMS', 'NIBP START', 'TRENDS', 'FREEZE', 'MENU'].forEach((k, i) => ctx.fillText(k, (i + 0.5) * (W / 5), H - 9));
  ctx.textAlign = 'left';
  if (alarm) {
    ctx.strokeStyle = 'rgba(255,60,40,0.75)';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, W - 4, H - 4);
  }
}

// ---------------------------------------------------------------------------
// Muted news broadcast (16:9)
// ---------------------------------------------------------------------------

function radar(ctx: CanvasRenderingContext2D, rng: RNG, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // land
  ctx.fillStyle = '#16302a';
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.7);
  for (let i = 0; i <= 10; i++) ctx.lineTo(x + (w * i) / 10, y + h * (0.35 + 0.25 * Math.sin(i * 1.3 + 0.5) + 0.1 * Math.sin(i * 3.1)));
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
  // county lines
  ctx.strokeStyle = 'rgba(120,160,150,0.25)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(x + (w * i) / 6, y);
    ctx.lineTo(x + (w * i) / 6 + 20, y + h);
    ctx.stroke();
  }
  // rain cells
  const cols = ['rgba(60,200,80,0.6)', 'rgba(230,210,60,0.65)', 'rgba(230,110,40,0.7)', 'rgba(200,40,40,0.75)'];
  for (let i = 0; i < 14; i++) {
    const cx = x + w * (0.2 + rng.next() * 0.7);
    const cy = y + h * (0.15 + rng.next() * 0.6);
    const r = rng.range(14, 44);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      ctx.ellipse(cx + rng.range(-4, 4), cy + rng.range(-3, 3), r * (1 - k * 0.22), r * 0.6 * (1 - k * 0.22), 0.4, 0, Math.PI * 2);
      if (k < 2 || rng.chance(0.5)) ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = font(10, 700, FONT_SANS);
  ctx.textAlign = 'left';
  ctx.fillText('LIVE RADAR  ·  10:45 PM', x + 10, y + 14);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = font(8, 500, FONT_SANS);
  ctx.fillText('St. Augustine', x + w * 0.58, y + h * 0.56);
  ctx.fillRect(x + w * 0.55, y + h * 0.54, 3, 3);
  ctx.restore();
}

function anchor(ctx: CanvasRenderingContext2D, cx: number, baseY: number, scale: number, suit: string, skin: string, hair: string): void {
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(scale, scale);
  ctx.fillStyle = suit;
  ctx.beginPath();
  ctx.moveTo(-58, 0);
  ctx.quadraticCurveTo(-52, -52, -20, -58);
  ctx.lineTo(20, -58);
  ctx.quadraticCurveTo(52, -52, 58, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8e8ea';
  ctx.beginPath();
  ctx.moveTo(-12, -58);
  ctx.lineTo(0, -34);
  ctx.lineTo(12, -58);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = skin;
  ctx.fillRect(-9, -72, 18, 18);
  ctx.beginPath();
  ctx.ellipse(0, -88, 20, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(0, -98, 21, 16, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // soft shadow over the face: no features at this size
  const g = ctx.createLinearGradient(0, -110, 0, -62);
  g.addColorStop(0, 'rgba(0,0,0,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, -88, 20, 25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function muteIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  rrect(ctx, x - s * 1.6, y - s, s * 4.6, s * 2, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.35);
  ctx.lineTo(x - s * 0.5, y - s * 0.35);
  ctx.lineTo(x, y - s * 0.8);
  ctx.lineTo(x, y + s * 0.8);
  ctx.lineTo(x - s * 0.5, y + s * 0.35);
  ctx.lineTo(x - s, y + s * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff4a3a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - s * 1.2, y - s * 0.9);
  ctx.lineTo(x + s * 0.4, y + s * 0.9);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = font(s * 0.9, 700, FONT_SANS);
  ctx.textAlign = 'left';
  ctx.fillText('MUTE', x + s * 0.7, y + 1);
  ctx.restore();
}

function screenNews(c: Canvas2D, o: ScreenOpts, rng: RNG): void {
  const { ctx, w: W, h: H } = c;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0c1a33');
  bg.addColorStop(1, '#1a3358');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // studio glow strips
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = `rgba(80,140,230,${0.05 + (i % 2) * 0.03})`;
    ctx.fillRect(0, 10 + i * 42, W, 6);
  }
  ctx.fillStyle = '#0a1426';
  ctx.fillRect(60, 30, 392, 150);
  radar(ctx, rng, 60, 30, 392, 150);
  ctx.strokeStyle = 'rgba(120,160,220,0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 30, 392, 150);
  ctx.fillStyle = '#0e1c34';
  ctx.beginPath();
  ctx.moveTo(40, 230);
  ctx.lineTo(472, 230);
  ctx.lineTo(500, 288);
  ctx.lineTo(12, 288);
  ctx.closePath();
  ctx.fill();
  const dg = ctx.createLinearGradient(0, 230, 0, 288);
  dg.addColorStop(0, 'rgba(120,160,230,0.25)');
  dg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dg;
  ctx.fill();
  anchor(ctx, 190, 232, 1.0, '#1d2230', '#c9a27e', '#3a2a22');
  anchor(ctx, 330, 234, 0.95, '#2b2f3a', '#b8865f', '#1d1813');
  const l3y = 212;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.fillRect(0, l3y, W, 34);
  ctx.fillStyle = '#c62828';
  ctx.fillRect(0, l3y, 92, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(13, 900, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText('BREAKING', 46, l3y + 17);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#121418';
  ctx.font = font(14, 800, FONT_SANS);
  ctx.fillText(fit(ctx, o.lines?.[0] ?? 'STORM SYSTEM BRINGS HEAVY RAIN OVERNIGHT', W - 112), 102, l3y + 12);
  ctx.font = font(10.5, 500, FONT_SANS);
  ctx.fillStyle = '#3a4048';
  ctx.fillText(fit(ctx, o.lines?.[1] ?? 'Scattered outages reported across the east side · Utility crews on standby', W - 112), 102, l3y + 27);
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 246, W, 42);
  ctx.fillStyle = '#c62828';
  ctx.fillRect(0, 246, 70, 42);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(11, 800, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText('LIVE', 35, 262);
  ctx.font = font(9, 600, FONT_SANS);
  ctx.fillText('7 NEWS', 35, 276);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eaee';
  ctx.font = font(11, 600, FONT_SANS);
  const tick = o.lines?.[2] ?? 'COUNTY COUNCIL DELAYS VOTE ON TRANSIT PLAN  •  HIGH SCHOOL FOOTBALL: SCORES AND HIGHLIGHTS  •  FLU CASES UP 14% FROM LAST YEAR  •  ROAD CLOSURES: RIVER BRIDGE OVERNIGHT';
  const tickW = ctx.measureText(`${tick}  •  `).width;
  const scroll = (timeSeconds(o.time) * 70) % tickW;
  ctx.save();
  ctx.beginPath();
  ctx.rect(70, 246, W - 70, 42);
  ctx.clip();
  ctx.fillText(`${tick}  •  ${tick}`, 80 - scroll, 267);
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(W - 86, 8, 78, 20);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(12, 700, FONT_MONO);
  ctx.textAlign = 'right';
  ctx.fillText(o.time ?? '10:47 PM', W - 14, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(8, 8, 56, 20);
  ctx.fillStyle = '#c62828';
  ctx.fillRect(10, 10, 16, 16);
  ctx.fillStyle = '#ffffff';
  ctx.font = font(11, 900, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText('7', 18, 18);
  ctx.textAlign = 'left';
  ctx.font = font(10, 700, FONT_SANS);
  ctx.fillText('NEWS', 30, 18);
  muteIcon(ctx, W - 50, 196, 11);
}

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

const REG_ROWS: string[][] = [
  ['22:31', 'MERCER, JOHN', '34 M', 'Headache · dizziness · visual disturbance', 'WAITING'],
  ['22:05', 'HADDAD, SAMIR', '61 M', 'Cough · fever 3 days', 'WAITING'],
  ['21:40', 'ALVAREZ, ROSA', '58 F', 'Chest pain', 'ROOMED 2'],
  ['21:55', 'OKAFOR, EMEKA', '58 M', 'Laceration L hand', 'ROOMED 4'],
  ['20:12', 'PRICE, ELLEN', '77 F', 'Fall · hip pain', 'ADMITTED'],
  ['19:48', 'NGUYEN, T.', '23 M', 'Ankle injury', 'DISCHARGED'],
  ['19:02', 'BARRA, L.', '5 F', 'Fever · otitis', 'DISCHARGED'],
];

function screenRegistration(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  uiChrome(c, 'SARMC · ED REGISTRATION — TRACKING', o.time, '#2f7f86');
  const rows = o.lines?.length ? o.lines.map(parseRow) : REG_ROWS;
  // left nav
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 32, 78, H - 52);
  ['ARRIVALS', 'TRACKING', 'BEDS', 'DISCHARGE', 'REPORTS'].forEach((n, i) => {
    ctx.fillStyle = i === 1 ? 'rgba(47,127,134,0.3)' : 'transparent';
    ctx.fillRect(0, 44 + i * 26, 78, 22);
    ctx.fillStyle = i === 1 ? '#dbe4e8' : '#6f838d';
    ctx.font = font(9, 700, FONT_MONO);
    ctx.textAlign = 'left';
    ctx.fillText(n, 8, 55 + i * 26);
  });
  const end = table(ctx, { x: 88, y: 44, w: W - 98, cols: [['ARR', 44], ['PATIENT', 118], ['AGE', 36], ['COMPLAINT', 150], ['STATUS', 76]], rows, rowH: 26, statusCol: 4, maxRows: 9 });
  ctx.fillStyle = '#6f838d';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.textAlign = 'left';
  ctx.fillText(`${rows.length} patients  ·  Avg wait 0:38  ·  Longest 1:12`, 94, Math.min(H - 34, end + 14));
  statusBar(ctx, W, H, `Logged in: M. HALE  ·  ${o.time ?? '22:47'}  ·  Station REG-01  ·  Printer online`);
}

function field(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, value: string, color = '#e6edf0', big = false): void {
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  rrect(ctx, x, y, w, big ? 44 : 34, 3);
  ctx.fill();
  ctx.fillStyle = '#6f838d';
  ctx.font = font(8.5, 700, FONT_MONO);
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 8, y + 10);
  ctx.fillStyle = color;
  ctx.font = font(big ? 18 : 11, big ? 800 : 600, FONT_MONO);
  ctx.fillText(fit(ctx, value, w - 14), x + 8, y + (big ? 29 : 24));
}

function screenTriage(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  uiChrome(c, 'TRIAGE ASSESSMENT', o.time, '#f2b134');
  const L = o.lines ?? [];
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6edf0';
  ctx.font = font(14, 800, FONT_SANS);
  ctx.fillText(L[0] ?? 'MERCER, JOHN', 12, 50);
  ctx.fillStyle = '#8fa3ad';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillText(L[1] ?? '34 M  ·  DOB 03/14/1992  ·  MRN 00482917  ·  Arrived 22:31', 12, 66);
  ctx.fillStyle = '#f2b134';
  rrect(ctx, W - 70, 42, 58, 30, 4);
  ctx.fill();
  ctx.fillStyle = '#1b1e22';
  ctx.font = font(11, 900, FONT_SANS);
  ctx.textAlign = 'center';
  ctx.fillText('ESI 3', W - 41, 57);
  field(ctx, 12, 80, W - 24, 'CHIEF COMPLAINT', L[2] ?? 'Headache, dizziness, visual disturbance — onset ~20:00');
  const vit: [string, string, string][] = [['BP', '152/94', '#ffffff'], ['HR', '104', '#6cff9a'], ['RR', '18', '#ffe27a'], ['SpO2', '97 %', '#55d8ff'], ['TEMP', '37.1', '#ffffff'], ['PAIN', '6/10', '#f2b134']];
  const vw = (W - 24 - 5 * 6) / 6;
  vit.forEach(([l, v, col], i) => field(ctx, 12 + i * (vw + 6), 122, vw, l, v, col, true));
  field(ctx, 12, 174, (W - 30) / 2, 'ALLERGIES', 'NKDA');
  field(ctx, 18 + (W - 30) / 2, 174, (W - 30) / 2, 'HISTORY', 'Migraine with aura · no anticoagulants');
  field(ctx, 12, 216, W - 24, 'HOME MEDS', L[3] ?? 'hydrocodone/APAP 5/325 — pt reports 2 tabs @ 21:00', '#f2b134');
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  rrect(ctx, 12, 258, W - 24, 62, 3);
  ctx.fill();
  ctx.fillStyle = '#6f838d';
  ctx.font = font(8.5, 700, FONT_MONO);
  ctx.textAlign = 'left';
  ctx.fillText('NURSING NOTE', 20, 268);
  ctx.fillStyle = '#d7e0e4';
  ctx.font = font(10.5, 500, FONT_MONO);
  const note = L[4] ?? 'Alert, oriented x4. Photophobic. States "the lights keep doing something". Denies head injury. Neuro checks q15 min. Reassess vitals in 30.';
  const words = note.split(' ');
  let line = '';
  let ly = 284;
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > W - 44) {
      ctx.fillText(line, 20, ly);
      line = w;
      ly += 14;
      if (ly > 312) break;
    } else line = next;
  }
  if (ly <= 312) ctx.fillText(line, 20, ly);
  button(ctx, 12, H - 52, 110, 24, 'SAVE', false);
  button(ctx, 130, H - 52, 130, 24, 'ROOM PATIENT', true);
  button(ctx, 268, H - 52, 110, 24, 'ORDERS', false);
  statusBar(ctx, W, H, `RN: S. TRAN  ·  Last saved ${o.time ?? '22:58'}  ·  Unsigned`);
}

function screenPatients(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  uiChrome(c, 'ED TRACKING BOARD — ALL BAYS', o.time, '#5fd38a');
  const rows = o.lines?.length
    ? o.lines.map(parseRow)
    : [
        ['1', '—', '', '', '', 'EMPTY'],
        ['2', 'ALVAREZ, R.', 'Chest pain · obs · trop 00:30', 'S. TRAN', '1:07', 'OBS'],
        ['3', '—', 'reserved', '', '', 'CLEANED'],
        ['4', 'OKAFOR, E.', 'Lac L hand · sutures', 'S. TRAN', '0:52', 'ROOMED'],
        ['5', '—', '', '', '', 'EMPTY'],
        ['TRI', '—', '', '', '', 'EMPTY'],
        ['WR', 'MERCER, J.', 'HA · dizziness · visual change', '—', '0:16', 'WAITING'],
        ['WR', 'HADDAD, S.', 'Cough · fever', '—', '0:42', 'WAITING'],
      ];
  table(ctx, { x: 10, y: 44, w: W - 20, cols: [['BAY', 40], ['PATIENT', 120], ['COMPLAINT', 170], ['RN', 70], ['LOS', 46], ['STATUS', 80]], rows, rowH: 26, statusCol: 5, maxRows: 9 });
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8fa3ad';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillText('CENSUS 3   WAITING 2   LWBS 0   HOLDS 0   DIVERT: NO', 12, H - 48);
  ctx.fillStyle = '#f2b134';
  ctx.fillText('!  Imaging CLOSED overnight — CT on-call x4455   ·   West wing: no entry', 12, H - 32);
  statusBar(ctx, W, H, `User: S. TRAN, RN  ·  Auto-refresh 30 s  ·  ${o.time ?? '22:47'}`);
}

function feedThumb(c: Canvas2D, rng: RNG, x: number, y: number, w: number, h: number, label: string, online: boolean, time?: string): void {
  const { ctx } = c;
  ctx.fillStyle = '#05070a';
  ctx.fillRect(x, y, w, h);
  const sn = rng.int(1, 1e9);
  if (online) {
    const base = rng.range(40, 90);
    modifyPixels(c, x, y, w, h, (px, py, d, i) => {
      const nx = (px - x) / w;
      const ny = (py - y) / h;
      const floor = ny > 0.55 ? 1.0 : 0.55;
      const corner = Math.pow(Math.hypot(nx - 0.5, ny - 0.5), 1.6) * 1.6;
      const v = Math.max(0, base * floor * (1 - corner) + (hash2(px, py, sn) - 0.5) * 22);
      d[i] = v * 0.95;
      d[i + 1] = v;
      d[i + 2] = v * 0.98;
    });
    // a wall/floor edge and a doorway rectangle: enough structure to read as a corridor
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.55);
    ctx.lineTo(x + w, y + h * 0.55);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + w * 0.62, y + h * 0.18, w * 0.12, h * 0.37);
  } else {
    modifyPixels(c, x, y, w, h, (px, py, d, i) => {
      const v = hash2(px, py, sn) * 90;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    });
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y + h * 0.4, w, 18);
    ctx.fillStyle = '#ff4a3a';
    ctx.font = font(10, 800, FONT_MONO);
    ctx.textAlign = 'center';
    ctx.fillText('NO SIGNAL', x + w / 2, y + h * 0.4 + 9);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, 14);
  ctx.fillStyle = '#d7e0e4';
  ctx.font = font(8.5, 700, FONT_MONO);
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + 7);
  ctx.textAlign = 'right';
  ctx.fillText((time ?? '22:47:13').padEnd(8, ':00').slice(0, 8), x + w - 4, y + 7);
  ctx.textAlign = 'left';
  if (online) {
    ctx.fillStyle = '#ff4a3a';
    ctx.beginPath();
    ctx.arc(x + w - 8, y + h - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function parseCam(line: string): [string, boolean] {
  const u = line.toUpperCase();
  const offline = u.includes('OFFLINE') || u.includes('NO SIGNAL') || u.includes('DOWN');
  const label = line.replace(/\s*[|·-]?\s*(OFFLINE|ONLINE|NO SIGNAL|DOWN)\s*$/i, '').trim();
  return [label, !offline];
}

function screenSecurity(c: Canvas2D, o: ScreenOpts, rng: RNG): void {
  const { ctx, w: W, h: H } = c;
  uiChrome(c, 'SECURITY — DVR 02 · LIVE VIEW', o.time, '#8c979e');
  const cams: [string, boolean][] = o.lines?.length
    ? o.lines.map(parseCam)
    : [['CAM 01 WAITING', true], ['CAM 02 WEST HALL', true], ['CAM 03 EAST HALL', true], ['CAM 04 NURSE STN', true], ['CAM 05 ELEVATOR', true], ['CAM 06 SERVICE', true], ['CAM 07 AMB BAY', true], ['CAM 08 GENERATOR', true]];
  const fx = 10;
  const fy = 42;
  const fw = 150;
  const fh = 108;
  for (let i = 0; i < 4; i++) {
    const x = fx + (i % 2) * (fw + 6);
    const y = fy + Math.floor(i / 2) * (fh + 6);
    const [label, online] = cams[i] ?? ['—', false];
    feedThumb(c, rng, x, y, fw, fh, label, online, o.time);
  }
  const lx = 330;
  ctx.textAlign = 'left';
  ctx.font = font(10, 700, FONT_MONO);
  ctx.fillStyle = '#86a0ac';
  ctx.fillText('CHANNELS', lx, 50);
  cams.slice(0, 8).forEach(([label, online], i) => {
    const y = 68 + i * 24;
    ctx.fillStyle = online ? '#5fd38a' : '#ff4a3a';
    ctx.beginPath();
    ctx.arc(lx + 5, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d7e0e4';
    ctx.font = font(10.5, 600, FONT_MONO);
    ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, label, 110), lx + 16, y);
    ctx.fillStyle = online ? '#5fd38a' : '#ff4a3a';
    ctx.font = font(9, 700, FONT_MONO);
    ctx.textAlign = 'right';
    ctx.fillText(online ? 'ONLINE' : 'NO SIGNAL', W - 12, y);
    ctx.textAlign = 'left';
  });
  const onlineCount = cams.filter((cm) => cm[1]).length;
  ctx.fillStyle = '#8fa3ad';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillText(`REC ●  ${onlineCount}/${cams.length} CHANNELS   ·   RETENTION 30 D   ·   7.2 TB FREE`, 12, H - 40);
  statusBar(ctx, W, H, 'Operator: R. DUNN  ·  Motion alerts: 0  ·  Export locked (admin)');
}

function screenPyxis(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  uiChrome(c, 'MEDSTATION 4000 — ED MED ROOM', o.time, '#3fa0a8');
  ctx.textAlign = 'left';
  ctx.fillStyle = '#86a0ac';
  ctx.font = font(10, 700, FONT_MONO);
  ctx.fillText('MY PATIENTS', 12, 50);
  const pts = o.lines?.length ? o.lines : ['ALVAREZ, R.        Bay 2', 'OKAFOR, E.         Bay 4', 'MERCER, J.         Bay 3  (orders pending)'];
  pts.slice(0, 7).forEach((p, i) => {
    const y = 66 + i * 30;
    ctx.fillStyle = i === 2 ? 'rgba(63,160,168,0.12)' : 'rgba(255,255,255,0.03)';
    rrect(ctx, 10, y - 12, 230, 26, 3);
    ctx.fill();
    ctx.fillStyle = '#e6edf0';
    ctx.font = font(11, 600, FONT_MONO);
    ctx.fillText(fit(ctx, p, 215), 18, y + 1);
  });
  const dx = 260;
  const dy = 50;
  ctx.fillStyle = '#86a0ac';
  ctx.font = font(10, 700, FONT_MONO);
  ctx.fillText('DRAWERS', dx, dy);
  for (let r = 0; r < 6; r++) {
    for (let col = 0; col < 4; col++) {
      const x = dx + col * 58;
      const y = dy + 14 + r * 30;
      const hot = r === 2 && col === 1;
      ctx.fillStyle = hot ? 'rgba(242,177,52,0.25)' : 'rgba(255,255,255,0.05)';
      rrect(ctx, x, y, 52, 24, 3);
      ctx.fill();
      ctx.strokeStyle = hot ? '#f2b134' : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = hot ? '#f2b134' : '#8fa3ad';
      ctx.font = font(9, 600, FONT_MONO);
      ctx.fillText(`${String.fromCharCode(65 + r)}${col + 1}`, x + 6, y + 12);
    }
  }
  ctx.fillStyle = '#6f838d';
  ctx.font = font(9.5, 500, FONT_MONO);
  ctx.fillText('Select a patient to begin. Witness required for controlled substances.', 12, 290);
  ctx.fillStyle = 'rgba(242,177,52,0.12)';
  rrect(ctx, 10, H - 92, W - 20, 44, 4);
  ctx.fill();
  ctx.fillStyle = '#f2b134';
  ctx.font = font(10, 800, FONT_MONO);
  ctx.fillText('DISCREPANCY — Drawer C2 (hydrocodone/APAP 5/325)', 20, H - 78);
  ctx.fillStyle = '#d7e0e4';
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillText('Count 11 / expected 12 · last access 21:12 D. MORALES · witness required', 20, H - 62);
  statusBar(ctx, W, H, 'User: S. TRAN, RN  ·  Session locks in 1:40  ·  Controlled substance log ON');
}

function screenTerminalGeneric(c: Canvas2D, kind: string, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  ctx.fillStyle = '#060a08';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7fd59a';
  ctx.font = font(12, 600, FONT_MONO);
  const lines = o.lines?.length ? o.lines : [`SARMC/${kind.toUpperCase()} v4.2`, 'Session: ED-TERM', `Time: ${o.time ?? '22:47'}`, '', 'Ready.', '> _'];
  lines.slice(0, 22).forEach((l, i) => ctx.fillText(fit(ctx, l, W - 24), 12, 24 + i * 16));
}

function screenStandby(c: Canvas2D, o: ScreenOpts): void {
  const { ctx, w: W, h: H } = c;
  ctx.fillStyle = '#060807';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(120,150,130,0.55)';
  ctx.font = font(16, 600, FONT_MONO);
  spacedText(ctx, 'SYSTEM STANDBY', W / 2, H / 2 - 10, 4);
  ctx.font = font(10, 500, FONT_MONO);
  ctx.fillStyle = 'rgba(120,150,130,0.35)';
  ctx.fillText(o.lines?.[0] ?? 'IMAGING WORKSTATION 2  ·  NO ACTIVE STUDY', W / 2, H / 2 + 14);
  ctx.textAlign = 'left';
  ctx.fillText('_', W / 2 + 112, H / 2 - 10);
  ctx.fillStyle = 'rgba(255,170,60,0.7)';
  ctx.beginPath();
  ctx.arc(W - 20, H - 16, 3, 0, Math.PI * 2);
  ctx.fill();
}

function screenOff(c: Canvas2D): void {
  const { ctx, w: W, h: H } = c;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#111316');
  g.addColorStop(0.5, '#0a0b0d');
  g.addColorStop(1, '#0d0e11');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const r = ctx.createLinearGradient(0, 0, W * 0.6, H);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.045)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.045)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(200,200,200,${0.04 + (i % 5) * 0.01})`;
    ctx.fillRect((i * 97) % W, (i * 61) % H, 1, 1);
  }
  grain(c, 0.012, 3);
}

function screenDead(c: Canvas2D): void {
  const { ctx, w: W, h: H } = c;
  ctx.fillStyle = '#020303';
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 5);
  g.addColorStop(0, 'rgba(170,200,185,0.75)');
  g.addColorStop(0.5, 'rgba(120,150,140,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(80,110,100,0.03)';
  ctx.fillRect(0, 0, W, 30);
  grain(c, 0.01, 4);
}

function screenStatic(c: Canvas2D, rng: RNG): void {
  const { ctx, w: W, h: H } = c;
  const sn = rng.int(1, 1e9);
  fillPixels(c, (x, y, out) => {
    let n = hash2(x, y, sn) * 0.75 + hash2(x >> 1, y, sn + 1) * 0.25;
    n *= 0.75 + 0.25 * Math.sin((y / H) * Math.PI * 7 + (sn % 10));
    const v = n * 235;
    out[0] = v;
    out[1] = v;
    out[2] = v * 1.04;
  });
  const ry = sn % H;
  const g = ctx.createLinearGradient(0, ry - 40, 0, ry + 40);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, ry - 40, W, 80);
  scanlines(c, 0.18, 2);
  vignette(c, 0.45, 0.3);
}

// ---------------------------------------------------------------------------
// Glitch post-pass
// ---------------------------------------------------------------------------

function applyGlitch(c: Canvas2D, amount: number, rng: RNG): void {
  const { ctx, w: W, h: H } = c;
  const copy = makeCanvas(W, H);
  copy.ctx.drawImage(c.canvas, 0, 0);
  const bands = 1 + Math.round(amount * 7);
  for (let i = 0; i < bands; i++) {
    const y = Math.floor(rng.next() * H);
    const h = Math.max(2, Math.floor(rng.range(2, 6 + amount * 40)));
    const dx = Math.round((rng.next() - 0.5) * 2 * (6 + amount * 60));
    ctx.drawImage(copy.canvas, 0, y, W, h, dx, y, W, h);
  }
  // chroma split on a couple of bands
  for (let i = 0; i < 2; i++) {
    const y = Math.floor(rng.next() * (H - 24));
    const h = Math.floor(rng.range(6, 24));
    const k = Math.round(rng.range(2, 4 + amount * 10));
    const img = ctx.getImageData(0, y, W, h);
    const d = img.data;
    const src = new Uint8ClampedArray(d);
    for (let yy = 0; yy < h; yy++) {
      for (let x = 0; x < W; x++) {
        const idx = (yy * W + x) * 4;
        const rx = Math.min(W - 1, Math.max(0, x - k));
        const bx = Math.min(W - 1, Math.max(0, x + k));
        d[idx] = src[(yy * W + rx) * 4];
        d[idx + 2] = src[(yy * W + bx) * 4 + 2];
      }
    }
    ctx.putImageData(img, 0, y);
  }
  const lines = Math.round(amount * 12);
  for (let i = 0; i < lines; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rng.range(0.1, 0.5) * amount})`;
    ctx.fillRect(0, Math.floor(rng.next() * H), W, 1);
  }
  const ry = Math.floor(rng.next() * H);
  const g = ctx.createLinearGradient(0, ry - 30, 0, ry + 30);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, `rgba(0,0,0,${0.5 * amount})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, ry - 30, W, 60);
  if (amount > 0.4) {
    const p = (amount - 0.4) * 0.5;
    modifyPixels(c, 0, 0, W, H, (px, py, d, i) => {
      if (hash2(px, py, 99) > 1 - p) {
        const n = hash2(px, py, 98) * 255;
        d[i] = n;
        d[i + 1] = n;
        d[i + 2] = n;
      }
    });
  }
}
