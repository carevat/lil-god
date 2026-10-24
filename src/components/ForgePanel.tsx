// Life Forge (creature creation) and Meteor panels.

import { useGame } from '../game/store';
import { SPECIES, SPECIES_ORDER } from '../game/species';
import { POWERS, METEOR, FIRST_LIFE } from '../game/config';
import { cooldownLeft } from '../game/powers';
import { humanCapacity, speciesCapacity } from '../game/scale';
import { C, SpritePreview, SPRITE_FOR, Btn, Chip } from './common';

export function ForgePanel() {
  useGame(s => s.simVersion);
  const tool = useGame(s => s.tool);
  const species = useGame(s => s.forgeSpecies);
  const setSpecies = useGame(s => s.setForgeSpecies);
  const setTool = useGame(s => s.setTool);
  const world = useGame(s => s.world);
  if (tool !== 'forge' || !world) return null;
  const sp = SPECIES[species];
  const count = world.speciesCounts[species];
  const cap = species === 'human' ? humanCapacity(world) : speciesCapacity(world,species);
  const cd = cooldownLeft(world, `spawn:${species}`);
  const cost = species === 'human' && !world.milestones.firstLife ? FIRST_LIFE.cost : sp.cost;
  const n = species === 'human' && !world.milestones.firstLife ? FIRST_LIFE.count : sp.spawnCount;

  return (
    <div
      className="absolute z-30 rounded-lg overflow-y-auto"
      style={{ top: 'var(--hud-top)', right: '5rem', width: 'min(21rem, calc(100vw - 6rem))', maxHeight: 'calc(100vh - 14rem)', background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-between px-3 pt-2.5">
        <div className="text-xs font-semibold tracking-wide" style={{ color: C.divine }}>LIFE FORGE</div>
        <button className="text-xs" style={{ color: C.dim }} onClick={() => setTool('select')} title="Cancel placement (Esc)">Cancel ✕</button>
      </div>
      <div className="grid grid-cols-5 gap-1 px-3 pt-2">
        {SPECIES_ORDER.map(id => {
          const active = id === species;
          return (
            <button
              key={id} onClick={() => setSpecies(id)}
              className="flex flex-col items-center gap-1 p-1 rounded min-w-0"
              style={{ background: active ? C.raised : 'transparent', border: `1px solid ${active ? C.divine : C.border}` }}
            >
              <SpritePreview sprite={SPRITE_FOR[id]} size={40} />
              <span className="truncate max-w-full" style={{ fontSize: 9, color: active ? C.text : C.dim }}>{id === 'golem' ? 'Golems' : SPECIES[id].label}</span>
              <span className="font-mono" style={{ fontSize: 9, color: C.dim }}>{world.speciesCounts[id]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex gap-3 p-3">
        <SpritePreview sprite={SPRITE_FOR[species]} size={72} />
        <div className="flex-1 min-w-0 text-xs" style={{ color: C.text }}>
          <div className="font-semibold">{sp.label}</div>
          <div className="mt-0.5 leading-snug" style={{ color: C.dim }}>{sp.blurb}</div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Chip color={C.nature}>Habitat: {sp.habitatText}</Chip>
            <Chip color={world.divineEnergy >= cost ? C.divine : C.warn}>Cost ⚡{cost} · places {n}</Chip>
            <Chip>Alive: {count}/{cap}</Chip>
            {sp.spawnCooldownHours > 0 && <Chip color={cd > 0 ? C.warn : C.dim}>{cd > 0 ? `Recharging ${cd.toFixed(1)}h` : `Cooldown ${sp.spawnCooldownHours}h`}</Chip>}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between px-3 pb-3 gap-2">
        <div style={{ fontSize: 11, color: C.dim }}>
          Click valid terrain on the planet to place. <span style={{ color: C.warn }}>Red ring = unsuitable here.</span>
        </div>
        <Btn primary onClick={() => setSpecies(species)} title="Placement mode is active — click the planet">Place {sp.singular.toLowerCase()}</Btn>
      </div>
    </div>
  );
}

export function MeteorPanel() {
  useGame(s => s.simVersion);
  const tool = useGame(s => s.tool);
  const mode = useGame(s => s.meteorMode);
  const setMode = useGame(s => s.setMeteorMode);
  const setTool = useGame(s => s.setTool);
  const world = useGame(s => s.world);
  if (tool !== 'meteor' || !world) return null;
  const key = mode === 'shower' ? 'shower' : 'meteor';
  const p = POWERS[key];
  const cd = cooldownLeft(world, key);
  return (
    <div
      className="absolute z-30 rounded-lg p-3"
      style={{ top: 'var(--hud-top)', right: '5rem', width: 'min(21rem, calc(100vw - 6rem))', background: C.panel, border: `1px solid ${C.border}`, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}
    >
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-wide" style={{ color: '#ff9a5c' }}>METEOR</div>
        <button className="text-xs" style={{ color: C.dim }} onClick={() => setTool('select')}>Cancel ✕</button>
      </div>
      <div className="flex gap-1.5 mt-2">
        <Btn primary={mode === 'single'} onClick={() => setMode('single')}>Single meteor</Btn>
        <Btn primary={mode === 'shower'} onClick={() => setMode('shower')}>Meteor shower</Btn>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <Chip color={world.divineEnergy >= p.cost ? C.divine : C.warn}>Cost ⚡{p.cost}</Chip>
        <Chip>{mode === 'shower' ? `${METEOR.showerCount} impacts within ${METEOR.showerSpread} tiles` : `Blast radius ≈ ${METEOR.radius} tiles`}</Chip>
        <Chip color={cd > 0 ? C.warn : C.dim}>{cd > 0 ? `Recharging ${cd.toFixed(1)}h` : `Cooldown ${p.cooldown}h`}</Chip>
      </div>
      <div className="mt-2 text-xs leading-snug" style={{ color: C.dim }}>
        Click a target: a warning ring appears, then a meteor falls. Impacts kill, destroy buildings and trees, scar the
        land with <b style={{ color: C.text }}>persistent craters</b> and raise dust. Esc cancels before anything is launched.
      </div>
    </div>
  );
}

export function ShowerBanner() {
  useGame(s => s.simVersion);
  const world = useGame(s => s.world);
  const cancel = useGame(s => s.cancelShower);
  const sh = world?.showers[0];
  if (!world || !sh) return null;
  const falling = world.meteors.filter(m => m.showerId === sh.id).length;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-3 py-2 rounded-lg" style={{ top: '3.6rem', background: C.panel, border: `1px solid ${C.border}` }}>
      <span className="text-xs" style={{ color: '#ff9a5c' }}>Meteor shower · {sh.remaining} still to come · {falling} falling</span>
      <Btn onClick={cancel} disabled={sh.remaining === 0}>Cancel remaining</Btn>
    </div>
  );
}
