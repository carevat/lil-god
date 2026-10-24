// Low-level state factory. Omitting options preserves the historical uninhabited test/preview
// world. The player-facing New World flow uses createNewWorld with Standard/Normal defaults.

import type { WorldState, Stats, SpeciesId } from './types';
import { generateWorld, GRID_W, GRID_H, type WorldPreset } from './world';
import { generateWorldName } from './names';
import { CAPS } from './config';
import { logEvent } from './util';
import { generateExpandedWorld } from './geography';
import type { WorldOptions } from './scale';

export const emptyStats = (): Stats => ({ births: 0, deaths: 0, lightningKills: 0, meteorKills: 0, warDeaths: 0, predations: 0 });
export const emptyCounts = (): Record<SpeciesId, number> => ({ human: 0, deer: 0, wolf: 0, rabbit: 0, golem: 0 });
export const emptyResources = () => ({ food: 0, wood: 0, stone: 0, foodCapacity: 0, woodCapacity: 0, stoneCapacity: 0 });

export function createInitialState(seed: number, preset: WorldPreset = 'balanced', name?: string, options?: WorldOptions): WorldState {
  const generated = options ? generateExpandedWorld(seed, preset, options) : null;
  const cells = generated?.cells ?? generateWorld(seed, preset).cells;
  const worldName = name ?? generateWorldName(seed);
  const s: WorldState = {
    seed, name: worldName, width: generated?.width ?? GRID_W, height: generated?.height ?? GRID_H, radius: generated?.radius ?? 5, cells,
    generation: { size: options?.size ?? 'legacy', density: options?.density ?? 'normal', preset, attempt: generated?.attempt ?? 0, initialCivilizations: 0, inhabitedRegions: 0 },
    ecologyPhase: 0, ecologyElapsed: 0, ecologyRevision: 0,
    citizens: {}, creatures: {}, buildings: {}, settlements: {}, civs: {}, relations: {},
    territory: new Array(cells.length).fill(-1),
    resources: emptyResources(),
    events: [],
    day: 0, weather: 'clear', weatherTimer: 60, timeOfDay: 0.25,
    divineEnergy: 100, maxDivineEnergy: 100, divineRegen: 0.5,
    housing: { used: 0, capacity: 0 }, population: 0, era: 'Dawn',
    speciesCounts: emptyCounts(),
    meteors: [], showers: [], impacts: [], dust: 0, powerCd: {},
    rng: ((seed * 2654435761) ^ 0x9e3779b9) >>> 0,
    idCounter: 0, civCounter: 0, terrainRev: 0,
    notices: [], fx: [], eventGate: {}, suppressed: {},
    stats: emptyStats(), milestones: {}, peaks: {},
    diploTimer: 0, terrTimer: 0, dayTimer: 0, pathBudget: CAPS.pathsPerTick, borderFriction: {},
  };
  logEvent(s, 'milestone', `The world ${worldName} awakens.`);
  return s;
}
