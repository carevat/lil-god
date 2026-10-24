// World generation: noise, spherical coordinates, terrain, spatial queries

import type { TerrainCell, TerrainType, TerrainType as TT } from './types';
import { HUMAN_HABITAT } from './config';
import { gridFor, type GridSource } from './grid';
export { gridFor } from './grid';

// Historical dimensions retained only for v1-v4 fixtures and the uninhabited legacy factory.
// Active simulation queries receive their WorldState (or cells array) explicitly.
export const GRID_W = 96;
export const GRID_H = 48;
export const N_CELLS = GRID_W * GRID_H;
export const CELL_ANGLE = Math.PI / GRID_H; // angular size of one cell (radians)

// ============ Seeded RNG ============
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number) { return t * t * (3 - 2 * t); }
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

export function fbm(x: number, y: number, seed: number, octaves = 5, lac = 2.0, gain = 0.5): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

// ============ Coordinates ============
// Defaults are legacy-sized for compatibility with old callers; game systems always pass their world.
export const cellIndex = (x: number, y: number, source?: GridSource) => gridFor(source).index(x, y);
export const cellFromIndex = (i: number, source?: GridSource) => gridFor(source).coords(i);
export const cellLatLon = (x: number, y: number, source?: GridSource) => gridFor(source).latLon(x, y);

/** lat/lon in [-1,1] -> unit-radius surface vector. Convention: x = cos(lat) sin(lon), y = sin(lat), z = cos(lat) cos(lon). */
export function latLonToVec3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = lat * (Math.PI / 2);
  const theta = lon * Math.PI;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.sin(theta) * radius, Math.sin(phi) * radius, cosPhi * Math.cos(theta) * radius];
}

export function vec3ToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const r = Math.sqrt(x * x + y * y + z * z);
  return { lat: Math.asin(y / r) / (Math.PI / 2), lon: Math.atan2(x, z) / Math.PI };
}

export const latLonToCell = (lat: number, lon: number, source?: GridSource) => gridFor(source).fromLatLon(lat, lon);
export const cellUnit = (i: number, source?: GridSource) => gridFor(source).unit(i);
export const sphereDist = (a: number, b: number, source?: GridSource) => gridFor(source).distance(a, b);
export const cellsWithin = (center: number, radius: number, source?: GridSource) => gridFor(source).within(center, radius);
export const neighbors = (i: number, source?: GridSource) => gridFor(source).neighbors(i);
export const cellDistance = (a: number, b: number, source?: GridSource) => gridFor(source).gridDistance(a, b);

export const isWaterType = (t: TerrainType) => t === 'deepOcean' || t === 'shallowOcean';

/** One rule for player creation, births, refugees and new settlements. Existing inhabitants are not moved. */
export function isHumanSpawnCell(c: TerrainCell | undefined): boolean {
  return !!c && c.lat <= HUMAN_HABITAT.northLimit && c.lat >= HUMAN_HABITAT.southLimit &&
    (c.type === 'beach' || c.type === 'plains' || c.type === 'forest' || c.type === 'fertile') &&
    !c.buildingId && c.crater < 0.5;
}

/** BFS over traversable land; if local land has no room, scan the globe once for the closest valid cell. */
export function findHumanSpawnCells(cells: TerrainCell[], center: number, count: number): number[] {
  if (!cells[center] || count < 1) return [];
  const result: number[] = [];
  const seen = new Set<number>([center]);
  const queue: Array<[number, number]> = [[center, 0]];
  for (let head = 0; head < queue.length && result.length < count; head++) {
    const [id, depth] = queue[head];
    if (isHumanSpawnCell(cells[id])) result.push(id);
    if (depth >= HUMAN_HABITAT.localSearchSteps) continue;
    for (const n of neighbors(id, cells)) {
      if (seen.has(n) || isWaterType(cells[n].type)) continue;
      seen.add(n);
      queue.push([n, depth + 1]);
    }
  }
  if (result.length >= count) return result;
  const used = new Set(result);
  const global = cells.filter(c => !used.has(c.id) && isHumanSpawnCell(c));
  global.sort((a, b) => sphereDist(center, a.id, cells) - sphereDist(center, b.id, cells) || a.id - b.id);
  return result.concat(global.slice(0, count - result.length).map(c => c.id));
}

// ============ Landmasses (connected land components, cached) ============
const LM = new WeakMap<object, { rev: number; ids: Int16Array }>();
export function landmassOf(state: { cells: TerrainCell[]; terrainRev: number }, cell: number): number {
  let entry = LM.get(state.cells);
  if (!entry || entry.rev !== state.terrainRev) {
    const ids = new Int16Array(state.cells.length).fill(-1);
    let next = 0;
    for (let i = 0; i < state.cells.length; i++) {
      if (ids[i] !== -1 || isWaterType(state.cells[i].type)) continue;
      const stack = [i];
      ids[i] = next;
      while (stack.length) {
        const cur = stack.pop()!;
        for (const n of neighbors(cur, state.cells)) {
          if (ids[n] === -1 && !isWaterType(state.cells[n].type)) { ids[n] = next; stack.push(n); }
        }
      }
      next++;
    }
    entry = { rev: state.terrainRev, ids };
    LM.set(state.cells, entry);
  }
  return entry.ids[cell];
}

// ============ Biome classification ============
export function biomeFrom(elevation: number, moisture: number, temperature: number): TerrainType {
  if (elevation < -0.15) return 'deepOcean';
  if (elevation < 0.0) return 'shallowOcean';
  if (elevation < 0.05) return 'beach';
  if (elevation > 0.55) return 'mountain';
  if (moisture > 0.55 && temperature > 0.2 && elevation < 0.4) return 'forest';
  if (moisture > 0.35 && temperature > 0.15) return 'fertile';
  return 'plains';
}

export const GRASS_MAX: Record<TT, number> = {
  deepOcean: 0, shallowOcean: 0, beach: 0.25, plains: 0.8, forest: 0.7, mountain: 0.15, fertile: 0.95,
};

// ============ World Generation ============
export type WorldPreset = 'lush' | 'balanced' | 'harsh';

export function generateWorld(seed: number, preset: WorldPreset = 'balanced'): { cells: TerrainCell[] } {
  const rng = mulberry32(seed);
  const presetBias = preset === 'lush' ? 0.12 : preset === 'harsh' ? -0.12 : 0;
  const presetMoisture = preset === 'lush' ? 0.15 : preset === 'harsh' ? -0.1 : 0;
  const cells: TerrainCell[] = new Array(GRID_W * GRID_H);

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const { lat, lon } = cellLatLon(gx, gy);
      const scale = 3.2;
      const ex = lon * scale + 5;
      const ey = lat * scale + 5;
      let e = fbm(ex, ey, seed, 5, 2.0, 0.5);
      const big = fbm(ex * 0.5, ey * 0.5, seed + 99, 3, 2.0, 0.5);
      e = e * 0.6 + big * 0.4;
      const latAbs = Math.abs(lat);
      e -= Math.max(0, latAbs - 0.7) * 0.6;
      e = e * 2 - 1;
      e += presetBias;

      const m = fbm(ex + 100, ey + 100, seed + 7, 4, 2.0, 0.5) + presetMoisture;
      const t = 1 - Math.abs(lat) * 0.9 + (fbm(ex + 200, ey + 200, seed + 13, 3, 2.0, 0.5) - 0.5) * 0.2;
      const type = biomeFrom(e, m, t);

      let maxTrees = 0;
      if (type === 'forest') maxTrees = 3 + Math.floor(rng() * 3);
      else if (type === 'fertile') maxTrees = Math.floor(rng() * 2);
      else if (type === 'plains') maxTrees = rng() < 0.3 ? 1 : 0;
      const stone = type === 'mountain' ? 8 + Math.floor(rng() * 10) : rng() < 0.08 ? 2 + Math.floor(rng() * 3) : 0;
      const fertility = type === 'fertile' ? 0.7 + m * 0.3
        : type === 'forest' ? 0.5 + m * 0.2
        : type === 'plains' ? 0.3 + m * 0.2
        : type === 'beach' ? 0.15 : 0;
      const mm = Math.max(0, Math.min(1, m));

      cells[cellIndex(gx, gy)] = {
        id: cellIndex(gx, gy), gx, gy, lat, lon,
        elevation: e, moisture: mm,
        fertility: Math.max(0, Math.min(1, fertility)),
        temperature: Math.max(0, Math.min(1, t)),
        type, trees: maxTrees, maxTrees, stone, crop: 0, drought: 0,
        grass: GRASS_MAX[type] * (0.8 + 0.2 * mm),
        crater: 0, scorch: 0, buildingId: null,
      };
    }
  }
  return { cells };
}

/** A nice starting location: fertile or plains, near water, not too cold */
export function findStartingCell(cells: TerrainCell[], seed: number): number {
  const rng = mulberry32(seed + 1);
  const candidates: { i: number; score: number }[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!isHumanSpawnCell(c)) continue;
    if (Math.abs(c.lat) > 0.6) continue;
    let nearWater = false;
    for (const n of neighbors(i, cells)) {
      if (cells[n].type === 'shallowOcean' || cells[n].type === 'beach') { nearWater = true; break; }
    }
    candidates.push({ i, score: c.fertility + (nearWater ? 1 : 0) - Math.abs(c.lat) * 0.3 + rng() * 0.3 });
  }
  if (candidates.length === 0) {
    for (let i = 0; i < cells.length; i++) if (isHumanSpawnCell(cells[i])) return i;
    return -1;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].i;
}

/** BFS outward from `center` for `count` cells whose terrain is in `habitat` and which hold no building. */
export function findSpawnCells(cells: TerrainCell[], center: number, count: number, habitat: TerrainType[]): number[] {
  const result: number[] = [];
  const visited = new Set<number>([center]);
  const queue = [center];
  let head = 0;
  while (head < queue.length && result.length < count) {
    const cur = queue[head++];
    const c = cells[cur];
    if (habitat.includes(c.type) && !c.buildingId) result.push(cur);
    for (const n of neighbors(cur, cells)) {
      if (!visited.has(n) && !isWaterType(cells[n].type)) { visited.add(n); queue.push(n); }
    }
  }
  return result;
}
