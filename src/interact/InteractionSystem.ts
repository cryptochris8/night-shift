/**
 * Interaction: what the possessed character is looking at, the HUD prompt for it, a faint
 * emissive pulse on the object, and the E / gamepad-A trigger. Works from the camera centre
 * only, so mouse, gamepad and touch all behave the same.
 */
import * as THREE from 'three';
import type { IInteractionSystem, Interactable, Services } from '../core/contracts';
import type { CharacterId, DoorDef } from '../core/types';
import { roomAt } from '../world/layout';
import {
  buildAdjacency,
  buildDoorIndex,
  denialPrompt,
  hasLineOfSight,
  noDoors,
  pairKey,
  type RoomAdjacency,
  type SightEnv,
} from './InteractionSystem.query';

const DEFAULT_REACH = 2.2;
/** loose interactables prompt within this cone of the view direction */
const LOOSE_DEG = 35;
/** aim assist for ordinary interactables: the ray may miss by this much */
const ASSIST_DEG_MOUSE = 6;
const ASSIST_DEG_PAD = 10;
const COOLDOWN_SECONDS = 0.25;
/** "Staff only" / "Locked" lingers this long after a refused door */
const NOTICE_SECONDS = 1.4;
/** a pending use() blocks re-triggering (and hides the prompt) for at most this long */
const BUSY_SECONDS = 2.5;
const RAY_NEAR = 0.05;
const DEG = Math.PI / 180;
const HIGHLIGHT_TINT = new THREE.Color(0xbfe9cc);

interface Candidate {
  i: Interactable;
  /** 0 = the ray hits the object, 1 = loose / aim-assisted */
  tier: 0 | 1;
  /** lower is better within a tier */
  score: number;
  px: number;
  py: number;
  pz: number;
  mesh: THREE.Mesh | null;
  text: string | null;
}

interface HighlightEntry {
  mesh: THREE.Mesh;
  /** index into a material array, -1 for a single material */
  slot: number;
  original: THREE.MeshStandardMaterial;
  clone: THREE.MeshStandardMaterial;
  base: THREE.Color;
  baseIntensity: number;
  amount: number;
  active: boolean;
}

function isMesh(o: THREE.Object3D): o is THREE.Mesh {
  return (o as THREE.Mesh).isMesh === true;
}

function isStandard(m: THREE.Material | undefined | null): m is THREE.MeshStandardMaterial {
  return !!m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
}

function materialAt(mesh: THREE.Mesh, slot: number): THREE.Material | undefined {
  return Array.isArray(mesh.material) ? mesh.material[slot] : mesh.material;
}

function setMaterialAt(mesh: THREE.Mesh, slot: number, m: THREE.Material): void {
  if (Array.isArray(mesh.material)) mesh.material[slot] = m;
  else mesh.material = m;
}

/** Screens and glow panels are swapped by other systems; pulse the casing instead. */
function screenLike(m: THREE.MeshStandardMaterial): boolean {
  if (m.emissiveMap) return true;
  return m.emissiveIntensity > 0 && m.emissive.r + m.emissive.g + m.emissive.b > 0.15;
}

function glassLike(m: THREE.MeshStandardMaterial): boolean {
  if (m.transparent && m.opacity < 0.6) return true;
  return ((m as THREE.MeshPhysicalMaterial).transmission ?? 0) > 0.2;
}

function visibleChain(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function attachedTo(o: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let depth = 0;
  for (let p: THREE.Object3D | null = o; p && depth < 12; p = p.parent, depth++) if (p === ancestor) return true;
  return false;
}

function safePrompt(i: Interactable, c: CharacterId): string | null {
  try {
    const t = i.prompt(c);
    return typeof t === 'string' && t.length > 0 ? t : null;
  } catch (err) {
    console.error('[interact] prompt() threw for', i.id, err);
    return null;
  }
}

export class InteractionSystem implements IInteractionSystem {
  private s!: Services;
  private items = new Map<string, Interactable>();
  private enabled = true;
  private target: Interactable | null = null;
  private targetEntry: HighlightEntry | null = null;
  private reacquireAt = 0;

  private adjacency: RoomAdjacency = new Map();
  private doorIndex = new Map<string, DoorDef[]>();
  private doorById = new Map<string, DoorDef>();
  private sight!: SightEnv;

  // scratch — allocated once, reused every frame
  private readonly raycaster = new THREE.Raycaster();
  private readonly hits: THREE.Intersection[] = [];
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly box = new THREE.Box3();
  private readonly nearPt = new THREE.Vector3();
  private readonly centerPt = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private readonly pool: Candidate[] = [];
  private poolUsed = 0;
  private readonly order: Candidate[] = [];

  private entries = new WeakMap<THREE.Mesh, HighlightEntry>();
  private allEntries: HighlightEntry[] = [];
  private fx: HighlightEntry[] = [];

  private shownPrompt: string | null = null;
  private time = 0;
  private cooldown = 0;
  private flash = 0;
  private noticeText: string | null = null;
  private noticeTimer = 0;
  private pending: Promise<void> | null = null;
  private pendingSince = 0;
  private offs: (() => void)[] = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  init(services: Services): void {
    this.s = services;
    const doors = services.layout.doors;
    this.adjacency = buildAdjacency(doors);
    this.doorIndex = buildDoorIndex(doors);
    this.doorById = new Map(doors.map((d) => [d.id, d]));
    this.sight = {
      rooms: services.layout.rooms,
      wall: services.layout.wallThickness,
      doorsBetween: (a, b) => this.doorIndex.get(pairKey(a, b)) ?? noDoors(),
      passable: (d) => {
        // archways and the waist-high counter gate never block a reach
        if (d.kind === 'open' || d.kind === 'counter_gate') return true;
        const h = this.s.world.getDoor(d.id);
        return h ? h.open : true;
      },
    };
    this.raycaster.layers.enableAll();
    this.raycaster.near = RAY_NEAR;
    this.offs.push(services.bus.on('door:denied', ({ id, by }) => this.onDoorDenied(id, by)));
    this.offs.push(services.bus.on('game:new', () => this.pruneDeadEntries()));
  }

  update(dt: number, _gdt: number): void {
    const s = this.s;
    if (!s) return;
    this.time += dt;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.noticeTimer > 0) this.noticeTimer = Math.max(0, this.noticeTimer - dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);

    const active = s.characters.active;
    const st = s.store.get();
    const live =
      this.enabled &&
      active !== null &&
      st.screen === 'playing' &&
      !st.paused &&
      !st.inputLocked &&
      !s.ui.modalOpen &&
      !s.cinematic.playing;

    if (!live) {
      this.setTarget(null, null);
      this.noticeTimer = 0;
      this.publish(null);
      this.animateHighlights(dt);
      return;
    }

    const pick = this.scan(active);
    this.setTarget(pick ? pick.i : null, pick ? pick.mesh : null);

    let text: string | null = pick ? pick.text : null;
    if (this.noticeTimer > 0 && this.noticeText) text = this.noticeText;
    else if (this.busy()) text = null;
    this.publish(text);
    this.animateHighlights(dt);
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.setTarget(null, null);
    for (const e of this.allEntries) {
      e.clone.emissive.copy(e.base);
      e.clone.emissiveIntensity = e.baseIntensity;
      if (materialAt(e.mesh, e.slot) === e.clone) setMaterialAt(e.mesh, e.slot, e.original);
      e.clone.dispose();
    }
    this.allEntries = [];
    this.fx = [];
    this.entries = new WeakMap();
    this.items.clear();
    this.publish(null);
  }

  // ---------------------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------------------

  register(i: Interactable): void {
    if (!i || !i.id || !i.object) return;
    const prev = this.items.get(i.id);
    if (prev && prev === this.target) this.setTarget(null, null);
    this.items.set(i.id, i);
  }

  unregister(id: string): void {
    const i = this.items.get(id);
    if (!i) return;
    if (this.target === i) {
      this.setTarget(null, null);
      this.publish(null);
    }
    this.items.delete(id);
  }

  get(id: string): Interactable | undefined {
    return this.items.get(id);
  }

  current(): Interactable | null {
    return this.target;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.setTarget(null, null);
      this.publish(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger
  // ---------------------------------------------------------------------------

  async trigger(): Promise<void> {
    const s = this.s;
    if (!s || !this.enabled) return;
    const c = s.characters.active;
    if (!c) return;
    const st = s.store.get();
    if (st.screen !== 'playing' || st.paused || st.inputLocked || s.ui.modalOpen || s.cinematic.playing) return;
    if (this.cooldown > 0 || this.busy()) return;
    const i = this.target;
    if (!i || i.enabled === false || !i.object.parent) return;
    if (safePrompt(i, c) === null) return;

    this.cooldown = COOLDOWN_SECONDS;
    this.flash = 1;
    s.audio.play('ui_select', { nonSpatial: true, volume: 0.22 });

    const run = (async () => {
      try {
        await i.use(c);
      } catch (err) {
        console.error('[interact] use() failed for', i.id, err);
      }
    })();
    this.pending = run;
    this.pendingSince = this.time;
    try {
      await run;
    } finally {
      if (this.pending === run) this.pending = null;
    }
    s.bus.emit('interact:used', { id: i.id, by: c });
  }

  /** A use() is still running and recent enough that we should not stack another on it. */
  private busy(): boolean {
    return this.pending !== null && this.time - this.pendingSince < BUSY_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Targeting
  // ---------------------------------------------------------------------------

  private scan(c: CharacterId): Candidate | null {
    const s = this.s;
    const cam = s.characters.camera;
    cam.getWorldPosition(this.camPos);
    cam.getWorldDirection(this.camDir);
    this.raycaster.set(this.camPos, this.camDir);
    this.raycaster.camera = cam;

    // Only rooms the character is in (by state and by geometry — doorways disagree) or next to.
    const r1 = s.characters.roomOf(c);
    const r2 = roomAt({ x: this.camPos.x, z: this.camPos.z }, s.layout.rooms);
    const a1 = this.adjacency.get(r1);
    const a2 = r2 ? this.adjacency.get(r2) : undefined;

    const reachRaw = s.characters.reach;
    const reach = Number.isFinite(reachRaw) && reachRaw > 0 ? reachRaw : DEFAULT_REACH;
    const assistDeg = s.input.lastDeviceWasGamepad || s.input.isTouch ? ASSIST_DEG_PAD : ASSIST_DEG_MOUSE;

    this.poolUsed = 0;
    for (const i of this.items.values()) {
      if (i.enabled === false) continue;
      const obj = i.object;
      if (!obj || !obj.parent) continue;

      const room = i.room;
      const nearby = room === r1 || room === r2 || (a1 !== undefined && a1.has(room)) || (a2 !== undefined && a2.has(room));
      // things carried by the character (John's phone) live wherever the camera is
      const attached = attachedTo(obj, cam);
      if (!nearby && !attached) continue;

      const radius = typeof i.radius === 'number' && i.radius > 0 ? i.radius : reach;

      this.box.setFromObject(obj);
      const empty = this.box.isEmpty();
      if (empty) {
        obj.getWorldPosition(this.nearPt);
        this.centerPt.copy(this.nearPt);
      } else {
        this.box.clampPoint(this.camPos, this.nearPt);
        this.box.getCenter(this.centerPt);
      }
      const dist = this.nearPt.distanceTo(this.camPos);
      if (dist > radius) continue;

      // Tier 0: the crosshair is on it.
      if (!attached) {
        this.raycaster.far = radius + 0.05;
        this.hits.length = 0;
        this.raycaster.intersectObject(obj, true, this.hits);
        let hit: THREE.Intersection | null = null;
        for (const h of this.hits) {
          if (h.distance > radius) break;
          if (h.object.userData.noInteract === true) continue;
          if (!visibleChain(h.object)) continue;
          hit = h;
          break;
        }
        if (hit) {
          this.pushCandidate(i, 0, hit.distance, hit.point, isMesh(hit.object) ? hit.object : null);
          continue;
        }
      }

      // Tier 1: near enough and roughly in front (loose objects, or a near miss for aim assist).
      let angle: number;
      if (attached || dist < 0.08) {
        angle = 0;
      } else {
        const onBox = empty ? null : this.raycaster.ray.intersectBox(this.box, this.tmp);
        if (onBox !== null && this.tmp.distanceTo(this.camPos) <= radius + 0.5) angle = 0;
        else angle = Math.min(this.angleTo(this.nearPt), this.angleTo(this.centerPt));
      }
      const limit = i.loose ? LOOSE_DEG : assistDeg;
      if (angle > limit) continue;
      // carried items rank after anything actually in the world
      const score = angle / limit + 0.35 * (dist / radius) + (attached ? 10 : 0);
      this.pushCandidate(i, 1, score, this.nearPt, null);
    }

    if (this.poolUsed === 0) return null;
    this.order.length = 0;
    for (let k = 0; k < this.poolUsed; k++) this.order.push(this.pool[k]);
    if (this.order.length > 1) this.order.sort((a, b) => a.tier - b.tier || a.score - b.score);

    for (const cand of this.order) {
      this.tmp.set(cand.px, cand.py, cand.pz);
      if (!hasLineOfSight(this.sight, this.camPos, this.tmp)) continue;
      const text = safePrompt(cand.i, c);
      if (text === null) continue;
      cand.text = text;
      return cand;
    }
    return null;
  }

  private pushCandidate(i: Interactable, tier: 0 | 1, score: number, p: THREE.Vector3, mesh: THREE.Mesh | null): void {
    let rec = this.pool[this.poolUsed];
    if (!rec) {
      rec = { i, tier, score, px: 0, py: 0, pz: 0, mesh: null, text: null };
      this.pool.push(rec);
    }
    rec.i = i;
    rec.tier = tier;
    rec.score = score;
    rec.px = p.x;
    rec.py = p.y;
    rec.pz = p.z;
    rec.mesh = mesh;
    rec.text = null;
    this.poolUsed++;
  }

  /** Degrees between the view direction and a world point. */
  private angleTo(p: THREE.Vector3): number {
    this.tmp.subVectors(p, this.camPos);
    const len = this.tmp.length();
    if (len < 1e-4) return 0;
    const cos = Math.max(-1, Math.min(1, this.tmp.dot(this.camDir) / len));
    return Math.acos(cos) / DEG;
  }

  private publish(text: string | null): void {
    if (!this.s || text === this.shownPrompt) return;
    this.shownPrompt = text;
    this.s.ui.setPrompt(text);
  }

  private onDoorDenied(id: string, by: CharacterId): void {
    const active = this.s.characters.active;
    if (!active || by !== active) return;
    const def = this.doorById.get(id);
    const live = this.s.world.getDoor(id);
    this.noticeText = denialPrompt(def, live ? { locked: live.locked, access: live.access } : undefined);
    this.noticeTimer = NOTICE_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // Highlight
  // ---------------------------------------------------------------------------

  private setTarget(i: Interactable | null, mesh: THREE.Mesh | null): void {
    if (i === this.target) {
      // the object may have gained geometry (or a material we can use) since we first looked
      if (i && !this.targetEntry && this.time >= this.reacquireAt) {
        this.reacquireAt = this.time + 0.5;
        this.highlightOn(i, mesh);
      }
      return;
    }
    if (this.targetEntry) {
      this.targetEntry.active = false;
      this.targetEntry = null;
    }
    this.target = i;
    if (i) this.highlightOn(i, mesh);
  }

  private highlightOn(i: Interactable, hitMesh: THREE.Mesh | null): void {
    const e = this.acquireEntry(i.object, hitMesh);
    if (!e) return;
    e.active = true;
    if (!this.fx.includes(e)) this.fx.push(e);
    this.targetEntry = e;
  }

  /** The mesh/material slot that will carry the pulse for an object. */
  private pickSlot(root: THREE.Object3D, hitMesh: THREE.Mesh | null): { mesh: THREE.Mesh; slot: number } | null {
    let firstPlain: { mesh: THREE.Mesh; slot: number } | null = null;
    let firstAny: { mesh: THREE.Mesh; slot: number } | null = null;
    const consider = (mesh: THREE.Mesh): void => {
      if (mesh.userData.noInteract === true) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : null;
      const count = mats ? mats.length : 1;
      for (let k = 0; k < count; k++) {
        const m = mats ? mats[k] : (mesh.material as THREE.Material);
        if (!isStandard(m)) continue;
        const slot = mats ? k : -1;
        if (!firstAny) firstAny = { mesh, slot };
        if (!firstPlain && !screenLike(m) && !glassLike(m)) firstPlain = { mesh, slot };
      }
    };
    if (hitMesh && hitMesh.visible) {
      consider(hitMesh);
      if (firstPlain) return firstPlain;
    }
    root.traverse((o) => {
      if (firstPlain || o === hitMesh) return;
      if (isMesh(o) && visibleChain(o)) consider(o);
    });
    return firstPlain ?? firstAny;
  }

  private acquireEntry(root: THREE.Object3D, hitMesh: THREE.Mesh | null): HighlightEntry | null {
    const pick = this.pickSlot(root, hitMesh);
    if (!pick) return null;
    const { mesh, slot } = pick;
    const current = materialAt(mesh, slot);
    if (!isStandard(current)) return null;

    let e = this.entries.get(mesh);
    if (e && e.slot === slot && current === e.clone) {
      // idle clone: re-read the resting emissive so external tweaks are preserved
      if (!e.active && e.amount <= 0) {
        e.base.copy(e.clone.emissive);
        e.baseIntensity = e.clone.emissiveIntensity;
      }
      return e;
    }
    if (e) this.dropEntry(e);

    // One private copy per highlighted mesh so shared materials don't light every instance.
    const clone = current.clone();
    clone.onBeforeCompile = current.onBeforeCompile;
    clone.customProgramCacheKey = current.customProgramCacheKey;
    setMaterialAt(mesh, slot, clone);
    e = {
      mesh,
      slot,
      original: current,
      clone,
      base: clone.emissive.clone(),
      baseIntensity: clone.emissiveIntensity,
      amount: 0,
      active: false,
    };
    this.entries.set(mesh, e);
    this.allEntries.push(e);
    return e;
  }

  private dropEntry(e: HighlightEntry): void {
    e.active = false;
    e.amount = 0;
    e.clone.emissive.copy(e.base);
    e.clone.emissiveIntensity = e.baseIntensity;
    const k = this.fx.indexOf(e);
    if (k >= 0) this.fx.splice(k, 1);
    const j = this.allEntries.indexOf(e);
    if (j >= 0) this.allEntries.splice(j, 1);
    if (this.entries.get(e.mesh) === e) this.entries.delete(e.mesh);
    if (this.targetEntry === e) this.targetEntry = null;
  }

  private pruneDeadEntries(): void {
    for (const e of this.allEntries.slice()) {
      if (!e.mesh.parent || materialAt(e.mesh, e.slot) !== e.clone) this.dropEntry(e);
    }
  }

  private animateHighlights(dt: number): void {
    if (this.fx.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * Math.PI * 2 * 0.8);
    for (let k = this.fx.length - 1; k >= 0; k--) {
      const e = this.fx[k];
      const alive = e.mesh.parent !== null && materialAt(e.mesh, e.slot) === e.clone;
      const goal = e.active && alive ? 1 : 0;
      e.amount += (goal - e.amount) * Math.min(1, dt * (goal > e.amount ? 12 : 7));
      if (!alive) {
        this.dropEntry(e);
        continue;
      }
      if (goal === 0 && e.amount < 0.01) {
        e.amount = 0;
        e.clone.emissive.copy(e.base);
        e.clone.emissiveIntensity = e.baseIntensity;
        this.fx.splice(k, 1);
        continue;
      }
      // faint cool sheen, breathing slowly; a short lift when E is pressed
      const intensity = e.baseIntensity > 0 ? e.baseIntensity : 1;
      const lift = e.amount * (0.07 + 0.06 * pulse + 0.16 * this.flash);
      this.tmpColor.copy(HIGHLIGHT_TINT).multiplyScalar(lift / intensity);
      e.clone.emissive.copy(e.base).add(this.tmpColor);
      e.clone.emissiveIntensity = intensity;
    }
  }
}
