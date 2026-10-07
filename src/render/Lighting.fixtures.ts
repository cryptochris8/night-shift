/**
 * Fixture visuals for the lighting system. Every fixture in the layout gets an emissive
 * mesh whose emissiveIntensity the LightingSystem drives per frame (bloom picks these
 * up); the inert housings are batched into a handful of merged static meshes so the
 * ~70 fixtures cost few draw calls. All textures are small procedural canvases.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LightFixtureDef } from '../core/types';
import { hash01 } from './Lighting.flicker';

export interface FixtureVisual {
  group: THREE.Group;
  /** materials whose emissiveIntensity follows the fixture level */
  emissive: THREE.MeshStandardMaterial[];
  emissiveBase: number;
  /** additive glow planes / cones whose opacity follows the level */
  halo: THREE.MeshBasicMaterial[];
  haloMeshes: THREE.Mesh[];
  haloBase: number;
  /** world-space position for the pool light */
  lightPos: THREE.Vector3;
  /** horizontal facing of a wall unit (unit vector), null for ceiling fixtures */
  facing: THREE.Vector3 | null;
  /** may host the shadow-casting key spot */
  keyEligible: boolean;
  /** key spot half-angle (rad) when this fixture holds it */
  keyAngle: number;
  dispose(): void;
}

export interface LensTextures {
  on: (warm: number) => THREE.Texture;
  off: (warm: number) => THREE.Texture;
}

type BatchKey = 'white_steel' | 'grey_steel' | 'offwhite' | 'dark' | 'pole' | 'led';

const UNIT = new THREE.Vector3(1, 1, 1);

function local(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    UNIT,
  );
}

/** Collects static housing geometry (already in world space) and merges it per material. */
export class StaticBatcher {
  private readonly parts = new Map<BatchKey, THREE.BufferGeometry[]>();
  private readonly materials: Record<BatchKey, THREE.MeshStandardMaterial>;
  /** emergency-unit charge indicator; the lighting system drives its emissiveIntensity */
  readonly ledMaterial: THREE.MeshStandardMaterial;

  constructor() {
    this.ledMaterial = new THREE.MeshStandardMaterial({ color: 0x0a2a12, emissive: 0x30ff60, emissiveIntensity: 0, roughness: 0.4, metalness: 0 });
    this.materials = {
      white_steel: new THREE.MeshStandardMaterial({ color: 0xdad9d4, roughness: 0.45, metalness: 0.35 }),
      grey_steel: new THREE.MeshStandardMaterial({ color: 0x8f9092, roughness: 0.5, metalness: 0.6 }),
      offwhite: new THREE.MeshStandardMaterial({ color: 0xe3e3dc, roughness: 0.6, metalness: 0.1 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.7, metalness: 0.4 }),
      pole: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.55, metalness: 0.7 }),
      led: this.ledMaterial,
    };
  }

  /** Adds a copy of `geom` transformed by `world`; the caller still owns `geom`. */
  add(key: BatchKey, geom: THREE.BufferGeometry, world: THREE.Matrix4): void {
    const g = geom.clone();
    g.applyMatrix4(world);
    let list = this.parts.get(key);
    if (!list) {
      list = [];
      this.parts.set(key, list);
    }
    list.push(g);
  }

  build(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [key, list] of this.parts) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.materials[key]);
      mesh.name = `lighting_static_${key}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.userData.lighting = true;
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }

  dispose(): void {
    for (const m of Object.values(this.materials)) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Procedural textures (cached per module)
// ---------------------------------------------------------------------------

const texCache = new Map<string, THREE.Texture>();

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/** Red exit-sign face with hot letters (used as an emissive map under white emissive). */
export function exitFaceTexture(): THREE.Texture {
  return cached('exit_face', () => {
    const [c, ctx] = makeCanvas(256, 128);
    ctx.fillStyle = '#c41a10';
    ctx.fillRect(0, 0, 256, 128);
    const vg = ctx.createRadialGradient(128, 64, 10, 128, 64, 150);
    vg.addColorStop(0, 'rgba(255,90,70,0.35)');
    vg.addColorStop(1, 'rgba(60,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, 256, 128);
    // speckle so the face is not flat
    for (let i = 0; i < 500; i++) {
      const x = hash01(i * 3 + 1) * 256;
      const y = hash01(i * 3 + 2) * 128;
      ctx.fillStyle = `rgba(0,0,0,${(0.04 + hash01(i * 3 + 3) * 0.08).toFixed(3)})`;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.strokeStyle = 'rgba(255,215,205,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, 244, 116);
    ctx.fillStyle = '#ffe4dc';
    ctx.font = 'bold 84px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const letters = 'EXIT';
    const widths = letters.split('').map((ch) => ctx.measureText(ch).width);
    const spacing = 8;
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
    let x = 128 - total / 2;
    for (let i = 0; i < letters.length; i++) {
      ctx.fillText(letters[i], x + widths[i] / 2, 66);
      x += widths[i] + spacing;
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
}

/** Soft radial falloff (white, alpha) for additive halos; tinted by material colour. */
export function radialHaloTexture(): THREE.Texture {
  return cached('halo', () => {
    const [c, ctx] = makeCanvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Vertical alpha gradient for light cones: opaque at the apex (v=1), clear at the base. */
export function coneGradientTexture(): THREE.Texture {
  return cached('cone', () => {
    const [c, ctx] = makeCanvas(8, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
    return new THREE.CanvasTexture(c);
  });
}

/** Prismatic troffer lens, used only if the shared textures module is unavailable. */
export function fallbackLensTexture(on: boolean, warm: number): THREE.Texture {
  return cached(`lens:${on ? 1 : 0}:${warm}`, () => {
    const [c, ctx] = makeCanvas(256, 128);
    const base = on ? mixHex('#eef2ff', '#fff1dc', warm) : '#9b9ea3';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 256, 128);
    const a = on ? mixHex('#f8faff', '#fff7ea', warm) : '#a6a9ae';
    const b = on ? mixHex('#e3e8f6', '#f2e8d6', warm) : '#8f9297';
    for (let y = 0; y < 128; y += 8) {
      for (let x = 0; x < 256; x += 8) {
        ctx.fillStyle = ((x + y) / 8) % 2 === 0 ? a : b;
        ctx.fillRect(x, y, 8, 8);
      }
    }
    ctx.strokeStyle = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = -128; i < 256; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 128, 128);
      ctx.stroke();
    }
    if (on) {
      // the two tubes behind the lens read as softer hot bands
      for (const yy of [44, 84]) {
        const g = ctx.createLinearGradient(0, yy - 14, 0, yy + 14);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, yy - 14, 256, 28);
      }
    }
    const edge = ctx.createLinearGradient(0, 0, 0, 128);
    edge.addColorStop(0, 'rgba(0,0,0,0.18)');
    edge.addColorStop(0.1, 'rgba(0,0,0,0)');
    edge.addColorStop(0.9, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `rgba(0,0,0,${(hash01(i * 5 + 7) * 0.05).toFixed(3)})`;
      ctx.fillRect(hash01(i * 5 + 1) * 256, hash01(i * 5 + 2) * 128, 2, 2);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  });
}

function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, Math.min(1, Math.max(0, t))).getHexString()}`;
}

export function disposeFixtureTextures(): void {
  for (const t of texCache.values()) t.dispose();
  texCache.clear();
}

/** 0 cool … 1 warm, quantised to halves so lens textures cache well. */
export function warmthOf(color: THREE.Color): number {
  const w = Math.min(1, Math.max(0, (color.r - color.b) * 2.2));
  return Math.round(w * 2) / 2;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function emissiveMaterial(color: THREE.Color, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color.clone(), emissiveIntensity: 0, roughness: 0.45, metalness: 0, ...extra });
}

function haloMaterial(color: THREE.Color, map: THREE.Texture, alphaMap = false, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: color.clone(),
    map: alphaMap ? null : map,
    alphaMap: alphaMap ? map : null,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side,
  });
  if (alphaMap) {
    // Light shafts: fade toward the silhouette so a cone reads as a soft beam, not a flat triangle.
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShaftN;\nvarying vec3 vShaftV;')
        .replace(
          '#include <project_vertex>',
          '#include <project_vertex>\nvShaftN = normalize(normalMatrix * normal);\nvShaftV = normalize(-mvPosition.xyz);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShaftN;\nvarying vec3 vShaftV;')
        .replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\ndiffuseColor.a *= pow(abs(dot(normalize(vShaftN), normalize(vShaftV))), 2.2);',
        );
    };
    m.customProgramCacheKey = () => 'ns-light-shaft';
  }
  return m;
}

function addMesh(group: THREE.Group, geom: THREE.BufferGeometry, mat: THREE.Material, pos?: THREE.Vector3): THREE.Mesh {
  const m = new THREE.Mesh(geom, mat);
  if (pos) m.position.copy(pos);
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.lighting = true;
  group.add(m);
  return m;
}

interface Build {
  group: THREE.Group;
  world: THREE.Matrix4;
  batch: StaticBatcher;
  color: THREE.Color;
  def: LightFixtureDef;
}

function finish(
  b: Build,
  emissive: THREE.MeshStandardMaterial[],
  emissiveBase: number,
  halo: THREE.MeshBasicMaterial[],
  haloMeshes: THREE.Mesh[],
  haloBase: number,
  lightLocal: THREE.Vector3,
  facing: THREE.Vector3 | null,
  keyEligible: boolean,
  keyAngle: number,
): FixtureVisual {
  const lightPos = lightLocal.clone().applyMatrix4(b.world);
  const group = b.group;
  return {
    group,
    emissive,
    emissiveBase,
    halo,
    haloMeshes,
    haloBase,
    lightPos,
    facing,
    keyEligible,
    keyAngle,
    dispose(): void {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      });
      group.removeFromParent();
    },
  };
}

function buildTroffer(b: Build, lens: LensTextures): FixtureVisual {
  const w = b.def.size?.w ?? 1.2;
  const d = b.def.size?.d ?? 0.6;
  const t = 0.03;
  const barX = new THREE.BoxGeometry(w + 2 * t, 0.022, t);
  const barZ = new THREE.BoxGeometry(t, 0.022, d);
  b.batch.add('white_steel', barX, b.world.clone().multiply(local(0, 0.007, d / 2 + t / 2)));
  b.batch.add('white_steel', barX, b.world.clone().multiply(local(0, 0.007, -(d / 2 + t / 2))));
  b.batch.add('white_steel', barZ, b.world.clone().multiply(local(w / 2 + t / 2, 0.007, 0)));
  b.batch.add('white_steel', barZ, b.world.clone().multiply(local(-(w / 2 + t / 2), 0.007, 0)));
  barX.dispose();
  barZ.dispose();

  const warm = warmthOf(b.color);
  const lensGeo = new THREE.PlaneGeometry(w - 0.02, d - 0.02);
  lensGeo.rotateX(Math.PI / 2); // face down
  const mat = emissiveMaterial(b.color, { map: lens.off(warm), emissiveMap: lens.on(warm), roughness: 0.5 });
  addMesh(b.group, lensGeo, mat, new THREE.Vector3(0, -0.004, 0));
  // the pool light sits well below the lens: a recessed troffer barely lights the tiles around it,
  // and a point source 14 cm under the ceiling blew those tiles out to bloom-veiling intensity
  return finish(b, [mat], 2.6, [], [], 0, new THREE.Vector3(0, -0.35, 0), null, true, 1.05);
}

function buildStrip(b: Build): FixtureVisual {
  const w = b.def.size?.w ?? 1.2;
  const housing = new THREE.BoxGeometry(w, 0.045, 0.09);
  b.batch.add('grey_steel', housing, b.world.clone().multiply(local(0, 0.0125, 0)));
  housing.dispose();
  const socket = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  b.batch.add('offwhite', socket, b.world.clone().multiply(local(w / 2 - 0.075, -0.03, 0)));
  b.batch.add('offwhite', socket, b.world.clone().multiply(local(-(w / 2 - 0.075), -0.03, 0)));
  socket.dispose();
  const tube = new THREE.CylinderGeometry(0.017, 0.017, w - 0.2, 10, 1);
  tube.rotateZ(Math.PI / 2);
  const mat = emissiveMaterial(b.color, { color: 0xe9ecf0, roughness: 0.35 });
  addMesh(b.group, tube, mat, new THREE.Vector3(0, -0.03, 0));
  return finish(b, [mat], 4.0, [], [], 0, new THREE.Vector3(0, -0.3, 0), null, true, 1.05);
}

function buildExit(b: Build, ceilingY: number, facing: THREE.Vector3): FixtureVisual {
  const stemTop = ceilingY - b.def.pos.y - 0.002;
  const stemBottom = 0.1;
  if (stemTop > stemBottom + 0.01) {
    const stem = new THREE.BoxGeometry(0.03, stemTop - stemBottom, 0.03);
    b.batch.add('offwhite', stem, b.world.clone().multiply(local(0, (stemTop + stemBottom) / 2, 0)));
    stem.dispose();
  }
  const body = new THREE.BoxGeometry(0.36, 0.2, 0.07);
  b.batch.add('offwhite', body, b.world.clone());
  body.dispose();

  const front = new THREE.PlaneGeometry(0.32, 0.16).translate(0, 0, 0.036);
  const back = new THREE.PlaneGeometry(0.32, 0.16).rotateY(Math.PI).translate(0, 0, -0.036);
  const faces = mergeGeometries([front, back], false);
  front.dispose();
  back.dispose();
  const faceMat = emissiveMaterial(new THREE.Color(0xffffff), { color: 0x160806, emissiveMap: exitFaceTexture(), roughness: 0.6 });
  addMesh(b.group, faces, faceMat);

  const hf = new THREE.PlaneGeometry(0.66, 0.4).translate(0, 0, 0.05);
  const hb = new THREE.PlaneGeometry(0.66, 0.4).rotateY(Math.PI).translate(0, 0, -0.05);
  const halos = mergeGeometries([hf, hb], false);
  hf.dispose();
  hb.dispose();
  const haloMat = haloMaterial(b.color, radialHaloTexture());
  const haloMesh = addMesh(b.group, halos, haloMat);
  return finish(b, [faceMat], 3.0, [haloMat], [haloMesh], 0.42, new THREE.Vector3(0, -0.06, 0), facing, false, 0.8);
}

function buildEmergency(b: Build, facing: THREE.Vector3): FixtureVisual {
  const body = new THREE.BoxGeometry(0.3, 0.11, 0.085);
  b.batch.add('offwhite', body, b.world.clone().multiply(local(0, 0, -0.03)));
  body.dispose();
  const led = new THREE.BoxGeometry(0.014, 0.014, 0.006);
  b.batch.add('led', led, b.world.clone().multiply(local(0.1, -0.025, 0.016)));
  led.dispose();

  const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8);
  const head = new THREE.CylinderGeometry(0.04, 0.046, 0.075, 12);
  head.rotateX(Math.PI / 2); // axis along local z
  const lenses: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    b.batch.add('offwhite', stem, b.world.clone().multiply(local(sx * 0.11, 0.065, -0.005)));
    // heads aim forward, 40° down and ~22° outward
    const headM = local(sx * 0.11, 0.095, 0.02, 0.7, sx * 0.38, 0);
    b.batch.add('offwhite', head, b.world.clone().multiply(headM).multiply(local(0, 0, 0.0375)));
    const lens = new THREE.CircleGeometry(0.035, 14);
    lens.applyMatrix4(headM.clone().multiply(local(0, 0, 0.076)));
    lenses.push(lens);
  }
  stem.dispose();
  head.dispose();
  const lensGeo = mergeGeometries(lenses, false);
  lenses.forEach((g) => g.dispose());
  const mat = emissiveMaterial(b.color, { color: 0xfff8ee, roughness: 0.3 });
  addMesh(b.group, lensGeo, mat);
  const lightLocal = new THREE.Vector3(0, -0.2, 0.32);
  return finish(b, [mat], 7.0, [], [], 0, lightLocal, facing, true, 0.8);
}

function buildSodium(b: Build): FixtureVisual {
  const pole = b.def.pos.y > 5;
  const lensMat = emissiveMaterial(b.color, { color: 0xffe0b0, roughness: 0.3 });
  const coneMat = haloMaterial(b.color, coneGradientTexture(), true, THREE.DoubleSide);
  if (!pole) {
    const housing = new THREE.BoxGeometry(0.42, 0.16, 0.42);
    b.batch.add('dark', housing, b.world.clone().multiply(local(0, 0.09, 0)));
    housing.dispose();
    const lens = new THREE.CircleGeometry(0.15, 18);
    lens.rotateX(Math.PI / 2);
    addMesh(b.group, lens, lensMat, new THREE.Vector3(0, 0.004, 0));
    const cone = new THREE.ConeGeometry(1.6, 3.2, 24, 1, true);
    const coneMesh = addMesh(b.group, cone, coneMat, new THREE.Vector3(0, -1.6, 0));
    return finish(b, [lensMat], 3.5, [coneMat], [coneMesh], 0.08, new THREE.Vector3(0, -0.25, 0), null, true, 0.95);
  }
  const h = b.def.pos.y + 0.1;
  const shaft = new THREE.CylinderGeometry(0.07, 0.09, h, 10);
  b.batch.add('pole', shaft, b.world.clone().multiply(local(-0.9, (0.1 - b.def.pos.y) / 2, 0)));
  shaft.dispose();
  const arm = new THREE.BoxGeometry(0.9, 0.06, 0.06);
  b.batch.add('pole', arm, b.world.clone().multiply(local(-0.45, 0.07, 0)));
  arm.dispose();
  const head = new THREE.BoxGeometry(0.7, 0.14, 0.32);
  b.batch.add('dark', head, b.world.clone().multiply(local(0, 0.05, 0)));
  head.dispose();
  const lens = new THREE.CircleGeometry(0.2, 18);
  lens.rotateX(Math.PI / 2);
  addMesh(b.group, lens, lensMat, new THREE.Vector3(0, -0.021, 0));
  const cone = new THREE.ConeGeometry(3.4, 6.0, 24, 1, true);
  const coneMesh = addMesh(b.group, cone, coneMat, new THREE.Vector3(0, -3.0, 0));
  return finish(b, [lensMat], 3.5, [coneMat], [coneMesh], 0.07, new THREE.Vector3(0, -0.3, 0), null, true, 1.0);
}

function buildDesk(b: Build): FixtureVisual {
  const housing = new THREE.BoxGeometry(0.6, 0.035, 0.05);
  b.batch.add('grey_steel', housing, b.world.clone().multiply(local(0, 0.0175, 0)));
  housing.dispose();
  const lens = new THREE.PlaneGeometry(0.56, 0.04);
  lens.rotateX(Math.PI / 2);
  const mat = emissiveMaterial(b.color, { color: 0xfff4e4 });
  addMesh(b.group, lens, mat, new THREE.Vector3(0, -0.001, 0));
  return finish(b, [mat], 2.2, [], [], 0, new THREE.Vector3(0, -0.06, 0), null, false, 0.8);
}

function buildCan(b: Build): FixtureVisual {
  const trim = new THREE.CylinderGeometry(0.09, 0.09, 0.012, 20, 1, true);
  b.batch.add('offwhite', trim, b.world.clone().multiply(local(0, 0.006, 0)));
  trim.dispose();
  const lens = new THREE.CircleGeometry(0.075, 16);
  lens.rotateX(Math.PI / 2);
  const mat = emissiveMaterial(b.color, { color: 0xfff6ea });
  addMesh(b.group, lens, mat, new THREE.Vector3(0, -0.001, 0));
  return finish(b, [mat], 2.4, [], [], 0, new THREE.Vector3(0, -0.1, 0), null, true, 0.8);
}

function buildLamp(b: Build): FixtureVisual {
  const shade = new THREE.ConeGeometry(0.16, 0.18, 16, 1, true);
  b.batch.add('offwhite', shade, b.world.clone().multiply(local(0, 0.06, 0)));
  shade.dispose();
  const bulb = new THREE.SphereGeometry(0.03, 12, 8);
  const mat = emissiveMaterial(b.color, { color: 0xfff6e8 });
  addMesh(b.group, bulb, mat);
  return finish(b, [mat], 2.0, [], [], 0, new THREE.Vector3(0, -0.05, 0), null, false, 0.8);
}

/**
 * Builds the visual for a layout fixture. Returns null for invisible glow sources
 * (monitor / vending), which are point lights only.
 */
export function buildFixtureVisual(
  def: LightFixtureDef,
  yaw: number,
  color: THREE.Color,
  ceilingY: number,
  lens: LensTextures,
  batch: StaticBatcher,
): FixtureVisual | null {
  if (def.kind === 'monitor' || def.kind === 'vending') return null;
  const group = new THREE.Group();
  group.name = def.id;
  group.userData.room = def.room;
  group.userData.lighting = true;
  group.position.set(def.pos.x, def.pos.y, def.pos.z);
  group.rotation.y = yaw;
  group.updateMatrix();
  const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const b: Build = { group, world: group.matrix.clone(), batch, color, def };
  switch (def.kind) {
    case 'fluorescent':
      return buildTroffer(b, lens);
    case 'strip':
      return buildStrip(b);
    case 'exit':
      return buildExit(b, ceilingY, facing);
    case 'emergency':
      return buildEmergency(b, facing);
    case 'sodium':
      return buildSodium(b);
    case 'desk':
      return buildDesk(b);
    case 'can':
      return buildCan(b);
    case 'lamp':
    default:
      return buildLamp(b);
  }
}

/**
 * The glow behind the closed west-wing doors: a light seam under the door on the
 * service-hall side plus an additive spill on the floor. Faces +x (into the hall).
 */
export function buildDoorSeamVisual(seam: { x: number; z0: number; z1: number; color: THREE.Color }, batch: StaticBatcher): FixtureVisual {
  const group = new THREE.Group();
  group.name = 'ww_glow';
  group.userData.room = 'service_n';
  group.userData.lighting = true;
  const zc = (seam.z0 + seam.z1) / 2;
  const width = seam.z1 - seam.z0;
  group.position.set(seam.x, 0, zc);
  group.updateMatrix();
  const def: LightFixtureDef = { id: 'ww_glow', room: 'service_n', pos: { x: seam.x, y: 0, z: zc }, kind: 'strip', circuit: 'emergency', zone: 'west_wing' };
  const b: Build = { group, world: group.matrix.clone(), batch, color: seam.color, def };

  const seamGeo = new THREE.PlaneGeometry(width, 0.028);
  seamGeo.rotateY(Math.PI / 2); // normal +x
  const seamMat = emissiveMaterial(seam.color, { color: 0x203028, roughness: 0.6 });
  addMesh(group, seamGeo, seamMat, new THREE.Vector3(0, 0.014, 0));

  const spillGeo = new THREE.PlaneGeometry(0.6, width + 0.3);
  spillGeo.rotateX(-Math.PI / 2); // face up
  const spillMat = haloMaterial(seam.color, radialHaloTexture());
  const spill = addMesh(group, spillGeo, spillMat, new THREE.Vector3(0.3, 0.006, 0));

  return finish(b, [seamMat], 2.4, [spillMat], [spill], 0.22, new THREE.Vector3(0.22, 0.25, 0), new THREE.Vector3(1, 0, 0), false, 0.8);
}
