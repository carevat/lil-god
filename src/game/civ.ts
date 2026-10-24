// Civilizations: founding, territory, diplomacy, military, war, conquest and collapse.

import type { WorldState, Civilization, Settlement, Citizen, Living, Relation } from './types';
import { DIPLOMACY, EXPANSION, MILITARY, TERRITORY, VISION } from './config';
import { SPECIES } from './species';
import { rand, newId, logEvent, notify, emitFx, getRelation, relKey, clamp } from './util';
import { cellsWithin, sphereDist, cellDistance, landmassOf, neighbors, isWaterType, isHumanSpawnCell, findHumanSpawnCells, hash2 } from './world';
import { generateCivName, generateSettlementName } from './names';
import { lifeStage, damageBuilding } from './lifecycle';
import { routeTo, moveEntity, stepToward } from './pathing';
import { hasAttack } from './combat';
import { nearestWhere, type Ctx } from './context';
import { placeBuilding, computeEra } from './buildings';
import { beginAttack } from './combat';
import { refreshLeadership } from './authority';
import { suitableFoundingSite, analyseGeography } from './geography';

export const CIV_COLORS = ['#5aa9ff', '#ff6b5e', '#ffd24a', '#b57cff', '#ff9a3c', '#4fe0b0'];

export function aliveCivs(s: WorldState): Civilization[] {
  return Object.values(s.civs).filter(c => c.alive);
}
export function civByIdx(s: WorldState, idx: number): Civilization | undefined {
  if (idx < 0) return undefined;
  for (const c of Object.values(s.civs)) if (c.idx === idx) return c;
  return undefined;
}
export function settlementsOf(s: WorldState, civId: string): Settlement[] {
  return Object.values(s.settlements).filter(t => t.civId === civId);
}

export function civLog(s: WorldState, civs: Array<Civilization | undefined>, text: string) {
  for (const c of civs) {
    if (!c) continue;
    c.history.push({ day: s.day, text });
    if (c.history.length > 30) c.history.shift();
  }
}

// ============ Founding ============

export function createCivilization(s: WorldState, name?: string): Civilization {
  const idx = s.civCounter++;
  const used = new Set(aliveCivs(s).map(c => c.color));
  const hue = ((idx * 137.508) % 360) / 60;
  const channel = (n: number) => Math.round((.35 + .5 * Math.max(0, Math.min(1, 1 - Math.abs((hue + n) % 6 - 3) + 1))) * 255).toString(16).padStart(2,'0');
  let color = CIV_COLORS.find(c => !used.has(c)) ?? `#${channel(0)}${channel(4)}${channel(2)}`;
  while (used.has(color)) color = '#' + ((parseInt(color.slice(1),16) + 257) & 0xffffff).toString(16).padStart(6,'0');
  const taken = new Set(Object.values(s.civs).map(c => c.name));
  let n = name;
  for (let k = 0; k < 32 && (!n || taken.has(n)); k++) n = generateCivName(s.seed + idx * 131 + k * 17 + s.idCounter);
  if (!n || taken.has(n)) n = `${n ?? 'Wanderers'} ${idx + 1}`;
  const civ: Civilization = {
    id: newId(s, 'k'), idx, name: n, color, founded: s.day, alive: true, capitalId: null,
    resources: { food: 20, wood: 15, stone: 5, foodCapacity: 100, woodCapacity: 100, stoneCapacity: 50 },
    stats: { produced: { food: 0, wood: 0, stone: 0 }, eaten: 0, births: 0, deaths: 0, raidsWon: 0, raidsSuffered: 0, loot: 0 },
    history: [], aggression: 0.7 + ((idx * 37) % 7) / 10, era: 'Dawn', population: 0, soldiers: 0,
    militaryStrength: 0, housing: { used: 0, capacity: 0 }, territoryCells: 0, guardTarget: 0,
    kingId: null, commanderId: null, mobilize: 0,
    succession: { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null },
    planTimer: 0, planCount: 0, recruitTimer: 0, lastColony: s.day,
  };
  s.civs[civ.id] = civ;
  return civ;
}

export function foundSettlement(s: WorldState, civ: Civilization, cellId: number, name?: string, preserveLegacy = false): Settlement {
  if (!preserveLegacy && !isHumanSpawnCell(s.cells[cellId])) throw new Error('A settlement cannot be founded on uninhabitable or polar land.');
  const st: Settlement = {
    id: newId(s, 't'), civId: civ.id, cellId, stage: civ.era,
    name: name ?? generateSettlementName(s.seed + s.idCounter * 7),
    founded: s.day, occupiedBy: null, occupiedHours: 0,
  };
  s.settlements[st.id] = st;
  if (!civ.capitalId || !s.settlements[civ.capitalId]) civ.capitalId = st.id;
  return st;
}

/** Create a civilization with a first settlement and adopt the given citizens. */
export function foundCivilization(s: WorldState, cellId: number, humans: Citizen[], reason = 'forms', claimTerritory = true): Civilization {
  if (!isHumanSpawnCell(s.cells[cellId])) throw new Error('Cannot found a civilization in a polar or uninhabitable region.');
  const civ = createCivilization(s);
  const st = foundSettlement(s, civ, cellId);
  for (const h of humans) { h.civId = civ.id; }
  civ.population = humans.length;
  civ.era = 'Camp';
  st.stage = 'Camp';
  logEvent(s, 'settlement', `A new settlement ${reason}: ${st.name}, home of the ${civ.name}.`, { civId: civ.id, entityId: humans[0]?.id });
  civLog(s, [civ], `Founded ${st.name}.`);
  notify(s, `The ${civ.name} found ${st.name}.`, 'good');
  refreshLeadership(s, civ.id);
  if (claimTerritory) updateTerritory(s);
  return civ;
}

// ============ Territory ============

export function updateTerritory(s: WorldState): void {
  const civs = aliveCivs(s);
  const prev = s.territory;
  const next: number[] = new Array(s.cells.length).fill(-1);
  const fr: Record<string, number> = {};
  const before: Record<string, number> = {};
  for (const c of civs) before[c.id] = c.territoryCells;

  if (civs.length) {
    const claims = new Map<number, Map<number, number>>();
    const stBy: Record<string, Settlement[]> = {};
    for (const st of Object.values(s.settlements)) (stBy[st.civId] ??= []).push(st);
    const bCount: Record<string, number> = {};
    for (const b of Object.values(s.buildings)) if (b.built && b.settlementId) bCount[b.settlementId] = (bCount[b.settlementId] ?? 0) + 1;

    for (const civ of civs) {
      const sts = stBy[civ.id] ?? [];
      if (!sts.length) continue;
      for (const st of sts) {
        const share = civ.population / sts.length;
        const bc = bCount[st.id] ?? 0;
        const power = 1 + 0.5 * Math.sqrt(share) + 0.12 * bc;
        const radius = clamp(TERRITORY.baseRadius + 0.6 * Math.sqrt(share) + 0.12 * bc, TERRITORY.baseRadius, TERRITORY.maxRadius);
        for (const cell of cellsWithin(st.cellId, radius, s)) {
          const c = s.cells[cell];
          if (isWaterType(c.type)) continue;
          const d = sphereDist(st.cellId, cell, s);
          const suit = c.type === 'mountain' ? 0.6 : 0.75 + 0.25 * c.fertility;
          let v = (power / (1 + d * 0.5)) * suit;
          if (prev[cell] === civ.idx) v *= 1.2;
          if (v >= TERRITORY.threshold) {
            let tile = claims.get(cell);
            if (!tile) { tile = new Map(); claims.set(cell, tile); }
            if (v > (tile.get(civ.idx) ?? 0)) tile.set(civ.idx, v);
          }
        }
      }
    }
    const counts: Record<string, number> = {};
    const byIdx = new Map(civs.map(c=>[c.idx,c]));
    for (const [i, tile] of claims) {
      let b = 0, bi = -1, sec = 0, si = -1;
      for (const [idx, v] of tile) {
        if (v > b) { sec = b; si = bi; b = v; bi = idx; }
        else if (v > sec) { sec = v; si = idx; }
      }
      if (bi < 0) continue;
      next[i] = bi;
      const civ = byIdx.get(bi)!;
      counts[civ.id] = (counts[civ.id] ?? 0) + 1;
      if (si >= 0 && sec >= .6 * b) {
        const key = relKey(civ.id, byIdx.get(si)!.id);
        fr[key] = (fr[key] ?? 0) + 1;
      }
    }
    for (const c of civs) c.territoryCells = counts[c.id] ?? 0;
  }
  s.territory = next;
  s.borderFriction = fr;

  for (const c of civs) {
    const was = before[c.id] ?? 0;
    for (const m of [30, 80, 150]) {
      if (was < m && c.territoryCells >= m) logEvent(s, 'civ', `The ${c.name} now hold ${m}+ tiles of land.`, { civId: c.id, key: `terr:${c.id}:${m}`, windowDays: 9999 });
    }
    if (was - c.territoryCells >= 8) {
      logEvent(s, 'war', `The ${c.name} retreat from disputed territory.`, { civId: c.id, key: `retreat:${c.id}`, windowDays: 10 });
      civLog(s, [c], 'Lost ground along the borders.');
    }
  }
}

// ============ Military ============

export function isSoldier(c: Living): boolean {
  return c.species === 'human' && (c as Citizen).role === 'soldier';
}

export function recruitSoldiers(s: WorldState, civ: Civilization, n: number, manual = false): { recruited: number; reason?: string } {
  const citizens = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id);
  const adults = citizens.filter(c => lifeStage(c) === 'adult');
  const soldiers = citizens.filter(c => c.role === 'soldier').length;
  if (civ.population < MILITARY.minPopToRecruit) return { recruited: 0, reason: `Needs at least ${MILITARY.minPopToRecruit} citizens.` };
  const room = Math.floor(adults.length * MILITARY.maxSoldierRatio) - soldiers;
  if (room <= 0) return { recruited: 0, reason: 'Soldier limit reached for this population.' };
  const candidates = adults
    .filter(c => c.role === 'civilian' && c.health >= c.maxHealth * 0.5 && c.task !== 'reproduce')
    .sort((a, b) => a.personality.industrious - b.personality.industrious || (a.id < b.id ? -1 : 1));
  let recruited = 0;
  let reason: string | undefined;
  for (const c of candidates) {
    if (recruited >= n || recruited >= room) break;
    if (civ.resources.food < MILITARY.recruitFood || civ.resources.wood < MILITARY.recruitWood) {
      reason = `Recruiting costs ${MILITARY.recruitFood} food and ${MILITARY.recruitWood} wood each.`;
      break;
    }
    civ.resources.food -= MILITARY.recruitFood;
    civ.resources.wood -= MILITARY.recruitWood;
    const ratio = c.health / c.maxHealth;
    c.role = 'soldier';
    c.maxHealth = MILITARY.soldierHealth;
    c.health = ratio * c.maxHealth;
    c.task = 'patrol'; c.taskId = null; c.goal = null; c.path = []; c.thinkTimer = 0;
    recruited++;
  }
  if (recruited > 0) {
    refreshLeadership(s, civ.id);
    if (manual) civ.guardTarget = Math.max(civ.guardTarget, soldiers + recruited);
    logEvent(s, 'war', `The ${civ.name} raised ${recruited} soldier${recruited > 1 ? 's' : ''}.`, { civId: civ.id, key: `recruit:${civ.id}`, windowDays: 2 });
  } else if (!reason && candidates.length === 0) reason = 'No eligible adults available.';
  return { recruited, reason };
}

export function demobilize(s: WorldState, civ: Civilization, n = 999): number {
  let k = 0;
  for (const c of Object.values(s.citizens)) {
    if (k >= n) break;
    if (!c.alive || c.civId !== civ.id || c.role !== 'soldier') continue;
    const ratio = c.health / c.maxHealth;
    c.role = 'civilian';
    c.maxHealth = SPECIES.human.maxHealth;
    c.health = Math.max(1, ratio * c.maxHealth);
    c.task = 'idle'; c.goal = null; c.path = []; c.thinkTimer = 0;
    k++;
  }
  return k;
}

function civRelations(s: WorldState, civ: Civilization): Relation[] {
  return Object.values(s.relations).filter(r => (r.a === civ.id || r.b === civ.id) &&
    s.civs[r.a]?.alive && s.civs[r.b]?.alive);
}

export function autoMilitary(s: WorldState, civ: Civilization): void {
  const rels = civRelations(s, civ);
  const atWar = rels.some(r => r.status === 'war');
  const threat = rels.some(r => r.status === 'tension');
  const adults = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id && lifeStage(c) === 'adult').length;
  const target = atWar ? Math.ceil(adults * MILITARY.autoRecruitRatio) + 1
    : threat || civ.mobilize > 0 ? Math.ceil(adults * (0.2 + 0.12 * civ.mobilize)) : civ.guardTarget;
  if (civ.soldiers < target) recruitSoldiers(s, civ, 2, false);
}

export function rallyCell(s: WorldState, civ: Civilization, fallback: number): number {
  const cap = civ.capitalId ? s.settlements[civ.capitalId] : undefined;
  if (cap && cap.civId === civ.id) return cap.cellId;
  const any = settlementsOf(s, civ.id)[0];
  return any ? any.cellId : fallback;
}

// ============ Soldier AI ============

function isHostile(s: WorldState, enemies: string[], e: Living): boolean {
  if (e.species === 'human') { const h = e as Citizen; return !!h.civId && enemies.includes(h.civId); }
  if (e.species === 'golem') {
    const owner = civByIdx(s, s.territory[e.cellId]);
    return !!owner && enemies.includes(owner.id);
  }
  return false;
}

export function updateSoldier(s: WorldState, ctx: Ctx, c: Citizen, civ: Civilization | undefined, dt: number): void {
  if (!civ || !civ.alive) { c.role = 'civilian'; return; }
  const enemies = ctx.enemies[civ.id] ?? [];
  moveEntity(s, c, dt, SPECIES.human.moveSpeed);
  if (c.targetCellId !== null) return; // mid-step: decide at the next cell boundary
  const rally = rallyCell(s, civ, c.cellId);
  const ratio = c.health / c.maxHealth;

  if (enemies.length === 0) {
    if (c.task !== 'patrol') c.task = 'patrol';
    if (ratio < 1) c.health = Math.min(c.maxHealth, c.health + 1 * dt);
    if (cellDistance(c.cellId, rally, s) > 3) {
      if (c.path.length === 0) routeTo(s, c, rally);
    } else if (c.thinkTimer <= 0) {
      const ns = neighbors(c.cellId, s).filter(n => !isWaterType(s.cells[n].type) && cellDistance(n, rally, s) <= 3);
      if (ns.length && rand(s) < 0.5) { c.targetCellId = ns[Math.floor(rand(s) * ns.length)]; c.moveProgress = 0; }
      c.thinkTimer = 2 + rand(s) * 2;
    }
    return;
  }

  // Retreat and recover
  if (ratio < MILITARY.retreatBelow || (c.task === 'retreat' && ratio < MILITARY.recoverTo)) {
    c.task = 'retreat';
    if (cellDistance(c.cellId, rally, s) <= 1) c.health = Math.min(c.maxHealth, c.health + 2.5 * dt);
    else if (c.path.length === 0) routeTo(s, c, rally);
    return;
  }

  const hostile = (e: Living) => isHostile(s, enemies, e);
  const foe = nearestWhere(ctx, c.cellId, MILITARY.engageRadius, e => hostile(e) && isSoldier(e) || (hostile(e) && e.species === 'golem'), c)
    ?? nearestWhere(ctx, c.cellId, 2, hostile, c);
  if (foe) {
    if (cellDistance(c.cellId, foe.cellId, s) <= 1.5) {
      c.task = 'fight';
      c.path = [];
      beginAttack(s, c, foe, 'combat');
    } else {
      c.task = 'march';
      if (!stepToward(s, c, foe.cellId) && c.path.length === 0) routeTo(s, c, foe.cellId);
    }
    return;
  }

  // Pick the nearest enemy settlement and go raid it
  let target: Settlement | undefined;
  let bd = Infinity;
  for (const st of Object.values(s.settlements)) {
    if (!enemies.includes(st.civId)) continue;
    if (landmassOf(s, c.cellId) !== landmassOf(s, st.cellId)) continue;
    const d = sphereDist(c.cellId, st.cellId, s);
    if (d < bd) { bd = d; target = st; }
  }
  if (!target) { c.task = 'patrol'; return; }
  if (bd <= 1.5) {
    c.task = 'raid';
    c.path = [];
    if (c.attackCd <= 0 && !hasAttack(c.id)) raidStep(s, c, civ, target);
  } else {
    c.task = 'march';
    if (c.path.length === 0 || c.goal !== target.cellId) routeTo(s, c, target.cellId);
  }
}

function raidStep(s: WorldState, c: Citizen, civ: Civilization, target: Settlement): void {
  const enemy = s.civs[target.civId];
  if (!enemy) return;
  let victim = null as null | (typeof s.buildings)[string];
  let bd = Infinity;
  for (const cell of cellsWithin(target.cellId, 3, s)) {
    const bid = s.cells[cell].buildingId;
    const b = bid ? s.buildings[bid] : undefined;
    if (!b || b.civId !== enemy.id) continue;
    const d = sphereDist(c.cellId, cell, s);
    if (d < bd) { bd = d; victim = b; }
  }
  c.attackCd = MILITARY.soldierCooldown;
  if (!victim) return; // nothing left to raid — occupation handled in updateWars
  emitFx(s, 'raid', victim.cellId);
  const destroyed = damageBuilding(s, victim, MILITARY.raidBuildingDamage * (0.85 + 0.3 * rand(s)), { kind: 'combat', byId: c.id, byCivId: civ.id });
  const rel = getRelation(s, civ.id, enemy.id);
  if (rel.loot < MILITARY.lootCapPerWar) {
    const take = (k: 'food' | 'wood' | 'stone') => {
      const amt = Math.min(enemy.resources[k], Math.max(0.5, enemy.resources[k] * MILITARY.lootFraction));
      enemy.resources[k] -= amt; civ.resources[k] = Math.min(civ.resources[`${k}Capacity` as 'foodCapacity'], civ.resources[k] + amt);
      return amt;
    };
    const got = take('food') + take('wood') + take('stone');
    rel.loot += got; civ.stats.loot += got;
  }
  enemy.stats.raidsSuffered++; civ.stats.raidsWon++;
  logEvent(s, 'war', `The ${civ.name} raided ${target.name}${destroyed ? ' and razed a building' : ''}.`, { civId: civ.id, key: `raid:${civ.id}:${enemy.id}`, windowDays: 3 });
  civLog(s, [civ, enemy], `Raid on ${target.name}.`);
}

// ============ War management ============

export function declareWar(s: WorldState, aggressor: Civilization, other: Civilization, reason: string): Relation {
  const rel = getRelation(s, aggressor.id, other.id);
  rel.status = 'war'; rel.since = s.day; rel.warStart = s.day; rel.aggressor = aggressor.id;
  rel.casualties = { [aggressor.id]: 0, [other.id]: 0 };
  rel.startSoldiers = { [aggressor.id]: aggressor.soldiers, [other.id]: other.soldiers };
  rel.loot = 0;
  rel.tension = Math.max(rel.tension, DIPLOMACY.warAt);
  logEvent(s, 'war', `The ${aggressor.name} declared war on the ${other.name} (${reason}).`, { civId: aggressor.id });
  civLog(s, [aggressor, other], `War between ${aggressor.name} and ${other.name}.`);
  notify(s, `War! The ${aggressor.name} march against the ${other.name}.`, 'bad');
  return rel;
}

export function endWar(s: WorldState, rel: Relation, text: string): void {
  const A = s.civs[rel.a], B = s.civs[rel.b];
  rel.status = 'truce'; rel.since = s.day; rel.truceUntil = s.day + DIPLOMACY.truceDays; rel.tension = 30;
  logEvent(s, 'war', text, { civId: rel.a });
  civLog(s, [A, B], text);
  notify(s, text, 'good');
  for (const st of Object.values(s.settlements)) if (st.civId === rel.a || st.civId === rel.b) { st.occupiedBy = null; st.occupiedHours = 0; }
}

export function transferSettlement(s: WorldState, st: Settlement, to: Civilization): void {
  const from = s.civs[st.civId];
  st.civId = to.id; st.occupiedBy = null; st.occupiedHours = 0;
  for (const b of Object.values(s.buildings)) if (b.settlementId === st.id) b.civId = to.id;
  for (const c of Object.values(s.citizens)) {
    if (!c.alive || !from || c.civId !== from.id) continue;
    const home = c.homeId ? s.buildings[c.homeId] : undefined;
    if ((home && home.settlementId === st.id) || (!home && sphereDist(c.cellId, st.cellId, s) <= 4)) {
      c.civId = to.id;
      c.task = 'idle'; c.goal = null; c.path = []; c.taskId = null;
    }
  }
  if (from && from.capitalId === st.id) {
    const other = settlementsOf(s, from.id).find(t => t.id !== st.id);
    from.capitalId = other ? other.id : null;
  }
  if (!to.capitalId || !s.settlements[to.capitalId]) to.capitalId = st.id;
  refreshLeadership(s, to.id);
  if (from) refreshLeadership(s, from.id);
  updateTerritory(s);
}

export function fallCiv(s: WorldState, civ: Civilization, conqueror?: Civilization): void {
  if (!civ.alive) return;
  civ.alive = false;
  civ.succession = { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null };
  civ.fallDay = s.day;
  civ.fallReason = conqueror ? `Conquered by the ${conqueror.name}` : 'Collapsed';
  if (conqueror) {
    for (const k of ['food', 'wood', 'stone'] as const) {
      const share = civ.resources[k] * 0.5;
      conqueror.resources[k] = Math.min(conqueror.resources[`${k}Capacity` as 'foodCapacity'], conqueror.resources[k] + share);
    }
  }
  for (const c of Object.values(s.citizens)) {
    if (!c.alive || c.civId !== civ.id) continue;
    if (c.role === 'soldier') { c.role = 'civilian'; c.maxHealth = SPECIES.human.maxHealth; c.health = Math.min(c.health, c.maxHealth); }
    c.civId = conqueror ? conqueror.id : null;
    c.task = 'idle'; c.goal = null; c.path = []; c.taskId = null;
  }
  for (const b of Object.values(s.buildings)) if (b.civId === civ.id) b.civId = conqueror ? conqueror.id : null;
  for (const st of Object.values(s.settlements)) if (st.civId === civ.id) delete s.settlements[st.id];
  for (const r of Object.values(s.relations)) if (r.a === civ.id || r.b === civ.id) { if (r.status === 'war') r.status = 'truce'; }
  civ.kingId = null; civ.commanderId = null;
  refreshLeadership(s, conqueror?.id);
  logEvent(s, 'civ', `The ${civ.name} have fallen${conqueror ? `, absorbed by the ${conqueror.name}` : ''}.`, { civId: civ.id });
  civLog(s, [civ, conqueror], `The ${civ.name} fell.`);
  notify(s, `The ${civ.name} have fallen.`, 'bad');
  updateTerritory(s);
  adoptOrphans(s);
}

function warTick(s: WorldState, ctx: Ctx, rel: Relation, dt: number): void {
  const A = s.civs[rel.a], B = s.civs[rel.b];
  if (!A || !B || !A.alive || !B.alive) { if (rel.status === 'war') rel.status = 'truce'; return; }
  const days = s.day - rel.warStart;

  for (const [X, Y] of [[A, B], [B, A]] as const) {
    const start = rel.startSoldiers[X.id] ?? 0;
    const lost = rel.casualties[X.id] ?? 0;
    if (start > 0 && lost >= Math.max(3, Math.ceil(start * 0.5)) && X.soldiers <= start * 0.4) {
      endWar(s, rel, `The ${X.name} sued for a truce with the ${Y.name} after heavy losses.`);
      return;
    }
    if (days >= DIPLOMACY.surrenderMinWarDays && X.soldiers === 0 && X.population <= 6 &&
        Y.militaryStrength > 0 && Y.militaryStrength >= DIPLOMACY.surrenderRatio * Math.max(1, X.militaryStrength)) {
      logEvent(s, 'war', `The ${X.name} surrendered to the ${Y.name}.`, { civId: X.id });
      for (const st of settlementsOf(s, X.id)) transferSettlement(s, st, Y);
      fallCiv(s, X, Y);
      rel.status = 'truce'; rel.truceUntil = s.day + DIPLOMACY.truceDays;
      return;
    }
  }
  if (days >= DIPLOMACY.maxWarDays) {
    endWar(s, rel, `Exhausted by war, the ${A.name} and the ${B.name} agreed to a truce.`);
    return;
  }

  // Occupation and conquest: attackers must defeat defenders and hold the settlement centre.
  for (const [X, Y] of [[A, B], [B, A]] as const) {
    const attackers = ctx.byCiv[X.id]?.filter(c => c.role === 'soldier') ?? [];
    for (const st of settlementsOf(s, Y.id)) {
      const here = attackers.filter(a => a.alive && sphereDist(a.cellId, st.cellId, s) <= 1.5).length;
      const defenders = (ctx.byCiv[Y.id] ?? []).filter(d => d.alive && d.role === 'soldier' && sphereDist(d.cellId, st.cellId, s) <= 3).length
        + ctx.creatures.filter(g => g.alive && g.species === 'golem' && sphereDist(g.cellId, st.cellId, s) <= 3 && s.territory[g.cellId] === Y.idx).length;
      if (here >= 2 && defenders === 0) {
        if (st.occupiedBy === X.id) st.occupiedHours += dt; else { st.occupiedBy = X.id; st.occupiedHours = dt; }
      } else if (st.occupiedHours > 0) {
        st.occupiedHours = Math.max(0, st.occupiedHours - dt * 0.5);
        if (st.occupiedHours === 0) st.occupiedBy = null;
      }
      if (st.occupiedBy === X.id && st.occupiedHours >= DIPLOMACY.occupationHours &&
          X.militaryStrength >= DIPLOMACY.conquestRatio * Math.max(Y.militaryStrength, 1)) {
        logEvent(s, 'war', `The ${X.name} conquered ${st.name} from the ${Y.name}.`, { civId: X.id });
        emitFx(s, 'conquest', st.cellId);
        transferSettlement(s, st, X);
        civLog(s, [X, Y], `${st.name} fell to the ${X.name}.`);
        if (settlementsOf(s, Y.id).length === 0) fallCiv(s, Y, X);
        endWar(s, rel, `The war between the ${X.name} and the ${Y.name} ended with the conquest of ${st.name}.`);
        return;
      }
    }
  }
}

export function updateWars(s: WorldState, ctx: Ctx, dt: number): void {
  for (const rel of Object.values(s.relations)) if (rel.status === 'war') warTick(s, ctx, rel, dt);
  for (const civ of aliveCivs(s)) {
    civ.recruitTimer -= dt;
    if (civ.recruitTimer <= 0) { civ.recruitTimer = 6; autoMilitary(s, civ); }
  }
}

// ============ Diplomacy (daily) ============

function minSettlementDist(s: WorldState, a: Civilization, b: Civilization): number {
  let d = Infinity;
  const sa = settlementsOf(s, a.id), sb = settlementsOf(s, b.id);
  for (const x of sa) for (const y of sb) d = Math.min(d, sphereDist(x.cellId, y.cellId, s));
  return d;
}

export function updateDiplomacy(s: WorldState): void {
  const civs = aliveCivs(s);
  for (let i = 0; i < civs.length; i++) {
    for (let j = i + 1; j < civs.length; j++) {
      const a = civs[i], b = civs[j];
      const rel = getRelation(s, a.id, b.id);
      if (rel.status === 'war') continue;
      if (rel.status === 'truce') {
        if (s.day < rel.truceUntil) { rel.tension = Math.max(0, rel.tension - 0.5); continue; }
        rel.status = rel.tension >= DIPLOMACY.tensionAt ? 'tension' : 'peace';
        logEvent(s, 'war', `The truce between the ${a.name} and the ${b.name} has ended.`, { civId: a.id });
      }
      const fr = s.borderFriction[rel.id] ?? 0;
      const dist = minSettlementDist(s, a, b);
      let d = 0;
      if (fr > 0) d += Math.min(2, fr * 0.08);
      d += VISION.mobilizeTension * (a.mobilize + b.mobilize);
      d += VISION.inciteTension * incitedBetween(s, rel.id);
      if (dist < 7) d += 0.8;
      for (const [x, y] of [[a, b], [b, a]] as const) {
        if (x.resources.food < x.population * 1.0 && y.resources.food > y.population * 4) d += 0.5;
      }
      const hi = Math.max(a.militaryStrength, b.militaryStrength), lo = Math.min(a.militaryStrength, b.militaryStrength);
      if (hi > 15 && hi >= 2 * Math.max(lo, 1) && dist < 14) d += 0.4;
      if (d === 0) d = -DIPLOMACY.calmDecay;
      rel.tension = clamp(rel.tension + d, 0, DIPLOMACY.maxTension);

      if (fr >= 3 && s.day - rel.lastIncident >= DIPLOMACY.skirmishEveryDays) {
        rel.lastIncident = s.day;
        rel.tension = clamp(rel.tension + 6, 0, DIPLOMACY.maxTension);
        logEvent(s, 'war', `Border skirmishes flare between the ${a.name} and the ${b.name}.`, { civId: a.id, key: `skirm:${rel.id}`, windowDays: 8 });
        civLog(s, [a, b], 'Border incident.');
      }
      if (rel.status === 'tension' && fr === 0 && s.day - rel.lastEnvoy >= 15) {
        rel.lastEnvoy = s.day;
        rel.tension = Math.max(0, rel.tension - 10);
        logEvent(s, 'civ', `Envoys of the ${a.name} and the ${b.name} eased tensions.`, { civId: a.id, key: `envoy:${rel.id}`, windowDays: 10 });
      }
      if (rel.status === 'peace' && rel.tension >= DIPLOMACY.tensionAt) {
        rel.status = 'tension'; rel.since = s.day;
        logEvent(s, 'war', `Relations between the ${a.name} and the ${b.name} grow tense.`, { civId: a.id });
        notify(s, `Tension rises: ${a.name} and ${b.name}.`, 'warn');
      } else if (rel.status === 'tension' && rel.tension < DIPLOMACY.peaceAt) {
        rel.status = 'peace'; rel.since = s.day;
        logEvent(s, 'civ', `Peace settles between the ${a.name} and the ${b.name}.`, { civId: a.id });
      }
      if (rel.status === 'tension' && rel.tension >= DIPLOMACY.warAt) {
        const wars = (c: Civilization) => civRelations(s, c).filter(r => r.status === 'war').length;
        const eligible = [a, b].filter(c =>
          c.soldiers >= MILITARY.minSoldiersForWar && wars(c) === 0 && s.day - c.founded >= DIPLOMACY.minCivAgeForWar);
        if (eligible.length) {
          eligible.sort((x, y) => y.militaryStrength * y.aggression - x.militaryStrength * x.aggression);
          const ag = eligible[0];
          declareWar(s, ag, ag === a ? b : a, fr > 0 ? 'a dispute over territory' : 'mounting hostility');
        }
      }
    }
  }
}

// ============ Expansion, secession, orphans (daily) ============

function nearWater(s: WorldState, cell: number): boolean {
  return neighbors(cell, s).some(n => isWaterType(s.cells[n].type));
}

export function findColonySite(s: WorldState, civ: Civilization): number | null {
  const own = settlementsOf(s, civ.id);
  if (!own.length) return null;
  const cap = own[0];
  const lm = landmassOf(s, cap.cellId);
  let best = -1, bestScore = -Infinity;
  for (const cell of cellsWithin(cap.cellId, EXPANSION.maxDist + 4, s)) {
    const c = s.cells[cell];
    if (!isHumanSpawnCell(c) || c.fertility < 0.35 || c.crater >= 0.25) continue;
    if (landmassOf(s, cell) !== lm) continue;
    const o = s.territory[cell];
    if (o !== -1 && o !== civ.idx) continue;
    const dOwn = Math.min(...own.map(t => sphereDist(t.cellId, cell, s)));
    if (dOwn < EXPANSION.minDist || dOwn > EXPANSION.maxDist) continue;
    let tooClose = false;
    for (const st of Object.values(s.settlements)) if (st.civId !== civ.id && sphereDist(st.cellId, cell, s) < 8) { tooClose = true; break; }
    if (tooClose) continue;
    const score = c.fertility * 2 + (nearWater(s, cell) ? 0.5 : 0) - cell * 1e-6;
    if (score > bestScore) { bestScore = score; best = cell; }
  }
  return best >= 0 ? best : null;
}

export function foundColony(s: WorldState, civ: Civilization): Settlement | null {
  const own = settlementsOf(s, civ.id);
  if (own.length >= EXPANSION.maxSettlementsPerCiv || civ.population < EXPANSION.minPop) return null;
  if (s.day - civ.lastColony < EXPANSION.cooldownDays) return null;
  if (civ.resources.wood < EXPANSION.woodCost + 10 || civ.resources.food < EXPANSION.foodCost + 10) return null;
  if (civ.housing.used < civ.housing.capacity - 1) return null;
  const site = findColonySite(s, civ);
  if (site === null) return null;
  const settlers = Object.values(s.citizens)
    .filter(c => c.alive && c.civId === civ.id && c.role === 'civilian' && lifeStage(c) === 'adult')
    .sort((a, b) => cellDistance(a.cellId, own[0].cellId, s) - cellDistance(b.cellId, own[0].cellId, s))
    .slice(0, 2);
  if (settlers.length < 2) return null;
  civ.resources.wood -= EXPANSION.woodCost;
  civ.resources.food -= EXPANSION.foodCost;
  civ.lastColony = s.day;
  const st = foundSettlement(s, civ, site);
  placeBuilding(s, civ, st, 'shelter', true);
  for (const c of settlers) {
    if (c.homeId) { const h = s.buildings[c.homeId]; if (h) h.residents = h.residents.filter(r => r !== c.id); c.homeId = null; }
    c.task = 'travel'; c.taskId = null; c.path = [];
    routeTo(s, c, site);
  }
  logEvent(s, 'settlement', `Settlers of the ${civ.name} founded ${st.name}.`, { civId: civ.id });
  civLog(s, [civ], `Founded the colony ${st.name}.`);
  updateTerritory(s);
  return st;
}

export function checkSecession(s: WorldState): void {
  for (const st of Object.values(s.settlements)) {
    const civ = s.civs[st.civId];
    if (!civ || !civ.alive || civ.capitalId === st.id) continue;
    const cap = civ.capitalId ? s.settlements[civ.capitalId] : undefined;
    if (!cap || s.day - st.founded < EXPANSION.secedeMinAgeDays || civ.population < EXPANSION.secedeMinCivPop) continue;
    if (sphereDist(st.cellId, cap.cellId, s) < EXPANSION.secedeMinDist) continue;
    if (hash2(parseInt(st.id.slice(1), 36), s.seed, 77) >= 0.5) continue;
    const builtHere = Object.values(s.buildings).filter(b => b.built && b.settlementId === st.id).length;
    const folk = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id && c.role === 'civilian' && sphereDist(c.cellId, st.cellId, s) <= 5).length;
    if (builtHere < 3 || folk < EXPANSION.secedeMinPop) continue;
    const nc = createCivilization(s);
    for (const k of ['food', 'wood', 'stone'] as const) {
      const share = civ.resources[k] * 0.3;
      civ.resources[k] -= share; nc.resources[k] = share;
    }
    transferSettlement(s, st, nc);
    nc.era = 'Village';
    const rel = getRelation(s, civ.id, nc.id);
    rel.tension = 25;
    refreshLeadership(s, nc.id);
    logEvent(s, 'civ', `${st.name} broke away from the ${civ.name} and became the ${nc.name}.`, { civId: nc.id });
    civLog(s, [civ, nc], `${st.name} seceded as the ${nc.name}.`);
    notify(s, `A new civilization rises: the ${nc.name}.`, 'good');
    return; // at most one secession per day
  }
}

export function adoptOrphans(s: WorldState): void {
  const orphans = Object.values(s.citizens).filter(c => c.alive && !c.civId);
  if (!orphans.length) return;
  const left: Citizen[] = [];
  let joined = 0;
  let joinedCiv: Civilization | undefined;
  for (const o of orphans) {
    let best: Settlement | undefined, bd = 22;
    for (const st of Object.values(s.settlements)) {
      if (!s.civs[st.civId]?.alive) continue;
      const d = sphereDist(o.cellId, st.cellId, s);
      if (d < bd && landmassOf(s, o.cellId) === landmassOf(s, st.cellId)) { bd = d; best = st; }
    }
    if (best) { o.civId = best.civId; joined++; joinedCiv = s.civs[best.civId]; o.task = 'idle'; o.path = []; o.goal = null; }
    else left.push(o);
  }
  if (joined && joinedCiv) logEvent(s, 'civ', `${joined} wanderer${joined > 1 ? 's' : ''} found refuge with the ${joinedCiv.name}.`, { civId: joinedCiv.id, key: 'refuge', windowDays: 2 });
  // Groups of two or more adults on the same landmass found a new civilization.
  {
    const groups = new Map<number, Citizen[]>();
    for (const o of left) {
      if (lifeStage(o) !== 'adult' || !isHumanSpawnCell(s.cells[o.cellId])) continue;
      const lm = landmassOf(s, o.cellId);
      const g = groups.get(lm) ?? [];
      g.push(o); groups.set(lm, g);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const cell = g[0].cellId;
       if (s.territory[cell] !== -1 || !isHumanSpawnCell(s.cells[cell])) continue;
      if (s.generation.size !== 'legacy' && !suitableFoundingSite(s, cell)) continue;
      foundCivilization(s, cell, g, 'is rebuilt by survivors');
    }
  }
}

/** Settlements without buildings or people are abandoned; civs without settlements regroup or fall. */
export function checkCollapse(s: WorldState): void {
  for (const st of Object.values(s.settlements)) {
    if (s.day - st.founded < 3) continue;
    const hasBuilding = Object.values(s.buildings).some(b => b.settlementId === st.id);
    if (hasBuilding) continue;
    const folk = Object.values(s.citizens).some(c => c.alive && c.civId === st.civId && sphereDist(c.cellId, st.cellId, s) <= 8);
    if (folk) continue;
    const civ = s.civs[st.civId];
    delete s.settlements[st.id];
    logEvent(s, 'settlement', `${st.name} was abandoned.`, { civId: st.civId });
    civLog(s, [civ], `${st.name} was abandoned.`);
    if (civ && civ.capitalId === st.id) civ.capitalId = settlementsOf(s, civ.id)[0]?.id ?? null;
  }
  for (const civ of aliveCivs(s)) {
    if (settlementsOf(s, civ.id).length > 0) continue;
    const people = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id);
    const adult = people.find(c => lifeStage(c) === 'adult');
    const site = adult ? findHumanSpawnCells(s.cells, adult.cellId, 1)[0] : undefined;
    if (site !== undefined && adult && landmassOf(s, adult.cellId) === landmassOf(s, site) &&
        (s.territory[site] === -1 || s.territory[site] === civ.idx)) {
      const st = foundSettlement(s, civ, site);
      placeBuilding(s, civ, st, 'shelter', true);
      logEvent(s, 'settlement', `Survivors of the ${civ.name} rebuilt at ${st.name}.`, { civId: civ.id });
      civLog(s, [civ], `Rebuilt at ${st.name}.`);
      updateTerritory(s);
    } else {
      fallCiv(s, civ);
    }
  }
}

/** How many humans incited by a divine vision are agitating between two civilizations. */
export function incitedBetween(s: WorldState, relId: string): number {
  const [a, b] = relId.split('|');
  let n = 0;
  for (const c of Object.values(s.citizens)) {
    if (!c.alive || c.incitedUntil <= s.day) continue;
    if (c.civId === a || c.civId === b) n++;
  }
  return n;
}

export function civDaily(s: WorldState): void {
  updateDiplomacy(s);
  for (const civ of Object.values(s.civs)) {
    if (civ.mobilize > 0) civ.mobilize = Math.max(0, civ.mobilize - VISION.mobilizeDecayPerDay);
  }
  checkCollapse(s);
  checkSecession(s);
  for (const civ of aliveCivs(s)) {
    foundColony(s, civ);
    const era = computeEra(s, civ);
    refreshLeadership(s, civ.id);
    if (era !== civ.era) {
      civ.era = era;
      logEvent(s, 'milestone', `The ${civ.name} entered the ${era} era.`, { civId: civ.id });
      civLog(s, [civ], `Entered the ${era} era.`);
    }
    for (const st of settlementsOf(s, civ.id)) st.stage = civ.era;
    // return home guards to civilian life when no rival threatens and no standing guard is requested
    const threatened = civRelations(s, civ).some(r => r.status === 'war' || r.status === 'tension');
    if (!threatened && civ.soldiers > civ.guardTarget) demobilize(s, civ, 1);
  }
  adoptOrphans(s);
}

// ============ World-management: seed a new civilization ============

export function findSeedSite(s: WorldState): number | null {
  let best = -1, bestScore = -Infinity;
  for (const i of (s.generation.size === 'legacy' ? s.cells.map(c=>c.id) : analyseGeography(s.cells, s.terrainRev).candidates)) {
    const c = s.cells[i];
    if (!isHumanSpawnCell(c) || (c.type !== 'plains' && c.type !== 'fertile') || c.fertility < 0.45 || c.crater > 0.2) continue;
    if (s.territory[i] !== -1) continue;
    let minD = 40;
    for (const st of Object.values(s.settlements)) minD = Math.min(minD, sphereDist(i, st.cellId, s));
    if (minD < 12) continue;
    if (s.generation.size !== 'legacy' && !suitableFoundingSite(s, i, 12)) continue;
    const score = Math.min(minD, 30) + c.fertility * 6 + (nearWater(s, i) ? 2 : 0) + hash2(i, s.seed, 9) * 0.5;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best >= 0 ? best : null;
}
