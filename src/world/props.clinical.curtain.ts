/**
 * Ceiling-track privacy curtain. The cloth is a pleated strip whose folds line up with
 * curtainTexture (7 folds per metre of cloth, one texture repeat per metre); params.open gathers
 * it toward local -x and deepens the folds accordingly. A very slow draught sway runs on the CPU
 * while the camera is near (about a thousand vertices).
 */
import * as THREE from 'three';
import type { PropType } from '../core/types';
import type { PropBuilder } from './props';
import { bev, ceilingAbove, clamp, mat } from './props.clinical.common';

const FOLDS_PER_M = 7;
const FULLNESS = 1.25;

const curtain: PropBuilder = (k) => {
  const width = clamp(k.num('width', 2.4), 0.6, 8);
  const open = clamp(k.num('open', 0), 0, 1);
  const tint = k.num('tint', 0xa9c4c8);
  const ceil = ceilingAbove(k);
  const topY = Math.min(2.75, ceil - 0.05);
  const botY = 0.3;
  const drop = topY - botY;
  const x0 = -width / 2;
  const cloth = width * FULLNESS;
  const span = Math.max(cloth * 0.09, (1 - open) * width);
  const folds = cloth * FOLDS_PER_M;
  // fold depth: the cloth packed into the span as a zigzag of the same length
  const halfFold = 1 / (2 * FOLDS_PER_M);
  const halfSpan = span / (2 * folds);
  const amp = Math.max(0.01, Math.sqrt(Math.max(0, halfFold * halfFold - halfSpan * halfSpan)) * 0.45);

  const cols = Math.ceil(folds * 4) + 1;
  const rows = 8;
  const pos = new Float32Array(cols * (rows + 1) * 3);
  const uv = new Float32Array(cols * (rows + 1) * 2);
  const sway = new Float32Array(rows + 1);
  let p = 0;
  let q = 0;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const y = botY + v * drop;
    sway[r] = Math.pow(1 - v, 1.6);
    // folds open a little toward the weighted hem
    const a = amp * (1 + 0.18 * (1 - v));
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * cloth;
      pos[p++] = x0 + (u / cloth) * span;
      pos[p++] = y;
      pos[p++] = a * Math.cos(u * FOLDS_PER_M * Math.PI * 2);
      uv[q++] = u;
      uv[q++] = v;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c;
      const i2 = i0 + cols;
      index.push(i0, i0 + 1, i2, i0 + 1, i2 + 1, i2);
    }
  }
  const geo = k.own(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const clothMat = k.shared(
    `clin:curtain:${tint}`,
    () => new THREE.MeshStandardMaterial({ map: k.t.curtainTexture({ tint }), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  );
  k.mesh(geo, clothMat, 0, 0, 0, { keep: true, cast: true, name: 'curtain_cloth' });

  // aluminium track flush with the ceiling, end stops, carrier hooks down to the header
  const alu = mat.satin(k);
  const dark = mat.plastic(k, 0x3a3d40, 0.6);
  const trackY = ceil - 0.014;
  bev(k, width + 0.12, 0.024, 0.032, alu, 0, trackY, 0, 0.004);
  for (const s of [-1, 1]) k.box(0.02, 0.03, 0.04, dark, s * (width / 2 + 0.06), trackY - 0.004, 0, { cast: false });
  const hooks = Math.max(2, Math.round(folds / 2));
  for (let i = 0; i <= hooks; i++) {
    const x = x0 + (i / hooks) * span;
    k.box(0.006, trackY - 0.012 - topY, 0.006, dark, x, (trackY - 0.012 + topY) / 2, 0, { cast: false });
  }

  // draught sway: the hem moves most, the header barely at all
  const attr = geo.getAttribute('position') as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const base = pos.slice();
  const phase = k.rand() * 10;
  let t = 0;
  k.onUpdate((dt) => {
    t += dt;
    if (k.cameraDistance() > 12) return;
    for (let r = 0; r <= rows; r++) {
      const f = sway[r];
      const row = r * cols * 3;
      for (let c = 0; c < cols; c++) {
        const i = row + c * 3;
        const x = base[i];
        arr[i] = x + f * 0.004 * Math.sin(t * 0.6 + r * 0.4 + phase);
        arr[i + 2] = base[i + 2] + f * (0.016 * Math.sin(t * 0.42 + x * 0.8 + phase) + 0.005 * Math.sin(t * 1.07 + x * 2.6 + phase * 0.5));
      }
    }
    attr.needsUpdate = true;
  });
};

export const CURTAIN_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  curtain,
};
