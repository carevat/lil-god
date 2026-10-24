import { describe, it, expect } from 'vitest';
import { generateWorld, latLonToVec3, vec3ToLatLon, latLonToCell, N_CELLS, sphereDist, cellsWithin, neighbors, GRID_W } from '../game/world';
import { findPath } from '../game/pathing';
import { advanceClock } from '../game/clock';
import { base } from './helpers';

describe('world generation', () => {
  it('identical seeds produce identical terrain, different seeds differ', () => {
    const a = generateWorld(42, 'balanced').cells;
    const b = generateWorld(42, 'balanced').cells;
    const c = generateWorld(43, 'balanced').cells;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
    expect(new Set(a.map(x => x.type)).size).toBeGreaterThanOrEqual(4);
  });

  it('every cell maps to a valid spherical position and back', () => {
    const { cells } = generateWorld(7, 'lush');
    expect(cells.length).toBe(N_CELLS);
    for (const c of cells) {
      const [x, y, z] = latLonToVec3(c.lat, c.lon, 1);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      const ll = vec3ToLatLon(x, y, z);
      expect(latLonToCell(ll.lat, ll.lon)).toBe(c.id);
    }
  });

  it('spherical distance and radius queries wrap around the planet', () => {
    expect(sphereDist(0, 0)).toBe(0);
    expect(sphereDist(0, GRID_W - 1)).toBeLessThan(1.5); // east-west seam
    const within = cellsWithin(24 * GRID_W + 10, 3);
    expect(within).toContain(24 * GRID_W + 10);
    for (const id of within) expect(sphereDist(24 * GRID_W + 10, id)).toBeLessThanOrEqual(3 + 1e-6);
  });

  it('A* finds a connected path over land and refuses water goals', () => {
    const { s, start } = base();
    const goal = (() => { let cur = start; for (let i = 0; i < 4; i++) cur = neighbors(cur).find(n => s.cells[n].type !== 'deepOcean' && s.cells[n].type !== 'shallowOcean' && n !== cur) ?? cur; return cur; })();
    const p = findPath(s.cells, start, goal);
    expect(p).not.toBeNull();
    if (p && p.length) {
      let prev = start;
      for (const c of p) { expect(neighbors(prev)).toContain(c); prev = c; }
      expect(prev).toBe(goal);
    }
    const ocean = s.cells.findIndex(c => c.type === 'deepOcean');
    expect(findPath(s.cells, start, ocean)).toBeNull();
  });
});

describe('simulation clock', () => {
  it('advances proportionally to speed and never when paused', () => {
    const run = (speed: 0 | 1 | 3 | 8) => {
      const { s } = base();
      let acc = 0;
      for (let i = 0; i < 10; i++) acc = advanceClock(s, 100, speed, acc).acc; // one real second
      return s.day * 24;
    };
    expect(run(0)).toBe(0);
    expect(run(1)).toBeCloseTo(1, 6);
    expect(run(3)).toBeCloseTo(3, 6);
    expect(run(8)).toBeCloseTo(8, 6);
  });

  it('clamps huge frame gaps and bounds steps per frame', () => {
    const { s } = base();
    const r = advanceClock(s, 60_000, 8, 0); // tab was hidden for a minute
    expect(r.steps).toBeLessThanOrEqual(32);
    expect(s.day * 24).toBeLessThan(10);
  });
});
