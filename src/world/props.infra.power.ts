/**
 * Electrical room / generator room equipment: breaker panels (main switchboard, zone branch
 * panel, generator distribution), the automatic transfer switch and the diesel day tank.
 * Indicator lamps, meters and zone breakers follow the store's power state and zones.
 */
import * as THREE from 'three';
import { type PropType, ZONES } from '../core/types';
import type { MeshOpts, PropBuilder, PropKit } from './props';
import { drawGauge, drawLcd, gaugeAngle } from './props.infra.tex';
import { drawArcFlash, drawDirectory, drawNfpa, drawPlate, drawSmallLabel, drawStain } from './props.infra.tex2';
import { signPlane, brownout, decalMat, generatorRunning, gentle, live, onMains, pipe, powerOf, propSeed, sharedTex, switcher, texMat, toCeiling } from './props.infra.util';

const dimHex = (c: number, f: number): number => {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
};

const paint = (k: PropKit): THREE.MeshStandardMaterial => k.std(0x8b9197, 0.55, 0.35);

/** Engraved nameplate facing +z. */
export function plate(k: PropKit, key: string, lines: string[], w: number, h: number, x: number, y: number, z: number, o: MeshOpts & { bg?: string; fg?: string } = {}): THREE.Mesh {
  const pw = Math.min(512, Math.max(64, Math.round(w * 1600)));
  const ph = Math.min(256, Math.max(24, Math.round(h * 1600)));
  const mat = texMat(k, `plate:${key}`, () => sharedTex(`plate:${key}`, () => drawPlate(lines, { w: pw, h: ph, bg: o.bg, fg: o.fg })), { roughness: 0.45 });
  return k.plane(w, h, mat, x, y, z, o);
}

/** Panel pilot light with a chrome bezel; returns its on/off switch. */
export function pilot(k: PropKit, color: number, x: number, y: number, z: number, r = 0.014): (on: boolean) => void {
  k.cyl(r * 1.4, r * 1.4, 0.012, k.std(0xbfc3c7, 0.3, 0.9), x, y, z + 0.006, { axis: 'z', seg: 16, cast: false });
  const lens = k.cyl(r, r * 0.92, 0.016, k.std(dimHex(color, 0.22), 0.25), x, y, z + 0.016, { axis: 'z', seg: 16, cast: false });
  return switcher(lens, k.glowMat(color, 2.4), k.std(dimHex(color, 0.22), 0.25));
}

/** Square-bezel panel meter; returns the needle pivot (rotate .rotation.z with gaugeAngle). */
export function meter(k: PropKit, key: string, label: string, max: number, x: number, y: number, z: number, size = 0.1): THREE.Group {
  k.rbox(size + 0.018, size + 0.018, 0.03, k.std(0x1b1c1e, 0.5, 0.2), x, y, z + 0.015, 0.004);
  const face = texMat(k, `gauge:${key}`, () => sharedTex(`gauge:${key}`, () => drawGauge(label, max)), { roughness: 0.5 });
  k.plane(size, size, face, x, y, z + 0.0305);
  const needle = live(k.sub(x, y, z + 0.0315));
  k.box(size * 0.42, 0.0026, 0.001, k.std(0xb3261e, 0.5), size * 0.17, 0, 0, { parent: needle, cast: false });
  k.cyl(0.005, 0.005, 0.003, k.std(0x111111, 0.5), 0, 0, 0.001, { axis: 'z', parent: needle, cast: false });
  return needle;
}

/** Chrome T-handle with a lock cylinder. */
function tHandle(k: PropKit, x: number, y: number, z: number, o: MeshOpts = {}): void {
  const chrome = k.std(0xb9bdc1, 0.3, 0.9);
  k.cyl(0.016, 0.016, 0.02, chrome, x, y, z + 0.01, { axis: 'z', seg: 12, ...o });
  k.box(0.018, 0.09, 0.016, chrome, x, y - 0.03, z + 0.024, o);
}

function mainPanel(k: PropKit): void {
  const W = 0.9;
  const H = 1.5;
  const D = 0.28;
  k.rbox(W, H, D, paint(k), 0, 0, D / 2, 0.012);
  const cover = k.std(0x969ca2, 0.5, 0.35);
  const z = D + 0.012;
  for (const [h, cy] of [[0.34, 0.57], [0.5, 0.14], [0.56, -0.4]]) k.rbox(W - 0.04, h, 0.012, cover, 0, cy, D + 0.006, 0.004);
  plate(k, 'mdp', ['MDP-1  MAIN DISTRIBUTION', '480Y/277V  3PH 4W  1200A'], 0.4, 0.06, -0.1, 0.69, z + 0.0005);
  const volts = meter(k, 'volts', 'AC VOLTS', 600, -0.28, 0.56, z, 0.11);
  const amps = meter(k, 'amps', 'AMPERES', 1200, -0.1, 0.56, z, 0.11);
  const black = k.std(0x161718, 0.5, 0.1);
  for (const x of [-0.28, -0.1]) {
    k.cyl(0.016, 0.016, 0.02, black, x, 0.45, z + 0.01, { axis: 'z', seg: 12 });
    k.box(0.004, 0.022, 0.008, k.std(0xe0e0dc, 0.5), x, 0.455, z + 0.022);
  }
  const lamps = [0, 1, 2].map((i) => pilot(k, 0xff4030, 0.12 + i * 0.08, 0.58, z));
  ['A', 'B', 'C'].forEach((ph, i) => plate(k, `ph${ph}`, [`PH ${ph}`], 0.05, 0.02, 0.12 + i * 0.08, 0.53, z + 0.0005));
  signPlane(k, 'DANGER — 480 VOLTS', 'warning', 0.24, 0.096, 0.3, 0.46, z + 0.0005);
  // main breaker operator, handle up (ON)
  k.rbox(0.2, 0.3, 0.05, black, -0.14, 0.16, z + 0.025, 0.008);
  k.rbox(0.05, 0.12, 0.045, k.std(0x2a2b2d, 0.45, 0.1), -0.14, 0.21, z + 0.07, 0.008);
  plate(k, 'on', ['ON'], 0.05, 0.022, -0.14, 0.34, z + 0.0505);
  plate(k, 'off', ['OFF'], 0.05, 0.022, -0.14, -0.02, z + 0.0505);
  plate(k, 'mainbkr', ['MAIN BREAKER', '1200 A  LSIG'], 0.2, 0.05, 0.2, 0.33, z + 0.0005);
  const arc = texMat(k, 'arcflash', () => sharedTex('arcflash', drawArcFlash), { roughness: 0.55 });
  k.plane(0.18, 0.124, arc, 0.2, 0.17, z + 0.0005);
  tHandle(k, 0.38, 0.1, z);
  tHandle(k, 0.38, -0.4, z);
  for (let c = 0; c < 2; c++) {
    for (let r = 0; r < 4; r++) {
      const x = -0.27 + c * 0.3;
      const y = -0.2 - r * 0.12;
      k.rbox(0.18, 0.085, 0.035, black, x, y, z + 0.0175, 0.004);
      k.box(0.03, 0.03, 0.03, k.std(0x2c2d2f, 0.5), x - 0.03, y, z + 0.045);
      k.plane(0.06, 0.018, k.std(0xe9e6dc, 0.6), x + 0.05, y + 0.02, z + 0.0355);
    }
  }
  for (const x of [-0.25, 0, 0.25]) pipe(k, 0.03, 0.14, k.std(0xa0a5a9, 0.4, 0.75), 'y', x, H / 2 + 0.07, D * 0.5, { seg: 12 });
  const rust = decalMat(k, 'stain:rust1', () => sharedTex('stain:rust1', () => drawStain('rust', 1)), { opacity: 0.55 });
  k.plane(W * 0.9, 0.3, rust, 0, -H / 2 + 0.15, D + 0.0135);

  const seed = propSeed(k);
  let v = 0.8;
  let a = 0.4;
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    const mains = onMains(p);
    const sag = p === 'unstable' ? brownout(t, seed, false) : 1;
    const vt = mains ? 0.8 * (0.9 + 0.1 * sag) + Math.sin(t * 7.1) * 0.003 : 0;
    const at = mains ? 0.42 * sag + Math.sin(t * 2.3) * 0.01 : 0;
    v += (vt - v) * Math.min(1, dt * 5);
    a += (at - a) * Math.min(1, dt * 3);
    volts.rotation.z = gaugeAngle(v);
    amps.rotation.z = gaugeAngle(a);
    const lit = mains && sag > 0.6;
    for (const f of lamps) f(lit);
  });
}

/** Branch panel LP-2E, door swung open on the dead-front; the seven zone breakers and their LEDs track the store. */
function zonesPanel(k: PropKit): void {
  const W = 0.56;
  const H = 1.05;
  const D = 0.15;
  const T = 0.012;
  const body = paint(k);
  k.box(W, H, T, body, 0, 0, T / 2);
  k.box(T, H, D, body, -W / 2 + T / 2, 0, D / 2);
  k.box(T, H, D, body, W / 2 - T / 2, 0, D / 2);
  k.box(W, T, D, body, 0, H / 2 - T / 2, D / 2);
  k.box(W, T, D, body, 0, -H / 2 + T / 2, D / 2);
  const zf = D - 0.02;
  k.box(W - 2 * T, H - 2 * T, 0.004, k.std(0x9ea4aa, 0.5, 0.3), 0, 0, zf - 0.002);
  const black = k.std(0x161718, 0.5, 0.05);
  const slot = k.std(0x0b0b0c, 0.85);
  const rows = 12;
  const pitch = 0.05;
  const top = 0.33;
  k.rbox(0.22, 0.08, 0.03, black, 0, 0.44, zf + 0.015, 0.004);
  k.box(0.05, 0.03, 0.03, k.std(0x2a2b2d, 0.5), 0, 0.46, zf + 0.04);
  const handles: THREE.Mesh[] = [];
  const leds: ((on: boolean) => void)[] = [];
  const handleMat = k.std(0x2a2b2d, 0.5);
  for (const side of [-1, 1]) {
    const cx = side * 0.085;
    k.box(0.09, rows * pitch + 0.012, 0.004, slot, cx, top - ((rows - 1) * pitch) / 2, zf + 0.002);
    for (let r = 0; r < rows; r++) {
      const y = top - r * pitch;
      k.box(0.08, 0.042, 0.02, black, cx, y, zf + 0.01);
      const zone = side === -1 && r < ZONES.length;
      const hm = k.box(0.016, 0.016, 0.014, handleMat, cx - side * 0.012, y, zf + 0.026, { cast: false });
      if (zone) {
        handles.push(live(hm));
        leds.push(switcher(k.cyl(0.0045, 0.0045, 0.004, k.std(0x0d200f, 0.4), 0, y, zf + 0.002, { axis: 'z', seg: 10, cast: false }), k.glowMat(0x46ff70, 2.2), k.std(0x0d200f, 0.4)));
      }
    }
  }
  const dir = texMat(k, 'directory', () => sharedTex('directory', drawDirectory), { roughness: 0.7 });
  k.plane(0.16, 0.24, dir, 0, -0.37, zf + 0.001);
  const sleeve = k.phys('infra:sleeve', { color: 0xffffff, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false });
  k.plane(0.17, 0.25, sleeve, 0, -0.37, zf + 0.003, { keep: true });
  // the door has been left swung back on its left hinge, so the breaker rows face the room
  const ang = -1.75;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const P = (lx: number, ly: number, lz: number): [number, number, number] => [-W / 2 + lx * c + lz * s, ly, D - lx * s + lz * c];
  k.rbox(W, H, 0.016, body, ...P(W / 2, 0, 0.008), 0.004, { ry: ang });
  k.box(0.014, 0.06, 0.012, k.std(0xb9bdc1, 0.3, 0.9), ...P(W - 0.035, 0, 0.022), { ry: ang });
  plate(k, 'lp2e', ['LP-2E', 'EMERGENCY — LIFE SAFETY'], 0.24, 0.06, ...P(W / 2, H / 2 - 0.09, 0.0165), { ry: ang, bg: '#9c1c16' });
  for (const hy of [H / 2 - 0.12, -H / 2 + 0.12]) k.cyl(0.008, 0.008, 0.06, k.std(0x6d7175, 0.4, 0.7), -W / 2 - 0.004, hy, D + 0.004, { seg: 8 });

  const cxL = -0.085;
  k.onUpdate((dt) => {
    const st = k.s.store.get();
    const powered = st.power !== 'blackout';
    ZONES.forEach((z, i) => {
      const on = !!st.zones[z];
      leds[i]?.(powered && on);
      const h = handles[i];
      if (!h) return;
      const target = cxL + (on ? 0.012 : -0.012);
      h.position.x += (target - h.position.x) * Math.min(1, dt * 18);
    });
  });
}

/** Generator distribution panel EDP-1: UTILITY / GEN RUN / ALARM lamps. */
function generatorPanel(k: PropKit): void {
  const W = 0.6;
  const H = 0.9;
  const D = 0.22;
  k.rbox(W, H, D, paint(k), 0, 0, D / 2, 0.01);
  k.rbox(W - 0.03, H - 0.03, 0.012, k.std(0x969ca2, 0.5, 0.35), 0, 0, D + 0.006, 0.004);
  const z = D + 0.012;
  plate(k, 'edp1', ['EDP-1  EMERGENCY DISTRIBUTION', 'FED FROM GENERATOR  480V'], 0.42, 0.07, 0, H / 2 - 0.08, z + 0.0005, { bg: '#9c1c16' });
  const util = pilot(k, 0xf2efe6, -0.16, 0.22, z);
  const run = pilot(k, 0x3cff6a, 0, 0.22, z);
  const alarm = pilot(k, 0xff3020, 0.16, 0.22, z);
  plate(k, 'lu', ['UTILITY'], 0.1, 0.024, -0.16, 0.17, z + 0.0005);
  plate(k, 'lg', ['GEN RUN'], 0.1, 0.024, 0, 0.17, z + 0.0005);
  plate(k, 'la', ['ALARM'], 0.1, 0.024, 0.16, 0.17, z + 0.0005);
  const arc = texMat(k, 'arcflash', () => sharedTex('arcflash', drawArcFlash), { roughness: 0.55 });
  k.plane(0.18, 0.124, arc, -0.1, -0.05, z + 0.0005);
  signPlane(k, 'DANGER — 480 VOLTS', 'warning', 0.2, 0.08, 0.12, -0.05, z + 0.0005);
  tHandle(k, W / 2 - 0.06, -0.1, z);
  const steel = k.std(0x8d9196, 0.35, 0.8);
  k.rbox(0.05, 0.045, 0.02, k.std(0xb08a2e, 0.35, 0.8), W / 2 - 0.06, -0.24, z + 0.03, 0.006);
  k.torus(0.016, 0.004, steel, W / 2 - 0.06, -0.205, z + 0.03, { seg: 12, arc: Math.PI });
  for (const x of [-0.18, 0.18]) pipe(k, 0.026, 0.12, k.std(0xa0a5a9, 0.4, 0.75), 'y', x, H / 2 + 0.06, D * 0.5, { seg: 12 });

  const seed = propSeed(k);
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    const sag = p === 'unstable' ? brownout(t, seed, gentle(k)) : 1;
    util(onMains(p) && sag > 0.6);
    run(generatorRunning(k));
    alarm((p === 'blackout' && t % 1.2 < 0.6) || (p === 'unstable' && t % 2 < 0.25));
  });
}

const breakerPanel: PropBuilder = (k) => {
  const kind = k.str('kind', 'zones');
  if (kind === 'main') mainPanel(k);
  else if (kind === 'generator') generatorPanel(k);
  else zonesPanel(k);
};

/**
 * Automatic transfer switch cabinet: 0.6 (x) x 0.9 (z) x 1.9 m, door on +z. NORMAL / EMERGENCY
 * lamps and the mechanical position flag behind the status window follow the power state.
 */
const transferSwitch: PropBuilder = (k) => {
  const W = 0.6;
  const D = 0.9;
  const H = 1.9;
  const body = paint(k);
  k.boxOn(W, 0.08, D, k.std(0x2a2c2e, 0.7, 0.2), 0, 0, 0);
  k.rbox(W, H - 0.08, D, body, 0, 0.08 + (H - 0.08) / 2, 0, 0.012);
  const z = D / 2;
  const door = k.std(0x969ca2, 0.5, 0.35);
  k.rbox(W - 0.04, H - 0.2, 0.016, door, 0, 0.08 + (H - 0.08) / 2, z + 0.008, 0.004);
  const zf = z + 0.016;
  for (const hy of [0.4, 1.6]) k.cyl(0.009, 0.009, 0.08, k.std(0x6d7175, 0.4, 0.7), -W / 2 + 0.012, hy, z + 0.01, { seg: 8 });
  tHandle(k, W / 2 - 0.07, 1.0, zf);
  plate(k, 'ats1', ['AUTOMATIC TRANSFER SWITCH', 'ATS-1  600A  480V  3Ø'], 0.4, 0.07, 0, 1.72, zf + 0.0005);
  // status window with the transfer mechanism's position flag behind it
  k.rbox(0.22, 0.14, 0.012, k.std(0x1c1d1f, 0.5, 0.2), 0, 1.42, zf + 0.006, 0.004);
  k.box(0.18, 0.1, 0.002, k.std(0x0e0f10, 0.8), 0, 1.42, zf + 0.0125);
  const flagN = live(plate(k, 'flagN', ['NORMAL'], 0.14, 0.045, 0, 1.42, zf + 0.0138, { bg: '#2f7a3e', fg: '#f2f2ee' }));
  const flagE = live(plate(k, 'flagE', ['EMERGENCY'], 0.14, 0.045, 0, 1.42, zf + 0.0138, { bg: '#a3221a', fg: '#f2f2ee' }));
  flagE.visible = false;
  const win = k.phys('infra:atswindow', { color: 0xdfe8ea, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
  k.plane(0.19, 0.11, win, 0, 1.42, zf + 0.016, { keep: true });
  const normal = pilot(k, 0x52ff74, -0.1, 1.22, zf, 0.02);
  const emerg = pilot(k, 0xff3a22, 0.1, 1.22, zf, 0.02);
  plate(k, 'lnorm', ['NORMAL'], 0.12, 0.028, -0.1, 1.165, zf + 0.0005);
  plate(k, 'lemer', ['EMERGENCY'], 0.12, 0.028, 0.1, 1.165, zf + 0.0005);
  // controller with a dim display and a selector switch
  k.rbox(0.2, 0.14, 0.03, k.std(0x1b1c1e, 0.5, 0.15), 0, 0.98, zf + 0.015, 0.006);
  const lcdTex = (on: boolean): THREE.MeshStandardMaterial => k.shared(`infra:atslcd:${on}`, () => {
    const t = sharedTex('atslcd', () => drawLcd(['SRC1 480V  OK', 'XFER TIMER  0s', 'EXERCISE  WK'], { w: 256, h: 96, bg: '#5d7a8c', fg: '#0f1a22' }));
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, emissive: on ? 0xffffff : 0x000000, emissiveMap: t, emissiveIntensity: on ? 0.55 : 0 });
  });
  const lcd = switcher(k.plane(0.12, 0.045, lcdTex(false), 0, 1.0, zf + 0.0305), lcdTex(true), lcdTex(false));
  k.cyl(0.018, 0.018, 0.02, k.std(0x161718, 0.5), 0, 0.94, zf + 0.04, { axis: 'z', seg: 12 });
  k.box(0.006, 0.03, 0.01, k.std(0xe0e0dc, 0.5), 0, 0.94, zf + 0.052, { rz: -0.6 });
  const arc = texMat(k, 'arcflash', () => sharedTex('arcflash', drawArcFlash), { roughness: 0.55 });
  k.plane(0.2, 0.138, arc, 0, 0.66, zf + 0.0005);
  // stamped side louvres
  const louvre = k.std(0x7a8086, 0.55, 0.35);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) k.box(0.01, 0.012, 0.3, louvre, sx * (W / 2 + 0.003), 0.35 + i * 0.03, 0.12, { rz: sx * 0.5 });
    for (let i = 0; i < 6; i++) k.box(0.01, 0.012, 0.3, louvre, sx * (W / 2 + 0.003), 1.5 + i * 0.03, 0.12, { rz: sx * 0.5 });
  }
  const up = toCeiling(k, 0.4);
  const emt = k.std(0xa0a5a9, 0.4, 0.75);
  if (up > H + 0.05) for (const [x, zz] of [[-0.15, -0.2], [0.05, -0.25], [0.18, 0.05]]) pipe(k, 0.032, up - H, emt, 'y', x, H + (up - H) / 2, zz, { seg: 12 });
  const scuff = decalMat(k, 'stain:dirt2', () => sharedTex('stain:dirt2', () => drawStain('dirt', 2)), { opacity: 0.5 });
  k.plane(W * 0.9, 0.35, scuff, 0, 0.25, zf + 0.0006);

  const seed = propSeed(k);
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    const gen = generatorRunning(k);
    const sag = p === 'unstable' ? brownout(t, seed, gentle(k)) : 1;
    normal(onMains(p) && sag > 0.6);
    emerg(gen && (p === 'generator' || t % 0.5 < 0.25));
    lcd(p !== 'blackout');
    const onEmergency = p === 'generator' || p === 'blackout';
    flagN.visible = !onEmergency;
    flagE.visible = onEmergency;
  });
};

/** Diesel day tank on saddles in a containment basin; long along local z. */
const fuelTank: PropBuilder = (k) => {
  const fp = k.def.footprint ?? { w: 1.2, d: 1.8 };
  const BW = Math.min(fp.w, fp.d);
  const BL = Math.max(fp.w, fp.d);
  const BH = 0.32;
  const T = 0.008;
  const basin = k.std(0x3b3f3c, 0.7, 0.4);
  k.boxOn(BW, T, BL, basin, 0, 0, 0);
  k.boxOn(T, BH, BL, basin, -BW / 2 + T / 2, 0, 0);
  k.boxOn(T, BH, BL, basin, BW / 2 - T / 2, 0, 0);
  k.boxOn(BW, BH, T, basin, 0, 0, -BL / 2 + T / 2);
  k.boxOn(BW, BH, T, basin, 0, 0, BL / 2 - T / 2);
  const rim = k.std(0xb59a2a, 0.6, 0.3);
  k.box(BW + 0.012, 0.02, 0.03, rim, 0, BH, -BL / 2);
  k.box(BW + 0.012, 0.02, 0.03, rim, 0, BH, BL / 2);
  k.box(0.03, 0.02, BL, rim, -BW / 2, BH, 0);
  k.box(0.03, 0.02, BL, rim, BW / 2, BH, 0);
  const oil = decalMat(k, 'stain:oil3', () => sharedTex('stain:oil3', () => drawStain('oil', 3)), { opacity: 0.85, roughness: 0.12 });
  k.plane(BW * 0.8, BL * 0.6, oil, 0.05, T + 0.001, 0.1, { rx: -Math.PI / 2 });

  const R = Math.min(0.42, BW * 0.36);
  const L = BL * 0.82;
  const cy = BH + 0.1 + R;
  const tank = k.std(0x4d5650, 0.5, 0.35);
  const steel = k.std(0x55595c, 0.55, 0.5);
  for (const sz of [-L * 0.3, L * 0.3]) {
    k.boxOn(R * 1.7, BH + 0.1 + R * 0.4 - T, 0.12, steel, 0, T, sz);
    k.torus(R + 0.006, 0.012, steel, 0, cy, sz, { arc: Math.PI, rz: Math.PI, seg: 24 });
  }
  pipe(k, R, L, tank, 'z', 0, cy, 0, { seg: 24 });
  for (const sz of [-1, 1]) {
    const head = k.sphere(R, tank, 0, cy, sz * L / 2, { seg: 20 });
    head.scale.z = 0.22;
    k.torus(R + 0.002, 0.008, steel, 0, cy, sz * L / 2, { seg: 28 });
  }
  // sight gauge on the -x side
  const gx = -R - 0.06;
  const brass = k.std(0x9c7c3c, 0.4, 0.85);
  const sx = -Math.sqrt(R * R - (0.75 * R) ** 2) + 0.01;
  for (const gy of [cy - R * 0.75, cy + R * 0.75]) {
    pipe(k, 0.01, sx - gx, brass, 'x', (gx + sx) / 2, gy, L * 0.3, { seg: 8 });
    k.box(0.03, 0.03, 0.03, brass, gx, gy, L * 0.3);
  }
  const glassH = R * 1.5 - 0.03;
  const glass = k.phys('infra:sightglass', { color: 0xe8f0ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.25, depthWrite: false });
  k.cyl(0.013, 0.013, glassH, glass, gx, cy, L * 0.3, { seg: 10, keep: true });
  const fuelH = glassH * 0.58;
  k.cyl(0.01, 0.01, fuelH, k.std(0x8a5a12, 0.15, 0, { emissive: 0x1a0d00, emissiveIntensity: 0.4 }), gx, cy - glassH / 2 + fuelH / 2, L * 0.3, { seg: 10 });
  const scale = texMat(k, 'sightscale', () => sharedTex('sightscale', () => drawSmallLabel(['FULL', '3/4', '1/2', '1/4', 'EMPTY'], { w: 64, h: 256, bg: '#efeee6' })), { roughness: 0.6 });
  k.plane(0.04, glassH, scale, gx - 0.0005, cy, L * 0.3 + 0.03, { ry: -Math.PI / 2 });
  // fill cap, vent riser to the ceiling, level gauge
  const black = k.std(0x1d1e20, 0.6, 0.3);
  pipe(k, 0.04, 0.12, steel, 'y', 0.1, cy + R + 0.03, L * 0.32, { seg: 12 });
  k.cyl(0.052, 0.052, 0.035, black, 0.1, cy + R + 0.105, L * 0.32, { seg: 14 });
  const up = toCeiling(k, 3);
  const galv = k.std(0xa3a8ac, 0.45, 0.75);
  pipe(k, 0.025, up - (cy + R - 0.03), galv, 'y', -0.12, (cy + R - 0.03 + up) / 2, -L * 0.35, { seg: 10 });
  k.cyl(0.04, 0.04, 0.03, galv, -0.12, cy + R + 0.4, -L * 0.35, { seg: 12 });
  k.cyl(0.06, 0.06, 0.01, galv, -0.12, up - 0.005, -L * 0.35, { seg: 14 });
  k.cyl(0.055, 0.055, 0.05, black, 0.08, cy + R + 0.02, -L * 0.15, { seg: 16 });
  const dial = texMat(k, 'gauge:fuel', () => sharedTex('gauge:fuel', () => drawGauge('FUEL %', 100, 0.92, [0.25, 0.9])), { roughness: 0.5 });
  k.plane(0.08, 0.08, dial, 0.08, cy + R + 0.0455, -L * 0.15, { rx: -Math.PI / 2, rz: -Math.PI / 2 });
  // supply / return lines over the basin wall into the floor trench
  const iron = k.std(0x26272a, 0.6, 0.5);
  for (const [i, zz] of [[0, -L * 0.1], [1, L * 0.02]] as const) {
    const r = i === 0 ? 0.016 : 0.012;
    k.tube([[-R * 0.8, cy - R * 0.6, zz], [-BW / 2 + 0.06, cy - R * 0.6, zz], [-BW / 2 - 0.05, BH + 0.06, zz], [-BW / 2 - 0.08, 0.02, zz]], r, iron, { seg: 8 });
    k.cyl(0.04, 0.04, 0.01, steel, -BW / 2 - 0.08, 0.005, zz, { seg: 12 });
  }
  // transfer pump on the basin floor
  k.cyl(0.07, 0.07, 0.2, k.std(0x2e4a6a, 0.5, 0.3), 0.25, T + 0.08, BL / 2 - 0.2, { axis: 'x', seg: 14 });
  k.rbox(0.1, 0.1, 0.1, brass, 0.1, T + 0.07, BL / 2 - 0.2, 0.01);
  k.tube([[0.25, T + 0.15, BL / 2 - 0.2], [0.3, BH + 0.4, BL / 2 - 0.12], [0.3, up, BL / 2 - 0.12]], 0.012, k.std(0x5d6064, 0.6, 0.6), { seg: 6 });
  // placards on a bracket rising from the -x basin wall
  k.boxOn(0.006, 0.4, 0.28, steel, -BW / 2 - 0.004, BH - 0.05, -L * 0.25);
  const nfpa = texMat(k, 'nfpa', () => sharedTex('nfpa', drawNfpa), { roughness: 0.55 });
  k.plane(0.2, 0.233, nfpa, -BW / 2 - 0.0075, BH + 0.2, -L * 0.25, { ry: -Math.PI / 2 });
  plate(k, 'daytank', ['DAY TANK  275 GAL', 'DIESEL No.2'], 0.24, 0.05, -BW / 2 - 0.0075, BH + 0.03, -L * 0.25, { ry: -Math.PI / 2, bg: '#202224' });
};

export const POWER_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  breaker_panel: breakerPanel,
  transfer_switch: transferSwitch,
  fuel_tank: fuelTank,
};
