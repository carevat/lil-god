// Save validation + migration. Part 1 (v1) saves are upgraded in place of being discarded.

import type { SaveData, WorldState } from './types';
import { AGE_UNIT_DAYS, CAPS } from './config';
import { GRASS_MAX } from './world';
import { LEGACY_DIMENSIONS, WORLD_SIZES } from './scale';
import { emptyStats, emptyCounts, emptyResources } from './state';
import { SPECIES } from './species';
import { createCivilization, foundSettlement, updateTerritory } from './civ';
import { BUILDING_HP, BUILDING_CAPACITY } from './buildings';
import { refreshCounts } from './lifecycle';
import { logEvent } from './util';
import { refreshLeadership } from './authority';

/** Deterministic authority for a migrated human: stable for a given seed + id, so re-migrating never rerolls. */
export function authorityFor(seed: number, id: string): number {
  let h = Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return Math.round((1 + (h % 9901) / 100) * 100) / 100; // 1.00 .. 100.00
}

export const SAVE_VERSION = 5;

export type MigrationResult =
  | { ok: true; data: SaveData; migrated: boolean }
  | { ok: false; error: string };

const bad = (error: string): MigrationResult => ({ ok: false, error });

export function migrateSave(raw: unknown): MigrationResult {
  try {
    if (!raw || typeof raw !== 'object') return bad('The save file is not valid LITTLE GOD data.');
    const d = raw as Record<string, any>;
    const v = d.version;
    if (typeof v !== 'number') return bad('The save has no version number.');
    if (v > SAVE_VERSION) return bad(`This save is from a newer game version (v${v}). This build supports up to v${SAVE_VERSION}.`);
    if (v < 1) return bad(`Unsupported save version (v${v}).`);
    const st = d.state;
    if (!st || typeof st !== 'object') return bad('World data is missing.');
    if (!Array.isArray(st.cells)) return bad('Terrain data is missing.');
    const width = st.width ?? LEGACY_DIMENSIONS.width;
    const height = st.height ?? LEGACY_DIMENSIONS.height;
    if (!Object.values(WORLD_SIZES).some(size => size.width === width && size.height === height) || st.cells.length !== width * height) {
      return bad('The saved terrain dimensions are invalid; the original world has not been changed.');
    }
    if (st.radius !== undefined && (!Number.isFinite(st.radius) || st.radius <= 0 || st.radius > 30)) return bad('Invalid planet radius.');
    for (let i=0;i<st.cells.length;i++) {
      const c = st.cells[i];
      if (!c || c.id !== i || c.gx !== i % width || c.gy !== Math.floor(i / width) || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return bad('Terrain coordinates are corrupt.');
    }
    if (!st.citizens || typeof st.citizens !== 'object') return bad('Citizen data is missing.');
    const state = normalizeState(st, v);
    return {
      ok: true,
      migrated: v < SAVE_VERSION,
      data: { version: SAVE_VERSION, state, savedAt: d.savedAt ?? Date.now(), tutorialDone: !!d.tutorialDone, worldName: state.name },
    };
  } catch (e) {
    return bad(`The save could not be read (${e instanceof Error ? e.message : 'unknown error'}).`);
  }
}

/** Fill every field introduced after v1 with sensible defaults and repair dangling references. */
export function normalizeState(st: any, fromVersion: number): WorldState {
  const s = st as WorldState;
  const isV1 = fromVersion < 2;
  s.name = typeof s.name === 'string' ? s.name : 'Untitled';
  s.day = Number.isFinite(s.day) ? s.day : 0;
  s.seed = Number.isFinite(s.seed) ? s.seed : 1;
  s.width ??= LEGACY_DIMENSIONS.width;
  s.height ??= LEGACY_DIMENSIONS.height;
  s.radius ??= 5; // all pre-v5 saves used radius 5; never expand an existing world
  s.generation ??= { size: 'legacy', density: 'normal', preset: 'balanced', attempt: 0, initialCivilizations: 0, inhabitedRegions: 0 };
  s.ecologyPhase ??= 0; s.ecologyElapsed ??= 0; s.ecologyRevision ??= 0;
  const count = s.width * s.height;

  for (const c of s.cells) {
    c.grass ??= GRASS_MAX[c.type] * (0.8 + 0.2 * (c.moisture ?? 0.5));
    c.crater ??= 0; c.scorch ??= 0; c.buildingId ??= null;
    delete (c as any).occupantIds;
  }
  s.citizens ??= {}; s.creatures ??= {}; s.buildings ??= {}; s.settlements ??= {};
  s.civs ??= {}; s.relations ??= {}; s.events ??= [];
  s.meteors ??= []; s.showers ??= []; s.impacts ??= []; s.dust ??= 0; s.powerCd ??= {};
  s.rng ??= ((s.seed * 2654435761) ^ 0x9e3779b9) >>> 0;
  s.idCounter ??= 100000;
  s.civCounter ??= 0; s.terrainRev ??= 0;
  s.notices = []; s.fx = [];
  s.eventGate ??= {}; s.suppressed ??= {};
  s.stats ??= emptyStats(); s.milestones ??= {}; s.peaks ??= {};
  s.diploTimer ??= 0; s.terrTimer ??= 0; s.dayTimer ??= 0;
  s.pathBudget = CAPS.pathsPerTick; s.borderFriction = {};
  s.speciesCounts ??= emptyCounts();
  s.housing ??= { used: 0, capacity: 0 };
  s.resources ??= emptyResources();
  s.divineEnergy ??= 100; s.maxDivineEnergy ??= 100; s.divineRegen ??= 0.5;
  s.weather ??= 'clear'; s.weatherTimer ??= 30; s.timeOfDay ??= 0.25;
  if (!Array.isArray(s.territory) || s.territory.length !== count) s.territory = new Array(count).fill(-1);
  if (isV1) { s.milestones.firstLife = true; s.milestones.firstCitizen = true; }

  // Citizens
  for (const c of Object.values(s.citizens) as any[]) {
    if (isV1) {
      c.age = ((c.age ?? 0) / 365) * AGE_UNIT_DAYS;
      c.maxAge = ((c.maxAge ?? 70 * 365) / 365) * AGE_UNIT_DAYS;
      c.health = (c.health ?? 1) * SPECIES.human.maxHealth;
      c.parentIds = Array.isArray(c.familyIds) ? c.familyIds : [];
      delete c.familyIds;
    }
    c.species = 'human';
    c.maxHealth ??= SPECIES.human.maxHealth;
    c.health = Number.isFinite(c.health) ? c.health : c.maxHealth;
    c.hunger = Number.isFinite(c.hunger) ? c.hunger : 0.3;
    c.energy = Number.isFinite(c.energy) ? c.energy : 0.8;
    c.alive = c.alive !== false;
    if (!c.alive) { c.task = 'dead'; c.deathDay ??= s.day; c.deathCause ??= 'unknown'; }
    c.path = Array.isArray(c.path) ? c.path.filter((id: number) => Number.isInteger(id) && id >= 0 && id < count) : [];
    c.goal ??= null; c.taskTimer ??= 0; c.thinkTimer ??= 0; c.attackCd ??= 0; c.targetEntityId ??= null;
    c.parentIds ??= []; c.childIds ??= []; c.partnerId ??= null; c.reproCooldown ??= 0;
    c.bornDay ??= s.day - c.age;
    c.taskId ??= null; c.homeId ??= null; c.civId ??= null; c.role ??= 'civilian';
    c.personality ??= { industrious: 0.5, sociable: 0.5 };
    c.carry ??= { food: 0, wood: 0, stone: 0 };
    if (!Number.isFinite(c.authority) || c.authority < 1 || c.authority > 100) c.authority = authorityFor(s.seed, c.id);
    c.authority = Math.round(c.authority * 100) / 100;
    c.incitedUntil ??= 0;
    c.moveProgress ??= 1; c.targetCellId ??= null;
    if (c.targetCellId !== null && !(c.targetCellId >= 0 && c.targetCellId < count)) { c.targetCellId = null; c.moveProgress = 1; }
    if (!(c.cellId >= 0 && c.cellId < count)) c.cellId = 0;
    c.task ??= 'idle';
    if (c.alive && c.task === 'dead') c.task = 'idle';
  }
  // Creatures
  for (const [id, w] of Object.entries(s.creatures) as Array<[string, any]>) {
    if (!SPECIES[w.species as keyof typeof SPECIES] || w.species === 'human' || !(w.cellId >= 0 && w.cellId < count)) { delete s.creatures[id]; continue; }
    w.path ??= []; w.goal ??= null; w.targetCellId ??= null; w.moveProgress ??= 1;
    w.taskTimer ??= 0; w.thinkTimer ??= 0; w.attackCd ??= 0; w.targetEntityId ??= null;
    w.parentIds ??= []; w.childIds ??= []; w.partnerId ??= null; w.reproCooldown ??= 0;
    w.packId ??= null; w.homeCell ??= w.cellId; w.alive = w.alive !== false;
    if (!w.alive) delete s.creatures[id];
  }
  // Buildings
  for (const b of Object.values(s.buildings)) {
    b.civId ??= null; b.settlementId ??= null; b.residents ??= [];
    b.maxHealth ??= BUILDING_HP[b.type]; b.health ??= b.maxHealth;
    b.capacity ??= BUILDING_CAPACITY[b.type];
    delete (b as any).storedFood; delete (b as any).storedWood; delete (b as any).storedStone;
    if (s.cells[b.cellId]) s.cells[b.cellId].buildingId = b.id;
  }
  for (const c of s.cells) if (c.buildingId && !s.buildings[c.buildingId]) c.buildingId = null;

  // Civilizations (v1 worlds become one civilization)
  for (const civ of Object.values(s.civs)) {
    civ.history ??= []; civ.stats ??= { produced: { food: 0, wood: 0, stone: 0 }, eaten: 0, births: 0, deaths: 0, raidsWon: 0, raidsSuffered: 0, loot: 0 };
    civ.resources ??= { food: 0, wood: 0, stone: 0, foodCapacity: 100, woodCapacity: 100, stoneCapacity: 50 };
    civ.guardTarget ??= 0; civ.planTimer ??= 0; civ.planCount ??= 0; civ.recruitTimer ??= 0; civ.lastColony ??= 0;
    civ.aggression ??= 1; civ.alive = civ.alive !== false; civ.territoryCells ??= 0;
    civ.housing ??= { used: 0, capacity: 0 };
    civ.kingId ??= null; civ.commanderId ??= null; civ.mobilize ??= 0;
    civ.succession ??= { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null };
    if (!['stable', 'panic', 'succession_announcement'].includes(civ.succession.phase) ||
        !Number.isFinite(civ.succession.startedDay)) {
      civ.succession = { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null };
    }
  }
  const aliveCitizens = Object.values(s.citizens).filter(c => c.alive);
  if (isV1 && Object.keys(s.civs).length === 0 && (aliveCitizens.length > 0 || Object.keys(s.buildings).length > 0)) {
    const civ = createCivilization(s);
    civ.resources = { ...emptyResources(), ...s.resources };
    civ.founded = 0;
    const firstBuilt = Object.values(s.buildings).find(b => b.built) ?? Object.values(s.buildings)[0];
    const centre = firstBuilt ? firstBuilt.cellId : (aliveCitizens[0]?.cellId ?? 0);
    const settlement = foundSettlement(s, civ, centre, undefined, true); // preserve historical polar settlements
    civ.era = (s.era === 'Dawn' ? 'Camp' : s.era) ?? 'Camp';
    settlement.stage = civ.era;
    for (const c of aliveCitizens) c.civId = civ.id;
    for (const b of Object.values(s.buildings)) { b.civId = civ.id; b.settlementId = settlement.id; }
    logEvent(s, 'civ', `Your people are now known as the ${civ.name}.`, { civId: civ.id });
  }

  // Repair references
  for (const c of Object.values(s.citizens)) {
    if (c.homeId && !s.buildings[c.homeId]) c.homeId = null;
    if (c.civId && !s.civs[c.civId]) c.civId = null;
    if (c.partnerId && !s.citizens[c.partnerId]) c.partnerId = null;
    if (c.alive && c.role === 'soldier' && !c.civId) c.role = 'civilian';
  }
  for (const b of Object.values(s.buildings)) {
    b.residents = b.residents.filter(id => s.citizens[id]?.alive);
    if (b.civId && !s.civs[b.civId]) b.civId = null;
    if (b.settlementId && !s.settlements[b.settlementId]) b.settlementId = null;
  }
  for (const st2 of Object.values(s.settlements)) {
    st2.occupiedBy ??= null; st2.occupiedHours ??= 0; st2.founded ??= 0;
    if (!s.civs[st2.civId]) delete s.settlements[st2.id];
  }
  s.meteors = s.meteors.filter(m => m && m.cellId >= 0 && m.cellId < count);
  // Kingship is derived from authority, so it is always recomputed on load (never trusted from the file).
  refreshLeadership(s);
  updateTerritory(s);
  refreshCounts(s);
  return s;
}
