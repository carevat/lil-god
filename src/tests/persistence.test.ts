import { describe, it, expect } from 'vitest';
import { base, flatten, mkCiv, makeSoldiers, run, eastOf } from './helpers';
import { serialize, importSave } from '../game/persistence';
import { migrateSave, SAVE_VERSION } from '../game/migrate';
import { createInitialState } from '../game/state';
import { createCreature, createHuman, killEntity, refreshCounts } from '../game/lifecycle';
import { castMeteor, updateMeteors, castSpawn } from '../game/powers';
import { declareWar, fallCiv, settlementsOf, foundCivilization } from '../game/civ';
import { giveBirth } from '../game/humans';
import { getRelation } from '../game/util';
import { METEOR, CAPS } from '../game/config';
import { tick } from '../game/simulation';
import { cellIndex } from '../game/world';

function roundTrip(s: ReturnType<typeof base>['s']) {
  const res = migrateSave(JSON.parse(serialize(s, true)));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe('saving and loading', () => {
  it('preserves births, deaths, wars, craters, species and fallen civilizations', () => {
    const { s, start } = base();
    flatten(s, start, 16);
    const A = mkCiv(s, start, 8);
    const B = mkCiv(s, eastOf(start, 6), 8);
    const C = mkCiv(s, eastOf(start, 14), 3);
    const st = settlementsOf(s, A.civ.id)[0];
    void st;
    A.civ.resources.food = 100; A.civ.housing = { used: 0, capacity: 10 };
    const mother = A.humans.find(h => h.gender === 'f')!, father = A.humans.find(h => h.gender === 'm')!;
    mother.partnerId = father.id; father.partnerId = mother.id;
    A.civ.housing.capacity = 10;
    const baby = giveBirth(s, mother);
    killEntity(s, A.humans[3], 'test');
    makeSoldiers(A.civ, A.humans, 3); makeSoldiers(B.civ, B.humans, 3);
    refreshCounts(s);
    declareWar(s, A.civ, B.civ, 'test');
    createCreature(s, 'wolf', start + 3, {});
    s.divineEnergy = 100; castSpawn(s, 'deer', start + 2);
    s.divineEnergy = 100;
    castMeteor(s, eastOf(start, -8));
    updateMeteors(s, METEOR.warnHours + 0.1);
    fallCiv(s, C.civ);

    const loaded = roundTrip(s).state;
    expect(Object.keys(loaded.citizens).length).toBe(Object.keys(s.citizens).length);
    if (baby) expect(loaded.citizens[baby.id].parentIds).toEqual([mother.id, father.id]);
    expect(loaded.citizens[A.humans[3].id].alive).toBe(false);
    expect(loaded.citizens[A.humans[3].id].deathCause).toBe('test');
    expect(getRelation(loaded, A.civ.id, B.civ.id).status).toBe('war');
    expect(Object.values(loaded.citizens).filter(c => c.role === 'soldier').length).toBe(6);
    expect(Object.keys(loaded.creatures).length).toBe(Object.keys(s.creatures).length);
    expect(loaded.civs[C.civ.id].alive).toBe(false);
    expect(loaded.civs[C.civ.id].name).toBe(C.civ.name);
    expect(loaded.impacts.length).toBe(1);
    const craters = s.cells.filter(c => c.crater > 0.3).map(c => [c.id, Math.round(c.crater * 1e4) / 1e4]);
    expect(craters.length).toBeGreaterThan(0);
    for (const [id, v] of craters) expect(loaded.cells[id as number].crater).toBeCloseTo(v as number, 3);
    expect(loaded.events.length).toBe(s.events.length);
    expect(loaded.territory.length).toBe(s.territory.length);
    expect(loaded.seed).toBe(s.seed);
    // loaded world keeps simulating
    run(loaded, 5);
    expect(Number.isFinite(loaded.day)).toBe(true);
  });

  it('migrates Part 1 saves without losing the world', () => {
    const fresh = createInitialState(5, 'balanced');
    const cell = fresh.cells.find(c => c.type === 'plains')!.id;
    const v1: any = JSON.parse(JSON.stringify(fresh));
    v1.version = undefined;
    for (const k of ['creatures', 'civs', 'relations', 'territory', 'meteors', 'showers', 'impacts', 'dust', 'powerCd', 'rng', 'idCounter', 'civCounter', 'terrainRev', 'notices', 'fx', 'eventGate', 'suppressed', 'stats', 'milestones', 'peaks', 'speciesCounts']) delete v1[k];
    for (const c of v1.cells) { delete c.grass; delete c.crater; delete c.scorch; c.occupantIds = []; }
    v1.resources = { food: 33, wood: 21, stone: 7, foodCapacity: 100, woodCapacity: 100, stoneCapacity: 50 };
    v1.era = 'Camp'; v1.day = 800;
    v1.citizens = {
      c_1_ab: { id: 'c_1_ab', name: 'Morwen', age: 20 * 365, maxAge: 70 * 365, gender: 'f', health: 0.5, hunger: 0.3, energy: 0.9, cellId: cell, targetCellId: null, task: 'idle', taskId: null, homeId: 'b_1_x', familyIds: [], personality: { industrious: 0.7, sociable: 0.4 }, alive: true, moveProgress: 1, carry: { food: 0, wood: 0, stone: 0 }, taskTimer: 0 },
      c_2_cd: { id: 'c_2_cd', name: 'Tanrik', age: 25 * 365, maxAge: 75 * 365, gender: 'm', health: 1, hunger: 0.2, energy: 0.8, cellId: cell, targetCellId: null, task: 'wander', taskId: null, homeId: null, familyIds: ['c_1_ab'], personality: { industrious: 0.5, sociable: 0.9 }, alive: true, moveProgress: 1, carry: { food: 0, wood: 0, stone: 0 }, taskTimer: 0 },
      c_3_ef: { id: 'c_3_ef', name: 'Olddead', age: 40 * 365, maxAge: 70 * 365, gender: 'm', health: 0, hunger: 0.2, energy: 0.8, cellId: cell, targetCellId: null, task: 'dead', taskId: null, homeId: null, familyIds: [], personality: { industrious: 0.5, sociable: 0.9 }, alive: false, moveProgress: 1, carry: { food: 0, wood: 0, stone: 0 }, taskTimer: 0 },
    };
    v1.buildings = { b_1_x: { id: 'b_1_x', type: 'shelter', cellId: cell, progress: 1, built: true, capacity: 2, residents: ['c_1_ab'], owner: null, storedFood: 0 } };
    v1.cells[cell].buildingId = 'b_1_x';
    const res = migrateSave({ version: 1, state: v1, savedAt: 1, tutorialDone: true, worldName: 'Mossfall' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.migrated).toBe(true);
    expect(res.data.version).toBe(SAVE_VERSION);
    const s = res.data.state;
    expect(s.day).toBe(800);
    expect(s.seed).toBe(fresh.seed);
    expect(Object.keys(s.citizens).length).toBe(3);
    expect(s.citizens.c_1_ab.health).toBeCloseTo(50);
    expect(s.citizens.c_1_ab.age).toBeCloseTo(100);
    expect(s.citizens.c_2_cd.parentIds).toEqual(['c_1_ab']);
    expect(s.citizens.c_3_ef.alive).toBe(false);
    const civ = Object.values(s.civs)[0];
    expect(civ).toBeTruthy();
    expect(civ.resources.food).toBe(33);
    expect(s.citizens.c_1_ab.civId).toBe(civ.id);
    expect(s.buildings.b_1_x.civId).toBe(civ.id);
    expect(s.buildings.b_1_x.health).toBeGreaterThan(0);
    expect(s.cells[cell].grass).toBeGreaterThan(0);
    expect(settlementsOf(s, civ.id).length).toBe(1);
    run(s, 24, 1); // migrated worlds simulate fine
    expect(s.citizens.c_1_ab.alive).toBe(true);
  });

  it('rejects invalid, corrupt and unsupported saves safely', () => {
    expect(importSave('not json {').error).toBeTruthy();
    expect(importSave('{}').error).toBeTruthy();
    expect(importSave(JSON.stringify({ version: 99, state: {} })).error).toMatch(/newer/i);
    expect(importSave(JSON.stringify({ version: 2, state: { cells: [] } })).error).toBeTruthy();
    expect(importSave(JSON.stringify({ version: 2, state: { cells: new Array(10), citizens: {} } })).error).toBeTruthy();
    expect(importSave(JSON.stringify(null)).error).toBeTruthy();
    const { s } = base();
    const ok = importSave(serialize(s, false));
    expect(ok.error).toBeUndefined();
    expect(ok.data?.state.name).toBe(s.name);
  });

  it('repairs dangling references instead of crashing', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { humans } = mkCiv(s, start, 3);
    const json = JSON.parse(serialize(s, false));
    json.state.citizens[humans[0].id].partnerId = 'ghost';
    json.state.citizens[humans[0].id].homeId = 'ghost-building';
    json.state.citizens[humans[1].id].civId = 'ghost-civ';
    const res = migrateSave(json);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.state.citizens[humans[0].id].partnerId).toBeNull();
      expect(res.data.state.citizens[humans[0].id].homeId).toBeNull();
      expect(res.data.state.citizens[humans[1].id].civId).toBeNull();
      run(res.data.state, 12);
    }
  });
});

describe('stability at high population', () => {
  it('stays bounded and finite with several factions, wildlife and a war', () => {
    const { s, start } = base(); flatten(s, start, 20);
    const civs = [0, 7, 14].map(dx => mkCiv(s, eastOf(start, dx), 40));
    for (const c of civs) { c.civ.resources.food = 200; c.civ.resources.wood = 200; c.civ.resources.foodCapacity = 400; makeSoldiers(c.civ, c.humans, 6); }
    for (let i = 0; i < 60; i++) createCreature(s, 'deer', eastOf(start, i % 12), { age: 40 });
    for (let i = 0; i < 80; i++) createCreature(s, 'rabbit', eastOf(start, i % 12), { age: 10 });
    for (let i = 0; i < 12; i++) createCreature(s, 'wolf', eastOf(start, (i % 6) + 2), { age: 60 });
    refreshCounts(s);
    declareWar(s, civs[0].civ, civs[1].civ, 'test');
    const t0 = Date.now();
    for (let i = 0; i < 24 * 4 * 5; i++) tick(s); // five game days
    const ms = Date.now() - t0;
    refreshCounts(s);
    expect(s.population).toBeLessThanOrEqual(CAPS.maxHumans);
    expect(Object.keys(s.creatures).length).toBeLessThanOrEqual(CAPS.maxWildlife);
    for (const c of Object.values(s.citizens)) { expect(Number.isFinite(c.health)).toBe(true); expect(c.cellId).toBeGreaterThanOrEqual(0); }
    expect(Number.isFinite(s.divineEnergy)).toBe(true);
    expect(ms / 480).toBeLessThan(60); // < 60ms average per tick even in a crowded war
    void createHuman; void cellIndex;
  }, 60000);
});

void foundCivilization;
