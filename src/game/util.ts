// Small shared helpers: seeded RNG, ids, event log, notices, fx, relations.

import type { WorldState, EventCategory, FxEvent, Relation } from './types';
import { CAPS } from './config';

/** Deterministic RNG stored inside the world state (mulberry32 stepping). */
export function rand(s: WorldState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: WorldState, lo: number, hi: number): number {
  return lo + Math.floor(rand(s) * (hi - lo + 1));
}

export function newId(s: WorldState, prefix: string): string {
  s.idCounter++;
  return prefix + s.idCounter.toString(36);
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface LogOpts { entityId?: string; civId?: string; key?: string; windowDays?: number }

/** Push a history event. Events with a `key` are rate limited (suppressed ones are counted and summarised). */
export function logEvent(s: WorldState, category: EventCategory, text: string, opts: LogOpts = {}): boolean {
  if (opts.key) {
    const last = s.eventGate[opts.key];
    const win = opts.windowDays ?? 1;
    if (last !== undefined && s.day - last < win) {
      s.suppressed[opts.key] = (s.suppressed[opts.key] ?? 0) + 1;
      return false;
    }
    s.eventGate[opts.key] = s.day;
    const n = s.suppressed[opts.key];
    if (n) { text += ` (+${n} more)`; s.suppressed[opts.key] = 0; }
  }
  s.events.push({ id: newId(s, 'e'), day: s.day, category, text, entityId: opts.entityId, civId: opts.civId });
  if (s.events.length > CAPS.maxEvents) s.events.splice(0, s.events.length - CAPS.maxEvents);
  return true;
}

export function notify(s: WorldState, text: string, tone: 'info' | 'good' | 'warn' | 'bad' = 'info') {
  s.notices.push({ text, tone });
  if (s.notices.length > 8) s.notices.shift();
}

export function emitFx(s: WorldState, type: FxEvent['type'], cellId: number) {
  if (s.fx.length < CAPS.maxFx) s.fx.push({ type, cellId });
}

export function relKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function findRelation(s: WorldState, a: string, b: string): Relation | undefined {
  return s.relations[relKey(a, b)];
}

export function getRelation(s: WorldState, a: string, b: string): Relation {
  const k = relKey(a, b);
  let r = s.relations[k];
  if (!r) {
    const [x, y] = a < b ? [a, b] : [b, a];
    r = s.relations[k] = {
      id: k, a: x, b: y, tension: 0, status: 'peace', since: s.day, truceUntil: 0, warStart: 0,
      aggressor: null, startSoldiers: {}, casualties: {}, lastIncident: -100, lastEnvoy: -100, loot: 0,
    };
  }
  return r;
}

export function fmtDate(day: number): string {
  return `Y${Math.floor(day / 365) + 1}·D${Math.floor(day % 365) + 1}`;
}
