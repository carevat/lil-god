// Shared rendering helpers (no React).

import * as THREE from 'three';
import type { Living, WorldState } from '../game/types';
import { gridFor } from '../game/grid';
import { LEGACY_DIMENSIONS, type Dimensions } from '../game/scale';

// One rendering surface per canvas; simulation geometry never depends on this binding.
export let PLANET_RADIUS = 5;
export let renderSurface: Dimensions = LEGACY_DIMENSIONS;
export function configureSurface(world: Dimensions | null) {
  renderSurface = world ?? LEGACY_DIMENSIONS;
  PLANET_RADIUS = renderSurface.radius;
  hover.cell = null;
}
export const spriteScale = (distance: number) => THREE.MathUtils.clamp((distance - PLANET_RADIUS) / 10, 1, 1.5);

/** Direction toward the sun (world space). Updated by the lighting component, read by sprite shaders. */
export const sunDir = new THREE.Vector3(1, 0.2, 0.35).normalize();

/** Cell currently under the pointer (set by the click handler, read by markers). */
export const hover: { cell: number | null } = { cell: null };

export function cellPos(cell: number, scale = 1, out = new THREE.Vector3()): THREE.Vector3 {
  const u = gridFor(renderSurface).unit(cell);
  return out.set(u[0], u[1], u[2]).multiplyScalar((PLANET_RADIUS + (scale - 1) * 5));
}

/** Position of an entity on the sphere, interpolated between cells (follows the curvature). */
export function entityPos(e: Living, out: THREE.Vector3, lift = 1.004): THREE.Vector3 {
  const a = gridFor(renderSurface).unit(e.cellId);
  if (e.targetCellId !== null && e.moveProgress < 1) {
    const b = gridFor(renderSurface).unit(e.targetCellId);
    const t = e.moveProgress;
    out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  } else out.set(a[0], a[1], a[2]);
  return out.normalize().multiplyScalar((PLANET_RADIUS + (lift - 1) * 5));
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function civTint(world: WorldState, civId: string | null): [number, number, number] {
  const civ = civId ? world.civs[civId] : undefined;
  return civ ? hexRgb(civ.color) : [0.62, 0.64, 0.7];
}

export function idHash(id: string): number {
  let h = 0;
  for (let i = 1; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

const _n = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Write a circle of angular radius `radiusCells` around a cell onto the sphere surface. */
export function ringPositions(out: Float32Array, cell: number, radiusCells: number, lift = 1.012) {
  const u = gridFor(renderSurface).unit(cell);
  _n.set(u[0], u[1], u[2]);
  _t1.crossVectors(_n, Math.abs(_n.y) > 0.95 ? _t2.set(1, 0, 0) : _up).normalize();
  _t2.crossVectors(_n, _t1).normalize();
  const rho = radiusCells * gridFor(renderSurface).angle;
  const cr = Math.cos(rho), sr = Math.sin(rho);
  const segs = out.length / 3;
  for (let i = 0; i < segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const x = cr * _n.x + sr * (c * _t1.x + s * _t2.x);
    const y = cr * _n.y + sr * (c * _t1.y + s * _t2.y);
    const z = cr * _n.z + sr * (c * _t1.z + s * _t2.z);
    out[i * 3] = x * (PLANET_RADIUS + (lift - 1) * 5);
    out[i * 3 + 1] = y * (PLANET_RADIUS + (lift - 1) * 5);
    out[i * 3 + 2] = z * (PLANET_RADIUS + (lift - 1) * 5);
  }
}
