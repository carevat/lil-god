// The original coherent noise and biome palette, extended with spherical continental shelves.
// Generation is separate from loading: no saved terrain is regenerated or resized.
import type { TerrainCell, WorldState } from './types';
import { gridFor } from './grid';
import { GENERATION, DENSITIES, WORLD_SIZES, targetCivilizations, type WorldOptions, type Dimensions } from './scale';
import { mulberry32, fbm, biomeFrom, GRASS_MAX, isHumanSpawnCell, isWaterType, latLonToVec3, type WorldPreset } from './world';

export interface LandRegion { id: number; cells: number[]; area: number; habitable: number; sites: number[] }
export interface Geography { regions: LandRegion[]; regionIds: Int32Array; candidates: number[]; landArea: number }
const analyses = new WeakMap<TerrainCell[], { revision: number; data: Geography }>();

/** Regions use physical area weights, so tiny polar tiles cannot masquerade as a continent. */
export function analyseGeography(cells: TerrainCell[], revision = 0): Geography {
  const cache = analyses.get(cells);
  if (cache?.revision === revision) return cache.data;
  const grid = gridFor(cells), ids = new Int32Array(cells.length).fill(-1);
  const regions: LandRegion[] = [];
  let landArea = 0;
  for (let i = 0; i < cells.length; i++) {
    if (ids[i] !== -1 || isWaterType(cells[i].type)) continue;
    const r: LandRegion = { id: regions.length, cells: [], area: 0, habitable: 0, sites: [] };
    const queue = [i]; ids[i] = r.id;
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head], c = cells[id], area = grid.cosLat[c.gy];
      r.cells.push(id); r.area += area;
      if (isHumanSpawnCell(c)) r.habitable += area;
      for (const n of grid.neighbors(id)) {
        if (ids[n] < 0 && !isWaterType(cells[n].type)) { ids[n] = r.id; queue.push(n); }
      }
    }
    regions.push(r); landArea += r.area;
  }
  const candidates: number[] = [];
  for (const r of regions) {
    if (r.habitable < GENERATION.minRegionArea) continue;
    for (const id of r.cells) {
      const c = cells[id];
      if (!isHumanSpawnCell(c) || c.fertility < .4 || c.type === 'beach') continue;
      let local = 0, trees = 0;
      for (const n of grid.within(id, GENERATION.localLandRadius)) {
        if (ids[n] === r.id && isHumanSpawnCell(cells[n])) local += grid.cosLat[cells[n].gy];
        trees += cells[n].trees;
      }
      if (local >= GENERATION.minimumLocalLand && trees > 0) { r.sites.push(id); candidates.push(id); }
    }
  }
  const data = { regions, regionIds: ids, candidates, landArea };
  analyses.set(cells, { revision, data });
  return data;
}

export function suitableFoundingSite(s: Pick<WorldState, 'cells' | 'terrainRev' | 'settlements'>, cell: number, spacing = GENERATION.laterFoundingSpacing): boolean {
  if (!isHumanSpawnCell(s.cells[cell])) return false;
  const geo = analyseGeography(s.cells, s.terrainRev), grid = gridFor(s.cells);
  const r = geo.regions[geo.regionIds[cell]];
  if (!r || r.habitable < GENERATION.minRegionArea) return false;
  let room = 0;
  for (const n of grid.within(cell, 3)) if (isHumanSpawnCell(s.cells[n])) room += grid.cosLat[s.cells[n].gy];
  if (room < GENERATION.minimumLocalLand) return false;
  return !Object.values(s.settlements).some(st => grid.distance(cell, st.cellId) < spacing);
}

/** Round-robin inhabited regions, then grow each region's allotment proportional to its area. */
export function chooseStartingSites(cells: TerrainCell[], options: WorldOptions, revision = 0): number[] {
  const geo = analyseGeography(cells, revision), grid = gridFor(cells);
  const target = targetCivilizations(options), spacing = DENSITIES[options.density].spacing;
  const regions = geo.regions.filter(r => r.sites.length).sort((a,b) => b.habitable - a.habitable);
  const chosen: number[] = [], counts = new Map<number, number>();
  const blocked = new Set<number>();
  while (chosen.length < target) {
    const available = regions.filter(r => !blocked.has(r.id)).sort((a,b) =>
      (counts.get(a.id) ?? 0) / Math.sqrt(a.habitable) - (counts.get(b.id) ?? 0) / Math.sqrt(b.habitable) || b.habitable - a.habitable);
    if (!available.length) break;
    const r = available[0];
    let best = -1, bestScore = -Infinity;
    for (const id of r.sites) {
      const c = cells[id];
      let nearest = grid.height;
      for (const prev of chosen) { nearest = Math.min(nearest, grid.distance(id, prev)); if (nearest < spacing) break; }
      if (nearest < spacing) continue;
      const score = Math.min(nearest, spacing * 2) + c.fertility * 4 + c.moisture + c.trees * .2;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    if (best < 0) { blocked.add(r.id); continue; }
    chosen.push(best); counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  }
  return chosen;
}

function buildContinents(seed: number, preset: WorldPreset, dimensions: Dimensions): TerrainCell[] {
  const random = mulberry32(seed), grid = gridFor(dimensions);
  const rotation = random() * 2 * Math.PI;
  const plates: Array<{ v: [number,number,number]; radius: number; group: number }> = [];
  // Six large shelves in alternating hemispheres, each with an irregular peninsula.
  for (let i = 0; i < 6; i++) {
    const theta = rotation + i * Math.PI / 3 + (random() - .5) * .18;
    const phi = (i % 2 ? -1 : 1) * (.32 + random() * .18);
    const r = .50 + random() * .07;
    plates.push({ v: latLonToVec3(phi * 2 / Math.PI, theta / Math.PI), radius: r, group: i });
    plates.push({ v: latLonToVec3((phi + (random() - .5) * .42) * 2 / Math.PI, (theta + .28) / Math.PI), radius: r * .62, group: i });
  }
  for (let i = 0; i < 14; i++) {
    plates.push({ v: latLonToVec3((random() - .5) * 1.5, random() * 2 - 1), radius: .10 + random() * .12, group: 6 + i });
  }
  // Sample the existing value-noise field on three planes of the sphere, with no longitude seam.
  const noise = (x: number,y: number,z: number,scale: number,salt: number,octaves = 4) =>
    (fbm(x*scale+7,y*scale+9,seed+salt,octaves) + fbm(z*scale+13,y*scale+5,seed+salt+43,octaves) +
      fbm(x*scale+2,z*scale+17,seed+salt+79,octaves)) / 3;
  const cells: TerrainCell[] = [];
  for (let id = 0; id < grid.count; id++) {
    const { gx, gy } = grid.coords(id), { lat, lon } = grid.latLon(gx, gy);
    const [x,y,z] = grid.unit(id);
    let shelf = -1, second = -1, group = -1;
    for (const p of plates) {
      const d = Math.acos(Math.min(1, Math.max(-1, x*p.v[0] + y*p.v[1] + z*p.v[2])));
      const v = 1 - d / p.radius;
      if (v > shelf) { if (p.group !== group) second = shelf; shelf = v; group = p.group; }
      else if (p.group !== group) second = Math.max(second, v);
    }
    const coast = noise(x,y,z,6,101), detail = noise(x,y,z,18,201,3);
    let elevation = shelf * .82 + (coast - .5) * .92 + (detail - .5) * .28;
    elevation -= Math.max(0, Math.abs(lat) - .73) * .55;
    // Narrow ocean channels between converging shelves prevent accidental supercontinents.
    if (second > -.16 && shelf - second < .085) elevation = Math.min(elevation, -.035 - (.085 - (shelf - second)));
    const moisture = Math.min(1, Math.max(0, noise(x,y,z,4,301) + (preset === 'lush' ? .13 : preset === 'harsh' ? -.11 : .04)));
    const temperature = Math.max(0, 1 - Math.abs(lat) * .92 - Math.max(0,elevation) * .22);
    elevation = Math.min(.95,Math.max(-1,elevation));
    const type = biomeFrom(elevation,moisture,temperature);
    const maxTrees = type === 'forest' ? 3 + Math.floor(random()*3) : type === 'fertile' ? Math.floor(random()*2) : type === 'plains' && random() < .3 ? 1 : 0;
    const fertility = type === 'fertile' ? .75 + moisture*.25 : type === 'forest' ? .5+moisture*.2 : type === 'plains' ? .3+moisture*.25 : type === 'beach' ? .15 : 0;
    cells.push({ id,gx,gy,lat,lon,elevation,moisture,temperature,type,fertility,
      trees:maxTrees,maxTrees,stone:type === 'mountain' ? 12+Math.floor(random()*10) : random()<.08 ? 3 : 0,
      crop:0,drought:0,grass:GRASS_MAX[type]*(.8+.2*moisture),crater:0,scorch:0,buildingId:null });
  }
  return cells;
}

/** Bounded seed-salted retries: retain the best valid geography, never force overlapping starts. */
export function generateExpandedWorld(seed: number, preset: WorldPreset, options: WorldOptions) {
  const dimensions = WORLD_SIZES[options.size], target = targetCivilizations(options);
  let best: { cells: TerrainCell[]; sites: number[]; attempt: number; regions: number; score: number } | undefined;
  for (let attempt = 0; attempt < GENERATION.maxAttempts; attempt++) {
    const cells = buildContinents(seed + attempt * 104729, preset, dimensions);
    const geo = analyseGeography(cells), sites = chooseStartingSites(cells, options);
    const inhabited = new Set(sites.map(i => geo.regionIds[i])).size;
    const largest = Math.max(...geo.regions.map(r => r.area));
    const quality = largest / Math.max(1,geo.landArea) < .65 && inhabited >= 3;
    const score = sites.length + inhabited + (quality ? 100 : 0);
    if (!best || score > best.score) best = { cells,sites,attempt,regions:inhabited,score };
    if (quality && sites.length >= target) break;
  }
  return { ...best!, ...dimensions };
}