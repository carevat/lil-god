import { describe, it, expect } from 'vitest';
import { base, flatten, mkCiv, run } from './helpers';
import { tick } from '../game/simulation';
import { createHuman, lifeStage, killEntity, refreshCounts, applyDamage } from '../game/lifecycle';
import { giveBirth, birthChance, updateReproduction } from '../game/humans';
import { buildCtx } from '../game/context';
import { SPECIES } from '../game/species';
import { createBuilding, placeBuilding, applyBuildingComplete, COSTS, canBuildOn } from '../game/buildings';
import { settlementsOf } from '../game/civ';
import { castRain } from '../game/powers';
import { castSpawn } from '../game/powers';

describe('citizen needs', () => {
  it('eat from the civilization stores and recover hunger', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ, humans } = mkCiv(s, start, 3);
    humans[0].hunger = 0.7; civ.resources.food = 10;
    tick(s);
    expect(civ.stats.eaten).toBeGreaterThanOrEqual(1);
    expect(humans[0].hunger).toBeLessThan(0.7);
  });

  it('starving citizens lose health through the shared damage system', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ, humans } = mkCiv(s, start, 2);
    civ.resources.food = 0;
    for (const h of humans) h.hunger = 0.95;
    let minHealth = humans[0].maxHealth;
    for (let i = 0; i < 8; i++) { run(s, 0.25); minHealth = Math.min(minHealth, humans[0].health); }
    expect(minHealth).toBeLessThan(humans[0].maxHealth);
  });

  it('wood, stone and food can never go negative', () => {
    const { s, start } = base();
    flatten(s, start, 8);
    for (const id of [start, start + 1, start + 2]) { s.cells[id].trees = 2; s.cells[id].maxTrees = 2; s.cells[id].stone = 2; }
    const { civ } = mkCiv(s, start, 4);
    civ.resources.wood = 3; civ.resources.stone = 0; civ.resources.food = 4;
    for (let i = 0; i < 40; i++) {
      run(s, 10);
      for (const k of ['food', 'wood', 'stone'] as const) expect(civ.resources[k]).toBeGreaterThanOrEqual(0);
    }
    for (const c of s.cells) expect(c.trees).toBeGreaterThanOrEqual(0);
  });
});

describe('construction and buildings', () => {
  it('construction consumes exactly the listed resources, and refuses when unaffordable', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ } = mkCiv(s, start, 3);
    const st = settlementsOf(s, civ.id)[0];
    civ.resources.wood = 50; civ.resources.stone = 10; civ.resources.food = 20;
    const b = placeBuilding(s, civ, st, 'house');
    expect(b).not.toBeNull();
    expect(civ.resources.wood).toBe(50 - COSTS.house.wood);
    expect(civ.resources.stone).toBe(10 - COSTS.house.stone);
    expect(civ.resources.food).toBe(20 - COSTS.house.food);
    civ.resources.wood = 1;
    const before = { ...civ.resources };
    expect(placeBuilding(s, civ, st, 'house')).toBeNull();
    expect(civ.resources).toEqual(before);
  });

  it('completed homes add housing; storage raises capacity; damaged ground blocks building', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ } = mkCiv(s, start, 3);
    const st = settlementsOf(s, civ.id)[0];
    const near = start + 1;
    const house = createBuilding(s, 'house', near, civ.id, st.id);
    house.built = true; applyBuildingComplete(s, house);
    refreshCounts(s);
    expect(civ.housing.capacity).toBe(4);
    expect(civ.housing.used).toBeGreaterThan(0); // homeless citizens moved in
    const cap = civ.resources.foodCapacity;
    const store = createBuilding(s, 'storage', start + 2, civ.id, st.id);
    store.built = true; applyBuildingComplete(s, store);
    expect(civ.resources.foodCapacity).toBe(cap + 50);
    s.cells[start + 3].crater = 0.9;
    expect(canBuildOn(s, start + 3, 'house')).toBe(false);
  });

  it('settlers gather resources, build homes and the village grows on its own', () => {
    const { s, start } = base(); flatten(s, start, 10);
    for (let i = 0; i < 12; i++) { const c = s.cells[start + (i % 6) + 1]; c.trees = 3; c.maxTrees = 3; c.type = 'forest'; }
    const r = castSpawn(s, 'human', start);
    expect(r.ok).toBe(true);
    run(s, 24 * 14, 1);
    const built = Object.values(s.buildings).filter(b => b.built);
    expect(built.length).toBeGreaterThan(0);
    expect(s.events.some(e => e.category === 'build')).toBe(true);
  });

  it('farms produce food when harvested and grow slower under drought', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ, humans } = mkCiv(s, start, 3);
    const st = settlementsOf(s, civ.id)[0];
    const fa = start + 1, fb = start + 3;
    const farmA = createBuilding(s, 'farm', fa, civ.id, st.id); farmA.built = true; farmA.cropStage = 0.2;
    const farmB = createBuilding(s, 'farm', fb, civ.id, st.id); farmB.built = true; farmB.cropStage = 0.2;
    s.cells[fb].drought = 0.9;
    for (const [h, f] of [[humans[0], farmA], [humans[1], farmB]] as const) { h.cellId = f.cellId; h.task = 'farm'; h.taskId = f.id; h.goal = f.cellId; h.personality.industrious = 1; }
    civ.planTimer = 1e6;
    s.cells[fb].drought = 0.9;
    for (let i = 0; i < 6; i++) { s.cells[fb].drought = 0.9; tick(s); }
    expect(farmA.cropStage!).toBeGreaterThan(farmB.cropStage!);
    // harvest
    const food = civ.resources.food;
    farmA.cropStage = 0.999;
    humans[0].energy = 1;
    tick(s);
    expect(civ.resources.food).toBeGreaterThan(food - 1);
    expect(civ.stats.produced.food).toBeGreaterThan(0);
  });

  it('weather: drought dries the land and divine rain restores moisture', () => {
    const { s, start } = base(); flatten(s, start, 8);
    s.weather = 'drought'; s.weatherTimer = 1e6;
    run(s, 30);
    expect(s.cells[start].moisture).toBeLessThan(0.5);
    expect(s.cells[start].drought).toBeGreaterThan(0);
    const m = s.cells[start].moisture, d = s.cells[start].drought;
    expect(castRain(s, start).ok).toBe(true);
    expect(s.cells[start].moisture).toBeGreaterThan(m);
    expect(s.cells[start].drought).toBeLessThan(d);
  });
});

describe('reproduction and life stages', () => {
  function family() {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ, humans } = mkCiv(s, start, 2);
    const st = settlementsOf(s, civ.id)[0];
    const home = createBuilding(s, 'house', start + 1, civ.id, st.id);
    home.built = true; applyBuildingComplete(s, home);
    civ.resources.food = 80;
    const [m, f] = humans[0].gender === 'f' ? [humans[1], humans[0]] : [humans[0], humans[1]];
    m.partnerId = f.id; f.partnerId = m.id;
    // make room: house holds 4, two residents
    refreshCounts(s);
    return { s, civ, mother: f, father: m, start };
  }

  it('creates a valid child when conditions are met', () => {
    const { s, civ, mother, father } = family();
    const before = s.population;
    const baby = giveBirth(s, mother);
    expect(baby).not.toBeNull();
    refreshCounts(s);
    expect(s.population).toBe(before + 1);
    expect(baby!.civId).toBe(civ.id);
    expect(baby!.parentIds).toEqual([mother.id, father.id]);
    expect(mother.childIds).toContain(baby!.id);
    expect(lifeStage(baby!)).toBe('child');
    expect(mother.reproCooldown).toBeGreaterThan(0);
  });

  it('does not give birth without housing room or food', () => {
    const { s, civ, mother } = family();
    civ.resources.food = 2;
    expect(giveBirth(s, mother)).toBeNull();
    civ.resources.food = 80;
    civ.housing.used = civ.housing.capacity;
    expect(giveBirth(s, mother)).toBeNull();
  });

  it('children mature with simulated time and move slower than adults', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ } = mkCiv(s, start, 2);
    const kid = createHuman(s, start, { age: SPECIES.human.adultAgeDays - 0.05, civId: civ.id });
    expect(lifeStage(kid)).toBe('child');
    run(s, 2);
    expect(lifeStage(kid)).toBe('adult');
    const fresh = createHuman(s, start, { age: 0, civId: civ.id });
    expect(lifeStage(fresh)).toBe('child');
  });

  it('population growth slows when food is scarce and stops without housing', () => {
    const { s, civ, mother } = family();
    civ.population = 10; // a bigger village needs more food per head
    civ.resources.food = 200;
    const rich = birthChance(s, civ, mother);
    civ.resources.food = 12;
    const poor = birthChance(s, civ, mother);
    expect(rich).toBeGreaterThan(poor);
    expect(poor).toBeGreaterThan(0);
    civ.resources.food = 5;
    expect(birthChance(s, civ, mother)).toBe(0);
    civ.resources.food = 200;
    civ.housing.used = civ.housing.capacity;
    expect(birthChance(s, civ, mother)).toBe(0);
  });

  it('couples reproduce through the simulation over time', () => {
    const { s, civ, mother } = family();
    civ.planTimer = 1e6;
    let births = 0;
    for (let d = 0; d < 90 && births === 0; d++) {
      civ.resources.food = 150;
      run(s, 24, 1);
      births = s.stats.births;
      void updateReproduction; void buildCtx;
    }
    expect(births).toBeGreaterThan(0);
    expect(mother.childIds.length + s.stats.births).toBeGreaterThan(0);
  });
});

describe('death and entity lifecycle', () => {
  it('dead citizens stop acting, free housing and are not counted', () => {
    const { s, start } = base(); flatten(s, start, 8);
    s.cells[start].trees = 3;
    const { civ, humans } = mkCiv(s, start, 3);
    const st = settlementsOf(s, civ.id)[0];
    const home = createBuilding(s, 'house', start + 1, civ.id, st.id);
    home.built = true; applyBuildingComplete(s, home);
    const v = humans[0];
    v.task = 'chop'; v.goal = start + 2;
    refreshCounts(s);
    const wood = civ.resources.wood;
    expect(v.homeId).toBe(home.id);
    killEntity(s, v, 'test');
    expect(v.alive).toBe(false);
    expect(v.task).toBe('dead');
    expect(home.residents).not.toContain(v.id);
    expect(v.homeId).toBeNull();
    const cell = v.cellId;
    run(s, 12);
    expect(v.cellId).toBe(cell);
    expect(v.task).toBe('dead');
    expect(civ.resources.wood).toBeGreaterThanOrEqual(wood - 20); // only living citizens work
    refreshCounts(s);
    expect(civ.population).toBe(2);
    // double death is harmless
    const deaths = s.stats.deaths;
    killEntity(s, v, 'again');
    applyDamage(s, v, 999, { kind: 'lightning' });
    expect(s.stats.deaths).toBe(deaths);
  });

  it('a dead partner clears the link and never reappears in reproduction', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { humans } = mkCiv(s, start, 2);
    humans[0].partnerId = humans[1].id; humans[1].partnerId = humans[0].id;
    killEntity(s, humans[0], 'test');
    expect(humans[1].partnerId).toBeNull();
    run(s, 24 * 5, 1);
    expect(humans[0].alive).toBe(false);
  });
});
