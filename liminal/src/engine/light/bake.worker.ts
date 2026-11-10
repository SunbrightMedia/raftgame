/// <reference lib="webworker" />
import { bake, type BakeInput } from './bake';
import { bakeSource, type SourceBakeInput } from './vrad';

/** Runs lightmap bakes (ours, or Source's model: vrad.ts) off the main thread so the game never hitches. */
self.onmessage = (e: MessageEvent<{ id: number; input: BakeInput } | { id: number; source: SourceBakeInput }>) => {
  const d = e.data;
  if ('source' in d) {
    const out = bakeSource({ ...d.source, log: (m) => (self as unknown as Worker).postMessage({ id: d.id, progress: m }) });
    (self as unknown as Worker).postMessage({ id: d.id, out }, [out.pixels.buffer]);
    return;
  }
  const out = bake(d.input);
  (self as unknown as Worker).postMessage({ id: d.id, out }, [out.pixels.buffer]);
};
