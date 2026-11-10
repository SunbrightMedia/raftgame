/**
 * Random places to stand in a generated industrial world, for a visual check:
 * a point on a random walk, facing along it (or back, or a little to one side).
 *   npx vite-node tools/world/tour.ts -- [seed] [count] [pick-seed]
 * Prints studio poses "x,y,z,yaw,pitch" (z = feet), one per line.
 */
import { makeLayout } from '../../src/world/industrial/layout';
import { Rng } from '../../src/world/rng';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = Number(args[0] ?? 1), count = Number(args[1] ?? 12), pick = Number(args[2] ?? 1);
const lay = makeLayout(seed);
const L = lay.params.levels, T = 128;
const zOf = (l: number) => (l - Math.floor(L / 2)) * 256;
const r = new Rng(pick * 7919 + seed);
for (let n = 0; n < count; n++) {
  const w = r.pick(lay.walks.filter((w) => w.la === w.lb && lay.segments[w.segment].tiles.length > 0));
  const s = lay.segments[w.segment];
  const [x, y] = r.pick(s.tiles);
  const yaw = ((r.chance(0.5) ? s.dir : (s.dir + 2) % 4) * 90 + r.pick([0, 0, 0, 35, -35])) % 360;
  console.log(`${x * T + 64},${y * T + 64},${zOf(w.la) + 1},${yaw},${r.pick([0, 0, 0, -20, 25])}`);
}
