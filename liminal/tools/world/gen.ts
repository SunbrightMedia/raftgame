/**
 * Generate a world map with the generator in src/world.
 *
 *   npx vite-node tools/world/gen.ts -- testbed [seed]        → maps/iw/testbed.json
 *   npx vite-node tools/world/gen.ts -- blockout [seed]       → maps/iw/blockout.json (the bare layout)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { serializeMap } from '../../src/data/map';
import { testbed, BTS_SETTINGS } from '../../src/world/industrial/testbed';
import { blockout } from '../../src/world/industrial/blockout';

const [what = 'testbed', seedArg] = process.argv.slice(2).filter((a) => a !== '--');
const seed = seedArg ? Number(seedArg) : 1;
const t0 = performance.now();
const made = what === 'blockout' ? blockout(seed) : null;
const out = what === 'testbed' ? testbed(seed) : made?.map ?? null;
if (made) {
  const l = made.layout;
  console.log(`layout: ${l.blocks.filter((b) => b.kind === 'mass').length} masses, ${l.blocks.filter((b) => b.kind === 'hall').length} halls, ${l.streets.length} streets, ${l.junctions.length} junctions, ${l.segments.length} segments, ${l.walks.length} catwalks (${l.walks.filter((w) => w.la !== w.lb).length} with stairs), ${l.nodes.size} nodes`);
}
if (!out) throw new Error(`unknown world: ${what}`);
mkdirSync('maps/iw', { recursive: true });
const map = out.toMap(what, BTS_SETTINGS);
writeFileSync(`maps/iw/${what}.json`, serializeMap(map));
console.log(`maps/iw/${what}.json: ${map.brushes.length} brushes, ${map.entities.length} entities, seed ${seed}, ${Math.round(performance.now() - t0)} ms`);
