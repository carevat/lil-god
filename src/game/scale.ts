import type { SpeciesId } from './types';

export type WorldSize = 'small' | 'standard' | 'large';
export type CivDensity = 'sparse' | 'normal' | 'dense';
export interface WorldOptions { size: WorldSize; density: CivDensity }
export interface Dimensions { width: number; height: number; radius: number }

// Physical tile width stays constant: resolution and radius increase together.
export const WORLD_SIZES: Record<WorldSize, Dimensions & { label: string; starts: number }> = {
  small: { label: 'Small', width: 96, height: 48, radius: 5, starts: 8 },
  standard: { label: 'Standard', width: 192, height: 96, radius: 10, starts: 16 },
  large: { label: 'Large', width: 240, height: 120, radius: 12.5, starts: 20 },
};
export const DENSITIES: Record<CivDensity, { label: string; multiplier: number; spacing: number }> = {
  sparse: { label: 'Sparse', multiplier: 0.625, spacing: 19 },
  normal: { label: 'Normal', multiplier: 1, spacing: 14 },
  dense: { label: 'Dense', multiplier: 1.25, spacing: 11 },
};
export const DEFAULT_WORLD: WorldOptions = { size: 'standard', density: 'normal' };
export const LEGACY_DIMENSIONS: Dimensions = { width: 96, height: 48, radius: 5 };
export const GENERATION = {
  maxAttempts: 3,
  minRegionArea: 60, // equatorial-tile equivalent area, not inflated polar tile counts
  localLandRadius: 3,
  minimumLocalLand: 18,
  laterFoundingSpacing: 10,
  founders: 6,
};

export const targetCivilizations = (o: WorldOptions) =>
  Math.round(WORLD_SIZES[o.size].starts * DENSITIES[o.density].multiplier);

/** Population safety budget scales with actual tile count, not number of civilizations. */
export function humanCapacity(s: { width: number; height: number }): number {
  return Math.floor(240 * s.width * s.height / (96 * 48));
}
export function speciesCapacity(s: { width: number; height: number }, species: SpeciesId): number {
  const base = { human: 240, deer: 70, wolf: 24, rabbit: 120, golem: 6 }[species];
  return Math.floor(base * Math.sqrt(s.width * s.height / (96 * 48)));
}
export const wildlifeCapacity = (s: { width: number; height: number }) =>
  Math.floor(280 * Math.sqrt(s.width * s.height / (96 * 48)));