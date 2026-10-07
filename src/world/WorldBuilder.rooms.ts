/**
 * Room shells: floor, ceiling, four inward-facing single-sided walls split around door and
 * window openings, baseboards, glass curtain walls with aluminium mullions, the elevator cab
 * interior and interior window strips. Everything static is merged per material per room.
 */
import * as THREE from 'three';
import type { HospitalLayout, RoomDef, RoomId, Side } from '../core/types';
import { WALL } from './layout';
import { GeoBatch, box, hQuad, splitWall, tube, wallQuad, quad, type Hole } from './WorldBuilder.geom';
import { doorHeight } from './WorldBuilder.doors';
import { UVS, type MaterialKit } from './WorldBuilder.materials';

export interface Opening {
  kind: 'door' | 'window';
  id: string;
  /** axis the WALL runs along */
  axis: 'x' | 'z';
  /** gap-centre coordinate across the wall (z for axis x, x for axis z) */
  k: number;
  /** span along the wall axis */
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  rooms: [RoomId, RoomId];
}

/** Interior glass sides become a window strip (solid wall below/above) rather than a curtain wall. */
export const WINDOW_STRIPS: Partial<Record<RoomId, { side: Side; u0: number; u1: number; y0: number; y1: number }>> = {
  imaging: { side: 's', u0: 9.5, u1: 12.5, y0: 1.0, y1: 2.2 },
};

export const DEFAULT_FLOOR_TINT: Record<RoomDef['floor'], number> = {
  vinyl: 0x9a978f,
  tile: 0xe0dedb,
  concrete: 0x8c8c88,
  carpet: 0x6e6a5e,
  asphalt: 0xffffff,
};

/** The one floor material a room uses (shared with door thresholds so archway strips match). */
export function roomFloorMaterial(room: RoomDef, kit: MaterialKit): THREE.MeshStandardMaterial {
  const wear = room.id === 'corridor' || room.id === 'waiting' ? 0.75 : 0.5;
  return kit.floor(room.floor, room.floorColor ?? DEFAULT_FLOOR_TINT[room.floor], wear);
}

export function planeCoord(room: RoomDef, side: Side): number {
  const b = room.bounds;
  return side === 'n' ? b.z1 : side === 's' ? b.z0 : side === 'e' ? b.x1 : b.x0;
}

export function gapCentre(room: RoomDef, side: Side): number {
  const k = planeCoord(room, side);
  return side === 'n' || side === 'e' ? k + WALL / 2 : k - WALL / 2;
}

export function sideSpan(room: RoomDef, side: Side): [number, number] {
  const b = room.bounds;
  return side === 'n' || side === 's' ? [b.x0, b.x1] : [b.z0, b.z1];
}

export function sideAxis(side: Side): 'x' | 'z' {
  return side === 'n' || side === 's' ? 'x' : 'z';
}

/** The room across the wall gap from `side`, if any. */
export function neighbourAcross(room: RoomDef, side: Side, rooms: RoomDef[]): RoomDef | null {
  const b = room.bounds;
  for (const r of rooms) {
    if (r.id === room.id) continue;
    const o = r.bounds;
    const overlapX = Math.min(b.x1, o.x1) - Math.max(b.x0, o.x0) > 0.05;
    const overlapZ = Math.min(b.z1, o.z1) - Math.max(b.z0, o.z0) > 0.05;
    if (side === 'n' && Math.abs(o.z0 - (b.z1 + WALL)) < 0.02 && overlapX) return r;
    if (side === 's' && Math.abs(o.z1 - (b.z0 - WALL)) < 0.02 && overlapX) return r;
    if (side === 'e' && Math.abs(o.x0 - (b.x1 + WALL)) < 0.02 && overlapZ) return r;
    if (side === 'w' && Math.abs(o.x1 - (b.x0 - WALL)) < 0.02 && overlapZ) return r;
  }
  return null;
}

/** All openings (doors + window strips) in gap space. */
export function computeOpenings(layout: HospitalLayout): Opening[] {
  const byId = new Map(layout.rooms.map((r) => [r.id, r]));
  const out: Opening[] = [];
  for (const d of layout.doors) {
    const a = byId.get(d.a);
    const b = byId.get(d.b);
    if (!a || !b) continue;
    const minCeil = Math.min(a.ceiling, b.ceiling);
    const h = doorHeight(d, minCeil);
    const c = d.axis === 'x' ? d.pos.x : d.pos.z;
    out.push({
      kind: 'door',
      id: d.id,
      axis: d.axis,
      k: d.axis === 'x' ? d.pos.z : d.pos.x,
      u0: c - d.width / 2,
      u1: c + d.width / 2,
      y0: 0,
      y1: h,
      rooms: [d.a, d.b],
    });
  }
  for (const room of layout.rooms) {
    const strip = WINDOW_STRIPS[room.id];
    if (!strip) continue;
    const other = neighbourAcross(room, strip.side, layout.rooms);
    if (!other) continue;
    out.push({
      kind: 'window',
      id: `win_${room.id}`,
      axis: sideAxis(strip.side),
      k: gapCentre(room, strip.side),
      u0: strip.u0,
      u1: strip.u1,
      y0: strip.y0,
      y1: strip.y1,
      rooms: [other.id, room.id],
    });
  }
  return out;
}

/** Openings that cut this room side, clipped to the side span. */
export function holesForSide(room: RoomDef, side: Side, openings: Opening[]): Hole[] {
  const k = gapCentre(room, side);
  const axis = sideAxis(side);
  const [u0, u1] = sideSpan(room, side);
  const holes: Hole[] = [];
  for (const o of openings) {
    if (o.axis !== axis) continue;
    if (Math.abs(o.k - k) > 0.11) continue;
    if (!o.rooms.includes(room.id)) continue;
    const a = Math.max(u0, o.u0);
    const b = Math.min(u1, o.u1);
    if (b - a < 1e-3) continue;
    holes.push({ u0: a, u1: b, y0: o.y0, y1: o.y1 });
  }
  return holes;
}

/** Box filling the wall gap along a side between u0..u1 (plus an inward lip). */
function gapBox(side: Side, plane: number, u0: number, u1: number, y0: number, y1: number, inward: number, outward = WALL): THREE.BufferGeometry {
  switch (side) {
    case 'w':
      return box(plane - outward, plane + inward, y0, y1, u0, u1);
    case 'e':
      return box(plane - inward, plane + outward, y0, y1, u0, u1);
    case 'n':
      return box(u0, u1, y0, y1, plane - inward, plane + outward);
    case 's':
    default:
      return box(u0, u1, y0, y1, plane - outward, plane + inward);
  }
}

export interface ShellContext {
  kit: MaterialKit;
  openings: Opening[];
  rooms: RoomDef[];
  group: THREE.Group;
}

export interface ShellResult {
  /** emissive material of the elevator cab ceiling light (toggled by setElevator) */
  cabLight?: THREE.MeshStandardMaterial;
}

export function buildRoomShell(room: RoomDef, ctx: ShellContext): ShellResult {
  if (room.id === 'elevator') return buildCab(room, ctx);
  const { kit, group } = ctx;
  const b = room.bounds;
  const batch = new GeoBatch();
  const mats = new Map<string, THREE.Material>();
  const use = (key: string, m: THREE.Material): string => {
    mats.set(key, m);
    return key;
  };

  // floor
  const floorScale = UVS[room.floor];
  const floorKey = use('floor', roomFloorMaterial(room, kit));
  batch.add(floorKey, hQuad(b.x0, b.x1, b.z0, b.z1, 0, true, floorScale, floorScale));

  // ceiling: panel grid for clinical/public rooms, bare slab for service areas
  if (!room.noCeiling) {
    const slab = room.wall === 'block' || room.wall === 'concrete';
    const ceilKey = use('ceiling', slab ? kit.slab() : kit.ceilingPanels());
    const s = slab ? UVS.slab : UVS.panels;
    batch.add(ceilKey, hQuad(b.x0, b.x1, b.z0, b.z1, room.ceiling, false, s, s));
  }

  // walls
  const baseKey = use('baseboard', kit.baseboard());
  const aluKey = use('alu', kit.alu());
  const glassKey = use('glass', kit.glass());
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const kind = room.sides?.[side]?.kind ?? room.wall;
    const plane = planeCoord(room, side);
    const [u0, u1] = sideSpan(room, side);
    const holes = holesForSide(room, side, ctx.openings);
    const across = neighbourAcross(room, side, ctx.rooms);

    if (kind === 'glass' && across?.outdoor) {
      buildCurtainWall(side, plane, u0, u1, room.ceiling, holes, batch, glassKey, aluKey);
      continue;
    }

    const wallKind = kind === 'glass' ? room.wall : kind;
    const wallKey = use(`wall:${wallKind}`, kit.wall(wallKind, room.wallColor ?? 0xbdbab0, room.ceiling));
    const su = wallKind === 'painted' ? UVS.painted : wallKind === 'tile' ? UVS.tileWall : wallKind === 'block' ? UVS.block : UVS.concrete;
    const sv = wallKind === 'painted' ? room.ceiling : su;
    const rects = splitWall(u0, u1, room.ceiling, holes);
    for (const r of rects) {
      batch.add(wallKey, wallQuad(side, r.u0, r.u1, r.y0, r.y1, plane, su, sv));
      if (r.y0 === 0 && r.u1 - r.u0 > 0.03) {
        batch.add(baseKey, gapBox(side, plane, r.u0, r.u1, 0, 0.1, 0.012, -0.001));
      }
    }
  }

  batch.flush(group, (key) => mats.get(key)!, { receiveShadow: true, castShadow: false, room: room.id, namePrefix: `${room.id}:` });
  return {};
}

/**
 * Floor-to-ceiling glazing facing the exterior: glass panes split around door openings,
 * aluminium mullions on a ~1.5 m module, sill, head and a transom at door-head height.
 */
function buildCurtainWall(side: Side, plane: number, u0: number, u1: number, H: number, holes: Hole[], batch: GeoBatch, glassKey: string, aluKey: string): void {
  const rects = splitWall(u0, u1, H, holes);
  const sillH = 0.12;
  const mull = 0.06;
  const inward = 0.03;
  for (const r of rects) {
    const y0 = Math.max(r.y0, sillH);
    if (r.y1 - y0 > 0.02) batch.add(glassKey, wallQuad(side, r.u0, r.u1, y0, r.y1, plane, 1, 1));
    // vertical mullions on panel boundaries
    const len = r.u1 - r.u0;
    const panels = Math.max(1, Math.round(len / 1.5));
    const bounds: number[] = [];
    for (let i = 0; i <= panels; i++) bounds.push(r.u0 + (len * i) / panels);
    for (const u of bounds) {
      batch.add(aluKey, gapBox(side, plane, u - mull / 2, u + mull / 2, r.y0, r.y1, inward));
    }
    if (r.y0 === 0) {
      batch.add(aluKey, gapBox(side, plane, r.u0, r.u1, 0, sillH, inward));
      if (H > 2.5) batch.add(aluKey, gapBox(side, plane, r.u0, r.u1, 2.3 - mull / 2, 2.3 + mull / 2, inward));
    } else {
      // transom glass above a door: bottom rail
      batch.add(aluKey, gapBox(side, plane, r.u0, r.u1, r.y0, r.y0 + mull, inward));
    }
    batch.add(aluKey, gapBox(side, plane, r.u0, r.u1, H - 0.08, H, inward));
  }
}

/** Elevator cab: steel lower panels, laminate uppers, handrail, dark ceiling with a can light. */
function buildCab(room: RoomDef, ctx: ShellContext): ShellResult {
  const { kit, group } = ctx;
  const b = room.bounds;
  const H = room.ceiling;
  const batch = new GeoBatch();
  const mats = new Map<string, THREE.Material>();
  const use = (key: string, m: THREE.Material): string => {
    mats.set(key, m);
    return key;
  };
  const floorKey = use('floor', kit.floor('vinyl', 0x4d5054, 0.8));
  batch.add(floorKey, hQuad(b.x0, b.x1, b.z0, b.z1, 0, true, UVS.vinyl, UVS.vinyl));
  const ceilKey = use('ceiling', kit.plain(0x2b2d30, 0.6, 0.2));
  batch.add(ceilKey, hQuad(b.x0, b.x1, b.z0, b.z1, H, false, 1, 1));
  const steelKey = use('steel', kit.steel());
  const lamKey = use('laminate', kit.laminate());
  const split = 1.0;
  for (const side of ['n', 's', 'e', 'w'] as const) {
    const plane = planeCoord(room, side);
    const [u0, u1] = sideSpan(room, side);
    const holes = holesForSide(room, side, ctx.openings);
    const rects = splitWall(u0, u1, H, holes);
    for (const r of rects) {
      const yA = Math.min(r.y1, split);
      if (yA - r.y0 > 1e-3) batch.add(steelKey, wallQuad(side, r.u0, r.u1, r.y0, yA, plane, UVS.metal, UVS.metal));
      const yB = Math.max(r.y0, split);
      if (r.y1 - yB > 1e-3) batch.add(lamKey, wallQuad(side, r.u0, r.u1, yB, r.y1, plane, 1, 1));
      // steel base
      if (r.y0 === 0) batch.add(steelKey, gapBox(side, plane, r.u0, r.u1, 0, 0.1, 0.01, -0.001));
      // handrail on walls without the door
      if (side !== 's' && r.y0 === 0 && r.u1 - r.u0 > 0.5) {
        const off = 0.06;
        const y = 0.9;
        if (side === 'n') batch.add(steelKey, tube(r.u0 + 0.08, y, plane - off, r.u1 - 0.08, y, plane - off, 0.018));
        else if (side === 'e') batch.add(steelKey, tube(plane - off, y, r.u0 + 0.08, plane - off, y, r.u1 - 0.08, 0.018));
        else if (side === 'w') batch.add(steelKey, tube(plane + off, y, r.u0 + 0.08, plane + off, y, r.u1 - 0.08, 0.018));
      }
    }
  }
  batch.flush(group, (key) => mats.get(key)!, { receiveShadow: true, castShadow: false, room: room.id, namePrefix: 'elevator:' });

  // ceiling can light (prop-free emissive disc)
  const cabLight = kit.makeEmissive(0xfff1dc, 1.6, 0xdedad0);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const disc = new THREE.CircleGeometry(0.28, 24);
  disc.rotateX(Math.PI / 2);
  disc.translate(cx, H - 0.006, cz);
  const discMesh = new THREE.Mesh(disc, cabLight);
  discMesh.name = 'elevator_cab_light';
  discMesh.userData.room = room.id;
  group.add(discMesh);
  const ring = new THREE.RingGeometry(0.28, 0.33, 24);
  ring.rotateX(Math.PI / 2);
  ring.translate(cx, H - 0.004, cz);
  const ringMesh = new THREE.Mesh(ring, kit.alu());
  ringMesh.userData.room = room.id;
  group.add(ringMesh);
  group.name = 'elevator_cab';
  return { cabLight };
}

/** Interior window strip: pane in the gap centre, aluminium frame, half-lowered blinds on the far side. */
export function buildWindow(o: Opening, batch: GeoBatch, blindsSide: 1 | -1 | 0): void {
  const inward = WALL / 2 + 0.012;
  const fw = 0.04;
  if (o.axis === 'x') {
    batch.add('glass_dirty', quad([o.u0, o.y0, o.k], [o.u1, o.y0, o.k], [o.u1, o.y1, o.k], [o.u0, o.y1, o.k], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]));
    batch.add('alu', box(o.u0 - fw, o.u0, o.y0 - fw, o.y1 + fw, o.k - inward, o.k + inward));
    batch.add('alu', box(o.u1, o.u1 + fw, o.y0 - fw, o.y1 + fw, o.k - inward, o.k + inward));
    batch.add('alu', box(o.u0, o.u1, o.y1, o.y1 + fw, o.k - inward, o.k + inward));
    batch.add('alu', box(o.u0, o.u1, o.y0 - fw, o.y0, o.k - inward, o.k + inward));
    if (blindsSide !== 0) {
      const z = o.k + blindsSide * (WALL / 2 + 0.04);
      const w = o.u1 - o.u0 - 0.1;
      const cx = (o.u0 + o.u1) / 2;
      batch.add('laminate', box(cx - w / 2, cx + w / 2, o.y1 - 0.03, o.y1 + 0.01, z - 0.02, z + 0.02));
      for (let y = o.y1 - 0.06; y > o.y0 + (o.y1 - o.y0) * 0.42; y -= 0.05) {
        const slat = box(-w / 2, w / 2, -0.0015, 0.0015, -0.0125, 0.0125);
        slat.rotateX(0.55);
        slat.translate(cx, y, z);
        batch.add('laminate', slat);
      }
    }
  } else {
    batch.add('glass_dirty', quad([o.k, o.y0, o.u0], [o.k, o.y0, o.u1], [o.k, o.y1, o.u1], [o.k, o.y1, o.u0], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]));
    batch.add('alu', box(o.k - inward, o.k + inward, o.y0 - fw, o.y1 + fw, o.u0 - fw, o.u0));
    batch.add('alu', box(o.k - inward, o.k + inward, o.y0 - fw, o.y1 + fw, o.u1, o.u1 + fw));
    batch.add('alu', box(o.k - inward, o.k + inward, o.y1, o.y1 + fw, o.u0, o.u1));
    batch.add('alu', box(o.k - inward, o.k + inward, o.y0 - fw, o.y0, o.u0, o.u1));
  }
}
