import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Figure } from '../src/characters/Figure';
import { headShape } from '../src/characters/Figure.head';
import type { Outfit } from '../src/core/contracts';

const HEAD_VERTS = headShape('plain').count;

function heads(fig: Figure): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  fig.object.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.getAttribute('position').count === HEAD_VERTS) out.push(m);
  });
  return out;
}

const material = (m: THREE.Mesh): THREE.MeshStandardMaterial => m.material as THREE.MeshStandardMaterial;

describe('Figure heads', () => {
  const OUTFITS: Outfit[] = ['scrubs', 'patient', 'workwear', 'security', 'clerk', 'coat', 'child', 'paramedic'];

  it('gives every outfit one painted, sculpted head and nothing else on it', () => {
    for (const outfit of OUTFITS) {
      const fig = new Figure({ outfit, seed: 7 });
      const list = heads(fig);
      expect(list, outfit).toHaveLength(1);
      const head = list[0];
      expect(head.parent!.children, outfit).toHaveLength(1);
      expect(head.geometry.getAttribute('color'), outfit).toBeDefined();
      expect(material(head).vertexColors, outfit).toBe(true);
      expect(material(head).color.getHex(), outfit).toBe(0xffffff);
      fig.dispose();
    }
  });

  it('keeps the dark figure faceless in its matte black', () => {
    const fig = new Figure({ outfit: 'dark', seed: 7 });
    const [head] = heads(fig);
    expect(head.geometry.getAttribute('color')).toBeUndefined();
    expect(material(head).vertexColors).toBe(false);
    expect(material(head).color.getHexString()).toBe(new THREE.Color(0x0b0b0d).getHexString());
    head.geometry.computeBoundingBox();
    // no nose: nothing stands far out in front of the face
    const scale = head.geometry.boundingBox!.max.y / 0.22;
    expect(head.geometry.boundingBox!.min.z).toBeGreaterThan(-0.095 * scale);
    fig.dispose();
  });

  it('honours an explicit face: the soft face has its bun', () => {
    const backOf = (fig: Figure): number => {
      const [head] = heads(fig);
      head.geometry.computeBoundingBox();
      return head.geometry.boundingBox!.max.z;
    };
    const plain = new Figure({ outfit: 'patient', seed: 3, face: 'plain' });
    const soft = new Figure({ outfit: 'patient', seed: 3, face: 'soft' });
    expect(backOf(soft)).toBeGreaterThan(backOf(plain) + 0.01);
    plain.dispose();
    soft.dispose();
  });

  it('builds the same head for the same seed', () => {
    const a = heads(new Figure({ outfit: 'clerk', seed: 99 }))[0].geometry;
    const b = heads(new Figure({ outfit: 'clerk', seed: 99 }))[0].geometry;
    expect(a.getAttribute('position').array).toEqual(b.getAttribute('position').array);
    expect(a.getAttribute('color').array).toEqual(b.getAttribute('color').array);
  });

  it('lights the face from a phone without tinting other figures', () => {
    const caller = new Figure({ outfit: 'scrubs', seed: 4 });
    const other = new Figure({ outfit: 'scrubs', seed: 4 });
    caller.setAnim('phone');
    caller.setPhoneGlow(true);
    for (let i = 0; i < 80; i++) caller.update(0.05, 0);
    const lit = material(heads(caller)[0]);
    expect(lit.emissiveIntensity).toBeGreaterThan(0.2);
    expect(lit.emissive.getHex()).not.toBe(0);
    expect(material(heads(other)[0]).emissiveIntensity).toBe(1);
    expect(material(heads(other)[0]).emissive.getHex()).toBe(0);
    caller.dispose();
    other.dispose();
  });

  it('turns the phone screen to the face', () => {
    const fig = new Figure({ outfit: 'clerk', seed: 4 });
    fig.setAnim('phone');
    for (let i = 0; i < 80; i++) fig.update(0.05, 0);
    let screen: THREE.Mesh | null = null;
    fig.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && (m.material as THREE.MeshStandardMaterial).emissive?.getHex() === 0xbfd6ff) screen = m;
    });
    expect(screen).not.toBeNull();
    const s = screen as unknown as THREE.Mesh;
    fig.object.updateWorldMatrix(true, true);
    const facing = new THREE.Vector3(0, 0, 1).transformDirection(s.matrixWorld);
    const toFace = heads(fig)[0].localToWorld(new THREE.Vector3(0, 0.104, -0.09)).sub(s.getWorldPosition(new THREE.Vector3())).normalize();
    expect(facing.dot(toFace)).toBeGreaterThan(0.9);
    fig.dispose();
  });
});
