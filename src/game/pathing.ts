// Terrain-aware navigation: A* on the spherical grid and path following.

import type { Living, TerrainCell, WorldState } from './types';
import { neighbors, cellDistance, landmassOf } from './world';

export function isPassable(c: TerrainCell): boolean {
  return c.type !== 'deepOcean' && c.type !== 'shallowOcean';
}

type HeapItem = [number, number];
function heapPush(h: HeapItem[], item: HeapItem) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function heapPop(h: HeapItem[]): HeapItem {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}

/** A* over land cells. Returns the cells to walk through (excluding start, including goal), or null. */
export function findPath(cells: TerrainCell[], start: number, goal: number, maxNodes = 900): number[] | null {
  if (start === goal) return [];
  if (!isPassable(cells[goal]) || !isPassable(cells[start])) return null;
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  const closed = new Set<number>();
  const heap: HeapItem[] = [];
  heapPush(heap, [cellDistance(start, goal, cells), start]);
  let expanded = 0;
  while (heap.length) {
    const [, cur] = heapPop(heap);
    if (closed.has(cur)) continue;
    closed.add(cur);
    if (cur === goal) {
      const path: number[] = [];
      let node = goal;
      while (node !== start) { path.push(node); node = came.get(node)!; }
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    const gc = g.get(cur)!;
    for (const n of neighbors(cur, cells)) {
      const cell = cells[n];
      if (closed.has(n) || !isPassable(cell)) continue;
      const cost = cell.type === 'mountain' ? 3 : cell.type === 'forest' ? 1.4 : 1;
      const ng = gc + cost;
      if (ng < (g.get(n) ?? Infinity)) {
        g.set(n, ng);
        came.set(n, cur);
        heapPush(heap, [ng + cellDistance(n, goal, cells), n]);
      }
    }
  }
  return null;
}

export type RouteResult = 'ok' | 'none' | 'budget';
const routes = new WeakMap<WorldState, { rev: number; cache: Map<string, { path: number[] | null; until: number }> }>();

/** Assign a path to `goal`. Limited by the per-tick path budget so large populations stay cheap. */
export function routeTo(s: WorldState, e: Living, goal: number): RouteResult {
  const from = e.targetCellId ?? e.cellId;
  if (from === goal) { e.path = []; e.goal = goal; return 'ok'; }
  if (landmassOf(s, from) !== landmassOf(s, goal)) return 'none';
  let routesForWorld = routes.get(s);
  if (!routesForWorld || routesForWorld.rev !== s.terrainRev) {
    routesForWorld = { rev: s.terrainRev, cache: new Map() }; routes.set(s, routesForWorld);
  }
  const key = `${from}:${goal}`, cached = routesForWorld.cache.get(key);
  if (cached && cached.until >= s.day) {
    if (!cached.path) return 'none';
    e.path = cached.path.slice(); e.goal = goal; return 'ok';
  }
  if (s.pathBudget <= 0) return 'budget';
  s.pathBudget--;
  const p = findPath(s.cells, from, goal, Math.min(s.cells.length, 3000));
  if (routesForWorld.cache.size >= 1200) routesForWorld.cache.delete(routesForWorld.cache.keys().next().value!);
  routesForWorld.cache.set(key, { path: p ? p.slice() : null, until: s.day + .25 });
  if (!p) return 'none';
  e.path = p;
  e.goal = goal;
  return 'ok';
}

/** Advance along the current path. Returns true while still travelling. */
export function moveEntity(s: WorldState, e: Living, dtHours: number, cellsPerHour: number): boolean {
  let budget = dtHours * cellsPerHour;
  let guard = 0;
  while (budget > 0 && guard++ < 4) {
    if (e.targetCellId === null) {
      if (e.path.length === 0) return false;
      const next = e.path.shift()!;
      const nc = s.cells[next];
      if (!nc || !isPassable(nc)) { e.path = []; return false; }
      e.targetCellId = next;
      e.moveProgress = 0;
    }
    const tc = s.cells[e.targetCellId];
    if (!isPassable(tc)) { e.targetCellId = null; e.moveProgress = 1; e.path = []; return false; }
    const terr = tc.type === 'mountain' ? 0.5 : tc.type === 'forest' ? 0.8 : 1;
    const need = (1 - e.moveProgress) / terr;
    if (budget >= need) {
      budget -= need;
      e.cellId = e.targetCellId;
      e.targetCellId = null;
      e.moveProgress = 1;
    } else {
      e.moveProgress += budget * terr;
      budget = 0;
    }
  }
  return e.targetCellId !== null || e.path.length > 0;
}

/** Take a single greedy step toward `goal` using `canStep` (cheap alternative to A* for short hops). */
export function stepToward(s: WorldState, e: Living, goal: number, canStep: (c: TerrainCell) => boolean = isPassable): boolean {
  if (e.targetCellId !== null) return true;
  let best = -1;
  let bestD = cellDistance(e.cellId, goal, s);
  for (const n of neighbors(e.cellId, s)) {
    if (!canStep(s.cells[n])) continue;
    const d = cellDistance(n, goal, s);
    if (d < bestD) { bestD = d; best = n; }
  }
  if (best < 0) return false;
  e.path = [];
  e.targetCellId = best;
  e.moveProgress = 0;
  return true;
}

/** Step to a specific adjacent cell. */
export function stepTo(e: Living, cell: number) {
  e.path = [];
  e.targetCellId = cell;
  e.moveProgress = 0;
}

/** BFS for the nearest cell satisfying `pred` over walkable terrain. */
export function nearestCell(
  cells: TerrainCell[], start: number, pred: (c: TerrainCell) => boolean, maxRadius = 14
): number | null {
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(cur)!;
    if (pred(cells[cur])) return cur;
    if (d >= maxRadius) continue;
    for (const n of neighbors(cur, cells)) {
      if (dist.has(n) || !isPassable(cells[n])) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return null;
}
