// Divine Vision panel: enter a human's dream and plant the seeds of war.

import { useEffect, useState } from 'react';
import { useGame } from '../game/store';
import { VISION, POWERS, AUTHORITY, DIPLOMACY, MILITARY } from '../game/config';
import { cooldownLeft } from '../game/powers';
import { roleOf } from '../game/authority';
import { fmtDate } from '../game/util';
import { C, Btn, SpritePreview, Chip, PixelIcon } from './common';

const ROLE_LABEL: Record<string, string> = { king: 'King', commander: 'Commander', citizen: 'Citizen' };

/** Short atmospheric dream sequence: a drifting eye, stars and a purple vignette. */
function DreamSequence({ name }: { name: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1500);
    const t2 = setTimeout(() => setPhase(2), 2600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  if (phase >= 2) return null;
  return (
    <div className="rounded-lg overflow-hidden relative" style={{ height: 132, background: 'radial-gradient(circle at 50% 45%, #1b1233 0%, #0b0817 70%)' }}>
      <style>{`
        @keyframes lg-drift { 0% { transform: translate(-50%, -46%) scale(0.92); } 50% { transform: translate(-50%, -54%) scale(1.06); } 100% { transform: translate(-50%, -46%) scale(0.92); } }
        @keyframes lg-twinkle { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
        @keyframes lg-fade { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      {[...Array(14)].map((_, i) => (
        <span key={i} style={{
          position: 'absolute', left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%`, width: 3, height: 3,
          background: i % 3 === 0 ? '#fff' : '#d5bcff', opacity: 0.6,
          animation: `lg-twinkle ${1.2 + (i % 5) * 0.4}s ease-in-out ${i * 0.11}s infinite`,
        }} />
      ))}
      <div style={{ position: 'absolute', left: '50%', top: '50%', animation: 'lg-drift 3.2s ease-in-out infinite' }}>
        <PixelIcon name="vision" size={64} selected />
      </div>
      <div className="absolute inset-x-0 bottom-0 p-2 text-center" style={{ animation: 'lg-fade .8s ease' }}>
        <div style={{ color: '#d5bcff', fontSize: 11 }}>
          {phase === 0 ? `${name} sleeps…` : 'The dream takes shape…'}
        </div>
      </div>
    </div>
  );
}

export function VisionPanel() {
  useGame(s => s.simVersion); // live values while the dream plays out
  const world = useGame(s => s.world);
  const targetId = useGame(s => s.visionTargetId);
  const rivalId = useGame(s => s.visionRivalId);
  const setRival = useGame(s => s.setVisionRival);
  const close = useGame(s => s.closeVision);
  const confirm = useGame(s => s.confirmVision);
  const assess = useGame.getState().visionAssessment;
  const rivals = useGame.getState().visionRivals();
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setRevealed(false); }, [targetId]);
  if (!world || !targetId) return null;

  const a = assess();
  const target = world.citizens[targetId];
  if (!target || !a) return null;
  const civ = target.civId ? world.civs[target.civId] : undefined;
  const rival = rivalId ? world.civs[rivalId] : undefined;
  const role = roleOf(world, target);
  const cd = cooldownLeft(world, 'vision');
  const percent = Math.round(a.chance * 100);

  return (
    <div
      className="absolute z-40 rounded-lg overflow-y-auto"
      style={{
        top: 'var(--hud-top)', right: '5rem', width: 'min(23rem, calc(100vw - 6rem))', maxHeight: 'calc(100vh - 13rem)',
        background: C.panel, border: `1px solid ${C.divine}`, boxShadow: `0 0 0 1px rgba(213,188,255,0.15), 0 12px 40px rgba(0,0,0,0.55)`,
      }}
    >
      <div className="flex items-center justify-between px-3 pt-2.5">
        <div className="flex items-center gap-2">
          <PixelIcon name="vision" size={22} selected />
          <span className="text-xs font-semibold tracking-wide" style={{ color: C.divine }}>DIVINE VISION</span>
        </div>
        <button className="text-xs" style={{ color: C.dim }} onClick={close} title="Cancel (Esc)">Cancel ✕</button>
      </div>

      <div className="p-3 pt-2">
        {!revealed ? (
          <DreamSequence name={target.name} />
        ) : (
          <div className="flex gap-3">
            <SpritePreview sprite="human" size={56} tint={civ?.color} />
            <div className="min-w-0 text-xs">
              <div className="text-sm font-semibold truncate">{target.name}</div>
              <div className="flex flex-wrap gap-1 mt-1">
                <Chip color={role === 'king' ? '#ffd24a' : role === 'commander' ? C.warn : C.dim}>{ROLE_LABEL[role]}</Chip>
                <Chip color={civ?.color ?? C.dim}>{civ?.name ?? 'no civilization'}</Chip>
                <Chip>{Math.floor(target.age / 5)} yrs</Chip>
              </div>
              <div className="mt-1.5 font-mono" style={{ color: C.divine }}>Authority {target.authority.toFixed(2)}</div>
            </div>
          </div>
        )}

        {revealed && (
          <>
            <div className="mt-3 text-xs" style={{ color: C.dim }}>Rival to march against</div>
            {rivals.length === 0 && (
              <div className="mt-1 px-2 py-1.5 rounded text-xs" style={{ background: '#1b1417', color: C.danger }}>
                {civ ? `The ${civ.name} have no valid rival — no settlements to attack.` : 'This person belongs to no civilization.'}
              </div>
            )}
            <div className="flex flex-col gap-1 mt-1">
              {rivals.map(r => {
                const active = r.id === rivalId;
                const rel = target.civId ? world.relations[target.civId < r.id ? `${target.civId}|${r.id}` : `${r.id}|${target.civId}`] : undefined;
                return (
                  <button
                    key={r.id} onClick={() => setRival(r.id)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-left"
                    style={{ background: active ? C.raised : 'transparent', border: `1px solid ${active ? C.divine : C.border}` }}
                  >
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: r.color }} />
                    <span className="flex-1 text-xs">the {r.name}</span>
                    <span style={{ fontSize: 10, color: rel?.status === 'war' ? C.danger : C.dim }}>
                      {rel ? rel.status : 'unknown'} · tension {Math.round(rel?.tension ?? 0)}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded p-2" style={{ background: C.raised }}>
              <div className="flex items-center justify-between">
                <span style={{ color: C.dim, fontSize: 11 }}>Chance the dream leads to war</span>
                <span className="font-mono text-sm" style={{ color: a.guaranteed ? '#ffd24a' : percent >= 50 ? C.nature : C.warn }}>
                  {a.blocked ? '—' : a.guaranteed ? '100%' : `${percent}%`}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: C.border }}>
                <div className="h-full" style={{ width: `${a.blocked ? 0 : a.guaranteed ? 100 : percent}%`, background: a.guaranteed ? '#ffd24a' : 'linear-gradient(to right, #8b5cf6, #D5BCFF)' }} />
              </div>
              <div className="mt-2 flex flex-col gap-0.5" style={{ fontSize: 10 }}>
                {a.factors.map((f, i) => (
                  <div key={i} className="flex justify-between">
                    <span style={{ color: C.dim }}>{f.label}</span>
                    <span className="font-mono" style={{ color: f.delta > 0 ? C.nature : f.delta < 0 ? C.danger : C.dim }}>
                      {f.delta > 0 ? '+' : ''}{f.delta === 0 ? '—' : `${Math.round(f.delta * 100)}%`}
                    </span>
                  </div>
                ))}
              </div>
              {role === 'king' && !a.blocked && (
                <div className="mt-2" style={{ fontSize: 10, color: '#ffd24a' }}>
                  {target.name} rules the {civ?.name}. A king’s dream does not fail — war is certain once confirmed.
                </div>
              )}
              {role !== 'king' && !a.blocked && (
                <div className="mt-2" style={{ fontSize: 10, color: C.dim }}>
                  {role === 'commander'
                    ? 'A commander will mobilize soldiers and pressure the throne.'
                    : target.authority >= AUTHORITY.influential
                      ? 'An influential voice will rally others and raise tension.'
                      : 'An ordinary citizen can only spread rumours — the odds are low.'}
                  {' '}Tension now {Math.round(target.civId && rivalId ? world.relations[target.civId < rivalId ? `${target.civId}|${rivalId}` : `${rivalId}|${target.civId}`]?.tension ?? 0 : 0)}/{DIPLOMACY.warAt} · war at {DIPLOMACY.warAt}.
                </div>
              )}
              {a.blocked && <div className="mt-2" style={{ fontSize: 11, color: C.danger }}>{a.blocked}</div>}
            </div>

            <div className="flex items-center justify-between mt-3 gap-2">
              <span style={{ fontSize: 10, color: C.dim }}>
                ⚡{POWERS.vision.cost} · {cd > 0 ? `recharging ${cd.toFixed(1)}h` : `cooldown ${POWERS.vision.cooldown}h`}
                <br />Vision pressure fades over ~{Math.round(VISION.mobilizeAmount / VISION.mobilizeDecayPerDay)} days.
              </span>
              <div className="flex gap-1.5">
                <Btn onClick={close}>Leave the dream</Btn>
                <Btn primary onClick={confirm} disabled={!!a.blocked || !rivalId}>Plant the Seeds of War</Btn>
              </div>
            </div>
            {civ && rival && (
              <div className="mt-2 text-center" style={{ fontSize: 10, color: C.dim }}>
                the {civ.name} <span style={{ color: C.divine }}>vs</span> the {rival.name}
                {' '}· needs {MILITARY.minSoldiersForWar}+ soldiers to declare
              </div>
            )}
          </>
        )}
        {!revealed && (
          <div className="flex justify-end mt-2">
            <Btn primary onClick={() => setRevealed(true)}>Look closer</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

/** A short in-world reminder of the last vision, shown in the History panel. */
export function visionHistory(world: import('../game/types').WorldState, limit = 4) {
  return world.events.filter(e => e.category === 'divine' && /vision|dream/i.test(e.text)).slice(-limit).reverse()
    .map(e => ({ day: fmtDate(e.day), text: e.text }));
}
