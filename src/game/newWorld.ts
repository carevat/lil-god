import type { WorldState } from './types';
import type { WorldPreset } from './world';
import { createInitialState } from './state';
import { DEFAULT_WORLD, GENERATION, type WorldOptions } from './scale';
import { createHuman, refreshCounts } from './lifecycle';
import { foundCivilization, updateTerritory } from './civ';
import { analyseGeography, chooseStartingSites } from './geography';
import { findHumanSpawnCells } from './world';
import { getRelation, logEvent } from './util';

/** Only the explicit New World flow populates the map. Loading never calls this. */
export function createNewWorld(seed: number, preset: WorldPreset = 'balanced', options: WorldOptions = DEFAULT_WORLD): WorldState {
  const s = createInitialState(seed, preset, undefined, options);
  const sites = chooseStartingSites(s.cells, options);
  for (const cell of sites) {
    const spawns = findHumanSpawnCells(s.cells, cell, GENERATION.founders);
    if (spawns.length !== GENERATION.founders) continue;
    const people = spawns.map((id,j) => createHuman(s,id,{gender:j%2 ? 'f' : 'm'}));
    const civ = foundCivilization(s,cell,people,'forms',false);
    civ.resources.food = 28;
    civ.planTimer = (civ.idx % 8) * .5;
    civ.recruitTimer = civ.idx % 6;
  }
  refreshCounts(s); updateTerritory(s);
  const civs = Object.values(s.civs);
  for (let i=0;i<civs.length;i++) for (let j=i+1;j<civs.length;j++) getRelation(s,civs[i].id,civs[j].id);
  const geo = analyseGeography(s.cells);
  s.generation.initialCivilizations = civs.length;
  s.generation.inhabitedRegions = new Set(Object.values(s.settlements).map(t=>geo.regionIds[t.cellId])).size;
  s.milestones.firstLife = civs.length > 0; s.milestones.firstCitizen = civs.length > 0;
  s.notices = []; s.fx = []; s.era = civs.length ? 'Camp' : 'Dawn';
  logEvent(s,'milestone',`${civs.length} independent peoples awaken across ${s.generation.inhabitedRegions} habitable landmasses.`);
  return s;
}