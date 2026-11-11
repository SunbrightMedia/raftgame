/**
 * Random places to stand in a generated industrial world, for a visual check:
 * a point on a random walk, facing along it (or back, or a little to one side).
 *   npx vite-node tools/world/tour.ts -- [seed] [count] [pick-seed]
 * Prints studio poses "x,y,z,yaw,pitch" (z = feet), one per line.
 */
import { Rng } from '../../src/world/rng';
import { toolWorld, walkTiles } from './made';

// (Which world: tools/world/made.ts.)
const tw = toolWorld();
const { seed, made } = tw;
const count = Number(tw.rest[0] ?? 12), pick = Number(tw.rest[1] ?? 1);
const lay = made.layout;
const L = lay.params.levels;
const zOf = (l: number) => (l - Math.floor(L / 2)) * 256;
const r = new Rng(pick * 7919 + seed);
for (let n = 0; n < count; n++) {
  const w = r.pick(lay.walks.filter((w) => w.la === w.lb && lay.segments[w.segment].tiles.length > 0 && tw.built(walkTiles(made, w))));
  const s = lay.segments[w.segment];
  const [x, y] = r.pick(s.tiles);
  const yaw = ((r.chance(0.5) ? s.dir : (s.dir + 2) % 4) * 90 + r.pick([0, 0, 0, 35, -35])) % 360;
  console.log(`${tw.px(x)},${tw.py(y)},${zOf(w.la) + 1},${yaw},${r.pick([0, 0, 0, -20, 25])}`);
}
