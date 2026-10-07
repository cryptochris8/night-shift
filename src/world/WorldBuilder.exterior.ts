/**
 * Exterior: wet asphalt lot, flush concrete apron and bay markings, dark panel façade with the
 * glazing cut out, the upper storey mass, sky dome, distant buildings with scattered lit windows,
 * chain-link fence silhouette, street lamps beyond the fence and a GPU rain streak field.
 * Deterministic per seed (rng fork).
 */
import * as THREE from 'three';
import type { RNG } from '../core/rng';
import type { HospitalLayout, RoomDef } from '../core/types';
import { GeoBatch, box, hQuad, splitWall, tube, wallQuad, type Hole } from './WorldBuilder.geom';
import { UVS, type MaterialKit } from './WorldBuilder.materials';

export interface GlassRegion {
  z0: number;
  z1: number;
  y1: number;
}

export interface ExteriorOptions {
  room: RoomDef;
  layout: HospitalLayout;
  kit: MaterialKit;
  rng: RNG;
  /** glazed regions of the façade (world z range + top), cut out of the dark panels */
  glass: GlassRegion[];
  /** canopy footprint (rain stops under it) */
  canopy: { x0: number; x1: number; z0: number; z1: number; y: number } | null;
}

const RAIN_COUNT = 4000;
const RAIN_HEIGHT = 9;

const RAIN_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uIntensity;
uniform float uSizePx;
uniform float uHeight;
uniform vec4 uCanopy;
uniform float uCanopyY;
varying float vAlpha;
void main() {
  vec3 p = position;
  float speed = 6.5 + aSeed * 4.5;
  float t = uTime * speed + aSeed * 173.0;
  p.y = uHeight - mod(p.y + t, uHeight);
  float fall = (uHeight - p.y);
  p.x += fall * 0.06 + sin(aSeed * 6.2831 + uTime * 0.7) * 0.08;
  p.z += fall * 0.025;
  float under = step(uCanopy.x, p.x) * step(p.x, uCanopy.y) * step(uCanopy.z, p.z) * step(p.z, uCanopy.w) * step(p.y, uCanopyY);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = max(0.5, -mv.z);
  gl_PointSize = clamp(uSizePx / dist, 1.5, 48.0);
  float nearFade = smoothstep(0.6, 2.5, dist);
  float farFade = 1.0 - smoothstep(22.0, 48.0, dist);
  vAlpha = uIntensity * (1.0 - under) * nearFade * farFade * (0.55 + 0.45 * aSeed);
  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float streak = smoothstep(0.09, 0.0, abs(c.x)) * (1.0 - smoothstep(0.28, 0.5, abs(c.y)));
  float a = streak * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

export class Exterior {
  readonly group = new THREE.Group();
  private rain: THREE.Points | null = null;
  private rainMat: THREE.ShaderMaterial | null = null;
  private sky: THREE.Mesh | null = null;
  private skyMat: THREE.MeshBasicMaterial;
  private beaconMat: THREE.MeshStandardMaterial | null = null;
  private litWindowMat: THREE.MeshStandardMaterial | null = null;
  private time = 0;
  private dawnStep = 0;
  private geometries: THREE.BufferGeometry[] = [];
  private readonly kit: MaterialKit;

  constructor(private readonly o: ExteriorOptions) {
    this.kit = o.kit;
    this.group.name = 'exterior_env';
    this.group.userData.room = 'exterior';
    this.skyMat = this.kit.sky();
    this.buildLot();
    this.buildFacade();
    this.buildSky();
    this.buildBuildings();
    this.buildFence();
    this.buildPoles();
    this.buildRain();
  }

  // ---------------------------------------------------------------------------
  // Lot
  // ---------------------------------------------------------------------------

  private buildLot(): void {
    const { kit, room } = this.o;
    const batch = new GeoBatch();
    const mats = new Map<string, THREE.Material>();
    const use = (k: string, m: THREE.Material): string => {
      mats.set(k, m);
      return k;
    };
    const fx = room.bounds.x1; // façade line
    const walkW = 2.0;
    const asphalt = use('asphalt', kit.floor('asphalt'));
    const walk = use('sidewalk', kit.sidewalk());
    // asphalt everywhere except the concrete apron strip along the façade
    batch.add(asphalt, hQuad(-80, fx - walkW, -50, 40, 0, true, UVS.asphalt, UVS.asphalt));
    batch.add(asphalt, hQuad(fx - walkW, fx, -50, -16, 0, true, UVS.asphalt, UVS.asphalt));
    batch.add(asphalt, hQuad(fx - walkW, fx, 10, 40, 0, true, UVS.asphalt, UVS.asphalt));
    batch.add(walk, hQuad(fx - walkW, fx, -16, 10, 0, true, UVS.concrete, UVS.concrete));
    // apron edge: flush kerb line (painted) + a low kerb beyond the fence to the street
    const yellow = use('yellow', kit.lotPaint(0x9b8a3a));
    const white = use('white', kit.lotPaint(0x9a9a92));
    batch.add(yellow, hQuad(fx - walkW - 0.14, fx - walkW, -16, 10, 0.003, true, 1, 1));
    // ambulance zone hatching in front of the bay doors
    for (let i = -3; i <= 3; i++) {
      const cx = fx - walkW - 2.3 + i * 0.05;
      const g = hQuad(-0.06, 0.06, -2.1, 2.1, 0.003, true, 1, 1);
      g.rotateY(Math.PI / 4);
      g.translate(cx + i * 0.55, 0, i * 0.55 - 0.3);
      batch.add(yellow, g);
    }
    batch.add(yellow, hQuad(fx - walkW - 4.9, fx - walkW - 4.76, -3.0, 3.0, 0.003, true, 1, 1));
    // parking bay lines, south-west
    for (let i = 0; i < 5; i++) {
      const x = -33.6 + i * 2.6;
      batch.add(white, hQuad(x, x + 0.1, -12.6, -7.4, 0.003, true, 1, 1));
    }
    batch.add(white, hQuad(-33.6, -23.1, -7.5, -7.4, 0.003, true, 1, 1));
    // drain grate near the bay
    const dark = use('dark', kit.darkMetal());
    batch.add(dark, box(-25.3, -24.7, 0.0005, 0.004, -1.3, -0.7));
    for (let i = 0; i < 6; i++) batch.add(dark, box(-25.28 + i * 0.1, -25.24 + i * 0.1, 0.004, 0.006, -1.28, -0.72));
    // street kerb and road beyond the fence
    const kerb = use('kerb', kit.facadeBand());
    batch.add(kerb, box(-36.4, -36.2, 0, 0.14, -48, 38));
    batch.flush(this.group, (k) => mats.get(k)!, { receiveShadow: true, room: 'exterior', namePrefix: 'lot:' });

    // faded floor lettering
    const sign = new THREE.Mesh(hQuad(-2.0, 2.0, -0.38, 0.38, 0.004, true, 4.0, 0.76), kit.floorSign('AMBULANCES ONLY'));
    sign.position.set(fx - walkW - 3.2, 0, -4.9);
    sign.rotation.y = Math.PI / 2;
    sign.receiveShadow = true;
    sign.userData.room = 'exterior';
    this.geometries.push(sign.geometry as THREE.BufferGeometry);
    this.group.add(sign);
  }

  // ---------------------------------------------------------------------------
  // Façade
  // ---------------------------------------------------------------------------

  private buildFacade(): void {
    const { kit, room, glass, rng } = this.o;
    const fx = room.bounds.x1;
    const batch = new GeoBatch();
    const mats = new Map<string, THREE.Material>();
    const use = (k: string, m: THREE.Material): string => {
      mats.set(k, m);
      return k;
    };
    const panel = use('panel', kit.facadePanel());
    const band = use('band', kit.facadeBand());
    const darkWin = use('darkwin', kit.darkWindow());
    const lower = 3.5;
    const z0 = -16;
    const z1 = 10;
    const holes: Hole[] = glass.map((g) => ({ u0: g.z0, u1: g.z1, y0: 0, y1: g.y1 }));
    // lower façade: dark panels around the glazing, facing the lot (−x)
    for (const r of splitWall(z0, z1, lower, holes)) {
      batch.add(panel, wallQuad('e', r.u0, r.u1, r.y0, r.y1, fx, UVS.facade, UVS.facade));
    }
    // upper storey mass sits above every interior ceiling
    batch.add(panel, box(fx, fx + 16, lower, 7.6, z0 - 1, z1 + 1, UVS.facade));
    batch.add(band, box(fx - 0.1, fx, lower - 0.2, lower + 0.25, z0, z1, UVS.concrete));
    batch.add(band, box(fx - 0.12, fx, 7.6, 7.78, z0 - 1, z1 + 1, UVS.concrete));
    // upper windows (dark, one dimly lit behind blinds)
    const litIndex = rng.int(1, 6);
    let idx = 0;
    for (let z = z0 + 1.6; z < z1 - 1.4; z += 3.2) {
      const g = wallQuad('e', z, z + 1.4, 4.6, 5.8, fx - 0.015, 1, 1);
      if (idx === litIndex) {
        this.litWindowMat = kit.makeEmissive(0x8a7448, 0.45, 0x1a1a1a);
        const m = new THREE.Mesh(g, this.litWindowMat);
        m.userData.room = 'exterior';
        this.geometries.push(g);
        this.group.add(m);
      } else {
        batch.add(darkWin, g);
      }
      idx++;
    }
    batch.flush(this.group, (k) => mats.get(k)!, { receiveShadow: true, room: 'exterior', namePrefix: 'facade:' });
  }

  // ---------------------------------------------------------------------------
  // Sky
  // ---------------------------------------------------------------------------

  private buildSky(): void {
    // full sphere so the texture's horizon (v = 0.5) sits on the geometric horizon;
    // radius kept within the 120 m camera far plane from every exterior viewpoint
    const g = new THREE.SphereGeometry(85, 40, 24);
    this.geometries.push(g);
    this.sky = new THREE.Mesh(g, this.skyMat);
    this.sky.position.set(-32, -6, -5);
    this.sky.name = 'sky';
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.userData.room = 'exterior';
    this.group.add(this.sky);
  }

  // ---------------------------------------------------------------------------
  // Distant buildings
  // ---------------------------------------------------------------------------

  private buildBuildings(): void {
    const { kit, rng } = this.o;
    const batch = new GeoBatch();
    const mats = new Map<string, THREE.Material>();
    const use = (k: string, m: THREE.Material): string => {
      mats.set(k, m);
      return k;
    };
    const dark = use('dark', kit.buildingDark());
    const warm = use('warm', kit.windowGlow('warm'));
    const cool = use('cool', kit.windowGlow('cool'));
    const tv = use('tv', kit.windowGlow('tv'));
    const lotX = -27;
    const lotZ = -4;
    let tallest: { x: number; z: number; h: number } | null = null;
    const placed: { x: number; z: number; w: number; d: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const a = rng.range(Math.PI * 0.6, Math.PI * 1.4);
      const r = rng.range(34, 66);
      const cx = lotX + Math.cos(a) * r;
      const cz = lotZ + Math.sin(a) * r;
      if (cx > -40 && Math.abs(cz - lotZ) < 22) continue;
      const w = rng.range(9, 22);
      const d = rng.range(9, 20);
      const h = rng.range(7, 28);
      if (placed.some((p) => Math.abs(p.x - cx) < (p.w + w) / 2 + 2 && Math.abs(p.z - cz) < (p.d + d) / 2 + 2)) continue;
      placed.push({ x: cx, z: cz, w, d });
      batch.add(dark, box(cx - w / 2, cx + w / 2, 0, h, cz - d / 2, cz + d / 2));
      if (!tallest || h > tallest.h) tallest = { x: cx, z: cz, h };
      // windows on the face toward the lot
      const dx = lotX - cx;
      const dz = lotZ - cz;
      const faceX = Math.abs(dx) > Math.abs(dz);
      const litChance = rng.range(0.06, 0.16);
      for (let y = 2.0; y < h - 1.6; y += 3.2) {
        const len = faceX ? d : w;
        const start = faceX ? cz - d / 2 : cx - w / 2;
        for (let u = start + 1.0; u < start + len - 1.6; u += 2.6) {
          if (!rng.chance(litChance)) continue;
          const v = rng.next();
          const key = v < 0.6 ? warm : v < 0.85 ? cool : tv;
          const ww = rng.range(0.8, 1.3);
          const wh = rng.range(0.9, 1.3);
          if (faceX) {
            const k = dx > 0 ? cx + w / 2 + 0.03 : cx - w / 2 - 0.03;
            batch.add(key, wallQuad(dx > 0 ? 'w' : 'e', u, u + ww, y, y + wh, k, 1, 1));
          } else {
            const k = dz > 0 ? cz + d / 2 + 0.03 : cz - d / 2 - 0.03;
            batch.add(key, wallQuad(dz > 0 ? 's' : 'n', u, u + ww, y, y + wh, k, 1, 1));
          }
        }
      }
      // roof clutter on bigger blocks
      if (h > 14) {
        batch.add(dark, box(cx - 1.5, cx + 1.5, h, h + rng.range(1.2, 2.6), cz - 1.2, cz + 1.2));
        batch.add(dark, tube(cx + 2, h, cz + 2, cx + 2, h + rng.range(3, 7), cz + 2, 0.08, 6));
      }
    }
    batch.flush(this.group, (k) => mats.get(k)!, { receiveShadow: false, room: 'exterior', namePrefix: 'city:' });
    if (tallest) {
      this.beaconMat = kit.makeEmissive(0xff2a1a, 2.4, 0x200806);
      const g = new THREE.SphereGeometry(0.28, 10, 8);
      this.geometries.push(g);
      const beacon = new THREE.Mesh(g, this.beaconMat);
      beacon.position.set(tallest.x + 2, tallest.h + 6.6, tallest.z + 2);
      beacon.name = 'beacon';
      this.group.add(beacon);
    }
  }

  // ---------------------------------------------------------------------------
  // Fence
  // ---------------------------------------------------------------------------

  private buildFence(): void {
    const { kit, room } = this.o;
    const b = room.bounds;
    const batch = new GeoBatch();
    const runs: [number, number, number, number][] = [
      [b.x0, b.z0, b.x0, b.z1], // west
      [b.x0, b.z1, b.x1 - 2.0, b.z1], // north
      [b.x0, b.z0, -30, b.z0], // south, west of the drive
      [-24, b.z0, b.x1 - 2.0, b.z0], // south, east of the drive
    ];
    const lines: number[] = [];
    const h = 2.4;
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 3));
      const dx = (x1 - x0) / n;
      const dz = (z1 - z0) / n;
      for (let i = 0; i <= n; i++) {
        const x = x0 + dx * i;
        const z = z0 + dz * i;
        batch.add('post', tube(x, 0, z, x, h, z, 0.03, 6));
      }
      batch.add('post', tube(x0, h, z0, x1, h, z1, 0.02, 6));
      batch.add('post', tube(x0, h * 0.5, z0, x1, h * 0.5, z1, 0.014, 6));
      // diamond lattice as line segments
      const step = 0.32;
      const nx = Math.floor(len / step);
      const ux = (x1 - x0) / len;
      const uz = (z1 - z0) / len;
      for (let i = 0; i <= nx; i++) {
        const s = i * step;
        const px = x0 + ux * s;
        const pz = z0 + uz * s;
        const qx = x0 + ux * Math.min(len, s + h * 0.5);
        const qz = z0 + uz * Math.min(len, s + h * 0.5);
        lines.push(px, 0.05, pz, qx, h - 0.05, qz);
        lines.push(qx, 0.05, qz, px, h - 0.05, pz);
      }
    }
    batch.flush(this.group, () => kit.darkMetal(), { receiveShadow: false, castShadow: false, room: 'exterior', namePrefix: 'fence:' });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.geometries.push(lg);
    const mesh = new THREE.LineSegments(lg, kit.fenceLine());
    mesh.name = 'fence_mesh';
    mesh.userData.room = 'exterior';
    this.group.add(mesh);
  }

  // ---------------------------------------------------------------------------
  // Lamp poles (the light itself belongs to the lighting system)
  // ---------------------------------------------------------------------------

  private buildPoles(): void {
    const { kit, layout } = this.o;
    const batch = new GeoBatch();
    for (const f of layout.lights) {
      if (f.room !== 'exterior' || f.kind !== 'sodium' || f.pos.y < 5) continue;
      const { x, y, z } = f.pos;
      batch.add('pole', tube(x, 0, z, x, y - 0.1, z, 0.08, 10));
      batch.add('pole', tube(x, y - 0.1, z, x + 1.0, y + 0.05, z, 0.045, 8));
      batch.add('pole', box(x + 0.7, x + 1.3, y + 0.05, y + 0.2, z - 0.15, z + 0.15));
      batch.add('pole', box(x - 0.25, x + 0.25, 0, 0.5, z - 0.25, z + 0.25));
    }
    // street lamps beyond the fence: silhouettes with a sodium glow bead (no actual light)
    const glow = kit.makeEmissive(0xff9a30, 2.2, 0x3a2a14);
    const heads: THREE.BufferGeometry[] = [];
    for (const z of [-24, 2, 26]) {
      const x = -44;
      batch.add('pole', tube(x, 0, z, x, 8, z, 0.08, 8));
      batch.add('pole', tube(x, 8, z, x + 1.6, 8.3, z, 0.05, 6));
      batch.add('pole', box(x + 1.3, x + 1.9, 8.3, 8.45, z - 0.15, z + 0.15));
      heads.push(box(x + 1.4, x + 1.8, 8.22, 8.3, z - 0.1, z + 0.1));
    }
    batch.flush(this.group, () => kit.darkMetal(), { receiveShadow: false, castShadow: true, room: 'exterior', namePrefix: 'poles:' });
    const hb = new GeoBatch();
    for (const g of heads) hb.add('glow', g);
    hb.flush(this.group, () => glow, { receiveShadow: false, room: 'exterior', namePrefix: 'street:' });
  }

  // ---------------------------------------------------------------------------
  // Rain
  // ---------------------------------------------------------------------------

  private buildRain(): void {
    const { rng, canopy, room } = this.o;
    const b = room.bounds;
    const pos = new Float32Array(RAIN_COUNT * 3);
    const seed = new Float32Array(RAIN_COUNT);
    const x0 = b.x0 - 3;
    const x1 = b.x1 - 0.15;
    const z0 = b.z0 - 3;
    const z1 = b.z1 + 3;
    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3] = rng.range(x0, x1);
      pos[i * 3 + 1] = rng.range(0, RAIN_HEIGHT);
      pos[i * 3 + 2] = rng.range(z0, z1);
      seed[i] = rng.next();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3((x0 + x1) / 2, RAIN_HEIGHT / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, RAIN_HEIGHT, z1 - z0));
    this.geometries.push(g);
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uSizePx: { value: 26 },
        uHeight: { value: RAIN_HEIGHT },
        uColor: { value: new THREE.Color(0.5, 0.46, 0.38) },
        uCanopy: { value: canopy ? new THREE.Vector4(canopy.x0, canopy.x1, canopy.z0, canopy.z1) : new THREE.Vector4(0, 0, 0, 0) },
        uCanopyY: { value: canopy ? canopy.y : -1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.rainMat.name = 'rain';
    this.rain = new THREE.Points(g, this.rainMat);
    this.rain.name = 'rain';
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    this.rain.userData.room = 'exterior';
    this.group.add(this.rain);
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  setRain(intensity: number): void {
    const i = Math.max(0, Math.min(1, intensity));
    if (!this.rain || !this.rainMat) return;
    this.rainMat.uniforms.uIntensity.value = 0.35 + 0.65 * i;
    const count = i <= 0.001 ? 0 : Math.floor(RAIN_COUNT * (0.25 + 0.75 * i));
    this.rain.geometry.setDrawRange(0, count);
    this.rain.visible = count > 0;
  }

  /** Dawn 0..1: swaps the sky map in steps and cools/brightens the dome. */
  setDawn(amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    const step = Math.round(a * 4) / 4;
    if (step !== this.dawnStep) {
      this.dawnStep = step;
      const map = this.kit.t(() => this.kit.tex.skyTexture(step > 0 ? { dawn: step } : undefined));
      if (map) {
        this.skyMat.map = map;
        this.skyMat.needsUpdate = true;
      }
    }
    this.skyMat.color.setRGB(1 + a * 0.6, 1 + a * 0.7, 1 + a * 0.9);
    if (this.litWindowMat) this.litWindowMat.emissiveIntensity = 0.45 * (1 - a);
  }

  update(dt: number, pixelRatio: number): void {
    this.time += dt;
    if (this.rainMat) {
      this.rainMat.uniforms.uTime.value = this.time;
      this.rainMat.uniforms.uSizePx.value = 26 * pixelRatio;
    }
    if (this.sky) this.sky.rotation.y += dt * 0.0025;
    if (this.beaconMat) {
      const phase = this.time % 1.6;
      this.beaconMat.emissiveIntensity = phase < 0.18 ? 2.6 : 0.15;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.geometries = [];
    this.rainMat?.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) (m.geometry as THREE.BufferGeometry).dispose();
    });
    this.group.removeFromParent();
  }
}
