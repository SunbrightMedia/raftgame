/**
 * Generate a world map with the generator in src/world.
 *
 *   npx vite-node tools/world/gen.ts -- testbed [seed]        → maps/iw/testbed.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { serializeMap } from '../../src/data/map';
import { testbed, BTS_SETTINGS } from '../../src/world/industrial/testbed';

const [what = 'testbed', seedArg] = process.argv.slice(2).filter((a) => a !== '--');
const seed = seedArg ? Number(seedArg) : 1;
const t0 = performance.now();
const out = what === 'testbed' ? testbed(seed) : null;
if (!out) throw new Error(`unknown world: ${what}`);
mkdirSync('maps/iw', { recursive: true });
const map = out.toMap(what, BTS_SETTINGS);
writeFileSync(`maps/iw/${what}.json`, serializeMap(map));
console.log(`maps/iw/${what}.json: ${map.brushes.length} brushes, ${map.entities.length} entities, seed ${seed}, ${Math.round(performance.now() - t0)} ms`);
