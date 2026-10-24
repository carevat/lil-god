// DIVINE VISION — enter a human's dream and plant the idea of war.
//
// The player can never declare war directly. War is reached through the existing diplomacy
// pathway: a vision raises tension (and mobilization) until the simulation's own rules
// declare it. Kings bypass the roll because their authority is decisive.

import type { WorldState, Citizen, Civilization } from './types';
import { VISION, DIPLOMACY, MILITARY, AUTHORITY } from './config';
import { rand, logEvent, notify, getRelation, findRelation } from './util';
import { roleOf } from './authority';
import { updateDiplomacy, declareWar } from './civ';
import { sphereDist } from './world';

export type VisionOutcome = 'war' | 'incited' | 'dismissed' | 'blocked';

export interface VisionFactor { label: string; delta: number }
export interface VisionAssessment {
  chance: number; // 0..1
  guaranteed: boolean; // kings always succeed when a valid rival exists
  factors: VisionFactor[];
  blocked?: string; // human-readable reason the intervention cannot happen
  clamped: boolean;
}

export interface VisionResult {
  ok: boolean;
  reason?: string;
  outcome?: VisionOutcome;
  chance?: number;
  war?: boolean;
  targetName?: string;
  rivalName?: string;
}

/** Civilizations that may legitimately be attacked by `civId` right now. */
export function validRivals(s: WorldState, civId: string): Civilization[] {
  const self = s.civs[civId];
  if (!self || !self.alive) return [];
  return Object.values(s.civs).filter(c =>
    c.alive && c.id !== civId && Object.values(s.settlements).some(st => st.civId === c.id));
}

/** The most plausible enemy: existing hostility first, then shared borders, then raw distance. */
export function suggestRival(s: WorldState, civId: string): Civilization | null {
  const rivals = validRivals(s, civId);
  if (!rivals.length) return null;
  const self = s.civs[civId];
  const own = Object.values(s.settlements).filter(st => st.civId === civId);
  const score = (r: Civilization) => {
    const rel = findRelation(s, civId, r.id);
    let v = 0;
    if (rel) {
      if (rel.status === 'tension') v += 40;
      if (rel.status === 'truce') v += 20;
      v += rel.tension * 0.4;
    }
    v += (s.borderFriction[relKeyOf(s, civId, r.id)] ?? 0) * 3;
    let d = Infinity;
    for (const a of own) for (const b of Object.values(s.settlements)) if (b.civId === r.id) d = Math.min(d, sphereDist(a.cellId, b.cellId, s));
    v += Math.max(0, 30 - d * 2);
    void self;
    return v;
  };
  return rivals.sort((a, b) => score(b) - score(a))[0];
}

function relKeyOf(_s: WorldState, a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Validate the target and compute the real probability of the vision leading to war. */
export function assessVision(s: WorldState, targetId: string, rivalId: string | null): VisionAssessment & { target?: Citizen; rival?: Civilization } {
  const target = s.citizens[targetId];
  if (!target) return { chance: 0, guaranteed: false, factors: [], blocked: 'That person no longer exists.', clamped: false };
  if (!target.alive) return { chance: 0, guaranteed: false, factors: [], blocked: `${target.name} is dead — the dead do not dream.`, clamped: false };
  const civ = target.civId ? s.civs[target.civId] : undefined;
  if (!civ || !civ.alive) return { chance: 0, guaranteed: false, factors: [], blocked: `${target.name} belongs to no living civilization.`, clamped: false };
  const role = roleOf(s, target);

  const factors: VisionFactor[] = [{ label: `Authority ${target.authority.toFixed(2)}`, delta: VISION.base + (VISION.authorityWeight * target.authority) / 100 }];
  let chance = VISION.base + (VISION.authorityWeight * target.authority) / 100;

  if (rivalId) {
    const rival = s.civs[rivalId];
    if (!rival || !rival.alive) return { chance: 0, guaranteed: false, factors, blocked: 'That civilization no longer exists.', clamped: false, target, rival };
    if (rival.id === civ.id) return { chance: 0, guaranteed: false, factors, blocked: 'A civilization cannot wage war on itself.', clamped: false, target, rival };
    if (!Object.values(s.settlements).some(st => st.civId === rival.id)) {
      return { chance: 0, guaranteed: false, factors, blocked: `The ${rival.name} hold no settlements to attack.`, clamped: false, target, rival };
    }
    const rel = getRelation(s, civ.id, rival.id);
    if (rel.status === 'war') return { chance: 0, guaranteed: false, factors, blocked: `The ${civ.name} are already at war with the ${rival.name}.`, clamped: false, target, rival };
    if (rel.status === 'tension' || rel.tension >= DIPLOMACY.tensionAt) { chance += VISION.hostilityBonus; factors.push({ label: 'Already hostile', delta: VISION.hostilityBonus }); }
    if (rel.status === 'truce') { chance -= VISION.trucePenalty; factors.push({ label: 'Recent truce', delta: -VISION.trucePenalty }); }
    if ((s.borderFriction[rel.id] ?? 0) > 0) { chance += VISION.borderBonus; factors.push({ label: 'Contested border', delta: VISION.borderBonus }); }
    const theirs = rival.militaryStrength, ours = civ.militaryStrength;
    if (civ.soldiers >= MILITARY.minSoldiersForWar) { chance += VISION.readinessBonus; factors.push({ label: 'Soldiers ready', delta: VISION.readinessBonus }); }
    if (theirs > 0 && ours < theirs * 0.4) { chance -= VISION.militaryPenalty; factors.push({ label: 'Hopelessly outgunned', delta: -VISION.militaryPenalty }); }
  }

  const raw = chance;
  const clamped = !Object.is(raw, Math.max(VISION.min, Math.min(VISION.max, raw)));
  chance = Math.max(VISION.min, Math.min(VISION.max, chance));
  if (clamped) factors.push({ label: 'Bounded', delta: 0 });

  let blocked: string | undefined;
  let guaranteed = false;
  if (role === 'king') {
    const rivals = validRivals(s, civ.id);
    if (!rivals.length) blocked = `The ${civ.name} have no valid rival to march against.`;
    else if (!rivalId) blocked = 'Choose a rival civilization first.';
    else guaranteed = true;
  }
  return { chance, guaranteed, factors, blocked, clamped, target, rival: rivalId ? s.civs[rivalId] : undefined };
}

/**
 * Resolve the intervention. Never costs divine energy — the caller spends it only when this returns ok.
 */
export function performVision(s: WorldState, targetId: string, rivalId: string): VisionResult {
  const a = assessVision(s, targetId, rivalId);
  if (!a.target || !a.rival) return { ok: false, reason: a.blocked ?? 'The vision finds no purchase.' };
  const target = a.target, rival = a.rival;
  const civ = s.civs[target.civId!]!;
  const role = roleOf(s, target);
  const rel = getRelation(s, civ.id, rival.id);
  const rivalName = rival.name;

  logEvent(s, 'divine', `A strange vision disturbed ${target.name} of the ${civ.name}.`, { entityId: target.id, civId: civ.id });

  // ---- Kings speak with one voice: their dream becomes a declaration. ----
  if (role === 'king') {
    if (a.blocked) return { ok: false, reason: a.blocked };
    civ.mobilize = VISION.mobilizeAmount;
    const declaration = declareThroughExistingPathway(s, civ.id, rival.id,
      `King ${target.name} has declared war on the ${rivalName} after a divine vision`);
    return {
      ok: true, outcome: 'war', chance: 1, war: declaration, targetName: target.name, rivalName,
    };
  }

  // ---- Everyone else is subject to the roll. ----
  const rolled = rand(s) < a.chance;
  if (!rolled) {
    const excuse = ['dismissed the dream as a passing fancy', 'woke and forgot the dream entirely', 'was left uneasy, but said nothing'];
    const text = excuse[Math.floor(rand(s) * excuse.length)];
    logEvent(s, 'divine', `${target.name} ${text}.`, { entityId: target.id, civId: civ.id, key: 'vision-fail', windowDays: 1 });
    notify(s, `${target.name} rejected the vision.`, 'info');
    return { ok: true, outcome: 'dismissed', chance: a.chance, war: false, targetName: target.name, rivalName };
  }

  civ.mobilize = Math.min(1, civ.mobilize + VISION.mobilizeAmount);
  rel.tension = Math.min(DIPLOMACY.maxTension, rel.tension + (role === 'commander' ? VISION.influenceTension : target.authority >= AUTHORITY.influential ? VISION.influenceTension : VISION.citizenTension));

  // The idea spreads through the settlement before it reaches the throne.
  let spread = 0;
  for (const other of Object.values(s.citizens)) {
    if (spread >= 8) break;
    if (!other.alive || other.civId !== civ.id || other.id === target.id) continue;
    if (sphereDist(other.cellId, target.cellId, s) > VISION.inciteRadius) continue;
    other.incitedUntil = s.day + VISION.inciteDays;
    spread++;
  }

  const verb = role === 'commander'
    ? `Commander ${target.name} has begun calling for retaliation against the ${rivalName}`
    : target.authority >= AUTHORITY.influential
      ? `${target.name} is rallying the ${civ.name} against the ${rivalName}`
      : `${target.name} is whispering of war with the ${rivalName} through the ${civ.name}`;
  logEvent(s, 'war', `${verb}.`, { entityId: target.id, civId: civ.id, key: `vision-hit:${civ.id}`, windowDays: 2 });
  notify(s, `${target.name} stirs the ${civ.name} toward war.`, 'warn');

  // Let the existing political system act on the new tension immediately.
  const before = rel.status;
  updateDiplomacy(s);
  const after = findRelation(s, civ.id, rival.id);
  const war = after?.status === 'war' && before !== 'war';
  return { ok: true, outcome: 'incited', chance: a.chance, war, targetName: target.name, rivalName };
}

/** Declare war strictly through the simulation's own declaration code (no second war pathway). */
export function declareThroughExistingPathway(s: WorldState, civId: string, rivalId: string, reason: string): boolean {
  const civ = s.civs[civId], rival = s.civs[rivalId];
  if (!civ || !rival || !civ.alive || !rival.alive) return false;
  const rel = findRelation(s, civId, rivalId);
  if (rel?.status === 'war') return false;
  declareWar(s, civ, rival, reason);
  return true;
}
