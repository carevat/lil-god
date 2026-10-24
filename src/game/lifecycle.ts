// Shared entity lifecycle: creation, damage, death, counts. Every lethal effect goes through applyDamage().

import type { WorldState, Living, Citizen, Creature, Building, DamageKind, SpeciesId, LifeStage } from './types';
import { SPECIES } from './species';
import { MILITARY } from './config';
import { rand, newId, logEvent, emitFx, findRelation } from './util';
import { rollAuthority, refreshLeadership, beginSuccession, roleOf } from './authority';
import { markDeath } from './combat';
import { generateName } from './names';
import { sphereDist, findHumanSpawnCells } from './world';

export interface DamageSource { kind: DamageKind; byId?: string; byCivId?: string | null }

export function getEntity(s: WorldState, id: string | null | undefined): Living | undefined {
  if (!id) return undefined;
  return s.citizens[id] ?? s.creatures[id];
}

/** Cell an entity should be considered to occupy right now (for area effects). */
export function effectiveCell(e: Living): number {
  return e.targetCellId !== null && e.moveProgress > 0.5 ? e.targetCellId : e.cellId;
}

export function lifeStage(e: Living): LifeStage {
  if (!e.alive) return 'dead';
  const sp = SPECIES[e.species];
  if (e.age < sp.adultAgeDays) return 'child';
  if (sp.elderAgeDays !== null && e.age >= sp.elderAgeDays) return 'elder';
  return 'adult';
}

export function createHuman(
  s: WorldState, cellId: number,
  opts: { age?: number; civId?: string | null; gender?: 'm' | 'f'; parents?: string[] } = {}
): Citizen {
  const spawn = findHumanSpawnCells(s.cells, cellId, 1)[0];
  if (spawn === undefined) throw new Error('No habitable, non-polar cell exists for a human.');
  const sp = SPECIES.human;
  const gender = opts.gender ?? (rand(s) < 0.5 ? 'm' : 'f');
  const age = opts.age ?? sp.adultAgeDays + Math.floor(rand(s) * 30);
  const c: Citizen = {
    id: newId(s, 'c'), species: 'human',
    name: generateName(Math.floor(rand(s) * 1e9)),
    age,
    maxAge: sp.lifespanDays[0] + Math.floor(rand(s) * (sp.lifespanDays[1] - sp.lifespanDays[0])),
    gender, health: sp.maxHealth, maxHealth: sp.maxHealth,
    hunger: 0.15 + rand(s) * 0.2, energy: 0.7 + rand(s) * 0.3,
    cellId: spawn, targetCellId: null, moveProgress: 1, path: [], goal: null,
    task: 'idle', taskTimer: 0, thinkTimer: 0, alive: true,
    attackCd: 0, targetEntityId: null,
    parentIds: opts.parents ?? [], childIds: [], partnerId: null, reproCooldown: 0,
    bornDay: s.day - age,
    taskId: null, homeId: null, civId: opts.civId ?? null, role: 'civilian',
    authority: rollAuthority(s), incitedUntil: 0,
    personality: { industrious: rand(s), sociable: rand(s) },
    carry: { food: 0, wood: 0, stone: 0 },
  };
  s.citizens[c.id] = c;
  s.population++;
  s.speciesCounts.human++;
  if (c.civId && s.civs[c.civId]) s.civs[c.civId].population++;
  if (c.civId && s.civs[c.civId]) refreshLeadership(s, c.civId);
  return c;
}

export function createCreature(
  s: WorldState, species: Exclude<SpeciesId, 'human'>, cellId: number,
  opts: { age?: number; gender?: 'm' | 'f'; packId?: string | null; parents?: string[] } = {}
): Creature {
  const sp = SPECIES[species];
  const gender = opts.gender ?? (rand(s) < 0.5 ? 'm' : 'f');
  const age = opts.age ?? sp.adultAgeDays + Math.floor(rand(s) * Math.max(4, sp.adultAgeDays) * 0.8);
  const id = newId(s, 'w');
  const c: Creature = {
    id, species, name: `${sp.singular} ${id.slice(1).toUpperCase()}`,
    age,
    maxAge: sp.lifespanDays[0] + Math.floor(rand(s) * (sp.lifespanDays[1] - sp.lifespanDays[0])),
    gender, health: sp.maxHealth, maxHealth: sp.maxHealth,
    hunger: sp.hungerRate > 0 ? 0.1 + rand(s) * 0.25 : 0, energy: 1,
    cellId, targetCellId: null, moveProgress: 1, path: [], goal: null,
    task: 'idle', taskTimer: 0, thinkTimer: rand(s) * 0.5, alive: true,
    attackCd: 0, targetEntityId: null,
    parentIds: opts.parents ?? [], childIds: [], partnerId: null, reproCooldown: 0,
    bornDay: s.day - age,
    packId: opts.packId ?? null, homeCell: cellId,
  };
  s.creatures[c.id] = c;
  return c;
}

const CAUSE: Record<DamageKind, string> = {
  lightning: 'lightning', meteor: 'meteor impact', predator: 'predation', combat: 'combat',
  hunger: 'starvation', hunter: 'hunting', divine: 'divine will',
};

/** The one place where health is reduced. Applies resistances, handles death exactly once. */
export function applyDamage(s: WorldState, target: Living, amount: number, source: DamageSource): { dealt: number; killed: boolean } {
  if (!target.alive || amount <= 0) return { dealt: 0, killed: false };
  const resist = SPECIES[target.species].resist[source.kind] ?? 0;
  const dealt = amount * (1 - resist);
  target.health -= dealt;
  if (target.health <= 0) {
    killEntity(s, target, CAUSE[source.kind], source);
    return { dealt, killed: true };
  }
  return { dealt, killed: false };
}

/** Safe death processing. Idempotent. Cleans every cross-system reference. */
export function killEntity(s: WorldState, e: Living, cause: string, src?: DamageSource): void {
  if (!e.alive) return;
  const wasKing = e.species === 'human' && roleOf(s, e as Citizen) === 'king';
  e.alive = false;
  e.health = 0;
  e.task = 'dead';
  e.path = [];
  e.goal = null;
  e.targetCellId = null;
  e.moveProgress = 1;
  e.targetEntityId = null;
  e.deathDay = s.day;
  e.deathCause = cause;
  s.stats.deaths++;
  emitFx(s, 'death', e.cellId);
  markDeath(e.id);

  if (e.species === 'human') {
    const c = e as Citizen;
    if (c.homeId) {
      const h = s.buildings[c.homeId];
      if (h) h.residents = h.residents.filter(r => r !== c.id);
      c.homeId = null;
    }
    c.taskId = null;
    if (c.partnerId) {
      const p = s.citizens[c.partnerId];
      if (p && p.partnerId === c.id) {
        p.partnerId = null;
        if (p.task === 'reproduce') { p.task = 'idle'; p.taskTimer = 0; }
      }
    }
    const civ = c.civId ? s.civs[c.civId] : undefined;
    if (civ) {
      civ.stats.deaths++;
      if (src?.kind === 'combat' && src.byCivId) {
        const rel = findRelation(s, civ.id, src.byCivId);
        if (rel) rel.casualties[civ.id] = (rel.casualties[civ.id] ?? 0) + 1;
        s.stats.warDeaths++;
      }
    }
    if (wasKing) logEvent(s, 'civ', `${c.name}, ruler of the ${civ?.name ?? 'a wandering people'}, has died.`, { entityId: c.id, civId: c.civId ?? undefined });
    const key = (k: string, w: number) => ({ entityId: c.id, civId: c.civId ?? undefined, key: k, windowDays: w });
    switch (src?.kind) {
      case 'lightning':
        s.stats.lightningKills++;
        logEvent(s, 'death', `${c.name} was struck down by lightning.`, { entityId: c.id, civId: c.civId ?? undefined });
        break;
      case 'meteor':
        s.stats.meteorKills++;
        logEvent(s, 'death', `${c.name} was killed in a meteor impact.`, key('death:meteor', 0.3));
        break;
      case 'combat':
        logEvent(s, 'death', `${c.name} fell in battle.`, key('death:war', 0.5));
        break;
      case 'hunger':
        logEvent(s, 'death', `${c.name} starved.`, key('death:hunger', 1));
        break;
      default:
        logEvent(s, 'death', `${c.name} passed away (${cause}).`, key('death:age', 2));
    }
  } else {
    const w = e as Creature;
    if (src?.kind === 'lightning' || src?.kind === 'meteor') {
      logEvent(s, 'ecology', `${SPECIES[w.species].label} were killed by ${src.kind === 'lightning' ? 'lightning' : 'a meteor'}.`, { key: `wdeath:${src.kind}`, windowDays: 1 });
    } else if (src?.kind === 'predator') {
      s.stats.predations++;
    } else if (w.species === 'golem') {
      logEvent(s, 'ecology', 'A stone golem crumbled to rubble.', { key: 'golem:dead', windowDays: 1 });
    }
    delete s.creatures[w.id];
  }
  if (e.species === 'human') {
    const c = e as Citizen;
    if (wasKing && c.civId) beginSuccession(s, c.civId, c.id);
    refreshLeadership(s, c.civId ?? undefined);
  }
}

// ---------- Buildings ----------

export function damageBuilding(s: WorldState, b: Building, amount: number, src: DamageSource): boolean {
  if (!s.buildings[b.id]) return false;
  b.health -= amount;
  if (b.type === 'farm') b.cropStage = Math.max(0, (b.cropStage ?? 0) - (amount / b.maxHealth) * 0.5);
  if (b.health <= 0) { destroyBuilding(s, b, src.kind); return true; }
  return false;
}

export function destroyBuilding(s: WorldState, b: Building, _cause: string): void {
  if (!s.buildings[b.id]) return;
  for (const id of b.residents) {
    const c = s.citizens[id];
    if (c && c.homeId === b.id) c.homeId = null;
  }
  const cell = s.cells[b.cellId];
  if (cell && cell.buildingId === b.id) cell.buildingId = null;
  delete s.buildings[b.id];
  logEvent(s, 'build', `A ${b.type} was destroyed.`, { key: 'bdestroy', windowDays: 0.5, civId: b.civId ?? undefined });
}

// ---------- Combat ----------

export function defenseOf(s: WorldState, e: Living): number {
  let d = SPECIES[e.species].defense;
  const cell = s.cells[e.cellId];
  if (e.species === 'human') {
    const c = e as Citizen;
    if (c.role === 'soldier') d += MILITARY.soldierDefense;
    if (c.civId) {
      for (const st of Object.values(s.settlements)) {
        if (st.civId !== c.civId || sphereDist(e.cellId, st.cellId, s) > 2) continue;
        const b = s.cells[st.cellId].buildingId ? s.buildings[s.cells[st.cellId].buildingId!] : undefined;
        if (b && b.type === 'communal' && b.built) { d += 0.1; break; }
      }
    }
  }
  if (cell.type === 'mountain') d += 0.15;
  else if (cell.type === 'forest') d += 0.05;
  return Math.min(0.8, d);
}

export function attackPower(e: Living): { damage: number; cooldown: number } {
  const sp = SPECIES[e.species];
  if (e.species === 'human' && (e as Citizen).role === 'soldier') {
    return { damage: MILITARY.soldierAttack, cooldown: MILITARY.soldierCooldown };
  }
  return { damage: sp.attack, cooldown: sp.attackCdHours };
}

/** Melee hit with attack strength, defense, terrain modifiers and cooldown. */
export function meleeAttack(s: WorldState, atk: Living, def: Living, kind: DamageKind = 'combat') {
  const { damage, cooldown } = attackPower(atk);
  atk.attackCd = cooldown;
  const dmg = damage * (0.85 + 0.3 * rand(s)) * (1 - defenseOf(s, def));
  emitFx(s, 'hit', def.cellId);
  const byCivId = atk.species === 'human' ? (atk as Citizen).civId : null;
  return applyDamage(s, def, dmg, { kind, byId: atk.id, byCivId });
}

// ---------- Counts ----------

export function refreshCounts(s: WorldState): void {
  const counts: Record<SpeciesId, number> = { human: 0, deer: 0, wolf: 0, rabbit: 0, golem: 0 };
  for (const civ of Object.values(s.civs)) {
    civ.population = 0; civ.soldiers = 0; civ.militaryStrength = 0; civ.housing = { used: 0, capacity: 0 };
  }
  for (const c of Object.values(s.citizens)) {
    if (!c.alive) continue;
    counts.human++;
    const civ = c.civId ? s.civs[c.civId] : undefined;
    if (!civ) continue;
    civ.population++;
    if (c.role === 'soldier') { civ.soldiers++; civ.militaryStrength += 10 * (c.health / c.maxHealth); }
  }
  for (const w of Object.values(s.creatures)) if (w.alive) counts[w.species]++;
  let used = 0, cap = 0;
  for (const b of Object.values(s.buildings)) {
    if (!b.built || (b.type !== 'shelter' && b.type !== 'house')) continue;
    b.residents = b.residents.filter(id => s.citizens[id]?.alive);
    cap += b.capacity; used += b.residents.length;
    const civ = b.civId ? s.civs[b.civId] : undefined;
    if (civ) { civ.housing.capacity += b.capacity; civ.housing.used += b.residents.length; }
  }
  s.population = counts.human;
  s.speciesCounts = counts;
  s.housing = { used, capacity: cap };
  const agg = { food: 0, wood: 0, stone: 0, foodCapacity: 0, woodCapacity: 0, stoneCapacity: 0 };
  for (const civ of Object.values(s.civs)) {
    if (!civ.alive) continue;
    for (const k of Object.keys(agg) as Array<keyof typeof agg>) agg[k] += civ.resources[k];
  }
  s.resources = agg;
}

export function pruneDead(s: WorldState, max: number): void {
  const dead = Object.values(s.citizens).filter(c => !c.alive);
  if (dead.length <= max) return;
  dead.sort((a, b) => (a.deathDay ?? 0) - (b.deathDay ?? 0));
  for (let i = 0; i < dead.length - max; i++) delete s.citizens[dead[i].id];
}
