/**
 * WorldBuilder — builds the whole wing from the layout: room shells (merged per material),
 * door rigs that animate, the elevator cab, the exterior ambulance bay in the rain, props via
 * src/world/props.ts, call lights, haze, decals and the obstacle set for collision.
 * build() is re-runnable: the previous world is disposed and doors/props reset to layout defaults.
 */
import * as THREE from 'three';
import type { DoorHandle, IWorldBuilder, Services } from '../core/contracts';
import type { RNG } from '../core/rng';
import type { CharacterId, PropDef, Rect, RoomDef, RoomId, Vec2, Vec3 } from '../core/types';
import * as textures from '../render/textures';
import { buildProp, footprintToRect, type PropContext, type PropInstance } from './props';
import { roomAt as layoutRoomAt } from './layout';
import { DecalLayer } from './decals';
import { GeoBatch, box, disposeTree, ease, hQuad, quad, tube } from './WorldBuilder.geom';
import { MaterialKit } from './WorldBuilder.materials';
import { DoorRig, doorHeight } from './WorldBuilder.doors';
import { buildRoomShell, buildWindow, computeOpenings, neighbourAcross, roomFloorMaterial, type Opening } from './WorldBuilder.rooms';
import { Exterior, type GlassRegion } from './WorldBuilder.exterior';

interface PropEntry {
  id: string;
  /** private copy of the layout def (moves update pos/rotY here, never the shared layout) */
  def: PropDef;
  inst: PropInstance;
  obstacle: Rect | null;
}

interface Tween {
  entry: PropEntry;
  from: THREE.Vector3;
  to: THREE.Vector3;
  fromRot: number;
  toRot: number;
  t: number;
  seconds: number;
  resolve: () => void;
}

interface CallLight {
  room: RoomId;
  lens: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  pos: Vec3;
  on: boolean;
}

interface Haze {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

export class WorldBuilder implements IWorldBuilder {
  private s!: Services;
  private rng!: RNG;
  private root: THREE.Group | null = null;
  private kit: MaterialKit | null = null;
  private groups = new Map<RoomId, THREE.Group>();
  private roomsById = new Map<RoomId, RoomDef>();
  private doors = new Map<string, DoorRig>();
  private props = new Map<string, PropEntry>();
  private updatables: PropEntry[] = [];
  private tweens: Tween[] = [];
  private decals: DecalLayer | null = null;
  private exterior: Exterior | null = null;
  private haze = new Map<RoomId, Haze>();
  private callLights = new Map<RoomId, CallLight>();
  private boardLamps = new Map<RoomId, THREE.MeshStandardMaterial>();
  private cabLight: THREE.MeshStandardMaterial | null = null;
  private obstacles: Rect[] = [];
  private obstaclesDirty = true;
  private glowsRegistered = false;
  private powered = true;
  private rainIntensity = 0.75;
  private unsub: Array<() => void> = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    this.build();
    this.unsub.push(
      services.bus.on('power:change', ({ power }) => {
        this.powered = power !== 'blackout';
        for (const rig of this.doors.values()) rig.setPowered(this.powered);
      }),
    );
  }

  dispose(): void {
    for (const off of this.unsub) off();
    this.unsub = [];
    this.disposeWorld();
  }

  update(dt: number, _gdt: number): void {
    // doors
    for (const rig of this.doors.values()) {
      const st = rig.update(dt);
      if (st === 'arrived') {
        this.obstaclesDirty = true;
        if (!rig.handle.open) this.doorSfx(rig, 'close_end');
      }
    }
    // prop moves
    if (this.tweens.length) {
      const keep: Tween[] = [];
      for (const tw of this.tweens) {
        tw.t += dt;
        const k = ease.inOut(Math.min(1, tw.t / tw.seconds));
        const o = tw.entry.inst.object;
        o.position.lerpVectors(tw.from, tw.to, k);
        o.rotation.y = tw.fromRot + (tw.toRot - tw.fromRot) * k;
        this.syncPropPlacement(tw.entry);
        if (tw.t >= tw.seconds) {
          o.position.copy(tw.to);
          o.rotation.y = tw.toRot;
          this.syncPropPlacement(tw.entry);
          tw.resolve();
        } else keep.push(tw);
      }
      this.tweens = keep;
    }
    // props with their own animation (screens, curtains, LEDs)
    for (const e of this.updatables) {
      try {
        e.inst.update!(dt);
      } catch (err) {
        console.warn('[world] prop update failed', e.id, err);
      }
    }
    this.decals?.update(dt);
    this.exterior?.update(dt, this.s.three.renderer.getPixelRatio());
    if (!this.glowsRegistered) this.registerGlows();
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  build(): void {
    const s = this.s;
    const L = s.layout;
    this.disposeWorld();
    this.rng = s.rng.fork('world');
    const kit = (this.kit = new MaterialKit(textures));
    const root = (this.root = new THREE.Group());
    root.name = 'world';
    s.three.scene.add(root);
    this.roomsById = new Map(L.rooms.map((r) => [r.id, r]));

    const openings = computeOpenings(L);

    // room groups + shells
    for (const room of L.rooms) {
      const g = new THREE.Group();
      g.name = `room:${room.id}`;
      g.userData.room = room.id;
      root.add(g);
      this.groups.set(room.id, g);
      if (room.outdoor) continue;
      const res = buildRoomShell(room, { kit, openings, rooms: L.rooms, group: g });
      if (res.cabLight) this.cabLight = res.cabLight;
    }

    // exterior lot, façade, sky, rain
    const ext = L.rooms.find((r) => r.outdoor);
    if (ext) {
      const glass: GlassRegion[] = [];
      for (const room of L.rooms) {
        if (room.sides?.w?.kind === 'glass' && neighbourAcross(room, 'w', L.rooms)?.id === ext.id) {
          glass.push({ z0: room.bounds.z0, z1: room.bounds.z1, y1: room.ceiling });
        }
      }
      const canopyDef = L.props.find((p) => p.type === 'canopy');
      const cw = Number(canopyDef?.params?.w ?? 6);
      const cd = Number(canopyDef?.params?.d ?? 10);
      const canopy = canopyDef ? { x0: canopyDef.pos.x - cw / 2, x1: canopyDef.pos.x + cw / 2, z0: canopyDef.pos.z - cd / 2, z1: canopyDef.pos.z + cd / 2, y: canopyDef.pos.y } : null;
      this.exterior = new Exterior({ room: ext, layout: L, kit, rng: this.rng.fork('exterior'), glass, canopy });
      this.groups.get(ext.id)!.add(this.exterior.group);
      this.exterior.setRain(this.rainIntensity);
    }

    // doors + frames (frames of every door merge into a few meshes)
    const frames = new GeoBatch();
    const readerDoors = new Set(L.props.filter((p) => p.type === 'badge_reader').map((p) => String(p.params?.door ?? '')));
    for (const def of L.doors) {
      const a = this.roomsById.get(def.a);
      const b = this.roomsById.get(def.b);
      if (!a || !b) continue;
      const minCeil = Math.min(a.ceiling, b.ceiling);
      const maxCeil = Math.min(4, Math.max(a.ceiling, b.ceiling));
      const rig = new DoorRig({
        def,
        roomA: a,
        roomB: b,
        height: doorHeight(def, minCeil),
        maxCeil,
        kit,
        frames,
        reader: !!def.badge && !readerDoors.has(def.id),
        seed: this.rng.int(0, 9999),
      });
      rig.setPowered(this.powered);
      rig.group.traverse((o) => {
        if (o.userData.room === undefined) o.userData.room = a.id;
      });
      this.doors.set(def.id, rig);
      root.add(rig.group);
    }
    for (const o of openings) {
      if (o.kind !== 'window') continue;
      const far = this.roomsById.get(o.rooms[1]);
      let blinds: 1 | -1 | 0 = 0;
      if (far) {
        const c = o.axis === 'x' ? (far.bounds.z0 + far.bounds.z1) / 2 : (far.bounds.x0 + far.bounds.x1) / 2;
        blinds = c > o.k ? 1 : -1;
      }
      buildWindow(o, frames, blinds);
    }
    const framesGroup = new THREE.Group();
    framesGroup.name = 'frames';
    framesGroup.userData.room = 'corridor';
    root.add(framesGroup);
    frames.flush(framesGroup, (key) => this.frameMaterial(key), { receiveShadow: true, castShadow: false, room: 'corridor', namePrefix: 'frames:' });

    // props
    const ctx: PropContext = { textures, services: s };
    for (const def of L.props) {
      if (def.type === 'call_light') {
        this.buildCallLight(def);
        continue;
      }
      if (def.type === 'elevator_doors') continue; // the d_elevator rig owns the hoistway doors
      let inst: PropInstance;
      try {
        inst = buildProp(def, ctx);
      } catch (err) {
        console.error('[world] prop build failed', def.id, err);
        continue;
      }
      const obj = inst.object;
      obj.position.set(def.pos.x, def.pos.y, def.pos.z);
      obj.rotation.y = def.rotY;
      if (def.scale) obj.scale.setScalar(def.scale);
      obj.name = def.id;
      obj.userData.room = def.room;
      obj.userData.prop = def.type;
      obj.traverse((o) => {
        if (o.userData.room === undefined) o.userData.room = def.room;
      });
      const group = this.groups.get(def.room);
      if (group) group.add(obj);
      else root.add(obj);
      const entry: PropEntry = {
        id: def.id,
        def: { ...def, pos: { ...def.pos } },
        inst,
        obstacle: def.solid ? inst.obstacle ?? footprintToRect(def) ?? null : null,
      };
      this.props.set(def.id, entry);
      if (typeof inst.update === 'function') this.updatables.push(entry);
    }

    // decals
    this.decals = new DecalLayer(textures, this.rng.fork('decals'));
    root.add(this.decals.group);

    for (const [roomId, g] of this.groups) {
      g.traverse((o) => {
        if (o.userData.room === undefined) o.userData.room = roomId;
      });
    }
    this.obstaclesDirty = true;
    this.glowsRegistered = false;
  }

  private disposeWorld(): void {
    if (!this.root) return;
    for (const tw of this.tweens) tw.resolve();
    this.tweens = [];
    for (const rig of this.doors.values()) rig.dispose();
    for (const e of this.props.values()) {
      try {
        e.inst.dispose();
      } catch (err) {
        console.warn('[world] prop dispose failed', e.id, err);
      }
    }
    this.decals?.dispose();
    this.exterior?.dispose();
    disposeTree(this.root, this.kit?.ownsSet());
    this.root.removeFromParent();
    this.kit?.disposeAll();
    this.root = null;
    this.kit = null;
    this.decals = null;
    this.exterior = null;
    this.cabLight = null;
    this.groups.clear();
    this.doors.clear();
    this.props.clear();
    this.updatables = [];
    this.haze.clear();
    this.callLights.clear();
    this.boardLamps.clear();
    this.obstacles = [];
    this.obstaclesDirty = true;
  }

  private frameMaterial(key: string): THREE.Material {
    const kit = this.kit!;
    if (key.startsWith('floor:')) {
      const room = this.roomsById.get(key.slice(6) as RoomId);
      if (room) return roomFloorMaterial(room, kit);
      return kit.floor('vinyl');
    }
    switch (key) {
      case 'alu':
        return kit.alu();
      case 'steel':
        return kit.steel();
      case 'trim':
        return kit.trim();
      case 'darkmetal':
        return kit.darkMetal();
      case 'plastic':
        return kit.plastic();
      case 'glass_dirty':
        return kit.glassDirty();
      case 'laminate':
        return kit.laminate();
      case 'frame':
      default:
        return kit.frame();
    }
  }

  // ---------------------------------------------------------------------------
  // Call lights (dome above each exam door + the nurse-station call board)
  // ---------------------------------------------------------------------------

  private buildCallLight(def: PropDef): void {
    const kit = this.kit!;
    const roomParam = String(def.params?.room ?? '');
    const host = this.roomsById.get(def.room);
    const parent = this.groups.get(def.room) ?? this.root!;
    const g = new THREE.Group();
    g.name = def.id;
    g.userData.room = def.room;
    g.userData.prop = def.type;
    g.position.set(def.pos.x, def.pos.y, def.pos.z);
    // face the room centre: local +z is the front, the wall is behind
    if (host) g.lookAt((host.bounds.x0 + host.bounds.x1) / 2, def.pos.y, (host.bounds.z0 + host.bounds.z1) / 2);
    parent.add(g);

    if (roomParam === 'board') {
      const panel = new THREE.Mesh(box(-0.36, 0.36, -0.16, 0.16, -0.035, 0), kit.plastic(0x2c2e31));
      panel.castShadow = true;
      g.add(panel);
      const header = new THREE.Mesh(
        quad([-0.3, 0.07, 0.002], [0.3, 0.07, 0.002], [0.3, 0.13, 0.002], [-0.3, 0.13, 0.002], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]),
        kit.sign('NURSE CALL', 'dept', 1024, 128),
      );
      g.add(header);
      const exams = this.s.layout.rooms.filter((r) => /^exam\d$/.test(r.id)).sort((p, q) => p.id.localeCompare(q.id));
      exams.forEach((r, i) => {
        const x = -0.26 + i * 0.13;
        const lampMat = kit.makeEmissive(0xff4a30, 0, 0x3a1a16);
        const lamp = new THREE.Mesh(tube(x, 0.0, 0, x, 0.0, 0.028, 0.024, 12), lampMat);
        g.add(lamp);
        const label = new THREE.Mesh(
          quad([x - 0.035, -0.12, 0.002], [x + 0.035, -0.12, 0.002], [x + 0.035, -0.05, 0.002], [x - 0.035, -0.05, 0.002], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]),
          kit.sign(r.id.replace('exam', ''), 'room_number', 256, 256),
        );
        g.add(label);
        this.boardLamps.set(r.id, lampMat);
      });
      return;
    }

    const room = roomParam as RoomId;
    const housing = new THREE.Mesh(box(-0.12, 0.12, -0.05, 0.05, -0.05, 0.02), kit.plastic(0xe6e4de));
    housing.castShadow = true;
    const lensMat = kit.makeEmissive(0xfff0d0, 0, 0xd4d2cc);
    const lens = new THREE.Mesh(box(-0.085, 0.085, -0.03, 0.03, 0.02, 0.04), lensMat);
    const lampMat = kit.makeEmissive(0xff3a24, 0, 0x4a1a14);
    const lamp = new THREE.Mesh(tube(0.1, 0.03, 0.02, 0.1, 0.03, 0.045, 0.012, 10), lampMat);
    g.add(housing, lens, lamp);
    this.callLights.set(room, { room, lens: lensMat, lamp: lampMat, pos: { ...def.pos }, on: false });
  }

  private registerGlows(): void {
    this.glowsRegistered = true;
    const lighting = this.s.lighting;
    for (const cl of this.callLights.values()) {
      try {
        lighting.registerGlow(`call_${cl.room}`, cl.pos, 0xffd9a0, 0.5, 'emergency');
        lighting.setGlow(`call_${cl.room}`, cl.on);
      } catch (err) {
        console.warn('[world] registerGlow failed', err);
      }
    }
  }

  setCallLight(room: RoomId, on: boolean): void {
    const cl = this.callLights.get(room);
    if (cl) {
      cl.on = on;
      cl.lens.emissiveIntensity = on ? 1.6 : 0;
      cl.lamp.emissiveIntensity = on ? 2.4 : 0;
    }
    const lamp = this.boardLamps.get(room);
    if (lamp) lamp.emissiveIntensity = on ? 2.0 : 0;
    if (this.glowsRegistered && cl) {
      try {
        this.s.lighting.setGlow(`call_${room}`, on);
      } catch {
        /* lighting not ready */
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rooms / props
  // ---------------------------------------------------------------------------

  roomGroup(room: RoomId): THREE.Group | undefined {
    return this.groups.get(room);
  }

  getProp(id: string): THREE.Object3D | undefined {
    return this.props.get(id)?.inst.object;
  }

  roomAt(p: Vec2): RoomId | null {
    return layoutRoomAt(p, this.s.layout.rooms);
  }

  setScreen(propId: string, mode: string): void {
    const e = this.props.get(propId);
    if (!e) return;
    try {
      e.inst.setScreen?.(mode);
    } catch (err) {
      console.warn('[world] setScreen failed', propId, err);
    }
  }

  moveProp(id: string, to: Vec3, rotY?: number, seconds = 0): Promise<void> {
    const e = this.props.get(id);
    if (!e) return Promise.resolve();
    // a newer move supersedes a running one
    this.tweens = this.tweens.filter((tw) => {
      if (tw.entry !== e) return true;
      tw.resolve();
      return false;
    });
    const o = e.inst.object;
    const toRot = rotY ?? o.rotation.y;
    if (seconds <= 0) {
      o.position.set(to.x, to.y, to.z);
      o.rotation.y = toRot;
      this.syncPropPlacement(e);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.tweens.push({
        entry: e,
        from: o.position.clone(),
        to: new THREE.Vector3(to.x, to.y, to.z),
        fromRot: o.rotation.y,
        toRot,
        t: 0,
        seconds,
        resolve,
      });
    });
  }

  /** Keep the private def, obstacle and room tag in step with the object's transform. */
  private syncPropPlacement(e: PropEntry): void {
    const o = e.inst.object;
    e.def.pos = { x: o.position.x, y: o.position.y, z: o.position.z };
    e.def.rotY = o.rotation.y;
    if (e.def.solid) e.obstacle = footprintToRect(e.def) ?? e.obstacle;
    o.userData.room = this.roomAt({ x: o.position.x, z: o.position.z }) ?? e.def.room;
    this.obstaclesDirty = true;
  }

  getObstacles(): Rect[] {
    if (this.obstaclesDirty) {
      const out: Rect[] = [];
      for (const e of this.props.values()) {
        if (e.def.solid && e.obstacle) out.push(e.obstacle);
      }
      for (const rig of this.doors.values()) {
        if (rig.kind !== 'open' && !rig.handle.open) out.push(rig.handle.passage);
      }
      this.obstacles = out;
      this.obstaclesDirty = false;
    }
    return this.obstacles;
  }

  /** Standing on a puddle (prop or decal) — footstep_wet. */
  isWetAt(p: Vec2): boolean {
    if (this.decals?.wetAt(p)) return true;
    for (const e of this.props.values()) {
      if (e.def.type !== 'puddle') continue;
      const w = Number(e.def.params?.w ?? 1);
      const d = Number(e.def.params?.d ?? 1);
      const dx = p.x - e.def.pos.x;
      const dz = p.z - e.def.pos.z;
      if ((dx * dx) / ((w * w) / 4) + (dz * dz) / ((d * d) / 4) <= 1) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Doors
  // ---------------------------------------------------------------------------

  getDoor(id: string): DoorHandle | undefined {
    return this.doors.get(id)?.handle;
  }

  async setDoorOpen(id: string, open: boolean, animate = true): Promise<void> {
    const rig = this.doors.get(id);
    if (!rig || rig.kind === 'open') return;
    const target = open ? 1 : 0;
    if (rig.handle.open === open && !rig.animating && rig.progress === target) return;
    rig.handle.open = open;
    this.obstaclesDirty = true;
    this.s.bus.emit('door:changed', { id, open, locked: rig.handle.locked });
    if (animate) this.doorSfx(rig, open ? 'open' : 'close_start');
    await rig.setOpen(open, animate);
  }

  setDoorLocked(id: string, locked: boolean): void {
    const rig = this.doors.get(id);
    if (!rig || rig.handle.locked === locked) return;
    rig.setLocked(locked);
    this.s.bus.emit('door:changed', { id, open: rig.handle.open, locked });
  }

  setDoorAccess(id: string, access: CharacterId[] | 'all' | 'none'): void {
    const rig = this.doors.get(id);
    if (rig) rig.handle.access = access;
  }

  async setElevator(open: boolean, lit: boolean): Promise<void> {
    this.setCabLit(lit);
    const rig = this.doors.get('d_elevator');
    rig?.setLantern(open && lit);
    await this.setDoorOpen('d_elevator', open, true);
    if (!open) rig?.setLantern(false);
  }

  private setCabLit(lit: boolean): void {
    if (!this.cabLight) return;
    this.cabLight.emissiveIntensity = lit ? 1.6 : 0;
    this.cabLight.color.set(lit ? 0xdedad0 : 0x3a3a38);
  }

  private doorSfx(rig: DoorRig, phase: 'open' | 'close_start' | 'close_end'): void {
    const pos: Vec3 = { x: rig.def.pos.x, y: 1.1, z: rig.def.pos.z };
    const audio = this.s.audio;
    switch (rig.kind) {
      case 'elevator':
        if (phase !== 'close_end') audio.play('elevator_doors', { pos, volume: 0.7 });
        break;
      case 'sliding_glass':
        if (phase === 'open') audio.play('door_open', { pos, volume: 0.45, rate: 0.7 });
        else if (phase === 'close_end') audio.play('door_close', { pos, volume: 0.35, rate: 0.8 });
        break;
      case 'counter_gate':
        if (phase === 'open') audio.play('door_open', { pos, volume: 0.35, rate: 1.3 });
        else if (phase === 'close_end') audio.play('door_close', { pos, volume: 0.3, rate: 1.3 });
        break;
      default:
        if (phase === 'open') audio.play('door_open', { pos, volume: 0.6 });
        else if (phase === 'close_end') audio.play('door_close', { pos, volume: 0.6 });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Atmosphere
  // ---------------------------------------------------------------------------

  addFloorDecal(kind: 'footprints' | 'puddle' | 'scuff' | 'drag', points: Vec2[], opts: { fadeAfter?: number } = {}): () => void {
    if (!this.decals) return () => undefined;
    const room = points.length ? this.roomAt(points[0]) : null;
    return this.decals.add(kind, points, { fadeAfter: opts.fadeAfter, room: room ?? undefined });
  }

  setRain(intensity: number): void {
    this.rainIntensity = Math.max(0, Math.min(1, intensity));
    this.exterior?.setRain(this.rainIntensity);
  }

  /** Dawn sky for the ending (0..1). Lighting owns fog/ambient; this swaps the dome. */
  setDawn(amount: number): void {
    this.exterior?.setDawn(amount);
  }

  setRoomHaze(room: RoomId, amount: number): void {
    const a = Math.max(0, Math.min(1, amount));
    let h: Haze | null | undefined = this.haze.get(room);
    if (!h) {
      if (a <= 0.001) return;
      h = this.makeHaze(room);
      if (!h) return;
      this.haze.set(room, h);
    }
    h.mat.opacity = a * 0.085;
    h.group.visible = a > 0.001;
  }

  private makeHaze(room: RoomId): Haze | null {
    const rd = this.roomsById.get(room);
    const kit = this.kit;
    if (!rd || !kit) return null;
    const b = rd.bounds;
    const H = rd.outdoor ? 4 : rd.ceiling;
    const mat = kit.makeHaze();
    const group = new THREE.Group();
    group.name = `haze:${room}`;
    group.userData.room = room;
    const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const add = (g: THREE.BufferGeometry): void => {
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 3;
      m.userData.room = room;
      group.add(m);
    };
    add(hQuad(b.x0, b.x1, b.z0, b.z1, H * 0.38, true, 1, 1));
    add(hQuad(b.x0, b.x1, b.z0, b.z1, H * 0.72, true, 1, 1));
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    add(quad([b.x0, 0.05, cz], [b.x1, 0.05, cz], [b.x1, H - 0.05, cz], [b.x0, H - 0.05, cz], [0, 0, 1], uv));
    add(quad([cx, 0.05, b.z0], [cx, 0.05, b.z1], [cx, H - 0.05, b.z1], [cx, H - 0.05, b.z0], [1, 0, 0], uv));
    (this.groups.get(room) ?? this.root!).add(group);
    return { group, mat };
  }
}

export type { Opening };
