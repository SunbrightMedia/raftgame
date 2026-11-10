import * as assets from '@globs';

/**
 * Where config and maps live. The game only touches files through this, so
 * the same code runs against the Vite dev server (real files on disk),
 * a static build (bundled read-only files + localStorage), and later a
 * desktop shell (Tauri/Electron fs).
 *
 * Paths are project-relative: "config/settings.json", "maps/test_room.json".
 */
export interface Storage {
  readonly kind: 'dev-server' | 'browser' | 'artifact';
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

class DevServerStorage implements Storage {
  readonly kind = 'dev-server' as const;
  async read(path: string): Promise<string | null> {
    const r = await fetch(`/api/file/${path}`, { cache: 'no-store' });
    return r.ok ? r.text() : null;
  }
  async write(path: string, text: string): Promise<void> {
    const r = await fetch(`/api/file/${path}`, { method: 'PUT', body: text });
    if (!r.ok) throw new Error(`write ${path} failed: ${r.status}`);
  }
  async list(dir: string): Promise<string[]> {
    const r = await fetch(`/api/list/${dir}`, { cache: 'no-store' });
    return r.ok ? r.json() : [];
  }
}

/** Static build: files baked in at build time, writes go to localStorage and override them. */
class BrowserStorage implements Storage {
  readonly kind = 'browser' as const;
  private bundled: Record<string, string>;
  /** The atrium build's Portal 2 map files: big, so fetched as separate files when read. */
  private fetched: Record<string, string>;
  constructor() {
    const raw = import.meta.glob(['../../maps/*.json', '../../config/*.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    this.bundled = {};
    for (const [k, v] of Object.entries(raw)) this.bundled[k.replace(/^(\.\.\/)+/, '')] = v;
    const urls = assets.mapUrls;
    this.fetched = {};
    for (const [k, v] of Object.entries(urls)) this.fetched[k.replace(/^(\.\.\/)+/, '')] = v;
  }
  private key(p: string) { return `liminal:file:${p}`; }
  async read(path: string): Promise<string | null> {
    try {
      const ls = localStorage.getItem(this.key(path));
      if (ls !== null) return ls;
    } catch { /* storage blocked */ }
    if (this.bundled[path] !== undefined) return this.bundled[path];
    const url = this.fetched[path];
    if (url) { const r = await fetch(url); return r.ok ? r.text() : null; }
    return null;
  }
  async write(path: string, text: string): Promise<void> {
    try { localStorage.setItem(this.key(path), text); } catch { /* storage blocked */ }
  }
  async list(dir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const k of [...Object.keys(this.bundled), ...Object.keys(this.fetched)]) if (k.startsWith(dir + '/') && !k.includes('lightmap')) names.add(k.slice(dir.length + 1));
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        const pre = this.key(dir + '/');
        if (k.startsWith(pre)) names.add(k.slice(pre.length));
      }
    } catch { /* storage blocked */ }
    return [...names];
  }
}

/** Minimal slice of the claude.ai artifact `db` API this file uses. */
interface ArtifactDb {
  doc(path: string): {
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(data: Record<string, unknown>): Promise<void>;
  };
  collection(path: string): { get(): Promise<{ docs: { id: string }[] }> };
}

/**
 * Published as a claude.ai artifact: files live in the artifact's own
 * database (collection `files`, one document per path), so tuning survives
 * reloads, follows you between devices, and Claude can read it back.
 * Anything not saved yet falls back to the files bundled at build time.
 */
class ArtifactStorage implements Storage {
  readonly kind = 'artifact' as const;
  private fallback = new BrowserStorage();
  constructor(private db: ArtifactDb) {}
  // Path segments may not contain '/', so "config/settings.json" -> "config~settings.json".
  private ref(path: string) { return this.db.doc(`files/${path.replace(/\//g, '~')}`); }
  async read(path: string): Promise<string | null> {
    try {
      const snap = await this.ref(path).get();
      const text = snap.exists ? snap.data()?.text : undefined;
      if (typeof text === 'string') return text;
    } catch (e) { console.warn('artifact db read failed', e); }
    return this.fallback.read(path);
  }
  async write(path: string, text: string): Promise<void> {
    await this.ref(path).set({ text, savedAt: new Date().toISOString() });
  }
  async list(dir: string): Promise<string[]> {
    const names = new Set(await this.fallback.list(dir));
    try {
      const snap = await this.db.collection('files').get();
      for (const d of snap.docs) {
        const p = d.id.replace(/~/g, '/');
        if (p.startsWith(dir + '/')) names.add(p.slice(dir.length + 1));
      }
    } catch { /* offline */ }
    return [...names];
  }
}

export async function openStorage(): Promise<Storage> {
  const host = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (host?.use) {
    // Inside the claude.ai viewer. use() resolves null if this view can't
    // run db; cap the wait so a silent host can't stall boot.
    const db = await Promise.race([host.use('db'), new Promise((r) => setTimeout(() => r(null), 4000))]).catch(() => null);
    if (db) return new ArtifactStorage(db as ArtifactDb);
    return new BrowserStorage();
  }
  try {
    const r = await fetch('/api/list/config', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return new DevServerStorage();
  } catch { /* not on the dev server */ }
  return new BrowserStorage();
}
