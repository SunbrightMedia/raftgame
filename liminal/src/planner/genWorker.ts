/**
 * Makes maps off the main thread, so sliders and drags never freeze the page. Each request carries an id; the
 * map comes back first, its walk/fill stats right after.
 */
import { addStats, generate } from './generate';
import type { Edits, Params } from './types';

interface Req { id: number; params: Params; edits: Edits }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, params, edits } = e.data;
  try {
    const map = generate(params, edits, { stats: false });
    self.postMessage({ id, map });
    addStats(map);
    self.postMessage({ id, stats: map.stats });
  } catch (err) {
    self.postMessage({ id, error: String((err as Error)?.stack ?? err) });
  }
};
