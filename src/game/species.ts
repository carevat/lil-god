// Data-driven species definitions. All creature rules read from here.

import type { SpeciesId, TerrainType, DamageKind } from './types';
import { AGE_UNIT_DAYS as U } from './config';

export type Behavior = 'civil' | 'grazer' | 'predator' | 'guardian';

export interface SpeciesDef {
  id: SpeciesId;
  label: string;
  singular: string;
  blurb: string;
  intelligent: boolean;
  behavior: Behavior;
  moveSpeed: number; // cells per hour
  maxHealth: number;
  hungerRate: number; // per hour, 0 = none
  diet: 'omnivore' | 'herbivore' | 'carnivore' | 'none';
  habitat: TerrainType[];
  habitatText: string;
  adultAgeDays: number;
  elderAgeDays: number | null;
  lifespanDays: [number, number];
  cooldownDays: number; // between litters
  litter: [number, number];
  birthChancePerDay: number;
  localCap: number; // same-species within 4 cells
  cost: number; // divine energy
  spawnCount: number;
  spawnCooldownHours: number;
  attack: number;
  defense: number;
  attackCdHours: number;
  vision: number;
  resist: Partial<Record<DamageKind, number>>;
  foodYield: number; // civ food when hunted by humans
  grazeRate: number; // max vegetation eaten per hour while grazing
  grassPerHunger: number; // vegetation consumed per 1.0 hunger relieved
  sprite: string;
  color: string;
}

const GRASSLAND: TerrainType[] = ['plains', 'fertile', 'forest'];

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  human: {
    id: 'human', label: 'Humans', singular: 'Human', intelligent: true, behavior: 'civil',
    blurb: 'Intelligent settlers who gather, build homes, raise families, found civilizations and go to war.',
    moveSpeed: 0.67, maxHealth: 100, hungerRate: 0.008, diet: 'omnivore',
    habitat: ['beach', 'plains', 'forest', 'fertile'], habitatText: 'Dry land (not mountains)',
    adultAgeDays: 14 * U, elderAgeDays: 50 * U, lifespanDays: [62 * U, 80 * U],
    cooldownDays: 40, litter: [1, 1], birthChancePerDay: 0.14, localCap: 999,
    cost: 35, spawnCount: 2, spawnCooldownHours: 0,
    attack: 3, defense: 0, attackCdHours: 1.5, vision: 6, resist: {}, foodYield: 0, grazeRate: 0, grassPerHunger: 1,
    sprite: 'human', color: '#8BD49A',
  },
  deer: {
    id: 'deer', label: 'Deer', singular: 'Deer', intelligent: false, behavior: 'grazer',
    blurb: 'Gentle herbivores. Browse on vegetation, flee wolves and give hunters a source of food.',
    moveSpeed: 0.9, maxHealth: 40, hungerRate: 0.012, diet: 'herbivore',
    habitat: GRASSLAND, habitatText: 'Grassland, plains or forest',
    adultAgeDays: 25, elderAgeDays: null, lifespanDays: [200, 300],
    cooldownDays: 25, litter: [1, 1], birthChancePerDay: 0.09, localCap: 6,
    cost: 15, spawnCount: 3, spawnCooldownHours: 0,
    attack: 4, defense: 0, attackCdHours: 2, vision: 5, resist: {}, foodYield: 12, grazeRate: 0.06, grassPerHunger: 0.8,
    sprite: 'deer', color: '#c98d4f',
  },
  wolf: {
    id: 'wolf', label: 'Wolves', singular: 'Wolf', intelligent: false, behavior: 'predator',
    blurb: 'Pack predators. Roam in small groups and hunt deer and rabbits when hungry.',
    moveSpeed: 1.1, maxHealth: 45, hungerRate: 0.01, diet: 'carnivore',
    habitat: GRASSLAND, habitatText: 'Grassland, plains or forest',
    adultAgeDays: 30, elderAgeDays: null, lifespanDays: [250, 350],
    cooldownDays: 30, litter: [1, 2], birthChancePerDay: 0.07, localCap: 5,
    cost: 30, spawnCount: 3, spawnCooldownHours: 3,
    attack: 14, defense: 0.05, attackCdHours: 1, vision: 7, resist: {}, foodYield: 0, grazeRate: 0, grassPerHunger: 1,
    sprite: 'wolf', color: '#9aa3b0',
  },
  rabbit: {
    id: 'rabbit', label: 'Rabbits', singular: 'Rabbit', intelligent: false, behavior: 'grazer',
    blurb: 'Quick little herbivores that breed fast, nibble vegetation and feed every predator around.',
    moveSpeed: 1.4, maxHealth: 10, hungerRate: 0.015, diet: 'herbivore',
    habitat: GRASSLAND, habitatText: 'Grassland, plains or forest',
    adultAgeDays: 6, elderAgeDays: null, lifespanDays: [60, 90],
    cooldownDays: 6, litter: [1, 3], birthChancePerDay: 0.3, localCap: 9,
    cost: 10, spawnCount: 5, spawnCooldownHours: 0,
    attack: 1, defense: 0, attackCdHours: 2, vision: 4, resist: {}, foodYield: 4, grazeRate: 0.02, grassPerHunger: 0.25,
    sprite: 'rabbit', color: '#b7a893',
  },
  golem: {
    id: 'golem', label: 'Stone Golems', singular: 'Stone Golem', intelligent: false, behavior: 'guardian',
    blurb: 'Rare, god-made guardians. Slow and sturdy; they drive off wolves and shield nearby settlements. They never breed.',
    moveSpeed: 0.35, maxHealth: 600, hungerRate: 0, diet: 'none',
    habitat: ['beach', 'plains', 'forest', 'fertile', 'mountain'], habitatText: 'Any dry land',
    adultAgeDays: 0, elderAgeDays: null, lifespanDays: [1e9, 1e9],
    cooldownDays: 0, litter: [0, 0], birthChancePerDay: 0, localCap: 2,
    cost: 70, spawnCount: 1, spawnCooldownHours: 8,
    attack: 22, defense: 0.45, attackCdHours: 2, vision: 5, resist: { lightning: 0.5, meteor: 0.4 }, foodYield: 0, grazeRate: 0, grassPerHunger: 1,
    sprite: 'golem', color: '#8e8a82',
  },
};

export const SPECIES_ORDER: SpeciesId[] = ['human', 'deer', 'rabbit', 'wolf', 'golem'];

/** Gender-aware lifespan roll helper. */
export function isHabitat(species: SpeciesId, type: TerrainType): boolean {
  return SPECIES[species].habitat.includes(type);
}
