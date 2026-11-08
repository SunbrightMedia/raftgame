import type { Storage } from './storage';
import { type Settings, DEFAULT_SETTINGS, cloneSettings, applyPatch } from './settings';

function cloneOverrides(p: unknown): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (p && typeof p === 'object') for (const [c, kv] of Object.entries(p as Record<string, unknown>)) if (kv && typeof kv === 'object') out[c] = { ...(kv as Record<string, unknown>) };
  return out;
}

export const CONFIG_PATH = 'config/settings.json';

type Overrides = Record<string, Record<string, unknown>>;

/**
 * Live settings with autosave.
 *
 * Three layers: code defaults, then the current map's own settings (its
 * mood: fog, exposure, grain...), then the user's overrides. `values` is what
 * is in effect (the panel shows and edits it). Only the user's overrides are
 * saved (config/settings.json), and a value the user set counts even if it
 * equals the default, so a map's setting can always be turned down or off.
 */
export class ConfigStore {
  /** In effect now: defaults ⊕ map ⊕ overrides. The panel edits this object in place. */
  values: Settings = cloneSettings(DEFAULT_SETTINGS);
  /** Defaults ⊕ the current map's settings: what ↺ resets a row to. */
  base: Settings = cloneSettings(DEFAULT_SETTINGS);
  /** The user's own choices (saved). */
  overrides: Overrides = {};
  private listeners = new Set<(s: Settings) => void>();
  private saveTimer: number | undefined;
  status = '';

  constructor(private storage: Storage) {}

  get storageKind(): Storage['kind'] { return this.storage.kind; }

  async load(): Promise<void> {
    try {
      const text = await this.storage.read(CONFIG_PATH);
      if (text) {
        const j = JSON.parse(text);
        this.overrides = cloneOverrides(j.settings ?? j);
        this.rebuild();
        this.status = `loaded ${CONFIG_PATH}`;
      } else {
        this.status = 'using defaults';
      }
    } catch (e) {
      this.status = `config error: ${(e as Error).message}`;
      console.warn(e);
    }
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call after mutating `values`. */
  changed(): void {
    for (const fn of this.listeners) fn(this.values);
    this.scheduleSave();
  }

  /** The user sets one value (kept as an override even if it equals the default). */
  set(cat: string, key: string, v: unknown): void {
    (this.overrides[cat] ??= {})[key] = v;
    (this.values as unknown as Overrides)[cat][key] = v;
    this.changed();
  }

  /** Back to the map's value (or the default): forget the user's override. */
  reset(cat: string, key: string): void {
    if (this.overrides[cat]) { delete this.overrides[cat][key]; if (!Object.keys(this.overrides[cat]).length) delete this.overrides[cat]; }
    this.rebuild();
    this.changed();
  }

  /** A new map: its settings become the base under the user's overrides. */
  setMapSettings(patch: unknown): void {
    this.base = cloneSettings(DEFAULT_SETTINGS);
    if (patch) applyPatch(this.base, patch);
    this.rebuild();
    for (const fn of this.listeners) fn(this.values);
  }

  /** Presets, imports, reset all: patch becomes overrides (fromDefaults clears the rest first). */
  replace(patch: unknown, fromDefaults = false): void {
    if (fromDefaults) this.overrides = {};
    for (const [c, kv] of Object.entries(cloneOverrides(patch))) Object.assign((this.overrides[c] ??= {}), kv);
    this.rebuild();
    this.changed();
  }

  /** Recompute `values` in place (panel rows hold references to it). */
  private rebuild(): void {
    const v = cloneSettings(this.base);
    applyPatch(v, this.overrides);
    const dst = this.values as unknown as Overrides, src = v as unknown as Overrides;
    for (const c of Object.keys(src)) Object.assign(dst[c], src[c]);
  }

  toJSON(): string {
    return JSON.stringify({ format: 'liminal-config', version: 1, settings: this.overrides }, null, 2) + '\n';
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 400);
  }

  async save(): Promise<void> {
    try {
      await this.storage.write(CONFIG_PATH, this.toJSON());
      const where = { 'dev-server': CONFIG_PATH, artifact: 'this page (Claude can read it)', browser: 'browser storage' }[this.storage.kind];
      this.status = `saved ${new Date().toLocaleTimeString()} → ${where}`;
    } catch (e) {
      this.status = `save failed: ${(e as Error).message}`;
    }
    for (const fn of this.listeners) fn(this.values);
  }
}
