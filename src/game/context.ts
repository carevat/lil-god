// Per-tick simulation context: spatial index and cached lookups so AI avoids O(n^2) scans.

import type { WorldState, Living, Citizen, Creature, Building, Settlement } from './types';
import { cellsWithin, sphereDist } from './world';

export interface Ctx {
  world: WorldState;
  index: Map<number, Living[]>;
  humans: Citizen[];
  creatures: Creature[];
  byCiv: Record<string, Citizen[]>;
  builders: Record<string, number>;
  farmers: Record<string, number>;
  enemies: Record<string, string[]>;
  buildingsByCiv: Record<string, Building[]>;
  settlementsByCiv: Record<string, Settlement[]>;
}

export function buildCtx(s: WorldState): Ctx {
  const ctx: Ctx = { world: s, index: new Map(), humans: [], creatures: [], byCiv: {}, builders: {}, farmers: {}, enemies: {}, buildingsByCiv: {}, settlementsByCiv: {} };
  const add = (e: Living) => {
    const list = ctx.index.get(e.cellId);
    if (list) list.push(e); else ctx.index.set(e.cellId, [e]);
  };
  for (const c of Object.values(s.citizens)) {
    if (!c.alive) continue;
    ctx.humans.push(c);
    add(c);
    if (c.civId) (ctx.byCiv[c.civId] ??= []).push(c);
    if (c.taskId && c.role === 'civilian') {
      if (c.task === 'build') ctx.builders[c.taskId] = (ctx.builders[c.taskId] ?? 0) + 1;
      else if (c.task === 'farm') ctx.farmers[c.taskId] = (ctx.farmers[c.taskId] ?? 0) + 1;
    }
  }
  for (const w of Object.values(s.creatures)) {
    if (!w.alive) continue;
    ctx.creatures.push(w);
    add(w);
  }
  for (const r of Object.values(s.relations)) {
    if (r.status !== 'war') continue;
    (ctx.enemies[r.a] ??= []).push(r.b);
    (ctx.enemies[r.b] ??= []).push(r.a);
  }
  for (const b of Object.values(s.buildings)) if (b.civId) (ctx.buildingsByCiv[b.civId] ??= []).push(b);
  for (const st of Object.values(s.settlements)) (ctx.settlementsByCiv[st.civId] ??= []).push(st);
  return ctx;
}

/** Entities near `center` (great-circle radius in cells) that satisfy `pred`. */
export function queryNear(ctx: Ctx, center: number, radius: number, pred?: (e: Living) => boolean): Living[] {
  const out: Living[] = [];
  for (const cell of cellsWithin(center, radius, ctx.world)) {
    const list = ctx.index.get(cell);
    if (!list) continue;
    for (const e of list) if (e.alive && (!pred || pred(e))) out.push(e);
  }
  return out;
}

export function nearestWhere(ctx: Ctx, center: number, radius: number, pred: (e: Living) => boolean, self?: Living): Living | null {
  let best: Living | null = null;
  let bestD = Infinity;
  for (const cell of cellsWithin(center, radius, ctx.world)) {
    const list = ctx.index.get(cell);
    if (!list) continue;
    for (const e of list) {
      if (!e.alive || e === self || !pred(e)) continue;
      const d = sphereDist(center, e.cellId, ctx.world);
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  return best;
}
