// Human citizens: needs, civilian AI, families, reproduction and construction planning.

import type { WorldState, Citizen, Civilization, Building, BuildingType, LifeStage } from './types';
import { LIFE, HOURS_PER_DAY } from './config';
import { SPECIES } from './species';
import { rand, logEvent, emitFx, clamp } from './util';
import { applyDamage, killEntity, lifeStage, getEntity, createHuman } from './lifecycle';
import { routeTo, moveEntity, nearestCell, stepToward } from './pathing';
import { beginAttack, hasAttack } from './combat';
import { neighbors, cellDistance, isWaterType, findHumanSpawnCells } from './world';
import { nearestWhere, type Ctx } from './context';
import { updateSoldier, settlementsOf, aliveCivs, civLog } from './civ';
import { canAfford, placeBuilding, applyBuildingComplete, ownerOK } from './buildings';
import { moveInPanic } from './authority';
import { humanCapacity } from './scale';

const HEAVY = new Set(['chop', 'build', 'farm', 'mine', 'raid', 'fight', 'march']);

export function updateHumans(s: WorldState, ctx: Ctx, dt: number): void {
  const sp = SPECIES.human;
  const dtDays = dt / HOURS_PER_DAY;
  for (const c of ctx.humans) {
    if (!c.alive) continue;
    const civ = c.civId ? s.civs[c.civId] : undefined;
    c.age += dtDays;
    c.reproCooldown = Math.max(0, c.reproCooldown - dtDays);
    if (c.age >= c.maxAge) { killEntity(s, c, 'old age'); continue; }
    const stage = lifeStage(c);

    c.hunger = Math.min(1, c.hunger + sp.hungerRate * (stage === 'child' ? 0.7 : 1) * dt);
    c.energy = Math.max(0, c.energy - (HEAVY.has(c.task) ? 0.012 : 0.004) * dt);
    if (c.hunger > 0.6 && civ && civ.resources.food >= 1) {
      civ.resources.food -= 1;
      civ.stats.eaten += 1;
      c.hunger = Math.max(0, c.hunger - 0.5);
    }
    if (c.hunger > 0.85) {
      applyDamage(s, c, 1.0 * dt, { kind: 'hunger' });
      if (!c.alive) continue;
    } else if (c.hunger < 0.4 && c.energy > 0.4 && c.health < c.maxHealth) {
      c.health = Math.min(c.maxHealth, c.health + 0.5 * dt);
    }
    c.attackCd = Math.max(0, c.attackCd - dt);
    c.thinkTimer -= dt;

    if (civ?.succession.phase === 'panic') { moveInPanic(s, c, dt); continue; }
    if (c.role === 'soldier') { updateSoldier(s, ctx, c, civ, dt); continue; }
    updateCivilian(s, ctx, c, civ, stage, dt);
  }
}

function finish(c: Citizen) {
  c.task = 'idle'; c.goal = null; c.taskId = null; c.path = []; c.targetEntityId = null; c.thinkTimer = 0.1;
}
function abandon(c: Citizen) { finish(c); c.thinkTimer = 0; }

function setGoal(s: WorldState, c: Citizen, task: Citizen['task'], cell: number, taskId: string | null = null): boolean {
  c.task = task; c.taskId = taskId; c.goal = cell;
  if (routeTo(s, c, cell) === 'none') { finish(c); return false; }
  return true;
}

function updateCivilian(s: WorldState, ctx: Ctx, c: Citizen, civ: Civilization | undefined, stage: LifeStage, dt: number): void {
  const speedMul = stage === 'child' ? LIFE.childMoveFactor : stage === 'elder' ? LIFE.elderMoveFactor : 1;
  const speed = SPECIES.human.moveSpeed * speedMul * (0.85 + 0.3 * c.personality.industrious);
  c.taskTimer -= dt;

  if (c.task === 'rest') {
    c.energy = Math.min(1, c.energy + 0.1 * dt);
    if (c.taskTimer <= 0 || c.energy > 0.9) finish(c);
    return;
  }
  if (c.task === 'social') { if (c.taskTimer <= 0) finish(c); return; }
  if (c.task === 'reproduce') {
    if (c.taskTimer <= 0) {
      if (c.gender === 'f') giveBirth(s, c);
      finish(c);
    }
    return;
  }

  const moving = moveEntity(s, c, dt, speed);
  const mid = c.targetCellId !== null;

  if (c.task === 'hunt') { huntStep(s, c, civ); return; }
  if (c.task === 'idle') {
    if (!mid && c.thinkTimer <= 0) chooseTask(s, ctx, c, civ, stage);
    return;
  }
  if (c.hunger > 0.85 && c.task !== 'forage' && !mid) { abandon(c); return; }

  const atGoal = c.goal === null || (c.cellId === c.goal && !mid);
  if (!atGoal) {
    if (!moving && !mid && routeTo(s, c, c.goal!) === 'none') abandon(c);
    return;
  }

  // ---- arrived: perform the task ----
  const cell = s.cells[c.cellId];
  switch (c.task) {
    case 'wander': case 'travel': finish(c); break;
    case 'forage': {
      const g = cell.grass;
      const gain = 0.6 + 2.4 * g * (0.5 + cell.fertility * 0.5);
      cell.grass = Math.max(0, g - 0.12);
      if (civ) { civ.resources.food = Math.min(civ.resources.foodCapacity, civ.resources.food + gain); civ.stats.produced.food += gain; }
      c.hunger = Math.max(0, c.hunger - 0.35);
      finish(c);
      break;
    }
    case 'chop': {
      if (cell.trees > 0 && civ) {
        cell.trees--;
        civ.resources.wood = Math.min(civ.resources.woodCapacity, civ.resources.wood + 3);
        civ.stats.produced.wood += 3;
      }
      finish(c);
      break;
    }
    case 'mine': {
      if (cell.stone > 0 && civ) {
        cell.stone--;
        civ.resources.stone = Math.min(civ.resources.stoneCapacity, civ.resources.stone + 2);
        civ.stats.produced.stone += 2;
      }
      finish(c);
      break;
    }
    case 'build': {
      const b = c.taskId ? s.buildings[c.taskId] : undefined;
      if (!b || b.built) { finish(c); break; }
      b.progress = Math.min(1, b.progress + 0.05 * dt * (0.7 + c.personality.industrious * 0.6));
      if (b.progress >= 1) { b.built = true; applyBuildingComplete(s, b); finish(c); }
      else if (c.energy < 0.2) finish(c);
      break;
    }
    case 'farm': {
      const b = c.taskId ? s.buildings[c.taskId] : undefined;
      if (!b || b.type !== 'farm' || !b.built || !civ) { finish(c); break; }
      const fc = s.cells[b.cellId];
      const grow = 0.06 * dt * (0.5 + fc.fertility) * (1 - fc.drought * 0.8) * (s.weather === 'rain' ? 1.5 : 1)
        * (1 - fc.crater * 0.9) * (1 - 0.3 * s.dust) * (fc.moisture < 0.2 ? 0.6 : 1);
      b.cropStage = Math.min(1, (b.cropStage ?? 0) + grow);
      if (b.cropStage >= 1) {
        const yieldF = 8 + Math.floor(fc.fertility * 8);
        civ.resources.food = Math.min(civ.resources.foodCapacity, civ.resources.food + yieldF);
        civ.stats.produced.food += yieldF;
        b.cropStage = 0.1;
        logEvent(s, 'milestone', `The ${civ.name} harvested ${yieldF} food from a farm.`, { civId: civ.id, key: `harvest:${civ.id}`, windowDays: 3 });
        finish(c);
      } else if (c.energy < 0.2) finish(c);
      break;
    }
    default: finish(c);
  }
}

function huntStep(s: WorldState, c: Citizen, civ: Civilization | undefined): void {
  const prey = c.targetEntityId ? getEntity(s, c.targetEntityId) : undefined;
  if (c.targetEntityId && !prey) {
    // The prey fell to our last blow: carry the kill home.
    if (civ) {
      const meat = 8;
      civ.resources.food = Math.min(civ.resources.foodCapacity, civ.resources.food + meat);
      civ.stats.produced.food += meat;
      c.hunger = Math.max(0, c.hunger - 0.3);
    }
    logEvent(s, 'ecology', 'Hunters returned with a kill.', { civId: civ?.id, key: `hunt:${civ?.id}`, windowDays: 4 });
    finish(c);
    return;
  }
  if (!prey || !prey.alive || c.taskTimer <= 0) { finish(c); return; }
  const d = cellDistance(c.cellId, prey.cellId, s);
  if (d <= 1.2 && c.targetCellId === null) {
    c.path = [];
    if (!hasAttack(c.id)) beginAttack(s, c, prey, 'hunter');
  } else if (c.targetCellId === null) {
    if (d <= 4) { if (!stepToward(s, c, prey.cellId)) routeTo(s, c, prey.cellId); }
    else if (c.path.length === 0 || c.goal !== prey.cellId) routeTo(s, c, prey.cellId);
  }
}

function assignHome(s: WorldState, c: Citizen, civ: Civilization | undefined, buildings?: Building[]): void {
  if (c.homeId || !civ) return;
  let best: Building | undefined, bd = Infinity;
  for (const b of buildings ?? Object.values(s.buildings)) {
    if (!b.built || b.civId !== civ.id || b.capacity <= b.residents.length) continue;
    const d = cellDistance(c.cellId, b.cellId, s);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) { best.residents.push(c.id); c.homeId = best.id; }
}

function related(a: Citizen, b: Citizen): boolean {
  if (a.parentIds.includes(b.id) || b.parentIds.includes(a.id)) return true;
  return a.parentIds.some(p => b.parentIds.includes(p));
}

function tryPartner(s: WorldState, ctx: Ctx, c: Citizen, civ: Civilization | undefined, stage: LifeStage): void {
  if (c.partnerId || stage !== 'adult' || !civ) return;
  const other = nearestWhere(ctx, c.cellId, LIFE.partnerRadius, e => {
    if (e.species !== 'human') return false;
    const o = e as Citizen;
    return o.civId === c.civId && o.gender !== c.gender && !o.partnerId && lifeStage(o) === 'adult' && !related(c, o);
  }, c) as Citizen | null;
  if (!other) return;
  c.partnerId = other.id; other.partnerId = c.id;
  logEvent(s, 'birth', `${c.name} and ${other.name} became partners.`, { civId: civ.id, entityId: c.id, key: `partner:${civ.id}`, windowDays: 3 });
}

function pickWorkCell(s: WorldState, c: Citizen, civ: Civilization | undefined, pred: (cc: (typeof s.cells)[number]) => boolean): number | null {
  const here = s.cells[c.cellId];
  if (pred(here) && ownerOK(s, civ, c.cellId)) return c.cellId;
  return nearestCell(s.cells, c.cellId, cc => pred(cc) && ownerOK(s, civ, cc.id), 12);
}

function chooseTask(s: WorldState, ctx: Ctx, c: Citizen, civ: Civilization | undefined, stage: LifeStage): void {
  c.thinkTimer = 0.4 + rand(s) * 0.3;
  assignHome(s, c, civ, civ ? ctx.buildingsByCiv[civ.id] ?? [] : []);
  tryPartner(s, ctx, c, civ, stage);
  const isChild = stage === 'child';

  // 1. Hunger
  if (c.hunger > 0.7 && !(civ && civ.resources.food >= 1)) {
    if (!isChild) {
      const prey = nearestWhere(ctx, c.cellId, 6, e => e.species === 'deer' || e.species === 'rabbit');
      if (prey) {
        c.task = 'hunt'; c.targetEntityId = prey.id; c.taskTimer = 12; c.goal = prey.cellId;
        routeTo(s, c, prey.cellId);
        return;
      }
    }
    const t = pickWorkCell(s, c, civ, cc => (cc.type === 'forest' || cc.type === 'fertile' || cc.type === 'plains') && cc.grass > 0.15);
    if (t !== null && setGoal(s, c, 'forage', t)) return;
  }
  // 2. Rest
  if (c.energy < 0.25) { c.task = 'rest'; c.taskTimer = 4; c.goal = null; return; }

  const home = c.homeId ? s.buildings[c.homeId] : undefined;
  const settle = civ ? ctx.settlementsByCiv[civ.id] ?? [] : [];
  let anchor = home ? home.cellId : settle[0]?.cellId ?? c.cellId;
  if (!home && settle.length > 1) {
    let bd = Infinity;
    for (const st of settle) { const d = cellDistance(c.cellId, st.cellId, s); if (d < bd) { bd = d; anchor = st.cellId; } }
  }

  // 3. Children play near home, never work
  if (isChild) { wander(s, c, anchor, 3); return; }

  if (civ) {
    // 4. Elders: light duties only
    if (stage === 'adult') {
      const pending = (ctx.buildingsByCiv[civ.id] ?? [])
        .filter(b => !b.built && b.civId === civ.id && (ctx.builders[b.id] ?? 0) < 2)
        .sort((a, b) => cellDistance(c.cellId, a.cellId, s) - cellDistance(c.cellId, b.cellId, s))[0];
      if (pending && c.personality.industrious > 0.3 && c.energy > 0.35) {
        if (setGoal(s, c, 'build', pending.cellId, pending.id)) { ctx.builders[pending.id] = (ctx.builders[pending.id] ?? 0) + 1; return; }
      }
    }
    const farm = (ctx.buildingsByCiv[civ.id] ?? [])
      .filter(b => b.type === 'farm' && b.built && b.civId === civ.id && (b.cropStage ?? 0) < 1 && (ctx.farmers[b.id] ?? 0) < 1)
      .sort((a, b) => cellDistance(c.cellId, a.cellId, s) - cellDistance(c.cellId, b.cellId, s))[0];
    if (farm && c.personality.industrious > 0.25) {
      if (setGoal(s, c, 'farm', farm.cellId, farm.id)) { ctx.farmers[farm.id] = (ctx.farmers[farm.id] ?? 0) + 1; return; }
    }
    if (stage === 'adult') {
      if (civ.resources.food < 10 && c.personality.industrious > 0.5) {
        const prey = nearestWhere(ctx, c.cellId, 6, e => e.species === 'deer' || e.species === 'rabbit');
        if (prey) {
          c.task = 'hunt'; c.targetEntityId = prey.id; c.taskTimer = 12; c.goal = prey.cellId;
          routeTo(s, c, prey.cellId);
          return;
        }
      }
      if (civ.resources.wood < civ.resources.woodCapacity * 0.5) {
        const t = pickWorkCell(s, c, civ, cc => cc.trees > 0);
        if (t !== null && setGoal(s, c, 'chop', t)) return;
      }
      if (civ.resources.stone < 10) {
        const t = pickWorkCell(s, c, civ, cc => cc.stone > 0);
        if (t !== null && setGoal(s, c, 'mine', t)) return;
      }
    }
  } else if (c.hunger > 0.4) {
    const t = pickWorkCell(s, c, civ, cc => cc.grass > 0.15 && !isWaterType(cc.type));
    if (t !== null && setGoal(s, c, 'forage', t)) return;
  }

  // Social
  if (c.energy > 0.5 && c.hunger < 0.5 && c.personality.sociable > 0.5 && rand(s) < 0.1) {
    c.task = 'social'; c.taskTimer = 2; c.goal = null; return;
  }
  wander(s, c, anchor, 8);
}

function wander(s: WorldState, c: Citizen, anchor: number, radius: number): void {
  const ns = neighbors(c.cellId, s).filter(n => !isWaterType(s.cells[n].type));
  if (!ns.length) { c.task = 'idle'; return; }
  let pick: number;
  if (cellDistance(c.cellId, anchor, s) > radius) {
    pick = ns.reduce((a, b) => (cellDistance(b, anchor, s) < cellDistance(a, anchor, s) ? b : a));
  } else pick = ns[Math.floor(rand(s) * ns.length)];
  c.task = 'wander'; c.goal = pick; c.path = [pick]; c.taskId = null;
}

// ============ Reproduction ============

export function birthChance(s: WorldState, civ: Civilization, f: Citizen): number {
  const pop = civ.population;
  if (pop >= humanCapacity(s)) return 0;
  if (civ.resources.food < LIFE.minCivFoodForBirth) return 0;
  if (civ.housing.used >= civ.housing.capacity) return 0;
  let deps = 0;
  for (const id of f.childIds) { const ch = s.citizens[id]; if (ch && ch.alive && lifeStage(ch) === 'child') deps++; }
  if (deps >= LIFE.maxDependentChildren) return 0;
  const foodFactor = clamp(civ.resources.food / (Math.max(1, pop) * LIFE.foodPerPersonForFullGrowth), 0.1, 1);
  const cell = s.cells[f.cellId];
  const env = 0.5 + 0.5 * clamp((cell.fertility + (1 - cell.drought)) / 2, 0, 1);
  const pressure = 1 - pop / humanCapacity(s);
  return LIFE.birthChancePerDay * foodFactor * env * pressure;
}

export function updateReproduction(s: WorldState, ctx: Ctx, dt: number): void {
  const dtDays = dt / HOURS_PER_DAY;
  for (const f of ctx.humans) {
    if (!f.alive || f.gender !== 'f' || !f.partnerId || f.role === 'soldier' || f.task === 'reproduce') continue;
    if (f.reproCooldown > 0 || lifeStage(f) !== 'adult') continue;
    const p = s.citizens[f.partnerId];
    if (!p || !p.alive || p.partnerId !== f.id || p.role === 'soldier' || p.reproCooldown > 0) continue;
    if (cellDistance(f.cellId, p.cellId, s) > 3) continue;
    const civ = f.civId ? s.civs[f.civId] : undefined;
    if (!civ || civ.succession.phase !== 'stable' || f.health < f.maxHealth * 0.6 || f.hunger > 0.5) continue;
    const chance = birthChance(s, civ, f);
    if (chance > 0 && rand(s) < chance * dtDays) {
      for (const x of [f, p]) { x.task = 'reproduce'; x.taskTimer = LIFE.pregnancyHours; x.goal = null; x.path = []; }
      f.taskId = p.id;
    }
  }
}

export function giveBirth(s: WorldState, mother: Citizen): Citizen | null {
  const civ = mother.civId ? s.civs[mother.civId] : undefined;
  const father = mother.partnerId ? s.citizens[mother.partnerId] : undefined;
  if (!civ || !father || !father.alive || civ.housing.used >= civ.housing.capacity ||
      civ.resources.food < LIFE.childFoodCost || s.population >= humanCapacity(s)) {
    mother.reproCooldown = 3;
    return null;
  }
  const birthCell = findHumanSpawnCells(s.cells, mother.cellId, 1)[0];
  if (birthCell === undefined) { mother.reproCooldown = 3; return null; }
  civ.resources.food -= LIFE.childFoodCost;
  const baby = createHuman(s, birthCell, { age: 0, civId: civ.id, parents: [mother.id, father.id] });
  baby.hunger = 0.1;
  mother.childIds.push(baby.id); father.childIds.push(baby.id);
  mother.reproCooldown = LIFE.reproCooldownDays; father.reproCooldown = LIFE.reproCooldownDays;
  civ.stats.births++; s.stats.births++;
  emitFx(s, 'birth', mother.cellId);
  const home = mother.homeId ? s.buildings[mother.homeId] : undefined;
  if (home && home.residents.length < home.capacity) { home.residents.push(baby.id); baby.homeId = home.id; }
  else assignHome(s, baby, civ);
  logEvent(s, 'birth', `${baby.name} was born to ${mother.name} and ${father.name} of the ${civ.name}.`,
    { entityId: baby.id, civId: civ.id, key: `birth:${civ.id}`, windowDays: 0.5 });
  return baby;
}

// ============ Construction planning ============

export function planConstruction(s: WorldState, civ: Civilization): Building | null {
  if (civ.population < 1) return null;
  const sts = settlementsOf(s, civ.id);
  if (!sts.length) return null;
  const mine = Object.values(s.buildings).filter(b => b.civId === civ.id);
  const pending = mine.filter(b => !b.built).length;
  if (pending >= 2 + Math.floor(civ.population / 8)) return null;
  const st = sts[civ.planCount++ % sts.length];
  const people = civ.population;
  const homeless = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id && !c.homeId).length;
  const farms = mine.filter(b => b.type === 'farm').length;
  const storages = mine.filter(b => b.type === 'storage').length;
  const communal = mine.filter(b => b.type === 'communal').length;
  const r = civ.resources;
  let type: BuildingType | null = null;
  if (homeless > 0 || civ.housing.used >= civ.housing.capacity - 1) {
    if (people >= 8 && canAfford(r, 'house')) type = 'house';
    else if (canAfford(r, 'shelter')) type = 'shelter';
  } else if (farms < Math.ceil(people / 2) && canAfford(r, 'farm')) type = 'farm';
  else if (storages < 1 && people >= 5 && canAfford(r, 'storage')) type = 'storage';
  else if (communal < 1 && people >= 10 && canAfford(r, 'communal')) type = 'communal';
  else if (people > civ.housing.capacity && canAfford(r, 'house')) type = 'house';
  if (!type) return null;
  return placeBuilding(s, civ, st, type);
}

export function updateCivEconomy(s: WorldState, dt: number): void {
  for (const civ of aliveCivs(s)) {
    if (civ.succession.phase !== 'stable') continue;
    civ.planTimer -= dt;
    if (civ.planTimer > 0) continue;
    civ.planTimer = 4;
    planConstruction(s, civ);
  }
}

export { civLog };
