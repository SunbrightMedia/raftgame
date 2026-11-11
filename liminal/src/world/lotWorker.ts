/// <reference lib="webworker" />
/**
 * Makes lots of the endless world off the page's own thread, so the game
 * never waits for one (world/lotBuild.ts does the work; game/lotWorld.ts asks).
 */
import { buildLot, payloadBuffers, type LotEnv } from './lotBuild';

let env: LotEnv | null = null;
self.onmessage = (e: MessageEvent) => {
  const m = e.data as { type: 'env'; env: LotEnv } | { type: 'lot'; id: number; seed: number; i: number; j: number };
  if (m.type === 'env') { env = m.env; return; }
  if (!env) return;
  try {
    const payload = buildLot(m.seed, m.i, m.j, env);
    (self as unknown as Worker).postMessage({ type: 'lot', id: m.id, payload }, payloadBuffers(payload));
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: m.id, message: String((err as Error)?.stack ?? err) });
  }
};
