// Core UI components for LITTLE GOD

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, type PanelTab } from '../game/store';
import type { ToolId, Speed, SpeciesId } from '../game/types';
import { POWERS, FIRST_LIFE, AGE_UNIT_DAYS } from '../game/config';
import { SPECIES, SPECIES_ORDER } from '../game/species';
import { cooldownLeft, canPlaceSpecies } from '../game/powers';
import { importSave, downloadSave, hasSave } from '../game/persistence';
import { fmtDate } from '../game/util';
import { lifeStage } from '../game/lifecycle';
import { isWaterType } from '../game/world';
import { hover } from '../rendering/shared';
import { unlockAudio } from '../audio';
import { C, Btn, Row, SectionTitle, Chip, TASK_LABEL, fmtAge, SPRITE_FOR, SpritePreview, PixelIcon, CrownIcon } from './common';
import { CivTab } from './CivPanel';
import { WorldOptions } from './WorldOptions';
import { DEFAULT_WORLD, type WorldOptions as Options, humanCapacity, speciesCapacity } from '../game/scale';

// ============ Icons ============
// Hand-authored pixel-art icons (see src/rendering/icons.ts). No CSS-drawn or Unicode glyphs.
const ICON_KEY: Record<ToolId, string> = {
  select: 'inspect', life: 'life', forge: 'forge', nature: 'nature', rain: 'rain',
  lightning: 'lightning', terraform: 'terraform', meteor: 'meteor', vision: 'vision',
};
export const WAR_ICON = 'war';

// ============ Top bar ============
export function TopBar() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const speed = useGame(s => s.speed);
  const setSpeed = useGame(s => s.setSpeed);
  const renameWorld = useGame(s => s.renameWorld);
  const setShowMenu = useGame(s => s.setShowMenu);
  const setShowHelp = useGame(s => s.setShowHelp);
  const muted = useGame(s => s.muted);
  const setMuted = useGame(s => s.setMuted);
  const saveState = useGame(s => s.saveState);
  const lastSavedAt = useGame(s => s.lastSavedAt);
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 5000); return () => clearInterval(t); }, []);
  if (!world) return null;

  const ago = lastSavedAt ? Math.max(0, Math.round((Date.now() - lastSavedAt) / 1000)) : null;
  const weatherColor = world.weather === 'drought' ? C.warn : world.weather === 'rain' ? '#7cc8ff' : C.text;
  const wars = Object.values(world.relations).filter(r => r.status === 'war').length;

  return (
    <div className="world-topbar absolute top-0 left-0 right-0 z-20 pointer-events-none">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 pointer-events-auto" style={{ background: 'linear-gradient(to bottom, rgba(9,11,16,0.9), rgba(9,11,16,0))' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-2 h-2 rounded-full" style={{ background: C.divine, boxShadow: `0 0 8px ${C.divine}` }} />
            <span className="font-semibold tracking-wider text-sm">LITTLE GOD</span>
          </div>
          <div className="h-4 w-px" style={{ background: C.border }} />
          <input
            type="text" value={world.name} onChange={e => renameWorld(e.target.value)} aria-label="World name" maxLength={24}
            className="bg-transparent text-sm font-medium focus:outline-none border-b border-transparent focus:border-[#D5BCFF] px-1 min-w-0"
            style={{ color: C.text, width: 150 }}
          />
        </div>
        <div className="flex items-center gap-3 text-xs flex-wrap">
          <button
            onClick={() => setSpeed(speed === 0 ? 1 : 0)} title="Pause / resume (Space)"
            className="px-2.5 py-1 rounded font-medium" style={{ background: speed === 0 ? C.divine : C.panel, color: speed === 0 ? C.bg : C.text, border: `1px solid ${C.border}` }}
          >{speed === 0 ? '▶ Resume' : '❚❚ Pause'}</button>
          <span className="font-mono" title="World age">Year {Math.floor(world.day / 365) + 1} · Day {Math.floor(world.day % 365) + 1}</span>
          <span style={{ color: C.nature }} className="font-semibold hidden sm:inline">{world.era}</span>
          <span style={{ color: weatherColor }} className="hidden sm:inline">{world.weather === 'clear' ? 'Clear' : world.weather === 'rain' ? 'Rain' : 'Drought'}{world.dust > 0.15 ? ' · dust' : ''}</span>
          {wars > 0 && <span style={{ color: C.danger }} className="font-semibold">{wars} war{wars > 1 ? 's' : ''}</span>}
          <span className="hidden md:inline" style={{ color: saveState === 'failed' ? C.danger : C.dim }} title="Autosaves every 20 seconds">
            {saveState === 'failed' ? '● Save failed' : ago === null ? '● Not saved yet' : `● Saved ${ago < 5 ? 'just now' : `${ago}s ago`}`}
          </span>
          <button onClick={() => setMuted(!muted)} className="px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.border}`, background: C.panel }} title="Toggle sound">{muted ? 'Sound off' : 'Sound on'}</button>
          <button onClick={() => useGame.getState().overview()} className="px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.border}`, background: C.panel }} title="Return to the whole globe (O)">Overview</button>
          <button onClick={() => setShowHelp(true)} className="px-2 py-1 rounded" style={{ color: C.dim, border: `1px solid ${C.border}`, background: C.panel }} title="Controls & shortcuts (?)">?</button>
          <button onClick={() => setShowMenu(true)} className="px-3 py-1 rounded font-medium" style={{ background: C.panel, border: `1px solid ${C.border}` }}>Menu</button>
        </div>
      </div>
    </div>
  );
}

// ============ Bottom toolbar ============
const TOOL_META: Record<ToolId, { label: string; key: string; desc: string; cost?: number }> = {
  select: { label: 'Inspect', key: 'S', desc: 'Click a person, creature, building or tile to inspect it.' },
  life: { label: 'Create Life', key: 'L', desc: 'Create humans. The first use makes three; settlers found a civilization.', cost: POWERS.life.cost },
  forge: { label: 'Life Forge', key: 'F', desc: 'Forge deer, rabbits, wolves, humans or stone golems.' },
  nature: { label: 'Nature', key: 'N', desc: 'Grow trees and vegetation; restores harvested forests.', cost: POWERS.nature.cost },
  rain: { label: 'Rain', key: 'R', desc: 'Relieve drought and water crops.', cost: POWERS.rain.cost },
  terraform: { label: 'Terraform', key: 'T', desc: 'Raise or lower one tile (cannot reshape beneath buildings).', cost: POWERS.terraform.cost },
  lightning: { label: 'Lightning', key: 'Z', desc: 'Lethal strike: kills at the centre, weaker toward the edge.', cost: POWERS.lightning.cost },
  meteor: { label: 'Meteor', key: 'M', desc: 'Call a meteor or a meteor shower. Craters are permanent scars.', cost: POWERS.meteor.cost },
  vision: { label: 'Divine Vision', key: 'V', desc: 'Enter a human’s dream and plant the idea of war.', cost: POWERS.vision.cost },
};
const GROUPS: ToolId[][] = [['select'], ['life', 'forge'], ['nature', 'rain', 'terraform'], ['lightning', 'meteor'], ['vision']];

function HoverHint() {
  const [text, setText] = useState<{ t: string; bad: boolean } | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const g = useGame.getState();
      const w = g.world;
      let next: { t: string; bad: boolean } | null = null;
      if (w && hover.cell !== null && g.tool !== 'select') {
        const cell = w.cells[hover.cell];
        const water = isWaterType(cell.type);
        if (g.tool === 'forge' || g.tool === 'life') {
          const r = canPlaceSpecies(w, g.tool === 'life' ? 'human' : g.forgeSpecies, hover.cell);
          if (r.reason) next = { t: r.reason, bad: !r.ok };
        } else if (g.tool === 'vision') {
          next = { t: 'Click a living human to enter their dream', bad: false };
        } else if ((g.tool === 'rain' || g.tool === 'nature') && water) next = { t: 'Open water — nothing happens here', bad: true };
        else if (g.tool === 'nature' && cell.type === 'mountain') next = { t: 'Bare rock — nothing will grow', bad: true };
        else if (g.tool === 'terraform' && cell.buildingId) next = { t: 'A building stands here', bad: true };
      }
      setText(prev => (prev?.t === next?.t ? prev : next));
    }, 150);
    return () => clearInterval(id);
  }, []);
  if (!text) return null;
  return <span className="ml-2" style={{ color: text.bad ? C.danger : C.nature }}>· {text.t}</span>;
}

export function BottomToolbar() {
  useGame(s => s.simVersion);
  const tool = useGame(s => s.tool);
  const setTool = useGame(s => s.setTool);
  const world = useGame(s => s.world);
  const speed = useGame(s => s.speed);
  const raise = useGame(s => s.terraformRaise);
  const setRaise = useGame(s => s.setTerraformRaise);
  const forgeSpecies = useGame(s => s.forgeSpecies);
  const meteorMode = useGame(s => s.meteorMode);
  if (!world) return null;

  const meta = TOOL_META[tool];
  const costFor = (t: ToolId): number | undefined => {
    if (t === 'forge') return SPECIES[forgeSpecies].cost;
    if (t === 'meteor') return meteorMode === 'shower' ? POWERS.shower.cost : POWERS.meteor.cost;
    if (t === 'vision') return POWERS.vision.cost;
    if (t === 'life') return world.milestones.firstLife ? SPECIES.human.cost : FIRST_LIFE.cost;
    return TOOL_META[t].cost;
  };
  const cdFor = (t: ToolId): number => {
    const key = t === 'forge' ? `spawn:${forgeSpecies}` : t === 'life' ? 'spawn:human' : t === 'meteor' ? (meteorMode === 'shower' ? 'shower' : 'meteor') : t;
    return cooldownLeft(world, key);
  };
  const cost = costFor(tool);
  const cd = cdFor(tool);

  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none flex justify-center pb-3 px-2">
      <div className="pointer-events-auto flex flex-col items-center gap-1.5 max-w-full">
        <div className="px-3 py-1.5 rounded text-xs max-w-full text-center" style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.dim }}>
          <span style={{ color: C.divine }}>{meta.label}</span> · {meta.desc}
          {cost !== undefined && (
            <span className="ml-2" style={{ color: world.divineEnergy >= cost ? C.nature : C.warn }}>· ⚡ {cost}</span>
          )}
          {cd > 0 && <span className="ml-2" style={{ color: C.warn }}>· recharging {cd.toFixed(1)}h</span>}
          <HoverHint />
        </div>
        <div className="flex items-stretch gap-1 p-1.5 rounded-lg overflow-x-auto max-w-full" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          {GROUPS.map((g, gi) => (
            <div key={gi} className="flex gap-0.5 pr-1 mr-0.5" style={{ borderRight: gi < GROUPS.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              {g.map(t => {
                const active = tool === t;
                const c = costFor(t);
                const can = c === undefined || world.divineEnergy >= c;
                return (
                  <button
                    key={t} onClick={() => setTool(t)} title={`${TOOL_META[t].label} (${TOOL_META[t].key}) — ${TOOL_META[t].desc}`} aria-pressed={active}
                    className="flex flex-col items-center px-2.5 py-1.5 rounded transition-colors shrink-0"
                    style={{
                      background: active ? '#2b2440' : 'transparent',
                      boxShadow: active ? `inset 0 0 0 1px ${C.divine}` : undefined,
                      color: active ? C.divine : can ? C.text : '#5d6675', minWidth: 54,
                    }}
                  >
                    <PixelIcon name={ICON_KEY[t]} size={28} disabled={!can} selected={active} />
                    <span className="text-[10px] mt-0.5 font-medium whitespace-nowrap" style={{ color: active ? C.divine : can ? C.text : '#5d6675' }}>{TOOL_META[t].label}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {tool === 'terraform' && (
            <div className="flex flex-col gap-1 pl-2 justify-center">
              <button onClick={() => setRaise(true)} className="text-xs px-2 py-0.5 rounded" style={{ background: raise ? '#252C38' : 'transparent' }}>Raise ▲</button>
              <button onClick={() => setRaise(false)} className="text-xs px-2 py-0.5 rounded" style={{ background: !raise ? '#252C38' : 'transparent' }}>Lower ▼</button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span className="text-xs" style={{ color: C.dim }}>Divine energy</span>
          <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: C.border }}>
            <div className="h-full rounded-full" style={{ width: `${(world.divineEnergy / world.maxDivineEnergy) * 100}%`, background: 'linear-gradient(to right, #8b5cf6, #D5BCFF)' }} />
          </div>
          <span className="text-xs font-mono" style={{ color: C.divine }}>{Math.floor(world.divineEnergy)}/{world.maxDivineEnergy}</span>
          <span className="text-[10px] font-mono hidden sm:inline" style={{ color: C.dim }}>+{(world.divineRegen * speed).toFixed(1)}/s</span>
        </div>
      </div>
    </div>
  );
}

// ============ Time controls ============
export function TimeControls() {
  const speed = useGame(s => s.speed);
  const setSpeed = useGame(s => s.setSpeed);
  const world = useGame(s => s.world);
  if (!world) return null;
  const speeds: { s: Speed; label: string; hint: string }[] = [
    { s: 0, label: '❚❚', hint: 'Pause (Space)' }, { s: 1, label: '1×', hint: 'Normal (1)' },
    { s: 3, label: '3×', hint: 'Fast (2)' }, { s: 8, label: '8×', hint: 'Very fast (3)' },
  ];
  return (
    <div className="absolute z-20 flex flex-col gap-1 p-1.5 rounded-lg" style={{ top: 'var(--hud-top)', right: '0.75rem', background: C.panel, border: `1px solid ${C.border}` }}>
      {speeds.map(({ s, label, hint }) => (
        <button
          key={s} onClick={() => setSpeed(s)} title={hint} aria-pressed={speed === s}
          className="px-2.5 py-1.5 rounded text-sm font-mono font-semibold transition-colors"
          style={{ background: speed === s ? '#252C38' : 'transparent', color: speed === s ? C.divine : C.dim, minWidth: 44 }}
        >{label}</button>
      ))}
    </div>
  );
}

// ============ Side panel ============
const TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'world', label: 'World' }, { id: 'people', label: 'People' }, { id: 'civs', label: 'Civs' },
  { id: 'history', label: 'History' }, { id: 'powers', label: 'Powers' },
];

export function SidePanel() {
  const panelTab = useGame(s => s.panelTab);
  const setPanelTab = useGame(s => s.setPanelTab);
  const panelOpen = useGame(s => s.panelOpen);
  const setPanelOpen = useGame(s => s.setPanelOpen);
  const world = useGame(s => s.world);
  if (!world) return null;
  return (
    <div className="absolute z-20 flex gap-1 items-start" style={{ top: 'var(--hud-top)', left: '0.75rem' }}>
      <div className="overflow-hidden transition-all" style={{ width: panelOpen ? 'min(21rem, calc(100vw - 6.5rem))' : 0, background: C.panel, border: panelOpen ? `1px solid ${C.border}` : 'none', borderRadius: 8 }}>
        <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
          {TABS.map(t => (
            <button
              key={t.id} onClick={() => setPanelTab(t.id)} className="flex-1 px-1 py-2 text-xs font-medium transition-colors"
              style={{ color: panelTab === t.id ? C.divine : C.dim, background: panelTab === t.id ? C.raised : 'transparent' }}
            >{t.label}</button>
          ))}
        </div>
        <div className="p-3 overflow-y-auto text-xs" style={{ color: C.text, maxHeight: 'calc(100vh - 17rem)', minHeight: 140 }}>
          {panelTab === 'world' && <WorldTab />}
          {panelTab === 'people' && <PeopleTab />}
          {panelTab === 'civs' && <CivTab />}
          {panelTab === 'history' && <HistoryTab />}
          {panelTab === 'powers' && <PowersTab />}
        </div>
      </div>
      <button
        onClick={() => setPanelOpen(!panelOpen)} className="p-2 rounded"
        style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.dim }} title={panelOpen ? 'Collapse panel' : 'Expand panel'}
      >{panelOpen ? '◀' : '▶'}</button>
    </div>
  );
}

function WorldTab() {
  const version = useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const eco = useMemo(() => {
    if (!world) return null;
    let land = 0, grass = 0, dry = 0, scars = 0, trees = 0;
    for (const c of world.cells) {
      if (isWaterType(c.type)) continue;
      land++; grass += c.grass; if (c.drought > 0.4) dry++; if (c.crater > 0.3) scars++; trees += c.trees;
    }
    const avg = grass / Math.max(1, land);
    const label = scars > 12 ? 'Scarred by impacts' : dry / land > 0.3 ? 'Parched' : avg > 0.6 ? 'Lush' : avg > 0.4 ? 'Healthy' : 'Strained';
    return { avg, dry, scars, trees, label };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, Math.floor(version / 15)]);
  if (!world || !eco) return null;
  const alive = Object.values(world.civs).filter(c => c.alive);
  const wars = Object.values(world.relations).filter(r => r.status === 'war');
  const wild = (['deer', 'rabbit', 'wolf', 'golem'] as SpeciesId[]);
  const r = world.resources;
  return (
    <div>
      <Row label="Population" value={`${world.population} / ${humanCapacity(world)}`} tone={world.population === 0 ? 'warn' : 'good'} />
      <Row label="Civilizations" value={alive.length} />
      <Row label="Active wars" value={wars.length} tone={wars.length ? 'bad' : undefined} />
      {wars.map(w => <div key={w.id} style={{ color: C.danger, fontSize: 10 }}>⚔ {world.civs[w.a]?.name} vs {world.civs[w.b]?.name}</div>)}
      <Row label="Housing" value={`${world.housing.used} / ${world.housing.capacity}`} tone={world.housing.used > world.housing.capacity ? 'bad' : undefined} />
      <Row label="Food" value={`${Math.floor(r.food)} / ${r.foodCapacity}`} tone={world.population > 0 && r.food < 5 ? 'bad' : 'good'} />
      <Row label="Wood" value={`${Math.floor(r.wood)} / ${r.woodCapacity}`} />
      <Row label="Stone" value={`${Math.floor(r.stone)} / ${r.stoneCapacity}`} />
      <Row label="Buildings" value={Object.values(world.buildings).filter(b => b.built).length} />

      <SectionTitle>Wildlife</SectionTitle>
      {wild.map(id => (
        <div key={id} className="flex items-center justify-between py-0.5">
          <span className="flex items-center gap-1.5" style={{ color: C.dim }}><span style={{ width: 8, height: 8, background: SPECIES[id].color, borderRadius: 2, display: 'inline-block' }} />{SPECIES[id].label}</span>
          <span className="font-mono">{world.speciesCounts[id]}<span style={{ color: C.dim }}> / {speciesCapacity(world,id)}</span></span>
        </div>
      ))}
      <Row label="Wildlife total" value={wild.reduce((a, id) => a + world.speciesCounts[id], 0)} />

      <SectionTitle>Ecosystem</SectionTitle>
      <Row label="Condition" value={eco.label} tone={eco.label === 'Lush' || eco.label === 'Healthy' ? 'good' : 'warn'} />
      <Row label="Vegetation cover" value={`${Math.round(eco.avg * 100)}%`} />
      <Row label="Weather" value={world.weather} />
      {world.dust > 0.05 && <Row label="Dust in air" value={`${Math.round(world.dust * 100)}%`} tone="warn" />}
      {world.impacts.length > 0 && (
        <>
          <SectionTitle>Recent meteor impacts</SectionTitle>
          {[...world.impacts].reverse().slice(0, 3).map(i => (
            <div key={i.id} style={{ fontSize: 10, color: C.dim }}><span className="font-mono">{fmtDate(i.day)}</span> {i.shower ? 'shower' : 'meteor'} · {i.killed} killed · {i.buildings} buildings</div>
          ))}
        </>
      )}
      <SectionTitle>Planet</SectionTitle>
      <Row label="Size" value={world.generation.size === 'legacy' ? 'Original' : world.generation.size} />
      <Row label="Terrain regions" value={world.cells.length.toLocaleString()} />
      <Row label="Starting landmasses" value={world.generation.inhabitedRegions || 'Original world'} />
      <Row label="Seed" value={world.seed} />
    </div>
  );
}

function PeopleTab() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const selectedId = useGame(s => s.selectedEntityId);
  const setSelected = useGame(s => s.setSelected);
  const setTool = useGame(s => s.setTool);
  const [view, setView] = useState<'living' | 'fallen' | 'wild'>('living');
  if (!world) return null;
  const humans = Object.values(world.citizens);
  const living = humans.filter(c => c.alive);
  const fallen = humans.filter(c => !c.alive).sort((a, b) => (b.deathDay ?? 0) - (a.deathDay ?? 0));
  const wild = Object.values(world.creatures);
  const pick = (id: string, cell: number) => { setTool('select'); setSelected(cell, id); useGame.getState().focusOn(cell, id); };
  return (
    <div>
      <div className="flex gap-1 mb-2">
        <Btn primary={view === 'living'} onClick={() => setView('living')}>Living {living.length}</Btn>
        <Btn primary={view === 'fallen'} onClick={() => setView('fallen')}>Fallen {fallen.length}</Btn>
        <Btn primary={view === 'wild'} onClick={() => setView('wild')}>Wildlife {wild.length}</Btn>
      </div>
      {view === 'living' && living.length === 0 && <div style={{ color: C.dim }}>No citizens alive. Use Create Life to begin.</div>}
      <div className="flex flex-col gap-0.5">
        {view === 'living' && living.slice(0, 60).map(c => {
          const civ = c.civId ? world.civs[c.civId] : undefined;
          return (
            <button key={c.id} onClick={() => pick(c.id, c.cellId)} className="text-left px-2 py-1.5 rounded"
              style={{ background: selectedId === c.id ? C.raised : 'transparent', border: `1px solid ${selectedId === c.id ? C.border : 'transparent'}` }}>
              <div className="flex justify-between items-center">
                <span className="font-medium flex items-center gap-1.5">
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: civ?.color ?? C.dim, display: 'inline-block' }} />{c.name}
                  {c.role === 'soldier' && <span style={{ color: C.danger, fontSize: 9 }}>soldier</span>}
                </span>
                <span style={{ color: C.dim }}>{Math.floor(c.age / AGE_UNIT_DAYS)}y · {lifeStage(c)}</span>
              </div>
              <div className="flex gap-2 mt-0.5" style={{ color: C.dim, fontSize: 10 }}>
                <span>♥ {Math.round((c.health / c.maxHealth) * 100)}</span>
                <span style={{ color: c.hunger > 0.7 ? C.danger : C.dim }}>fed {Math.round((1 - c.hunger) * 100)}</span>
                <span style={{ color: C.divine }}>{TASK_LABEL[c.task]}</span>
              </div>
            </button>
          );
        })}
        {view === 'fallen' && fallen.length === 0 && <div style={{ color: C.dim }}>No one has died yet.</div>}
        {view === 'fallen' && fallen.slice(0, 60).map(c => (
          <button key={c.id} onClick={() => pick(c.id, c.cellId)} className="text-left px-2 py-1.5 rounded" style={{ opacity: 0.8 }}>
            <div className="flex justify-between"><span className="font-medium">{c.name} †</span><span style={{ color: C.dim }}>{fmtAge(c)}</span></div>
            <div style={{ color: C.dim, fontSize: 10 }}>{c.deathDay !== undefined ? fmtDate(c.deathDay) : ''} · {c.deathCause}</div>
          </button>
        ))}
        {view === 'wild' && wild.length === 0 && <div style={{ color: C.dim }}>No wildlife. Try the Life Forge.</div>}
        {view === 'wild' && wild.slice(0, 60).map(c => (
          <button key={c.id} onClick={() => pick(c.id, c.cellId)} className="text-left px-2 py-1.5 rounded flex items-center gap-2"
            style={{ background: selectedId === c.id ? C.raised : 'transparent' }}>
            <SpritePreview sprite={SPRITE_FOR[c.species]} size={24} />
            <span className="flex-1"><span className="font-medium">{c.name}</span> <span style={{ color: C.dim }}>· {TASK_LABEL[c.task]}</span></span>
            <span style={{ color: C.dim, fontSize: 10 }}>♥ {Math.round((c.health / c.maxHealth) * 100)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const CAT_COLOR: Record<string, string> = {
  divine: C.divine, milestone: C.warn, death: C.danger, birth: C.nature, war: '#ff7a6b', civ: '#7cc8ff',
  ecology: '#9ad07a', meteor: '#ff9a5c', species: '#b8e07a', settlement: '#7cc8ff', build: C.text, environment: '#8fb6d9',
};

function HistoryTab() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  if (!world) return null;
  const events = [...world.events].reverse().slice(0, 100);
  if (events.length === 0) return <div style={{ color: C.dim }}>History has not yet begun.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      {events.map(e => {
        const color = CAT_COLOR[e.category] ?? C.text;
        return (
          <div key={e.id} className="pl-2" style={{ borderLeft: `2px solid ${color}` }}>
            <div className="flex justify-between" style={{ color: C.dim, fontSize: 10 }}>
              <span className="font-mono">{fmtDate(e.day)}</span>
              <span className="uppercase tracking-wider" style={{ color }}>{e.category}</span>
            </div>
            <div>{e.text}</div>
          </div>
        );
      })}
    </div>
  );
}

function PowersTab() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const setTool = useGame(s => s.setTool);
  const setForge = useGame(s => s.setForgeSpecies);
  if (!world) return null;
  const list: Array<{ tool: ToolId; label: string; cost: number; cdKey: string; cd: number; desc: string }> = [
    { tool: 'life', label: 'Create Life', cost: world.milestones.firstLife ? SPECIES.human.cost : FIRST_LIFE.cost, cdKey: 'spawn:human', cd: 0, desc: 'Humans' },
    { tool: 'nature', label: 'Nature', cost: POWERS.nature.cost, cdKey: 'nature', cd: POWERS.nature.cooldown, desc: 'Grow forests' },
    { tool: 'rain', label: 'Rain', cost: POWERS.rain.cost, cdKey: 'rain', cd: POWERS.rain.cooldown, desc: 'Water the land' },
    { tool: 'terraform', label: 'Terraform', cost: POWERS.terraform.cost, cdKey: 'terraform', cd: POWERS.terraform.cooldown, desc: 'Reshape a tile' },
    { tool: 'lightning', label: 'Lightning', cost: POWERS.lightning.cost, cdKey: 'lightning', cd: POWERS.lightning.cooldown, desc: 'Lethal strike' },
    { tool: 'meteor', label: 'Meteor', cost: POWERS.meteor.cost, cdKey: 'meteor', cd: POWERS.meteor.cooldown, desc: 'Crater-making impact' },
    { tool: 'meteor', label: 'Meteor shower', cost: POWERS.shower.cost, cdKey: 'shower', cd: POWERS.shower.cooldown, desc: 'Seven impacts' },
    { tool: 'vision', label: 'Divine Vision', cost: POWERS.vision.cost, cdKey: 'vision', cd: POWERS.vision.cooldown, desc: 'Plant the seeds of war' },
  ];
  return (
    <div>
      <div className="mb-2" style={{ color: C.dim }}>Energy {Math.floor(world.divineEnergy)}/{world.maxDivineEnergy}, regenerates {world.divineRegen}/hour of game time — faster when time is sped up.</div>
      {list.map(p => {
        const left = cooldownLeft(world, p.cdKey);
        return (
          <button key={p.label} onClick={() => { if (p.label === 'Meteor shower') useGame.getState().setMeteorMode('shower'); else if (p.tool === 'meteor') useGame.getState().setMeteorMode('single'); setTool(p.tool); }}
            className="w-full flex justify-between items-center py-1.5 text-left" style={{ borderBottom: `1px solid ${C.raised}` }}>
            <span><span className="font-medium">{p.label}</span> <span style={{ color: C.dim }}>· {p.desc}</span></span>
            <span className="font-mono" style={{ color: left > 0 ? C.warn : world.divineEnergy >= p.cost ? C.divine : C.dim }}>
              {left > 0 ? `${left.toFixed(1)}h` : `⚡${p.cost}`}
            </span>
          </button>
        );
      })}
      <SectionTitle>Life Forge</SectionTitle>
      {SPECIES_ORDER.map(id => (
        <button key={id} onClick={() => setForge(id)} className="w-full flex justify-between items-center py-1.5 text-left" style={{ borderBottom: `1px solid ${C.raised}` }}>
          <span><span className="font-medium">{SPECIES[id].label}</span> <span style={{ color: C.dim }}>· places {SPECIES[id].spawnCount}</span></span>
          <span className="font-mono" style={{ color: C.divine }}>⚡{SPECIES[id].cost}</span>
        </button>
      ))}
    </div>
  );
}

// ============ Notifications ============
export function Notifications() {
  const notifications = useGame(s => s.notifications);
  return (
    <div className="absolute z-30 flex flex-col gap-2 pointer-events-none items-center left-1/2 -translate-x-1/2" style={{ bottom: '11.2rem', width: 'min(24rem, 94vw)' }}>
      {notifications.map(n => {
        const color = n.tone === 'good' ? C.nature : n.tone === 'warn' ? C.warn : n.tone === 'bad' ? C.danger : C.text;
        return <div key={n.id} className="px-3 py-2 rounded text-xs" style={{ background: C.panel, border: `1px solid ${C.border}`, color, borderLeft: `3px solid ${color}` }}>{n.text}</div>;
      })}
    </div>
  );
}

/** Compact, live crisis indicator; the final coronation uses the existing notification feed. */
export function SuccessionBanner() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const tutorialDone = useGame(s => s.tutorialDone);
  if (!world) return null;
  const crisis = Object.values(world.civs).find(c => c.alive && c.succession.phase === 'panic');
  if (!crisis) return null;
  return (
    <div className="absolute z-20 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded text-xs"
      style={{ top: tutorialDone ? 'var(--hud-top)' : 'calc(var(--hud-top) + 9rem)', left: '50%', transform: 'translateX(-50%)', background: C.panel, border: `1px solid ${C.warn}`, color: C.warn }}>
      <CrownIcon size={15} /> Succession crisis in the {crisis.name}
    </div>
  );
}

// ============ Tutorial ============
const TUTORIAL_STEPS = [
  { title: 'A quiet world', text: 'Your world is quiet. Pick Create Life and click land on the planet to bring your first people into being.' },
  { title: 'They live on their own', text: 'Your three citizens gather food and wood, build shelters and farms, raise families and found a civilization. Open the People tab to follow them.' },
  { title: 'Divine powers', text: 'Rain and Nature heal the land. Life Forge adds deer, rabbits, wolves and golems. Lightning and Meteors destroy — and leave scars that last.' },
  { title: 'Rival peoples', text: 'Seed a second civilization from the Civs tab. Neighbours compete for land; tension can end in war — or truce.' },
  { title: 'Time is yours', text: 'Speed up time with the controls on the right (keys 1·2·3) and watch generations pass. Space pauses. The world saves itself.' },
];

export function Tutorial() {
  const tutorialDone = useGame(s => s.tutorialDone);
  const step = useGame(s => s.tutorialStep);
  const nextTutorial = useGame(s => s.nextTutorial);
  const skipTutorial = useGame(s => s.skipTutorial);
  const world = useGame(s => s.world);
  const pop = useGame(s => s.world?.population ?? 0);
  useEffect(() => {
    if (step === 0 && pop > 0 && world?.generation.size === 'legacy') { const t = setTimeout(() => nextTutorial(), 600); return () => clearTimeout(t); }
  }, [pop, step, nextTutorial]);
  if (tutorialDone || !world || step >= TUTORIAL_STEPS.length) return null;
  const s = step === 0 && world.generation.size !== 'legacy'
    ? { title: 'A wider world', text: `${world.generation.initialCivilizations} peoples are beginning their own histories. Open Civs and select a nation to fly to its settlement. Overview returns to the full globe.` }
    : TUTORIAL_STEPS[step];
  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-auto" style={{ top: 'var(--hud-top)', width: 'min(26rem, 94vw)' }}>
      <div className="px-4 py-3 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
        <div className="flex justify-between items-center mb-1">
          <div className="text-xs font-semibold" style={{ color: C.divine }}>{s.title}</div>
          <div className="text-[10px]" style={{ color: C.dim }}>{step + 1}/{TUTORIAL_STEPS.length}</div>
        </div>
        <div className="text-sm mb-3" style={{ color: C.text }}>{s.text}</div>
        <div className="flex justify-between items-center">
          <button onClick={skipTutorial} className="text-xs" style={{ color: C.dim }}>Skip tutorial</button>
          <button onClick={nextTutorial} className="px-3 py-1 rounded text-xs font-medium" style={{ background: C.divine, color: C.bg }}>
            {step === TUTORIAL_STEPS.length - 1 ? 'Begin' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Help overlay ============
const SHORTCUTS: Array<[string, string]> = [
  ['Drag', 'Rotate the planet'], ['Wheel / pinch', 'Zoom'], ['Click', 'Inspect or use the selected power'],
  ['Space', 'Pause / resume'], ['1 · 2 · 3', '1× · 3× · 8× speed'], ['Esc', 'Cancel tool / deselect'],
  ['S L F', 'Inspect · Create Life · Life Forge'], ['N R T', 'Nature · Rain · Terraform'],
  ['Z M V', 'Lightning · Meteor · Divine Vision'], ['O', 'Globe overview'], ['?', 'This help'],
];
export function HelpOverlay() {
  const show = useGame(s => s.showHelp);
  const setShow = useGame(s => s.setShowHelp);
  if (!show) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(9,11,16,0.8)' }} onClick={() => setShow(false)}>
      <div className="p-5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}`, minWidth: 300 }} onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-3">Controls</h2>
        {SHORTCUTS.map(([k, d]) => <div key={k} className="flex justify-between gap-6 py-1 text-xs"><span className="font-mono" style={{ color: C.divine }}>{k}</span><span style={{ color: C.dim }}>{d}</span></div>)}
        <div className="mt-3"><Btn onClick={() => setShow(false)}>Close</Btn></div>
      </div>
    </div>
  );
}

// ============ World menu ============
export function WorldMenu() {
  const showMenu = useGame(s => s.showMenu);
  const setShowMenu = useGame(s => s.setShowMenu);
  const newWorld = useGame(s => s.newWorld);
  const saveWorld = useGame(s => s.saveWorld);
  const loadWorld = useGame(s => s.loadWorld);
  const replaceWorld = useGame(s => s.replaceWorld);
  const world = useGame(s => s.world);
  const tutorialDone = useGame(s => s.tutorialDone);
  const pushNotification = useGame(s => s.pushNotification);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'menu' | 'confirm' | 'new'>('menu');
  const [preset, setPreset] = useState<'lush' | 'balanced' | 'harsh'>('balanced');
  const [options, setOptions] = useState<Options>({ ...DEFAULT_WORLD });
  const [seed, setSeed] = useState('');
  useEffect(() => { if (!showMenu) setStage('menu'); }, [showMenu]);
  if (!showMenu) return null;

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = importSave(String(reader.result));
      if (r.data) { replaceWorld(r.data.state, r.data.tutorialDone); pushNotification(r.migrated ? 'Save imported and upgraded.' : 'Save imported.', 'good'); }
      else pushNotification(r.error ?? 'Invalid or incompatible save file.', 'bad');
    };
    reader.onerror = () => pushNotification('The file could not be read.', 'bad');
    reader.readAsText(file);
  };
  const btn = 'px-3 py-2 rounded text-sm font-medium text-left';
  const sty = { background: C.raised, border: `1px solid ${C.border}`, color: C.text };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(9,11,16,0.85)' }} onClick={() => setShowMenu(false)}>
      <div className="p-5 rounded-lg" style={{ background: C.panel, border: `1px solid ${C.border}`, width: 'min(22rem, 94vw)' }} onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-1">World menu</h2>
        {world && <div className="mb-3 text-xs" style={{ color: C.dim }}>{world.name} · seed {world.seed} · {fmtDate(world.day)}</div>}
        {stage === 'menu' && (
          <div className="flex flex-col gap-2">
            <button className={btn} style={sty} onClick={() => saveWorld(true)}>Save now</button>
            <button className={btn} style={sty} disabled={!hasSave()} onClick={() => loadWorld()}>Reload last save</button>
            {world && <button className={btn} style={sty} onClick={() => { downloadSave(world, tutorialDone); pushNotification('Save exported as a JSON file.', 'good'); }}>Export save (download)</button>}
            <button className={btn} style={sty} onClick={() => fileRef.current?.click()}>Import save…</button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f); e.target.value = ''; }} />
            <button className={btn} style={{ ...sty, borderColor: C.warn }} onClick={() => setStage('confirm')}>New world…</button>
            <button className={btn} style={{ ...sty, background: '#252C38' }} onClick={() => setShowMenu(false)}>Close</button>
          </div>
        )}
        {stage === 'confirm' && (
          <div>
            <p className="text-sm mb-3" style={{ color: C.warn }}>Start a new world? Your current world is saved first and can be restored with “Reload last save” until the new world autosaves.</p>
            <div className="flex gap-2">
              <button className={`${btn} flex-1`} style={sty} onClick={() => setStage('menu')}>Cancel</button>
              <button className={`${btn} flex-1`} style={{ background: C.divine, color: C.bg }} onClick={() => { saveWorld(false); setStage('new'); }}>Continue</button>
            </div>
          </div>
        )}
        {stage === 'new' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-xs" style={{ color: C.dim }}>Starting condition</div>
              <div className="flex gap-2 mt-1">
                {(['lush', 'balanced', 'harsh'] as const).map(p => (
                  <button key={p} onClick={() => setPreset(p)} className="px-3 py-1.5 rounded text-xs capitalize" style={{ background: preset === p ? '#252C38' : 'transparent', border: `1px solid ${C.border}`, color: C.text }}>{p}</button>
                ))}
              </div>
            </div>
            <WorldOptions value={options} onChange={setOptions} />
            <div>
              <div className="text-xs" style={{ color: C.dim }}>Seed (optional)</div>
              <input value={seed} onChange={e => setSeed(e.target.value)} placeholder="Random" className="w-full mt-1 px-2 py-1 rounded text-xs" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }} />
            </div>
            <div className="flex gap-2">
              <button className={`${btn} flex-1`} style={sty} onClick={() => setStage('menu')}>Back</button>
              <button className={`${btn} flex-1`} style={{ background: C.divine, color: C.bg }} onClick={() => {
                const n = parseInt(seed, 10);
                newWorld(preset, seed.trim() && Number.isFinite(n) ? n : undefined, options);
              }}>Create</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Start screen ============
export function StartScreen() {
  const world = useGame(s => s.world);
  const newWorld = useGame(s => s.newWorld);
  const loadWorld = useGame(s => s.loadWorld);
  const loadError = useGame(s => s.loadError);
  const [preset, setPreset] = useState<'lush' | 'balanced' | 'harsh'>('balanced');
  const [options, setOptions] = useState<Options>({ ...DEFAULT_WORLD });
  if (world) return null;
  const saved = hasSave();
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-between py-10 px-6 pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(5,7,11,0.7), rgba(5,7,11,0) 35%, rgba(5,7,11,0) 55%, rgba(5,7,11,0.88))' }}>
      <div className="text-center">
        <h1 className="text-4xl font-light tracking-[0.3em]" style={{ color: C.text }}>LITTLE GOD</h1>
        <p className="text-sm mt-2" style={{ color: C.dim }}>Create life. Shape a world. Watch it grow — and fall.</p>
      </div>
      <div className="text-center pointer-events-auto" style={{ maxWidth: 420 }}>
        {loadError && <div className="mb-3 px-3 py-2 rounded text-xs" style={{ background: C.panel, border: `1px solid ${C.danger}`, color: C.danger }}>{loadError}</div>}
        <div className="flex justify-center gap-2 mb-4">
          {(['lush', 'balanced', 'harsh'] as const).map(p => (
            <button key={p} onClick={() => setPreset(p)} className="px-4 py-2 rounded text-xs capitalize" style={{ background: preset === p ? '#252C38' : 'rgba(17,21,29,0.8)', border: `1px solid ${C.border}`, color: preset === p ? C.divine : C.dim }}>{p}</button>
          ))}
        </div>
        <WorldOptions value={options} onChange={setOptions} />
        <div className="flex flex-col gap-2">
          <button onClick={() => { unlockAudio(); newWorld(preset, undefined, options); }} className="px-6 py-3 rounded text-sm font-semibold" style={{ background: C.divine, color: C.bg }}>Create a new world</button>
          {saved && <button onClick={() => { unlockAudio(); loadWorld(); }} className="px-6 py-3 rounded text-sm font-medium" style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text }}>Continue saved world</button>}
        </div>
        <div className="mt-6 text-xs" style={{ color: '#6b7585' }}>Drag to rotate · Scroll to zoom · Click to interact · Space pauses · 1/2/3 speed</div>
      </div>
    </div>
  );
}

// ============ Keyboard shortcuts ============
export function KeyboardHandler() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = useGame.getState();
      if (!g.started) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); g.setSpeed(g.speed === 0 ? 1 : 0); }
      else if (k === '1') g.setSpeed(1);
      else if (k === '2') g.setSpeed(3);
      else if (k === '3') g.setSpeed(8);
      else if (e.key === 'Escape') {
        if (g.showHelp) g.setShowHelp(false);
        else if (g.showMenu) g.setShowMenu(false);
        else if (g.visionTargetId) g.closeVision();
        else { g.setTool('select'); g.setSelected(null, null); }
      }
      else if (k === 's') g.setTool('select');
      else if (k === 'l') g.setTool('life');
      else if (k === 'f') g.setTool('forge');
      else if (k === 'n') g.setTool('nature');
      else if (k === 'r') g.setTool('rain');
      else if (k === 'z') g.setTool('lightning');
      else if (k === 't') g.setTool('terraform');
      else if (k === 'm') g.setTool('meteor');
      else if (k === 'v') g.setTool('vision');
      else if (k === 'o') g.overview();
      else if (e.key === '?') g.setShowHelp(!g.showHelp);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

export { Chip };
