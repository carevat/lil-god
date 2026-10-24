// Geometry caches are keyed by dimensions, never by an active global world. Old and new worlds
// can be simulated side by side without corrupting indices, distances, or neighbourhood queries.
import type { TerrainCell } from './types';
import { LEGACY_DIMENSIONS, type Dimensions } from './scale';

export type GridSource = Pick<Dimensions, 'width' | 'height'> | TerrainCell[];
const grids = new Map<number, SurfaceGrid>();
const arrayGrids = new WeakMap<TerrainCell[], SurfaceGrid>();

export function gridFor(source?: GridSource): SurfaceGrid {
  if (Array.isArray(source)) {
    let grid = arrayGrids.get(source);
    if (grid) return grid;
    const last = source[source.length - 1];
    grid = gridFor(last ? { width: last.gx + 1, height: last.gy + 1 } : LEGACY_DIMENSIONS);
    arrayGrids.set(source, grid);
    return grid;
  }
  const { width, height } = source ?? LEGACY_DIMENSIONS;
  const key = width * 1000 + height;
  let grid = grids.get(key);
  if (!grid) { grid = new SurfaceGrid(width, height); grids.set(key, grid); }
  return grid;
}

export class SurfaceGrid {
  readonly count: number;
  readonly angle: number;
  readonly units: Float64Array;
  readonly latitudes: Float64Array;
  readonly cosLat: Float64Array;
  private adjacency: Array<number[] | undefined>;
  private radii = new Map<string, number[]>();
  constructor(readonly width: number, readonly height: number) {
    this.count = width * height;
    this.angle = Math.PI / height;
    this.units = new Float64Array(this.count * 3);
    this.latitudes = new Float64Array(height);
    this.cosLat = new Float64Array(height);
    this.adjacency = new Array(this.count);
    for (let y = 0; y < height; y++) {
      const phi = (0.5 - (y + 0.5) / height) * Math.PI;
      this.latitudes[y] = phi; this.cosLat[y] = Math.cos(phi);
      for (let x = 0; x < width; x++) {
        const theta = ((x + 0.5) / width * 2 - 1) * Math.PI;
        const i = (y * width + x) * 3;
        this.units[i] = Math.cos(phi) * Math.sin(theta);
        this.units[i + 1] = Math.sin(phi);
        this.units[i + 2] = Math.cos(phi) * Math.cos(theta);
      }
    }
  }
  index(x: number, y: number) { return y * this.width + ((x % this.width) + this.width) % this.width; }
  coords(i: number) { return { gx: i % this.width, gy: Math.floor(i / this.width) }; }
  latLon(x: number, y: number) { return { lon: ((x + .5) / this.width) * 2 - 1, lat: 1 - ((y + .5) / this.height) * 2 }; }
  fromLatLon(lat: number, lon: number) {
    const x = Math.floor((lon + 1) * .5 * this.width);
    const y = Math.min(this.height - 1, Math.max(0, Math.floor((1 - lat) * .5 * this.height)));
    return this.index(x, y);
  }
  unit(i: number): [number, number, number] { return [this.units[i * 3], this.units[i * 3 + 1], this.units[i * 3 + 2]]; }
  distance(a: number, b: number) {
    if (a === b) return 0;
    const u = this.units; a *= 3; b *= 3;
    return Math.acos(Math.max(-1, Math.min(1, u[a] * u[b] + u[a + 1] * u[b + 1] + u[a + 2] * u[b + 2]))) / this.angle;
  }
  gridDistance(a: number, b: number) {
    const dx0 = Math.abs(a % this.width - b % this.width);
    const dx = Math.min(dx0, this.width - dx0);
    const dy = Math.abs(Math.floor(a / this.width) - Math.floor(b / this.width));
    return Math.hypot(dx, dy);
  }
  neighbors(i: number): number[] {
    const cached = this.adjacency[i];
    if (cached) return cached;
    const x = i % this.width, y = Math.floor(i / this.width), out: number[] = [];
    for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
      if (y + dy >= 0 && y + dy < this.height) out.push(this.index(x + dx, y + dy));
    }
    this.adjacency[i] = out;
    return out;
  }
  within(center: number, radius: number): number[] {
    // Radius is exact: no quantisation/collisions between different footprints.
    const key = `${center}:${radius}`;
    const cached = this.radii.get(key);
    if (cached) return cached;
    const x = center % this.width, y = Math.floor(center / this.width), out: number[] = [];
    const rho = Math.min(Math.PI, radius * this.angle), cosR = Math.cos(rho);
    const phi = this.latitudes[y], sinPhi = Math.sin(phi), cosPhi = this.cosLat[y];
    const rr = Math.ceil(radius) + 1;
    for (let row = Math.max(0, y - rr); row <= Math.min(this.height - 1, y + rr); row++) {
      const denom = cosPhi * this.cosLat[row];
      const bound = (cosR - sinPhi * Math.sin(this.latitudes[row])) / denom;
      if (bound > 1 + 1e-10) continue;
      const dx = bound <= -1 ? this.width / 2 : Math.ceil(Math.acos(Math.max(-1, Math.min(1, bound))) * this.width / (2 * Math.PI));
      const lo = dx * 2 + 1 >= this.width ? 0 : x - dx;
      const hi = dx * 2 + 1 >= this.width ? this.width - 1 : x + dx;
      for (let col = lo; col <= hi; col++) {
        const id = this.index(col, row);
        if (this.distance(center, id) <= radius + 1e-8) out.push(id);
      }
    }
    if (this.radii.size >= 5000) this.radii.delete(this.radii.keys().next().value!);
    this.radii.set(key, out);
    return out;
  }
}