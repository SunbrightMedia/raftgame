/**
 * Prints map faults per seed (src/planner/faults.ts).
 *
 *   npx vite-node tools/planner/check.ts -- [seeds=1,2,3] [params JSON]
 */
import { generate, DEFAULT_PARAMS } from '../../src/planner/generate';
import { check } from '../../src/planner/faults';
import type { Params } from '../../src/planner/types';

const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number);
const over = JSON.parse(process.argv[3] ?? '{}') as Partial<Params>;

{
  let tot = { long: 0, rr: 0, cr: 0, cs: 0, cl: 0, out: 0 };
  for (const seed of seeds) {
    const p: Params = { ...DEFAULT_PARAMS, ...over, seed };
    const t = performance.now();
    const m = generate(p);
    const ms = performance.now() - t;
    const f = check(m);
    const out = Object.values(f.outside).reduce((s, v) => s + v, 0);
    tot = { long: tot.long + f.long, rr: tot.rr + f.roomRoom.length, cr: tot.cr + f.corrRoom.length, cs: tot.cs + f.crossSame, cl: tot.cl + f.crossLevel.length, out: tot.out + out };
    console.log(`seed ${seed}: ${m.zones.length} rooms, ${ms.toFixed(0)} ms | long runs ${f.long} | room/room ${f.roomRoom.length} | corridor/room ${f.corrRoom.length} | crossings same floor ${f.crossSame}, other floor ${f.crossLevel.length} | outside own box ${out}`);
    if (f.roomRoom.length) console.log('   room/room e.g.', JSON.stringify(f.roomRoom.slice(0, 6)));
    if (f.corrRoom.length) console.log('   corridor/room e.g.', JSON.stringify(f.corrRoom.slice(0, 6)));
    if (out) console.log('   outside:', JSON.stringify(Object.entries(f.outside).sort((a, b) => b[1] - a[1]).slice(0, 10)));
  }
  console.log('total', JSON.stringify(tot));
}
