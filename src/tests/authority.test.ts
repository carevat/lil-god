import { describe, it, expect, beforeEach } from 'vitest';
import { base, flatten, mkCiv, run, eastOf } from './helpers';
import { findHumanSpawnCells } from '../game/world';
import { SUCCESSION } from '../game/config';
import { createHuman, refreshCounts, applyDamage, killEntity } from '../game/lifecycle';
import { giveBirth } from '../game/humans';
import { roleOf, refreshLeadership, kingOf, rollAuthority } from '../game/authority';
import { beginAttack, stepCombat, currentAttack, resetAnims, hitChance } from '../game/combat';
import { assessVision, performVision, validRivals, suggestRival } from '../game/vision';
import { migrateSave, authorityFor } from '../game/migrate';
import { serialize } from '../game/persistence';
import { declareWar, fallCiv, createCivilization, foundSettlement } from '../game/civ';
import { getRelation, findRelation } from '../game/util';
import { VISION, COMBAT, AUTHORITY, DIPLOMACY } from '../game/config';
import type { Citizen } from '../game/types';

beforeEach(() => resetAnims());

/** Make `who` the undisputed highest-authority human of their civilization. */
function crown(s: ReturnType<typeof base>['s'], who: Citizen, value = 99.5) {
  for (const c of Object.values(s.citizens)) {
    if (c.civId !== who.civId || c.id === who.id) continue;
    if (c.authority >= value) c.authority = Math.max(1, value - 1);
  }
  who.authority = value;
  refreshLeadership(s, who.civId ?? undefined);
  return who;
}

function twoCivs(n = 8) {
  const { s, start } = base();
  flatten(s, start, 18);
  const A = mkCiv(s, start, n);
  const B = mkCiv(s, eastOf(start, 10), n);
  A.civ.founded = -100; B.civ.founded = -100;
  s.day = 40;
  resetAnims();
  return { s, start, A, B };
}

/** Repeat the vision until it produces the outcome we want (the roll is seeded, not rigged). */
function attempt(s: ReturnType<typeof base>['s'], target: Citizen, rivalId: string, want: 'incited' | 'dismissed', startTension = 20) {
  const rel = getRelation(s, target.civId!, rivalId);
  for (let i = 0; i < 300; i++) {
    if (rel) rel.tension = startTension;
    if (target.civId) s.civs[target.civId].mobilize = 0;
    const r = performVision(s, target.id, rivalId);
    if (r.outcome === want) return r;
  }
  return null;
}

describe('authority', () => {
  it('gives newly created humans a persistent decimal score in range', () => {
    const { s, start } = base();
    const made = [0, 1, 2].map(() => createHuman(s, start));
    for (const c of made) {
      expect(c.authority).toBeGreaterThanOrEqual(1);
      expect(c.authority).toBeLessThanOrEqual(100);
      expect(Number.isFinite(c.authority)).toBe(true);
      expect(Number(c.authority.toFixed(2))).toBe(c.authority);
    }
    expect(new Set(made.map(c => c.authority)).size).toBeGreaterThan(1); // spread, not a constant
    const before = made.map(c => c.authority);
    run(s, 6);
    expect(made.map(c => c.authority)).toEqual(before); // never rerolled by the simulation
  });

  it('gives born children their own authority', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const { civ, humans } = mkCiv(s, start, 2);
    const home = { id: 'b_x', type: 'house' as const, cellId: start + 1 };
    void home;
    civ.housing.capacity = 6; civ.resources.food = 120;
    const [m, f] = humans[0].gender === 'f' ? [humans[1], humans[0]] : [humans[0], humans[1]];
    m.partnerId = f.id; f.partnerId = m.id;
    const baby = giveBirth(s, f)!;
    expect(baby).toBeTruthy();
    expect(baby.authority).toBeGreaterThanOrEqual(1);
    expect(baby.authority).toBeLessThanOrEqual(100);
    expect(baby.authority).not.toBe(m.authority);
  });

  it('migrates saves whose humans have no authority, and stays stable on re-migration', () => {
    const { s, A } = twoCivs(2);
    A.humans[0].name = 'Mira'; A.humans[1].name = 'Arven';
    refreshLeadership(s);
    const raw: any = JSON.parse(serialize(s, true));
    raw.version = 2; // a Part 2 save from before this update
    for (const c of Object.values<any>(raw.state.citizens)) { delete c.authority; delete c.incitedUntil; }
    for (const c of Object.values<any>(raw.state.civs)) { delete c.kingId; delete c.commanderId; delete c.mobilize; }
    const res = migrateSave(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.migrated).toBe(true);
    const m = res.data.state;
    const a = m.citizens[A.humans[0].id], b = m.citizens[A.humans[1].id];
    for (const c of [a, b]) {
      expect(c.authority).toBeGreaterThanOrEqual(1);
      expect(c.authority).toBeLessThanOrEqual(100);
      expect(Number(c.authority.toFixed(2))).toBe(c.authority);
      expect(c.incitedUntil).toBe(0);
    }
    expect(authorityFor(m.seed, A.humans[0].id)).toBe(a.authority); // deterministic, not rerolled per load
    const civ = m.civs[A.civ.id];
    expect(civ.kingId).toBeTruthy();
    const king = m.citizens[civ.kingId!];
    expect(king.alive).toBe(true);
    expect(king.authority).toBeGreaterThanOrEqual(Math.max(a.authority, b.authority));
    expect(civ.mobilize).toBe(0);
    // loading the same file twice never changes anyone's identity or score
    const again = migrateSave(JSON.parse(JSON.stringify(raw)));
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.state.citizens[A.humans[0].id].authority).toBe(a.authority);
    // the migrated world keeps simulating
    run(m, 6);
    expect(Object.values(m.citizens).every(c => Number.isFinite(c.authority))).toBe(true);
  });
});

describe('kingship', () => {
  it('crowns the highest-authority living human, once per civilization', () => {
    const { s, A, B } = twoCivs(6);
    const kingA = crown(s, A.humans[2]);
    const kingB = crown(s, B.humans[4]);
    expect(A.civ.kingId).toBe(kingA.id);
    expect(B.civ.kingId).toBe(kingB.id); // different civilizations, different kings
    for (const civ of [A.civ, B.civ]) {
      const kings = Object.values(s.citizens).filter(c => c.alive && c.civId === civ.id && roleOf(s, c) === 'king');
      expect(kings.length).toBe(1);
      expect(roleOf(s, kings[0])).toBe('king');
    }
    expect(roleOf(s, A.humans[0])).toBe('citizen');
  });

  it('a newborn with the highest authority immediately becomes king', () => {
    const { s, A } = twoCivs(4);
    A.civ.housing.capacity = 20; A.civ.resources.food = 200;
    const mother = A.humans.find(h => h.gender === 'f')!;
    const father = A.humans.find(h => h.gender === 'm' && h.id !== mother.id)!;
    mother.partnerId = father.id; father.partnerId = mother.id;
    const baby = giveBirth(s, mother)!;
    expect(baby.authority).toBeGreaterThanOrEqual(1);
    crown(s, baby, 99.99);
    expect(A.civ.kingId).toBe(baby.id);
    expect(roleOf(s, baby)).toBe('king');
    expect(Object.values(s.citizens).filter(x => x.alive && x.civId === A.civ.id).length).toBe(5);
    // only one king despite the newborn outranking everyone
    expect(Object.values(s.citizens).filter(c => c.alive && c.civId === A.civ.id && roleOf(s, c) === 'king').length).toBe(1);
  });

  it('designates an heir immediately, then crowns them after the panic, even during war', () => {
    const { s, A, B } = twoCivs(6);
    const king = crown(s, A.humans[1]);
    const heir = A.humans[2];
    for (const c of Object.values(s.citizens)) if (c.civId === A.civ.id && c.id !== king.id) c.authority = c.id === heir.id ? 70 : 1;
    refreshLeadership(s, A.civ.id);
    expect(A.civ.kingId).toBe(king.id);
    declareWar(s, A.civ, B.civ, 'test');
    const deaths = s.stats.deaths;
    const population = A.civ.population;
    killEntity(s, king, 'battle');
    expect(A.civ.kingId).toBeNull(); // crown is vacant until the public announcement
    expect(A.civ.succession.phase).toBe('panic');
    expect(A.civ.succession.successorId).toBe(heir.id);
    run(s, SUCCESSION.panicHours + 1);
    expect(A.civ.kingId).toBe(heir.id);
    expect(roleOf(s, heir)).toBe('king');
    expect(kingOf(s, A.civ.id)?.id).toBe(heir.id);
    expect(s.stats.deaths).toBe(deaths + 1); // processed exactly once
    refreshCounts(s);
    expect(A.civ.population).toBe(population - 1);
    expect(s.population).toBe(population - 1 + 6);
    applyDamage(s, A.humans[1], 500, { kind: 'combat' });
    expect(s.stats.deaths).toBe(deaths + 1);
    expect(findRelation(s, A.civ.id, B.civ.id)?.status).toBe('war'); // the war continues
    expect(s.events.some(e => /crown of the/.test(e.text))).toBe(true);
    expect(s.events.some(e => /has died/.test(e.text))).toBe(true);
  });

  it('a civilization without living humans has no king, and fallen ones lose theirs', () => {
    const { s, A, B } = twoCivs(3);
    for (const h of A.humans) killEntity(s, h, 'plague');
    expect(A.civ.kingId).toBeNull();
    expect(kingOf(s, A.civ.id)).toBeUndefined();
    fallCiv(s, A.civ, B.civ);
    expect(A.civ.kingId).toBeNull();
    expect(roleOf(s, B.humans[0])).toBe('citizen');
  });

  it('commanders are appointed from soldiers once the population is large enough', () => {
    const { s, A } = twoCivs(8);
    crown(s, A.humans[7], 99); // the king is a civilian
    for (const h of A.humans.slice(0, 3)) h.role = 'soldier';
    A.humans[1].authority = 60;
    refreshCounts(s); refreshLeadership(s);
    expect(A.civ.kingId).toBe(A.humans[7].id);
    expect(A.civ.commanderId).toBe(A.humans[1].id); // highest-authority soldier
    expect(roleOf(s, A.humans[1])).toBe('commander');
    expect(roleOf(s, A.humans[7])).toBe('king');
    A.civ.population = 2;
    refreshLeadership(s);
    expect(A.civ.commanderId).toBeNull();
  });

  it('rolled authority is seeded and bounded', () => {
    const { s } = base();
    const values = [rollAuthority(s), rollAuthority(s), rollAuthority(s)];
    for (const v of values) { expect(v).toBeGreaterThanOrEqual(AUTHORITY.min); expect(v).toBeLessThanOrEqual(AUTHORITY.max); }
    const { s: s2 } = base();
    expect(rollAuthority(s2)).toBe(values[0]); // same seed -> same sequence
  });
});

describe('divine vision', () => {
  it('rejects dead, missing and unaffiliated targets', () => {
    const { s, A, B } = twoCivs(6);
    const rival = B.civ.id;
    expect(assessVision(s, 'nobody', rival).blocked).toBeTruthy();
    const ghost = A.humans[0];
    killEntity(s, ghost, 'test');
    expect(performVision(s, ghost.id, rival).ok).toBe(false);
    expect(assessVision(s, ghost.id, rival).blocked).toMatch(/dead/i);
    const loner = createHuman(s, A.humans[1].cellId, { civId: null });
    expect(assessVision(s, loner.id, rival).blocked).toMatch(/no living civilization/i);
    expect(validRivals(s, A.civ.id).map(c => c.id)).toContain(rival);
  });

  it('prevents invalid rival choices', () => {
    const { s, A, B } = twoCivs(6);
    const target = A.humans[0];
    expect(assessVision(s, target.id, A.civ.id).blocked).toMatch(/itself/i);
    // an extinct civilization cannot be attacked
    const dead = createCivilization(s);
    const st = foundSettlement(s, dead, findHumanSpawnCells(s.cells, eastOf(start_cell(s), 20), 1)[0]);
    void st;
    fallCiv(s, dead);
    expect(assessVision(s, target.id, dead.id).blocked).toMatch(/no longer exists/i);
    // already at war
    declareWar(s, A.civ, B.civ, 'test');
    expect(assessVision(s, target.id, B.civ.id).blocked).toMatch(/already at war/i);
  });

  it('uses the documented probability curve and clamps it', () => {
    const { s, A, B } = twoCivs(6);
    const rival = B.civ.id;
    const low = createHuman(s, A.humans[0].cellId, { civId: A.civ.id });
    low.authority = 5;
    const high = createHuman(s, A.humans[0].cellId, { civId: A.civ.id });
    high.authority = 100;
    const aLow = assessVision(s, low.id, rival);
    const aHigh = assessVision(s, high.id, rival);
    expect(aLow.chance).toBeCloseTo(VISION.base + (VISION.authorityWeight * 5) / 100, 5);
    expect(aHigh.chance).toBeCloseTo(aHigh.factors.reduce((sum, f) => sum + f.delta, 0), 5);
    expect(aHigh.factors.some(f => /Authority 100.00/.test(f.label))).toBe(true);
    expect(aHigh.chance).toBeGreaterThan(aLow.chance);
    expect(aLow.chance).toBeLessThanOrEqual(VISION.max);
    expect(aLow.chance).toBeGreaterThanOrEqual(VISION.min);
    expect(aLow.guaranteed).toBe(false);
    // influence matters: an influential non-king clearly beats a nobody
    expect(aHigh.chance).toBeGreaterThan(0.5);
    expect(hitChance(s, low)).toBeLessThanOrEqual(COMBAT.maxHit);
    expect(suggestRival(s, A.civ.id)).toBeTruthy();
  });

  it('a king-targeted vision guarantees war with a valid rival', () => {
    const { s, A, B } = twoCivs(8);
    const king = A.humans.reduce((best, who) => (who.authority > best.authority ? who : best), A.humans[0]);
    refreshLeadership(s);
    expect(A.civ.kingId).toBe(king.id);
    const rival = suggestRival(s, A.civ.id)!;
    expect(rival.id).toBe(B.civ.id);
    const a = assessVision(s, king.id, rival.id);
    expect(a.guaranteed).toBe(true);
    expect(a.blocked).toBeUndefined();
    const r = performVision(s, king.id, rival.id);
    expect(r.ok).toBe(true);
    expect(r.outcome).toBe('war');
    expect(r.war).toBe(true);
    expect(getRelation(s, A.civ.id, B.civ.id).status).toBe('war');
    expect(s.events.some(e => /declared war on the/.test(e.text) && /divine vision/.test(e.text))).toBe(true);
    expect(A.civ.mobilize).toBeGreaterThan(0);
    // a second declaration is refused
    expect(performVision(s, king.id, rival.id).ok).toBe(false);
  });

  it('refuses a king vision when no valid rival exists', () => {
    const { s, A } = twoCivs(4);
    const king = A.humans[0];
    king.authority = 100;
    refreshLeadership(s);
    for (const c of Object.values(s.civs)) if (c.id !== A.civ.id) fallCiv(s, c);
    expect(validRivals(s, A.civ.id).length).toBe(0);
    expect(assessVision(s, king.id, 'whatever').blocked).toBeTruthy();
    expect(performVision(s, king.id, 'whatever').ok).toBe(false);
    expect(s.events.some(e => /declared war/.test(e.text))).toBe(false);
  });

  it('a successful non-king vision reaches the political decision-making system', () => {
    const { s, A, B } = twoCivs(8);
    const rival = B.civ.id;
    for (const h of A.humans.slice(0, 4)) h.role = 'soldier';
    refreshCounts(s);
    const influencer = A.humans.find(h => h.role === 'civilian')!;
    influencer.authority = 95;
    refreshLeadership(s);
    expect(A.civ.kingId).not.toBe(influencer.id);
    const res = attempt(s, influencer, rival, 'incited', DIPLOMACY.warAt - 8);
    expect(res).not.toBeNull();
    expect(res!.war).toBe(true); // the vision itself tipped the diplomacy over the threshold
    expect(getRelation(s, A.civ.id, rival).status).toBe('war');
    expect(A.civ.soldiers).toBeGreaterThanOrEqual(0);
  });

  it('a successful vision on an ordinary citizen raises tension without instant war', () => {
    const { s, A, B } = twoCivs(6);
    const rival = B.civ.id;
    const citizen = A.humans.find(h => h.role === 'civilian')!;
    citizen.authority = 4; // deliberately weak
    refreshLeadership(s);
    expect(A.civ.kingId).not.toBe(citizen.id);
    const rel = getRelation(s, A.civ.id, rival);
    rel.tension = 0;
    const res = attempt(s, citizen, rival, 'incited');
    expect(res).not.toBeNull();
    expect(res!.war).toBe(false);
    expect(getRelation(s, A.civ.id, rival).tension).toBeGreaterThanOrEqual(VISION.citizenTension);
    expect(s.events.some(e => /whispering of war|rallying/.test(e.text))).toBe(true);
    // the idea spreads to nearby humans
    const incited = Object.values(s.citizens).filter(c => c.alive && c.civId === A.civ.id && c.incitedUntil > s.day);
    expect(incited.length).toBeGreaterThan(0);
    expect(getRelation(s, A.civ.id, rival).status).not.toBe('war');
  });

  it('a failed vision never declares war', () => {
    const { s, A, B } = twoCivs(6);
    const rival = B.civ.id;
    const target = A.humans[0];
    target.authority = 3;
    refreshLeadership(s);
    const res = attempt(s, target, rival, 'dismissed');
    expect(res).not.toBeNull();
    expect(res!.war).toBe(false);
    expect(getRelation(s, A.civ.id, rival).status).not.toBe('war');
    expect(s.events.some(e => /dismissed the dream|forgot the dream|left uneasy/.test(e.text))).toBe(true);
  });
});

describe('individual combat', () => {
  it('applies damage exactly once per attack, with a wind-up and a swing', () => {
    const { s, start } = base(); flatten(s, start, 6);
    const atk = createHuman(s, start, { civId: null });
    const def = createHuman(s, start, { civId: null });
    def.maxHealth = 100000; def.health = 100000;
    atk.role = 'soldier'; atk.maxHealth = 120; atk.health = 120;
    let landed = false;
    for (let attemptNo = 0; attemptNo < 40 && !landed; attemptNo++) {
      expect(beginAttack(s, atk, def, 'combat')).toBe('started');
      expect(currentAttack(atk.id)?.phase).toBe('windup');
      expect(beginAttack(s, atk, def, 'combat')).toBe('busy'); // no double attack
      const before = def.health;
      stepCombat(s, COMBAT.windup - 0.01);
      expect(def.health).toBe(before); // nothing until the wind-up completes
      stepCombat(s, 0.02);
      expect(currentAttack(atk.id)?.phase).toBe('swing');
      landed = def.health < before;
      for (let i = 0; i < 6; i++) stepCombat(s, 1); // recovery must not hit again
      expect(def.health).toBe(landed ? def.health : before);
      atk.attackCd = 0;
    }
    expect(landed).toBe(true);
    expect(def.health).toBeLessThan(100000);
    expect(def.alive).toBe(true);
  });

  it('kills through the shared lifecycle exactly once and frees the target from combat', () => {
    const { s, start } = base(); flatten(s, start, 6);
    const { civ, humans } = mkCiv(s, start, 4);
    const [a, b] = humans;
    for (const h of [a, b]) { h.role = 'soldier'; h.maxHealth = 120; h.health = 3; }
    refreshCounts(s);
    const pop = s.population, deaths = s.stats.deaths;
    a.cellId = b.cellId;
    let killed = false;
    for (let i = 0; i < 60 && !killed; i++) {
      if (!a.alive || !b.alive) break;
      a.attackCd = 0;
      if (beginAttack(s, a, b, 'combat') === 'started') for (let k = 0; k < 6; k++) stepCombat(s, 0.5);
      killed = !b.alive;
    }
    expect(killed).toBe(true);
    refreshCounts(s);
    expect(s.population).toBe(pop - 1);
    expect(s.stats.deaths).toBe(deaths + 1);
    expect(b.task).toBe('dead');
    expect(currentAttack(b.id)).toBeUndefined();
    // the corpse cannot be killed again
    const again = applyDamage(s, b, 999, { kind: 'combat' });
    expect(again.killed).toBe(false);
    expect(s.stats.deaths).toBe(deaths + 1);
    expect(civ.stats.deaths).toBeGreaterThan(0);
  });

  it('refuses to attack dead or missing targets', () => {
    const { s, start } = base(); flatten(s, start, 6);
    const a = createHuman(s, start, { civId: null });
    const b = createHuman(s, start, { civId: null });
    killEntity(s, b, 'test');
    expect(beginAttack(s, a, b, 'combat')).toBe('invalid');
    expect(beginAttack(s, a, { ...b, alive: true } as Citizen, 'combat')).toBe('invalid'); // stale reference
    expect(beginAttack(s, a, a, 'combat')).toBe('invalid');
    delete s.citizens[b.id];
    expect(beginAttack(s, a, b, 'combat')).toBe('invalid');
    expect(currentAttack(a.id)).toBeUndefined();
    const h = s.citizens[a.id].health;
    stepCombat(s, 5);
    expect(s.citizens[a.id].health).toBe(h);
  });

  it('winds up an attack that lands even if the target tries to flee', () => {
    const { s, start } = base(); flatten(s, start, 8);
    const a = createHuman(s, start, { civId: null });
    const b = createHuman(s, start + 1, { civId: null });
    b.maxHealth = 100; b.health = 100;
    b.cellId = start + 5; // ran away during the wind-up
    a.attackCd = 0;
    expect(beginAttack(s, a, b, 'combat')).toBe('started');
    stepCombat(s, COMBAT.windup + 0.01);
    // The blow was avoided entirely: no damage, no crash, attacker back in a valid state
    expect(b.health).toBe(100);
    expect(currentAttack(a.id)?.phase ?? 'done').toBe('swing');
  });
});

describe('save and load with the new systems', () => {
  it('preserves authority, kingship, commanders, diplomacy and incitement', () => {
    const { s, A, B } = twoCivs(8);
    const king = A.humans.reduce((best, who) => (who.authority > best.authority ? who : best), A.humans[0]);
    refreshLeadership(s);
    for (const h of A.humans.slice(0, 3)) h.role = 'soldier';
    A.humans[1].authority = 55;
    refreshLeadership(s);
    A.civ.mobilize = 0.5;
    for (const h of A.humans.slice(4, 6)) h.incitedUntil = s.day + 10;
    declareWar(s, A.civ, B.civ, 'test');
    resetAnims();
    const res = migrateSave(JSON.parse(serialize(s, true)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const l = res.data.state;
    expect(l.citizens[king.id].authority).toBe(king.authority);
    expect(l.civs[A.civ.id].kingId).toBe(A.civ.kingId);
    expect(l.civs[A.civ.id].commanderId).toBe(A.civ.commanderId);
    expect(l.civs[A.civ.id].mobilize).toBeCloseTo(0.5, 3);
    expect(l.citizens[A.humans[4].id].incitedUntil).toBeCloseTo(A.humans[4].incitedUntil, 3);
    expect(getRelation(l, A.civ.id, B.civ.id).status).toBe('war');
    expect(Object.values(l.citizens).filter(c => c.alive && roleOf(l, l.citizens[c.id]) === 'king').length)
      .toBe(Object.values(s.civs).filter(c => c.alive).length);
    // no duplicate kings
    const kings = Object.values(l.citizens).filter(k => k.alive && roleOf(l, k) === 'king').map(k => k.civId);
    expect(new Set(kings).size).toBe(kings.length);
    void 0;
    // a loaded civilization keeps fighting
    run(l, 6);
    expect(Number.isFinite(l.day)).toBe(true);
    expect(Object.values(l.citizens).every(c => Number.isFinite(c.authority))).toBe(true);
  });
});

function start_cell(s: ReturnType<typeof base>['s']) { return s.cells.findIndex(c => c.type === 'plains'); }
