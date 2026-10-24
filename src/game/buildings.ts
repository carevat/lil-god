// Buildings: costs, placement, completion effects, eras.

import type { WorldState, Building, BuildingType, Civilization, Settlement, Resources, Era } from './types';
import { ENV } from './config';
import { newId, logEvent } from './util';
import { neighbors, hash2, isWaterType } from './world';

export const COSTS: Record<BuildingType, { wood: number; stone: number; food: number }> = {
  shelter: { wood: 5, stone: 0, food: 2 },
  house: { wood: 10, stone: 2, food: 4 },
  farm: { wood: 3, stone: 0, food: 3 },
  storage: { wood: 15, stone: 5, food: 5 },
  communal: { wood: 25, stone: 10, food: 10 },
};
export const BUILDING_HP: Record<BuildingType, number> = { shelter: 40, house: 60, farm: 30, storage: 80, communal: 120 };
export const BUILDING_CAPACITY: Record<BuildingType, number> = { shelter: 2, house: 4, farm: 0, storage: 0, communal: 0 };
export const BUILDING_LABEL: Record<BuildingType, string> = {
  shelter: 'Shelter', house: 'House', farm: 'Farm', storage: 'Storage hut', communal: 'Communal center',
};

export function canAfford(r: Resources, type: BuildingType): boolean {
  const c = COSTS[type];
  return r.wood >= c.wood && r.stone >= c.stone && r.food >= c.food;
}

export function payCost(r: Resources, type: BuildingType) {
  const c = COSTS[type];
  r.wood -= c.wood; r.stone -= c.stone; r.food -= c.food;
}

export function createBuilding(s: WorldState, type: BuildingType, cellId: number, civId: string | null, settlementId: string | null): Building {
  const b: Building = {
    id: newId(s, 'b'), type, cellId, progress: 0, built: false,
    capacity: BUILDING_CAPACITY[type], residents: [], owner: null, civId, settlementId,
    health: BUILDING_HP[type], maxHealth: BUILDING_HP[type],
    cropStage: type === 'farm' ? 0 : undefined,
  };
  s.buildings[b.id] = b;
  s.cells[cellId].buildingId = b.id;
  return b;
}

/** Territory owner of a cell must be this civ or nobody. */
export function ownerOK(s: WorldState, civ: Civilization | undefined, cellId: number): boolean {
  const o = s.territory[cellId];
  return o === -1 || o === undefined || !civ || o === civ.idx;
}

export function canBuildOn(s: WorldState, cellId: number, type: BuildingType): boolean {
  const c = s.cells[cellId];
  if (c.buildingId) return false;
  if (isWaterType(c.type) || c.type === 'mountain') return false;
  if (c.crater >= ENV.craterBuildBlock) return false;
  if (type === 'farm' && (c.crater >= ENV.craterFarmBlock || (c.type !== 'fertile' && c.type !== 'plains'))) return false;
  return true;
}

/** Organic placement: breadth-first around the settlement with deterministic gaps. */
export function findPlacementCell(s: WorldState, civ: Civilization, st: Settlement, type: BuildingType): number | null {
  if (type === 'communal' && canBuildOn(s, st.cellId, type)) return st.cellId;
  const dist = new Map<number, number>([[st.cellId, 0]]);
  const queue = [st.cellId];
  let head = 0;
  let fallback: number | null = null;
  while (head < queue.length && queue.length < 320) {
    const cur = queue[head++];
    const d = dist.get(cur)!;
    if (cur !== st.cellId && canBuildOn(s, cur, type) && ownerOK(s, civ, cur)) {
      const gap = type !== 'farm' && hash2(cur, s.seed, 31) < 0.28;
      if (!gap) {
        if (type !== 'farm') return cur;
        if (s.cells[cur].type === 'fertile') return cur;
        if (fallback === null) fallback = cur;
      }
    }
    if (d >= 8) continue;
    for (const n of neighbors(cur, s)) {
      if (dist.has(n) || isWaterType(s.cells[n].type)) continue;
      dist.set(n, d + 1);
      queue.push(n);
    }
  }
  return fallback;
}

export function placeBuilding(s: WorldState, civ: Civilization, st: Settlement, type: BuildingType, free = false): Building | null {
  if (!free && !canAfford(civ.resources, type)) return null;
  const cell = findPlacementCell(s, civ, st, type);
  if (cell === null) return null;
  if (!free) payCost(civ.resources, type);
  const b = createBuilding(s, type, cell, civ.id, st.id);
  logEvent(s, 'build', `${civ.name} began building a ${BUILDING_LABEL[type].toLowerCase()} in ${st.name}.`, { entityId: b.id, civId: civ.id, key: `bstart:${civ.id}`, windowDays: 0.5 });
  return b;
}

export function applyBuildingComplete(s: WorldState, b: Building): void {
  const civ = b.civId ? s.civs[b.civId] : undefined;
  if (b.type === 'shelter' || b.type === 'house') {
    for (const c of Object.values(s.citizens)) {
      if (b.residents.length >= b.capacity) break;
      if (!c.alive || c.homeId || c.civId !== b.civId) continue;
      b.residents.push(c.id);
      c.homeId = b.id;
    }
  } else if (b.type === 'storage' && civ) {
    civ.resources.foodCapacity += 50; civ.resources.woodCapacity += 50; civ.resources.stoneCapacity += 25;
  } else if (b.type === 'farm') {
    b.cropStage = 0.1;
  }
  const st = b.settlementId ? s.settlements[b.settlementId] : undefined;
  const where = st ? ` in ${st.name}` : '';
  if (b.type === 'communal') {
    logEvent(s, 'milestone', `${civ?.name ?? 'The settlers'} raised a communal center${where}.`, { entityId: b.id, civId: b.civId ?? undefined });
  } else {
    logEvent(s, 'build', `${civ?.name ?? 'Settlers'} completed a ${BUILDING_LABEL[b.type].toLowerCase()}${where}.`, { entityId: b.id, civId: b.civId ?? undefined, key: `bdone:${b.civId}`, windowDays: 0.3 });
  }
}

export function computeEra(s: WorldState, civ: Civilization): Era {
  const pop = civ.population;
  const built = Object.values(s.buildings).filter(b => b.built && b.civId === civ.id).length;
  if (pop === 0) return 'Dawn';
  if (pop < 5 || built < 2) return 'Camp';
  if (pop < 15 || built < 8) return 'Village';
  return 'Settlement';
}

const ERA_RANK: Record<Era, number> = { Dawn: 0, Camp: 1, Village: 2, Settlement: 3 };
export function maxEra(eras: Era[]): Era {
  return eras.reduce<Era>((a, b) => (ERA_RANK[b] > ERA_RANK[a] ? b : a), 'Dawn');
}
