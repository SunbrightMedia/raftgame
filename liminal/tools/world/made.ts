/**
 * The world the tools work on, from the command line:
 *   [seed]            the endless world of this seed (default 1)
 *   --lots n          n lots a side, with lot 0, 0 in the middle (default: as the game loads it, WORLD_LOTS)
 *   --old             the old generator: one whole world with an edge
 * `rest` is what is left of the arguments.
 */
import { industrial, industrialLots, WORLD_LOTS, type Made } from '../../src/world/industrial/world';

export const T = 128;
export interface ToolWorld {
  seed: number; made: Made; rest: string[];
  /** The middle of a plan tile, in the map: x from a tile's x, y from a tile's y. */
  px: (tx: number) => number; py: (ty: number) => number;
  /** Is a walk (or any list of tiles) wholly in the part that was built? */
  built: (tiles: [number, number][]) => boolean;
}
export function toolWorld(argv: string[] = process.argv.slice(2)): ToolWorld {
  const all = argv.filter((a) => a !== '--');
  const flag = (name: string) => { const k = all.indexOf(name); if (k < 0) return null; const v = all[k + 1]; all.splice(k, 2); return v; };
  const old = all.includes('--old');
  if (old) all.splice(all.indexOf('--old'), 1);
  const lots = Number(flag('--lots') ?? WORLD_LOTS);
  const k = all.findIndex((a) => /^\d+$/.test(a));
  const seed = k >= 0 ? Number(all.splice(k, 1)[0]) : 1;
  const made = old ? industrial(seed) : industrialLots(seed, -Math.floor(lots / 2), -Math.floor(lots / 2), lots);
  return {
    seed, made, rest: all,
    px: (tx) => tx * T + T / 2 + made.offset[0], py: (ty) => ty * T + T / 2 + made.offset[1],
    built: (tiles) => tiles.every(([x, y]) => made.kept(x, y)),
  };
}
/** The tiles of a walk with its two ends' tiles. */
export function walkTiles(made: Made, w: Made['layout']['walks'][number]): [number, number][] {
  const s = made.layout.segments[w.segment], A = made.layout.junctions[s.a], B = made.layout.junctions[s.b];
  return [[A.x, A.y], ...s.tiles, [B.x, B.y]];
}
