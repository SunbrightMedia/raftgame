/**
 * Your own names for room types. They stay: saved in the published page's database (shared by everyone who opens
 * the page, kept across reloads and devices), in this browser as a fallback, and copied into the repo
 * (typeNames.json) so the engine uses them too. Order: page database, this browser, repo copy, catalogue name.
 */
import { FEATURE } from './catalogue';
import repoNames from './typeNames.json';

const LS = 'backrooms-planner-names-v1';
const repo = repoNames as Record<string, string>;
let local: Record<string, string> = {};
let shared: Record<string, string> = {};
const listeners = new Set<() => void>();

try { local = JSON.parse(localStorage.getItem(LS) ?? '{}') as Record<string, string>; } catch { local = {}; }

/** The name to show for a feature id. */
export function typeName(id: string): string {
  return shared[id] || local[id] || repo[id] || FEATURE[id]?.name || id;
}
/** True when the name differs from the catalogue's. */
export function isRenamed(id: string): boolean { return typeName(id) !== (FEATURE[id]?.name ?? id); }
export function onNames(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const notify = () => listeners.forEach((f) => f());

// ---- the page database (claude.ai artifact runtime); absent outside the viewer
interface DocSnap { id: string; data(): Record<string, unknown> | undefined }
interface DocRef { set(d: Record<string, unknown>): Promise<void>; delete(): Promise<void> }
interface Coll { doc(id: string): DocRef; onSnapshot(next: (s: { docs: DocSnap[] }) => void, err?: (e: { code: string }) => void): () => void }
interface Db { collection(path: string): Coll }
let db: Db | null = null;
const ready = (async () => {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return;
  try { db = (await c.use('db')) as Db | null; } catch { db = null; }
  if (!db) return;
  db.collection('typeNames').onSnapshot((snap) => {
    const next: Record<string, string> = {};
    for (const d of snap.docs) { const v = d.data()?.name; if (typeof v === 'string' && v.trim()) next[d.id] = v.trim(); }
    shared = next;
    notify();
  }, () => { /* keep what we have; names still save in this browser */ });
})();

/** Rename a room type (empty = back to the catalogue's name). */
export async function setTypeName(id: string, name: string): Promise<void> {
  const v = name.trim();
  const dflt = FEATURE[id]?.name ?? id;
  if (!v || v === dflt) delete local[id]; else local[id] = v;
  try { localStorage.setItem(LS, JSON.stringify(local)); } catch { /* storage may be off */ }
  if (!v || v === dflt) delete shared[id]; else shared[id] = v;
  notify();
  await ready;
  if (!db) return;
  try {
    const ref = db.collection('typeNames').doc(id);
    if (!v || v === dflt) await ref.delete(); else await ref.set({ name: v, at: Date.now() });
  } catch { /* the browser copy stays */ }
}

/** All names that differ from the catalogue (for copying into the repo). */
export function renamed(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of Object.keys(FEATURE)) if (isRenamed(id)) out[id] = typeName(id);
  return out;
}
