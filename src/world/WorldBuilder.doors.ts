/**
 * Door rigs: frame/jambs filling the wall gap, animated leaves per DoorKind, label signs and
 * badge-reader LEDs. Built in a local frame where the wall runs along +x, the opening is centred
 * at the origin and room `b` lies toward local +z or −z (`sideB`). Static parts are pushed into a
 * shared GeoBatch in WORLD space so all frames merge into a handful of draw calls.
 */
import * as THREE from 'three';
import type { DoorHandle } from '../core/contracts';
import type { DoorDef, DoorKind, RoomDef } from '../core/types';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WALL, doorPassage } from './layout';
import { GeoBatch, box, ease, hQuad, quad, tube, type UV } from './WorldBuilder.geom';
import { UVS, type MaterialKit, type SignKind } from './WorldBuilder.materials';

const LEAF_T = 0.045;
/** frame face protrusion beyond the wall planes */
const PROTRUDE = 0.012;

/** Static-frame batch keys (resolved to materials by the world builder). */
export const FRAME_KEY = {
  frame: 'frame',
  alu: 'alu',
  steel: 'steel',
  trim: 'trim',
  dark: 'darkmetal',
  plastic: 'plastic',
} as const;

export function doorHeight(def: DoorDef, minCeil: number): number {
  if (def.height) return def.height;
  switch (def.kind) {
    case 'sliding_glass':
      return 2.3;
    case 'open':
      return def.width >= 2.2 ? Math.max(2.2, minCeil - 0.3) : 2.3;
    case 'counter_gate':
      return Math.max(2.2, minCeil - 0.3);
    case 'double':
      return 2.15;
    case 'elevator':
    case 'swing':
    case 'service':
    default:
      return 2.1;
  }
}

const DURATION: Record<DoorKind, [number, number]> = {
  swing: [1.0, 1.2],
  double: [1.1, 1.3],
  service: [1.0, 1.25],
  sliding_glass: [1.6, 1.8],
  elevator: [1.9, 1.9],
  counter_gate: [0.6, 0.7],
  open: [0, 0],
};

export interface DoorRigOptions {
  def: DoorDef;
  roomA: RoomDef;
  roomB: RoomDef;
  /** opening height */
  height: number;
  maxCeil: number;
  kit: MaterialKit;
  /** static frame geometry (world space) */
  frames: GeoBatch;
  /** add our own badge plate + LED (no badge_reader prop serves this door) */
  reader: boolean;
  seed: number;
}

function signSpec(label: string, W: number, exterior: boolean): { w: number; h: number; wpx: number; hpx: number; kind: SignKind } {
  const n = label.length;
  if (n <= 2) return { w: 0.16, h: 0.16, wpx: 256, hpx: 256, kind: 'room_number' };
  const kind: SignKind = /NO ENTRY|DANGER|HIGH VOLTAGE|HEARING|CLOSED/.test(label) ? 'warning' : 'dept';
  const h = exterior ? 0.32 : 0.2;
  const maxW = exterior ? W + 1.2 : W + 0.5;
  const w = Math.min(maxW, Math.max(0.5, n * (exterior ? 0.075 : 0.046) + 0.2));
  const hpx = 128;
  const wpx = Math.min(2048, Math.max(256, Math.round((hpx * (w / h)) / 64) * 64));
  return { w, h, wpx, hpx, kind };
}

/** Box UVs so the door face texture shows the latch edge on the same side of both faces. */
function fixLeafUVs(g: THREE.BoxGeometry, mirrorFront: boolean): void {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const mirror = (start: number): void => {
    for (let i = start; i < start + 4; i++) uv.setX(i, 1 - uv.getX(i));
  };
  // face order px, nx, py, ny, pz(16..19), nz(20..23)
  if (mirrorFront) mirror(16);
  else mirror(20);
  uv.needsUpdate = true;
}

function signQuad(x0: number, x1: number, y0: number, y1: number, z: number, facing: 1 | -1): THREE.BufferGeometry {
  const uvs: UV[] = facing > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]];
  return quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, facing], uvs);
}

export class DoorRig {
  readonly group = new THREE.Group();
  readonly handle: DoorHandle;
  readonly def: DoorDef;
  readonly kind: DoorKind;
  /** 0 closed → 1 open (linear; easing applied visually) */
  progress: number;
  private target: number;
  private readonly openSeconds: number;
  private readonly closeSeconds: number;
  private resolvers: Array<() => void> = [];
  private appliers: Array<(t: number) => void> = [];
  private ledMat: THREE.MeshStandardMaterial | null = null;
  private lanternMat: THREE.MeshStandardMaterial | null = null;
  private powered = true;
  private disposables: THREE.BufferGeometry[] = [];
  private localMaterials: THREE.Material[] = [];
  readonly sideB: 1 | -1;
  readonly rotY: number;
  private readonly W: number;
  private readonly H: number;
  private readonly kit: MaterialKit;

  constructor(o: DoorRigOptions) {
    const { def, roomA, roomB, kit } = o;
    this.def = def;
    this.kind = def.kind;
    this.kit = kit;
    this.W = def.width;
    this.H = o.height;
    const [os, cs] = DURATION[def.kind];
    this.openSeconds = os;
    this.closeSeconds = cs;
    this.rotY = def.axis === 'x' ? 0 : -Math.PI / 2;
    // room b direction in local z: axis x → world z sign; axis z → local +z is world −x
    const bc = { x: (roomB.bounds.x0 + roomB.bounds.x1) / 2, z: (roomB.bounds.z0 + roomB.bounds.z1) / 2 };
    const intoB = def.axis === 'x' ? Math.sign(bc.z - def.pos.z) : -Math.sign(bc.x - def.pos.x);
    this.sideB = intoB >= 0 ? 1 : -1;
    this.group.name = `door:${def.id}`;
    this.group.position.set(def.pos.x, 0, def.pos.z);
    this.group.rotation.y = this.rotY;
    this.group.userData.room = roomA.id;
    this.group.userData.door = def.id;

    const isOpenKind = def.kind === 'open';
    this.progress = isOpenKind ? 1 : 0;
    this.target = this.progress;
    this.handle = {
      def,
      open: isOpenKind,
      locked: !!def.locked,
      access: def.access,
      passage: doorPassage(def),
    };

    this.buildFrame(o);
    this.buildLeaves(o);
    if (def.label && !isOpenKind) this.buildSign(o);
    if (o.reader || def.id === 'd_entrance') this.buildReader(o);
    this.setLocked(this.handle.locked);
  }

  get animating(): boolean {
    return Math.abs(this.progress - this.target) > 1e-4;
  }

  /** Local → world for static batch geometry. */
  private toWorld(g: THREE.BufferGeometry): THREE.BufferGeometry {
    if (this.rotY) g.rotateY(this.rotY);
    g.translate(this.def.pos.x, 0, this.def.pos.z);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  private buildFrame(o: DoorRigOptions): void {
    const { frames, roomA, maxCeil } = o;
    const W = this.W;
    const H = this.H;
    const g = WALL / 2 + PROTRUDE;
    const kind = this.kind;
    const key = kind === 'sliding_glass' ? FRAME_KEY.alu : kind === 'elevator' ? FRAME_KEY.steel : kind === 'open' ? FRAME_KEY.trim : FRAME_KEY.frame;
    const jw = kind === 'elevator' ? 0.12 : kind === 'open' ? 0.08 : kind === 'sliding_glass' ? 0.06 : 0.05;

    frames.add(key, this.toWorld(box(-W / 2 - jw, -W / 2, 0, H + jw, -g, g)));
    frames.add(key, this.toWorld(box(W / 2, W / 2 + jw, 0, H + jw, -g, g)));

    if (kind === 'open') {
      // soffit fills the gap up past the lower ceiling; floor strip closes the gap underfoot
      frames.add(key, this.toWorld(box(-W / 2 - jw, W / 2 + jw, H, maxCeil + 0.02, -g, g)));
      const fs = UVS[roomA.floor];
      // authored in world space directly so the strip's UVs continue the room floor's tiling
      const strip = hQuad(-W / 2, W / 2, -WALL / 2, WALL / 2, 0.0005, true, fs, fs);
      this.toWorld(strip);
      const uv = strip.attributes.uv as THREE.BufferAttribute;
      const pos = strip.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / fs, pos.getZ(i) / fs);
      frames.add(`floor:${roomA.id}`, strip);
      return;
    }

    const headH = kind === 'sliding_glass' || kind === 'elevator' ? 0.12 : jw;
    frames.add(key, this.toWorld(box(-W / 2 - jw, W / 2 + jw, H, H + headH, -g, g)));
    // threshold saddle closes the floor gap
    frames.add(FRAME_KEY.alu, this.toWorld(box(-W / 2, W / 2, 0, 0.012, -WALL / 2, WALL / 2)));

    if (kind === 'elevator') {
      // hoistway transom up to the ceiling + hall lantern housing
      frames.add(FRAME_KEY.steel, this.toWorld(box(-W / 2 - jw, W / 2 + jw, H + headH, maxCeil + 0.02, -g, g)));
    }
    if (kind === 'sliding_glass') {
      // motion sensors under the operator header on both sides
      for (const s of [1, -1] as const) {
        frames.add(FRAME_KEY.dark, this.toWorld(box(-0.06, 0.06, H - 0.05, H, s * (g + 0.002), s * (g + 0.05))));
      }
    }
    if (kind === 'counter_gate') {
      // gate post cap
      frames.add(FRAME_KEY.steel, this.toWorld(box(-W / 2 - jw, W / 2 + jw, 1.08, 1.1, -g, g)));
    }
  }

  // ---------------------------------------------------------------------------
  // Leaves
  // ---------------------------------------------------------------------------

  private buildLeaves(o: DoorRigOptions): void {
    const W = this.W;
    switch (this.kind) {
      case 'swing':
      case 'service': {
        const hingeLow = this.hingeLow(o);
        this.swingLeaf(-W / 2, W / 2, hingeLow, this.kind === 'service' ? 'steel' : 'wood', o);
        break;
      }
      case 'double': {
        this.swingLeaf(-W / 2, 0, true, this.def.id === 'd_closed_wing' ? 'steel' : 'wood', o);
        this.swingLeaf(0, W / 2, false, this.def.id === 'd_closed_wing' ? 'steel' : 'wood', o);
        break;
      }
      case 'sliding_glass': {
        this.slidingGlassLeaf(-W / 2, 0.012, -1);
        this.slidingGlassLeaf(-0.012, W / 2, 1);
        break;
      }
      case 'elevator': {
        this.elevatorLeaf(-W / 2, 0.003, -1);
        this.elevatorLeaf(-0.003, W / 2, 1);
        this.elevatorDressing();
        break;
      }
      case 'counter_gate': {
        this.gateLeaf(-W / 2, W / 2, this.hingeLow(o));
        break;
      }
      case 'open':
        break;
    }
  }

  /** Hinge at the low-x end when the open leaf rests closer to room b's nearer side wall. */
  private hingeLow(o: DoorRigOptions): boolean {
    const b = o.roomB.bounds;
    const axisX = this.def.axis === 'x';
    const c = axisX ? this.def.pos.x : this.def.pos.z;
    const lo = axisX ? b.x0 : b.z0;
    const hi = axisX ? b.x1 : b.z1;
    const dLow = c - this.W / 2 - lo;
    const dHigh = hi - (c + this.W / 2);
    return dLow <= dHigh + 1e-6;
  }

  private swingLeaf(x0: number, x1: number, hingeLow: boolean, face: 'wood' | 'steel', o: DoorRigOptions): void {
    const lw = x1 - x0 - 0.02;
    const lh = this.H - 0.03;
    const dir = hingeLow ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(hingeLow ? x0 + 0.01 : x1 - 0.01, 0, 0);
    pivot.name = 'hinge';

    const geo = new THREE.BoxGeometry(lw, lh, LEAF_T);
    fixLeafUVs(geo, !hingeLow);
    this.disposables.push(geo);
    const label = this.def.label && this.def.label.length <= 12 ? this.def.label : undefined;
    const faceMat = this.kit.doorFace(face, label, this.def.window, o.seed);
    const edgeMat = this.kit.doorEdge(face);
    const leaf = new THREE.Mesh(geo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, faceMat]);
    leaf.position.set((dir * lw) / 2, 0.015 + lh / 2, 0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.name = 'door_leaf';
    pivot.add(leaf);

    // lever handles on both faces at the latch edge
    const hx = dir * (lw - 0.09);
    const hy = 1.02;
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [1, -1] as const) {
      const z = s * (LEAF_T / 2 + 0.012);
      parts.push(tube(hx, hy, s * (LEAF_T / 2), hx, hy, z + 0.03, 0.011, 8));
      parts.push(box(hx - 0.028, hx + 0.028, hy - 0.028, hy + 0.028, s * (LEAF_T / 2), s * (LEAF_T / 2) + 0.006));
      const lever = box(Math.min(hx, hx - dir * 0.13), Math.max(hx, hx - dir * 0.13), hy - 0.01, hy + 0.01, z + 0.02, z + 0.04);
      parts.push(lever);
    }
    if (face === 'steel') {
      // kick plate band in relief
      parts.push(box(dir > 0 ? 0.02 : -lw + 0.02, dir > 0 ? lw - 0.02 : -0.02, 0.03, 0.26, -LEAF_T / 2 - 0.002, LEAF_T / 2 + 0.002));
    }
    const handleGeo = this.mergeParts(parts);
    if (handleGeo) {
      const handles = new THREE.Mesh(handleGeo, this.kit.alu());
      handles.castShadow = true;
      handles.name = 'door_hardware';
      pivot.add(handles);
    }

    // leaf extension e = (dir,0,0); open direction o = (0,0,sideB): signed angle about +y
    const theta = -dir * this.sideB * (Math.PI / 2) * 0.98;
    this.appliers.push((t) => {
      pivot.rotation.y = theta * t;
    });
    this.group.add(pivot);
  }

  private slidingGlassLeaf(x0: number, x1: number, slideDir: 1 | -1): void {
    const leaf = new THREE.Group();
    leaf.name = 'door_leaf';
    const H = this.H;
    const st = 0.05; // stile width
    const rail = 0.08;
    const t = 0.045;
    const parts: THREE.BufferGeometry[] = [
      box(x0, x0 + st, 0.012, H - 0.01, -t / 2, t / 2),
      box(x1 - st, x1, 0.012, H - 0.01, -t / 2, t / 2),
      box(x0, x1, 0.012, 0.012 + rail, -t / 2, t / 2),
      box(x0, x1, H - 0.01 - rail, H - 0.01, -t / 2, t / 2),
      box(x0 + st, x1 - st, 0.94, 0.99, -t / 2 - 0.004, t / 2 + 0.004),
    ];
    const frameGeo = this.mergeParts(parts);
    if (frameGeo) {
      const frame = new THREE.Mesh(frameGeo, this.kit.alu());
      frame.castShadow = true;
      frame.receiveShadow = true;
      leaf.add(frame);
    }
    const glassGeo = quad([x0 + st, 0.012 + rail, 0], [x1 - st, 0.012 + rail, 0], [x1 - st, H - 0.01 - rail, 0], [x0 + st, H - 0.01 - rail, 0], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    this.disposables.push(glassGeo);
    const glass = new THREE.Mesh(glassGeo, this.kit.glass());
    glass.name = 'door_glass';
    glass.renderOrder = 2;
    leaf.add(glass);
    const travel = x1 - x0 - 0.02;
    this.appliers.push((k) => {
      leaf.position.x = slideDir * travel * k;
    });
    this.group.add(leaf);
  }

  private elevatorLeaf(x0: number, x1: number, slideDir: 1 | -1): void {
    const geo = box(x0 + 0.004, x1 - 0.004, 0.012, this.H - 0.012, -0.02, 0.02, 1.0);
    this.disposables.push(geo);
    const leaf = new THREE.Mesh(geo, this.kit.steel());
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.name = 'door_leaf';
    const travel = x1 - x0;
    this.appliers.push((k) => {
      leaf.position.x = slideDir * travel * k;
    });
    this.group.add(leaf);
  }

  /** Hall lantern + floor indicator on the corridor side of the elevator. */
  private elevatorDressing(): void {
    const sideA = -this.sideB;
    const z = sideA * (WALL / 2 + PROTRUDE + 0.004);
    const y = this.H + 0.34;
    const ind = signQuad(-0.09, 0.09, y - 0.09, y + 0.09, z, sideA as 1 | -1);
    this.disposables.push(ind);
    const indicator = new THREE.Mesh(ind, this.kit.sign('1', 'elevator_call', 256, 256));
    indicator.name = 'elevator_indicator';
    this.group.add(indicator);

    this.lanternMat = this.kit.makeEmissive(0xffb060, 0, 0x2a2420);
    const lanternGeo = new THREE.SphereGeometry(0.03, 10, 8);
    this.disposables.push(lanternGeo);
    for (const x of [-0.3, 0.3]) {
      const m = new THREE.Mesh(lanternGeo, this.lanternMat);
      m.position.set(x, y, z);
      m.scale.set(1, 1, 0.5);
      m.name = 'hall_lantern';
      this.group.add(m);
    }
  }

  private gateLeaf(x0: number, x1: number, hingeLow: boolean): void {
    const lw = x1 - x0 - 0.02;
    const lh = 1.05;
    const dir = hingeLow ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(hingeLow ? x0 + 0.01 : x1 - 0.01, 0, 0);
    const parts: THREE.BufferGeometry[] = [
      box(Math.min(0, dir * lw), Math.max(0, dir * lw), 0.02, lh, -0.02, 0.02),
    ];
    const geo = this.mergeParts(parts);
    if (geo) {
      const leaf = new THREE.Mesh(geo, this.kit.laminate());
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      leaf.name = 'door_leaf';
      pivot.add(leaf);
    }
    const capGeo = box(Math.min(0, dir * lw), Math.max(0, dir * lw), lh, lh + 0.02, -0.025, 0.025);
    this.disposables.push(capGeo);
    const cap = new THREE.Mesh(capGeo, this.kit.steel());
    pivot.add(cap);
    const theta = -dir * this.sideB * (Math.PI / 2) * 0.98;
    this.appliers.push((t) => {
      pivot.rotation.y = theta * t;
    });
    this.group.add(pivot);
  }

  private mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
    if (parts.length === 0) return null;
    const merged = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) as THREE.BufferGeometry | null);
    if (parts.length > 1) for (const p of parts) p.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    this.disposables.push(merged);
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Sign + reader
  // ---------------------------------------------------------------------------

  private buildSign(o: DoorRigOptions): void {
    const label = this.def.label!;
    const exterior = !!o.roomB.outdoor || !!o.roomA.outdoor;
    const facing: 1 | -1 = o.roomB.outdoor ? this.sideB : o.roomA.outdoor ? (-this.sideB as 1 | -1) : (-this.sideB as 1 | -1);
    const spec = signSpec(label, this.W, exterior);
    const jw = this.kind === 'sliding_glass' ? 0.12 : this.kind === 'elevator' ? 0.12 : 0.05;
    const y0 = this.H + jw + (exterior ? 0.12 : 0.04);
    const z = facing * (WALL / 2 + PROTRUDE + 0.004);
    const g = signQuad(-spec.w / 2, spec.w / 2, y0, y0 + spec.h, z, facing);
    this.disposables.push(g);
    const mesh = new THREE.Mesh(g, this.kit.sign(label, spec.kind, spec.wpx, spec.hpx));
    mesh.name = `sign:${this.def.id}`;
    mesh.userData.room = facing === this.sideB ? o.roomB.id : o.roomA.id;
    this.group.add(mesh);
  }

  private buildReader(o: DoorRigOptions): void {
    const approach: 1 | -1 = o.roomB.outdoor ? this.sideB : (-this.sideB as 1 | -1);
    const zFace = approach * (WALL / 2 + PROTRUDE);
    const x = this.W / 2 + 0.22;
    const plateGeo = box(x - 0.04, x + 0.04, 1.14, 1.27, Math.min(zFace, zFace + approach * 0.024), Math.max(zFace, zFace + approach * 0.024));
    this.disposables.push(plateGeo);
    const plate = new THREE.Mesh(plateGeo, this.kit.plastic(0x2b2d31));
    plate.name = 'badge_plate';
    this.group.add(plate);
    const ledGeo = box(x - 0.007, x + 0.007, 1.235, 1.249, Math.min(zFace + approach * 0.024, zFace + approach * 0.03), Math.max(zFace + approach * 0.024, zFace + approach * 0.03));
    this.disposables.push(ledGeo);
    this.ledMat = this.kit.makeEmissive(0x30ff70, 1.2, 0x101210);
    const led = new THREE.Mesh(ledGeo, this.ledMat);
    led.name = 'badge_led';
    this.group.add(led);
    // bell button for the public entrance
    if (this.def.id === 'd_entrance') {
      const btn = tube(x, 1.18, zFace + approach * 0.024, x, 1.18, zFace + approach * 0.034, 0.012, 10);
      this.disposables.push(btn);
      const m = new THREE.Mesh(btn, this.kit.alu());
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------------------
  // Runtime
  // ---------------------------------------------------------------------------

  setLocked(locked: boolean): void {
    this.handle.locked = locked;
    this.refreshLed();
  }

  setPowered(on: boolean): void {
    this.powered = on;
    this.refreshLed();
  }

  private refreshLed(): void {
    if (!this.ledMat) return;
    if (!this.powered) {
      this.ledMat.emissiveIntensity = 0;
      return;
    }
    const entrance = this.def.id === 'd_entrance';
    if (this.handle.locked) {
      this.ledMat.emissive.set(0xff2a1a);
      this.ledMat.emissiveIntensity = 1.6;
    } else if (entrance) {
      this.ledMat.emissiveIntensity = 0;
    } else {
      this.ledMat.emissive.set(0x30ff70);
      this.ledMat.emissiveIntensity = 1.0;
    }
  }

  /** Hall lantern glow (elevator arriving). */
  setLantern(on: boolean): void {
    if (this.lanternMat) this.lanternMat.emissiveIntensity = on ? 1.8 : 0;
  }

  /** Begin moving toward open/closed; resolves when the leaves arrive. */
  setOpen(open: boolean, animate: boolean): Promise<void> {
    if (this.kind === 'open') return Promise.resolve();
    this.target = open ? 1 : 0;
    if (!animate || this.openSeconds <= 0) {
      this.progress = this.target;
      this.apply();
      const rs = this.resolvers;
      this.resolvers = [];
      for (const r of rs) r();
      return Promise.resolve();
    }
    if (!this.animating) return Promise.resolve();
    return new Promise<void>((resolve) => this.resolvers.push(resolve));
  }

  /** Advance the animation. Returns 'arrived' on the frame the leaves reach the target. */
  update(dt: number): 'idle' | 'running' | 'arrived' {
    if (!this.animating) return 'idle';
    const seconds = this.target > this.progress ? this.openSeconds : this.closeSeconds;
    const step = dt / Math.max(0.05, seconds);
    if (this.target > this.progress) this.progress = Math.min(this.target, this.progress + step);
    else this.progress = Math.max(this.target, this.progress - step);
    this.apply();
    if (!this.animating) {
      this.progress = this.target;
      const rs = this.resolvers;
      this.resolvers = [];
      for (const r of rs) r();
      return 'arrived';
    }
    return 'running';
  }

  private apply(): void {
    // one smooth curve both ways keeps retargeting mid-swing continuous
    const k = ease.inOut(this.progress);
    for (const a of this.appliers) a(k);
  }

  dispose(): void {
    for (const g of this.disposables) g.dispose();
    this.disposables = [];
    for (const m of this.localMaterials) m.dispose();
    this.localMaterials = [];
    const rs = this.resolvers;
    this.resolvers = [];
    for (const r of rs) r();
    this.group.removeFromParent();
  }
}
