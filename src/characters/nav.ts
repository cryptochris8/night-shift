/**
 * Waypoint-graph navigation (A*). Pure TypeScript — no DOM, no three — so tests can import it.
 *
 * Door waypoints carry ids `d_<doorId>_a` / `d_<doorId>_b`; the edge between the two sides of
 * one door is the door crossing and is gated by `canUseDoor(doorId)`.
 */
import type { RoomId, Vec2, WaypointDef } from '../core/types';

const DOOR_NODE = /^d_(.+)_([ab])$/;

/** Door id encoded in a door waypoint id, or null for spine / room-centre nodes. */
export function doorIdOfNode(nodeId: string): string | null {
  const m = DOOR_NODE.exec(nodeId);
  return m ? m[1] : null;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const END = '__end__';

export class NavGraph {
  private readonly nodes = new Map<string, WaypointDef>();
  private readonly list: WaypointDef[];

  constructor(waypoints: WaypointDef[]) {
    this.list = waypoints.slice();
    for (const w of this.list) this.nodes.set(w.id, w);
  }

  get(id: string): WaypointDef | undefined {
    return this.nodes.get(id);
  }

  all(): readonly WaypointDef[] {
    return this.list;
  }

  /** Nearest waypoint to a point, optionally restricted to one room. */
  nearest(p: Vec2, room?: RoomId): WaypointDef | null {
    let best: WaypointDef | null = null;
    let bd = Infinity;
    for (const w of this.list) {
      if (room && w.room !== room) continue;
      const d = dist(w.pos, p);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** The k nearest waypoints, preferring those inside `room` when it has any. */
  private candidates(p: Vec2, room: RoomId | undefined, k: number): WaypointDef[] {
    let pool = room ? this.list.filter((w) => w.room === room) : this.list;
    if (pool.length === 0) pool = this.list;
    return pool
      .map((w) => ({ w, d: dist(w.pos, p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((x) => x.w);
  }

  /** Is the edge a→b the crossing of a door (both sides of the same door)? Returns the door id. */
  private crossingDoor(a: string, b: string): string | null {
    const da = doorIdOfNode(a);
    if (!da) return null;
    const db = doorIdOfNode(b);
    return da === db && a !== b ? da : null;
  }

  /**
   * Shortest path from `from` to `to` through the graph. Includes `from` and `to`.
   * Returns [] when no route exists under the door gating. Rooms are optional hints that keep the
   * entry/exit waypoints on the correct side of a wall and short-circuit same-room trips.
   */
  path(from: Vec2, to: Vec2, canUseDoor?: (doorId: string) => boolean, fromRoom?: RoomId, toRoom?: RoomId): Vec2[] {
    if (fromRoom && toRoom && fromRoom === toRoom) return [{ ...from }, { ...to }];
    if (this.list.length === 0) return [{ ...from }, { ...to }];

    const starts = this.candidates(from, fromRoom, 3);
    const goals = this.candidates(to, toRoom, 3);
    const goalCost = new Map<string, number>();
    for (const g of goals) goalCost.set(g.id, dist(g.pos, to));

    const gScore = new Map<string, number>();
    const cameFrom = new Map<string, string | null>();
    const closed = new Set<string>();
    const open: { id: string; f: number }[] = [];
    const h = (id: string): number => (id === END ? 0 : dist(this.nodes.get(id)!.pos, to));

    for (const s of starts) {
      const g = dist(from, s.pos);
      const prev = gScore.get(s.id);
      if (prev === undefined || g < prev) {
        gScore.set(s.id, g);
        cameFrom.set(s.id, null);
        open.push({ id: s.id, f: g + h(s.id) });
      }
    }

    let found = false;
    while (open.length) {
      // small graph: linear extraction is cheaper than a heap
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1];
      open.pop();
      if (closed.has(cur.id)) continue;
      closed.add(cur.id);
      if (cur.id === END) {
        found = true;
        break;
      }
      const node = this.nodes.get(cur.id)!;
      const g = gScore.get(cur.id)!;
      const relax = (nid: string, cost: number): void => {
        if (closed.has(nid)) return;
        const ng = g + cost;
        const old = gScore.get(nid);
        if (old !== undefined && ng >= old) return;
        gScore.set(nid, ng);
        cameFrom.set(nid, cur.id);
        open.push({ id: nid, f: ng + h(nid) });
      };
      for (const lid of node.links) {
        const nb = this.nodes.get(lid);
        if (!nb) continue;
        const door = this.crossingDoor(node.id, lid);
        if (door && canUseDoor && !canUseDoor(door)) continue;
        relax(lid, dist(node.pos, nb.pos));
      }
      const gc = goalCost.get(cur.id);
      if (gc !== undefined) relax(END, gc);
    }
    if (!found) return [];

    const ids: string[] = [];
    let cur: string | null = cameFrom.get(END) ?? null;
    while (cur) {
      ids.push(cur);
      cur = cameFrom.get(cur) ?? null;
    }
    ids.reverse();

    const out: Vec2[] = [{ ...from }];
    for (const id of ids) {
      const p = this.nodes.get(id)!.pos;
      const last = out[out.length - 1];
      if (dist(last, p) > 1e-6) out.push({ x: p.x, z: p.z });
    }
    if (dist(out[out.length - 1], to) > 1e-6) out.push({ ...to });
    else out[out.length - 1] = { ...to };
    return out;
  }

  /** Waypoint ids visited for a path (same gating), for callers that need the door crossings. */
  pathIds(from: Vec2, to: Vec2, canUseDoor?: (doorId: string) => boolean, fromRoom?: RoomId, toRoom?: RoomId): string[] {
    const pts = this.path(from, to, canUseDoor, fromRoom, toRoom);
    const ids: string[] = [];
    for (const p of pts) {
      for (const w of this.list) {
        if (Math.abs(w.pos.x - p.x) < 1e-6 && Math.abs(w.pos.z - p.z) < 1e-6) {
          ids.push(w.id);
          break;
        }
      }
    }
    return ids;
  }
}
