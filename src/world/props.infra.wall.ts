/**
 * Wall-mounted infra props: clocks, signage (plates, wayfinding, channel letters, metal letters,
 * elevator call plate), exit signs, badge readers, extinguishers, boards and posters.
 * Origin = wall surface at the item's vertical centre; the item protrudes toward +z.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawClockFace, drawLedClock, drawLetterMask, type LetterBox } from './props.infra.tex';
import { drawExtinguisherSign, drawSmallLabel, drawStreak } from './props.infra.tex2';
import { PowerFade, brownout, decalMat, gameClock, gentle, halfSpanX, live, makeCnv, onMains, ownStd, powerOf, propSeed, sharedTex, switcher, texMat, toCeiling, toTexture } from './props.infra.util';

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

function analogClock(k: PropKit): void {
  const R = k.num('radius', 0.165);
  const D = 0.055;
  const shell = k.std(0x1d1e20, 0.42, 0.1);
  k.cyl(R * 0.97, R * 0.9, D * 0.8, shell, 0, 0, D * 0.4, { axis: 'z', seg: 32 });
  k.torus(R - 0.009, 0.012, shell, 0, 0, D * 0.84, { seg: 40 });
  const face = texMat(k, 'clockface', () => sharedTex('clockface', drawClockFace), { roughness: 0.75 });
  k.mesh(k.geo(`infra:clockdisc:${R.toFixed(3)}`, () => new THREE.CircleGeometry(R - 0.012, 48)), face, 0, 0, D * 0.62, { cast: false });

  const hub = live(k.sub(0, 0, D * 0.64, 'clock_hands'));
  const black = k.std(0x131416, 0.5, 0.2);
  const red = k.std(0xa3221a, 0.45, 0.1);
  const hand = (len: number, w: number, tail: number, mat: THREE.Material, z: number): THREE.Group => {
    const g = k.sub(0, 0, z, undefined, hub);
    k.box(w, len + tail, 0.0016, mat, 0, (len - tail) / 2, 0, { parent: g, cast: false });
    return g;
  };
  const hourG = hand(R * 0.52, 0.012, 0.022, black, 0.001);
  const minG = hand(R * 0.8, 0.0085, 0.026, black, 0.0035);
  const secG = hand(R * 0.86, 0.0024, 0.045, red, 0.006);
  k.cyl(0.0075, 0.0075, 0.0018, red, 0, -0.036, 0, { axis: 'z', parent: secG, cast: false });
  k.cyl(0.006, 0.006, 0.012, black, 0, 0, 0.004, { axis: 'z', parent: hub, cast: false });

  const Rs = R * 2.2;
  const theta = Math.asin((R - 0.008) / Rs);
  const rimZ = D * 0.9;
  const dome = k.geo(`infra:clockdome:${R.toFixed(3)}`, () => new THREE.SphereGeometry(Rs, 32, 6, 0, Math.PI * 2, 0, theta));
  const glass = k.phys('infra:clockglass', { color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 1, depthWrite: false });
  k.mesh(dome, glass, 0, 0, rimZ - Rs * Math.cos(theta), { rx: Math.PI / 2, cast: false, keep: true });

  let frozen: number | null = null;
  let lag = 0;
  let lastT = -1;
  k.onUpdate(() => {
    const st = k.s.store.get();
    const t = st.time;
    if (t < lastT - 1) {
      frozen = null;
      lag = 0;
    }
    lastT = t;
    // a synchronous mains clock: stops dead with the power and resumes late if it ever returns
    const powered = onMains(st.power);
    if (!powered && frozen === null) frozen = t - lag;
    if (powered && frozen !== null) {
      lag = t - frozen;
      frozen = null;
    }
    const { h, m, s } = gameClock(frozen ?? t - lag);
    hourG.rotation.z = -(((h % 12) + m / 60) / 12) * Math.PI * 2;
    minG.rotation.z = -(m / 60) * Math.PI * 2;
    secG.rotation.z = -(s / 60) * Math.PI * 2;
  });
}

function digitalClock(k: PropKit): void {
  const W = 0.42;
  const H = 0.15;
  const D = 0.05;
  k.rbox(W, H, D, k.std(0x17181a, 0.5, 0.15), 0, 0, D / 2, 0.012);
  k.box(0.03, 0.006, 0.01, k.std(0x2a2b2e, 0.5, 0.2), W * 0.3, H / 2 + 0.002, D * 0.5);
  k.box(0.03, 0.006, 0.01, k.std(0x2a2b2e, 0.5, 0.2), W * 0.38, H / 2 + 0.002, D * 0.5);
  const cnv = makeCnv(512, 160);
  const tex = k.own(toTexture(cnv, { mips: false }));
  const mat = ownStd(k, { map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.45, metalness: 0 });
  live(k.plane(W - 0.03, H - 0.03, mat, 0, 0, D + 0.0006, { name: 'clock_digits' }));
  const lens = k.phys('infra:ledlens', { color: 0x3a0a08, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.42, depthWrite: false });
  k.plane(W - 0.022, H - 0.022, lens, 0, 0, D + 0.0022, { keep: true });

  const seed = propSeed(k);
  const fade = new PowerFade(true, seed);
  let clockT = 0;
  let lost = false;
  let lastT = -1;
  let lastKey = '';
  const draw = (key: string, text: string, lit: boolean, colon: boolean, pm: boolean): void => {
    if (key === lastKey) return;
    lastKey = key;
    drawLedClock(cnv, text, { lit, colon, pm });
    tex.needsUpdate = true;
  };
  k.onUpdate((dt) => {
    clockT += dt;
    const st = k.s.store.get();
    if (st.time < lastT - 1) lost = false;
    lastT = st.time;
    if (st.power === 'blackout') lost = true;
    const powered = st.power !== 'blackout';
    fade.set(powered);
    const level = fade.step(dt, clockT, st.power === 'unstable', gentle(k));
    mat.emissiveIntensity = 1.15 * level;
    if (!powered) {
      if (level <= 0.001) draw('off', '88:88', false, false, false);
      return;
    }
    if (lost) {
      // lost its time in the outage: blinks 12:00 until somebody sets it
      const on = clockT % 1 < 0.5;
      draw(on ? 'reset:on' : 'reset:off', '12:00', on, on, false);
      return;
    }
    const ts = k.screenTime();
    const hh = Number(ts.slice(0, 2));
    const h12 = hh % 12 || 12;
    const text = `${h12 < 10 ? ' ' : ''}${h12}:${ts.slice(3, 5)}`;
    const colon = clockT % 1 < 0.5;
    draw(`${text}|${colon ? 1 : 0}`, text, true, colon, hh >= 12);
  });
}

const clock: PropBuilder = (k) => {
  if (k.bool('digital', false)) digitalClock(k);
  else analogClock(k);
};

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

function roomNumber(k: PropKit, text: string): void {
  const s = k.num('w', 0.22);
  k.rbox(s, s, 0.008, k.std(0x2b2f33, 0.5, 0.1), 0, 0, 0.004, 0.005);
  k.sign(text, 'room_number', s - 0.01, s - 0.01, 0, 0, 0.0084);
}

function wayfinding(k: PropKit, text: string): void {
  const w = Math.min(k.num('w', 2.4), 2 * halfSpanX(k));
  const h = k.num('h', 0.32);
  const anod = k.std(0x2b3036, 0.42, 0.45);
  const alu = k.std(0x9a9fa4, 0.35, 0.8);
  if (k.bool('hanging', false)) {
    k.rbox(w, h, 0.03, anod, 0, 0, 0, 0.006);
    k.sign(text, 'wayfinding', w - 0.02, h - 0.02, 0, 0, 0.0155);
    k.sign(text, 'wayfinding', w - 0.02, h - 0.02, 0, 0, -0.0155, { ry: Math.PI });
    const up = toCeiling(k);
    for (const x of [-w * 0.36, w * 0.36]) {
      k.cyl(0.004, 0.004, up - h / 2, alu, x, (h / 2 + up) / 2, 0, { seg: 8 });
      k.cyl(0.025, 0.025, 0.008, alu, x, up - 0.004, 0, { seg: 16 });
    }
    return;
  }
  k.rbox(w, h, 0.03, anod, 0, 0, 0.015, 0.006);
  k.sign(text, 'wayfinding', w - 0.02, h - 0.02, 0, 0, 0.0305);
  k.box(w, 0.012, 0.034, alu, 0, h / 2 - 0.006, 0.017);
  k.box(w, 0.012, 0.034, alu, 0, -h / 2 + 0.006, 0.017);
}

function deptSign(k: PropKit, text: string): void {
  const w = Math.min(k.num('w', 0.9), 2 * halfSpanX(k));
  const h = k.num('h', 0.3);
  k.rbox(w, h, 0.012, k.std(0xd9d6ce, 0.5, 0.05), 0, 0, 0.022, 0.004);
  k.sign(text, 'dept', w - 0.008, h - 0.008, 0, 0, 0.0285);
  const steel = k.std(0xb0b4b8, 0.3, 0.85);
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.cyl(0.009, 0.009, 0.03, steel, x * (w / 2 - 0.03), y * (h / 2 - 0.03), 0.015, { axis: 'z', seg: 12 });
}

function warningSign(k: PropKit, text: string): void {
  const w = Math.min(k.num('w', 0.9), 2 * halfSpanX(k));
  const h = k.num('h', 0.36);
  const tilt = (k.rand() - 0.5) * 0.02;
  k.rbox(w, h, 0.003, k.std(0xa7a49a, 0.45, 0.5), 0, 0, 0.0015, 0.002, { rz: tilt });
  k.sign(text, 'warning', w, h, 0, 0, 0.0032, { rz: tilt });
  const screw = k.std(0x8e9296, 0.35, 0.8);
  const m = (h * 400 * 0.025 * 2.4) / 400;
  const c = Math.cos(tilt);
  const sn = Math.sin(tilt);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (w / 2 - m);
    const y = sy * (h / 2 - m);
    k.cyl(0.004, 0.004, 0.003, screw, x * c - y * sn, x * sn + y * c, 0.004, { axis: 'z', seg: 8 });
  }
  // the screws have wept rust down the wall for years
  const grime = decalMat(k, 'streak:rust', () => sharedTex('streak:rust', () => drawStreak('70,48,30', 3)), { opacity: 0.4 });
  k.plane(w * 0.9, h * 0.7, grime, 0, -h * 0.7, 0.0008);
}

/** Per-letter quad with its uv cut from the shared mask. */
function letterQuad(k: PropKit, b: LetterBox, W: number, H: number): THREE.BufferGeometry {
  const w = (b.u1 - b.u0) * W;
  const h = (b.v1 - b.v0) * H;
  const g = k.own(new THREE.PlaneGeometry(w, h));
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, b.u0 + uv.getX(i) * (b.u1 - b.u0), b.v0 + uv.getY(i) * (b.v1 - b.v0));
  g.translate(((b.u0 + b.u1) / 2 - 0.5) * W, ((b.v0 + b.v1) / 2 - 0.5) * H, 0);
  return g;
}

const MASKS = new Map<string, { tex: THREE.CanvasTexture; boxes: LetterBox[] }>();
function letterMask(text: string, W: number, H: number, weight: number, spacing: number): { tex: THREE.CanvasTexture; boxes: LetterBox[] } {
  const key = `${text}|${W}|${H}|${weight}|${spacing}`;
  let m = MASKS.get(key);
  if (!m) {
    const d = drawLetterMask(text, W, H, weight, spacing);
    m = { tex: toTexture(d.cnv, { srgb: false }), boxes: d.boxes };
    MASKS.set(key, m);
  }
  return m;
}

/** Illuminated channel letters on a raceway; one ageing letter flickers on its own. */
function channelLetters(k: PropKit, text: string): void {
  const W = k.num('w', 3.4);
  const H = k.num('h', 0.8);
  const { tex, boxes } = letterMask(text, 2048, 512, 900, 0.1);
  k.rbox(W * 0.96, 0.16, 0.08, k.std(0x2a2422, 0.6, 0.35), 0, -H * 0.04, 0.04, 0.012);
  const ret = k.shared(`infra:chan:ret:${text}`, () => new THREE.MeshStandardMaterial({ color: 0x2b1512, roughness: 0.55, metalness: 0.35, alphaMap: tex, alphaTest: 0.5 }));
  const face = ownStd(k, { color: 0x5c0f0a, emissive: 0xff2a18, emissiveIntensity: 2.2, roughness: 0.32, alphaMap: tex, alphaTest: 0.5 });
  const odd = ownStd(k, { color: 0x5c0f0a, emissive: 0xff2a18, emissiveIntensity: 2.2, roughness: 0.32, alphaMap: tex, alphaTest: 0.5 });
  const oddIndex = boxes.length > 3 ? 1 + Math.floor(k.rand() * (boxes.length - 2)) : -1;
  boxes.forEach((b, i) => {
    for (let layer = 0; layer < 5; layer++) k.mesh(letterQuad(k, b, W, H), ret, 0, 0, 0.09 + layer * 0.022, { cast: layer === 0 });
    const m = k.mesh(letterQuad(k, b, W, H), i === oddIndex ? odd : face, 0, 0, 0.2, { cast: false });
    if (i === oddIndex) live(m);
  });
  const glowId = k.glow(0, -H * 0.1, 0.9, 0xff3020, 0.55);
  const seed = propSeed(k);
  const fade = new PowerFade(true, seed);
  let t = 0;
  let glowOn = true;
  k.onUpdate((dt) => {
    t += dt;
    const p = powerOf(k);
    fade.set(p !== 'blackout');
    const soft = gentle(k);
    const lv = fade.step(dt, t, p === 'unstable', soft);
    face.emissiveIntensity = 2.2 * lv;
    odd.emissiveIntensity = 2.2 * lv * (0.15 + 0.7 * brownout(t * 1.7 + 13.1, seed + 99, soft));
    const want = lv > 0.3;
    if (want !== glowOn) {
      glowOn = want;
      k.s.lighting.setGlow(glowId, want);
    }
  });
}

/** Brushed stainless letters pinned off the facade, with rain streaks running down beneath. */
function metalLetters(k: PropKit, text: string): void {
  const W = k.num('w', 6.0);
  const H = k.num('h', 0.5);
  const { tex } = letterMask(text, 2048, 176, 500, 0.12);
  const brushed = k.t.metalTexture({ brushed: true, tint: 0xb8bcc0, seed: 3 });
  const face = k.shared(`infra:metal:face:${text}`, () => {
    const map = brushed.clone();
    map.repeat.set(W, H);
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: 0xc9cdd1, map, roughness: 0.32, metalness: 0.9, alphaMap: tex, alphaTest: 0.5 });
  });
  const edge = k.shared(`infra:metal:edge:${text}`, () => new THREE.MeshStandardMaterial({ color: 0x6d7175, roughness: 0.45, metalness: 0.8, alphaMap: tex, alphaTest: 0.5 }));
  const quad = (): THREE.BufferGeometry => k.own(new THREE.PlaneGeometry(W, H));
  k.mesh(quad(), edge, 0, 0, 0.03, { cast: true });
  k.mesh(quad(), edge, 0, 0, 0.042, { cast: false });
  k.mesh(quad(), face, 0, 0, 0.054, { cast: false });
  const streak = decalMat(k, 'streak:rain', () => sharedTex('streak:rain', () => drawStreak('22,24,26', 7)), { opacity: 0.55 });
  k.plane(W * 0.96, 0.9, streak, 0, -H / 2 - 0.4, 0.002);
}

/** Brushed call-button plate; the halo rings light per setScreen('up' | 'down' | 'both' | 'idle'). */
function elevatorCall(k: PropKit, text: string): void {
  const W = k.num('w', 0.13);
  const H = W * 2;
  k.rbox(W + 0.006, H + 0.006, 0.004, k.std(0x9ea3a8, 0.32, 0.85), 0, 0, 0.002, 0.002);
  k.sign(text, 'elevator_call', W, H, 0, 0, 0.0042);
  const hasUp = text.includes('▲') || !text.includes('▼');
  const hasDown = text.includes('▼') || !text.includes('▲');
  const r = W * 0.17 * 0.95;
  const lit = k.glowMat(0xffc878, 2.4);
  const dark = k.std(0x55585c, 0.35, 0.8);
  const ring = (y: number): ((on: boolean) => void) => switcher(k.torus(r, 0.0016, dark, 0, y, 0.0052, { seg: 32, cast: false }), lit, dark);
  const up = hasUp ? ring(H / 2 - 0.33 * H) : null;
  const down = hasDown ? ring(H / 2 - 0.57 * H) : null;
  let mode = 'idle';
  k.onScreen((m) => {
    mode = m;
  });
  k.onUpdate(() => {
    const powered = powerOf(k) !== 'blackout';
    up?.(powered && (mode === 'up' || mode === 'both'));
    down?.(powered && (mode === 'down' || mode === 'both'));
  });
}

const signBoard: PropBuilder = (k) => {
  const kind = k.str('kind', 'dept');
  const text = k.str('text', '');
  switch (kind) {
    case 'room_number':
      return roomNumber(k, text);
    case 'wayfinding':
      return wayfinding(k, text);
    case 'warning':
      return warningSign(k, text);
    case 'big_red':
      return channelLetters(k, text || 'EMERGENCY');
    case 'hospital_name':
      return metalLetters(k, text || 'ST. AUGUSTINE REGIONAL MEDICAL CENTER');
    case 'elevator_call':
      return elevatorCall(k, text || '▲ ▼');
    case 'exit':
      return exitSign(k);
    default:
      return deptSign(k, text);
  }
};

// ---------------------------------------------------------------------------
// Exit sign, badge reader, extinguisher
// ---------------------------------------------------------------------------

/** Battery-backed exit sign; params.double = two faces hung from the ceiling on a stem. */
function exitSign(k: PropKit): void {
  const text = k.str('text', 'EXIT');
  const double = k.bool('double', false);
  const W = 0.34;
  const H = 0.21;
  const D = 0.055;
  const shell = k.std(0xd8d7d0, 0.55, 0.02);
  const z = double ? 0 : D / 2;
  k.rbox(W, H, D, shell, 0, 0, z, 0.01);
  k.sign(text, 'exit', W - 0.04, H - 0.05, 0, -0.005, z + D / 2 + 0.0006, { emissive: 1.6 });
  if (double) {
    k.sign(text, 'exit', W - 0.04, H - 0.05, 0, -0.005, -D / 2 - 0.0006, { emissive: 1.6, ry: Math.PI });
    const up = toCeiling(k);
    k.cyl(0.008, 0.008, up - H / 2, shell, 0, (H / 2 + up) / 2, 0, { seg: 8 });
    k.cyl(0.05, 0.05, 0.012, shell, 0, up - 0.006, 0, { seg: 20 });
  }
  const led = k.box(0.006, 0.006, 0.003, k.std(0x0c1a0c, 0.4), W / 2 - 0.025, H / 2 - 0.018, z + D / 2 + 0.0015, { cast: false });
  const setLed = switcher(led, k.glowMat(0x4cff6a, 1.6), k.std(0x0c1a0c, 0.4));
  k.onUpdate(() => setLed(powerOf(k) !== 'blackout'));
}

/** Proximity badge reader: dim red idle, green flash on 'ok', three red blinks on 'deny', dark in a blackout. */
const badgeReader: PropBuilder = (k) => {
  k.rbox(0.074, 0.12, 0.006, k.std(0x2a2c2f, 0.6, 0.25), 0, 0, 0.003, 0.004);
  k.rbox(0.058, 0.106, 0.022, k.std(0x131415, 0.42, 0.05), 0, 0, 0.017, 0.008);
  const grey = k.std(0x5a5e62, 0.5, 0.2);
  for (const r of [0.008, 0.013, 0.018]) k.torus(r, 0.0007, grey, -0.006, -0.012, 0.0285, { arc: Math.PI / 2, rz: -Math.PI / 4, seg: 10, cast: false });
  const lbl = texMat(k, 'badge:label', () => sharedTex('badge:label', () => drawSmallLabel(['PRESENT', 'BADGE'], { w: 128, h: 48, bg: '#1a1b1d', fg: '#9ea2a6' })), { roughness: 0.6 });
  k.plane(0.04, 0.015, lbl, 0, -0.04, 0.0284);
  const led = k.rbox(0.026, 0.005, 0.003, k.std(0x220a08, 0.4), 0, 0.04, 0.0285, 0.0015, { cast: false });
  const idle = k.glowMat(0xff2414, 0.65);
  const red = k.glowMat(0xff2414, 2.8);
  const green = k.glowMat(0x3cff6a, 2.8);
  const off = k.std(0x220a08, 0.4);
  live(led);
  led.material = idle;
  const set = (m: THREE.Material): void => {
    if (led.material !== m) led.material = m;
  };
  let mode: 'idle' | 'ok' | 'deny' = 'idle';
  let t = 0;
  let clockT = 0;
  const seed = propSeed(k);
  k.onScreen((m) => {
    mode = m === 'ok' ? 'ok' : m === 'deny' ? 'deny' : 'idle';
    t = 0;
  });
  k.onUpdate((dt) => {
    t += dt;
    clockT += dt;
    if (mode === 'ok' && t > 0.8) mode = 'idle';
    if (mode === 'deny' && t > 0.75) mode = 'idle';
    const p = powerOf(k);
    if (p === 'blackout') return set(off);
    if (mode === 'ok') return set(green);
    if (mode === 'deny') return set(Math.floor(t / 0.125) % 2 === 0 ? red : off);
    set(p === 'unstable' && brownout(clockT, seed, gentle(k)) < 0.7 ? off : idle);
  });
};

/** 10 lb ABC extinguisher on a strap bracket, with a flag locator sign projecting above it. */
const fireExtinguisher: PropBuilder = (k) => {
  const zc = 0.078;
  const red = k.std(0x9a1a13, 0.3, 0.05);
  k.lathe([[0, -0.215], [0.048, -0.212], [0.062, -0.2], [0.065, -0.18], [0.065, 0.15], [0.06, 0.18], [0.044, 0.2], [0.02, 0.21], [0.018, 0.226]], red, 0, 0, zc, { seg: 20 });
  const lbl = texMat(k, 'ext:label', () => sharedTex('ext:label', () => drawSmallLabel(['ABC', 'DRY CHEMICAL', '10 LB  UL 4-A:80-B:C'], { w: 128, h: 160, bg: '#efe9d8', fg: '#1d1d1d' })), { roughness: 0.6 });
  k.mesh(k.geo('infra:extlabel', () => new THREE.CylinderGeometry(0.0656, 0.0656, 0.11, 10, 1, true, -0.62, 1.24)), lbl, 0, 0, zc, { cast: false });
  const chrome = k.std(0xc4c8cc, 0.25, 0.9);
  const black = k.std(0x161616, 0.55, 0.1);
  k.cyl(0.016, 0.018, 0.03, chrome, 0, 0.24, zc, { seg: 12 });
  k.box(0.12, 0.012, 0.02, black, 0.035, 0.252, zc, { rz: -0.12 });
  k.box(0.11, 0.01, 0.018, chrome, 0.03, 0.272, zc, { rz: -0.32 });
  k.cyl(0.012, 0.012, 0.012, chrome, 0, 0.243, zc + 0.022, { axis: 'z', seg: 14 });
  k.plane(0.018, 0.018, k.std(0xeeeeea, 0.4), 0, 0.243, zc + 0.0285, { cast: false });
  k.torus(0.008, 0.0016, k.std(0xd6c21a, 0.5), 0.02, 0.262, zc + 0.012, { seg: 10 });
  k.tube([[0.02, 0.236, zc + 0.008], [0.06, 0.22, zc + 0.01], [0.075, 0.12, zc + 0.02], [0.074, -0.02, zc + 0.03], [0.07, -0.09, zc + 0.03]], 0.0065, black, { seg: 6 });
  k.cyl(0.009, 0.006, 0.05, black, 0.07, -0.115, zc + 0.03, { seg: 8 });
  const steel = k.std(0x55595d, 0.45, 0.7);
  k.box(0.045, 0.2, 0.004, steel, 0, 0.13, 0.002);
  k.box(0.03, 0.03, 0.03, steel, 0, 0.215, 0.018);
  k.torus(0.068, 0.0035, steel, 0, 0.02, zc, { rx: Math.PI / 2, arc: Math.PI, seg: 20 });
  k.box(0.035, 0.06, 0.0008, k.std(0xe6d36a, 0.7), 0.045, 0.19, zc + 0.05, { rz: 0.2, cast: false });
  const sign = texMat(k, 'ext:sign', () => sharedTex('ext:sign', drawExtinguisherSign), { roughness: 0.5 });
  const sy = 0.55;
  k.box(0.004, 0.13, 0.26, k.std(0xb3241b, 0.5), 0, sy, 0.15);
  k.plane(0.25, 0.125, sign, 0.0022, sy, 0.15, { ry: Math.PI / 2 });
  k.plane(0.25, 0.125, sign, -0.0022, sy, 0.15, { ry: -Math.PI / 2 });
  k.box(0.02, 0.15, 0.02, steel, 0, sy, 0.01);
};

// ---------------------------------------------------------------------------
// Boards and posters
// ---------------------------------------------------------------------------

const BOARD_KINDS = new Set(['notices', 'assignments', 'evs_schedule', 'schedule']);
const BOARD_SIZE: Record<string, number> = { assignments: 1.8, notices: 1.2, evs_schedule: 1.2, schedule: 1.0 };

/** Framed board using posterTexture(kind) (2:1); dry-wipe boards get a marker tray. */
function board(k: PropKit, kind: string): void {
  const w = Math.min(k.num('w', BOARD_SIZE[kind] ?? 1.2), 2 * halfSpanX(k));
  const h = w / 2;
  const wipe = kind !== 'notices';
  k.box(w, h, 0.012, k.std(0x34373a, 0.85), 0, 0, 0.006);
  const face = texMat(k, `board:${kind}`, () => k.t.posterTexture(kind), { roughness: wipe ? 0.2 : 0.92 });
  k.plane(w, h, face, 0, 0, 0.0122);
  const alu = k.std(0xa9adb1, 0.35, 0.8);
  k.rbox(w + 0.04, 0.022, 0.024, alu, 0, h / 2 + 0.005, 0.012, 0.004);
  k.rbox(w + 0.04, 0.022, 0.024, alu, 0, -h / 2 - 0.005, 0.012, 0.004);
  k.rbox(0.022, h + 0.02, 0.024, alu, -w / 2 - 0.009, 0, 0.012, 0.004);
  k.rbox(0.022, h + 0.02, 0.024, alu, w / 2 + 0.009, 0, 0.012, 0.004);
  if (!wipe) return;
  const ty = -h / 2 - 0.03;
  k.rbox(w * 0.55, 0.012, 0.065, alu, 0, ty, 0.036, 0.004);
  k.box(w * 0.55, 0.02, 0.004, alu, 0, ty + 0.012, 0.067);
  const caps = [0x1d3f8f, 0x161616, 0xb3261e, 0x2e7d4f];
  const n = 2 + Math.floor(k.rand() * 3);
  for (let i = 0; i < n; i++) {
    const x = -w * 0.2 + i * 0.05 + k.rand() * 0.02;
    k.cyl(0.0075, 0.0075, 0.13, k.std(0xe8e8e4, 0.4), x, ty + 0.014, 0.035 + (k.rand() - 0.5) * 0.02, { axis: 'z', seg: 8, cast: false });
    k.cyl(0.0082, 0.0082, 0.03, k.std(caps[i % caps.length], 0.45), x, ty + 0.014, 0.035 + 0.075, { axis: 'z', seg: 8, cast: false });
  }
  k.rbox(0.12, 0.022, 0.05, k.std(0x2c2e31, 0.6), w * 0.17, ty + 0.017, 0.036, 0.006);
  k.box(0.118, 0.006, 0.048, k.std(0x5a5d61, 0.95), w * 0.17, ty + 0.006, 0.036);
}

const whiteboard: PropBuilder = (k) => board(k, k.str('kind', 'notices'));

/** Paper poster: taped with tired curling corners, or (params.frame) behind a snap frame. */
const poster: PropBuilder = (k) => {
  const kind = k.str('kind', 'flu');
  if (BOARD_KINDS.has(kind)) return board(k, kind);
  const w = k.num('w', 0.42);
  const h = w * 1.5;
  const framed = k.bool('frame', k.rand() < 0.4);
  const mat = texMat(k, `poster:${kind}`, () => k.t.posterTexture(kind), { roughness: 0.78 });
  const g = k.own(new THREE.PlaneGeometry(w, h, 6, 9));
  if (!framed) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const curlL = 0.008 + k.rand() * 0.02;
    const curlR = 0.008 + k.rand() * 0.02;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (w / 2);
      const y = pos.getY(i) / (h / 2);
      const bottom = Math.max(0, -y - 0.55) / 0.45;
      const side = x < 0 ? Math.max(0, -x - 0.5) / 0.5 : Math.max(0, x - 0.5) / 0.5;
      const curl = (x < 0 ? curlL : curlR) * bottom * bottom * side * side;
      const bulge = 0.0025 * (1 - x * x) * (1 - y * y);
      pos.setZ(i, curl + bulge);
    }
    g.computeVertexNormals();
  }
  k.mesh(g, mat, 0, 0, framed ? 0.004 : 0.0012, { cast: false });
  if (framed) {
    const alu = k.std(0xb0b4b8, 0.35, 0.8);
    k.rbox(w + 0.03, 0.018, 0.012, alu, 0, h / 2 + 0.006, 0.006, 0.003);
    k.rbox(w + 0.03, 0.018, 0.012, alu, 0, -h / 2 - 0.006, 0.006, 0.003);
    k.rbox(0.018, h + 0.03, 0.012, alu, -w / 2 - 0.006, 0, 0.006, 0.003);
    k.rbox(0.018, h + 0.03, 0.012, alu, w / 2 + 0.006, 0, 0.006, 0.003);
    const cover = k.phys('infra:snapcover', { color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.08, depthWrite: false });
    k.plane(w, h, cover, 0, 0, 0.0095, { keep: true });
    return;
  }
  const tape = k.std(0xe7e0c4, 0.45, 0, { transparent: true, opacity: 0.55, depthWrite: false });
  for (const [sx, sy, a] of [[-1, 1, 0.6], [1, 1, -0.55], [-1, -1, -0.6]] as const) {
    if (sy < 0 && k.rand() < 0.5) continue;
    k.plane(0.055, 0.02, tape, sx * (w / 2 - 0.012), sy * (h / 2 - 0.012), 0.0035, { rz: a, cast: false });
  }
};

export const WALL_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  clock,
  sign_board: signBoard,
  exit_sign: (k) => exitSign(k),
  badge_reader: badgeReader,
  fire_extinguisher: fireExtinguisher,
  whiteboard,
  poster,
};
