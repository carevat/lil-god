// Pooled particle system. A fixed ring buffer is reused so combat, impacts and weather never allocate.

import { cellUnit } from '../game/world';
import { PLANET_RADIUS, renderSurface } from './shared';

export type BurstKind = 'hit' | 'death' | 'raid' | 'impact' | 'birth' | 'conquest' | 'coronation' | 'lightning' | 'nature' | 'terraform' | 'dream';

export const MAX_PARTICLES = 1100;
export const P = {
  pos: new Float32Array(MAX_PARTICLES * 3),
  vel: new Float32Array(MAX_PARTICLES * 3),
  col: new Float32Array(MAX_PARTICLES * 4),
  life: new Float32Array(MAX_PARTICLES),
  maxLife: new Float32Array(MAX_PARTICLES).fill(1),
  grav: new Float32Array(MAX_PARTICLES),
  next: 0,
};

const queue: Array<{ kind: BurstKind; cellId: number }> = [];
export function queueBurst(kind: BurstKind, cellId: number) {
  if (queue.length < 80) queue.push({ kind, cellId });
}

// Deterministic-enough cheap randomness for visuals only (never touches simulation state).
let seed = 1337;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

interface Recipe { n: number; color: [number, number, number]; color2?: [number, number, number]; speed: number; spread: number; up: number; life: number; grav: number }

const RECIPES: Record<BurstKind, Recipe[]> = {
  hit: [{ n: 5, color: [1, 0.95, 0.7], speed: 0.7, spread: 0.7, up: 0.6, life: 0.35, grav: 0.5 }],
  death: [{ n: 8, color: [0.62, 0.62, 0.66], speed: 0.4, spread: 0.5, up: 0.9, life: 0.9, grav: -0.2 }],
  raid: [{ n: 9, color: [1, 0.55, 0.15], color2: [1, 0.25, 0.1], speed: 0.8, spread: 0.8, up: 0.8, life: 0.7, grav: 0.4 }],
  impact: [
    { n: 110, color: [0.55, 0.45, 0.34], color2: [0.35, 0.3, 0.26], speed: 1.5, spread: 1.7, up: 1.3, life: 2.4, grav: 0.25 },
    { n: 45, color: [0.2, 0.15, 0.1], speed: 2.2, spread: 1.4, up: 1.8, life: 1.3, grav: 1.4 },
    { n: 35, color: [1, 0.7, 0.2], color2: [1, 0.35, 0.1], speed: 1.8, spread: 1.2, up: 1.6, life: 0.9, grav: 0.8 },
  ],
  birth: [{ n: 10, color: [0.84, 0.74, 1], speed: 0.5, spread: 0.5, up: 1, life: 1.1, grav: -0.1 }],
  conquest: [{ n: 24, color: [1, 0.85, 0.3], speed: 0.9, spread: 1, up: 1.2, life: 1.2, grav: 0.2 }],
  lightning: [{ n: 28, color: [0.95, 0.92, 1], color2: [0.7, 0.55, 1], speed: 1.8, spread: 1.4, up: 1.2, life: 0.45, grav: 0.6 }],
  nature: [{ n: 16, color: [0.55, 0.85, 0.6], speed: 0.5, spread: 0.7, up: 1.1, life: 1.3, grav: -0.15 }],
  terraform: [{ n: 16, color: [0.9, 0.72, 0.42], speed: 0.7, spread: 0.8, up: 1, life: 1.0, grav: 0.3 }],
  dream: [
    { n: 22, color: [0.72, 0.55, 1], color2: [0.45, 0.3, 0.85], speed: 0.35, spread: 0.9, up: 1.2, life: 2.2, grav: -0.35 },
    { n: 8, color: [1, 1, 1], speed: 0.2, spread: 1.1, up: 1.4, life: 2.6, grav: -0.5 },
  ],
  coronation: [{ n: 26, color: [1, 0.88, 0.46], color2: [1, 1, 0.85], speed: 0.55, spread: 0.8, up: 1.2, life: 1.6, grav: -0.1 }],
};

function emit(cell: number, r: Recipe) {
  const u = cellUnit(cell, renderSurface);
  const nx = u[0], ny = u[1], nz = u[2];
  // tangent basis
  let tx = ny * 0 - nz * 1, ty = nz * 0 - nx * 0, tz = nx * 1 - ny * 0; // n x (0,1,0) -> (-nz, 0, nx)
  tx = -nz; ty = 0; tz = nx;
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  for (let k = 0; k < r.n; k++) {
    const i = P.next; P.next = (P.next + 1) % MAX_PARTICLES;
    const a = rnd() * Math.PI * 2, sp = (0.4 + rnd() * 0.6) * r.spread;
    const ox = Math.cos(a) * sp * 0.12, oy = Math.sin(a) * sp * 0.12;
    const R = PLANET_RADIUS * 1.012;
    P.pos[i * 3] = nx * R + tx * ox + bx * oy;
    P.pos[i * 3 + 1] = ny * R + ty * ox + by * oy;
    P.pos[i * 3 + 2] = nz * R + tz * ox + bz * oy;
    const up = r.up * (0.5 + rnd() * 0.8), s = r.speed;
    P.vel[i * 3] = (nx * up + (tx * Math.cos(a) + bx * Math.sin(a)) * sp) * s;
    P.vel[i * 3 + 1] = (ny * up + (ty * Math.cos(a) + by * Math.sin(a)) * sp) * s;
    P.vel[i * 3 + 2] = (nz * up + (tz * Math.cos(a) + bz * Math.sin(a)) * sp) * s;
    const c = r.color2 && rnd() < 0.5 ? r.color2 : r.color;
    P.col[i * 4] = c[0]; P.col[i * 4 + 1] = c[1]; P.col[i * 4 + 2] = c[2]; P.col[i * 4 + 3] = 1;
    P.maxLife[i] = r.life * (0.7 + rnd() * 0.6);
    P.life[i] = P.maxLife[i];
    P.grav[i] = r.grav;
  }
}

/** Convert queued bursts into particles (called once per frame). */
export function flushBursts() {
  while (queue.length) {
    const b = queue.shift()!;
    for (const r of RECIPES[b.kind]) emit(b.cellId, r);
  }
}

export function stepParticles(dt: number) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (P.life[i] <= 0) continue;
    P.life[i] -= dt;
    const a = Math.max(0, P.life[i] / P.maxLife[i]);
    P.col[i * 4 + 3] = a;
    const x = P.pos[i * 3], y = P.pos[i * 3 + 1], z = P.pos[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    const g = P.grav[i] * dt * 2.2;
    P.vel[i * 3] -= (x / l) * g; P.vel[i * 3 + 1] -= (y / l) * g; P.vel[i * 3 + 2] -= (z / l) * g;
    P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
    // keep particles above the surface
    const nl = Math.hypot(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]);
    if (nl < PLANET_RADIUS * 1.003) {
      const k = (PLANET_RADIUS * 1.003) / nl;
      P.pos[i * 3] *= k; P.pos[i * 3 + 1] *= k; P.pos[i * 3 + 2] *= k;
      P.vel[i * 3] *= 0.3; P.vel[i * 3 + 1] *= 0.3; P.vel[i * 3 + 2] *= 0.3;
    }
  }
}

export function resetParticles() { queue.length = 0; P.life.fill(0); P.col.fill(0); P.next = 0; }
