// Simulation orchestrator: fixed-step tick, environment and daily bookkeeping.

import type { WorldState } from './types';
import { TICK_HOURS, HOURS_PER_DAY, CAPS, TERRITORY, ENV } from './config';
import { rand, logEvent } from './util';
import { isWaterType, GRASS_MAX } from './world';
import { buildCtx } from './context';
import { refreshCounts, pruneDead } from './lifecycle';
import { updateHumans, updateReproduction, updateCivEconomy } from './humans';
import { updateWildlife, updateWildlifeRepro, checkPopulationEvents } from './wildlife';
import { updateTerritory, updateWars, civDaily, aliveCivs } from './civ';
import { tickCooldowns, updateMeteors } from './powers';
import { maxEra } from './buildings';
import { stepCombat, pruneAnims } from './combat';
import { refreshLeadership, tickSuccessions } from './authority';

export { TICK_HOURS } from './config';
export { POWER_COSTS } from './config';

export function updateEnvironment(s: WorldState, dt: number): void {
  s.weatherTimer -= dt;
  if (s.weatherTimer <= 0) {
    const r = rand(s);
    if (s.weather === 'drought') {
      s.weather = r < 0.4 ? 'rain' : 'clear';
      s.weatherTimer = 20 + rand(s) * 40;
      logEvent(s, 'environment', 'The drought has ended.', { key: 'weather', windowDays: 1 });
    } else if (s.weather === 'rain') {
      s.weather = 'clear';
      s.weatherTimer = 30 + rand(s) * 60;
    } else if (r < 0.08) {
      s.weather = 'drought';
      s.weatherTimer = 40 + rand(s) * 60;
      logEvent(s, 'environment', 'A drought settles over the land.', { key: 'weather', windowDays: 1 });
    } else if (r < 0.25) {
      s.weather = 'rain';
      s.weatherTimer = 10 + rand(s) * 30;
    } else {
      s.weatherTimer = 20 + rand(s) * 60;
    }
  }
  s.dust = Math.max(0, s.dust - ENV.dustDecay * dt);
  const dustMul = 1 - 0.3 * s.dust;
  const rain = s.weather === 'rain', drought = s.weather === 'drought';
  // Large maps amortize ecology over four deterministic shards; every region advances equally,
  // independently of the camera. Weather and damage still apply immediately everywhere.
  const shards = s.generation.size === 'legacy' ? 1 : 4;
  const offset = s.ecologyPhase % shards;
  s.ecologyPhase = (offset + 1) % shards;
  s.ecologyElapsed += dt;
  if (s.ecologyPhase === 0) { s.ecologyRevision++; s.ecologyElapsed = 0; }
  dt *= shards;
  for (let i = offset; i < s.cells.length; i += shards) {
    const c = s.cells[i];
    if (isWaterType(c.type)) continue;
    if (rain) { c.moisture = Math.min(1, c.moisture + 0.02 * dt); c.drought = Math.max(0, c.drought - 0.03 * dt); }
    else if (drought) { c.moisture = Math.max(0, c.moisture - 0.015 * dt); c.drought = Math.min(1, c.drought + 0.01 * dt); }
    else { c.moisture += (0.5 - c.moisture) * 0.001 * dt; c.drought = Math.max(0, c.drought - 0.002 * dt); }

    const gmax = GRASS_MAX[c.type] * (1 - c.drought * 0.7) * (1 - c.crater * 0.8);
    if (c.grass < gmax) {
      const room = Math.max(0.1, 1 - c.grass / Math.max(gmax, 0.01));
      c.grass = Math.min(gmax, c.grass + 0.012 * (0.3 + c.moisture) * (0.5 + c.fertility) * dustMul * room * dt);
    } else if (c.grass > gmax) c.grass = Math.max(gmax, c.grass - 0.01 * dt);

    if (c.type === 'forest' && c.trees < c.maxTrees && c.moisture > 0.3 && c.crater < 0.3 && rand(s) < 0.001 * dt) c.trees++;
    if (c.crater > ENV.craterFloor) c.crater = Math.max(ENV.craterFloor, c.crater - ENV.craterRecover * dt);
    if (c.scorch > 0) c.scorch = Math.max(0, c.scorch - ENV.scorchDecay * dt);
  }
}

/** Advance the simulation by `dt` game hours. Deterministic for a given state (seeded RNG). */
export function tick(s: WorldState, dt: number = TICK_HOURS): void {
  s.day += dt / HOURS_PER_DAY;
  s.timeOfDay = (s.timeOfDay + dt / HOURS_PER_DAY) % 1;
  s.pathBudget = CAPS.pathsPerTick;
  s.divineEnergy = Math.min(s.maxDivineEnergy, s.divineEnergy + s.divineRegen * dt);
  tickCooldowns(s, dt);
  updateEnvironment(s, dt);
  refreshCounts(s);
  const ctx = buildCtx(s);

  s.terrTimer -= dt;
  if (s.terrTimer <= 0) { s.terrTimer = TERRITORY.updateEveryHours; updateTerritory(s); }
  updateCivEconomy(s, dt);
  updateWars(s, ctx, dt);
  updateHumans(s, ctx, dt);
  updateReproduction(s, ctx, dt);
  updateWildlife(s, ctx, dt);
  updateWildlifeRepro(s, ctx, dt);
  stepCombat(s, dt); // attacks land here, once per wind-up
  pruneAnims(s);
  tickSuccessions(s);

  s.dayTimer += dt;
  if (s.dayTimer >= HOURS_PER_DAY) {
    s.dayTimer -= HOURS_PER_DAY;
    civDaily(s);
    pruneDead(s, CAPS.maxDeadHumans);
    refreshLeadership(s);
  }
  refreshCounts(s);
  checkPopulationEvents(s);
  s.era = maxEra(aliveCivs(s).map(c => c.era));
}

/** Real-time effects that continue while paused (meteors, cooldown recharge). */
export function advanceRealtime(s: WorldState, hours: number, paused: boolean): void {
  if (paused) tickCooldowns(s, hours);
  updateMeteors(s, hours);
}
