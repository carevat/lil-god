// Human authority and automatic kingship. The living human with the highest authority rules.

import type { WorldState, Citizen, Civilization, HumanRole } from './types';
import { AUTHORITY, SUCCESSION, HOURS_PER_DAY } from './config';
import { rand, logEvent, notify } from './util';
import { neighbors, isWaterType } from './world';
import { moveEntity } from './pathing';
import { SPECIES } from './species';

/** Roll a persistent authority score (1.00–100.00, two decimals) from the world's seeded RNG. */
export function rollAuthority(s: WorldState): number {
  const v = AUTHORITY.min + rand(s) * (AUTHORITY.max - AUTHORITY.min);
  return Math.round(v * 100) / 100;
}

export function civOf(s: WorldState, c: Citizen | undefined): Civilization | undefined {
  return c && c.civId ? s.civs[c.civId] : undefined;
}

/** King / Commander / Citizen for a living human. Dead humans have no rank. */
export function roleOf(s: WorldState, c: Citizen): HumanRole {
  if (!c.alive) return 'citizen';
  const civ = civOf(s, c);
  if (!civ) return 'citizen';
  if (civ.kingId === c.id) return 'king';
  if (civ.commanderId === c.id) return 'commander';
  return 'citizen';
}

export function kingOf(s: WorldState, civId: string | null | undefined): Citizen | undefined {
  const civ = civId ? s.civs[civId] : undefined;
  const id = civ?.kingId;
  const k = id ? s.citizens[id] : undefined;
  return k && k.alive && k.civId === civId ? k : undefined;
}

function stronger(a: Citizen, b: Citizen): boolean {
  return a.authority > b.authority || (a.authority === b.authority && a.id < b.id);
}

export function highestLiving(s: WorldState, civId: string): Citizen | undefined {
  let chosen: Citizen | undefined;
  for (const c of Object.values(s.citizens)) {
    if (c.alive && c.civId === civId && (!chosen || stronger(c, chosen))) chosen = c;
  }
  return chosen;
}

/** Called once from the shared death lifecycle after the former king has been marked dead. */
export function beginSuccession(s: WorldState, civId: string, formerKingId: string): void {
  const civ = s.civs[civId];
  if (!civ?.alive || civ.succession.phase !== 'stable' || civ.kingId !== formerKingId) return;
  const heir = highestLiving(s, civId);
  civ.kingId = null;
  if (!heir) { civ.succession = { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null }; return; }
  civ.succession = { phase: 'panic', startedDay: s.day, successorId: heir.id, formerKingId };
  logEvent(s, 'civ', `The ${civ.name} reel from the death of ${s.citizens[formerKingId]?.name ?? 'their king'}.`, { civId });
  notify(s, `Succession crisis in the ${civ.name}: the people panic.`, 'warn');
  for (const c of Object.values(s.citizens)) {
    if (!c.alive || c.civId !== civId) continue;
    c.task = 'panic'; c.taskId = null; c.goal = null; c.path = [];
    c.targetCellId = null; c.moveProgress = 1;
    c.thinkTimer = 0; c.targetEntityId = null;
  }
}

/** Irregular terrain-aware panic movement; all timing is in simulated hours, not browser timers. */
export function moveInPanic(s: WorldState, c: Citizen, dt: number): void {
  const crisis = c.civId ? s.civs[c.civId]?.succession : undefined;
  if (!crisis || crisis.phase !== 'panic' || !c.alive) return;
  const elapsed = Math.max(0, (s.day - crisis.startedDay) * HOURS_PER_DAY);
  const fade = Math.max(0, Math.min(1, (SUCCESSION.panicHours - elapsed) / (SUCCESSION.panicHours * 0.35)));
  const speed = SPECIES.human.moveSpeed * (1 + (SUCCESSION.runMultiplier - 1) * fade);
  c.task = 'panic';
  // Change direction only at a cell boundary; no paths through the planet or water.
  if (c.targetCellId === null && c.thinkTimer <= 0) {
    const options = neighbors(c.cellId, s).filter(n => !isWaterType(s.cells[n].type));
    if (options.length) {
      c.targetCellId = options[Math.floor(rand(s) * options.length)];
      c.moveProgress = 0;
    }
    c.thinkTimer = SUCCESSION.minimumRerouteHours + rand(s) * (SUCCESSION.maximumRerouteHours - SUCCESSION.minimumRerouteHours);
  }
  moveEntity(s, c, dt, speed);
}

/** One state machine per civilization, advanced once per fixed simulation tick. */
export function tickSuccessions(s: WorldState): void {
  for (const civ of Object.values(s.civs)) {
    const crisis = civ.succession;
    if (!civ.alive || (crisis.phase !== 'stable' && !highestLiving(s, civ.id))) {
      civ.kingId = null;
      crisis.phase = 'stable'; crisis.successorId = null; crisis.formerKingId = null;
      continue;
    }
    if (crisis.phase === 'panic' && (s.day - crisis.startedDay) * HOURS_PER_DAY >= SUCCESSION.panicHours) {
      crisis.phase = 'succession_announcement';
    }
    if (crisis.phase !== 'succession_announcement') continue;
    // Re-evaluate: an heir may have died, emigrated, or been outranked by a newborn.
    const heir = highestLiving(s, civ.id);
    crisis.successorId = heir?.id ?? null;
    crisis.phase = 'stable';
    crisis.formerKingId = null;
    for (const c of Object.values(s.citizens)) {
      if (!c.alive || c.civId !== civ.id || c.task !== 'panic') continue;
      c.task = 'idle'; c.path = []; c.targetCellId = null; c.moveProgress = 1;
      c.thinkTimer = rand(s) * 2; // stagger the return to routine
    }
    if (!heir) { civ.kingId = null; continue; }
    civ.kingId = heir.id;
    const text = `After a period of chaos, ${heir.name} has been crowned ruler of the ${civ.name}.`;
    logEvent(s, 'civ', text, { civId: civ.id, entityId: heir.id });
    notify(s, text, 'good');
    civ.history.push({ day: s.day, text });
    if (civ.history.length > 30) civ.history.shift();
    s.fx.push({ type: 'coronation', cellId: heir.cellId });
  }
}

/**
 * Recalculate King and Commander for one civilization (or all of them).
 * Idempotent, cheap (single pass over the civilization's citizens) and safe to call often.
 */
export function refreshLeadership(s: WorldState, civId?: string): void {
  for (const civ of Object.values(s.civs)) {
    if (civId && civ.id !== civId) continue;
    if (!civ.alive) { civ.kingId = null; civ.commanderId = null; civ.succession.phase = 'stable'; continue; }

    let king: Citizen | undefined;
    let commander: Citizen | undefined;
    let soldiers = 0;
    for (const c of Object.values(s.citizens)) {
      if (!c.alive || c.civId !== civ.id) continue;
      if (!king || stronger(c, king)) king = c;
      if (c.role === 'soldier') { soldiers++; if (!commander || stronger(c, commander)) commander = c; }
    }

    const prevKing = civ.kingId;
    if (!king && civ.succession.phase !== 'stable') {
      civ.succession = { phase: 'stable', startedDay: 0, successorId: null, formerKingId: null };
      civ.kingId = null;
      continue;
    }
    if (civ.succession.phase === 'panic' || civ.succession.phase === 'succession_announcement') {
      civ.succession.successorId = king?.id ?? null;
      civ.kingId = null;
      continue;
    }
    const nextKing = king?.id ?? null;
    civ.kingId = nextKing;
    const nextCommander = civ.population >= AUTHORITY.commanderMinPop && soldiers > 0 ? commander?.id ?? null : null;
    const prevCommander = civ.commanderId;
    civ.commanderId = nextCommander;

    if (prevKing !== nextKing) {
      if (nextKing) {
        const k = s.citizens[nextKing];
        logEvent(s, 'civ', `The crown of the ${civ.name} has passed to ${k.name} (authority ${k.authority.toFixed(2)}).`,
          { civId: civ.id, entityId: nextKing, key: `crown:${civ.id}`, windowDays: 0.2 });
        notify(s, `${k.name} now rules the ${civ.name}.`, 'good');
        civ.history.push({ day: s.day, text: `${k.name} took the crown.` });
        if (civ.history.length > 30) civ.history.shift();
      }
    }
    if (prevCommander !== nextCommander && nextCommander) {
      const cmd = s.citizens[nextCommander];
      logEvent(s, 'war', `${cmd.name} has been made Commander of the ${civ.name}.`,
        { civId: civ.id, entityId: nextCommander, key: `cmd:${civ.id}`, windowDays: 20 });
    }
  }
}

/** The king's authority is decisive in diplomacy; used by Divine Vision. */
export function isKing(s: WorldState, c: Citizen): boolean {
  return roleOf(s, c) === 'king';
}
