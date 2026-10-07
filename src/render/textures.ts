/**
 * Procedural texture factory (CONTRACT §4A). Every function returns a cached
 * THREE.CanvasTexture (sRGB, RepeatWrapping, anisotropy 4) generated deterministically
 * from its arguments — no imported images, no Math.random. Drawing lives in the
 * textures.*.ts helpers; this file owns defaults, caching and three.js wrapping.
 *
 * Scale: TEXTURE_METRES gives the metres covered by one repeat of each tileable
 * texture so WorldBuilder can set `texture.repeat` (e.g. floor 6 m wide on vinyl →
 * repeat.x = 6 / TEXTURE_METRES.vinyl). Wall textures cover 0..2.8 m vertically in
 * one repeat (canvas bottom = floor), so repeat.y = 1 and repeat.x = length / 2.8.
 */
import * as THREE from 'three';
import { hashString } from '../core/rng';
import { type SignKind, buildPoster, buildSign } from './textures.signs';
import { type ScreenOpts, buildScreen } from './textures.screens';
import {
  type DecalKindTex,
  type DoorKindTex,
  WALL_H,
  buildAsphalt,
  buildBlockWall,
  buildCarpet,
  buildCeiling,
  buildCeramic,
  buildConcrete,
  buildCurtain,
  buildDecal,
  buildDoor,
  buildFabric,
  buildFluorescent,
  buildMetal,
  buildPaintedWall,
  buildSky,
  buildTileWall,
  buildVinyl,
} from './textures.surfaces';
import { fbm, hash2, stableKey, textRows } from './textures.util';

export { textRows };
export type { SignKind, ScreenOpts, DecalKindTex, DoorKindTex };

/** Metres covered by one repeat of each tileable texture. */
export const TEXTURE_METRES = {
  vinyl: 1.2,
  ceramic: 1.0,
  concrete: 2.0,
  asphalt: 3.0,
  carpet: 1.0,
  /** painted / tile / block walls: one repeat = 2.8 m × 2.8 m (v: floor → ceiling) */
  wall: WALL_H,
  ceiling: 2.4,
  metal: 1.0,
  /** curtain: 1 m of width per repeat; stretch vertically to the drop */
  curtain: 1.0,
  fabric: 0.5,
} as const;

/** Exact metres per repeat of vinylFloorTexture for a given tile size (the repeat holds a whole number of tiles). */
export function vinylRepeatMetres(tile = 0.3): number {
  const per = Math.max(1, Math.min(12, Math.round(1.2 / Math.max(0.1, tile))));
  return per * Math.max(0.1, tile);
}

// ---------------------------------------------------------------------------
// Cache + wrapping
// ---------------------------------------------------------------------------

type AnyTex = THREE.CanvasTexture | THREE.DataTexture;

const cache = new Map<string, AnyTex>();
/** screen refreshes churn keys (time strings); keep only the most recent few dozen */
const screenKeys: string[] = [];
const SCREEN_CACHE_MAX = 48;

function wrap(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function cached(key: string, build: () => HTMLCanvasElement): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit as THREE.CanvasTexture;
  const tex = wrap(build());
  cache.set(key, tex);
  return tex;
}

/** Merge defaults with caller options, ignoring explicit `undefined`. */
function withDefaults<T extends object>(defaults: T, opts?: Partial<T>): T {
  const out = { ...defaults };
  if (opts) {
    for (const k of Object.keys(opts) as (keyof T)[]) {
      const v = opts[k];
      if (v !== undefined) (out as Record<keyof T, unknown>)[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

export function vinylFloorTexture(opts?: { tint?: number; tile?: number; wear?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0x9a978f, tile: 0.3, wear: 0.5, seed: 1 }, opts);
  return cached(stableKey('vinyl', o), () => buildVinyl(o));
}

export function ceramicTileTexture(opts?: { tint?: number; grout?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0xd8d6cc, grout: 0.07, seed: 1 }, opts);
  return cached(stableKey('ceramic', o), () => buildCeramic(o));
}

export function concreteTexture(opts?: { tint?: number; stains?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0x8a8a84, stains: 0.5, seed: 1 }, opts);
  return cached(stableKey('concrete', o), () => buildConcrete(o));
}

export function asphaltTexture(opts?: { wet?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ wet: 0.7, seed: 1 }, opts);
  return cached(stableKey('asphalt', o), () => buildAsphalt(o));
}

export function carpetTexture(opts?: { tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0x4f545c, seed: 1 }, opts);
  return cached(stableKey('carpet', o), () => buildCarpet(o));
}

// ---------------------------------------------------------------------------
// Walls & ceiling
// ---------------------------------------------------------------------------

export function paintedWallTexture(opts?: { tint?: number; railHeight?: number; grime?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0xc7c2b6, railHeight: 0.9, grime: 0.5, seed: 1 }, opts);
  return cached(stableKey('wall', o), () => buildPaintedWall(o));
}

export function tileWallTexture(opts?: { tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0xd8d6cc, seed: 1 }, opts);
  return cached(stableKey('tilewall', o), () => buildTileWall(o));
}

export function blockWallTexture(opts?: { tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0x9c9a92, seed: 1 }, opts);
  return cached(stableKey('block', o), () => buildBlockWall(o));
}

export function ceilingPanelTexture(opts?: { stains?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ stains: 0.5, seed: 1 }, opts);
  return cached(stableKey('ceiling', o), () => buildCeiling(o));
}

/** 512 × 256 emissive map for a 1.2 × 0.6 m troffer. */
export function fluorescentPanelTexture(opts?: { on?: boolean; warm?: number }): THREE.CanvasTexture {
  const o = withDefaults({ on: true, warm: 0 }, opts);
  return cached(stableKey('fluorescent', o), () => buildFluorescent(o));
}

export function metalTexture(opts?: { brushed?: boolean; tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ brushed: true, tint: 0xb8bcc0, seed: 1 }, opts);
  return cached(stableKey('metal', o), () => buildMetal(o));
}

// ---------------------------------------------------------------------------
// Doors, signs, posters, screens
// ---------------------------------------------------------------------------

/** 512 × 1024 door face (1.0 × 2.0 m): hinge side at u = 0, lever at u ≈ 0.86. `glass_frame` needs a transparent material. */
export function doorTexture(opts?: { kind: DoorKindTex; label?: string; window?: boolean; seed?: number }): THREE.CanvasTexture {
  const o = { kind: opts?.kind ?? 'steel', label: opts?.label, window: opts?.window ?? false, seed: opts?.seed ?? 1 };
  return cached(stableKey('door', o), () => buildDoor(o));
}

/** Sized to the kind's aspect (see textures.signs.ts); `width`/`height` ≤ 8 are metres, otherwise pixels. */
export function signTexture(text: string, opts?: { kind?: SignKind; width?: number; height?: number }): THREE.CanvasTexture {
  const kind: SignKind = opts?.kind ?? 'dept';
  const o = { text, kind, width: opts?.width, height: opts?.height };
  return cached(stableKey('sign', o), () => buildSign(text, kind, opts?.width, opts?.height));
}

/** Posters are 512 × 768 (2:3); boards (schedule, notices, assignments, evs_schedule) are 1024 × 512. */
export function posterTexture(kind: string, seed = 1): THREE.CanvasTexture {
  return cached(stableKey('poster', { kind, seed }), () => buildPoster(kind, seed));
}

/** 512 × 384 (news_muted: 512 × 288). Call again with a new `time`/`lines` to refresh; old variants are evicted. */
export function screenTexture(kind: string, opts?: ScreenOpts): THREE.CanvasTexture {
  const o: ScreenOpts = { time: opts?.time, lines: opts?.lines, alarm: opts?.alarm ?? false, dead: opts?.dead ?? false, glitch: opts?.glitch ?? 0 };
  const key = stableKey('screen', { kind, ...o });
  const hit = cache.get(key);
  if (hit) return hit as THREE.CanvasTexture;
  const tex = wrap(buildScreen(kind, o));
  cache.set(key, tex);
  screenKeys.push(key);
  while (screenKeys.length > SCREEN_CACHE_MAX) {
    const old = screenKeys.shift();
    if (!old) break;
    const t = cache.get(old);
    cache.delete(old);
    t?.dispose();
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Soft goods, decals, sky, noise
// ---------------------------------------------------------------------------

export function curtainTexture(opts?: { tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0xa9c4c8, seed: 1 }, opts);
  return cached(stableKey('curtain', o), () => buildCurtain(o));
}

export function fabricTexture(opts?: { tint?: number; seed?: number }): THREE.CanvasTexture {
  const o = withDefaults({ tint: 0x4a5b6a, seed: 1 }, opts);
  return cached(stableKey('fabric', o), () => buildFabric(o));
}

/**
 * RGBA DataTexture for shaders: R/G/B independent white noise, A = smooth tileable fbm
 * (for warps). Linear colour space on purpose — a LUT must not be sRGB-decoded.
 */
export function noiseTexture(size = 256, seed = 1): THREE.DataTexture {
  const s = Math.max(4, Math.min(1024, Math.round(size)));
  const key = stableKey('noise', { size: s, seed });
  const hit = cache.get(key);
  if (hit) return hit as THREE.DataTexture;
  const sn = hashString(`noise:${seed}`) | 0;
  const data = new Uint8Array(s * s * 4);
  let i = 0;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      data[i++] = hash2(x, y, sn) * 255;
      data[i++] = hash2(x, y, sn + 1) * 255;
      data[i++] = hash2(x, y, sn + 2) * 255;
      data[i++] = fbm(x / s, y / s, 8, 8, 4, sn + 3) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, s, s, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * Alpha decals (transparent background). footprint 256², puddle 512², scuff 256², drag 256 × 512
 * (strong end at v = 0 fading toward v = 1), oil 512². Toe / travel direction points toward +v.
 */
export function decalTexture(kind: DecalKindTex): THREE.CanvasTexture {
  return cached(stableKey('decal', { kind }), () => buildDecal(kind));
}

/** 1024 × 512 equirectangular night sky (zenith at v = 1) with cloud noise and city glow; `dawn` 0..1 lerps to cold morning. */
export function skyTexture(opts?: { dawn?: number }): THREE.CanvasTexture {
  const dawn = Math.round(Math.max(0, Math.min(1, opts?.dawn ?? 0)) * 20) / 20;
  return cached(stableKey('sky', { dawn }), () => buildSky({ dawn }));
}

export function disposeAllTextures(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
  screenKeys.length = 0;
}
