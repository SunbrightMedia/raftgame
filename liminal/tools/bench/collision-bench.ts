/**
 * How heavy is a map's collision world: build time, index size, and the cost of a player-sized trace.
 *   npx vite-node tools/bench/collision-bench.ts -- maps/iw/industrial.json
 */
import { readFileSync, readdirSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { solidPlanes } from '../../src/engine/light/faces';
import { CollisionWorld } from '../../src/engine/collision/trace';
import { convexBrush } from '../../src/engine/collision/brush';
import { propSolids, type PropShape } from '../../src/engine/collision/props';
import { v3 } from '../../src/engine/vec3';

const path = process.argv.slice(2).find((a) => a.endsWith('.json')) ?? 'maps/blank.json';
const map = parseMap(JSON.parse(readFileSync(path, 'utf8')));
const hulls = new Map<string, PropShape>();
for (const f of readdirSync('models', { recursive: true }) as string[]) {
  if (!f.endsWith('.json')) continue;
  const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
  if (h.format === 'liminal-mesh') hulls.set(String(h.source).toLowerCase(), { hull: h.hull, collision: h.collision });
}
const mem0 = process.memoryUsage().heapUsed;
let t = performance.now();
const solids = [
  ...map.brushes.filter((b) => b.solid !== false).map((b) => { const sp = solidPlanes(b); return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...b.min), v3(...b.max)); }),
  ...propSolids(map.entities, (m) => hulls.get(m.toLowerCase())),
];
const world = new CollisionWorld(solids);
const build = performance.now() - t;
const grids = (world as unknown as { grids: { cell: number; map: Map<number, number[]>; all: number[] }[] }).grids;
console.log(`${solids.length} solids, built in ${build.toFixed(0)} ms, heap +${((process.memoryUsage().heapUsed - mem0) / 1e6).toFixed(0)} MB`);
for (const g of grids) console.log(`  cell ${g.cell}: ${g.all.length} solids in ${g.map.size} cells, ${[...g.map.values()].reduce((n, l) => n + l.length, 0)} entries`);
const start = map.entities.find((e) => e.class === 'player_start')!.origin;
const mins = v3(-16, -16, 0), maxs = v3(16, 16, 72);
t = performance.now();
let hits = 0;
const N = 20000;
for (let i = 0; i < N; i++) {
  const a = (i * 2.399) % (2 * Math.PI), r = 40 + (i % 300);
  const s = v3(start[0] + Math.cos(a) * r, start[1] + Math.sin(a) * r, start[2] + 4);
  if (world.trace(s, v3(s.x + Math.cos(a) * 6, s.y + Math.sin(a) * 6, s.z - 20), mins, maxs).fraction < 1) hits++;
}
console.log(`${N} short traces: ${((performance.now() - t) / N * 1000).toFixed(1)} µs each, ${hits} hit`);
