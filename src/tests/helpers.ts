import type { WorldState, Citizen, Civilization } from '../game/types';
import { createInitialState } from '../game/state';
import { findStartingCell, cellsWithin, cellFromIndex, cellIndex, GRID_W } from '../game/world';
import { tick } from '../game/simulation';
import { createHuman } from '../game/lifecycle';
import { foundCivilization } from '../game/civ';
import { refreshCounts } from '../game/lifecycle';

export function base(seed = 12): { s: WorldState; start: number } {
  const s = createInitialState(seed, 'balanced');
  s.weather = 'clear';
  s.weatherTimer = 1e6;
  return { s, start: findStartingCell(s.cells, seed) };
}

/** Make a circular patch of plain, grassy land so tests do not depend on the seed's geography. */
export function flatten(s: WorldState, center: number, radius: number) {
  for (const id of cellsWithin(center, radius)) {
    const c = s.cells[id];
    c.type = 'plains'; c.elevation = 0.2; c.fertility = 0.6; c.moisture = 0.5; c.grass = 0.8;
    c.trees = 0; c.maxTrees = 0; c.stone = 0; c.drought = 0; c.crater = 0; c.scorch = 0; c.buildingId = null;
  }
  s.terrainRev++;
}

export function mkCiv(s: WorldState, cell: number, n = 3): { civ: Civilization; humans: Citizen[] } {
  const humans: Citizen[] = [];
  for (let i = 0; i < n; i++) humans.push(createHuman(s, cell, { gender: i % 2 === 0 ? 'm' : 'f' }));
  const civ = foundCivilization(s, cell, humans);
  refreshCounts(s);
  return { civ, humans };
}

export function run(s: WorldState, hours: number, dt = 0.25) {
  for (let t = 0; t < hours - 1e-9; t += dt) tick(s, dt);
}

export function eastOf(cell: number, dx: number): number {
  const { gx, gy } = cellFromIndex(cell);
  return cellIndex((gx + dx) % GRID_W, gy);
}

export function makeSoldiers(civ: Civilization, humans: Citizen[], n: number) {
  humans.slice(0, n).forEach(h => { h.role = 'soldier'; h.maxHealth = 120; h.health = 120; h.task = 'patrol'; });
  void civ;
}
