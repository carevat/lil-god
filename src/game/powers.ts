// Divine powers. Every power mutates the authoritative world state and enforces cost + cooldown.

import type { WorldState, SpeciesId, Citizen, Creature, TerrainType } from './types';
import { POWERS, LIGHTNING, METEOR, ENV, FIRST_LIFE, CIV_SEED_COST, HUMAN_HABITAT, type PowerId } from './config';
import { SPECIES } from './species';
import { suitableFoundingSite } from './geography';
import { humanCapacity, speciesCapacity } from './scale';
import { rand, newId, logEvent, notify, emitFx } from './util';
import { applyDamage, killEntity, effectiveCell, createHuman, createCreature, damageBuilding } from './lifecycle';
import { cellsWithin, sphereDist, findSpawnCells, findHumanSpawnCells, landmassOf, isWaterType, biomeFrom, neighbors, GRASS_MAX } from './world';
import { foundCivilization, civLog, findSeedSite, updateTerritory } from './civ';
import { placeBuilding } from './buildings';

export interface PowerResult { ok: boolean; reason?: string; killed?: number; destroyed?: number; created?: number; civId?: string; cellId?: number }
const fail = (reason: string): PowerResult => ({ ok: false, reason });

export function cooldownLeft(s: WorldState, key: string): number {
  return Math.max(0, s.powerCd[key] ?? 0);
}

/** Returns an explanation if the power cannot be used right now, otherwise null. */
export function checkPower(s: WorldState, label: string, cost: number, cdKey: string): string | null {
  const cd = cooldownLeft(s, cdKey);
  if (cd > 0) return `${label} is recharging (${cd.toFixed(1)}h).`;
  if (s.divineEnergy < cost) return `Not enough divine energy — ${label} needs ${cost}.`;
  return null;
}

export function spend(s: WorldState, cost: number, cdKey: string, cdHours: number) {
  s.divineEnergy -= cost;
  if (cdHours > 0) s.powerCd[cdKey] = cdHours;
}

export function tickCooldowns(s: WorldState, hours: number): void {
  for (const k of Object.keys(s.powerCd)) {
    s.powerCd[k] = Math.max(0, s.powerCd[k] - hours);
    if (s.powerCd[k] === 0) delete s.powerCd[k];
  }
}

function whereIs(s: WorldState, cell: number): string {
  let best = '', bd = 10;
  for (const st of Object.values(s.settlements)) {
    const d = sphereDist(cell, st.cellId, s);
    if (d < bd) { bd = d; best = st.name; }
  }
  return best ? `near ${best}` : 'open land';
}

// ============ Lightning ============

export function castLightning(s: WorldState, cellId: number): PowerResult {
  const err = checkPower(s, 'Lightning', POWERS.lightning.cost, 'lightning');
  if (err) return fail(err);
  spend(s, POWERS.lightning.cost, 'lightning', POWERS.lightning.cooldown);
  const R = LIGHTNING.radius;
  let killed = 0, destroyed = 0;
  for (const e of [...Object.values(s.citizens), ...Object.values(s.creatures)]) {
    if (!e.alive) continue;
    const d = sphereDist(cellId, effectiveCell(e), s);
    if (d >= R) continue;
    const dmg = LIGHTNING.maxDamage * Math.pow(1 - d / R, LIGHTNING.exponent);
    if (applyDamage(s, e, dmg, { kind: 'lightning' }).killed) killed++;
  }
  for (const id of cellsWithin(cellId, R, s)) {
    const c = s.cells[id];
    const d = sphereDist(cellId, id, s);
    const f = 1 - d / R;
    if (isWaterType(c.type)) continue;
    c.scorch = Math.max(c.scorch, Math.min(1, f * 1.3));
    if (d < 0.5) c.trees = 0; else if (d <= 1.2 && c.trees > 0) c.trees--;
    c.grass = Math.max(0, c.grass - 0.3 * f);
    const b = c.buildingId ? s.buildings[c.buildingId] : undefined;
    if (b && damageBuilding(s, b, LIGHTNING.maxDamage * LIGHTNING.buildingFactor * Math.pow(f, LIGHTNING.exponent), { kind: 'lightning' })) destroyed++;
  }
  logEvent(s, 'divine', `Lightning struck ${whereIs(s, cellId)}${killed ? `, killing ${killed}` : ''}.`, { key: 'lightning', windowDays: 0.1 });
  notify(s, killed || destroyed ? `Lightning: ${killed} killed, ${destroyed} building${destroyed === 1 ? '' : 's'} destroyed.` : 'Lightning struck the land.', killed ? 'warn' : 'info');
  return { ok: true, killed, destroyed };
}

// ============ Meteors ============

export function scheduleMeteor(s: WorldState, cellId: number, radius: number, showerId: string | null) {
  s.meteors.push({ id: newId(s, 'm'), cellId, radius, timeLeft: METEOR.warnHours, warn: METEOR.warnHours, showerId });
}

export function castMeteor(s: WorldState, cellId: number): PowerResult {
  const err = checkPower(s, 'Meteor', POWERS.meteor.cost, 'meteor');
  if (err) return fail(err);
  spend(s, POWERS.meteor.cost, 'meteor', POWERS.meteor.cooldown);
  scheduleMeteor(s, cellId, METEOR.radius, null);
  notify(s, 'Meteor incoming — brace for impact.', 'warn');
  return { ok: true };
}

export function castShower(s: WorldState, cellId: number): PowerResult {
  const err = checkPower(s, 'Meteor Shower', POWERS.shower.cost, 'shower');
  if (err) return fail(err);
  if (s.showers.length > 0) return fail('A meteor shower is already in progress.');
  spend(s, POWERS.shower.cost, 'shower', POWERS.shower.cooldown);
  s.showers.push({
    id: newId(s, 'h'), centerCell: cellId, remaining: METEOR.showerCount, total: METEOR.showerCount,
    nextIn: 0, spread: METEOR.showerSpread, hits: 0, used: [],
  });
  logEvent(s, 'meteor', `A meteor shower begins over ${whereIs(s, cellId)}.`);
  notify(s, 'Meteor shower incoming!', 'warn');
  return { ok: true };
}

/** Cancel the remaining meteors of an active shower (already-falling meteors still land). */
export function cancelShower(s: WorldState): PowerResult {
  if (s.showers.length === 0) return fail('No meteor shower is active.');
  const sh = s.showers[0];
  const left = sh.remaining;
  sh.remaining = 0;
  logEvent(s, 'meteor', `The meteor shower was called off (${left} meteors cancelled).`);
  notify(s, `Shower cancelled — ${left} meteors withheld.`, 'info');
  return { ok: true };
}

/** Advance meteor timers. `hours` is real-time paced (1h = 1s) so impacts stay visible at any game speed. */
export function updateMeteors(s: WorldState, hours: number): void {
  for (const sh of [...s.showers]) {
    sh.nextIn -= hours;
    while (sh.nextIn <= 0 && sh.remaining > 0) {
      const cands = cellsWithin(sh.centerCell, sh.spread, s).filter(c => !sh.used.includes(c));
      const pool = cands.length ? cands : cellsWithin(sh.centerCell, sh.spread, s);
      const cell = pool[Math.floor(rand(s) * pool.length)];
      sh.used.push(cell);
      scheduleMeteor(s, cell, METEOR.showerRadius, sh.id);
      sh.remaining--;
      sh.nextIn += METEOR.showerInterval;
    }
  }
  for (const m of [...s.meteors]) {
    m.timeLeft -= hours;
    if (m.timeLeft > 0) continue;
    s.meteors = s.meteors.filter(x => x.id !== m.id);
    const res = impactMeteor(s, m.cellId, m.radius, m.showerId !== null);
    const sh = s.showers.find(x => x.id === m.showerId);
    if (sh) sh.hits++;
    void res;
  }
  for (const sh of [...s.showers]) {
    if (sh.remaining <= 0 && !s.meteors.some(m => m.showerId === sh.id)) {
      logEvent(s, 'meteor', `The meteor shower ended after ${sh.hits} impact${sh.hits === 1 ? '' : 's'}.`);
      notify(s, `The shower has passed: ${sh.hits} impacts.`, 'info');
      s.showers = s.showers.filter(x => x.id !== sh.id);
    }
  }
}

const falloff = (d: number, r: number) => (d >= r ? 0 : Math.pow(1 - d / r, METEOR.falloffExp));

/** Apply a meteor impact. Deterministic radial falloff; terrain geometry is never altered. */
export function impactMeteor(s: WorldState, cellId: number, radius: number, shower: boolean): { killed: number; buildings: number } {
  let killed = 0, buildings = 0;
  const core = radius * METEOR.craterCore;
  for (const id of cellsWithin(cellId, radius, s)) {
    const c = s.cells[id];
    if (isWaterType(c.type)) continue;
    const d = sphereDist(cellId, id, s);
    const f = falloff(d, radius);
    if (f <= 0) continue;
    if (c.trees > 0) c.trees = Math.max(0, c.trees - Math.ceil(c.trees * Math.min(1, f * 1.5)));
    c.grass = Math.max(0, c.grass * (1 - f));
    c.fertility = Math.max(0.05, c.fertility * (1 - 0.5 * f));
    c.moisture = Math.max(0, c.moisture - 0.3 * f);
    c.drought = Math.min(1, c.drought + 0.3 * f);
    c.scorch = Math.max(c.scorch, f);
    const cr = d <= core ? 1 - 0.4 * (d / core) : 0.35 * f;
    if (cr >= 0.15) c.crater = Math.max(c.crater, cr);
    const b = c.buildingId ? s.buildings[c.buildingId] : undefined;
    if (b && damageBuilding(s, b, METEOR.buildingDamage * f, { kind: 'meteor' })) buildings++;
  }
  for (const e of [...Object.values(s.citizens), ...Object.values(s.creatures)]) {
    if (!e.alive) continue;
    const d = sphereDist(cellId, effectiveCell(e), s);
    const f = falloff(d, radius);
    if (f <= 0) continue;
    if (applyDamage(s, e, METEOR.maxDamage * f, { kind: 'meteor' }).killed) killed++;
  }
  s.dust = Math.min(1, s.dust + METEOR.dustPerImpact * (radius / METEOR.radius));
  s.terrainRev++;
  s.impacts.push({ id: newId(s, 'i'), day: s.day, cellId, radius, killed, buildings, shower });
  if (s.impacts.length > 12) s.impacts.shift();
  emitFx(s, 'impact', cellId);
  if (!shower) {
    logEvent(s, 'meteor', `A meteor struck ${whereIs(s, cellId)}: ${killed} killed, ${buildings} building${buildings === 1 ? '' : 's'} destroyed.`);
    notify(s, `Impact! ${killed} killed, ${buildings} building${buildings === 1 ? '' : 's'} destroyed.`, 'warn');
  }
  return { killed, buildings };
}

// ============ Rain / Nature / Terraform ============

export function castRain(s: WorldState, cellId: number): PowerResult {
  if (isWaterType(s.cells[cellId].type)) return fail('Rain over open ocean would achieve nothing.');
  const err = checkPower(s, 'Rain', POWERS.rain.cost, 'rain');
  if (err) return fail(err);
  spend(s, POWERS.rain.cost, 'rain', POWERS.rain.cooldown);
  for (const id of cellsWithin(cellId, POWERS.rain.radius, s)) {
    const c = s.cells[id];
    if (isWaterType(c.type)) continue;
    c.moisture = Math.min(1, c.moisture + 0.35);
    c.drought = Math.max(0, c.drought - 0.5);
  }
  s.dust = Math.max(0, s.dust - 0.1);
  logEvent(s, 'divine', `Rain fell ${whereIs(s, cellId)}.`, { key: 'rain', windowDays: 0.5 });
  return { ok: true };
}

export function castNature(s: WorldState, cellId: number): PowerResult {
  const t = s.cells[cellId].type;
  if (isWaterType(t)) return fail('Nothing can grow in open water.');
  if (t === 'mountain') return fail('Bare mountain rock is too harsh for new growth.');
  const err = checkPower(s, 'Nature', POWERS.nature.cost, 'nature');
  if (err) return fail(err);
  spend(s, POWERS.nature.cost, 'nature', POWERS.nature.cooldown);
  let planted = 0;
  for (const id of cellsWithin(cellId, POWERS.nature.radius, s)) {
    const c = s.cells[id];
    if (isWaterType(c.type) || c.type === 'mountain' || c.crater >= ENV.craterBuildBlock) continue;
    const cap = c.maxTrees + 2;
    if (!c.buildingId && c.trees < cap) { c.trees++; planted++; }
    c.fertility = Math.min(1, c.fertility + 0.15);
    c.moisture = Math.min(1, c.moisture + 0.1);
    c.grass = Math.min(1, c.grass + 0.3);
    if (c.type === 'plains' && c.fertility > 0.6 && c.moisture > 0.5 && rand(s) < 0.3) { c.type = 'fertile'; c.maxTrees = Math.floor(rand(s) * 2); }
  }
  logEvent(s, 'divine', 'Nature flourished in the land.', { key: 'nature', windowDays: 0.5 });
  return { ok: true, created: planted };
}

function typeFor(c: { elevation: number; moisture: number }): TerrainType {
  return biomeFrom(c.elevation, c.moisture, 0.6);
}

export function castTerraform(s: WorldState, cellId: number, raise: boolean): PowerResult {
  const c = s.cells[cellId];
  if (c.buildingId) return fail('Cannot reshape land beneath a building.');
  const err = checkPower(s, 'Terraform', POWERS.terraform.cost, 'terraform');
  if (err) return fail(err);
  spend(s, POWERS.terraform.cost, 'terraform', POWERS.terraform.cooldown);
  c.elevation = Math.max(-1, Math.min(1, c.elevation + (raise ? 0.2 : -0.2)));
  const old = c.type;
  c.type = typeFor(c);
  if (c.type !== old) {
    if (isWaterType(c.type)) { c.trees = 0; c.maxTrees = 0; c.stone = 0; c.grass = 0; }
    else if (c.type === 'mountain') { c.trees = 0; c.maxTrees = 0; c.stone = Math.max(c.stone, 6); c.grass = Math.min(c.grass, GRASS_MAX.mountain); }
    else if (c.type === 'forest') c.maxTrees = Math.max(c.maxTrees, 3);
    else { c.maxTrees = Math.min(c.maxTrees, 1); c.trees = Math.min(c.trees, c.maxTrees); }
    if (!isWaterType(c.type)) c.fertility = Math.max(c.fertility, c.type === 'beach' ? 0.15 : 0.3);
    c.grass = Math.min(c.grass, GRASS_MAX[c.type]);
    s.terrainRev++;
    if (isWaterType(c.type)) relocateFrom(s, cellId);
    updateTerritory(s);
  }
  logEvent(s, 'divine', 'The earth was reshaped.', { key: 'terraform', windowDays: 0.5 });
  return { ok: true };
}

/** Move (or drown) anything standing on a cell that has just become water. */
export function relocateFrom(s: WorldState, cellId: number): void {
  const land = (() => {
    const seen = new Set([cellId]); const q = [cellId]; let h = 0;
    while (h < q.length && h < 200) {
      const cur = q[h++];
      for (const n of neighbors(cur, s)) {
        if (seen.has(n)) continue; seen.add(n);
        if (!isWaterType(s.cells[n].type)) return n;
        q.push(n);
      }
    }
    return -1;
  })();
  for (const e of [...Object.values(s.citizens), ...Object.values(s.creatures)]) {
    if (!e.alive || (e.cellId !== cellId && e.targetCellId !== cellId)) continue;
    if (land >= 0) { e.cellId = land; e.targetCellId = null; e.moveProgress = 1; e.path = []; e.goal = null; if (e.task !== 'idle') e.task = 'idle'; }
    else killEntity(s, e, 'drowned');
  }
}

// ============ Life Forge ============

function joinTarget(s: WorldState, cellId: number): string | null {
  let best: string | null = null, bd = 12;
  const lm = landmassOf(s, cellId);
  for (const st of Object.values(s.settlements)) {
    if (!s.civs[st.civId]?.alive) continue;
    const d = sphereDist(cellId, st.cellId, s);
    if (d < bd && landmassOf(s, st.cellId) === lm) { bd = d; best = st.civId; }
  }
  return best;
}

export function canPlaceSpecies(s: WorldState, species: SpeciesId, cellId: number): { ok: boolean; reason?: string } {
  const sp = SPECIES[species];
  const cell = s.cells[cellId];
  if (!cell) return { ok: false, reason: 'Select a location on the planet.' };
  const polarHuman = species === 'human' && (cell.lat > HUMAN_HABITAT.northLimit || cell.lat < HUMAN_HABITAT.southLimit);
  if (polarHuman && isWaterType(cell.type)) return { ok: false, reason: 'Cannot create humans in the ocean, even near the poles.' };
  if (!polarHuman && !sp.habitat.includes(cell.type)) {
    return { ok: false, reason: isWaterType(cell.type) ? `${sp.label} cannot be placed in the ocean.` : `${sp.label} need: ${sp.habitatText.toLowerCase()}.` };
  }
  if (!polarHuman && cell.crater >= ENV.craterBuildBlock) return { ok: false, reason: 'The ground here is scarred by an impact.' };
  const living = species === 'human'
    ? Object.values(s.citizens).filter(c => c.alive).length
    : Object.values(s.creatures).filter(c => c.alive && c.species === species).length;
  const spawnCount = species === 'human' && !s.milestones.firstLife ? FIRST_LIFE.count : sp.spawnCount;
  if (living + spawnCount > (species === 'human' ? humanCapacity(s) : speciesCapacity(s, species))) {
    return { ok: false, reason: species === 'golem' ? `Golem limit reached (${speciesCapacity(s, 'golem')}).` : `The world cannot sustain more ${sp.label.toLowerCase()}.` };
  }
  const humanSite = polarHuman ? findHumanSpawnCells(s.cells, cellId, 1)[0] : cellId;
  if (species === 'human' && humanSite !== undefined && joinTarget(s, humanSite) === null &&
      s.generation.size !== 'legacy' && !suitableFoundingSite(s, humanSite)) {
    return { ok: false, reason: 'This land cannot support a new settlement. Choose a roomier region away from other settlements.' };
  }
  if (polarHuman) {
    return findHumanSpawnCells(s.cells, cellId, 1).length
      ? { ok: true, reason: 'The polar region is uninhabitable; people will arrive on safer land.' }
      : { ok: false, reason: 'No habitable land exists outside the polar region.' };
  }
  return { ok: true };
}

export function castSpawn(s: WorldState, species: SpeciesId, cellId: number): PowerResult {
  const sp = SPECIES[species];
  const polarHuman = species === 'human' &&
    (s.cells[cellId]?.lat > HUMAN_HABITAT.northLimit || s.cells[cellId]?.lat < HUMAN_HABITAT.southLimit);
  const ok = canPlaceSpecies(s, species, cellId);
  if (!ok.ok) return fail(ok.reason!);
  let count = sp.spawnCount, cost = sp.cost;
  if (species === 'human' && !s.milestones.firstLife) { count = FIRST_LIFE.count; cost = FIRST_LIFE.cost; }
  const cdKey = `spawn:${species}`;
  const err = checkPower(s, sp.label, cost, cdKey);
  if (err) return fail(err);
  const cells = species === 'human' ? findHumanSpawnCells(s.cells, cellId, count) : findSpawnCells(s.cells, cellId, count, sp.habitat);
  if (cells.length < count) return fail('There is no habitable room to place them outside the polar region.');
  spend(s, cost, cdKey, sp.spawnCooldownHours);
  emitFx(s, 'birth', cellId);

  if (species === 'human') {
    if (cells[0] !== cellId) notify(s, polarHuman
      ? 'The polar region cannot support new people. They arrived on safer land.'
      : 'No room here; your people arrived on nearby habitable land.', 'warn');
    s.milestones.firstLife = true;
    const humans: Citizen[] = cells.map((c, i) => createHuman(s, c, { gender: i % 2 === 0 ? 'm' : 'f' }));
    const target = joinTarget(s, cells[0]);
    if (target) {
      for (const h of humans) h.civId = target;
      civLog(s, [s.civs[target]], `${humans.length} newcomers arrived.`);
      logEvent(s, 'divine', `${humans.map(h => h.name).join(', ')} were created and joined the ${s.civs[target].name}.`, { civId: target, entityId: humans[0].id });
    } else {
      foundCivilization(s, cells[0], humans);
      logEvent(s, 'divine', `${humans.map(h => h.name).join(', ')} were created by divine will.`, { entityId: humans[0].id });
    }
    if (!s.milestones.firstCitizen) {
      s.milestones.firstCitizen = true;
      logEvent(s, 'milestone', `The first citizen arrives: ${humans[0].name}.`, { entityId: humans[0].id });
    }
    notify(s, `${humans.length} humans created.`, 'good');
    return { ok: true, created: humans.length, cellId: cells[0] };
  }

  const packId = species === 'wolf' ? newId(s, 'p') : null;
  const made: Creature[] = cells.map((c, i) =>
    createCreature(s, species as Exclude<SpeciesId, 'human'>, c, { gender: i % 2 === 0 ? 'm' : 'f', packId, age: species === 'golem' ? 0 : undefined }));
  logEvent(s, 'species', `${sp.label} were introduced to the world${s.milestones[`intro:${species}`] ? '' : ' for the first time'}.`, { key: `intro:${species}`, windowDays: 2 });
  s.milestones[`intro:${species}`] = true;
  notify(s, `${made.length} ${made.length === 1 ? sp.singular.toLowerCase() : sp.label.toLowerCase()} created.`, 'good');
  return { ok: true, created: made.length };
}

// ============ Seed a new civilization (world management) ============

export function castSeedCiv(s: WorldState): PowerResult {
  if (Object.values(s.citizens).filter(c => c.alive).length + 3 > humanCapacity(s)) return fail('The human population budget is full. Let the existing settlements stabilize first.');
  const site = findSeedSite(s);
  if (site === null) return fail('No suitable unoccupied land remains.');
  const err = checkPower(s, 'Seeding a civilization', CIV_SEED_COST, 'seed');
  if (err) return fail(err);
  const cells = findHumanSpawnCells(s.cells, site, 3);
  if (cells.length < 3) return fail('The chosen land is too cramped.');
  spend(s, CIV_SEED_COST, 'seed', 10);
  const humans = cells.map((c, i) => createHuman(s, c, { gender: i % 2 === 0 ? 'm' : 'f' }));
  const civ = foundCivilization(s, cells[0], humans, 'is seeded by the gods');
  const st = Object.values(s.settlements).find(t => t.civId === civ.id)!;
  placeBuilding(s, civ, st, 'shelter', true);
  s.milestones.firstLife = true;
  return { ok: true, civId: civ.id, created: humans.length };
}

export function powerRadius(power: PowerId): number {
  return power === 'meteor' ? METEOR.radius : POWERS[power].radius;
}
