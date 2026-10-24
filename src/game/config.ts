// Central balance configuration. Tweak values here — nothing else needs editing.

import type { SpeciesId } from './types';

export const TICK_HOURS = 0.25; // one simulation tick = 15 game minutes
export const HOURS_PER_DAY = 24;
export const DAYS_PER_YEAR = 365;
/** One "citizen year" expressed in simulated days (abstract population model). */
export const AGE_UNIT_DAYS = 5;

/** Latitude is normalised: -1 = south pole, +1 = north pole. */
export const HUMAN_HABITAT = {
  northLimit: 0.82,
  southLimit: -0.82,
  localSearchSteps: 12,
};

export const SUCCESSION = {
  panicHours: 9,
  runMultiplier: 2.6,
  // A shared tick drives all citizens; each chooses short, irregular routes.
  minimumRerouteHours: 0.25,
  maximumRerouteHours: 0.8,
};

export const CAPS = {
  maxHumans: 240,
  maxWildlife: 280,
  species: { human: 240, deer: 70, wolf: 24, rabbit: 120, golem: 6 } as Record<SpeciesId, number>,
  maxEvents: 300,
  maxDeadHumans: 120,
  maxFx: 96,
  pathsPerTick: 14,
};

export const LIFE = {
  childMoveFactor: 0.55,
  elderMoveFactor: 0.75,
  reproCooldownDays: 40,
  childFoodCost: 6,
  minCivFoodForBirth: 10,
  foodPerPersonForFullGrowth: 4,
  maxDependentChildren: 3,
  birthChancePerDay: 0.14,
  partnerRadius: 5,
  pregnancyHours: 2,
  soldierMinAdults: 4,
};

export const MILITARY = {
  recruitFood: 6,
  recruitWood: 4,
  maxSoldierRatio: 0.3,
  minPopToRecruit: 6,
  soldierHealth: 120,
  soldierAttack: 14,
  soldierDefense: 0.25,
  soldierCooldown: 1.5,
  raidBuildingDamage: 16,
  lootFraction: 0.05,
  lootCapPerWar: 45,
  engageRadius: 7,
  retreatBelow: 0.35,
  recoverTo: 0.7,
  minSoldiersForWar: 3,
  autoRecruitRatio: 0.25,
};

export const DIPLOMACY = {
  tensionAt: 35,
  peaceAt: 20,
  warAt: 100,
  maxTension: 120,
  truceDays: 50,
  calmDecay: 1.0,
  skirmishEveryDays: 10,
  maxWarDays: 100,
  occupationHours: 24,
  conquestRatio: 1.5,
  surrenderRatio: 3,
  surrenderMinWarDays: 20,
  minCivAgeForWar: 20,
};

export const TERRITORY = {
  updateEveryHours: 3,
  baseRadius: 3,
  maxRadius: 9,
  threshold: 0.35,
};

export const EXPANSION = {
  minPop: 12,
  maxSettlementsPerCiv: 3,
  woodCost: 15,
  foodCost: 15,
  minDist: 8,
  maxDist: 13,
  cooldownDays: 40,
  secedeMinPop: 5,
  secedeMinCivPop: 20,
  secedeMinDist: 8,
  secedeMinAgeDays: 60,
};

export type PowerId = 'life' | 'nature' | 'rain' | 'lightning' | 'terraform' | 'meteor' | 'shower' | 'vision';

/** cost = divine energy; cooldown = simulated hours; radius = cells */
export const POWERS: Record<PowerId, { label: string; cost: number; cooldown: number; radius: number }> = {
  life: { label: 'Create Life', cost: 25, cooldown: 0, radius: 0.6 },
  nature: { label: 'Nature', cost: 10, cooldown: 0.5, radius: 2 },
  rain: { label: 'Rain', cost: 15, cooldown: 1, radius: 3 },
  lightning: { label: 'Lightning', cost: 20, cooldown: 0.5, radius: 2.6 },
  terraform: { label: 'Terraform', cost: 18, cooldown: 0.25, radius: 0.6 },
  meteor: { label: 'Meteor', cost: 50, cooldown: 6, radius: 3.5 },
  shower: { label: 'Meteor Shower', cost: 90, cooldown: 24, radius: 6 },
  vision: { label: 'Divine Vision', cost: 22, cooldown: 3, radius: 1.6 },
};

/** Human authority (social influence), 1.00..100.00. */
export const AUTHORITY = {
  min: 1,
  max: 100,
  /** Minimum population before a civilization appoints a commander. */
  commanderMinPop: 5,
  /** Authority at which a person counts as influential. */
  influential: 55,
};

/** Individual melee combat pacing and hit resolution (simulated hours). */
export const COMBAT = {
  windup: 0.5, // wind-up before the blow lands
  swing: 0.45, // weapon swing / recovery
  hitFlash: 0.6, // hit reaction on the victim
  cheer: 1.2, // victory animation after a kill
  baseHit: 0.85, // base chance to connect, reduced by the defender's protection
  minHit: 0.3,
  maxHit: 0.95,
};

/** Divine Vision: dream manipulation that can push a civilization toward war. */
export const VISION = {
  base: 0.10,
  authorityWeight: 0.60,
  min: 0.05,
  max: 0.90,
  hostilityBonus: 0.12, // the two civilizations are already at war or tense
  borderBonus: 0.10, // territories actually touch
  readinessBonus: 0.08, // the target's civilization has soldiers ready
  trucePenalty: 0.15, // a recent truce makes war talk unwelcome
  militaryPenalty: 0.10, // hopelessly outgunned: nobody wants the war
  /** A successful non-king vision raises this; it feeds tension and recruitment. */
  mobilizeAmount: 1,
  mobilizeDecayPerDay: 0.06,
  mobilizeTension: 0.8, // tension added per day while mobilized
  inciteRadius: 4, // cells: rumour spreads to nearby humans
  inciteDays: 12, // how long an incited human keeps agitating
  inciteTension: 0.25, // tension added per incited human during diplomacy
  influenceTension: 18, // instant tension from an influential non-king
  citizenTension: 7, // instant tension from an ordinary citizen
};

export const POWER_COSTS = Object.fromEntries(
  Object.entries(POWERS).map(([k, v]) => [k, v.cost])
) as Record<PowerId, number>;

export const FIRST_LIFE = { count: 3, cost: 45 };
export const CIV_SEED_COST = 30;

export const LIGHTNING = { radius: 2.6, maxDamage: 200, exponent: 1.5, buildingFactor: 0.8 };

export const METEOR = {
  warnHours: 2.2, // meteors always progress in real time (1 hour = 1 second)
  radius: 3.5,
  showerCount: 7,
  showerSpread: 6,
  showerRadius: 2.4,
  showerInterval: 0.7,
  maxDamage: 400,
  buildingDamage: 500,
  craterCore: 0.55,
  dustPerImpact: 0.25,
  falloffExp: 1.4,
};

export const ENV = {
  craterFarmBlock: 0.25,
  craterBuildBlock: 0.5,
  craterRecover: 0.0004,
  craterFloor: 0.2,
  scorchDecay: 0.004,
  dustDecay: 0.01,
};
