// Core game types for LITTLE GOD

export type TerrainType = 'deepOcean' | 'shallowOcean' | 'beach' | 'plains' | 'forest' | 'mountain' | 'fertile';
export type SpeciesId = 'human' | 'deer' | 'wolf' | 'rabbit' | 'golem';
export type LifeStage = 'child' | 'adult' | 'elder' | 'dead';
export type DamageKind = 'lightning' | 'meteor' | 'predator' | 'combat' | 'hunger' | 'hunter' | 'divine';

export type Activity =
  | 'idle' | 'wander' | 'forage' | 'chop' | 'farm' | 'build' | 'travel' | 'rest' | 'social'
  | 'reproduce' | 'mine' | 'hunt' | 'patrol' | 'march' | 'fight' | 'raid' | 'retreat'
  | 'graze' | 'flee' | 'roam' | 'guard' | 'panic' | 'dead';
export type CitizenTask = Activity;

export interface TerrainCell {
  id: number;
  gx: number;
  gy: number;
  lat: number; // -1..1
  lon: number; // -1..1
  elevation: number;
  moisture: number;
  fertility: number;
  temperature: number;
  type: TerrainType;
  trees: number;
  maxTrees: number;
  stone: number;
  crop: number;
  drought: number;
  grass: number; // 0..1 vegetation cover (food for herbivores)
  crater: number; // 0..1 impact damage (recovers to a permanent scar)
  scorch: number; // 0..1 temporary lightning scorch
  buildingId: string | null;
}

/** Shared shape of every living, damageable entity. */
export interface Living {
  id: string;
  species: SpeciesId;
  name: string;
  age: number; // simulated days
  maxAge: number;
  gender: 'm' | 'f';
  health: number; // HP
  maxHealth: number;
  hunger: number; // 0..1
  energy: number; // 0..1
  cellId: number;
  targetCellId: number | null; // cell currently being walked to
  moveProgress: number; // 0..1 between cellId and targetCellId
  path: number[]; // remaining cells to walk through
  goal: number | null; // destination of current task
  task: Activity;
  taskTimer: number;
  thinkTimer: number;
  alive: boolean;
  deathDay?: number;
  deathCause?: string;
  attackCd: number;
  targetEntityId: string | null;
  parentIds: string[];
  childIds: string[];
  partnerId: string | null;
  reproCooldown: number; // days
  bornDay: number;
}

export interface Citizen extends Living {
  species: 'human';
  taskId: string | null; // building being built / farmed, partner id when reproducing
  homeId: string | null;
  civId: string | null;
  role: 'civilian' | 'soldier';
  /** Social influence / legitimacy, 1.00..100.00. Rolled once and persisted. */
  authority: number;
  /** True while a divine vision has this person stirring up warlike ideas. */
  incitedUntil: number;
  personality: { industrious: number; sociable: number };
  carry: { food: number; wood: number; stone: number };
}

export interface Creature extends Living {
  species: Exclude<SpeciesId, 'human'>;
  packId: string | null;
  homeCell: number;
}

export type BuildingType = 'shelter' | 'house' | 'farm' | 'storage' | 'communal';

export interface Building {
  id: string;
  type: BuildingType;
  cellId: number;
  progress: number;
  built: boolean;
  capacity: number;
  residents: string[];
  owner: string | null;
  civId: string | null;
  settlementId: string | null;
  health: number;
  maxHealth: number;
  cropStage?: number;
}

export type EventCategory =
  | 'birth' | 'death' | 'build' | 'settlement' | 'divine' | 'environment' | 'milestone'
  | 'war' | 'civ' | 'ecology' | 'meteor' | 'species';

export interface WorldEvent {
  id: string;
  day: number;
  category: EventCategory;
  text: string;
  entityId?: string;
  civId?: string;
}

export type Era = 'Dawn' | 'Camp' | 'Village' | 'Settlement';

export interface Settlement {
  id: string;
  civId: string;
  cellId: number;
  stage: Era;
  name: string;
  founded: number;
  occupiedBy: string | null;
  occupiedHours: number;
}

export interface Resources {
  food: number;
  wood: number;
  stone: number;
  foodCapacity: number;
  woodCapacity: number;
  stoneCapacity: number;
}

export interface CivStats {
  produced: { food: number; wood: number; stone: number };
  eaten: number;
  births: number;
  deaths: number;
  raidsWon: number;
  raidsSuffered: number;
  loot: number;
}

export interface Civilization {
  id: string;
  idx: number; // territory index
  name: string;
  color: string;
  founded: number;
  alive: boolean;
  fallDay?: number;
  fallReason?: string;
  capitalId: string | null;
  resources: Resources;
  stats: CivStats;
  history: { day: number; text: string }[];
  aggression: number;
  era: Era;
  population: number;
  soldiers: number;
  militaryStrength: number;
  housing: { used: number; capacity: number };
  territoryCells: number;
  guardTarget: number; // minimum standing soldiers (player/AI set)
  kingId: string | null; // living human with the highest authority
  commanderId: string | null; // highest-authority soldier, when one is warranted
  succession: {
    phase: 'stable' | 'panic' | 'succession_announcement';
    startedDay: number;
    successorId: string | null;
    formerKingId: string | null;
  };
  /** 0..1 divine/leader pressure to prepare for war; raises tension and recruitment. */
  mobilize: number;
  planTimer: number;
  planCount: number;
  recruitTimer: number;
  lastColony: number;
}

export type DiploStatus = 'peace' | 'tension' | 'war' | 'truce';

export interface Relation {
  id: string;
  a: string;
  b: string;
  tension: number;
  status: DiploStatus;
  since: number;
  truceUntil: number;
  warStart: number;
  aggressor: string | null;
  startSoldiers: Record<string, number>;
  casualties: Record<string, number>;
  lastIncident: number;
  lastEnvoy: number;
  loot: number;
}

export interface Meteor {
  id: string;
  cellId: number;
  radius: number;
  timeLeft: number; // hours (real-time pace)
  warn: number;
  showerId: string | null;
}

export interface Shower {
  id: string;
  centerCell: number;
  remaining: number;
  total: number;
  nextIn: number;
  spread: number;
  hits: number;
  used: number[];
}

export interface ImpactRecord {
  id: string;
  day: number;
  cellId: number;
  radius: number;
  killed: number;
  buildings: number;
  shower: boolean;
}

export interface Notice { text: string; tone: 'info' | 'good' | 'warn' | 'bad' }
export interface FxEvent { type: 'hit' | 'death' | 'raid' | 'impact' | 'birth' | 'conquest' | 'coronation'; cellId: number }

export interface Stats {
  births: number;
  deaths: number;
  lightningKills: number;
  meteorKills: number;
  warDeaths: number;
  predations: number;
}

export interface WorldState {
  seed: number;
  name: string;
  width: number;
  height: number;
  radius: number;
  generation: {
    size: 'legacy' | 'small' | 'standard' | 'large';
    density: 'sparse' | 'normal' | 'dense';
    preset: 'lush' | 'balanced' | 'harsh';
    attempt: number;
    initialCivilizations: number;
    inhabitedRegions: number;
  };
  ecologyPhase: number;
  ecologyElapsed: number;
  ecologyRevision: number;
  cells: TerrainCell[];
  citizens: Record<string, Citizen>;
  creatures: Record<string, Creature>;
  buildings: Record<string, Building>;
  settlements: Record<string, Settlement>;
  civs: Record<string, Civilization>;
  relations: Record<string, Relation>;
  territory: number[]; // civ idx per cell or -1
  resources: Resources; // aggregate of all living civilizations (display)
  events: WorldEvent[];
  day: number;
  weather: 'clear' | 'rain' | 'drought';
  weatherTimer: number;
  timeOfDay: number;
  divineEnergy: number;
  maxDivineEnergy: number;
  divineRegen: number;
  housing: { used: number; capacity: number };
  population: number;
  era: Era;
  speciesCounts: Record<SpeciesId, number>;
  meteors: Meteor[];
  showers: Shower[];
  impacts: ImpactRecord[];
  dust: number;
  powerCd: Record<string, number>;
  rng: number;
  idCounter: number;
  civCounter: number;
  terrainRev: number;
  notices: Notice[];
  fx: FxEvent[];
  eventGate: Record<string, number>;
  suppressed: Record<string, number>;
  stats: Stats;
  milestones: Record<string, boolean>;
  peaks: Record<string, number>;
  diploTimer: number;
  terrTimer: number;
  dayTimer: number;
  pathBudget: number;
  borderFriction: Record<string, number>;
}

export type ToolId = 'select' | 'life' | 'forge' | 'nature' | 'rain' | 'lightning' | 'terraform' | 'meteor' | 'vision';

/** Political role of a human, derived from the civilization's leadership. */
export type HumanRole = 'citizen' | 'commander' | 'king';
/** Rendering-only combat/animation states (never saved). */
export type AnimKind = 'windup' | 'swing' | 'hit' | 'cheer';
export type Speed = 0 | 1 | 3 | 8;

export interface SaveData {
  version: number;
  state: WorldState;
  savedAt: number;
  tutorialDone: boolean;
  worldName: string;
}
