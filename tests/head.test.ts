import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FACE_POINT,
  FACE_PRESETS,
  HEAD_RINGS,
  HEAD_SEGMENTS,
  NECK_STUB_R,
  buildHeadShape,
  faceMasks,
  hairMask,
  headGeometry,
  headSdf,
  headShape,
  pickFace,
  pickHairStyle,
  warmHeadShapes,
  type FacePreset,
  type HairStyle,
} from '../src/characters/Figure.head';
import { RNG } from '../src/core/rng';

const P = FACE_PRESETS;
const SCULPTED: FacePreset[] = ['plain', 'strong', 'long', 'soft'];
const FULL: HairStyle = { line: 0.5, recede: 0, bald: 0 };

/** z of the first surface met marching in from the front (-z) at (x, y). */
function frontZ(x: number, y: number, preset: FacePreset = 'plain'): number {
  let z = -0.16;
  while (z < 0.16 && headSdf(x, y, z, P[preset]) > 0) z += 0.0002;
  return z;
}

function linear(hex: number): THREE.Color {
  return new THREE.Color().setHex(hex);
}

describe('headSdf', () => {
  it('is negative inside the skull and positive well outside it', () => {
    expect(headSdf(0, 0.12, 0, P.plain)).toBeLessThan(0);
    expect(headSdf(0, 0.12, -0.3, P.plain)).toBeGreaterThan(0);
    expect(headSdf(0.3, 0.1, 0, P.plain)).toBeGreaterThan(0);
    expect(headSdf(0, 0.4, 0, P.plain)).toBeGreaterThan(0);
  });

  it('is mirror-symmetric left to right', () => {
    for (const preset of Object.keys(P) as FacePreset[]) {
      for (let i = 0; i < 200; i++) {
        const x = Math.sin(i * 1.7) * 0.1, y = 0.11 + Math.cos(i * 2.3) * 0.12, z = Math.sin(i * 0.9) * 0.12;
        expect(headSdf(x, y, z, P[preset])).toBeCloseTo(headSdf(-x, y, z, P[preset]), 12);
      }
    }
  });

  it('sculpts a nose, a brow over set-back eyes, ears and a chin', () => {
    for (const preset of SCULPTED) {
      // the nose stands well proud of the cheek at the same height
      expect(frontZ(0, 0.077, preset), preset).toBeLessThan(frontZ(0.04, 0.077, preset) - 0.02);
      // the eye sits behind the brow above it
      expect(frontZ(0.03, 0.105, preset), preset).toBeGreaterThan(frontZ(0.03, 0.127, preset) + 0.006);
      // an ear on each side
      expect(headSdf(0.08, 0.098, 0.012, P[preset]), preset).toBeLessThan(0);
      // the chin projects ahead of the throat
      expect(frontZ(0, 0.012 - P[preset].jawDrop, preset), preset).toBeLessThan(-0.07);
    }
  });

  it('leaves the blank head without features', () => {
    expect(frontZ(0, 0.077, 'blank')).toBeGreaterThan(frontZ(0.03, 0.077, 'blank') - 0.012);
    expect(headSdf(0.08, 0.098, 0.012, P.blank)).toBeGreaterThan(0);
  });

  it('gives only the soft face a bun', () => {
    expect(headSdf(0, 0.152, 0.115, P.soft)).toBeLessThan(0);
    expect(headSdf(0, 0.152, 0.115, P.plain)).toBeGreaterThan(0);
  });

  it('runs the neck stub of the given radius down into the neck', () => {
    expect(headSdf(0.045, -0.01, 0.006, P.plain, 0.051)).toBeLessThan(0);
    expect(headSdf(0.045, -0.01, 0.006, P.plain, 0.035)).toBeGreaterThan(0);
  });
});

describe('buildHeadShape / headShape', () => {
  const shape = headShape('plain');

  it('samples a closed surface wound outward, every vertex on the surface', () => {
    expect(shape.count).toBe(HEAD_RINGS * HEAD_SEGMENTS + 2);
    expect(shape.index.length).toBe(6 * HEAD_SEGMENTS * HEAD_RINGS);
    const pos = shape.positions;
    for (let v = 0; v < shape.count; v++) {
      expect(Math.abs(headSdf(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], P.plain))).toBeLessThan(1e-5);
    }
    // every directed edge appears once and its reverse once: closed and consistently wound
    const edges = new Set<string>();
    let volume = 0;
    for (let t = 0; t < shape.index.length; t += 3) {
      const tri = [shape.index[t], shape.index[t + 1], shape.index[t + 2]];
      for (const i of tri) expect(i).toBeLessThan(shape.count);
      for (let e = 0; e < 3; e++) {
        const a = tri[e], b = tri[(e + 1) % 3];
        if (a === b) continue;
        const key = `${a}>${b}`;
        expect(edges.has(key)).toBe(false);
        edges.add(key);
      }
      const [a, b, c] = tri.map((i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    for (const key of edges) {
      const [a, b] = key.split('>');
      if (!edges.has(`${b}>${a}`)) expect.fail(`edge ${key} has no twin`);
    }
    expect(volume).toBeGreaterThan(0.0035);
    expect(volume).toBeLessThan(0.0045);
  });

  it('is a human-sized head at the standard size', () => {
    const pos = shape.positions;
    let top = -1, chin = 1, nose = 1, back = -1, half = 0;
    for (let v = 0; v < shape.count; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      top = Math.max(top, y);
      if (z < -0.05) chin = Math.min(chin, y);
      nose = Math.min(nose, z);
      back = Math.max(back, z);
      half = Math.max(half, Math.abs(x));
    }
    expect(top).toBeGreaterThan(0.215);
    expect(top).toBeLessThan(0.23);
    expect(chin).toBeGreaterThan(-0.02);
    expect(chin).toBeLessThan(0.005);
    expect(nose).toBeGreaterThan(-0.115);
    expect(nose).toBeLessThan(-0.1);
    expect(back).toBeGreaterThan(0.1);
    expect(back).toBeLessThan(0.112);
    expect(half).toBeGreaterThan(0.08);
    expect(half).toBeLessThan(0.09);
  });

  it('points its normals outward and shades the eye sockets darker than the forehead', () => {
    const { positions: pos, normals: n, ao } = shape;
    let outward = 0;
    let eye = 0, eyeN = 0, brow = 0, browN = 0;
    for (let v = 0; v < shape.count; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      if (n[v * 3] * x + n[v * 3 + 1] * (y - 0.11) + n[v * 3 + 2] * z > 0) outward++;
      if (z < -0.05 && Math.abs(Math.abs(x) - 0.031) < 0.007 && Math.abs(y - 0.104) < 0.006) { eye += ao[v]; eyeN++; }
      if (z < -0.05 && Math.abs(x) < 0.02 && y > 0.14 && y < 0.16) { brow += ao[v]; browN++; }
    }
    expect(outward / shape.count).toBeGreaterThan(0.97);
    expect(eyeN).toBeGreaterThan(5);
    expect(browN).toBeGreaterThan(5);
    expect(eye / eyeN).toBeLessThan(brow / browN - 0.1);
    for (const a of ao) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic and cached per preset and neck size', () => {
    const again = buildHeadShape(P.plain);
    expect(again.positions).toEqual(shape.positions);
    expect(again.ao).toEqual(shape.ao);
    expect(headShape('plain')).toBe(shape);
    expect(headShape('plain', 0.04)).not.toBe(shape);
    expect(headShape('soft').params).toBe(P.soft);
  });

  it('warms every preset so later lookups are instant', () => {
    warmHeadShapes();
    for (const preset of Object.keys(P) as FacePreset[]) {
      const t0 = performance.now();
      const s = headShape(preset);
      expect(performance.now() - t0).toBeLessThan(5);
      expect(s.params).toBe(P[preset]);
    }
  });
});

describe('hairMask', () => {
  it('covers the crown, sides and back, never the face, ears or throat', () => {
    expect(hairMask(0, 0.225, 0.01, FULL)).toBe(1);
    expect(hairMask(0, 0.12, 0.11, FULL)).toBe(1);
    expect(hairMask(0.072, 0.155, 0.01, FULL)).toBe(1);
    expect(hairMask(0, 0.145, -0.085, FULL)).toBe(0);
    expect(hairMask(0.05, 0.09, -0.06, FULL)).toBe(0);
    expect(hairMask(0.085, 0.1, 0.015, FULL)).toBe(0);
    expect(hairMask(0, 0.03, 0.08, FULL)).toBe(0);
  });

  it('recedes at the front and thins to bald on the crown when asked', () => {
    expect(hairMask(0, 0.182, -0.07, FULL)).toBeGreaterThan(0.9);
    expect(hairMask(0, 0.182, -0.07, { ...FULL, recede: 0.02 })).toBe(0);
    const bald = { ...FULL, bald: 1 };
    expect(hairMask(0, 0.225, -0.01, bald)).toBe(0);
    expect(hairMask(0, 0.12, 0.11, bald)).toBe(1);
    expect(hairMask(0.072, 0.15, 0.03, bald)).toBe(1);
  });

  it('moves the hairline down as the line draw rises', () => {
    let low = 0, high = 0;
    for (let y = 0.15; y < 0.19; y += 0.002) {
      low += hairMask(0, y, -0.075, { ...FULL, line: 0 });
      high += hairMask(0, y, -0.075, { ...FULL, line: 1 });
    }
    expect(high).toBeGreaterThan(low);
  });
});

describe('faceMasks', () => {
  it('puts eye shadow in the sockets, brows above them and lips at the mouth', () => {
    const eye = faceMasks(0.031, 0.106, -0.08, P.plain);
    expect(eye.eye).toBeGreaterThan(0.9);
    expect(eye.lips).toBe(0);
    expect(faceMasks(0.028, 0.129, -0.088, P.plain).brow).toBeGreaterThan(0.9);
    const mouth = faceMasks(0, 0.044, -0.088, P.plain);
    expect(mouth.lips).toBeGreaterThan(0.9);
    expect(mouth.mouth).toBeGreaterThan(0.9);
    expect(faceMasks(0, 0.06, -0.09, P.plain).mouth).toBe(0);
    // the long face carries its mouth lower
    expect(faceMasks(0, 0.044 - P.long.jawDrop / 2, -0.088, P.long).mouth).toBeGreaterThan(0.9);
  });

  it('paints nothing on the forehead, the back of the head or a blank face', () => {
    expect(faceMasks(0, 0.15, -0.08, P.plain)).toEqual({ eye: 0, brow: 0, lips: 0, mouth: 0 });
    expect(faceMasks(0.031, 0.106, 0.05, P.plain)).toEqual({ eye: 0, brow: 0, lips: 0, mouth: 0 });
    expect(faceMasks(0.031, 0.106, -0.08, P.blank)).toEqual({ eye: 0, brow: 0, lips: 0, mouth: 0 });
  });
});

describe('headGeometry', () => {
  const skin = 0x9d7b66, hair = 0x1a1512;
  const shape = headShape('plain');
  const nearest = (x: number, y: number, z: number): number => {
    let best = 0, bd = Infinity;
    for (let v = 0; v < shape.count; v++) {
      const d = Math.hypot(shape.positions[v * 3] - x, shape.positions[v * 3 + 1] - y, shape.positions[v * 3 + 2] - z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };

  it('scales the surface, paints skin and hair and computes normals', () => {
    const g = headGeometry('plain', 1.2, NECK_STUB_R, { skin, hair, style: FULL });
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    expect(pos.count).toBe(shape.count);
    expect(col.count).toBe(shape.count);
    expect(g.getAttribute('normal').count).toBe(shape.count);
    expect(g.index!.count).toBe(shape.index.length);
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(0.215 * 1.2);
    const forehead = nearest(0, 0.15, -0.09);
    const s = linear(skin);
    expect(col.getX(forehead)).toBeGreaterThan(s.r * 0.8);
    expect(col.getX(forehead)).toBeLessThanOrEqual(s.r * 1.0001);
    const crown = nearest(0, 0.22, 0.01);
    expect(col.getX(crown)).toBeLessThan(linear(hair).r * 1.1);
    const eye = nearest(0.031, 0.104, -0.08);
    expect(col.getX(eye)).toBeLessThan(col.getX(forehead) * 0.8);
  });

  it('lifts the hair a few millimetres off the scalp and leaves the face in place', () => {
    const bare = headGeometry('plain', 1, NECK_STUB_R, { skin, hair: null, style: null }).getAttribute('position');
    const haired = headGeometry('plain', 1, NECK_STUB_R, { skin, hair, style: FULL }).getAttribute('position');
    const lift = (v: number): number => Math.hypot(haired.getX(v) - bare.getX(v), haired.getY(v) - bare.getY(v), haired.getZ(v) - bare.getZ(v));
    const crown = nearest(0, 0.22, 0.01);
    expect(lift(crown)).toBeGreaterThan(0.003);
    expect(lift(crown)).toBeLessThan(0.008);
    expect(lift(nearest(0, 0.09, -0.1))).toBe(0);
  });

  it('builds the faceless head without colours', () => {
    const g = headGeometry('blank', 1, NECK_STUB_R, null);
    expect(g.getAttribute('color')).toBeUndefined();
    expect(g.getAttribute('position').count).toBe(headShape('blank').count);
  });
});

describe('pickFace / pickHairStyle', () => {
  it('keeps the dark figure faceless, gives scrubs the soft face and varies everyone else', () => {
    expect(pickFace(new RNG(1), 'dark')).toBe('blank');
    expect(pickFace(new RNG(1), 'scrubs')).toBe('soft');
    const seen = new Set<FacePreset>();
    for (let seed = 1; seed <= 200; seed++) seen.add(pickFace(new RNG(seed), 'clerk'));
    expect([...seen].sort()).toEqual(['long', 'plain', 'strong']);
    expect(pickFace(new RNG(42), 'patient')).toBe(pickFace(new RNG(42), 'patient'));
  });

  it('never recedes or balds the soft face; patients sometimes thin, staff never bald', () => {
    expect(pickHairStyle(new RNG(5), 'patient', 0.3, 'soft')).toEqual({ line: 0.3, recede: 0, bald: 0 });
    let bald = 0, recede = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const p = pickHairStyle(new RNG(seed), 'patient', 0.5, 'plain');
      if (p.bald > 0) bald++;
      if (p.recede > 0) recede++;
      expect(pickHairStyle(new RNG(seed), 'clerk', 0.5, 'plain').bald).toBe(0);
    }
    expect(bald).toBeGreaterThan(30);
    expect(recede).toBeGreaterThan(80);
  });
});

describe('FACE_POINT', () => {
  it('sits on the front of the face between the eyes', () => {
    for (const preset of SCULPTED) {
      expect(Math.abs(headSdf(FACE_POINT[0], FACE_POINT[1], FACE_POINT[2], P[preset])), preset).toBeLessThan(0.01);
    }
  });
});
