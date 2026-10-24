// Fixed-timestep clock: converts real frame time + speed into bounded simulation ticks.

import type { WorldState, Speed } from './types';
import { TICK_HOURS } from './config';
import { tick } from './simulation';

export const MAX_STEPS_PER_FRAME = 32;
export const MAX_FRAME_MS = 100; // clamp huge gaps (tab switches)

/** 1× = 1 game hour per real second, 3× = 3 hours, 8× = 8 hours. Returns the new accumulator and tick count. */
export function advanceClock(world: WorldState, realDtMs: number, speed: Speed, acc: number): { acc: number; steps: number } {
  if (speed === 0) return { acc, steps: 0 };
  acc += (Math.min(realDtMs, MAX_FRAME_MS) * speed) / 1000;
  let steps = 0;
  while (acc + 1e-9 >= TICK_HOURS && steps < MAX_STEPS_PER_FRAME) {
    tick(world, TICK_HOURS);
    acc = Math.max(0, acc - TICK_HOURS);
    steps++;
  }
  if (acc > TICK_HOURS) acc = TICK_HOURS; // drop backlog instead of spiralling
  return { acc, steps };
}
