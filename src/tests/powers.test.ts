import { describe, it, expect } from 'vitest';
import { base, flatten, mkCiv, makeSoldiers, run } from './helpers';
import { cellIndex } from '../game/world';
import { createHuman, createCreature, refreshCounts } from '../game/lifecycle';
import { castLightning, castMeteor, castShower, cancelShower, updateMeteors, castTerraform, castSpawn, tickCooldowns, castNature } from '../game/powers';
import { createBuilding, canBuildOn } from '../game/buildings';
import { settlementsOf } from '../game/civ';
import { tick } from '../game/simulation';
import { METEOR } from '../game/config';

const T = cellIndex(10, 24); // equator row: neighbouring columns are ~1 cell apart
const col = (dx: number) => cellIndex(10 + dx, 24);

function arena() {
  const { s } = base();
  flatten(s, T, 9);
  return s;
}

describe('divine energy', () => {
  it('regenerates over simulated time and enforces costs', () => {
    const s = arena();
    s.divineEnergy = 10;
    run(s, 10);
    expect(s.divineEnergy).toBeCloseTo(15, 1);
    s.divineEnergy = 5;
    const h = createHuman(s, T);
    const r = castLightning(s, T);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/energy/i);
    expect(h.alive).toBe(true);
    expect(s.divineEnergy).toBe(5);
  });

  it('enforces cooldowns, which recharge with time', () => {
    const s = arena();
    expect(castLightning(s, T).ok).toBe(true);
    const e = s.divineEnergy;
    const again = castLightning(s, T);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/recharging/i);
    expect(s.divineEnergy).toBe(e);
    tickCooldowns(s, 1);
    expect(castLightning(s, T).ok).toBe(true);
  });
});

describe('lightning', () => {
  it('a direct strike kills; damage falls off with distance; outside the radius nothing happens', () => {
    const s = arena();
    const hs = [0, 1, 2, 5].map(d => createHuman(s, col(d)));
    castLightning(s, T);
    expect(hs[0].alive).toBe(false);
    expect(hs[0].deathCause).toBe('lightning');
    const [, near, mid, far] = hs;
    expect(near.health).toBeLessThan(mid.health);
    expect(mid.health).toBeLessThan(mid.maxHealth);
    expect(mid.alive).toBe(true);
    expect(far.health).toBe(far.maxHealth);
    expect(s.stats.lightningKills).toBeGreaterThanOrEqual(1);
    expect(s.events.some(e => /lightning/i.test(e.text) && e.category === 'death')).toBe(true);
  });

  it('killing a soldier removes its military strength and frees references', () => {
    const s = arena();
    const { civ, humans } = mkCiv(s, T, 4);
    makeSoldiers(civ, humans, 3);
    refreshCounts(s);
    expect(civ.militaryStrength).toBeCloseTo(30);
    castLightning(s, T);
    refreshCounts(s);
    expect(civ.soldiers).toBe(0);
    expect(civ.militaryStrength).toBe(0);
    for (const h of humans) { expect(h.alive).toBe(false); expect(h.homeId).toBeNull(); }
    run(s, 6);
    expect(Object.values(s.citizens).every(c => !c.alive)).toBe(true);
  });

  it('golems resist but are not immune', () => {
    const s = arena();
    const g = createCreature(s, 'golem', T, { age: 0 });
    castLightning(s, T);
    expect(g.alive).toBe(true);
    expect(g.health).toBeLessThan(g.maxHealth);
  });

  it('damages buildings and scorches the earth', () => {
    const s = arena();
    const { civ } = mkCiv(s, col(4), 2);
    const st = settlementsOf(s, civ.id)[0];
    const b = createBuilding(s, 'shelter', T, civ.id, st.id);
    castLightning(s, T);
    expect(s.buildings[b.id]).toBeUndefined();
    expect(s.cells[T].scorch).toBeGreaterThan(0.5);
  });
});

describe('meteors', () => {
  it('require energy, strike after a warning, and obey radial falloff', () => {
    const s = arena();
    s.divineEnergy = 20;
    expect(castMeteor(s, T).ok).toBe(false);
    expect(s.meteors.length).toBe(0);
    s.divineEnergy = 100;
    const hs = [0, 2, 3, 6].map(d => createHuman(s, col(d)));
    expect(castMeteor(s, T).ok).toBe(true);
    expect(s.meteors.length).toBe(1);
    updateMeteors(s, 0.5);
    expect(hs[0].alive).toBe(true); // still falling
    updateMeteors(s, METEOR.warnHours);
    expect(s.meteors.length).toBe(0);
    expect(hs[0].alive).toBe(false);
    expect(hs[1].alive).toBe(false);
    expect(hs[2].alive).toBe(true);
    expect(hs[2].health).toBeLessThan(hs[2].maxHealth);
    expect(hs[3].health).toBe(hs[3].maxHealth);
    expect(s.impacts.length).toBe(1);
    expect(s.events.some(e => e.category === 'meteor')).toBe(true);
  });

  it('leave craters that block building, hurt fertility and destroy buildings and trees', () => {
    const s = arena();
    const { civ } = mkCiv(s, col(7), 2);
    const st = settlementsOf(s, civ.id)[0];
    const b = createBuilding(s, 'house', T, civ.id, st.id);
    s.cells[T].trees = 3; s.cells[T].maxTrees = 3;
    const fert = s.cells[T].fertility;
    castMeteor(s, T);
    updateMeteors(s, METEOR.warnHours + 0.1);
    expect(s.buildings[b.id]).toBeUndefined();
    expect(s.cells[T].trees).toBe(0);
    expect(s.cells[T].fertility).toBeLessThan(fert);
    expect(s.cells[T].crater).toBeGreaterThan(0.8);
    expect(canBuildOn(s, T, 'house')).toBe(false);
    expect(s.dust).toBeGreaterThan(0);
    expect(s.cells[T].type).toBe('plains'); // geometry/terrain type intact
    // craters slowly recover but leave a permanent scar
    run(s, 24 * 400, 4);
    expect(s.cells[T].crater).toBeGreaterThan(0.15);
    expect(s.cells[T].crater).toBeLessThan(0.9);
  });

  it('showers use a finite number of distinct impacts and can be cancelled', () => {
    const s = arena();
    expect(castShower(s, T).ok).toBe(true);
    for (let i = 0; i < 100; i++) updateMeteors(s, 0.1);
    expect(s.impacts.length).toBe(METEOR.showerCount);
    expect(new Set(s.impacts.map(i => i.cellId)).size).toBeGreaterThan(3);
    expect(s.showers.length).toBe(0);
    // cancel
    s.impacts = []; s.powerCd = {}; s.divineEnergy = 100;
    castShower(s, T);
    updateMeteors(s, 0.1);
    expect(cancelShower(s).ok).toBe(true);
    for (let i = 0; i < 100; i++) updateMeteors(s, 0.1);
    expect(s.impacts.length).toBeLessThan(METEOR.showerCount);
    expect(s.showers.length).toBe(0);
    // history is not spammed: one start + one end event
    expect(s.events.filter(e => e.category === 'meteor').length).toBeLessThan(8);
  });
});

describe('other powers', () => {
  it('terraform keeps the map valid and relocates entities from drowned land', () => {
    const s = arena();
    const c = s.cells[T];
    c.elevation = 0.1; c.type = 'plains';
    const h = createHuman(s, T);
    for (let i = 0; i < 4; i++) { s.powerCd = {}; castTerraform(s, T, false); }
    expect(['shallowOcean', 'deepOcean']).toContain(c.type);
    expect(h.alive).toBe(true);
    expect(h.cellId).not.toBe(T);
    expect(c.elevation).toBeGreaterThanOrEqual(-1);
    // cannot reshape beneath a building
    const { civ } = mkCiv(s, col(5), 2);
    const b = createBuilding(s, 'shelter', col(5), civ.id, settlementsOf(s, civ.id)[0].id);
    expect(castTerraform(s, b.cellId, true).ok).toBe(false);
  });

  it('nature never stacks unlimited trees', () => {
    const s = arena();
    for (let i = 0; i < 30; i++) { s.powerCd = {}; s.divineEnergy = 100; castNature(s, T); }
    for (const id of [T, col(1)]) expect(s.cells[id].trees).toBeLessThanOrEqual(s.cells[id].maxTrees + 2);
  });

  it('first life creates three citizens in the normal simulation', () => {
    const s = arena();
    const r = castSpawn(s, 'human', T);
    expect(r.ok).toBe(true);
    expect(Object.values(s.citizens).length).toBe(3);
    expect(Object.keys(s.civs).length).toBe(1);
    tick(s);
    expect(s.population).toBe(3);
  });
});
