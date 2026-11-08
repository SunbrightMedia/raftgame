import type { Storage } from './storage';
import { type Settings, DEFAULT_SETTINGS, cloneSettings, applyPatch, diffSettings } from './settings';

export const CONFIG_PATH = 'config/settings.json';

/**
 * Live settings with autosave. Every change is written (debounced) to
 * config/settings.json, storing only the values that differ from the code
 * defaults, so the file stays short and readable.
 */
export class ConfigStore {
  values: Settings = cloneSettings(DEFAULT_SETTINGS);
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
        applyPatch(this.values, j.settings ?? j);
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

  replace(patch: unknown, fromDefaults = false): void {
    if (fromDefaults) this.values = cloneSettings(DEFAULT_SETTINGS);
    applyPatch(this.values, patch);
    this.changed();
  }

  toJSON(): string {
    return JSON.stringify({ format: 'liminal-config', version: 1, settings: diffSettings(this.values) }, null, 2) + '\n';
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
