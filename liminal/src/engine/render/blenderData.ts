/**
 * Loads the Blender post-processing program (data/blender/, made by tools/blender/comp2glsl.py) the first time
 * it is wanted: the program JSON, then its 3D colour tables (each in one or more files, joined in order).
 */
import * as assets from '@globs';
import type { BPProgram } from './blenderPost';

export interface BlenderData { prog: BPProgram; luts: Record<string, Float32Array> }

let pending: Promise<BlenderData> | null = null;

function urlOf(name: string): (() => Promise<string>) | undefined {
  const key = Object.keys(assets.blenderData).find((k) => k.endsWith('/' + name));
  return key ? assets.blenderData[key] : undefined;
}

async function fetchBytes(name: string): Promise<ArrayBuffer> {
  const get = urlOf(name);
  if (!get) throw new Error('blender data: no file ' + name + ' in this build');
  const url = await get();
  const r = await fetch(url);
  if (!r.ok) throw new Error(`blender data: ${name}: HTTP ${r.status}`);
  if (!url.endsWith('.b64.txt')) return r.arrayBuffer();
  // the published page gets binary files as base64 text (artifacts serve no raw binary)
  const bin = atob((await r.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** True when this build carries the data (the dev build does; the published page does not, for now). */
export function haveBlenderData(): boolean { return urlOf('blenderPost.json') !== undefined; }

export function loadBlenderData(): Promise<BlenderData> {
  pending ??= (async () => {
    const prog = JSON.parse(new TextDecoder().decode(await fetchBytes('blenderPost.json'))) as BPProgram;
    const luts: Record<string, Float32Array> = {};
    for (const [name, files] of Object.entries(prog.data)) {
      const parts = await Promise.all(files.map(fetchBytes));
      const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let o = 0;
      for (const p of parts) { all.set(new Uint8Array(p), o); o += p.byteLength; }
      luts[name] = new Float32Array(all.buffer);
    }
    return { prog, luts };
  })();
  pending.catch(() => { pending = null; });
  return pending;
}
