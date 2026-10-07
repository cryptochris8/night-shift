/**
 * Figure outfits: material palette, body proportions and the detail list per outfit.
 * Materials are shared between figures through a small cache (same spec → same material);
 * a Figure clones its set only when it needs per-instance state (opacity, phone glow).
 */
import * as THREE from 'three';
import type { Outfit } from '../core/contracts';
import type { RNG } from '../core/rng';

export interface MatSpec {
  color: number;
  roughness: number;
  metalness?: number;
  emissive?: number;
  emissiveIntensity?: number;
  /** 0 = no environment reflections (matte) */
  envMapIntensity?: number;
  doubleSide?: boolean;
}

/** Body material slots. 'hair' is picked per seed, everything else comes from the outfit palette. */
export type BodyRole =
  | 'skin' | 'top' | 'sleeve' | 'forearm' | 'trousers' | 'shin' | 'shoe' | 'sole'
  | 'collar' | 'accent' | 'lanyard' | 'badge' | 'belt' | 'metal' | 'radio' | 'stripe' | 'coat';
export type PropRole = 'phoneBody' | 'phoneScreen' | 'mopHandle' | 'mopHead' | 'mopStrings';
export type MatRole = BodyRole | 'hair' | PropRole;

export type Detail =
  | 'vneck_skin' | 'vneck_collar' | 'collar_ring' | 'lanyard' | 'pocket_l' | 'pocket_r' | 'pockets_coat'
  | 'belt' | 'utility' | 'keyring' | 'radio' | 'epaulettes' | 'stripes' | 'coat_skirt' | 'button_band'
  | 'hood' | 'gown_tie';

export interface OutfitSpec {
  /** standing height in metres (before the per-instance scale) */
  height: number;
  armFactor: number;
  headFactor: number;
  neckFactor: number;
  legFactor: number;
  hair: boolean;
  sleeves: 'short' | 'long';
  /** small per-seed height variation (adults in ordinary clothes only) */
  jitterHeight: boolean;
  mats: Record<BodyRole, MatSpec>;
  details: Detail[];
}

const SKIN: MatSpec = { color: 0x9d7b66, roughness: 0.9, envMapIntensity: 0.45 };
const DARK: MatSpec = { color: 0x0b0b0d, roughness: 1, metalness: 0, envMapIntensity: 0 };

const COMMON = {
  lanyard: { color: 0x1d2a44, roughness: 0.9 } as MatSpec,
  badge: { color: 0xe8e8e2, roughness: 0.45 } as MatSpec,
  belt: { color: 0x171719, roughness: 0.75, doubleSide: true } as MatSpec,
  metal: { color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 } as MatSpec,
  radio: { color: 0x111214, roughness: 0.5, metalness: 0.1 } as MatSpec,
  stripe: { color: 0xb4b8bc, roughness: 0.5, emissive: 0x303030, emissiveIntensity: 1, doubleSide: true } as MatSpec,
};

const cloth = (color: number, roughness = 0.88): MatSpec => ({ color, roughness });

interface PaletteInput {
  top: MatSpec;
  forearm: MatSpec;
  trousers: MatSpec;
  shin: MatSpec;
  shoe: MatSpec;
  sole: MatSpec;
  collar: MatSpec;
  accent: MatSpec;
  coat?: MatSpec;
  skin?: MatSpec;
  sleeve?: MatSpec;
}

function palette(p: PaletteInput): Record<BodyRole, MatSpec> {
  return {
    skin: p.skin ?? SKIN,
    top: p.top,
    sleeve: p.sleeve ?? p.top,
    forearm: p.forearm,
    trousers: p.trousers,
    shin: p.shin,
    shoe: p.shoe,
    sole: p.sole,
    collar: p.collar,
    accent: p.accent,
    coat: p.coat ?? p.top,
    ...COMMON,
  };
}

const adult = (over: Partial<OutfitSpec>): OutfitSpec => ({
  height: 1.72,
  armFactor: 1,
  headFactor: 1,
  neckFactor: 1,
  legFactor: 1,
  hair: true,
  sleeves: 'long',
  jitterHeight: true,
  mats: palette({
    top: cloth(0x555555), forearm: cloth(0x555555), trousers: cloth(0x333333), shin: cloth(0x333333),
    shoe: cloth(0x111111), sole: cloth(0x0a0a0a), collar: cloth(0x666666), accent: cloth(0x4a4a4a),
  }),
  details: [],
  ...over,
});

export const OUTFITS: Record<Outfit, OutfitSpec> = {
  scrubs: adult({
    sleeves: 'short',
    mats: palette({
      top: cloth(0x3f7f86), forearm: SKIN, trousers: cloth(0x3a757c), shin: cloth(0x3a757c),
      shoe: { color: 0xd8d8d2, roughness: 0.55 }, sole: { color: 0x9a9a94, roughness: 0.7 },
      collar: cloth(0x346a70), accent: cloth(0x386f76),
    }),
    details: ['vneck_skin', 'pocket_l', 'lanyard'],
  }),
  patient: adult({
    sleeves: 'short',
    mats: palette({
      top: cloth(0xbfd2d6, 0.93), forearm: SKIN, trousers: cloth(0xbfd2d6, 0.93), shin: SKIN,
      shoe: { color: 0x8e8a80, roughness: 0.95 }, sole: { color: 0x7a766e, roughness: 0.95 },
      collar: cloth(0xa9bfc4, 0.93), accent: cloth(0xa9bfc4, 0.93),
    }),
    details: ['collar_ring', 'gown_tie'],
  }),
  workwear: adult({
    mats: palette({
      top: cloth(0x6f7275), forearm: cloth(0x6f7275), trousers: cloth(0x2d3a5c, 0.9), shin: cloth(0x2d3a5c, 0.9),
      shoe: { color: 0x2a2420, roughness: 0.65 }, sole: { color: 0x1a1715, roughness: 0.8 },
      collar: cloth(0x7b7e81), accent: cloth(0x64676a),
    }),
    details: ['collar_ring', 'pocket_l', 'pocket_r', 'belt', 'utility', 'keyring'],
  }),
  security: adult({
    mats: palette({
      top: cloth(0x15171c, 0.8), forearm: cloth(0x15171c, 0.8), trousers: cloth(0x15171c, 0.9), shin: cloth(0x15171c, 0.9),
      shoe: { color: 0x0e0e10, roughness: 0.45 }, sole: { color: 0x0a0a0b, roughness: 0.7 },
      collar: { color: 0xe6e6e2, roughness: 0.7 }, accent: cloth(0x2a2d33, 0.7),
    }),
    details: ['vneck_collar', 'collar_ring', 'epaulettes', 'radio', 'belt'],
  }),
  clerk: adult({
    mats: palette({
      top: cloth(0x5a1f2a, 0.95), forearm: cloth(0x5a1f2a, 0.95), trousers: cloth(0x3a3a3f, 0.85), shin: cloth(0x3a3a3f, 0.85),
      shoe: { color: 0x3b2a1f, roughness: 0.5 }, sole: { color: 0x241a14, roughness: 0.7 },
      collar: { color: 0xcfcac0, roughness: 0.75 }, accent: cloth(0x6a2a36, 0.95),
    }),
    details: ['collar_ring', 'vneck_collar', 'button_band', 'lanyard'],
  }),
  coat: adult({
    mats: palette({
      top: cloth(0xe9e9e4, 0.8), forearm: cloth(0xe9e9e4, 0.8), trousers: cloth(0x2a2b30, 0.85), shin: cloth(0x2a2b30, 0.85),
      shoe: { color: 0x15151a, roughness: 0.45 }, sole: { color: 0x0d0d10, roughness: 0.7 },
      collar: { color: 0x3a4a5a, roughness: 0.85 }, accent: cloth(0xe2e2dd, 0.8),
      coat: { color: 0xe9e9e4, roughness: 0.8, doubleSide: true },
    }),
    details: ['vneck_collar', 'collar_ring', 'pockets_coat', 'coat_skirt', 'lanyard'],
  }),
  dark: {
    height: 1.9,
    armFactor: 1.12,
    headFactor: 0.92,
    neckFactor: 1.1,
    legFactor: 1,
    hair: false,
    sleeves: 'long',
    jitterHeight: false,
    mats: palette({ top: DARK, forearm: DARK, trousers: DARK, shin: DARK, shoe: DARK, sole: DARK, collar: DARK, accent: DARK, coat: DARK, skin: DARK, sleeve: DARK }),
    details: [],
  },
  child: adult({
    height: 1.1,
    armFactor: 0.95,
    headFactor: 1.3,
    neckFactor: 0.9,
    legFactor: 0.93,
    jitterHeight: false,
    mats: palette({
      top: cloth(0x6b3f3f, 0.95), forearm: cloth(0x6b3f3f, 0.95), trousers: cloth(0x3a4458, 0.9), shin: cloth(0x3a4458, 0.9),
      shoe: { color: 0x8a8580, roughness: 0.6 }, sole: { color: 0xd0d0cc, roughness: 0.7 },
      collar: cloth(0x5e3636, 0.95), accent: cloth(0x5e3636, 0.95),
    }),
    details: ['hood'],
  }),
  paramedic: adult({
    mats: palette({
      top: cloth(0x1f2a44, 0.85), forearm: cloth(0x1f2a44, 0.85), trousers: cloth(0x1f2a44, 0.9), shin: cloth(0x1f2a44, 0.9),
      shoe: { color: 0x111114, roughness: 0.5 }, sole: { color: 0x0b0b0d, roughness: 0.7 },
      collar: cloth(0x2b3a5c, 0.85), accent: cloth(0x1a2238, 0.85),
    }),
    details: ['collar_ring', 'stripes', 'radio', 'belt', 'pocket_l', 'pocket_r'],
  }),
};

export const PROP_MATS: Record<PropRole, MatSpec> = {
  phoneBody: { color: 0x14161a, roughness: 0.4, metalness: 0.2 },
  phoneScreen: { color: 0x05070a, roughness: 0.2, metalness: 0, emissive: 0xbfd6ff, emissiveIntensity: 0 },
  mopHandle: { color: 0x5f6b78, roughness: 0.5, metalness: 0.4 },
  mopHead: { color: 0x3a3f46, roughness: 0.7 },
  mopStrings: { color: 0xb8b4a8, roughness: 1 },
};

const HAIR_COLORS: { item: number; weight: number }[] = [
  { item: 0x1a1512, weight: 4 },
  { item: 0x2b2420, weight: 3 },
  { item: 0x3f2d1f, weight: 3 },
  { item: 0x5a4634, weight: 2 },
  { item: 0x6e6a66, weight: 2 },
  { item: 0x8d8a86, weight: 1 },
];

/** Patients skew older: more grey. */
export function pickHairSpec(rng: RNG, outfit: Outfit): MatSpec {
  const weights = outfit === 'patient'
    ? HAIR_COLORS.map((h) => ({ item: h.item, weight: h.item >= 0x6e6a66 ? h.weight * 3 : h.weight }))
    : HAIR_COLORS;
  return { color: rng.weighted(weights), roughness: 0.95, envMapIntensity: 0.3 };
}

// ---------------------------------------------------------------------------
// Shared material cache
// ---------------------------------------------------------------------------

const cache = new Map<string, THREE.MeshStandardMaterial>();

function specKey(s: MatSpec): string {
  return `${s.color}|${s.roughness}|${s.metalness ?? 0}|${s.emissive ?? 0}|${s.emissiveIntensity ?? 1}|${s.envMapIntensity ?? 1}|${s.doubleSide ? 2 : 1}`;
}

export function makeMaterial(spec: MatSpec): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness ?? 0,
    emissive: spec.emissive ?? 0x000000,
    emissiveIntensity: spec.emissiveIntensity ?? 1,
    side: spec.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
  });
  m.envMapIntensity = spec.envMapIntensity ?? 1;
  return m;
}

export function sharedMaterial(spec: MatSpec): THREE.MeshStandardMaterial {
  const key = specKey(spec);
  let m = cache.get(key);
  if (!m) {
    m = makeMaterial(spec);
    cache.set(key, m);
  }
  return m;
}

/** Release every cached material (only on a full teardown — figures hold references). */
export function disposeSharedFigureMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}

// ---------------------------------------------------------------------------
// Proportions
// ---------------------------------------------------------------------------

export interface Dims {
  height: number;
  hipY: number;
  hipHalf: number;
  thighLen: number;
  shinLen: number;
  footH: number;
  footL: number;
  footW: number;
  thighR0: number;
  thighR1: number;
  shinR0: number;
  shinR1: number;
  pelvisHalfW: number;
  pelvisHalfH: number;
  pelvisHalfD: number;
  spinePivotY: number;
  shoulderY: number;
  shoulderHalf: number;
  /** shoulder joints sit this far below the torso top */
  shoulderDrop: number;
  deltR: number;
  chestR: number;
  chestDepth: number;
  neckLen: number;
  neckR: number;
  headR: number;
  headScaleY: number;
  hairR: number;
  upperArmLen: number;
  forearmLen: number;
  handL: number;
  handW: number;
  handT: number;
  upperR0: number;
  upperR1: number;
  foreR0: number;
  foreR1: number;
}

/** Realistic adult proportions for 1.72 m, scaled to the outfit's height with its deliberate distortions. */
export function computeDims(spec: OutfitSpec, heightMul: number): Dims {
  const height = spec.height * heightMul;
  const s = height / 1.72;
  const legS = s * spec.legFactor;
  const armS = s * spec.armFactor;
  const headS = s * spec.headFactor;
  const hipY = 0.88 * legS;
  const spinePivotY = hipY + 0.06 * s;
  const shoulderY = hipY + 0.52 * s;
  return {
    height,
    hipY,
    hipHalf: 0.09 * s,
    thighLen: 0.4 * legS,
    shinLen: 0.4 * legS,
    footH: 0.08 * legS,
    footL: 0.26 * s,
    footW: 0.1 * s,
    thighR0: 0.085 * s,
    thighR1: 0.062 * s,
    shinR0: 0.06 * s,
    shinR1: 0.042 * s,
    pelvisHalfW: 0.17 * s,
    pelvisHalfH: 0.1 * s,
    pelvisHalfD: 0.11 * s,
    spinePivotY,
    shoulderY,
    shoulderHalf: 0.16 * s,
    shoulderDrop: 0.01 * s,
    deltR: 0.05 * s,
    chestR: 0.15 * s,
    chestDepth: 0.22 * s,
    neckLen: 0.07 * s * spec.neckFactor,
    neckR: 0.055 * s,
    headR: 0.102 * headS,
    headScaleY: 1.1,
    hairR: 0.102 * headS * 1.06,
    upperArmLen: 0.29 * armS,
    forearmLen: 0.26 * armS,
    handL: 0.18 * armS,
    handW: 0.085 * s,
    handT: 0.03 * s,
    upperR0: 0.05 * s,
    upperR1: 0.042 * s,
    foreR0: 0.042 * s,
    foreR1: 0.032 * s,
  };
}
