import { describe, it, expect } from 'vitest';
import { base, flatten, run } from './helpers';
import { createCreature } from '../game/lifecycle';
import { castSpawn, canPlaceSpecies } from '../game/powers';
import { SPECIES } from '../game/species';
import { logEvent } from '../game/util';
import { cellsWithin, sphereDist } from '../game/world';

function meadow() {
  const { s, start } = base();
  flatten(s, start, 12);
  for (const id of Array.from(new Set([start]))) s.cells[id].type = 'fertile';
  return { s, start };
}
const count = (s: ReturnType<typeof base>['s'], sp: string) => Object.values(s.creatures).filter(c => c.species === sp && c.alive).length;

describe('creatures', () => {
  it('cannot be placed in invalid habitats', () => {
    const { s, start } = meadow();
    const ocean = s.cells.findIndex(c => c.type === 'deepOcean');
    expect(castSpawn(s, 'human', ocean).ok).toBe(false);
    expect(castSpawn(s, 'deer', ocean).ok).toBe(false);
    s.cells[start + 1].type = 'mountain';
    const r = castSpawn(s, 'wolf', start + 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/need/i);
    s.cells[start + 2].type = 'beach';
    expect(canPlaceSpecies(s, 'rabbit', start + 2).ok).toBe(false);
    expect(Object.keys(s.creatures).length).toBe(0);
    expect(s.divineEnergy).toBe(100); // failed placement costs nothing
  });

  it('spawns every species with the right counts and costs', () => {
    const { s, start } = meadow();
    for (const sp of ['deer', 'rabbit', 'wolf', 'golem'] as const) {
      s.divineEnergy = 100; s.powerCd = {};
      const r = castSpawn(s, sp, start);
      expect(r.ok).toBe(true);
      expect(s.divineEnergy).toBe(100 - SPECIES[sp].cost);
      expect(count(s, sp)).toBe(SPECIES[sp].spawnCount);
    }
    expect(s.events.some(e => e.category === 'species')).toBe(true);
    s.divineEnergy = 100;
    expect(castSpawn(s, 'golem', start).ok).toBe(false); // golem cooldown
  });

  it('herbivores graze vegetation and reproduce when the ecosystem supports them', () => {
    const { s, start } = meadow();
    const cell = s.cells[start];
    const f = createCreature(s, 'rabbit', start, { gender: 'f', age: 20 });
    createCreature(s, 'rabbit', start, { gender: 'm', age: 20 });
    f.hunger = 0.6;
    const hungerBefore = f.hunger;
    cell.grass = 0.9;
    run(s, 3);
    expect(f.hunger).toBeLessThan(hungerBefore);
    expect(cell.grass).toBeLessThan(0.9);
    run(s, 24 * 40, 1);
    expect(count(s, 'rabbit')).toBeGreaterThan(2);
    expect(count(s, 'rabbit')).toBeLessThanOrEqual(120);
  });

  it('overgrazing starves herbivores instead of growing forever', () => {
    const { s, start } = meadow();
    // a tiny meadow fenced in by mountains (impassable to deer)
    for (const id of cellsWithin(start, 12)) if (sphereDist(start, id) > 2) { s.cells[id].type = 'mountain'; s.cells[id].grass = 0.1; }
    for (let i = 0; i < 40; i++) createCreature(s, 'deer', start, { age: 40 });
    run(s, 24 * 40, 1);
    expect(count(s, 'deer')).toBeLessThan(40);
    expect(count(s, 'deer')).toBeLessThanOrEqual(70);
  });

  it('wolves hunt prey and are slowed by competition, golems need no food', () => {
    const { s, start } = meadow();
    const wolf = createCreature(s, 'wolf', start, { age: 60, gender: 'f' });
    wolf.hunger = 0.9;
    for (let i = 0; i < 3; i++) createCreature(s, 'deer', start, { age: 40 });
    const g = createCreature(s, 'golem', start + 20, { age: 0 });
    for (let i = 0; i < 200 && wolf.hunger >= 0.9; i++) run(s, 0.5, 0.5);
    expect(wolf.hunger).toBeLessThan(0.9); // feeding relieved its hunger
    expect(s.stats.predations).toBeGreaterThan(0);
    run(s, 40, 0.5);
    expect(g.hunger).toBe(0);
    expect(g.alive).toBe(true);
  });

  it('golems drive off wolves threatening the area', () => {
    const { s, start } = meadow();
    const golem = createCreature(s, 'golem', start, { age: 0 });
    const wolf = createCreature(s, 'wolf', start + 2, { age: 60 });
    wolf.hunger = 0.1;
    run(s, 80, 0.5);
    expect(golem.alive).toBe(true);
    expect(wolf.alive).toBe(false);
  });

  it('history events are rate limited instead of spamming', () => {
    const { s } = base();
    const n = s.events.length;
    for (let i = 0; i < 50; i++) logEvent(s, 'ecology', 'Repeated', { key: 'spam', windowDays: 1 });
    expect(s.events.length).toBe(n + 1);
  });
});
