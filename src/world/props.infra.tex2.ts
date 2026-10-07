/**
 * Canvas art for the infra props (part B): safety signage, equipment labels, tags, stains,
 * tiling detail maps and the ambulance livery. Deterministic per argument set.
 */
import { type Cnv, FONT_COND, FONT_HAND, FONT_MONO, FONT_SANS, blotches, fitFont, fontStr, hazardStripes, makeCnv, pick, roundRect, rr, runs, seeded, spaced, speckle } from './props.infra.util';

function slipFigure(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = '#121212';
  ctx.fillStyle = '#121212';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * 0.11;
  ctx.beginPath();
  ctx.arc(cx + s * 0.28, cy - s * 0.52, s * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + s * 0.16, cy - s * 0.36);
  ctx.lineTo(cx - s * 0.1, cy + s * 0.05);
  ctx.moveTo(cx + s * 0.1, cy - s * 0.27);
  ctx.lineTo(cx + s * 0.45, cy - s * 0.2);
  ctx.moveTo(cx + s * 0.06, cy - s * 0.2);
  ctx.lineTo(cx - s * 0.32, cy - s * 0.32);
  ctx.moveTo(cx - s * 0.1, cy + s * 0.05);
  ctx.lineTo(cx + s * 0.3, cy + s * 0.2);
  ctx.lineTo(cx + s * 0.52, cy + s * 0.04);
  ctx.moveTo(cx - s * 0.1, cy + s * 0.05);
  ctx.lineTo(cx - s * 0.34, cy + s * 0.32);
  ctx.stroke();
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.6, cy + s * 0.45);
  ctx.lineTo(cx + s * 0.6, cy + s * 0.45);
  ctx.stroke();
  for (const [dx, dy] of [[-0.5, 0.36], [-0.42, 0.3], [0.56, 0.36]]) {
    ctx.beginPath();
    ctx.arc(cx + s * dx, cy + s * dy, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Wet-floor A-frame face (256 x 512, bilingual). */
export function drawWetFloor(): Cnv {
  const c = makeCnv(256, 512);
  const { ctx } = c;
  const rnd = seeded('wetfloor');
  ctx.fillStyle = '#d6aa1e';
  ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = '#141414';
  ctx.fillRect(18, 92, 220, 54);
  ctx.fillStyle = '#d6aa1e';
  ctx.textAlign = 'center';
  fitFont(ctx, ['CAUTION'], 200, 40, 900, FONT_SANS, 0.08);
  spaced(ctx, 'CAUTION', 128, 120, 3);
  ctx.strokeStyle = '#141414';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(128, 168);
  ctx.lineTo(226, 330);
  ctx.lineTo(30, 330);
  ctx.closePath();
  ctx.stroke();
  slipFigure(ctx, 132, 272, 92);
  ctx.fillStyle = '#141414';
  fitFont(ctx, ['WET FLOOR'], 220, 40, 900, FONT_COND, 0.04);
  ctx.fillText('WET FLOOR', 128, 372);
  ctx.font = fontStr(24, 700, FONT_COND);
  ctx.fillText('PISO MOJADO', 128, 408);
  blotches(c, rnd, 18, '70,55,20', 0.16, 12, 50);
  blotches(c, rnd, 8, '30,25,10', 0.3, 8, 26, { x: 0, y: 440, w: 256, h: 72 });
  speckle(c, rnd, 900, '40,30,10', 0.18, 2);
  return c;
}

/** Flag-mounted extinguisher locator sign (256 x 128). */
export function drawExtinguisherSign(): Cnv {
  const c = makeCnv(256, 128);
  const { ctx } = c;
  ctx.fillStyle = '#b3241b';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = '#f4f1ea';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 6, 244, 116);
  ctx.fillStyle = '#f4f1ea';
  roundRect(ctx, 30, 40, 26, 62, 9);
  ctx.fill();
  ctx.fillRect(36, 26, 14, 16);
  ctx.fillRect(28, 24, 34, 6);
  ctx.strokeStyle = '#f4f1ea';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(56, 32);
  ctx.quadraticCurveTo(78, 34, 74, 64);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = fontStr(30, 900, FONT_SANS);
  ctx.fillText('FIRE', 160, 46);
  fitFont(ctx, ['EXTINGUISHER'], 160, 26, 800, FONT_COND);
  ctx.fillText('EXTINGUISHER', 160, 86);
  return c;
}

/** Biohazard label (256 x 256): the trefoil drawn with cut-outs, plus caption. */
export function drawBiohazard(): Cnv {
  const c = makeCnv(256, 256);
  const { ctx } = c;
  ctx.fillStyle = '#d8401f';
  ctx.fillRect(0, 0, 256, 256);
  const s = makeCnv(200, 200);
  const x = s.ctx;
  const cx = 100;
  const cy = 96;
  const angles = [-90, 30, 150].map((d) => (d * Math.PI) / 180);
  x.fillStyle = '#000';
  for (const a of angles) {
    x.beginPath();
    x.arc(cx + Math.cos(a) * 30, cy + Math.sin(a) * 30, 42, 0, Math.PI * 2);
    x.fill();
  }
  x.globalCompositeOperation = 'destination-out';
  for (const a of angles) {
    x.beginPath();
    x.arc(cx + Math.cos(a) * 42, cy + Math.sin(a) * 42, 30, 0, Math.PI * 2);
    x.fill();
  }
  x.beginPath();
  x.arc(cx, cy, 12, 0, Math.PI * 2);
  x.fill();
  x.lineWidth = 6;
  for (const a of angles) {
    x.beginPath();
    x.moveTo(cx, cy);
    x.lineTo(cx + Math.cos(a) * 95, cy + Math.sin(a) * 95);
    x.stroke();
  }
  x.globalCompositeOperation = 'source-over';
  x.strokeStyle = '#000';
  x.lineWidth = 7;
  x.beginPath();
  x.arc(cx, cy, 25, 0, Math.PI * 2);
  x.stroke();
  ctx.drawImage(s.canvas, 28, 6);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  fitFont(ctx, ['BIOHAZARD'], 220, 34, 900, FONT_SANS, 0.05);
  spaced(ctx, 'BIOHAZARD', 128, 226, 2);
  return c;
}

/** Yellow maintenance tag (192 x 384) with a handwritten fault, split on em dashes. */
export function drawTag(text: string): Cnv {
  const c = makeCnv(192, 384);
  const { ctx } = c;
  const rnd = seeded(`tag:${text}`);
  ctx.fillStyle = '#e3c22c';
  ctx.fillRect(0, 0, 192, 384);
  ctx.fillStyle = '#c9a91f';
  ctx.beginPath();
  ctx.arc(96, 34, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9a9ea2';
  ctx.beginPath();
  ctx.arc(96, 34, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.arc(96, 34, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 66, 192, 46);
  ctx.fillStyle = '#e3c22c';
  ctx.textAlign = 'center';
  fitFont(ctx, ['MAINTENANCE'], 176, 26, 900, FONT_COND, 0.05);
  spaced(ctx, 'MAINTENANCE', 96, 89, 1.5);
  ctx.fillStyle = '#161616';
  ctx.font = fontStr(13, 700, FONT_SANS);
  ctx.fillText(`TAG No. ${(1000 + Math.floor(rnd() * 8999)).toString()}`, 96, 128);
  const lines = text.split(/\s+—\s+|\n/).map((s) => s.trim()).filter(Boolean);
  ctx.fillStyle = 'rgba(28,36,80,0.92)';
  ctx.textAlign = 'left';
  let y = 168;
  for (const l of lines) {
    const words = l.split(' ');
    let row = '';
    ctx.font = fontStr(20, 600, FONT_HAND);
    for (const w of words) {
      const next = row ? `${row} ${w}` : w;
      if (ctx.measureText(next).width > 168 && row) {
        ctx.fillText(row, 12 + rr(rnd, -2, 2), y);
        y += 26;
        row = w;
      } else row = next;
    }
    if (row) {
      ctx.fillText(row, 12 + rr(rnd, -2, 2), y);
      y += 30;
    }
  }
  ctx.fillStyle = '#161616';
  ctx.font = fontStr(12, 700, FONT_SANS);
  ctx.fillText('DATE', 12, 330);
  ctx.fillText('BY', 110, 330);
  ctx.fillRect(48, 338, 54, 1.5);
  ctx.fillRect(132, 338, 48, 1.5);
  ctx.fillStyle = 'rgba(28,36,80,0.9)';
  ctx.font = fontStr(15, 600, FONT_HAND);
  ctx.fillText(pick(rnd, ['9/14', '8/30', '10/2']), 52, 328);
  ctx.fillText(pick(rnd, ['R.M.', 'P.D.', 'J.K.']), 136, 328);
  blotches(c, rnd, 9, '90,70,20', 0.2, 10, 40);
  blotches(c, rnd, 4, '40,30,20', 0.22, 6, 14);
  speckle(c, rnd, 400, '60,50,10', 0.15);
  return c;
}

/** Engraved laminate nameplate. */
export function drawPlate(lines: string[], o: { w?: number; h?: number; bg?: string; fg?: string; screws?: boolean } = {}): Cnv {
  const W = o.w ?? 256;
  const H = o.h ?? 64;
  const c = makeCnv(W, H);
  const { ctx } = c;
  ctx.fillStyle = o.bg ?? '#1c1d1f';
  roundRect(ctx, 0, 0, W, H, H * 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  roundRect(ctx, 2, 2, W - 4, H - 4, H * 0.1);
  ctx.stroke();
  ctx.fillStyle = o.fg ?? '#f1f1ed';
  ctx.textAlign = 'center';
  const pad = o.screws ? H * 0.8 : W * 0.06;
  const lh = (H * 0.8) / lines.length;
  fitFont(ctx, lines, W - pad * 2, lh * 0.82, 700, FONT_SANS, 0.04);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.1 + lh * (i + 0.5)));
  if (o.screws) {
    for (const sx of [H * 0.38, W - H * 0.38]) {
      ctx.fillStyle = '#8f9397';
      ctx.beginPath();
      ctx.arc(sx, H / 2, H * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a3d40';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - H * 0.09, H / 2);
      ctx.lineTo(sx + H * 0.09, H / 2);
      ctx.stroke();
    }
  }
  return c;
}

/** Orange arc-flash warning label (256 x 176). */
export function drawArcFlash(): Cnv {
  const c = makeCnv(256, 176);
  const { ctx } = c;
  ctx.fillStyle = '#f4f2ec';
  ctx.fillRect(0, 0, 256, 176);
  ctx.fillStyle = '#e8781e';
  ctx.fillRect(0, 0, 256, 44);
  ctx.fillStyle = '#141414';
  ctx.beginPath();
  ctx.moveTo(30, 8);
  ctx.lineTo(48, 38);
  ctx.lineTo(12, 38);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#e8781e';
  ctx.fillRect(28, 18, 4, 11);
  ctx.fillRect(28, 31, 4, 4);
  ctx.fillStyle = '#141414';
  ctx.textAlign = 'center';
  ctx.font = fontStr(30, 900, FONT_SANS);
  ctx.fillText('WARNING', 146, 23);
  ctx.font = fontStr(15, 800, FONT_COND);
  ctx.fillText('ARC FLASH AND SHOCK HAZARD', 128, 62);
  ctx.font = fontStr(12, 700, FONT_COND);
  ctx.fillText('APPROPRIATE PPE REQUIRED', 128, 80);
  ctx.textAlign = 'left';
  ctx.font = fontStr(11, 500, FONT_MONO);
  const rows = ['Incident energy   8.2 cal/cm2', 'Arc flash bndry   52 in', 'Shock hazard      480 VAC', 'Limited approach  42 in', 'Equip  MDP-1   Study 2016'];
  rows.forEach((r, i) => ctx.fillText(r, 12, 102 + i * 15));
  blotches(c, seeded('arcflash'), 6, '90,80,60', 0.15, 10, 30);
  return c;
}

/** Wrap-around pipe marker (512 x 64): text and flow arrow twice, so either side of the pipe reads. */
export function drawPipeLabel(text: string, bg: string, fg: string): Cnv {
  const c = makeCnv(512, 64);
  const { ctx } = c;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  fitFont(ctx, [text], 170, 34, 800, FONT_SANS, 0.04);
  for (const cx of [128, 384]) {
    spaced(ctx, text, cx - 12, 33, 1.5);
    ctx.beginPath();
    ctx.moveTo(cx + 92, 20);
    ctx.lineTo(cx + 116, 32);
    ctx.lineTo(cx + 92, 44);
    ctx.closePath();
    ctx.fill();
  }
  blotches(c, seeded(`pipe:${text}`), 6, '40,40,30', 0.18, 8, 30);
  return c;
}

/** Typed circuit directory card for the branch panel door (256 x 384). */
export function drawDirectory(): Cnv {
  const c = makeCnv(256, 384);
  const { ctx } = c;
  const rnd = seeded('directory');
  ctx.fillStyle = '#eee8d6';
  ctx.fillRect(0, 0, 256, 384);
  ctx.fillStyle = '#1e1e1e';
  ctx.textAlign = 'left';
  ctx.font = fontStr(13, 700, FONT_MONO);
  ctx.fillText('PANEL LP-2E  208Y/120V', 10, 18);
  ctx.font = fontStr(10, 500, FONT_MONO);
  ctx.fillText('FED FROM: ATS-1 / EDP-1', 10, 34);
  ctx.fillRect(10, 44, 236, 1);
  const rows = ['CORRIDOR WEST', 'CORRIDOR EAST', 'EXAM 1-5 / MED RM', 'WAITING / PUBLIC', 'SERVICE HALLS', 'CCTV HEAD END', 'WEST WING', 'TRIAGE RECPT', 'LOUNGE RECPT', 'EVS / UTILITY', 'SECURITY PANEL', 'SPARE', 'SPARE', 'SPARE'];
  rows.forEach((r, i) => {
    const y = 62 + i * 21;
    ctx.fillStyle = '#1e1e1e';
    ctx.font = fontStr(10, 600, FONT_MONO);
    ctx.fillText(String(i * 2 + 1).padStart(2, ' '), 10, y);
    ctx.fillText(r, 34, y);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(10, y + 10, 236, 1);
  });
  const wy = 62 + 6 * 21;
  ctx.strokeStyle = 'rgba(25,30,90,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(30, wy + 1);
  ctx.lineTo(106, wy - 1);
  ctx.stroke();
  ctx.fillStyle = 'rgba(25,30,90,0.85)';
  ctx.font = fontStr(12, 600, FONT_HAND);
  ctx.fillText('abandoned - do not reset', 112, wy);
  ctx.fillStyle = 'rgba(150,30,25,0.8)';
  ctx.font = fontStr(11, 600, FONT_HAND);
  ctx.fillText('still reads load??', 124, wy + 14);
  blotches(c, rnd, 10, '120,90,40', 0.16, 14, 50);
  blotches(c, rnd, 3, '90,60,30', 0.25, 20, 34, { x: 150, y: 300, w: 80, h: 70 });
  speckle(c, rnd, 300, '80,60,30', 0.12);
  return c;
}

/** Chemical jug label (160 x 192). */
export function drawChemLabel(name: string, band: string, hazard: boolean): Cnv {
  const c = makeCnv(160, 192);
  const { ctx } = c;
  const rnd = seeded(`chem:${name}`);
  ctx.fillStyle = '#f2f0ea';
  ctx.fillRect(0, 0, 160, 192);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 160, 44);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  const words = name.split(' ');
  const l1 = words.slice(0, Math.ceil(words.length / 2)).join(' ');
  const l2 = words.slice(Math.ceil(words.length / 2)).join(' ');
  fitFont(ctx, [l1, l2], 146, 18, 900, FONT_COND);
  ctx.fillText(l1, 80, l2 ? 14 : 22);
  if (l2) ctx.fillText(l2, 80, 32);
  ctx.fillStyle = '#2a2a2a';
  ctx.font = fontStr(11, 700, FONT_SANS);
  ctx.fillText('CONCENTRATE', 80, 58);
  if (hazard) {
    ctx.save();
    ctx.translate(40, 102);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-20, -20, 40, 40);
    ctx.strokeStyle = '#c0261c';
    ctx.lineWidth = 5;
    ctx.strokeRect(-20, -20, 40, 40);
    ctx.restore();
    ctx.fillStyle = '#141414';
    ctx.font = fontStr(26, 900, FONT_SANS);
    ctx.fillText('!', 40, 104);
    ctx.font = fontStr(14, 900, FONT_SANS);
    ctx.fillText('DANGER', 112, 96);
  }
  ctx.fillStyle = 'rgba(30,30,30,0.6)';
  for (let i = 0; i < 6; i++) ctx.fillRect(hazard ? 76 : 14, 110 + i * 11, rr(rnd, 50, hazard ? 70 : 130), 3);
  ctx.fillRect(14, 176, 132, 2);
  blotches(c, rnd, 6, '120,100,40', 0.2, 8, 30);
  runs(c, rnd, 3, '90,80,40', 0.15);
  return c;
}

/** Diesel day-tank placard: NFPA 704 diamond and warnings (192 x 224). */
export function drawNfpa(): Cnv {
  const c = makeCnv(192, 224);
  const { ctx } = c;
  ctx.fillStyle = '#f1efe8';
  ctx.fillRect(0, 0, 192, 224);
  const d = (cx: number, cy: number, s: number, col: string, txt: string): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = col;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
    ctx.fillStyle = '#111';
    ctx.font = fontStr(22, 900, FONT_SANS);
    ctx.textAlign = 'center';
    ctx.fillText(txt, cx, cy + 1);
  };
  d(96, 48, 40, '#c8241b', '2');
  d(68, 76, 40, '#1f4fa0', '1');
  d(124, 76, 40, '#e6c41f', '0');
  d(96, 104, 40, '#ffffff', '');
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  fitFont(ctx, ['DIESEL FUEL'], 170, 26, 900, FONT_SANS);
  ctx.fillText('DIESEL FUEL', 96, 158);
  ctx.fillStyle = '#b3241b';
  ctx.font = fontStr(14, 800, FONT_COND);
  ctx.fillText('NO SMOKING', 96, 182);
  ctx.fillText('NO OPEN FLAMES', 96, 200);
  blotches(c, seeded('nfpa'), 8, '70,50,20', 0.2, 8, 30);
  return c;
}

/** Yellow/black floor tape strip (repeats along u). */
export function drawStripes(): Cnv {
  const c = makeCnv(128, 32);
  hazardStripes(c.ctx, 0, 0, 128, 32, 32);
  speckle(c, seeded('stripes'), 300, '30,30,30', 0.4, 2);
  return c;
}

/** Radiator core: fins and tubes, tiling. */
export function drawRadiatorCore(): Cnv {
  const c = makeCnv(128, 128);
  const { ctx } = c;
  ctx.fillStyle = '#202224';
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 3) {
    ctx.fillStyle = x % 6 === 0 ? '#3c3f42' : '#2b2d30';
    ctx.fillRect(x, 0, 1, 128);
  }
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = '#505357';
    ctx.fillRect(0, y, 128, 4);
    ctx.fillStyle = '#16171a';
    ctx.fillRect(0, y + 4, 128, 1);
  }
  blotches(c, seeded('core'), 6, '90,70,40', 0.25, 10, 30);
  return c;
}

/** Wire mesh with alpha (bird screen / guard), tiling. */
export function drawMesh(): Cnv {
  const c = makeCnv(64, 64);
  const { ctx } = c;
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(150,154,158,1)';
  for (let i = 0; i < 64; i += 16) {
    ctx.fillRect(i, 0, 2, 64);
    ctx.fillRect(0, i, 64, 2);
  }
  return c;
}

const BOX_TEXT = ['NITRILE GLOVES  M  10 x 100', 'IV ADMIN SETS  48 CT', 'SODIUM CHLORIDE 0.9%  1000 mL x 12', 'PAPER TOWELS  12 ROLLS', 'TRASH LINERS 40x46  250', 'GAUZE SPONGES 4x4  STERILE', 'EXAM TABLE PAPER  12 ROLLS', 'SHARPS CONTAINERS  2 GAL'];

/** Corrugated carton side with print, a shipping label and handling marks (256 x 256). */
export function drawCardboard(variant: number): Cnv {
  const c = makeCnv(256, 256);
  const { ctx } = c;
  const rnd = seeded(`carton:${variant}`);
  ctx.fillStyle = pick(rnd, ['#a8804c', '#9c7446', '#b08a57']);
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 4) {
    ctx.fillStyle = `rgba(80,55,25,${(0.04 + rnd() * 0.04).toFixed(3)})`;
    ctx.fillRect(x, 0, 2, 256);
  }
  ctx.fillStyle = 'rgba(30,25,20,0.85)';
  ctx.textAlign = 'center';
  const t = BOX_TEXT[variant % BOX_TEXT.length];
  fitFont(ctx, [t], 220, 20, 800, FONT_COND);
  ctx.fillText(t, 128, 70);
  ctx.font = fontStr(11, 600, FONT_SANS);
  ctx.fillText('CASCADE MEDICAL SUPPLY  ·  LOT 2219-04', 128, 92);
  ctx.strokeStyle = 'rgba(30,25,20,0.8)';
  ctx.lineWidth = 4;
  for (const ax of [40, 64]) {
    ctx.beginPath();
    ctx.moveTo(ax, 150);
    ctx.lineTo(ax, 118);
    ctx.moveTo(ax - 9, 128);
    ctx.lineTo(ax, 116);
    ctx.lineTo(ax + 9, 128);
    ctx.stroke();
  }
  ctx.fillStyle = '#f3f1ea';
  ctx.fillRect(132, 128, 108, 76);
  ctx.fillStyle = '#1a1a1a';
  for (let i = 0; i < 34; i++) ctx.fillRect(140 + i * 2.7, 172, rnd() < 0.5 ? 1 : 2, 24);
  ctx.font = fontStr(9, 600, FONT_MONO);
  ctx.textAlign = 'left';
  ctx.fillText('SHIP TO: ED CLEAN SUPPLY', 138, 140);
  ctx.fillText(`PO 77${Math.floor(rnd() * 9000 + 1000)}`, 138, 156);
  blotches(c, rnd, 8, '60,40,20', 0.18, 14, 60);
  if (variant % 3 === 1) blotches(c, rnd, 2, '60,45,30', 0.35, 30, 60, { x: 20, y: 180, w: 200, h: 60 });
  speckle(c, rnd, 500, '50,35,20', 0.2);
  return c;
}

/** Polyethylene sheeting: drywall dust, folds and a taped seam (256 x 512). */
export function drawSheeting(): Cnv {
  const c = makeCnv(256, 512);
  const { ctx } = c;
  const rnd = seeded('sheeting');
  ctx.fillStyle = '#dfe4e1';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 14; i++) {
    const x = rnd() * 256;
    ctx.fillStyle = `rgba(150,160,158,${(0.1 + rnd() * 0.15).toFixed(3)})`;
    ctx.fillRect(x, 0, rr(rnd, 1, 3), 512);
  }
  blotches(c, rnd, 26, '250,250,246', 0.35, 20, 70);
  blotches(c, rnd, 10, '120,118,108', 0.14, 20, 60, { x: 0, y: 380, w: 256, h: 132 });
  ctx.fillStyle = 'rgba(190,190,180,0.8)';
  ctx.fillRect(0, 6, 256, 18);
  ctx.fillStyle = 'rgba(120,120,110,0.35)';
  ctx.fillRect(0, 22, 256, 2);
  speckle(c, rnd, 900, '255,255,255', 0.25, 2);
  return c;
}

export type StainKind = 'oil' | 'rust' | 'water' | 'drain' | 'soot' | 'dirt';

/** Alpha stain decal (256 x 256), transparent background. */
export function drawStain(kind: StainKind, seed = 1): Cnv {
  const c = makeCnv(256, 256);
  const { ctx } = c;
  const rnd = seeded(`stain:${kind}:${seed}`);
  ctx.clearRect(0, 0, 256, 256);
  const col = kind === 'oil' ? '16,14,12' : kind === 'rust' ? '110,58,24' : kind === 'water' ? '40,42,40' : kind === 'drain' ? '78,52,30' : kind === 'soot' ? '20,20,20' : '50,44,36';
  const region = { x: 60, y: 60, w: 136, h: 136 };
  if (kind === 'drain') {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rr(rnd, 40, 95);
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr(rnd, 12, 30));
      g.addColorStop(0, `rgba(${col},${(0.25 + rnd() * 0.25).toFixed(3)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - 30, y - 30, 60, 60);
    }
    blotches(c, rnd, 10, '20,18,16', 0.4, 30, 50, { x: 100, y: 100, w: 56, h: 56 });
    return c;
  }
  blotches(c, rnd, kind === 'oil' ? 16 : 22, col, kind === 'oil' ? 0.6 : 0.4, 18, 64, region);
  if (kind === 'water') {
    ctx.strokeStyle = `rgba(${col},0.35)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = 92 + Math.sin(a * 3 + rnd()) * 10 + rnd() * 6;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r * 0.8;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  if (kind === 'oil') blotches(c, rnd, 6, '5,5,5', 0.7, 10, 30, { x: 100, y: 100, w: 56, h: 56 });
  return c;
}

/** Vertical streak decal (128 x 256) running down from the top: under grilles, valves, leaks. */
export function drawStreak(rgb: string, seed = 1): Cnv {
  const c = makeCnv(128, 256);
  c.ctx.clearRect(0, 0, 128, 256);
  const rnd = seeded(`streak:${rgb}:${seed}`);
  runs(c, rnd, 22, rgb, 0.32, { x: 14, y: 0, w: 100, h: 256 });
  blotches(c, rnd, 6, rgb, 0.25, 10, 30, { x: 20, y: 0, w: 88, h: 30 });
  return c;
}

/** Greyscale patches marking where the oily film shows interference colours. */
export function drawSheenMask(): Cnv {
  const c = makeCnv(256, 256);
  const { ctx } = c;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  blotches(c, seeded('sheen'), 18, '255,255,255', 0.85, 20, 70);
  return c;
}

function starOfLife(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass === 0 ? '#f4f4f0' : '#1f4fa8';
    const w = s * (pass === 0 ? 0.36 : 0.28);
    const h = s * (pass === 0 ? 1.04 : 0.96);
    for (let i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI) / 3);
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(-s * 0.025, -s * 0.36, s * 0.05, s * 0.72);
  ctx.strokeStyle = '#f4f4f0';
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const y = -s * 0.3 + t * s * 0.58;
    const x = Math.sin(t * Math.PI * 3) * s * 0.07;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Ambulance module side livery (1024 x 512, transparent): stripe, star of life, lettering. */
export function drawLivery(): Cnv {
  const c = makeCnv(1024, 512);
  const { ctx } = c;
  ctx.clearRect(0, 0, 1024, 512);
  ctx.fillStyle = '#b3231b';
  ctx.fillRect(0, 318, 1024, 58);
  ctx.fillStyle = '#e9e6dc';
  ctx.fillRect(0, 306, 1024, 6);
  ctx.fillRect(0, 382, 1024, 6);
  ctx.fillStyle = '#b3231b';
  ctx.textAlign = 'center';
  fitFont(ctx, ['AMBULANCE'], 520, 64, 900, FONT_SANS, 0.06);
  spaced(ctx, 'AMBULANCE', 360, 252, 5);
  starOfLife(ctx, 830, 190, 190);
  ctx.fillStyle = '#26303a';
  ctx.font = fontStr(30, 800, FONT_COND);
  ctx.fillText('ST. AUGUSTINE EMS', 360, 196);
  ctx.fillStyle = '#f4f4f0';
  ctx.font = fontStr(36, 900, FONT_COND);
  ctx.fillText('MEDIC 12', 120, 348);
  ctx.fillStyle = '#26303a';
  ctx.font = fontStr(22, 700, FONT_SANS);
  ctx.fillText('EMERGENCY  911', 830, 330 + 90);
  const rnd = seeded('livery');
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(60,55,45,${(0.04 + rnd() * 0.08).toFixed(3)})`;
    ctx.fillRect(rnd() * 1024, 430 + rnd() * 82, rr(rnd, 6, 40), rr(rnd, 1, 3));
  }
  return c;
}

/** Rear chevrons, red and fluorescent yellow-green (256 x 256). */
export function drawChevrons(): Cnv {
  const c = makeCnv(256, 256);
  const { ctx } = c;
  ctx.fillStyle = '#c3cf2c';
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#b3231b';
  for (let i = -4; i < 8; i++) {
    const y = i * 64;
    ctx.beginPath();
    ctx.moveTo(0, y + 64);
    ctx.lineTo(128, y);
    ctx.lineTo(256, y + 64);
    ctx.lineTo(256, y + 96);
    ctx.lineTo(128, y + 32);
    ctx.lineTo(0, y + 96);
    ctx.closePath();
    ctx.fill();
  }
  blotches(c, seeded('chev'), 10, '40,40,30', 0.12, 10, 40);
  return c;
}

/** Frosted manifestation band for glass partitions (256 x 64, alpha). */
export function drawFrost(): Cnv {
  const c = makeCnv(256, 64);
  const { ctx } = c;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(235,240,240,0.55)';
  ctx.fillRect(0, 8, 256, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (let x = 4; x < 256; x += 10) {
    ctx.beginPath();
    ctx.arc(x, 4, 2, 0, Math.PI * 2);
    ctx.arc(x + 5, 60, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

/** Small printed label (bins, binders, cartons). */
export function drawSmallLabel(lines: string[], o: { w?: number; h?: number; bg?: string; fg?: string; family?: string } = {}): Cnv {
  const W = o.w ?? 128;
  const H = o.h ?? 48;
  const c = makeCnv(W, H);
  const { ctx } = c;
  ctx.fillStyle = o.bg ?? '#f1efe8';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = o.fg ?? '#1b1b1b';
  ctx.textAlign = 'center';
  const lh = (H * 0.86) / lines.length;
  fitFont(ctx, lines, W * 0.9, lh * 0.8, 700, o.family ?? FONT_SANS);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.07 + lh * (i + 0.5)));
  blotches(c, seeded(`lbl:${lines.join('|')}`), 3, '120,100,60', 0.15, 6, 18);
  return c;
}

/** Chart binder spine (64 x 256): coloured vinyl with a label window and a handwritten bay. */
export function drawSpine(color: string, label: string): Cnv {
  const c = makeCnv(64, 256);
  const { ctx } = c;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 64, 256);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.3)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#f1efe6';
  ctx.fillRect(10, 30, 44, 120);
  ctx.save();
  ctx.translate(32, 90);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = 'rgba(25,30,80,0.9)';
  ctx.textAlign = 'center';
  fitFont(ctx, [label], 110, 26, 600, FONT_HAND);
  ctx.fillText(label, 0, 0);
  ctx.restore();
  blotches(c, seeded(`spine:${label}`), 4, '30,30,30', 0.25, 6, 20);
  return c;
}

/**
 * Pipe marker for a wrap band (512 along the pipe x 128 around it). The legend appears on the
 * front and, rotated 180 degrees, on the back; flow arrows always point along +u.
 */
export function drawPipeWrap(text: string, bg: string, fg: string): Cnv {
  const c = makeCnv(512, 128);
  const { ctx } = c;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  const px = fitFont(ctx, [text], 340, 34, 800, FONT_SANS, 0.04);
  const arrow = (x: number, y: number): void => {
    ctx.beginPath();
    ctx.moveTo(x - 22, y - px * 0.22);
    ctx.lineTo(x + 6, y - px * 0.22);
    ctx.lineTo(x + 6, y - px * 0.45);
    ctx.lineTo(x + 34, y);
    ctx.lineTo(x + 6, y + px * 0.45);
    ctx.lineTo(x + 6, y + px * 0.22);
    ctx.lineTo(x - 22, y + px * 0.22);
    ctx.closePath();
    ctx.fill();
  };
  spaced(ctx, text, 220, 32, 1.5);
  arrow(440, 32);
  ctx.save();
  ctx.translate(220, 96);
  ctx.rotate(Math.PI);
  spaced(ctx, text, 0, 0, 1.5);
  ctx.restore();
  arrow(440, 96);
  blotches(c, seeded(`wrap:${text}`), 8, '40,40,30', 0.2, 10, 40);
  return c;
}
