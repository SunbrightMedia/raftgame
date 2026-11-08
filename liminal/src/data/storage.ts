/**
 * Where config and maps live. The game only touches files through this, so
 * the same code runs against the Vite dev server (real files on disk),
 * a static build (bundled read-only files + localStorage), and later a
 * desktop shell (Tauri/Electron fs).
 *
 * Paths are project-relative: "config/settings.json", "maps/test_room.json".
 */
export interface Storage {
  readonly kind: 'dev-server' | 'browser';
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
  constructor() {
    const raw = import.meta.glob(['../../maps/*.json', '../../config/*.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    this.bundled = {};
    for (const [k, v] of Object.entries(raw)) this.bundled[k.replace(/^(\.\.\/)+/, '')] = v;
  }
  private key(p: string) { return `liminal:file:${p}`; }
  async read(path: string): Promise<string | null> {
    try {
      const ls = localStorage.getItem(this.key(path));
      if (ls !== null) return ls;
    } catch { /* storage blocked */ }
    return this.bundled[path] ?? null;
  }
  async write(path: string, text: string): Promise<void> {
    try { localStorage.setItem(this.key(path), text); } catch { /* storage blocked */ }
  }
  async list(dir: string): Promise<string[]> {
    const names = new Set<string>();
    for (const k of Object.keys(this.bundled)) if (k.startsWith(dir + '/')) names.add(k.slice(dir.length + 1));
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

export async function openStorage(): Promise<Storage> {
  try {
    const r = await fetch('/api/list/config', { cache: 'no-store' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return new DevServerStorage();
  } catch { /* not on the dev server */ }
  return new BrowserStorage();
}
