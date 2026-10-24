// Civilization tab: list, details, diplomacy, military controls.

import { useState } from 'react';
import { useGame } from '../game/store';
import { MILITARY, CIV_SEED_COST, DIPLOMACY } from '../game/config';
import { fmtDate } from '../game/util';
import { kingOf } from '../game/authority';
import { settlementsOf, aliveCivs } from '../game/civ';
import { C, Btn, Row, SectionTitle, Chip, CrownIcon } from './common';
import type { Civilization, Relation, WorldState } from '../game/types';

const STATUS_COLOR: Record<Relation['status'], string> = { peace: C.nature, tension: C.warn, war: C.danger, truce: '#7cc8ff' };

function relationsOf(w: WorldState, civ: Civilization): Relation[] {
  return Object.values(w.relations).filter(r => (r.a === civ.id || r.b === civ.id) && w.civs[r.a]?.alive && w.civs[r.b]?.alive);
}

export function CivTab() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const [query, setQuery] = useState('');
  const selId = useGame(s => s.selectedCivId);
  const selectCiv = useGame(s => s.selectCiv);
  const seed = useGame(s => s.seedCivilization);
  const recruit = useGame(s => s.recruit);
  const standDown = useGame(s => s.standDown);
  const setSelected = useGame(s => s.setSelected);
  if (!world) return null;
  const civs = Object.values(world.civs).sort((a, b) => Number(b.alive) - Number(a.alive) || a.idx - b.idx);
  const civ = selId ? world.civs[selId] : undefined;
  const alive = aliveCivs(world).length;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span style={{ color: C.dim }}>{alive} civilization{alive === 1 ? '' : 's'} · {Object.values(world.relations).filter(r => r.status === 'war').length} at war</span>
        <Btn onClick={seed} title={`Seed a new civilization on unclaimed fertile land (${CIV_SEED_COST} ⚡)`}>Seed new (⚡{CIV_SEED_COST})</Btn>
      </div>
      {civs.length === 0 && <div style={{ color: C.dim }}>No civilizations yet. Create humans to found the first one.</div>}
      <input aria-label="Find a civilization" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a civilization..."
        className="w-full px-2 py-1.5 mb-2 rounded text-xs" style={{background:C.bg,border:`1px solid ${C.border}`,color:C.text}} />
      <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 220 }}>
        {civs.filter(c=>c.name.toLowerCase().includes(query.toLowerCase())).map(c => (
          <button
            key={c.id} onClick={() => {
              selectCiv(c.id);
              const st = settlementsOf(world,c.id)[0];
              if (st) useGame.getState().focusOn(st.cellId);
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded text-left"
            style={{ background: c.id === selId ? C.raised : 'transparent', border: `1px solid ${c.id === selId ? C.border : 'transparent'}`, opacity: c.alive ? 1 : 0.55 }}
          >
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
            <span className="flex-1 font-medium truncate">
              {c.name}{c.kingId && c.alive && world.citizens[c.kingId]
                ? <span style={{ color: '#ffd24a', fontSize: 10 }}> <CrownIcon size={11} />{world.citizens[c.kingId].name}</span>
                : null}
            </span>
            {c.alive
              ? <span className="font-mono" style={{ color: C.dim, fontSize: 10 }}>{c.population} people / {c.soldiers} soldiers</span>
              : <Chip color={C.danger}>fallen</Chip>}
          </button>
        ))}
      </div>

      {civ && (
        <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: civ.color }} />
            <span className="text-sm font-semibold">{civ.name}</span>
            <Chip color={civ.alive ? C.nature : C.danger}>{civ.alive ? civ.era : 'Fallen'}</Chip>
          </div>
          <div style={{ color: C.dim, fontSize: 10 }}>
            Founded {fmtDate(civ.founded)}{!civ.alive && civ.fallDay !== undefined ? ` · fell ${fmtDate(civ.fallDay)} — ${civ.fallReason}` : ''}
          </div>

          {civ.alive && (
            <>
              <Row label="Population" value={civ.population} />
              <Row label="King" value={world.citizens[civ.kingId ?? '']
                ? <span><CrownIcon size={11} /> {world.citizens[civ.kingId!].name} ({world.citizens[civ.kingId!].authority.toFixed(2)})</span>
                : 'none'} tone="warn" />
              {civ.succession.phase !== 'stable' && (
                <Row label="Succession" value={`Panic · ${world.citizens[civ.succession.successorId ?? '']?.name ?? 'no heir'} designated`} tone="warn" />
              )}
              <Row label="Commander" value={world.citizens[civ.commanderId ?? ''] ? `${world.citizens[civ.commanderId!].name} (${world.citizens[civ.commanderId!].authority.toFixed(2)})` : 'none'} />
              <Row label="War pressure" value={`${Math.round(civ.mobilize * 100)}%`} tone={civ.mobilize > 0 ? 'warn' : undefined} />
              <button style={{ color: C.divine, fontSize: 10 }} onClick={() => { const k = kingOf(world, civ.id); if (k) { setSelected(k.cellId, k.id); useGame.getState().setTool('select'); useGame.getState().focusOn(k.cellId,k.id); } }}>Show the king on the planet</button>
              <SectionTitle>Settlements</SectionTitle>
              {settlementsOf(world,civ.id).map(st => <button key={st.id} className="block py-1 text-left" style={{color:C.divine}}
                onClick={()=>{ setSelected(st.cellId,null); useGame.getState().focusOn(st.cellId); }}>{st.name} <span style={{color:C.dim}}> / focus</span></button>)}
              <Row label="Territory" value={`${civ.territoryCells} tiles`} />
              <Row label="Military strength" value={`${civ.militaryStrength.toFixed(0)} (${civ.soldiers} soldiers)`} tone={civ.soldiers > 0 ? 'warn' : undefined} />
              <Row label="Housing" value={`${civ.housing.used}/${civ.housing.capacity}`} />
              <Row label="Food / Wood / Stone" value={`${Math.floor(civ.resources.food)} / ${Math.floor(civ.resources.wood)} / ${Math.floor(civ.resources.stone)}`} />
              <Row label="Produced (all time)" value={`${Math.floor(civ.stats.produced.food)}f ${Math.floor(civ.stats.produced.wood)}w ${Math.floor(civ.stats.produced.stone)}s`} />
              <Row label="Births / deaths" value={`${civ.stats.births} / ${civ.stats.deaths}`} />

              <SectionTitle>Diplomacy</SectionTitle>
              {relationsOf(world, civ).length === 0 && <div style={{ color: C.dim }}>No known neighbours.</div>}
              {relationsOf(world, civ).map(r => {
                const other = world.civs[r.a === civ.id ? r.b : r.a];
                return (
                  <div key={r.id} className="py-1" style={{ borderBottom: `1px solid ${C.raised}` }}>
                    <div className="flex items-center justify-between">
                      <button className="font-medium" style={{ color: C.text }} onClick={() => selectCiv(other.id)}>
                        <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: other.color }} />{other.name}
                      </button>
                      <span className="uppercase font-semibold" style={{ color: STATUS_COLOR[r.status], fontSize: 10 }}>{r.status}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 10, color: C.dim }}>
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: C.border }}>
                        <div className="h-full" style={{ width: `${(r.tension / DIPLOMACY.maxTension) * 100}%`, background: STATUS_COLOR[r.status] }} />
                      </div>
                      <span className="font-mono">tension {Math.round(r.tension)}</span>
                    </div>
                    {r.status === 'war' && (
                      <div style={{ fontSize: 10, color: C.danger }}>
                        War since {fmtDate(r.warStart)} · losses: {r.casualties[civ.id] ?? 0} vs {r.casualties[other.id] ?? 0}
                        {' '}<button style={{ color: C.divine }} onClick={() => { const st = settlementsOf(world, other.id)[0]; if (st) setSelected(st.cellId, null); }}>(show enemy)</button>
                      </div>
                    )}
                    {r.status === 'truce' && <div style={{ fontSize: 10, color: '#7cc8ff' }}>Truce until {fmtDate(r.truceUntil)}</div>}
                  </div>
                );
              })}

              <SectionTitle>Military</SectionTitle>
              <div className="flex flex-wrap gap-1.5">
                <Btn onClick={() => recruit(civ.id, 1)} title={`${MILITARY.recruitFood} food + ${MILITARY.recruitWood} wood per soldier`}>Recruit 1</Btn>
                <Btn onClick={() => recruit(civ.id, 5)}>Recruit 5</Btn>
                <Btn onClick={() => standDown(civ.id)} disabled={civ.soldiers === 0}>Stand down</Btn>
              </div>
              <div className="mt-1" style={{ color: C.dim, fontSize: 10 }}>
                Cost: {MILITARY.recruitFood} food + {MILITARY.recruitWood} wood each · at most {Math.round(MILITARY.maxSoldierRatio * 100)}% of adults.
                Soldiers stop civilian work and defend or attack when at war.
              </div>
            </>
          )}

          <SectionTitle>Recent history</SectionTitle>
          {civ.history.length === 0 && <div style={{ color: C.dim }}>Nothing recorded yet.</div>}
          {[...civ.history].reverse().slice(0, 8).map((h, i) => (
            <div key={i} style={{ fontSize: 11 }}><span className="font-mono" style={{ color: C.dim }}>{fmtDate(h.day)}</span> {h.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
