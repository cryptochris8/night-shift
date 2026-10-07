/**
 * Material kit for the world. Materials are cached by key so merged geometry across rooms
 * shares programs, and every texture comes from src/render/textures.ts (cached there; we never
 * dispose textures). A texture factory that throws degrades to a flat colour so the world still
 * renders while modules are being integrated.
 */
import * as THREE from 'three';
import type { FloorKind, WallKind } from '../core/types';

export type Tex = typeof import('../render/textures');

/**
 * World metres covered by one texture repeat (mirrors TEXTURE_METRES in src/render/textures.ts).
 * Geometry UVs are authored in metres / these, so textures stay at repeat (1,1) and tile
 * continuously across merged rooms.
 */
export const UVS = {
  vinyl: 1.2,
  tile: 1.0,
  concrete: 2.0,
  carpet: 1.0,
  asphalt: 3.0,
  painted: 2.8,
  tileWall: 2.8,
  block: 2.8,
  panels: 2.4,
  slab: 2.0,
  metal: 1.0,
  facade: 2.8,
} as const;

export type DoorFaceKind = 'wood' | 'steel' | 'glass_frame';
export type SignKind = 'room_number' | 'wayfinding' | 'dept' | 'warning' | 'big_red' | 'hospital_name' | 'elevator_call' | 'exit';

export class MaterialKit {
  private cache = new Map<string, THREE.Material>();
  /** materials created outside the cache (per-lamp emissives, haze) that we still own */
  private owned = new Set<THREE.Material>();

  constructor(readonly tex: Tex) {}

  /** Every material created by this kit (for dispose bookkeeping in disposeTree). */
  ownsSet(): Set<THREE.Material> {
    const all = new Set<THREE.Material>(this.owned);
    for (const m of this.cache.values()) all.add(m);
    return all;
  }

  private get<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.cache.get(key) as T | undefined;
    if (!m) {
      m = make();
      m.name = key;
      this.cache.set(key, m);
    }
    return m;
  }

  /** Guarded texture call: a failing factory yields null (flat colour fallback). */
  t<T extends THREE.Texture>(fn: () => T): T | null {
    try {
      return fn();
    } catch (err) {
      console.warn('[world] texture factory failed', err);
      return null;
    }
  }

  own<T extends THREE.Material>(m: T): T {
    this.owned.add(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Architecture
  // ---------------------------------------------------------------------------

  floor(kind: FloorKind, tint = 0xffffff, wear = 0.6): THREE.MeshStandardMaterial {
    return this.get(`floor:${kind}:${tint}:${wear}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: tint });
      switch (kind) {
        case 'vinyl':
          m.map = this.t(() => this.tex.vinylFloorTexture({ wear }));
          m.roughness = 0.28;
          m.metalness = 0.05;
          m.envMapIntensity = 1.1;
          break;
        case 'tile':
          m.map = this.t(() => this.tex.ceramicTileTexture());
          m.roughness = 0.34;
          m.metalness = 0.02;
          break;
        case 'concrete':
          m.map = this.t(() => this.tex.concreteTexture({ stains: 0.7 }));
          m.roughness = 0.86;
          m.metalness = 0;
          break;
        case 'carpet':
          m.map = this.t(() => this.tex.carpetTexture());
          m.roughness = 1;
          m.metalness = 0;
          break;
        case 'asphalt':
          m.map = this.t(() => this.tex.asphaltTexture({ wet: 1 }));
          m.roughness = 0.3;
          m.metalness = 0.0;
          m.envMapIntensity = 1.4;
          break;
      }
      if (!m.map) m.color.multiplyScalar(kind === 'asphalt' ? 0.18 : kind === 'concrete' ? 0.55 : 0.75);
      return m;
    });
  }

  /** Inward-facing single-sided wall. `ceiling` sets the vertical repeat for painted walls. */
  wall(kind: WallKind, tint = 0xffffff, ceiling = 2.8): THREE.MeshStandardMaterial {
    const key = kind === 'painted' ? `wall:${kind}:${tint}:${ceiling}` : `wall:${kind}:${tint}`;
    return this.get(key, () => {
      const m = new THREE.MeshStandardMaterial({ color: tint, side: THREE.FrontSide });
      m.shadowSide = THREE.DoubleSide;
      switch (kind) {
        case 'painted':
          // texture covers 0..2.8 m in one repeat; scale the rail so it stays at 0.9 m in taller rooms
          m.map = this.t(() => this.tex.paintedWallTexture({ railHeight: (0.9 * 2.8) / ceiling, grime: 0.6 }));
          m.roughness = 0.62;
          m.metalness = 0;
          break;
        case 'tile':
          m.map = this.t(() => this.tex.tileWallTexture());
          m.roughness = 0.3;
          m.metalness = 0.02;
          break;
        case 'block':
          m.map = this.t(() => this.tex.blockWallTexture());
          m.roughness = 0.88;
          m.metalness = 0;
          break;
        case 'concrete':
          m.map = this.t(() => this.tex.concreteTexture({ stains: 0.5, seed: 11 }));
          m.roughness = 0.92;
          break;
        case 'glass':
          // glass sides are built with glass(); this is the frame fallback
          m.color.set(0x8a8e92);
          m.roughness = 0.4;
          m.metalness = 0.6;
          break;
      }
      if (!m.map) m.color.multiplyScalar(0.7);
      return m;
    });
  }

  ceilingPanels(): THREE.MeshStandardMaterial {
    return this.get('ceiling:panels', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.92, metalness: 0 });
      m.map = this.t(() => this.tex.ceilingPanelTexture({ stains: 0.5 }));
      if (!m.map) m.color.set(0x9a9a94);
      return m;
    });
  }

  slab(): THREE.MeshStandardMaterial {
    return this.get('ceiling:slab', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95, metalness: 0 });
      m.map = this.t(() => this.tex.concreteTexture({ stains: 0.35, seed: 5 }));
      if (!m.map) m.color.set(0x5c5c58);
      return m;
    });
  }

  baseboard(): THREE.MeshStandardMaterial {
    return this.get('baseboard', () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.6, metalness: 0 }));
  }

  glass(): THREE.MeshPhysicalMaterial {
    return this.get('glass:clear', () => {
      const m = new THREE.MeshPhysicalMaterial({
        color: 0xcfe6dc,
        roughness: 0.06,
        metalness: 0,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.3,
        ior: 1.5,
        reflectivity: 0.6,
        transmission: 0,
      });
      m.shadowSide = THREE.DoubleSide;
      return m;
    });
  }

  /** Older interior glazing: a little dirtier and greener (imaging window, door lites). */
  glassDirty(): THREE.MeshPhysicalMaterial {
    return this.get('glass:dirty', () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xb8c8bc,
        roughness: 0.2,
        metalness: 0,
        transparent: true,
        opacity: 0.26,
        side: THREE.DoubleSide,
        depthWrite: false,
        envMapIntensity: 1.0,
        ior: 1.5,
        transmission: 0,
      }),
    );
  }

  alu(): THREE.MeshStandardMaterial {
    return this.get('alu', () => new THREE.MeshStandardMaterial({ color: 0x9a9ea2, metalness: 0.85, roughness: 0.38 }));
  }

  steel(): THREE.MeshStandardMaterial {
    return this.get('steel', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xb4b7ba, metalness: 0.9, roughness: 0.32 });
      m.map = this.t(() => this.tex.metalTexture({ brushed: true }));
      m.envMapIntensity = 1.2;
      return m;
    });
  }

  /** Hollow metal door frames (painted). */
  frame(): THREE.MeshStandardMaterial {
    return this.get('frame', () => new THREE.MeshStandardMaterial({ color: 0x5e5c57, roughness: 0.5, metalness: 0.35 }));
  }

  /** Painted archway trim / soffits. */
  trim(): THREE.MeshStandardMaterial {
    return this.get('trim', () => new THREE.MeshStandardMaterial({ color: 0x8d8a82, roughness: 0.7, metalness: 0 }));
  }

  darkMetal(): THREE.MeshStandardMaterial {
    return this.get('darkmetal', () => new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.55, metalness: 0.6 }));
  }

  laminate(): THREE.MeshStandardMaterial {
    return this.get('laminate', () => new THREE.MeshStandardMaterial({ color: 0x4d5156, roughness: 0.5, metalness: 0.08 }));
  }

  plastic(color = 0xe8e6e0): THREE.MeshStandardMaterial {
    return this.get(`plastic:${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0 }));
  }

  plain(color: number, roughness = 0.8, metalness = 0): THREE.MeshStandardMaterial {
    return this.get(`plain:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }

  // ---------------------------------------------------------------------------
  // Doors & signage
  // ---------------------------------------------------------------------------

  doorFace(kind: DoorFaceKind, label?: string, window?: boolean, seed = 0): THREE.MeshStandardMaterial {
    return this.get(`door:${kind}:${label ?? ''}:${window ? 1 : 0}:${seed}`, () => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: kind === 'wood' ? 0.55 : kind === 'steel' ? 0.42 : 0.4,
        metalness: kind === 'wood' ? 0 : 0.45,
      });
      m.map = this.t(() => this.tex.doorTexture({ kind, label, window, seed }));
      if (!m.map) m.color.set(kind === 'wood' ? 0x7a6650 : 0x8c8f93);
      return m;
    });
  }

  doorEdge(kind: DoorFaceKind): THREE.MeshStandardMaterial {
    return this.get(`dooredge:${kind}`, () =>
      new THREE.MeshStandardMaterial({
        color: kind === 'wood' ? 0x6b5a48 : 0x85888c,
        roughness: kind === 'wood' ? 0.6 : 0.4,
        metalness: kind === 'wood' ? 0 : 0.5,
      }),
    );
  }

  sign(text: string, kind: SignKind, wpx: number, hpx: number): THREE.MeshStandardMaterial {
    return this.get(`sign:${kind}:${wpx}x${hpx}:${text}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.1 });
      const map = this.t(() => this.tex.signTexture(text, { kind, width: wpx, height: hpx }));
      if (map) {
        m.map = map;
        // a hint of self-illumination keeps signage legible in the generator dark
        m.emissiveMap = map;
        m.emissive.set(0x262626);
      } else {
        m.color.set(kind === 'warning' ? 0xc9a62a : kind === 'big_red' ? 0xa02020 : 0x2b2e33);
      }
      return m;
    });
  }

  /** Non-cached emissive (toggled per lamp). */
  makeEmissive(color: number, intensity: number, base = 0x151515): THREE.MeshStandardMaterial {
    return this.own(new THREE.MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.5, metalness: 0 }));
  }

  // ---------------------------------------------------------------------------
  // Exterior
  // ---------------------------------------------------------------------------

  facadePanel(): THREE.MeshStandardMaterial {
    return this.get('facade:panel', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0x4a4542, roughness: 0.92, metalness: 0 });
      m.map = this.t(() => this.tex.blockWallTexture({ tint: 0x3a3634, seed: 21 }));
      m.shadowSide = THREE.DoubleSide;
      if (!m.map) m.color.set(0x2a2725);
      return m;
    });
  }

  facadeBand(): THREE.MeshStandardMaterial {
    return this.get('facade:band', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0x6a6a66, roughness: 0.9, metalness: 0 });
      m.map = this.t(() => this.tex.concreteTexture({ stains: 0.6, seed: 23 }));
      return m;
    });
  }

  sidewalk(): THREE.MeshStandardMaterial {
    return this.get('sidewalk', () => {
      const m = new THREE.MeshStandardMaterial({ color: 0x8e8e8a, roughness: 0.55, metalness: 0 });
      m.map = this.t(() => this.tex.concreteTexture({ stains: 0.55, seed: 3 }));
      m.envMapIntensity = 1.2;
      if (!m.map) m.color.set(0x55555a);
      return m;
    });
  }

  darkWindow(): THREE.MeshStandardMaterial {
    return this.get('darkwindow', () => new THREE.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.18, metalness: 0.4, envMapIntensity: 1.5 }));
  }

  buildingDark(): THREE.MeshStandardMaterial {
    return this.get('building', () => new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.95, metalness: 0 }));
  }

  windowGlow(variant: 'warm' | 'cool' | 'tv'): THREE.MeshBasicMaterial {
    const color = variant === 'warm' ? 0xffc27a : variant === 'cool' ? 0x9fb8e6 : 0x7fd0ff;
    return this.get(`winglow:${variant}`, () => new THREE.MeshBasicMaterial({ color, fog: true }));
  }

  lotPaint(color: number): THREE.MeshStandardMaterial {
    return this.get(`lotpaint:${color}`, () =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
  }

  /** Floor lettering laid on the asphalt (faded). */
  floorSign(text: string): THREE.MeshStandardMaterial {
    return this.get(`floorsign:${text}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const map = this.t(() => this.tex.signTexture(text, { kind: 'warning', width: 1024, height: 192 }));
      if (map) m.map = map;
      else m.color.set(0x8a7a30);
      return m;
    });
  }

  fenceLine(): THREE.LineBasicMaterial {
    return this.get('fence', () => new THREE.LineBasicMaterial({ color: 0x1e2126, transparent: true, opacity: 0.9, fog: true }));
  }

  sky(): THREE.MeshBasicMaterial {
    return this.get('sky', () => {
      const m = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false, color: 0xffffff });
      m.map = this.t(() => this.tex.skyTexture());
      if (!m.map) m.color.set(0x070a10);
      return m;
    });
  }

  /** Per-room haze sheet (opacity is driven by setRoomHaze). */
  makeHaze(): THREE.MeshBasicMaterial {
    return this.own(new THREE.MeshBasicMaterial({ color: 0x6f777c, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true }));
  }

  disposeAll(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
    for (const m of this.owned) m.dispose();
    this.owned.clear();
  }
}
