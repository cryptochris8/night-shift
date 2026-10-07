/**
 * Building services: return-air grilles and the generator-room louvre, wall pipe runs, EMT
 * conduit, overhead pipe racks, floor drains, puddles, maintenance tags and construction sheeting.
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder, PropKit } from './props';
import { drawMesh, drawPipeWrap, drawSheenMask, drawSheeting, drawStain, drawStreak, drawTag } from './props.infra.tex2';
import { bakeInto, decalMat, generatorRunning, live, ownStd, pipe, planeRep, sharedTex, staging, texMat, toCeiling, toTexture } from './props.infra.util';

/** Wrap-around pipe marker band on a pipe running along local x. */
function wrapLabel(k: PropKit, text: string, bg: string, fg: string, r: number, len: number, x: number, y: number, z: number, parent?: THREE.Object3D): void {
  const g = k.own(new THREE.CylinderGeometry(r, r, len, 24, 1, true, -Math.PI / 2, Math.PI * 2));
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, v, 1 - u);
  }
  const mat = texMat(k, `wrap:${text}`, () => sharedTex(`wrap:${text}`, () => drawPipeWrap(text, bg, fg)), { roughness: 0.5 });
  k.mesh(g, mat, x, y, z, { rz: -Math.PI / 2, cast: false, parent });
}

// ---------------------------------------------------------------------------
// Vents
// ---------------------------------------------------------------------------

function returnGrille(k: PropKit): void {
  const w = k.num('w', 0.6);
  const h = k.num('h', 0.3);
  const paint = k.std(0xc4c1b6, 0.55, 0.25);
  const f = 0.025;
  k.rbox(w, f, 0.012, paint, 0, h / 2 - f / 2, 0.006, 0.003);
  k.rbox(w, f, 0.012, paint, 0, -h / 2 + f / 2, 0.006, 0.003);
  k.rbox(f, h, 0.012, paint, -w / 2 + f / 2, 0, 0.006, 0.003);
  k.rbox(f, h, 0.012, paint, w / 2 - f / 2, 0, 0.006, 0.003);
  k.plane(w - 2 * f, h - 2 * f, k.std(0x070707, 0.95), 0, 0, 0.0015);
  const blade = k.std(0x8f8d86, 0.6, 0.3);
  const n = Math.max(4, Math.floor((h - 2 * f) / 0.018));
  for (let i = 0; i < n; i++) k.box(w - 2 * f, 0.0018, 0.02, blade, 0, -h / 2 + f + 0.01 + i * 0.018, 0.01, { rx: 0.75, cast: false });
  const screw = k.std(0x9a9ea2, 0.35, 0.8);
  for (const sx of [-1, 1]) k.cyl(0.004, 0.004, 0.003, screw, sx * (w / 2 - f / 2), 0, 0.0125, { axis: 'z', seg: 8 });
  const dust = decalMat(k, 'stain:dirt7', () => sharedTex('stain:dirt7', () => drawStain('dirt', 7)), { opacity: 0.45 });
  k.plane(w * 1.5, h * 1.6, dust, 0, h * 0.55, 0.0008);
}

function louvre(k: PropKit): void {
  const w = k.num('w', 1.6);
  const h = k.num('h', 1.0);
  const alu = k.std(0x8b8f92, 0.5, 0.6);
  const f = 0.06;
  k.rbox(w, f, 0.12, alu, 0, h / 2 - f / 2, 0.06, 0.006);
  k.rbox(w, f, 0.12, alu, 0, -h / 2 + f / 2, 0.06, 0.006);
  k.rbox(f, h, 0.12, alu, -w / 2 + f / 2, 0, 0.06, 0.006);
  k.rbox(f, h, 0.12, alu, w / 2 - f / 2, 0, 0.06, 0.006);
  k.box(0.04, h - 2 * f, 0.11, alu, 0, 0, 0.055);
  k.plane(w - 2 * f, h - 2 * f, k.std(0x050505, 0.95), 0, 0, 0.002);
  const meshMat = k.shared('infra:birdscreen', () => {
    const t = sharedTex('birdscreen', drawMesh, { repeat: true });
    return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.4, color: 0x9a9ea2, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  });
  planeRep(k, w - 2 * f, h - 2 * f, meshMat, (w - 2 * f) / 0.05, (h - 2 * f) / 0.05, 0, 0, 0.012);
  const blade = k.std(0x7f8386, 0.5, 0.55);
  const n = Math.max(4, Math.round((h - 2 * f) / 0.09));
  for (let i = 0; i < n; i++) k.box(w - 2 * f, 0.004, 0.13, blade, 0, -h / 2 + f + 0.045 + i * ((h - 2 * f) / n), 0.06, { rx: -0.75 });
  k.box(w + 0.1, 0.012, 0.16, alu, 0, -h / 2 - 0.006, 0.08, { rx: 0.12 });
  k.rbox(0.2, 0.11, 0.09, k.std(0x3a3d40, 0.55, 0.3), w / 2 - 0.18, -h / 2 - 0.1, 0.05, 0.01);
  k.cyl(0.006, 0.006, 0.2, k.std(0x9a9ea2, 0.4, 0.8), w / 2 - 0.28, -h / 2 - 0.02, 0.07, { rz: 0.8, seg: 6 });
  const rust = decalMat(k, 'streak:rust2', () => sharedTex('streak:rust2', () => drawStreak('92,58,30', 2)), { opacity: 0.6 });
  k.plane(w * 0.95, 0.9, rust, 0, -h / 2 - 0.45, 0.0008);
}

const vent: PropBuilder = (k) => {
  if (k.bool('large', false)) louvre(k);
  else returnGrille(k);
};

// ---------------------------------------------------------------------------
// Pipe runs and conduit (built along +x in a staging group, then baked; vertical runs rotate it)
// ---------------------------------------------------------------------------

interface PipeSpec {
  label: string;
  kind: 'ins' | 'copper' | 'red' | 'iron';
  r: number;
  bg: string;
  fg: string;
}

const PIPES: PipeSpec[] = [
  { label: 'CHW SUPPLY', kind: 'ins', r: 0.08, bg: '#2f7a3e', fg: '#f4f4f0' },
  { label: 'DOM HW', kind: 'copper', r: 0.021, bg: '#2f7a3e', fg: '#f4f4f0' },
  { label: 'FIRE PROTECTION', kind: 'red', r: 0.05, bg: '#a3221a', fg: '#f4f4f0' },
  { label: 'DOM CW', kind: 'ins', r: 0.045, bg: '#2f7a3e', fg: '#f4f4f0' },
  { label: 'CHW RETURN', kind: 'ins', r: 0.08, bg: '#2f7a3e', fg: '#f4f4f0' },
  { label: 'SAN DRAIN', kind: 'iron', r: 0.055, bg: '#2f7a3e', fg: '#f4f4f0' },
];

function pipeMat(k: PropKit, kind: PipeSpec['kind']): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'ins':
      return k.std(0xd3d0c6, 0.85, 0);
    case 'copper':
      return k.std(0x9a5c38, 0.42, 0.85);
    case 'red':
      return k.std(0x8f1d16, 0.5, 0.3);
    default:
      return k.std(0x26262a, 0.75, 0.45);
  }
}

/** One straight pipe along x with bands, a valve and markers. */
function pipeLine(k: PropKit, st: THREE.Group, p: PipeSpec, L: number, y: number, z: number, idx: number): void {
  const mat = pipeMat(k, p.kind);
  pipe(k, p.r, L, mat, 'x', 0, y, z, { seg: p.r > 0.04 ? 16 : 10, parent: st });
  if (p.kind === 'ins') {
    const band = k.std(0xa9adb1, 0.35, 0.8);
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.3; x += 1.2) k.cyl(p.r + 0.003, p.r + 0.003, 0.02, band, x, y, z, { axis: 'x', seg: 16, parent: st });
  } else if (p.kind !== 'iron') {
    const vx = -L / 2 + L * (0.27 + 0.13 * (idx % 3));
    const body = p.kind === 'copper' ? k.std(0x9c7c3c, 0.4, 0.85) : k.std(0x7a1712, 0.5, 0.35);
    k.sphere(p.r * 1.6, body, vx, y, z, { seg: 10, parent: st });
    k.cyl(p.r * 0.5, p.r * 0.6, p.r * 2.4, body, vx, y - p.r * 1.8, z, { seg: 8, parent: st });
    if (p.kind === 'red') k.torus(0.055, 0.007, k.std(0x8f1d16, 0.5, 0.3), vx, y - p.r * 3.2, z, { rx: Math.PI / 2, seg: 18, parent: st });
    else k.box(0.12, 0.012, 0.02, k.std(0xc23a1c, 0.5), vx + 0.05, y - p.r * 3, z, { parent: st });
  } else {
    for (let x = -L / 2 + 1.5; x < L / 2; x += 3) k.cyl(p.r + 0.012, p.r + 0.012, 0.07, mat, x, y, z, { axis: 'x', seg: 12, parent: st });
  }
  const nLab = Math.max(1, Math.floor(L / 4));
  for (let i = 0; i < nLab; i++) {
    const lx = -L / 2 + (L * (i + 0.5)) / nLab + 0.35;
    if (Math.abs(lx) < L / 2 - 0.2) wrapLabel(k, p.label, p.bg, p.fg, p.r + 0.002, Math.min(0.45, 0.2 + p.r * 2.5), lx, y, z, st);
  }
}

/** Wall pipe run: unistrut stand-offs every 1.5 m with clamps; params.length / count / vertical. */
const pipeRun: PropBuilder = (k) => {
  const L = k.num('length', 2.0);
  const n = Math.max(1, Math.min(4, Math.round(k.num('count', 2))));
  const st = staging();
  const strut = k.std(0x8d9296, 0.45, 0.7);
  const specs = [PIPES[0], PIPES[1], PIPES[2], PIPES[3]].slice(0, n);
  const ys: number[] = [];
  let y = 0;
  for (const p of specs) {
    ys.push(y - p.r);
    y -= 2 * p.r + 0.06;
  }
  const span = -y;
  const zc = 0.12;
  for (let x = -L / 2 + 0.2; x <= L / 2 - 0.2 + 1e-6; x += Math.max(0.8, Math.min(1.5, L - 0.4))) {
    k.box(0.041, span + 0.08, 0.041, strut, x, -span / 2 + 0.02, 0.0205, { parent: st });
    specs.forEach((p, i) => {
      k.box(0.03, 0.03, zc - p.r, strut, x, ys[i], (zc - p.r) / 2 + 0.03, { parent: st });
      k.torus(p.r + 0.006, 0.004, strut, x, ys[i], zc, { ry: Math.PI / 2, seg: 18, parent: st });
    });
  }
  specs.forEach((p, i) => pipeLine(k, st, p, L, ys[i], zc, i));
  if (k.bool('vertical', false)) st.rotation.z = Math.PI / 2;
  bakeInto(k, st, k.group);
};

/**
 * EMT conduit run along local x (params.length, params.count) with straps, couplings and junction
 * boxes. params.vertical turns the run to local y; params.drops (true or local x positions) adds
 * short drops down into equipment below plus risers into the ceiling at both ends.
 */
const conduit: PropBuilder = (k) => {
  const L = k.num('length', 3);
  const n = Math.max(1, Math.min(4, Math.round(k.num('count', 2))));
  const vertical = k.bool('vertical', false);
  const emt = k.std(0xa3a8ac, 0.38, 0.8);
  const strap = k.std(0x8d9296, 0.4, 0.75);
  const box = k.std(0x8e9397, 0.45, 0.6);
  const red = k.std(0xa3221a, 0.5, 0.2);
  const st = staging();
  const radii = [0.0145, 0.0115, 0.018, 0.0115];
  for (let i = 0; i < n; i++) {
    const r = radii[i];
    const y = -i * 0.055;
    const z = r + 0.004;
    pipe(k, r, L, emt, 'x', 0, y, z, { seg: 10, parent: st });
    for (let x = -L / 2 + 0.3; x < L / 2; x += 1.2) {
      k.box(0.018, 0.004, r * 2 + 0.008, strap, x, y + r + 0.002, z, { parent: st });
      k.box(0.018, r * 2, 0.004, strap, x, y, 0.002, { parent: st });
    }
    for (let x = -L / 2 + 3.05; x < L / 2 - 0.1; x += 3.05) k.cyl(r + 0.003, r + 0.003, 0.045, emt, x, y, z, { axis: 'x', seg: 10, parent: st });
    if (i === 0) for (let x = -L / 2 + 0.5; x < L / 2; x += 1.0) k.cyl(r + 0.0006, r + 0.0006, 0.03, red, x, y, z, { axis: 'x', seg: 10, parent: st });
  }
  const boxes = L > 4 ? Math.floor(L / 6) + 1 : 1;
  for (let b = 0; b < boxes; b++) {
    const bx = boxes === 1 ? L * 0.18 : -L / 2 + (L * (b + 0.5)) / boxes;
    k.rbox(0.104, 0.104 + (n - 1) * 0.055, 0.055, box, bx, -((n - 1) * 0.055) / 2, 0.0275, 0.004, { parent: st });
    k.box(0.112, 0.112 + (n - 1) * 0.055, 0.003, box, bx, -((n - 1) * 0.055) / 2, 0.0565, { parent: st });
    if (b % 2 === 0) k.plane(0.04, 0.02, red, bx, -((n - 1) * 0.055) / 2, 0.0582, { parent: st });
  }
  const dropsParam = k.p.drops;
  const drops: number[] = Array.isArray(dropsParam)
    ? dropsParam.filter((v): v is number => typeof v === 'number')
    : dropsParam === true
      ? [-0.28 * L, -0.22 * L, 0.1 * L, 0.16 * L]
      : [];
  if (!vertical && drops.length) {
    const len = k.num('dropLength', 0.3);
    for (const x of drops) {
      pipe(k, 0.0145, len, emt, 'y', x, -len / 2, 0.0185, { seg: 10, parent: st });
      k.cyl(0.022, 0.022, 0.03, emt, x, -len + 0.015, 0.0185, { seg: 10, parent: st });
    }
    const up = toCeiling(k, 0.3);
    for (const sx of [-1, 1]) pipe(k, 0.0145, up, emt, 'y', sx * (L / 2 - 0.02), up / 2, 0.0185, { seg: 10, parent: st });
  }
  if (vertical) st.rotation.z = Math.PI / 2;
  bakeInto(k, st, k.group);
};

/** Overhead pipe rack along local x: params.length, params.count; clevis hangers on rods to the ceiling. */
const ceilingPipes: PropBuilder = (k) => {
  const L = k.num('length', 6);
  const n = Math.max(1, Math.min(PIPES.length, Math.round(k.num('count', 2))));
  const specs = PIPES.slice(0, n);
  const up = toCeiling(k, 0.25);
  const widths = specs.map((p) => 2 * p.r + 0.09);
  const total = widths.reduce((a, b) => a + b, 0);
  const zs: number[] = [];
  let acc = -total / 2;
  for (const w of widths) {
    zs.push(acc + w / 2);
    acc += w;
  }
  // built in sections so hangers, valves and markers repeat along long runs; finish() merges them
  const sections = Math.max(1, Math.ceil(L / 8));
  const secL = L / sections;
  const rod = k.std(0x6f7377, 0.45, 0.7);
  const clevis = k.std(0x8d9296, 0.4, 0.75);
  for (let s = 0; s < sections; s++) {
    const st = staging();
    const x0 = -L / 2 + secL * (s + 0.5);
    specs.forEach((p, i) => {
      pipeLine(k, st, p, secL + 0.002, 0, zs[i], i + s);
      for (let hx = -secL / 2 + 0.6; hx < secL / 2 - 0.2; hx += 2.4) {
        k.torus(p.r + 0.012, 0.006, clevis, hx, 0, zs[i], { rz: Math.PI, ry: Math.PI / 2, arc: Math.PI, seg: 14, parent: st });
        const top = p.r + 0.02;
        if (up > top + 0.02) {
          k.cyl(0.005, 0.005, up - top, rod, hx, top + (up - top) / 2, zs[i], { seg: 6, parent: st });
          k.cyl(0.025, 0.025, 0.012, rod, hx, up - 0.006, zs[i], { seg: 10, parent: st });
        }
        k.box(0.012, 0.03, 0.012, clevis, hx, p.r + 0.012, zs[i], { parent: st });
      }
    });
    st.position.x = x0;
    bakeInto(k, st, k.group);
  }
  // a weep stain on the floor under a valve, from years of slow drips
  const drip = decalMat(k, 'stain:water8', () => sharedTex('stain:water8', () => drawStain('water', 8)), { opacity: 0.4 });
  if (k.def.pos.y > 1.5) k.plane(0.7, 0.7, drip, -L / 2 + L * 0.4, -k.def.pos.y + 0.003, zs[Math.min(1, n - 1)], { rx: -Math.PI / 2 });
};

/** Square cast-iron grate set in the floor, rust ring around it. */
const floorDrain: PropBuilder = (k) => {
  const s = k.num('size', k.def.room === 'restroom' ? 0.16 : 0.22);
  const ring = decalMat(k, 'stain:drain', () => sharedTex('stain:drain', () => drawStain('drain', 1)), { opacity: 0.75 });
  k.plane(s * 3.2, s * 3.2, ring, 0, 0.0004, 0, { rx: -Math.PI / 2 });
  k.plane(s - 0.016, s - 0.016, k.std(0x040404, 0.95), 0, 0.0008, 0, { rx: -Math.PI / 2 });
  const iron = k.std(0x2c2926, 0.55, 0.6);
  const f = 0.012;
  k.box(s, 0.004, f, iron, 0, 0.002, s / 2 - f / 2);
  k.box(s, 0.004, f, iron, 0, 0.002, -s / 2 + f / 2);
  k.box(f, 0.004, s - 2 * f, iron, s / 2 - f / 2, 0.002, 0);
  k.box(f, 0.004, s - 2 * f, iron, -s / 2 + f / 2, 0.002, 0);
  const bars = 6;
  for (let i = 1; i < bars; i++) k.box(0.007, 0.0035, s - 2 * f, iron, -s / 2 + f + ((s - 2 * f) * i) / bars, 0.0018, 0);
  k.box(s - 2 * f, 0.0035, 0.007, iron, 0, 0.0019, 0);
};

// ---------------------------------------------------------------------------
// Puddle, tag, sheeting
// ---------------------------------------------------------------------------

function blobShape(k: PropKit, rx: number, rz: number, wobble: number): THREE.Shape {
  const phases = [k.rand() * 6.28, k.rand() * 6.28, k.rand() * 6.28];
  const pts: THREE.Vector2[] = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const f = 1 - wobble * (0.5 + 0.25 * Math.sin(a * 2 + phases[0]) + 0.15 * Math.sin(a * 3 + phases[1]) + 0.1 * Math.sin(a * 5 + phases[2]));
    pts.push(new THREE.Vector2(Math.cos(a) * rx * f, Math.sin(a) * rz * f));
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, pts[0].y);
  shape.splineThru([...pts.slice(1), pts[0]]);
  return shape;
}

/** Irregular glossy puddle (params.w x params.d) with a damp margin; params.oily adds a thin-film sheen. */
const puddle: PropBuilder = (k) => {
  const w = k.num('w', 1.5);
  const d = k.num('d', 1.0);
  const oily = k.bool('oily', false);
  const damp = k.phys('infra:puddle:damp', { color: 0x15171a, roughness: 0.38, metalness: 0, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  k.mesh(k.own(new THREE.ShapeGeometry(blobShape(k, w / 2, d / 2, 0.12), 24)), damp, 0, 0.0004, 0, { rx: -Math.PI / 2, cast: false, receive: true });
  const core = oily
    ? k.phys('infra:puddle:oily', {
        color: 0x0c0d0e,
        roughness: 0.05,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        iridescence: 0.85,
        iridescenceIOR: 1.38,
        iridescenceThicknessRange: [160, 520],
        iridescenceMap: sharedTex('sheenmask', drawSheenMask, { repeat: true, srgb: false }),
      })
    : k.phys('infra:puddle', { color: 0x0b0d0f, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.86, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  k.mesh(k.own(new THREE.ShapeGeometry(blobShape(k, w * 0.43, d * 0.43, 0.22), 24)), core, 0, 0.0008, 0, { rx: -Math.PI / 2, cast: false, receive: true });
};

/** Yellow card on a wire loop; origin at the hook. It drifts a little, and shivers when the generator runs. */
const maintenanceTag: PropBuilder = (k) => {
  const text = k.str('text', 'OUT OF SERVICE');
  const hang = k.sub(0, 0, 0, 'tag');
  const st = staging();
  const wire = k.std(0x9a9ea2, 0.35, 0.85);
  k.torus(0.012, 0.0007, wire, 0, -0.012, 0, { seg: 16, parent: st });
  k.box(0.065, 0.13, 0.0006, k.std(0xd8b928, 0.7), 0, -0.089, 0, { parent: st });
  const back = texMat(k, 'tag:back', () => sharedTex('tag:back', () => drawTag('INSPECTED — DATE — BY')), { roughness: 0.75 });
  k.plane(0.065, 0.13, back, 0, -0.089, -0.0004, { ry: Math.PI, parent: st });
  bakeInto(k, st, hang);
  const tex = k.own(toTexture(drawTag(text)));
  const front = ownStd(k, { map: tex, roughness: 0.75 });
  k.plane(0.065, 0.13, front, 0, -0.089, 0.0004, { parent: hang });
  const phase = k.rand() * 6.28;
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    let rz = Math.sin(t * 0.7 + phase) * 0.025;
    let rx = Math.sin(t * 0.53 + phase * 2) * 0.03;
    if (k.def.room === 'generator' && generatorRunning(k)) {
      rz += Math.sin(t * 61) * 0.02;
      rx += Math.sin(t * 47 + 1) * 0.025;
    }
    hang.rotation.set(rx, 0, rz);
  });
};

/**
 * Construction dust barrier: two overlapping polyethylene sheets (params.w x params.h) stapled to
 * a batten, slit in the middle, wrinkled and breathing in a draught the player cannot feel.
 */
const plasticSheeting: PropBuilder = (k) => {
  const w = k.num('w', 2.0);
  const h = k.num('h', 2.5);
  const wood = k.std(0x8a7350, 0.8, 0);
  k.box(w + 0.1, 0.09, 0.04, wood, 0, h + 0.045, 0);
  const up = toCeiling(k, h + 0.09);
  if (up > h + 0.12) for (const x of [-w * 0.4, w * 0.4]) k.cyl(0.0012, 0.0012, up - h - 0.09, k.std(0x8d9296, 0.4, 0.8), x, h + 0.09 + (up - h - 0.09) / 2, 0, { seg: 4 });
  k.plane(w + 0.06, 0.05, k.std(0x9ea3a6, 0.45, 0.6), 0, h + 0.02, 0.0205);
  const mat = k.shared('infra:poly', () => new THREE.MeshStandardMaterial({ map: sharedTex('sheeting', drawSheeting), color: 0xe4e8e5, transparent: true, opacity: 0.4, roughness: 0.32, metalness: 0, side: THREE.DoubleSide, depthWrite: false }));
  const sheets: { mesh: THREE.Mesh; base: Float32Array; phase: number }[] = [];
  for (const side of [-1, 1]) {
    const sw = w / 2 + 0.03;
    const g = k.own(new THREE.PlaneGeometry(sw, h - 0.01, 10, 16));
    g.translate(side * (w / 4 - 0.015), (h - 0.01) / 2 + 0.01, side * -0.004);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const ph = k.rand() * 6.28;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const low = 1 - y / h;
      const creases = 0.018 * Math.sin(x * 9 + ph) * (0.35 + 0.65 * low) + 0.006 * Math.sin(x * 23 + y * 4 + ph * 2);
      const sag = 0.02 * Math.max(0, low - 0.85) * 6;
      pos.setZ(i, pos.getZ(i) + creases + sag);
    }
    g.computeVertexNormals();
    const mesh = live(k.mesh(g, mat, 0, 0, 0, { cast: false, receive: false }));
    sheets.push({ mesh, base: Float32Array.from(pos.array as ArrayLike<number>), phase: ph });
  }
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    if (k.cameraDistance() > 16) return;
    for (const s of sheets) {
      const g = s.mesh.geometry;
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < pos.count; i++) {
        const x = s.base[i * 3];
        const y = s.base[i * 3 + 1];
        const low = Math.max(0, 1 - y / h);
        const amp = 0.035 * Math.pow(low, 1.6);
        arr[i * 3 + 2] = s.base[i * 3 + 2] + amp * (Math.sin(t * 1.1 + x * 2.1 + s.phase) + 0.35 * Math.sin(t * 2.3 + y * 1.7 + s.phase));
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
    }
  });
};

export const MECH_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  vent,
  pipe_run: pipeRun,
  conduit,
  ceiling_pipes: ceilingPipes,
  floor_drain: floorDrain,
  puddle,
  maintenance_tag: maintenanceTag,
  plastic_sheeting: plasticSheeting,
};
