import { describe, expect, it } from 'vitest';
import { base, flatten, mkCiv, run } from './helpers';
import { HUMAN_HABITAT, SUCCESSION, HOURS_PER_DAY } from '../game/config';
import { canPlaceSpecies, castSpawn, castSeedCiv } from '../game/powers';
import { createHuman, createCreature, killEntity, refreshCounts } from '../game/lifecycle';
import { findStartingCell, findHumanSpawnCells, isHumanSpawnCell, generateWorld, GRID_H, GRID_W } from '../game/world';
import { foundSettlement, foundCivilization, createCivilization, findSeedSite, findColonySite } from '../game/civ';
import { giveBirth } from '../game/humans';
import { refreshLeadership, highestLiving, roleOf } from '../game/authority';
import { serialize } from '../game/persistence';
import { migrateSave, SAVE_VERSION } from '../game/migrate';
import { advanceClock } from '../game/clock';
import { tick } from '../game/simulation';
import { SPECIES } from '../game/species';

function polarLand() {
  const { s, start } = base(41);
  flatten(s, start, 8);
  const north = 3 * GRID_W + 12;
  const south = (GRID_H - 4) * GRID_W + 12;
  for (const id of [north, south]) {
    const c = s.cells[id];
    c.type = 'plains'; c.fertility = 0.9; c.elevation = 0.2; c.grass = 0.8; c.crater = 0;
    c.buildingId = null;
  }
  return { s, start, north, south };
}

function rulingCiv(n = 5) {
  const { s, start } = base(28);
  flatten(s, start, 8);
  const { civ, humans } = mkCiv(s, start, n);
  for (const h of humans) h.authority = 2;
  humans[0].authority = 90;
  humans[1].authority = 70;
  refreshLeadership(s, civ.id);
  return { s, start, civ, humans, king: humans[0], heir: humans[1] };
}

describe('human polar exclusion', () => {
  it('uses normalized spherical latitude and excludes the outer 18% on both sides', () => {
    const { s, north, south } = polarLand();
    expect(s.cells[north].lat).toBeGreaterThan(HUMAN_HABITAT.northLimit);
    expect(s.cells[south].lat).toBeLessThan(HUMAN_HABITAT.southLimit);
    expect(isHumanSpawnCell(s.cells[north])).toBe(false);
    expect(isHumanSpawnCell(s.cells[south])).toBe(false);
    const edge = s.cells.find(c => c.lat <= HUMAN_HABITAT.northLimit && c.lat >= HUMAN_HABITAT.southLimit && isHumanSpawnCell(c));
    expect(edge).toBeTruthy();
  });

  it('initial starting areas are habitable for many seeds and presets', () => {
    for (const preset of ['balanced', 'lush', 'harsh'] as const) {
      for (const seed of [1, 2, 13, 42, 99, 1234]) {
        const { cells } = generateWorld(seed, preset);
        const start = findStartingCell(cells, seed);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(isHumanSpawnCell(cells[start])).toBe(true);
      }
    }
  });

  it('polar clicks relocate initial and later humans, with feedback and no polar settlement', () => {
    for (const pole of ['north', 'south'] as const) {
      const { s, [pole]: target } = polarLand();
      const first = castSpawn(s, 'human', target);
      expect(first.ok).toBe(true);
      expect(first.cellId).not.toBe(target);
      expect(first.created).toBe(3);
      expect(s.notices.some(n => /polar region/.test(n.text))).toBe(true);
      expect(Object.values(s.citizens).every(c => isHumanSpawnCell(s.cells[c.cellId]))).toBe(true);
      expect(Object.values(s.settlements).every(st => isHumanSpawnCell(s.cells[st.cellId]))).toBe(true);
      s.divineEnergy = 100;
      const later = castSpawn(s, 'human', target);
      expect(later.ok).toBe(true);
      expect(Object.values(s.citizens).every(c => isHumanSpawnCell(s.cells[c.cellId]))).toBe(true);
    }
  });

  it('direct creation, founding, and new civilization seeding obey the same rule', () => {
    const { s, north, south, start } = polarLand();
    const h = createHuman(s, north);
    expect(isHumanSpawnCell(s.cells[h.cellId])).toBe(true);
    const civ = createCivilization(s);
    expect(() => foundSettlement(s, civ, south)).toThrow(/polar/);
    const civsBefore = Object.keys(s.civs).length;
    expect(() => foundCivilization(s, north, [h])).toThrow(/polar/);
    expect(Object.keys(s.civs)).toHaveLength(civsBefore);
    const { civ: existing } = mkCiv(s, start, 3);
    existing.resources.food = 100; existing.resources.wood = 100;
    const seedSite = findSeedSite(s);
    if (seedSite !== null) expect(isHumanSpawnCell(s.cells[seedSite])).toBe(true);
    const r = castSeedCiv(s);
    if (r.ok) expect(Object.values(s.settlements).every(st => isHumanSpawnCell(s.cells[st.cellId]))).toBe(true);
    const colony = findColonySite(s, existing);
    if (colony !== null) expect(isHumanSpawnCell(s.cells[colony])).toBe(true);
  });

  it('natural births near a pole use the same fallback without altering the mother', () => {
    const { s, north, start } = polarLand();
    const { civ, humans } = mkCiv(s, start, 2);
    const [female, male] = humans[0].gender === 'f' ? [humans[0], humans[1]] : [humans[1], humans[0]];
    female.cellId = north; male.cellId = north;
    female.partnerId = male.id; male.partnerId = female.id;
    civ.resources.food = 100;
    civ.housing.capacity = 8;
    const baby = giveBirth(s, female);
    expect(baby).toBeTruthy();
    expect(isHumanSpawnCell(s.cells[baby!.cellId])).toBe(true);
    expect(female.cellId).toBe(north); // existing polar inhabitants are not moved
  });

  it('bounded fallback refuses creation if no non-polar habitat exists, without charging energy', () => {
    const { s, north } = polarLand();
    for (const c of s.cells) if (isHumanSpawnCell(c)) c.type = 'deepOcean';
    expect(findHumanSpawnCells(s.cells, north, 3)).toEqual([]);
    const energy = s.divineEnergy;
    const r = castSpawn(s, 'human', north);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/habitable|ocean/i);
    expect(s.divineEnergy).toBe(energy);
    expect(() => createHuman(s, north)).toThrow(/non-polar/);
    expect(Object.values(s.citizens)).toHaveLength(0);
    expect(Object.values(s.civs)).toHaveLength(0);
  });

  it('wildlife is unaffected by the human-only restriction', () => {
    const { s, north } = polarLand();
    flatten(s, north, 2); // enough grassy room for a herd
    expect(SPECIES.deer.habitat).toContain('plains');
    expect(canPlaceSpecies(s, 'deer', north).ok).toBe(true);
    expect(castSpawn(s, 'deer', north).ok).toBe(true);
    expect(Object.values(s.creatures).some(w => w.cellId === north)).toBe(true);
    const wolf = createCreature(s, 'wolf', north);
    expect(wolf.cellId).toBe(north);
  });

  it('existing polar humans and settlements survive migration and continue moving normally', () => {
    const { s, start, north } = polarLand();
    const { civ, humans } = mkCiv(s, start, 3);
    humans[0].cellId = north;
    s.settlements[civ.capitalId!].cellId = north;
    const raw = JSON.parse(serialize(s, false));
    raw.version = 3; // old save, no succession data
    delete raw.state.civs[civ.id].succession;
    const loaded = migrateSave(raw);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.data.version).toBe(SAVE_VERSION);
    expect(loaded.data.state.citizens[humans[0].id].cellId).toBe(north);
    expect(loaded.data.state.settlements[civ.capitalId!].cellId).toBe(north);
    run(loaded.data.state, 2);
    expect(loaded.data.state.citizens[humans[0].id].alive).toBe(true);
    expect(loaded.data.state.civs[civ.id].kingId).toBeTruthy();
  });
});

describe('royal succession crisis', () => {
  it('starts once on royal death, designates the highest living human, and interrupts normal work', () => {
    const { s, civ, humans, king, heir } = rulingCiv();
    humans[2].task = 'chop'; humans[2].taskId = null;
    const before = s.stats.deaths;
    killEntity(s, king, 'combat');
    expect(s.stats.deaths).toBe(before + 1);
    expect(civ.succession.phase).toBe('panic');
    expect(civ.kingId).toBeNull();
    expect(civ.succession.successorId).toBe(heir.id);
    expect(humans[2].task).toBe('panic');
    const crisisEvents = s.events.filter(e => /reel from the death/.test(e.text)).length;
    killEntity(s, king, 'combat');
    refreshLeadership(s, civ.id);
    expect(s.events.filter(e => /reel from the death/.test(e.text)).length).toBe(crisisEvents);
    expect(s.stats.deaths).toBe(before + 1);
  });

  it('citizens run in varied directions, calm progressively, then resume routines', () => {
    const { s, civ, humans, king, heir } = rulingCiv(7);
    killEntity(s, king, 'test');
    const startCells = humans.slice(1).map(c => c.cellId);
    tick(s, 0.25);
    expect(humans.slice(1).every(c => c.task === 'panic')).toBe(true);
    const targets = humans.slice(1).map(c => c.targetCellId);
    expect(new Set(targets).size).toBeGreaterThan(1);
    run(s, SUCCESSION.panicHours / 2);
    expect(humans.slice(1).some((c, i) => c.cellId !== startCells[i])).toBe(true);
    for (const c of humans.slice(1)) expect(s.cells[c.cellId].type).not.toMatch(/Ocean/);
    run(s, SUCCESSION.panicHours);
    expect(civ.succession.phase).toBe('stable');
    expect(civ.kingId).toBe(heir.id);
    expect(humans.slice(1).every(c => c.task !== 'panic')).toBe(true);
    expect(s.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(1);
    expect(s.fx.filter(f => f.type === 'coronation')).toHaveLength(1);
  });

  it('reselects the heir after death, emigration, or the arrival of a higher-authority baby', () => {
    for (const change of ['death', 'emigration', 'baby'] as const) {
      const { s, start, civ, king, heir, humans } = rulingCiv();
      killEntity(s, king, 'test');
      if (change === 'death') killEntity(s, heir, 'test');
      if (change === 'emigration') { heir.civId = null; refreshLeadership(s, civ.id); }
      let child;
      if (change === 'baby') {
        child = createHuman(s, start, { age: 0, civId: civ.id });
        child.authority = 99;
        refreshLeadership(s, civ.id);
      }
      const expected = change === 'baby' ? child : highestLiving(s, civ.id);
      expect(civ.succession.successorId).toBe(expected?.id ?? null);
      run(s, SUCCESSION.panicHours + 0.5);
      expect(civ.kingId).toBe(expected?.id ?? null);
      expect(s.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(1);
      expect(humans[0].alive).toBe(false);
    }
  });

  it('cancels cleanly if the civilization becomes extinct during panic', () => {
    const { s, civ, humans, king } = rulingCiv(3);
    killEntity(s, king, 'test');
    for (const c of humans.slice(1)) killEntity(s, c, 'test');
    refreshCounts(s);
    tick(s);
    expect(civ.succession.phase).toBe('stable');
    expect(civ.kingId).toBeNull();
    expect(s.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(0);
    expect(s.events.filter(e => /reel from the death/.test(e.text))).toHaveLength(1);
  });

  it('round-trips an active panic without duplicate announcements or resetting its clock', () => {
    const { s, civ, king, heir } = rulingCiv();
    killEntity(s, king, 'test');
    run(s, SUCCESSION.panicHours / 2);
    const started = civ.succession.startedDay;
    const savedHistory = s.events.length;
    const result = migrateSave(JSON.parse(serialize(s, true)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const loaded = result.data.state;
    expect(loaded.civs[civ.id].succession.phase).toBe('panic');
    expect(loaded.civs[civ.id].succession.successorId).toBe(heir.id);
    expect(loaded.civs[civ.id].succession.startedDay).toBeCloseTo(started, 3);
    expect(loaded.civs[civ.id].kingId).toBeNull();
    expect(loaded.events).toHaveLength(savedHistory);
    run(loaded, SUCCESSION.panicHours / 2 + 1);
    expect(loaded.civs[civ.id].kingId).toBe(heir.id);
    expect(loaded.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(1);
    run(loaded, 10);
    expect(loaded.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(1);
  });

  it('resolves using the accelerated fixed-step clock without skipping the coronation', () => {
    const { s, civ, king, heir } = rulingCiv();
    killEntity(s, king, 'test');
    let acc = 0;
    for (let i = 0; i < 20; i++) {
      acc = advanceClock(s, 100, 8, acc).acc; // two real seconds = sixteen game hours
    }
    expect((s.day - civ.succession.startedDay) * HOURS_PER_DAY).toBeGreaterThanOrEqual(0);
    expect(civ.succession.phase).toBe('stable');
    expect(civ.kingId).toBe(heir.id);
    expect(roleOf(s, heir)).toBe('king');
    expect(s.events.filter(e => /period of chaos/.test(e.text))).toHaveLength(1);
  });
});