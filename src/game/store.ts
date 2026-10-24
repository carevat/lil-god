// Zustand store: UI state + the bridge between React and the authoritative simulation state.

import { create } from 'zustand';
import type { WorldState, ToolId, Speed, SpeciesId, Citizen } from './types';
import type { WorldPreset } from './world';
import { findStartingCell, sphereDist } from './world';
import { createNewWorld } from './newWorld';
import { DEFAULT_WORLD, type WorldOptions } from './scale';
import { resetAnims } from './combat';
import { resetParticles } from '../rendering/particles';
import { advanceClock, MAX_FRAME_MS } from './clock';
import { advanceRealtime } from './simulation';
import {
  castSpawn, castNature, castRain, castLightning, castTerraform, castMeteor, castShower,
  cancelShower as cancelShowerSim, castSeedCiv, type PowerResult,
} from './powers';
import { performVision, assessVision, validRivals, suggestRival, type VisionAssessment } from './vision';
import { effectiveCell } from './lifecycle';
import { recruitSoldiers, demobilize, civByIdx } from './civ';
import { POWERS, METEOR, LIGHTNING } from './config';
import { checkPower, spend } from './powers';
import { saveGame, loadGame, clearSave } from './persistence';
import { refreshCounts } from './lifecycle';
import { queueBurst, type BurstKind } from '../rendering/particles';
import { sfx, setAudioMuted } from '../audio';

export interface Effect {
  id: string;
  type: 'rain' | 'lightning' | 'nature' | 'life' | 'terraform' | 'impact' | 'dream' | 'coronation';
  cellId: number;
  createdAt: number;
  duration: number;
  radius: number;
}

export interface Notification { id: string; text: string; createdAt: number; tone: 'info' | 'good' | 'warn' | 'bad' }
export type PanelTab = 'world' | 'people' | 'civs' | 'history' | 'powers';

interface GameState {
  world: WorldState | null;
  started: boolean;
  tool: ToolId;
  forgeSpecies: SpeciesId;
  meteorMode: 'single' | 'shower';
  terraformRaise: boolean;
  selectedCellId: number | null;
  selectedEntityId: string | null;
  selectedCivId: string | null;
  /** Human currently being offered a divine vision (panel open), or null. */
  visionTargetId: string | null;
  /** Civilization chosen as the war target inside the Divine Vision panel. */
  visionRivalId: string | null;
  speed: Speed;
  effects: Effect[];
  notifications: Notification[];
  simVersion: number;
  muted: boolean;
  tutorialDone: boolean;
  tutorialStep: number;
  showMenu: boolean;
  panelTab: PanelTab;
  panelOpen: boolean;
  saveState: 'saved' | 'failed' | 'idle';
  lastSavedAt: number;
  loadError: string | null;
  showHelp: boolean;
  cameraRequest: { serial: number; mode: 'focus' | 'overview'; cellId: number | null; entityId: string | null } | null;
  focusOn: (cellId: number, entityId?: string | null) => void;
  overview: () => void;

  newWorld: (preset?: WorldPreset, seed?: number, options?: WorldOptions) => void;
  loadWorld: () => boolean;
  saveWorld: (manual?: boolean) => void;
  clearWorld: () => void;
  replaceWorld: (w: WorldState, tutorialDone?: boolean) => void;
  setTool: (t: ToolId) => void;
  setSpeed: (s: Speed) => void;
  setForgeSpecies: (s: SpeciesId) => void;
  setMeteorMode: (m: 'single' | 'shower') => void;
  setSelected: (cellId: number | null, entityId?: string | null) => void;
  selectAt: (cellId: number) => void;
  selectCiv: (civId: string | null) => void;
  openVision: (cellId: number) => void;
  setVisionRival: (civId: string | null) => void;
  closeVision: () => void;
  confirmVision: () => void;
  visionAssessment: () => (VisionAssessment & { target?: Citizen; rival?: import('./types').Civilization }) | null;
  visionRivals: () => import('./types').Civilization[];
  usePower: (cellId: number) => void;
  advanceSim: (realDtMs: number) => void;
  renameWorld: (name: string) => void;
  pushNotification: (text: string, tone?: Notification['tone']) => void;
  setShowMenu: (v: boolean) => void;
  setShowHelp: (v: boolean) => void;
  setPanelTab: (t: PanelTab) => void;
  setPanelOpen: (v: boolean) => void;
  setMuted: (v: boolean) => void;
  setTutorialDone: (v: boolean) => void;
  nextTutorial: () => void;
  skipTutorial: () => void;
  setTerraformRaise: (v: boolean) => void;
  recruit: (civId: string, n: number) => void;
  standDown: (civId: string) => void;
  seedCivilization: () => void;
  cancelShower: () => void;
}

let effectCounter = 0;
let simAcc = 0;
let lastBump = 0;
let lastSaveReal = 0;

export const useGame = create<GameState>((set, get) => {
  const addEffect = (type: Effect['type'], cellId: number, duration: number, radius = 1) => {
    const e: Effect = { id: 'fx' + ++effectCounter, type, cellId, createdAt: performance.now(), duration, radius };
    set({ effects: [...get().effects, e] });
  };
  const bump = () => set({ simVersion: get().simVersion + 1 });

  return {
    world: null, started: false, tool: 'select', forgeSpecies: 'deer', meteorMode: 'single', terraformRaise: true,
    selectedCellId: null, selectedEntityId: null, selectedCivId: null, visionTargetId: null, visionRivalId: null, speed: 1,
    effects: [], notifications: [], simVersion: 0, muted: false, tutorialDone: false, tutorialStep: 0,
    showMenu: false, panelTab: 'world', panelOpen: true, saveState: 'idle', lastSavedAt: 0, loadError: null, showHelp: false,
    cameraRequest: null,
    focusOn: (cellId, entityId = null) => set({ cameraRequest: { serial: (get().cameraRequest?.serial ?? 0) + 1, mode: 'focus', cellId, entityId } }),
    overview: () => set({ cameraRequest: { serial: (get().cameraRequest?.serial ?? 0) + 1, mode: 'overview', cellId: null, entityId: null } }),

    newWorld: (preset = 'balanced', seed, options = DEFAULT_WORLD) => {
      const s = seed ?? Math.floor(Math.random() * 1000000);
      const world = createNewWorld(s, preset, options);
      const startCell = Object.values(world.settlements)[0]?.cellId ?? findStartingCell(world.cells, s);
      if (startCell >= 0) world.timeOfDay = (world.cells[startCell].lon / 2 + 1) % 1;
      simAcc = 0;
      resetAnims(); resetParticles(); lastSaveReal = performance.now();
      set({
        world, started: true, speed: 1, tool: 'select', selectedCellId: null,
        selectedEntityId: null, selectedCivId: Object.values(world.civs)[0]?.id ?? null, effects: [], notifications: [], showMenu: false,
        cameraRequest: null, visionTargetId: null, visionRivalId: null,
        tutorialStep: 0, loadError: null, simVersion: get().simVersion + 1, panelTab: 'world',
      });
      get().pushNotification(`${world.name}: ${world.generation.initialCivilizations} peoples across ${world.generation.inhabitedRegions} landmasses.`, 'good');
      sfx('click');
    },

    loadWorld: () => {
      const r = loadGame();
      if (!r) { get().pushNotification('No saved world found.', 'warn'); return false; }
      if (r.error || !r.data) {
        set({ loadError: r.error ?? 'The saved world could not be loaded.' });
        get().pushNotification(r.error ?? 'The saved world could not be loaded.', 'bad');
        return false;
      }
      simAcc = 0;
      resetAnims(); resetParticles();
      set({
        world: r.data.state, started: true, tutorialDone: r.data.tutorialDone,
        tutorialStep: r.data.tutorialDone ? 99 : 0, speed: 1, tool: 'select', effects: [], showMenu: false,
        selectedEntityId: null, selectedCellId: null, selectedCivId: null, cameraRequest: null, visionTargetId: null, visionRivalId: null, loadError: null, simVersion: get().simVersion + 1,
      });
      get().pushNotification(r.migrated ? 'Your world was upgraded to the new version (original kept as a backup).' : 'World loaded.', 'good');
      return true;
    },

    saveWorld: (manual = true) => {
      const w = get().world;
      if (!w) return;
      const ok = saveGame(w, get().tutorialDone);
      lastSaveReal = performance.now();
      set({ saveState: ok ? 'saved' : 'failed', lastSavedAt: ok ? Date.now() : get().lastSavedAt });
      if (manual) get().pushNotification(ok ? 'World saved.' : 'Saving failed — browser storage is full or blocked. Use Export instead.', ok ? 'good' : 'bad');
    },

    clearWorld: () => { clearSave(); set({ world: null, started: false, showMenu: false }); },

    replaceWorld: (w, tutorialDone) => {
      simAcc = 0;
      resetAnims(); resetParticles();
      set({
        world: w, started: true, tutorialDone: tutorialDone ?? get().tutorialDone, effects: [], speed: 1,
        selectedEntityId: null, selectedCellId: null, selectedCivId: null, cameraRequest: null, visionTargetId: null, visionRivalId: null, showMenu: false, simVersion: get().simVersion + 1,
      });
    },

    setTool: (t) => { set({ tool: t, selectedEntityId: t === 'select' ? get().selectedEntityId : null }); sfx('click'); },
    setSpeed: (s) => { set({ speed: s }); sfx('click'); },
    setForgeSpecies: (s) => set({ forgeSpecies: s, tool: 'forge' }),
    setMeteorMode: (m) => set({ meteorMode: m }),
    setSelected: (cellId, entityId = null) => set({ selectedCellId: cellId, selectedEntityId: entityId }),

    selectAt: (cellId) => {
      const w = get().world;
      if (!w) return;
      const best = { id: null as string | null, d: Infinity };
      for (const c of Object.values(w.citizens)) {
        if (!c.alive) continue;
        const d = sphereDist(cellId, effectiveCell(c), w);
        if (d <= 1.2 && d < best.d) { best.id = c.id; best.d = d; }
      }
      for (const c of Object.values(w.creatures)) {
        const d = sphereDist(cellId, effectiveCell(c), w);
        if (d <= 1.2 && d < best.d) { best.id = c.id; best.d = d; }
      }
      for (const b of Object.values(w.buildings)) {
        const d = sphereDist(cellId, b.cellId, w) + 0.3;
        if (d <= 1.0 && d < best.d) { best.id = b.id; best.d = d; }
      }
      const ownerIdx = w.territory[cellId];
      let civId: string | null = civByIdx(w, ownerIdx)?.id ?? null;
      if (best.id) {
        const ent = w.citizens[best.id] ?? w.buildings[best.id];
        if (ent && 'civId' in ent && ent.civId) civId = ent.civId;
      }
      set({
        selectedCellId: cellId, selectedEntityId: best.id, selectedCivId: civId ?? get().selectedCivId,
        panelTab: !best.id && civId ? 'civs' : get().panelTab,
        panelOpen: !best.id && civId ? true : get().panelOpen,
      });
      sfx('click');
    },

    selectCiv: (civId) => set({ selectedCivId: civId }),

    openVision: (cellId) => {
      const w = get().world;
      if (!w) return;
      const err = checkPower(w, 'Divine Vision', POWERS.vision.cost, 'vision');
      if (err) { get().pushNotification(err, 'warn'); sfx('error'); return; }
      let best: Citizen | null = null, bd = 1.8;
      for (const c of Object.values(w.citizens)) {
        if (!c.alive) continue;
        const d = sphereDist(cellId, effectiveCell(c), w);
        if (d <= bd) { bd = d; best = c; }
      }
      if (!best) { get().pushNotification('No one lives here to receive a dream.', 'warn'); sfx('error'); return; }
      const rival = suggestRival(w, best.civId ?? '');
      set({ visionTargetId: best.id, visionRivalId: rival?.id ?? null, tool: 'vision' });
      sfx('click');
    },

    setVisionRival: (civId) => set({ visionRivalId: civId }),
    closeVision: () => set({ visionTargetId: null, visionRivalId: null }),

    visionRivals: () => {
      const w = get().world;
      const t = w?.citizens[get().visionTargetId ?? ''];
      return t?.civId ? validRivals(w!, t.civId) : [];
    },

    visionAssessment: () => {
      const w = get().world;
      const id = get().visionTargetId;
      if (!w || !id) return null;
      return assessVision(w, id, get().visionRivalId);
    },

    confirmVision: () => {
      const w = get().world;
      const id = get().visionTargetId;
      const rivalId = get().visionRivalId;
      if (!w || !id) return;
      const target = w.citizens[id];
      if (!target || !target.alive) { get().pushNotification('That person is gone.', 'warn'); set({ visionTargetId: null }); return; }
      if (!rivalId) { get().pushNotification('Choose a rival civilization first.', 'warn'); return; }
      const err = checkPower(w, 'Divine Vision', POWERS.vision.cost, 'vision');
      if (err) { get().pushNotification(err, 'warn'); sfx('error'); return; }
      const a = assessVision(w, id, rivalId);
      if (a.blocked) { get().pushNotification(a.blocked, 'warn'); sfx('error'); return; }
      spend(w, POWERS.vision.cost, 'vision', POWERS.vision.cooldown);
      const res = performVision(w, id, rivalId);
      const cell = effectiveCell(target);
      addEffect('dream', cell, 2600, 1.5);
      queueBurst('dream', cell);
      sfx(res.outcome === 'war' ? 'war' : 'forge');
      if (!res.ok) get().pushNotification(res.reason ?? 'The vision found no purchase.', 'warn');
      else if (res.outcome === 'dismissed') get().pushNotification(`${res.targetName} rejected the vision.`, 'info');
      else if (res.war) get().pushNotification(`${res.targetName} declares war on the ${res.rivalName}!`, 'bad');
      else get().pushNotification(`${res.targetName} stirs the people toward war.`, 'warn');
      set({ visionTargetId: null, visionRivalId: null, selectedCellId: cell, selectedEntityId: id });
      refreshCounts(w);
      bump();
    },

    usePower: (cellId) => {
      const { world, tool } = get();
      if (!world || !world.cells[cellId]) return;
      if (tool === 'select') { get().selectAt(cellId); return; }
      if (tool === 'vision') { get().openVision(cellId); return; }
      let res: PowerResult;
      switch (tool) {
        case 'life': res = castSpawn(world, 'human', cellId); break;
        case 'forge': res = castSpawn(world, get().forgeSpecies, cellId); break;
        case 'nature': res = castNature(world, cellId); break;
        case 'rain': res = castRain(world, cellId); break;
        case 'lightning': res = castLightning(world, cellId); break;
        case 'terraform': res = castTerraform(world, cellId, get().terraformRaise); break;
        case 'meteor': res = get().meteorMode === 'shower' ? castShower(world, cellId) : castMeteor(world, cellId); break;
        default: return;
      }
      if (!res.ok) {
        get().pushNotification(res.reason ?? 'That could not be done.', 'warn');
        sfx('error');
        return;
      }
      switch (tool) {
        case 'life': case 'forge': {
          const at = res.cellId ?? cellId;
          addEffect('life', at, 1200, 1.2); queueBurst('birth', at);
          sfx(tool === 'forge' ? 'forge' : 'life'); break;
        }
        case 'nature': addEffect('nature', cellId, 1400, POWERS.nature.radius); queueBurst('nature', cellId); sfx('nature'); break;
        case 'rain': addEffect('rain', cellId, 4200, POWERS.rain.radius); sfx('rain'); break;
        case 'lightning': addEffect('lightning', cellId, 700, LIGHTNING.radius); queueBurst('lightning', cellId); sfx('lightning'); break;
        case 'terraform': addEffect('terraform', cellId, 900, 1); queueBurst('terraform', cellId); sfx('forge'); break;
        case 'meteor': sfx('meteor'); break;
      }
      refreshCounts(world);
      bump();
    },

    advanceSim: (realDtMs) => {
      const { world, speed } = get();
      if (!world) return;
      const now = performance.now();
      const dtMs = Math.min(realDtMs, MAX_FRAME_MS);
      advanceRealtime(world, dtMs / 1000, speed === 0);
      const r = advanceClock(world, realDtMs, speed, simAcc);
      simAcc = r.acc;

      // Drain presentation output produced by the simulation
      let drained = false;
      if (world.notices.length) {
        for (const n of world.notices) {
          get().pushNotification(n.text, n.tone);
          if (n.tone === 'bad' && /war/i.test(n.text)) sfx('war'); else if (n.tone === 'bad') sfx('alert');
        }
        world.notices.length = 0; drained = true;
      }
      if (world.fx.length) {
        for (const f of world.fx) {
          const kind: BurstKind = f.type;
          queueBurst(kind, f.cellId);
          if (f.type === 'impact') {
            addEffect('impact', f.cellId, 1000, 3);
            sfx('impact');
          } else if (f.type === 'coronation') {
            addEffect('coronation', f.cellId, 1800, 1.8);
            sfx('life');
          }
        }
        world.fx.length = 0; drained = true;
      }

      if (drained || (speed === 0 && world.meteors.length > 0)) refreshCounts(world);

      // Prune finished effects / notifications only when something actually expired
      const ef = get().effects;
      if (ef.length && ef.some(e => now - e.createdAt >= e.duration)) set({ effects: ef.filter(e => now - e.createdAt < e.duration) });
      const nf = get().notifications;
      if (nf.length && nf.some(n => now - n.createdAt >= 5500)) set({ notifications: nf.filter(n => now - n.createdAt < 5500) });

      // Autosave (real time), never more than every 20s
      if (now - lastSaveReal > 20000) {
        lastSaveReal = now;
        const ok = saveGame(world, get().tutorialDone);
        set({ saveState: ok ? 'saved' : 'failed', lastSavedAt: ok ? Date.now() : get().lastSavedAt });
      }

      // Throttle React updates (~30 Hz) and only when something changed
      if ((r.steps > 0 || drained || world.meteors.length > 0) && now - lastBump > 33) {
        lastBump = now;
        bump();
      }
    },

    renameWorld: (name) => {
      const w = get().world;
      if (w) { w.name = name; bump(); }
    },

    pushNotification: (text, tone = 'info') => {
      const list = get().notifications;
      const now = performance.now();
      if (list.some(n => n.text === text && now - n.createdAt < 1500)) return;
      const n: Notification = { id: 'n' + Math.random().toString(36).slice(2, 8), text, createdAt: now, tone };
      set({ notifications: [...list.slice(-4), n] });
    },

    setShowMenu: (v) => set({ showMenu: v }),
    setShowHelp: (v) => set({ showHelp: v }),
    setPanelTab: (t) => set({ panelTab: t, panelOpen: true }),
    setPanelOpen: (v) => set({ panelOpen: v }),
    setMuted: (v) => { set({ muted: v }); setAudioMuted(v); },
    setTutorialDone: (v) => set({ tutorialDone: v }),
    nextTutorial: () => {
      const next = get().tutorialStep + 1;
      set(next >= 5 ? { tutorialStep: next, tutorialDone: true } : { tutorialStep: next });
    },
    skipTutorial: () => set({ tutorialDone: true, tutorialStep: 99 }),
    setTerraformRaise: (v) => set({ terraformRaise: v }),

    recruit: (civId, n) => {
      const w = get().world;
      const civ = w?.civs[civId];
      if (!w || !civ || !civ.alive) return;
      const r = recruitSoldiers(w, civ, n, true);
      if (r.recruited > 0) { get().pushNotification(`${r.recruited} soldier${r.recruited > 1 ? 's' : ''} recruited.`, 'good'); sfx('build'); }
      else { get().pushNotification(r.reason ?? 'No one could be recruited.', 'warn'); sfx('error'); }
      bump();
    },

    standDown: (civId) => {
      const w = get().world;
      const civ = w?.civs[civId];
      if (!w || !civ) return;
      civ.guardTarget = 0;
      const n = demobilize(w, civ);
      get().pushNotification(n ? `${n} soldier${n > 1 ? 's' : ''} returned to civilian life.` : 'There are no soldiers to stand down.', n ? 'info' : 'warn');
      bump();
    },

    seedCivilization: () => {
      const w = get().world;
      if (!w) return;
      const r = castSeedCiv(w);
      if (r.ok) {
        const civ = w.civs[r.civId!];
        const st = Object.values(w.settlements).find(s => s.civId === civ.id);
        if (st) { get().setSelected(st.cellId, null); addEffect('life', st.cellId, 1500, 2); queueBurst('birth', st.cellId); }
        set({ selectedCivId: civ.id, panelTab: 'civs' });
        sfx('life');
      } else { get().pushNotification(r.reason ?? 'Could not seed a civilization.', 'warn'); sfx('error'); }
      bump();
    },

    cancelShower: () => {
      const w = get().world;
      if (!w) return;
      const r = cancelShowerSim(w);
      if (!r.ok) get().pushNotification(r.reason ?? '', 'warn');
      bump();
    },
  };
});

if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__LG = useGame; // debug hook for automated tests

export { METEOR };
