/**
 * Diesel standby generator on its skid, long along local x: alternator at -x, engine, radiator
 * with fan and guard at +x, controller on the +z side, insulated exhaust riser to the ceiling,
 * yellow/black guard rail and floor tape. While the generator carries the load (or cranks) the
 * engine shivers on its isolators, the fan spins up and the controller LEDs / meters come alive.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawLcd, gaugeAngle } from './props.infra.tex';
import { drawRadiatorCore, drawStain, drawStripes } from './props.infra.tex2';
import { meter, pilot, plate } from './props.infra.power';
import { signPlane, bakeInto, decalMat, generatorRunning, live, pipe, planeRep, powerOf, sharedTex, staging, switcher, texMat, toCeiling } from './props.infra.util';

/** Rail along x or z made of alternating yellow / black bands. */
function bandedRail(k: PropKit, axis: 'x' | 'z', a0: number, a1: number, y: number, c: number, r: number): void {
  const yellow = k.std(0xc29a24, 0.5, 0.2);
  const black = k.std(0x151515, 0.55, 0.2);
  const n = Math.max(2, Math.round(Math.abs(a1 - a0) / 0.25));
  const seg = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const m = a0 + seg * (i + 0.5);
    if (axis === 'x') pipe(k, r, Math.abs(seg), i % 2 ? black : yellow, 'x', m, y, c, { seg: 10 });
    else pipe(k, r, Math.abs(seg), i % 2 ? black : yellow, 'z', c, y, m, { seg: 10 });
  }
}

function buildEngine(k: PropKit, st: THREE.Group): void {
  const o = { parent: st };
  const green = k.std(0x36443b, 0.45, 0.25);
  const black = k.std(0x1b1c1e, 0.55, 0.2);
  const dark = k.std(0x2a2c2e, 0.6, 0.35);
  const steel = k.std(0x8a8e92, 0.4, 0.75);
  // alternator end
  k.boxOn(0.7, 0.06, 0.8, dark, -0.95, 0.22, 0, o);
  k.cyl(0.4, 0.4, 0.85, green, -0.95, 0.67, 0, { axis: 'x', seg: 24, ...o });
  k.cyl(0.36, 0.38, 0.08, green, -1.41, 0.67, 0, { axis: 'x', seg: 24, ...o });
  for (const r of [0.12, 0.2, 0.28]) k.torus(r, 0.008, black, -1.455, 0.67, 0, { ry: Math.PI / 2, seg: 24, ...o });
  k.rbox(0.34, 0.28, 0.42, green, -0.95, 1.2, 0, 0.012, o);
  plate(k, 'gennp', ['STANDBY GENSET  500 kW', '480V 3PH 60Hz  1800 RPM'], 0.28, 0.06, -0.95, 1.2, 0.211, o);
  k.cyl(0.36, 0.32, 0.14, green, -0.47, 0.67, 0, { axis: 'x', seg: 24, ...o });
  // engine block
  k.rbox(0.95, 0.16, 0.48, dark, 0.12, 0.3, 0, 0.02, o);
  k.rbox(1.1, 0.55, 0.6, green, 0.12, 0.62, 0, 0.025, o);
  k.rbox(1.05, 0.12, 0.44, green, 0.12, 0.955, 0, 0.015, o);
  k.rbox(1.0, 0.1, 0.3, black, 0.12, 1.065, 0.02, 0.03, o);
  for (let i = 0; i < 6; i++) k.cyl(0.012, 0.012, 0.02, steel, -0.28 + i * 0.16, 1.12, 0.02, { seg: 8, ...o });
  k.cyl(0.14, 0.14, 0.42, black, -0.22, 1.25, -0.05, { axis: 'z', seg: 18, ...o });
  k.cyl(0.145, 0.145, 0.03, steel, -0.22, 1.25, 0.17, { axis: 'z', seg: 18, ...o });
  // exhaust side: manifold, turbo, bellows
  k.box(0.85, 0.08, 0.08, k.std(0x5a4a3c, 0.8, 0.4), 0.12, 0.86, -0.33, o);
  for (let i = 0; i < 6; i++) k.box(0.05, 0.05, 0.06, k.std(0x5a4a3c, 0.8, 0.4), -0.25 + i * 0.15, 0.86, -0.29, o);
  k.torus(0.07, 0.04, k.std(0x4a4440, 0.7, 0.5), 0.5, 1.0, -0.36, { ry: Math.PI / 2, seg: 18, ...o });
  k.cyl(0.07, 0.07, 0.1, k.std(0x4a4440, 0.7, 0.5), 0.5, 1.0, -0.36, { axis: 'x', seg: 14, ...o });
  k.tube([[-0.22, 1.25, -0.27], [0.1, 1.2, -0.4], [0.42, 1.02, -0.38]], 0.05, black, { seg: 10, ...o });
  for (let i = 0; i < 9; i++) k.torus(0.078, 0.012, steel, 0.5, 1.1 + i * 0.045, -0.36, { rx: Math.PI / 2, seg: 18, ...o });
  k.cyl(0.07, 0.07, 0.42, steel, 0.5, 1.3, -0.36, { seg: 14, ...o });
  // accessories on the +z flank
  k.cyl(0.06, 0.06, 0.25, black, -0.3, 0.45, 0.33, { axis: 'x', seg: 12, ...o });
  k.cyl(0.05, 0.05, 0.15, k.std(0xd9d6cc, 0.5), 0.3, 0.45, 0.35, { seg: 12, ...o });
  k.cyl(0.08, 0.08, 0.15, k.std(0x9a9ea2, 0.4, 0.7), 0.6, 0.86, 0.27, { axis: 'x', seg: 14, ...o });
  k.torus(0.018, 0.004, k.std(0xe0b020, 0.5), 0.4, 1.0, 0.31, { seg: 10, ...o });
  // front pulleys and belt
  k.cyl(0.12, 0.12, 0.05, steel, 0.71, 0.5, 0, { axis: 'x', seg: 18, ...o });
  k.cyl(0.07, 0.07, 0.05, steel, 0.71, 0.86, 0.15, { axis: 'x', seg: 14, ...o });
  k.cyl(0.06, 0.06, 0.05, steel, 0.71, 0.86, -0.12, { axis: 'x', seg: 14, ...o });
  k.tube([[0.71, 0.38, 0], [0.71, 0.86, 0.22], [0.71, 0.93, 0.15], [0.71, 0.86, -0.18], [0.71, 0.38, 0]], 0.008, black, { seg: 5, ...o });
  // radiator: tanks, posts, core, shroud; hoses back to the engine
  k.rbox(0.22, 0.12, 1.25, dark, 1.45, 1.42, 0, 0.01, o);
  k.rbox(0.22, 0.12, 1.25, dark, 1.45, 0.3, 0, 0.01, o);
  for (const z of [-0.6, 0.6]) k.rbox(0.22, 1.24, 0.06, dark, 1.45, 0.86, z, 0.01, o);
  const core = texMat(k, 'radcore', () => sharedTex('radcore', drawRadiatorCore, { repeat: true }), { roughness: 0.7, metalness: 0.4 });
  planeRep(k, 1.14, 1.0, core, 8, 7, 1.5, 0.86, 0, { ry: Math.PI / 2, ...o });
  planeRep(k, 1.14, 1.0, core, 8, 7, 1.4, 0.86, 0, { ry: -Math.PI / 2, ...o });
  k.cyl(0.06, 0.06, 0.1, steel, 1.45, 1.53, 0.4, { seg: 12, ...o });
  k.torus(0.5, 0.025, dark, 1.6, 0.86, 0, { ry: Math.PI / 2, seg: 32, ...o });
  k.tube([[0.66, 0.95, 0.1], [1.0, 1.15, 0.12], [1.36, 1.38, 0.1]], 0.032, black, { seg: 10, ...o });
  k.tube([[0.6, 0.42, -0.12], [1.0, 0.36, -0.12], [1.36, 0.32, -0.1]], 0.032, black, { seg: 10, ...o });
}

function buildFan(k: PropKit, st: THREE.Group): void {
  const blade = k.std(0x1e1f21, 0.5, 0.3);
  k.cyl(0.075, 0.075, 0.08, k.std(0x55595d, 0.45, 0.6), 0, 0, 0, { axis: 'x', seg: 14, parent: st });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const g = new THREE.Group();
    g.rotation.x = a;
    st.add(g);
    k.box(0.012, 0.34, 0.12, blade, 0, 0.25, 0, { ry: 0.38, parent: g });
  }
}

const generator: PropBuilder = (k) => {
  const skid = k.std(0x2b2d2f, 0.6, 0.45);
  for (const z of [-0.5, 0.5]) k.boxOn(3.3, 0.16, 0.1, skid, 0, 0, z);
  for (const x of [-1.5, -0.5, 0.5, 1.5]) k.boxOn(0.08, 0.12, 0.92, skid, x, 0.02, 0);
  k.boxOn(3.2, 0.012, 0.9, k.std(0x232426, 0.75, 0.3), 0, 0.03, 0);
  const rubber = k.std(0x121212, 0.85);
  for (const [x, z] of [[-1.3, -0.42], [-1.3, 0.42], [1.3, -0.42], [1.3, 0.42], [0, -0.42], [0, 0.42]]) k.cyl(0.05, 0.055, 0.06, rubber, x, 0.19, z, { seg: 12 });
  const oil = decalMat(k, 'stain:oil5', () => sharedTex('stain:oil5', () => drawStain('oil', 5)), { opacity: 0.8, roughness: 0.15 });
  k.plane(2.0, 1.2, oil, 0.2, 0.003, 0.05, { rx: -Math.PI / 2 });

  // vibrating assembly (engine, alternator, radiator) on its isolators, plus the fan inside it
  const eng = k.sub(0, 0, 0, 'gen_engine');
  const est = staging();
  buildEngine(k, est);
  bakeInto(k, est, eng);
  const fan = k.sub(1.62, 0.86, 0, 'gen_fan', eng);
  const fst = staging();
  buildFan(k, fst);
  bakeInto(k, fst, fan);
  const guard = k.std(0x8a8e92, 0.45, 0.7);
  const gst = staging();
  for (const r of [0.14, 0.28, 0.42, 0.5]) k.torus(r, 0.004, guard, 1.69, 0.86, 0, { ry: Math.PI / 2, seg: 28, parent: gst });
  k.cyl(0.004, 0.004, 1.0, guard, 1.69, 0.86, 0, { seg: 6, parent: gst });
  k.cyl(0.004, 0.004, 1.0, guard, 1.69, 0.86, 0, { axis: 'z', seg: 6, parent: gst });
  bakeInto(k, gst, eng);

  // exhaust riser: lagged pipe with banding up through a ceiling thimble
  const up = toCeiling(k, 3.4);
  const lag = k.std(0xcfccc2, 0.85, 0);
  const band = k.std(0xa9adb1, 0.35, 0.8);
  const ry0 = 1.52;
  if (up > ry0 + 0.2) {
    pipe(k, 0.12, up - ry0, lag, 'y', 0.5, (ry0 + up) / 2, -0.36, { seg: 18 });
    for (let y = ry0 + 0.2; y < up - 0.1; y += 0.45) k.cyl(0.124, 0.124, 0.025, band, 0.5, y, -0.36, { seg: 18 });
    k.box(0.45, 0.012, 0.45, k.std(0x5c5f62, 0.6, 0.5), 0.5, up - 0.006, -0.36);
    const soot = decalMat(k, 'stain:soot6', () => sharedTex('stain:soot6', () => drawStain('soot', 6)), { opacity: 0.7 });
    k.plane(1.1, 1.1, soot, 0.5, up - 0.013, -0.36, { rx: Math.PI / 2 });
  }

  // controller on a stand at the +z side
  const stand = k.std(0x2e3033, 0.55, 0.4);
  for (const x of [-0.78, -0.32]) {
    k.boxOn(0.04, 1.16, 0.04, stand, x, 0, 0.6);
    k.boxOn(0.1, 0.008, 0.1, stand, x, 0, 0.6);
  }
  const cz = 0.62;
  k.rbox(0.54, 0.44, 0.16, k.std(0x2a2c2f, 0.5, 0.3), -0.55, 1.35, cz, 0.012);
  const zf = cz + 0.08;
  plate(k, 'genctl', ['GENERATOR CONTROL'], 0.24, 0.03, -0.55, 1.53, zf + 0.0005);
  const lcdMat = (on: boolean): THREE.MeshStandardMaterial => k.shared(`infra:genlcd:${on}`, () => {
    const t = on
      ? sharedTex('genlcd:on', () => drawLcd(['RUNNING  1800 RPM', '60.0 Hz   477 V', 'LOAD  41%   PF .82'], { w: 256, h: 96, bg: '#3f6f9c', fg: '#eaf2f8', glow: true }))
      : sharedTex('genlcd:off', () => drawLcd([''], { w: 64, h: 32, bg: '#0d1114', fg: '#0d1114' }));
    return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: on ? 0xffffff : 0x000000, emissiveIntensity: on ? 0.8 : 0, roughness: 0.4 });
  });
  const lcd = switcher(k.plane(0.18, 0.07, lcdMat(false), -0.66, 1.46, zf + 0.0006), lcdMat(true), lcdMat(false));
  const ledRun = pilot(k, 0x3cff6a, -0.74, 1.385, zf, 0.009);
  const ledAuto = pilot(k, 0xffb020, -0.66, 1.385, zf, 0.009);
  pilot(k, 0xffb020, -0.58, 1.385, zf, 0.009);
  pilot(k, 0xff3020, -0.5, 1.385, zf, 0.009);
  const oilN = meter(k, 'oilpsi', 'OIL PSI', 100, -0.74, 1.25, zf, 0.08);
  const tempN = meter(k, 'coolant', 'COOLANT F', 250, -0.55, 1.25, zf, 0.08);
  const voltN = meter(k, 'genvolts', 'AC VOLTS', 600, -0.36, 1.25, zf, 0.08);
  k.cyl(0.04, 0.04, 0.006, k.std(0xd6b21e, 0.5), -0.39, 1.46, zf + 0.003, { axis: 'z', seg: 16 });
  k.cyl(0.024, 0.026, 0.03, k.std(0xa31d16, 0.4), -0.39, 1.46, zf + 0.02, { axis: 'z', seg: 14 });
  k.cyl(0.012, 0.012, 0.02, k.std(0x1b1c1e, 0.5), -0.47, 1.46, zf + 0.01, { axis: 'z', seg: 10 });

  // battery box with cables up to the starter
  k.rbox(0.4, 0.24, 0.22, k.std(0x18191b, 0.7), 0.95, 0.28, 0.6, 0.015);
  k.box(0.42, 0.02, 0.24, k.std(0x222326, 0.6), 0.95, 0.41, 0.6);
  k.tube([[0.85, 0.42, 0.55], [0.6, 0.3, 0.45], [-0.25, 0.42, 0.38]], 0.012, k.std(0x8a1a14, 0.6), { seg: 6 });
  k.tube([[1.05, 0.42, 0.55], [0.7, 0.22, 0.48], [-0.35, 0.36, 0.4]], 0.012, k.std(0x111111, 0.6), { seg: 6 });

  // guard rail (open on the controller side) and hazard tape on the floor
  const posts: [number, number][] = [[-1.75, -0.75], [0, -0.75], [1.75, -0.75], [-1.75, 0.45], [1.75, 0.45]];
  for (const [x, z] of posts) {
    pipe(k, 0.026, 1.08, k.std(0xc29a24, 0.5, 0.2), 'y', x, 0.55, z, { seg: 10 });
    k.boxOn(0.12, 0.01, 0.12, k.std(0x151515, 0.6), x, 0, z);
  }
  for (const y of [0.55, 1.05]) {
    bandedRail(k, 'x', -1.75, 1.75, y, -0.75, 0.022);
    bandedRail(k, 'z', -0.75, 0.45, y, -1.75, 0.022);
    bandedRail(k, 'z', -0.75, 0.45, y, 1.75, 0.022);
  }
  signPlane(k, 'WARNING — EQUIPMENT STARTS AUTOMATICALLY', 'warning', 0.5, 0.2, 0.8, 0.8, -0.776, { ry: Math.PI });
  const tape = texMat(k, 'floortape', () => sharedTex('floortape', drawStripes, { repeat: true }), { roughness: 0.6 });
  const X = 1.92;
  const Z = 0.92;
  const tw = 0.06;
  planeRep(k, 2 * X, tw, tape, (2 * X) / 0.24, 1, 0, 0.002, -Z, { rx: -Math.PI / 2 });
  planeRep(k, 2 * X, tw, tape, (2 * X) / 0.24, 1, 0, 0.002, Z, { rx: -Math.PI / 2 });
  planeRep(k, 2 * Z, tw, tape, (2 * Z) / 0.24, 1, -X, 0.002, 0, { rx: -Math.PI / 2, rz: Math.PI / 2 });
  planeRep(k, 2 * Z, tw, tape, (2 * Z) / 0.24, 1, X, 0.002, 0, { rx: -Math.PI / 2, rz: Math.PI / 2 });

  let t = 0;
  let amp = 0;
  let spin = 0;
  let oilP = 0;
  let temp = 0.32;
  let volts = 0;
  k.onUpdate((dt) => {
    t += dt;
    const running = generatorRunning(k);
    const cranking = running && powerOf(k) !== 'generator';
    const ampT = running ? (cranking ? 0.0035 : 0.0011) : 0;
    amp += (ampT - amp) * Math.min(1, dt * (running ? 3 : 1.2));
    spin += ((running ? 15 : 0) - spin) * Math.min(1, dt * (running ? 0.9 : 0.35));
    fan.rotation.x = (fan.rotation.x + spin * dt) % (Math.PI * 2);
    if (amp > 2e-5) eng.position.set(Math.sin(t * 173) * amp * 0.6, Math.sin(t * 211 + 1.3) * amp, Math.sin(t * 157 + 2.1) * amp * 0.5);
    else if (eng.position.x !== 0 || eng.position.y !== 0) eng.position.set(0, 0, 0);
    ledRun(running && !cranking);
    ledAuto(running);
    lcd(running && !cranking);
    oilP += ((running ? 0.62 + Math.sin(t * 3.1) * 0.01 : 0) - oilP) * Math.min(1, dt * 2);
    temp += ((running ? 0.74 : 0.32) - temp) * dt * 0.015;
    volts += ((running && !cranking ? 0.795 + Math.sin(t * 5.3) * 0.004 : 0) - volts) * Math.min(1, dt * 3);
    oilN.rotation.z = gaugeAngle(oilP);
    tempN.rotation.z = gaugeAngle(temp);
    voltN.rotation.z = gaugeAngle(volts);
  });
};

export const GENERATOR_BUILDERS: Partial<Record<PropType, PropBuilder>> = { generator };
