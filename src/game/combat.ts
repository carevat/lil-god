// Individual melee combat: attack wind-up → single impact → swing recovery, plus hit/death/victory reactions.
//
// The animation state is *runtime only* (never saved). The simulation only guarantees that a blow lands
// once per `beginAttack`, so loading mid-fight simply leaves combatants in a valid state.

import type { WorldState, Living, DamageKind, Citizen } from './types';
import { COMBAT } from './config';
import { rand, clamp } from './util';
import { applyDamage, attackPower, defenseOf, getEntity, effectiveCell } from './lifecycle';
import { sphereDist } from './world';

export type AttackPhase = 'windup' | 'swing';

export interface AttackAnim {
  phase: AttackPhase;
  t: number;
  dur: number;
  targetId: string;
  kind: DamageKind;
  /** Set once the blow has landed, so damage can never be applied twice. */
  resolved: boolean;
}

export interface Reaction { kind: 'hit' | 'cheer'; t: number; dur: number }
export interface DeathAnim { t: number; dur: number }

const attacks = new Map<string, AttackAnim>();
const reactions = new Map<string, Reaction>();
const deaths = new Map<string, DeathAnim>();

export function resetAnims(): void {
  attacks.clear(); reactions.clear(); deaths.clear();
}

/** True while an entity is mid-attack (used to pace building raids too). */
export function hasAttack(id: string): boolean {
  return attacks.has(id);
}
export function currentAttack(id: string): AttackAnim | undefined {
  const a = attacks.get(id);
  return a && a.t < a.dur ? a : undefined;
}
export function reactionOf(id: string): Reaction | undefined {
  const r = reactions.get(id);
  return r && r.t < r.dur ? r : undefined;
}
export function deathOf(id: string): DeathAnim | undefined {
  const d = deaths.get(id);
  return d && d.t < d.dur ? d : undefined;
}
export function fightingIds(): string[] {
  return [...attacks.keys()];
}

/** Chance for `atk` to connect with `def`, from base accuracy minus the defender's protection. */
export function hitChance(s: WorldState, def: Living): number {
  return clamp(COMBAT.baseHit - defenseOf(s, def) * 0.65, COMBAT.minHit, COMBAT.maxHit);
}

export type AttackStart = 'started' | 'busy' | 'cooldown' | 'invalid';

/**
 * Begin one attack. Damage is *not* applied here — it lands once, when the wind-up finishes.
 * Returns why no attack was started when it refuses.
 */
/** How far a blow can still connect, measured in cell widths. */
export const REACH = 1.8;

export function beginAttack(s: WorldState, atk: Living, def: Living, kind: DamageKind = 'combat'): AttackStart {
  if (!atk.alive || !def.alive || atk.id === def.id) return 'invalid';
  // The target must still exist in the world: stale references from a previous fight are refused.
  if (getEntity(s, def.id) !== def) return 'invalid';
  if (attacks.has(atk.id)) return 'busy';
  if (atk.attackCd > 0) return 'cooldown';
  const { cooldown } = attackPower(atk);
  atk.attackCd = cooldown; // reserved now, so the attack can never be doubled up
  attacks.set(atk.id, { phase: 'windup', t: 0, dur: COMBAT.windup, targetId: def.id, kind, resolved: false });
  return 'started';
}

function resolve(s: WorldState, atk: Living, a: AttackAnim): void {
  a.resolved = true;
  const def = getEntity(s, a.targetId);
  // The target may have moved away, died or been deleted while we were winding up.
  if (!def || !def.alive || getEntity(s, atk.id) !== atk) return;
  if (sphereDist(effectiveCell(atk), effectiveCell(def), s) > REACH) return; // the blow whiffs
  if (rand(s) > hitChance(s, def)) return; // a clean miss
  const { damage } = attackPower(atk);
  const dmg = damage * (0.85 + 0.3 * rand(s));
  const res = applyDamage(s, def, dmg, { kind: a.kind, byId: atk.id, byCivId: atk.species === 'human' ? (atk as { civId?: string | null }).civId : null });
  reactions.set(def.id, { kind: 'hit', t: 0, dur: COMBAT.hitFlash });
  if (res.killed) reactions.set(atk.id, { kind: 'cheer', t: 0, dur: COMBAT.cheer });
}

/** Advance every attack and reaction. Called once per simulation tick. */
export function stepCombat(s: WorldState, dt: number): void {
  for (const [id, a] of [...attacks]) {
    a.t += dt;
    void id;
    if (a.phase === 'windup' && a.t >= COMBAT.windup && !a.resolved) {
      const atk = getEntity(s, id);
      if (atk && atk.alive && !(atk.species === 'human' &&
        s.civs[(atk as Citizen).civId ?? '']?.succession.phase === 'panic')) resolve(s, atk, a);
      else a.resolved = true;
      a.phase = 'swing';
      a.dur = a.t + COMBAT.swing;
    }
    if (a.t >= a.dur) attacks.delete(id);
  }
  for (const [id, r] of [...reactions]) { r.t += dt; if (r.t >= r.dur) reactions.delete(id); }
  for (const [id, d] of [...deaths]) { d.t += dt; if (d.t >= d.dur) deaths.delete(id); }
}

/** Play the death animation exactly once for an entity that has just died. */
export function markDeath(id: string): void {
  if (deaths.has(id)) return;
  deaths.set(id, { t: 0, dur: COMBAT.hitFlash + 0.9 });
}

/** Drop every animation that references entities no longer in the world. */
export function pruneAnims(s: WorldState): void {
  for (const [id, a] of [...attacks]) {
    if (!getEntity(s, id)) attacks.delete(id);
    else if (!getEntity(s, a.targetId)) attacks.delete(id);
  }
  for (const id of [...reactions.keys()]) if (!getEntity(s, id)) reactions.delete(id);
  for (const id of [...deaths.keys()]) if (!getEntity(s, id)) deaths.delete(id);
}
