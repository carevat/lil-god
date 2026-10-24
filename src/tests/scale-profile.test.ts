import { it, expect } from 'vitest';
import { createInitialState } from '../game/state';
import { foundCivilization, findSeedSite, updateTerritory, updateDiplomacy, declareWar } from '../game/civ';
import { createHuman, refreshCounts } from '../game/lifecycle';
import { findStartingCell } from '../game/world';
import { tick, updateEnvironment } from '../game/simulation';
import { buildCtx } from '../game/context';
import { updateHumans } from '../game/humans';

it('profiles the legacy-sized workload for comparison with the recorded baseline', () => {
  const s = createInitialState(12, 'balanced');
  for (let i = 0; i < 4; i++) {
    const cell = i === 0 ? findStartingCell(s.cells, s.seed) : findSeedSite(s);
    if (cell === null) break;
    const people = Array.from({ length: 24 }, (_, j) => createHuman(s, cell, { gender: j % 2 ? 'f' : 'm' }));
    const civ = foundCivilization(s, cell, people);
    civ.resources.food = 100; civ.resources.wood = 100;
  }
  refreshCounts(s);
  const civs = Object.values(s.civs);
  if (civs.length > 1) {
    for (const c of Object.values(s.citizens)) if (parseInt(c.id.slice(1), 36) % 4 === 0) c.role = 'soldier';
    declareWar(s, civs[0], civs[1], 'profiling');
  }
  for (let i = 0; i < 96; i++) tick(s);
  const times: number[] = [];
  for (let i = 0; i < 384; i++) { const t = performance.now(); tick(s); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const profile = (fn: () => void) => {
    const t = performance.now(); for (let i = 0; i < 100; i++) fn(); return +( (performance.now() - t) / 100).toFixed(3);
  };
  const report = {
    cells: s.cells.length, civs: civs.length, humans: s.population,
    tickMeanMs: +(times.reduce((a,b) => a+b,0) / times.length).toFixed(3),
    tickP95Ms: +times[Math.floor(times.length * .95)].toFixed(3),
    environmentMs: profile(() => updateEnvironment(s, .25)),
    territoryMs: profile(() => updateTerritory(s)),
    diplomacyMs: profile(() => updateDiplomacy(s)),
    humanAIMs: profile(() => { s.pathBudget = 14; updateHumans(s, buildCtx(s), .25); }),
  };
  console.log('LEGACY PROFILE', JSON.stringify(report));
  expect(s.cells.length).toBe(4608);
}, 60000);