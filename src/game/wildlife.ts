// Wildlife: data-driven behaviour profiles (grazer / predator / guardian) and ecosystem reproduction.

import type { WorldState, Creature, Living, TerrainCell, SpeciesId } from './types';
import { SPECIES, type SpeciesDef } from './species';
import { HOURS_PER_DAY } from './config';
import { speciesCapacity, wildlifeCapacity } from './scale';
import { rand, randInt, logEvent } from './util';
import { applyDamage, killEntity, lifeStage, createCreature, getEntity } from './lifecycle';
import { beginAttack } from './combat';
import { moveEntity, stepTo, stepToward } from './pathing';
import { neighbors, cellDistance, sphereDist } from './world';
import { nearestWhere, queryNear, type Ctx } from './context';
import { civByIdx } from './civ';

const stepFn = (sp: SpeciesDef) => (c: TerrainCell) => sp.habitat.includes(c.type);

export function updateWildlife(s: WorldState, ctx: Ctx, dt: number): void {
  const dtDays = dt / HOURS_PER_DAY;
  const leaders = new Map<string, Creature>();
  for (const w of ctx.creatures) if (w.packId && !leaders.has(w.packId)) leaders.set(w.packId, w);

  for (const w of ctx.creatures) {
    if (!w.alive) continue;
    const sp = SPECIES[w.species];
    w.age += dtDays;
    w.reproCooldown = Math.max(0, w.reproCooldown - dtDays);
    if (w.age >= w.maxAge) { killEntity(s, w, 'old age'); continue; }
    if (sp.hungerRate > 0) {
      w.hunger = Math.min(1, w.hunger + sp.hungerRate * dt);
      if (w.hunger > 0.9) {
        applyDamage(s, w, 0.8 * dt, { kind: 'hunger' });
        if (!w.alive) continue;
      } else if (w.hunger < 0.5 && w.health < w.maxHealth) w.health = Math.min(w.maxHealth, w.health + 0.3 * dt);
    }
    w.attackCd = Math.max(0, w.attackCd - dt);
    w.thinkTimer -= dt;
    const stage = lifeStage(w);
    moveEntity(s, w, dt, sp.moveSpeed * (stage === 'child' ? 0.6 : 1));
    if (w.targetCellId !== null) continue;
    const urgent = w.task === 'hunt' || w.task === 'flee' || w.task === 'guard';
    if (!urgent && w.thinkTimer > 0) continue;

    switch (sp.behavior) {
      case 'grazer': grazer(s, ctx, w, sp); break;
      case 'predator': predator(s, ctx, w, sp, leaders); break;
      case 'guardian': guardian(s, ctx, w, sp); break;
      default: break;
    }
  }
}

function randomStep(s: WorldState, w: Creature, sp: SpeciesDef, prob: number) {
  if (rand(s) > prob) return;
  const ns = neighbors(w.cellId, s).filter(n => stepFn(sp)(s.cells[n]));
  if (ns.length) stepTo(w, ns[Math.floor(rand(s) * ns.length)]);
}

function grazer(s: WorldState, ctx: Ctx, w: Creature, sp: SpeciesDef): void {
  w.thinkTimer = 0.4 + rand(s) * 0.4;
  const cell = s.cells[w.cellId];
  const threat = nearestWhere(ctx, w.cellId, sp.vision, e => e.species === 'wolf', w);
  if (threat) {
    let best = -1, bd = sphereDist(w.cellId, threat.cellId, s);
    for (const n of neighbors(w.cellId, s)) {
      if (!stepFn(sp)(s.cells[n])) continue;
      const d = sphereDist(n, threat.cellId, s);
      if (d > bd) { bd = d; best = n; }
    }
    w.task = 'flee';
    w.thinkTimer = 0;
    if (best >= 0) stepTo(w, best);
    return;
  }
  if (w.task === 'flee') w.task = 'idle';
  if (w.hunger > 0.3 && cell.grass > 0.1) {
    const amt = Math.min(cell.grass, sp.grazeRate * 0.5);
    cell.grass -= amt;
    w.hunger = Math.max(0, w.hunger - amt / sp.grassPerHunger);
    w.task = 'graze';
    return;
  }
  if (w.hunger > 0.3) {
    let best = -1, bg = cell.grass;
    for (const n of neighbors(w.cellId, s)) {
      const nc = s.cells[n];
      if (stepFn(sp)(nc) && nc.grass > bg) { bg = nc.grass; best = n; }
    }
    w.task = 'wander';
    if (best >= 0) stepTo(w, best); else randomStep(s, w, sp, 1);
    return;
  }
  w.task = 'idle';
  // Herd cohesion: drift back toward companions so mates can find each other
  const mate = nearestWhere(ctx, w.cellId, 9, e => e.species === w.species && lifeStage(e) === 'adult', w);
  if (mate && cellDistance(w.cellId, mate.cellId, s) > 2 && rand(s) < 0.6) {
    stepToward(s, w, mate.cellId, stepFn(sp));
    return;
  }
  randomStep(s, w, sp, 0.5);
}

function predator(s: WorldState, ctx: Ctx, w: Creature, sp: SpeciesDef, leaders: Map<string, Creature>): void {
  w.thinkTimer = 0.3 + rand(s) * 0.3;
  // Feeding: if the prey we were hunting is dead, we eat our fill (less when the pack shares).
  if (w.targetEntityId && !getEntity(s, w.targetEntityId)) {
    // Our prey is gone: predators eat where the kill fell, less when the pack shares.
    if (w.task === 'hunt') {
      const rivals = queryNear(ctx, w.cellId, 3, e => e.species === 'wolf' && e !== w).length;
      w.hunger = Math.max(0, w.hunger - ((w.species === 'wolf' ? 0.7 : 0.3) / (1 + 0.4 * rivals)));
      logEvent(s, 'ecology', 'Wolves brought down their prey.', { key: 'predation', windowDays: 6 });
    }
    w.targetEntityId = null; w.task = 'idle';
    return;
  }
  if (w.hunger > 0.45) {
    const prey = nearestWhere(ctx, w.cellId, sp.vision, e => e.species === 'deer' || e.species === 'rabbit', w);
    if (prey) {
      w.task = 'hunt'; w.targetEntityId = prey.id; w.thinkTimer = 0;
      if (cellDistance(w.cellId, prey.cellId, s) <= 1.5) beginAttack(s, w, prey, 'predator');
      else stepToward(s, w, prey.cellId, stepFn(sp));
      return;
    }
  }
  w.task = w.targetEntityId ? 'hunt' : 'roam';
  const leader = w.packId ? leaders.get(w.packId) : undefined;
  if (leader && leader !== w && leader.alive && cellDistance(w.cellId, leader.cellId, s) > 3) {
    stepToward(s, w, leader.cellId, stepFn(sp));
    return;
  }
  randomStep(s, w, sp, leader === w || !leader ? 0.6 : 0.3);
}

function guardian(s: WorldState, ctx: Ctx, w: Creature, sp: SpeciesDef): void {
  w.thinkTimer = 0.4;
  const owner = civByIdx(s, s.territory[w.cellId]);
  const enemies = owner ? ctx.enemies[owner.id] ?? [] : [];
  const threat = nearestWhere(ctx, w.cellId, sp.vision, e => {
    if (e.species === 'wolf') return true;
    if (e.species === 'human') { const h = e as Living & { civId?: string | null }; return !!h.civId && enemies.includes(h.civId); }
    return false;
  }, w);
  if (threat && cellDistance(threat.cellId, w.homeCell, s) <= 9) {
    w.task = 'guard'; w.thinkTimer = 0;
    if (cellDistance(w.cellId, threat.cellId, s) <= 1.5) beginAttack(s, w, threat, 'combat');
    else stepToward(s, w, threat.cellId, stepFn(sp));
    return;
  }
  w.task = 'idle';
  if (cellDistance(w.cellId, w.homeCell, s) > 4) stepToward(s, w, w.homeCell, stepFn(sp));
  else randomStep(s, w, sp, 0.2);
}

export function updateWildlifeRepro(s: WorldState, ctx: Ctx, dt: number): void {
  const dtDays = dt / HOURS_PER_DAY;
  for (const w of ctx.creatures) {
    if (!w.alive || w.gender !== 'f') continue;
    const sp = SPECIES[w.species];
    if (sp.birthChancePerDay <= 0 || w.reproCooldown > 0 || lifeStage(w) !== 'adult' || w.hunger > 0.4) continue;
    const cap = speciesCapacity(s, w.species);
    const count = s.speciesCounts[w.species];
    if (count >= cap || Object.keys(s.creatures).length >= wildlifeCapacity(s)) continue;
    const chance = sp.birthChancePerDay * dtDays * (1 - count / cap);
    if (rand(s) >= chance) continue;
    const mate = nearestWhere(ctx, w.cellId, 3, e => e.species === w.species && e.gender === 'm' && lifeStage(e) === 'adult' && e.hunger < 0.6, w);
    if (!mate) continue;
    if (queryNear(ctx, w.cellId, 4, e => e.species === w.species).length >= sp.localCap) continue;
    if (sp.diet === 'herbivore') {
      if (s.cells[w.cellId].grass < 0.25) continue;
    } else if (sp.diet === 'carnivore') {
      if (queryNear(ctx, w.cellId, 8, e => e.species === 'deer' || e.species === 'rabbit').length < 3) continue;
    }
    const litter = Math.min(randInt(s, sp.litter[0], sp.litter[1]), cap - count);
    for (let i = 0; i < litter; i++) createCreature(s, w.species as Exclude<SpeciesId, 'human'>, w.cellId, { age: 0, packId: w.packId, parents: [w.id, mate.id] });
    w.reproCooldown = sp.cooldownDays;
    w.hunger = Math.min(1, w.hunger + 0.15);
    if (w.species === 'deer' || w.species === 'wolf') {
      logEvent(s, 'ecology', `${sp.label} young were born.`, { key: `wbirth:${w.species}`, windowDays: 15 });
    }
  }
}

/** Rate-limited milestones and decline warnings for every species. */
export function checkPopulationEvents(s: WorldState): void {
  for (const id of Object.keys(SPECIES) as SpeciesId[]) {
    if (id === 'golem') continue;
    const sp = SPECIES[id];
    const n = s.speciesCounts[id];
    for (const t of [10, 25, 50, 100, 200]) {
      if (n >= t) logEvent(s, 'milestone', `${sp.label} reached a population of ${t}.`, { key: `pop:${id}:${t}`, windowDays: 1e9 });
    }
    const peak = Math.max(s.peaks[id] ?? 0, n);
    s.peaks[id] = peak;
    if (peak >= 10 && n <= peak * 0.5) {
      if (logEvent(s, id === 'human' ? 'death' : 'ecology', `${sp.label} are in decline: ${n} remain, down from ${peak}.`, { key: `decline:${id}`, windowDays: 20 })) {
        s.peaks[id] = n;
      }
    }
  }
}
