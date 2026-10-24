// Floating inspector for the selected person, creature, building or terrain tile.

import { useGame } from '../game/store';
import { SPECIES } from '../game/species';
import { lifeStage } from '../game/lifecycle';
import { roleOf } from '../game/authority';
import { BUILDING_LABEL } from '../game/buildings';
import { fmtDate } from '../game/util';
import type { Citizen, Creature, Living, WorldState } from '../game/types';
import { C, Bar, SpritePreview, Chip, TASK_LABEL, fmtAge, Btn } from './common';

const ROLE_LABEL: Record<string, string> = { king: 'King', commander: 'Commander', citizen: 'Citizen' };
const ROLE_COLOR: Record<string, string> = { king: '#ffd24a', commander: C.warn, citizen: C.dim };

const TERRAIN_LABEL: Record<string, string> = {
  deepOcean: 'Deep ocean', shallowOcean: 'Shallow ocean', beach: 'Beach', plains: 'Plains', forest: 'Forest', mountain: 'Mountain', fertile: 'Fertile land',
};

function nameOf(w: WorldState, id: string): string {
  const e = w.citizens[id];
  return e ? `${e.name}${e.alive ? '' : ' †'}` : 'unknown';
}

function spriteFor(e: Living): string {
  if (e.species !== 'human') return e.species;
  const c = e as Citizen;
  if (c.role === 'soldier') return 'soldier';
  const st = lifeStage(e);
  return st === 'child' ? 'child' : st === 'elder' ? 'elder' : c.gender === 'f' ? 'human_f' : 'human';
}

export function Inspector() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const tool = useGame(s => s.tool);
  const id = useGame(s => s.selectedEntityId);
  const cellId = useGame(s => s.selectedCellId);
  const setSelected = useGame(s => s.setSelected);
  const selectCiv = useGame(s => s.selectCiv);
  const setPanelTab = useGame(s => s.setPanelTab);
  if (!world || tool !== 'select') return null;

  const box = (children: React.ReactNode) => (
    <div className="absolute z-20 rounded-lg p-3 text-xs left-2 right-2 sm:left-auto sm:right-20 sm:w-72 max-h-[55vh] overflow-y-auto" style={{ bottom: '8.2rem', background: C.panel, border: `1px solid ${C.border}`, color: C.text }}>
      <button className="absolute top-2 right-2" style={{ color: C.dim }} onClick={() => setSelected(null, null)} title="Close">✕</button>
      {children}
      {cellId !== null && <div className="mt-2"><Btn onClick={() => useGame.getState().focusOn(cellId,id)}>Focus here</Btn></div>}
    </div>
  );

  const ent: Living | undefined = id ? world.citizens[id] ?? world.creatures[id] : undefined;
  if (ent) {
    const sp = SPECIES[ent.species];
    const civ = ent.species === 'human' ? world.civs[(ent as Citizen).civId ?? ''] : undefined;
    const hc = ent as Citizen;
    const stage = lifeStage(ent);
    const role = ent.species === 'human' ? roleOf(world, hc) : 'citizen';
    const home = hc.homeId ? world.buildings[hc.homeId] : undefined;
    const cr = ent as Creature;
    return box(
      <>
        <div className="flex gap-3">
          <SpritePreview sprite={spriteFor(ent)} size={56} tint={civ?.color} />
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{ent.name}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              <Chip color={sp.intelligent ? C.nature : C.dim}>{sp.singular}</Chip>
              <Chip>{stage}</Chip>
              {ent.species === 'human' && (
                <Chip color={ROLE_COLOR[role]}>{ROLE_LABEL[role]}{hc.role === 'soldier' && role !== 'king' && role !== 'commander' ? ' · soldier' : ''}</Chip>
              )}
              <Chip>{fmtAge(ent)}</Chip>
            </div>
          </div>
        </div>
        {ent.species === 'human' && (
          <div className="mt-2 rounded p-2" style={{ background: C.raised }}>
            <div className="flex justify-between items-center">
              <span style={{ color: C.dim }}>Authority</span>
              <span className="font-mono" style={{ color: role === 'king' ? '#ffd24a' : C.divine, fontSize: 13 }}>{hc.authority.toFixed(2)}</span>
            </div>
            {hc.incitedUntil > world.day && <div style={{ color: C.warn, fontSize: 10 }}>Stirring for war after a divine vision</div>}
          </div>
        )}
        {!ent.alive ? (
          <div className="mt-2 p-2 rounded" style={{ background: '#1b1417', color: C.danger }}>
            Deceased {ent.deathDay !== undefined ? fmtDate(ent.deathDay) : ''} — {ent.deathCause ?? 'unknown cause'}.
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            <Bar value={ent.health / ent.maxHealth} color={C.nature} label="Health" />
            {sp.hungerRate > 0 && <Bar value={1 - ent.hunger} color={C.warn} label="Fed" />}
            {ent.species === 'human' && <Bar value={ent.energy} color="#7cc8ff" label="Energy" />}
            <div style={{ color: C.dim }}>Activity: <span style={{ color: C.divine }}>{TASK_LABEL[ent.task]}</span></div>
          </div>
        )}
        <div className="mt-2 flex flex-col gap-0.5" style={{ color: C.dim }}>
          {civ && (
            <div>Civilization: <button style={{ color: civ.color }} onClick={() => { selectCiv(civ.id); setPanelTab('civs'); }}>{civ.name}</button></div>
          )}
          {ent.species === 'human' && <div>Home: {home ? BUILDING_LABEL[home.type] : 'none'}</div>}
          {ent.species === 'human' && role === 'king' && <div style={{ color: '#ffd24a' }}>Ruler of {civ?.name ?? 'a wandering people'} — the crown follows the highest authority.</div>}
          {ent.species === 'human' && role === 'commander' && <div style={{ color: C.warn }}>Commands the soldiers of {civ?.name}.</div>}
          {ent.partnerId && <div>Partner: {nameOf(world, ent.partnerId)}</div>}
          {ent.parentIds.length > 0 && <div>Parents: {ent.parentIds.map(p => nameOf(world, p)).join(' & ')}</div>}
          {ent.childIds.length > 0 && <div>Children: {ent.childIds.slice(0, 6).map(c => nameOf(world, c)).join(', ')}{ent.childIds.length > 6 ? '…' : ''}</div>}
          {ent.species !== 'human' && <div>Habitat: {sp.habitatText}{cr.packId ? ' · pack' : ''}</div>}
        </div>
      </>
    );
  }

  const b = id ? world.buildings[id] : undefined;
  if (b) {
    const civ = b.civId ? world.civs[b.civId] : undefined;
    const st = b.settlementId ? world.settlements[b.settlementId] : undefined;
    return box(
      <>
        <div className="text-sm font-semibold">{BUILDING_LABEL[b.type]}</div>
        <div style={{ color: C.dim }}>{st ? st.name : ''}{civ ? <> · <span style={{ color: civ.color }}>{civ.name}</span></> : ''}</div>
        <div className="mt-2 flex flex-col gap-1">
          {!b.built && <Bar value={b.progress} color={C.divine} label="Built" />}
          <Bar value={b.health / b.maxHealth} color={C.nature} label="Sturdy" />
          {b.type === 'farm' && b.built && <Bar value={b.cropStage ?? 0} color="#8ac054" label="Crop" />}
        </div>
        <div className="mt-2" style={{ color: C.dim }}>
          {b.type === 'shelter' && 'Basic housing for 2 people.'}
          {b.type === 'house' && 'Comfortable housing for 4 people.'}
          {b.type === 'farm' && 'Grows crops that feed the settlement; suffers in drought.'}
          {b.type === 'storage' && 'Raises the civilization’s resource capacity.'}
          {b.type === 'communal' && 'The settlement’s heart — defenders fight better nearby.'}
          {b.capacity > 0 && <div>Residents: {b.residents.map(r => nameOf(world, r)).join(', ') || 'none'} ({b.residents.length}/{b.capacity})</div>}
        </div>
      </>
    );
  }

  if (cellId !== null && world.cells[cellId]) {
    const c = world.cells[cellId];
    const owner = world.territory[cellId];
    const civ = Object.values(world.civs).find(x => x.idx === owner);
    return box(
      <>
        <div className="text-sm font-semibold">{TERRAIN_LABEL[c.type]}</div>
        <div style={{ color: C.dim }}>{civ ? <>Territory of <span style={{ color: civ.color }}>{civ.name}</span></> : 'Unclaimed land'}</div>
        <div className="mt-2 flex flex-col gap-1">
          <Bar value={c.fertility} color={C.nature} label="Fertile" />
          <Bar value={c.moisture} color="#7cc8ff" label="Moisture" />
          <Bar value={c.grass} color="#8ac054" label="Grass" />
          {c.crater > 0.1 && <Bar value={c.crater} color={C.warn} label="Crater" />}
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {c.trees > 0 && <Chip>{c.trees} trees</Chip>}
          {c.stone > 0 && <Chip>{c.stone} stone</Chip>}
          {c.drought > 0.3 && <Chip color={C.warn}>drought</Chip>}
          {c.crater >= 0.5 && <Chip color={C.danger}>cannot build</Chip>}
        </div>
        <div className="mt-2"><Btn onClick={() => setSelected(null, null)}>Clear</Btn></div>
      </>
    );
  }
  return null;
}
