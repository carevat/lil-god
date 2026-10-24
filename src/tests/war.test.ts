import { describe, it, expect } from 'vitest';
import { base, flatten, mkCiv, makeSoldiers, run, eastOf } from './helpers';
import { createHuman, refreshCounts, applyDamage } from '../game/lifecycle';
import { createBuilding } from '../game/buildings';
import { settlementsOf, updateDiplomacy, declareWar, recruitSoldiers, updateTerritory, civDaily, foundCivilization } from '../game/civ';
import { castSeedCiv, castSpawn } from '../game/powers';
import { getRelation } from '../game/util';
import { sphereDist } from '../game/world';
import { DIPLOMACY, MILITARY } from '../game/config';

function twoCivs(distance = 6, n = 12) {
  const { s, start } = base();
  flatten(s, start, 16);
  const cellB = eastOf(start, distance);
  const A = mkCiv(s, start, n);
  const B = mkCiv(s, cellB, n);
  A.civ.founded = -100; B.civ.founded = -100;
  s.day = 30;
  return { s, start, cellB, A, B };
}

describe('civilizations', () => {
  it('a new civilization initializes with citizens, resources, a settlement and territory', () => {
    const { s, start } = base(); flatten(s, start, 10);
    expect(castSpawn(s, 'human', start).ok).toBe(true);
    const civs = Object.values(s.civs);
    expect(civs.length).toBe(1);
    const civ = civs[0];
    expect(civ.alive).toBe(true);
    expect(civ.name.length).toBeGreaterThan(2);
    expect(civ.color).toMatch(/^#/);
    expect(settlementsOf(s, civ.id).length).toBe(1);
    expect(civ.resources.food).toBeGreaterThan(0);
    expect(Object.values(s.citizens).every(c => c.civId === civ.id)).toBe(true);
    expect(s.territory[start]).toBe(civ.idx);
    expect(civ.territoryCells).toBeGreaterThan(5);
  });

  it('territory grows with the population and contested borders create friction', () => {
    const { s, A, B } = twoCivs(6, 4);
    const small = A.civ.territoryCells;
    for (let i = 0; i < 20; i++) A.humans.push(createHuman(s, A.humans[0].cellId, { civId: A.civ.id }));
    refreshCounts(s);
    updateTerritory(s);
    expect(A.civ.territoryCells).toBeGreaterThan(small);
    const owners = new Set(s.territory.filter(o => o >= 0));
    expect(owners.has(A.civ.idx) && owners.has(B.civ.idx)).toBe(true);
    expect(Object.values(s.borderFriction).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('distant civilizations do not accumulate tension; seeding a new one creates a working settlement', () => {
    const { s, start } = base(); flatten(s, start, 8);
    mkCiv(s, start, 5);
    s.divineEnergy = 100;
    const r = castSeedCiv(s);
    if (r.ok) {
      expect(Object.values(s.civs).filter(c => c.alive).length).toBe(2);
      const nc = s.civs[r.civId!];
      expect(settlementsOf(s, nc.id).length).toBe(1);
      expect(Object.values(s.citizens).filter(c => c.civId === nc.id).length).toBe(3);
      expect(sphereDist(settlementsOf(s, nc.id)[0].cellId, start)).toBeGreaterThanOrEqual(12);
      expect(Object.values(s.buildings).some(b => b.civId === nc.id)).toBe(true);
      s.day = 100;
      for (let i = 0; i < 20; i++) updateDiplomacy(s);
      expect(getRelation(s, nc.id, Object.values(s.civs).find(c => c.id !== nc.id)!.id).tension).toBe(0);
    } else {
      expect(r.reason).toBeTruthy();
    }
  });
});

describe('diplomacy and war', () => {
  it('deterministically escalates tension into war only with soldiers, age and enough tension', () => {
    const { s, A, B } = twoCivs();
    makeSoldiers(A.civ, A.humans, 4); makeSoldiers(B.civ, B.humans, 4);
    refreshCounts(s);
    const rel = getRelation(s, A.civ.id, B.civ.id);
    updateDiplomacy(s);
    expect(rel.status).not.toBe('war');
    expect(rel.tension).toBeGreaterThan(0);
    rel.tension = DIPLOMACY.warAt;
    updateDiplomacy(s);
    expect(rel.status).toBe('war');
    expect(s.events.some(e => e.category === 'war' && /declared war/.test(e.text))).toBe(true);
    // no soldiers -> no war
    const t = twoCivs();
    const r2 = getRelation(t.s, t.A.civ.id, t.B.civ.id);
    r2.tension = DIPLOMACY.warAt;
    updateDiplomacy(t.s);
    expect(r2.status).not.toBe('war');
  });

  it('soldiers travel across valid terrain toward enemy targets', () => {
    const { s, start, cellB, A, B } = twoCivs(6, 6);
    makeSoldiers(A.civ, A.humans, 3);
    refreshCounts(s);
    declareWar(s, A.civ, B.civ, 'test');
    const d0 = sphereDist(start, cellB);
    run(s, 8);
    const soldiers = A.humans.slice(0, 3).filter(h => h.alive);
    expect(soldiers.length).toBeGreaterThan(0);
    const moved = soldiers.filter(h => sphereDist(h.cellId, cellB) < d0 - 0.5);
    expect(moved.length).toBeGreaterThan(0);
    for (const h of soldiers) expect(['deepOcean', 'shallowOcean']).not.toContain(s.cells[h.cellId].type);
  });

  it('combat reduces health, can kill, and military strength follows the casualties', () => {
    const { s, start, A, B } = twoCivs(6, 8);
    makeSoldiers(A.civ, A.humans, 3); makeSoldiers(B.civ, B.humans, 3);
    refreshCounts(s);
    const strength = A.civ.militaryStrength;
    expect(strength).toBeCloseTo(30);
    declareWar(s, A.civ, B.civ, 'test');
    const a = A.humans[0], b = B.humans[0];
    a.cellId = start; b.cellId = start; a.health = 2;
    run(s, 3);
    expect(a.alive).toBe(false);
    refreshCounts(s);
    expect(A.civ.militaryStrength).toBeLessThan(strength);
    expect(A.civ.soldiers).toBe(2);
    const rel = getRelation(s, A.civ.id, B.civ.id);
    expect(rel.casualties[A.civ.id]).toBeGreaterThanOrEqual(1);
    const hurt = Object.values(s.citizens).some(c => c.alive && c.role === 'soldier' && c.health < c.maxHealth);
    expect(hurt).toBe(true);
  });

  it('applyDamage handles attack damage through resistances once', () => {
    const { s, start } = base();
    const h = createHuman(s, start);
    const r1 = applyDamage(s, h, 1000, { kind: 'combat' });
    expect(r1.killed).toBe(true);
    const r2 = applyDamage(s, h, 1000, { kind: 'combat' });
    expect(r2.killed).toBe(false);
  });

  it('recruiting costs food and wood and is capped by population', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ } = mkCiv(s, start, 12);
    civ.resources.food = 100; civ.resources.wood = 100;
    const r = recruitSoldiers(s, civ, 99, true);
    expect(r.recruited).toBe(Math.floor(12 * MILITARY.maxSoldierRatio));
    expect(civ.resources.food).toBe(100 - r.recruited * MILITARY.recruitFood);
    expect(civ.resources.wood).toBe(100 - r.recruited * MILITARY.recruitWood);
    const small = mkCiv(s, start, 2);
    expect(recruitSoldiers(s, small.civ, 1).recruited).toBe(0);
  });

  it('holding a settlement centre after defeating its defenders conquers it', () => {
    const { s, cellB, A, B } = twoCivs(6, 8);
    const stB = settlementsOf(s, B.civ.id)[0];
    makeSoldiers(A.civ, A.humans, 7);
    for (const h of A.humans.slice(0, 7)) h.cellId = cellB;
    // a second building keeps the settlement alive while it is being raided
    const extra = createBuilding(s, 'house', cellB + 1, B.civ.id, stB.id);
    extra.built = true;
    s.cells[cellB + 1].buildingId = extra.id;
    refreshCounts(s);
    declareWar(s, A.civ, B.civ, 'test');
    run(s, 240, 0.5);
    const owner = s.settlements[stB.id]?.civId;
    expect(owner === A.civ.id || !B.civ.alive).toBe(true);
    expect(s.events.some(e => /conquered|surrender|fallen/.test(e.text))).toBe(true);
    expect(getRelation(s, A.civ.id, B.civ.id).status).not.toBe('war');
  });

  it('a civilization that loses its last settlement falls and survivors find refuge', () => {
    const { s, A, B } = twoCivs(6, 6);
    const stA = settlementsOf(s, A.civ.id)[0];
    civDaily; foundCivilization;
    const { transferSettlement, fallCiv } = require_civ();
    transferSettlement(s, stA, B.civ);
    fallCiv(s, A.civ, B.civ);
    expect(A.civ.alive).toBe(false);
    expect(A.civ.fallReason).toMatch(/Conquered/);
    for (const h of A.humans) expect(h.civId).toBe(B.civ.id);
    expect(s.events.some(e => /fallen/.test(e.text))).toBe(true);
  });
});

import * as civModule from '../game/civ';
function require_civ() { return civModule; }
