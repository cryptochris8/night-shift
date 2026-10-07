/**
 * A matte, featureless human silhouette built from primitives. Used where the character system's
 * figures are the wrong tool: two-frame CCTV injections (the object must exist only inside the
 * injected render) and the ending cinematics. Deliberately a touch too tall with arms a touch too
 * long (CONTRACT §4E 'dark' outfit) and lit by nothing — it reads as an absence of light.
 */
import * as THREE from 'three';
import type { Vec3 } from '../core/types';

const DARK = 0x07070a;

export class Silhouette {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];

  constructor(height = 1.9) {
    this.material = new THREE.MeshStandardMaterial({ color: DARK, roughness: 1, metalness: 0 });
    const g = this.group;
    g.name = 'director_silhouette';
    const mesh = (geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.Mesh => {
      this.geometries.push(geo);
      const m = new THREE.Mesh(geo, this.material);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    // torso (capsule), head, legs, slightly over-long arms
    mesh(new THREE.CapsuleGeometry(0.17, 0.55, 4, 10), 0, 1.17, 0);
    mesh(new THREE.SphereGeometry(0.115, 12, 10), 0, 1.72, 0);
    mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.86, 8), -0.1, 0.43, 0);
    mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.86, 8), 0.1, 0.43, 0);
    const armL = mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.78, 8), -0.26, 1.06, 0);
    const armR = mesh(new THREE.CylinderGeometry(0.052, 0.045, 0.78, 8), 0.26, 1.06, 0);
    armL.rotation.z = 0.06;
    armR.rotation.z = -0.06;
    g.scale.setScalar(height / 1.9);
  }

  /** Place feet at `pos` (y = floor), facing `yaw` (three.js convention). */
  place(pos: Vec3, yaw: number): this {
    this.group.position.set(pos.x, pos.y, pos.z);
    this.group.rotation.set(0, yaw, 0);
    this.group.updateMatrixWorld(true);
    return this;
  }

  setOpacity(alpha: number): void {
    this.material.transparent = alpha < 1;
    this.material.opacity = alpha;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const geo of this.geometries) geo.dispose();
    this.material.dispose();
  }
}

/**
 * Setup callback for `ICCTVSystem.inject`: adds the silhouette to the scene for the injected
 * render only, and returns the cleanup that removes it again.
 */
export function injectSilhouette(sil: Silhouette, pos: Vec3, yaw: number): (scene: THREE.Scene) => () => void {
  return (scene: THREE.Scene) => {
    sil.place(pos, yaw);
    scene.add(sil.group);
    return () => {
      scene.remove(sil.group);
    };
  };
}
