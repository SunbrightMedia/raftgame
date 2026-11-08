/// <reference lib="webworker" />
import { bake, type BakeInput } from './bake';

/** Runs the lightmap bake off the main thread so the game never hitches. */
self.onmessage = (e: MessageEvent<{ id: number; input: BakeInput }>) => {
  const out = bake(e.data.input);
  (self as unknown as Worker).postMessage({ id: e.data.id, out }, [out.pixels.buffer]);
};
