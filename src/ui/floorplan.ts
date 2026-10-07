/**
 * SVG floor plan generated from the layout: outlined rooms with short names, door gaps,
 * camera wedges and character dots. Styled as a security-console site map — thin lines,
 * phosphor accents, nothing decorative. Updated per frame while the switcher is open.
 */
import type { CameraDef, CharacterId, DoorDef, GameState, HospitalLayout, RoomDef, RoomId, ViewId } from '../core/types';
import { CHARACTER_IDS } from '../core/types';
import { initialOf } from './switcher.portraits';

const NS = 'http://www.w3.org/2000/svg';
/** svg units per metre */
const S = 10;
/** the ambulance bay is enormous; show only the slice next to the building */
const EXTERIOR_CLIP_X0 = -26.5;

export interface FloorPlanExtras {
  camerasOnline: Record<string, boolean>;
  litRooms: Partial<Record<RoomId, number>>;
  /** optional warning levels from the switcher (merged with character danger) */
  warnings?: Partial<Record<CharacterId, number>>;
}

interface RoomEl { rect: SVGRectElement; label: SVGTextElement; def: RoomDef }
interface DoorEl { gap: SVGRectElement; leaf: SVGElement | null; def: DoorDef }
interface CamEl { g: SVGGElement; def: CameraDef }
interface CharEl { g: SVGGElement; ring: SVGCircleElement; dot: SVGCircleElement; cone: SVGPathElement; text: SVGTextElement }

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, cls?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (cls) e.setAttribute('class', cls);
  return e;
}

function roomRect(def: RoomDef): { x0: number; x1: number; z0: number; z1: number } {
  const b = def.bounds;
  return def.outdoor ? { x0: Math.max(b.x0, EXTERIOR_CLIP_X0), x1: b.x1, z0: b.z0, z1: b.z1 } : { ...b };
}

function canEnter(access: CharacterId[] | 'all' | 'none', who: CharacterId): boolean {
  if (access === 'all') return true;
  if (access === 'none') return false;
  return access.includes(who);
}

export class FloorPlan {
  private svg: SVGSVGElement;
  private rooms = new Map<RoomId, RoomEl>();
  private doors = new Map<string, DoorEl>();
  private cams = new Map<string, CamEl>();
  private chars: Record<CharacterId, CharEl>;
  private selection: ViewId | null = null;
  private pick: ((view: ViewId) => void) | null = null;
  private lastActive: ViewId | null = null;
  private disposed = false;

  constructor(private readonly layout: HospitalLayout, private readonly container: HTMLElement) {
    const vis = layout.rooms.map(roomRect);
    const pad = 1.4;
    const minX = Math.min(...vis.map((r) => r.x0)) - pad;
    const maxX = Math.max(...vis.map((r) => r.x1)) + pad;
    const minZ = Math.min(...vis.map((r) => r.z0)) - pad;
    const maxZ = Math.max(...vis.map((r) => r.z1)) + pad;

    this.svg = el('svg', {
      viewBox: `${minX * S} ${-maxZ * S} ${(maxX - minX) * S} ${(maxZ - minZ) * S}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': 'Floor plan',
    }, 'ns-fp');

    const gRooms = el('g', {}, 'ns-fp__rooms');
    const gDoors = el('g', {}, 'ns-fp__doors');
    const gCams = el('g', {}, 'ns-fp__cams');
    const gChars = el('g', {}, 'ns-fp__chars');
    const gDeco = el('g', {}, 'ns-fp__deco');
    this.svg.append(gRooms, gDoors, gCams, gChars, gDeco);

    for (const def of layout.rooms) this.buildRoom(def, gRooms);
    for (const def of layout.doors) this.buildDoor(def, gDoors);
    for (const def of layout.cameras) this.buildCamera(def, gCams);
    this.chars = {
      john: this.buildCharacter('john', gChars),
      susie: this.buildCharacter('susie', gChars),
      paul: this.buildCharacter('paul', gChars),
    };
    this.buildDecorations(gDeco, minX, maxX, minZ, maxZ);
    container.appendChild(this.svg);
  }

  /** Clicking a character dot or a camera wedge selects that view. */
  onPick(fn: (view: ViewId) => void): void {
    this.pick = fn;
  }

  // ---------------------------------------------------------------------------

  private buildRoom(def: RoomDef, parent: SVGGElement): void {
    const r = roomRect(def);
    const w = (r.x1 - r.x0) * S;
    const h = (r.z1 - r.z0) * S;
    const rect = el('rect', { x: r.x0 * S, y: -r.z1 * S, width: w, height: h }, `ns-fp__room${def.outdoor ? ' ns-fp__room--outdoor' : ''}${def.tags?.includes('closed') ? ' ns-fp__room--closed' : ''}`);
    const cx = (r.x0 + r.x1) / 2 * S;
    const cy = -(r.z0 + r.z1) / 2 * S;
    const label = el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'ns-fp__label');
    label.textContent = def.shortName.toUpperCase();
    // fit the label: shrink, and turn it sideways in tall narrow rooms
    const chars = def.shortName.length;
    const rotate = h > w * 1.3 && w < 30;
    const avail = (rotate ? h : w) * 0.88;
    const fs = Math.max(4.2, Math.min(7.2, avail / (chars * 0.62)));
    label.setAttribute('font-size', fs.toFixed(2));
    if (rotate) label.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    parent.append(rect, label);
    this.rooms.set(def.id, { rect, label, def });
  }

  private buildDoor(def: DoorDef, parent: SVGGElement): void {
    const half = def.width / 2;
    const t = 0.36; // covers both wall strokes either side of the 0.2 m gap
    const gapAttrs = def.axis === 'x'
      ? { x: (def.pos.x - half) * S, y: -(def.pos.z + t) * S, width: def.width * S, height: 2 * t * S }
      : { x: (def.pos.x - t) * S, y: -(def.pos.z + half) * S, width: 2 * t * S, height: def.width * S };
    const gap = el('rect', gapAttrs, 'ns-fp__gap');
    parent.appendChild(gap);
    let leaf: SVGElement | null = null;
    if (def.kind !== 'open') {
      const cls = `ns-fp__leaf ns-fp__leaf--${def.kind}${def.locked ? ' ns-fp__leaf--locked' : ''}`;
      if (def.kind === 'elevator' || def.kind === 'double' || def.kind === 'sliding_glass') {
        // two leaves with a centre break
        const g = el('g', {}, cls);
        const seg = (a: number, b: number): SVGLineElement => def.axis === 'x'
          ? el('line', { x1: (def.pos.x + a) * S, y1: -def.pos.z * S, x2: (def.pos.x + b) * S, y2: -def.pos.z * S })
          : el('line', { x1: def.pos.x * S, y1: -(def.pos.z + a) * S, x2: def.pos.x * S, y2: -(def.pos.z + b) * S });
        g.append(seg(-half, -0.08), seg(0.08, half));
        parent.appendChild(g);
        leaf = g;
      } else {
        // single leaf drawn ajar: a short stroke angled into the room it opens into
        const line = def.axis === 'x'
          ? el('line', { x1: (def.pos.x - half) * S, y1: -def.pos.z * S, x2: (def.pos.x + half * 0.55) * S, y2: -(def.pos.z + half * 0.8) * S })
          : el('line', { x1: def.pos.x * S, y1: -(def.pos.z - half) * S, x2: (def.pos.x + half * 0.8) * S, y2: -(def.pos.z + half * 0.55) * S });
        line.setAttribute('class', cls);
        parent.appendChild(line);
        leaf = line;
      }
    }
    this.doors.set(def.id, { gap, leaf, def });
  }

  private buildCamera(def: CameraDef, parent: SVGGElement): void {
    const dx = def.lookAt.x - def.pos.x;
    const dz = def.lookAt.z - def.pos.z;
    const ang = Math.atan2(-dz, dx); // svg y is -z
    const halfA = (def.fov * Math.PI / 180) * 0.36;
    const len = 2.6 * S;
    const px = def.pos.x * S;
    const py = -def.pos.z * S;
    const ax = px + Math.cos(ang - halfA) * len;
    const ay = py + Math.sin(ang - halfA) * len;
    const bx = px + Math.cos(ang + halfA) * len;
    const by = py + Math.sin(ang + halfA) * len;
    const g = el('g', {}, 'ns-fp__cam');
    const wedge = el('path', { d: `M${px} ${py} L${ax.toFixed(1)} ${ay.toFixed(1)} A${len} ${len} 0 0 1 ${bx.toFixed(1)} ${by.toFixed(1)}Z` }, 'ns-fp__wedge');
    const body = el('rect', { x: px - 1.8, y: py - 1.8, width: 3.6, height: 3.6, transform: `rotate(${(ang * 180 / Math.PI).toFixed(1)} ${px} ${py})` }, 'ns-fp__cambody');
    const num = def.name.match(/CAM\s*(\d+)/i)?.[1] ?? def.id.slice(-2);
    // label sits behind the camera, away from its view
    const lx = px - Math.cos(ang) * 4.5;
    const ly = py - Math.sin(ang) * 4.5;
    const label = el('text', { x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'ns-fp__camlabel');
    label.textContent = num;
    const slash = el('line', { x1: px - 3, y1: py + 3, x2: px + 3, y2: py - 3 }, 'ns-fp__camslash');
    g.append(wedge, body, slash, label);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pick?.('cctv');
    });
    parent.appendChild(g);
    this.cams.set(def.id, { g, def });
  }

  private buildCharacter(id: CharacterId, parent: SVGGElement): CharEl {
    const g = el('g', {}, `ns-fp__char ns-fp__char--${id}`);
    const ring = el('circle', { cx: 0, cy: 0, r: 7.5 }, 'ns-fp__ring');
    const cone = el('path', { d: 'M0 0 L-5.5 -11 A12 12 0 0 1 5.5 -11Z' }, 'ns-fp__cone');
    const dot = el('circle', { cx: 0, cy: 0, r: 4.6 }, 'ns-fp__dot');
    const text = el('text', { x: 0, y: 0.3, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'ns-fp__initial');
    text.textContent = initialOf(id);
    const hit = el('circle', { cx: 0, cy: 0, r: 9 }, 'ns-fp__hit');
    g.append(ring, cone, dot, text, hit);
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pick?.(id);
    });
    parent.appendChild(g);
    return { g, ring, dot, cone, text };
  }

  private buildDecorations(parent: SVGGElement, minX: number, maxX: number, minZ: number, maxZ: number): void {
    // north arrow (top right) and a 5 m scale bar (bottom left)
    const nx = maxX * S - 6;
    const ny = -maxZ * S + 9;
    const north = el('g', {}, 'ns-fp__north');
    north.append(
      el('path', { d: `M${nx} ${ny - 6} L${nx - 2.4} ${ny + 1} L${nx} ${ny - 0.6} L${nx + 2.4} ${ny + 1}Z` }),
      Object.assign(el('text', { x: nx, y: ny + 5.6, 'text-anchor': 'middle', 'font-size': 4.2 }), { textContent: 'N' }),
    );
    const sx = minX * S + 4;
    const sy = -minZ * S - 5;
    const scale = el('g', {}, 'ns-fp__scale');
    scale.append(
      el('line', { x1: sx, y1: sy, x2: sx + 5 * S, y2: sy }),
      el('line', { x1: sx, y1: sy - 1.6, x2: sx, y2: sy + 1.6 }),
      el('line', { x1: sx + 5 * S, y1: sy - 1.6, x2: sx + 5 * S, y2: sy + 1.6 }),
      Object.assign(el('text', { x: sx + 2.5 * S, y: sy - 2.4, 'text-anchor': 'middle', 'font-size': 3.8 }), { textContent: '5 m' }),
    );
    parent.append(north, scale);
  }

  // ---------------------------------------------------------------------------

  update(state: Readonly<GameState>, extras: FloorPlanExtras): void {
    if (this.disposed) return;
    const active = state.activeView;
    const who: CharacterId | null = active === 'cctv' ? null : active;
    const selChar: CharacterId | null = this.selection && this.selection !== 'cctv' ? this.selection : null;
    const selRoom = selChar ? state.characters[selChar].location : null;

    if (this.lastActive !== active) {
      this.lastActive = active;
      this.svg.classList.toggle('ns-fp--cctv', active === 'cctv');
    }
    this.svg.classList.toggle('ns-fp--sel-cctv', this.selection === 'cctv');

    for (const { rect, label, def } of this.rooms.values()) {
      const inside = who ? state.characters[who].location === def.id : false;
      const accessible = !who || inside || def.access.includes(who);
      const litRaw = extras.litRooms[def.id];
      const lit = litRaw === undefined ? (def.lit ? 0.85 : 0.1) : Math.max(0, Math.min(1, litRaw));
      rect.classList.toggle('is-dim', !accessible);
      rect.classList.toggle('is-dark', lit < 0.3);
      rect.classList.toggle('is-selected', def.id === selRoom);
      rect.classList.toggle('is-here', inside);
      rect.style.fillOpacity = (0.035 + 0.11 * lit).toFixed(3);
      label.classList.toggle('is-dim', !accessible || lit < 0.3);
    }

    for (const { leaf, def } of this.doors.values()) {
      if (!leaf) continue;
      const passable = !who || canEnter(def.access, who);
      leaf.classList.toggle('is-dim', !passable);
    }

    for (const { g, def } of this.cams.values()) {
      const online = extras.camerasOnline[def.id] ?? true;
      g.classList.toggle('is-offline', !online);
      g.classList.toggle('is-active', active === 'cctv' && state.activeCamera === def.id);
    }

    for (const id of CHARACTER_IDS) {
      const c = state.characters[id];
      const e = this.chars[id];
      const x = c.position.x * S;
      const y = -c.position.z * S;
      e.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
      // cone follows yaw: forward = (-sin yaw, -cos yaw) in world → svg angle from -y axis
      const deg = (-c.yaw * 180 / Math.PI);
      e.cone.setAttribute('transform', `rotate(${deg.toFixed(1)})`);
      const isActive = who === id;
      e.g.classList.toggle('is-active', isActive);
      e.g.classList.toggle('is-selected', this.selection === id);
      e.g.classList.toggle('is-missing', c.missing);
      const level = Math.max(c.missing ? 0 : c.danger, extras.warnings?.[id] ?? 0);
      const warn = !c.missing && level > 0.18;
      e.g.classList.toggle('is-warn', warn);
      if (warn) e.ring.style.setProperty('--pulse', `${(1.9 - 1.4 * Math.min(1, level)).toFixed(2)}s`);
    }
  }

  setSelection(view: ViewId | null): void {
    this.selection = view;
  }

  dispose(): void {
    this.disposed = true;
    this.svg.remove();
    this.rooms.clear();
    this.doors.clear();
    this.cams.clear();
    this.pick = null;
    void this.container;
    void this.layout;
  }
}
