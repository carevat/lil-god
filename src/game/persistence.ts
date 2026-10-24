// Persistence: versioned save, load (with migration), export, import

import type { SaveData, WorldState } from './types';
import { migrateSave, SAVE_VERSION } from './migrate';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

export { SAVE_VERSION };

const STORAGE_KEY = 'littlegod.save.v1'; // key kept so Part 1 worlds are found and migrated
const BACKUP_KEY = 'littlegod.save.backup';
const SETTINGS_KEY = 'littlegod.settings.v1';

const hasStorage = () => typeof localStorage !== 'undefined';

// Larger maps exceed localStorage's quota as raw JSON. Exports remain readable JSON, while
// browser snapshots use lossless gzip. The decoder still accepts every historical JSON save.
export function packSave(json: string): string {
  return 'LGZ5:' + btoa(strFromU8(gzipSync(strToU8(json), { level: 1 }), true));
}
export function unpackSave(raw: string): string {
  return raw.startsWith('LGZ5:') ? strFromU8(gunzipSync(strToU8(atob(raw.slice(5)), true))) : raw;
}

/** Compact JSON: rounds floats and guards against NaN/Infinity. */
export function serialize(state: WorldState, tutorialDone: boolean): string {
  const data: SaveData = {
    version: SAVE_VERSION,
    state: {
      ...state,
      notices: [], fx: [],
      // transient animation state is rebuilt on load
      citizens: Object.fromEntries(Object.entries(state.citizens).map(([k, v]) => [k, { ...v }])),
    },
    savedAt: Date.now(),
    tutorialDone,
    worldName: state.name,
  };
  return JSON.stringify(data, (_k, v) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 0;
      return Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4;
    }
    return v;
  });
}

export function saveGame(state: WorldState, tutorialDone: boolean): boolean {
  if (!hasStorage()) return false;
  try {
    localStorage.setItem(STORAGE_KEY, packSave(serialize(state, tutorialDone)));
    return true;
  } catch (e) {
    console.warn('Failed to save', e);
    return false;
  }
}

export interface LoadResult { data?: SaveData; error?: string; migrated?: boolean }

/** Returns null when there is no save at all. On failure the raw data is preserved under a backup key. */
export function loadGame(): LoadResult | null {
  if (!hasStorage()) return null;
  let raw: string | null = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return null; }
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(unpackSave(raw)); } catch {
    keepBackup(raw);
    return { error: 'The saved world is corrupted. A copy was kept as a backup; start a new world or import another save.' };
  }
  const res = migrateSave(parsed);
  if (!res.ok) {
    keepBackup(raw);
    return { error: `${res.error} The original data was preserved as a backup.` };
  }
  if (res.migrated) keepBackup(raw); // never lose the pre-migration original
  return { data: res.data, migrated: res.migrated };
}

function keepBackup(raw: string) {
  try { if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, raw); } catch { /* quota */ }
}

export function hasSave(): boolean {
  if (!hasStorage()) return false;
  try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
}

export function clearSave(): void {
  if (hasStorage()) { try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ } }
}

export function exportSave(state: WorldState, tutorialDone: boolean): string {
  return serialize(state, tutorialDone);
}

export function importSave(json: string): LoadResult {
  let parsed: unknown;
  try { parsed = JSON.parse(unpackSave(json)); } catch { return { error: 'That file is not valid JSON.' }; }
  const res = migrateSave(parsed);
  if (!res.ok) return { error: res.error };
  return { data: res.data, migrated: res.migrated };
}

export function downloadSave(state: WorldState, tutorialDone: boolean): void {
  const blob = new Blob([exportSave(state, tutorialDone)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `littlegod-${state.name.replace(/\s+/g, '_')}-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Settings { muted: boolean; tutorialDone: boolean }

export function loadSettings(): Settings {
  const d = { muted: false, tutorialDone: false };
  if (!hasStorage()) return d;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...d, ...JSON.parse(raw) } : d;
  } catch { return d; }
}

export function saveSettings(s: Settings): void {
  if (!hasStorage()) return;
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* noop */ }
}
