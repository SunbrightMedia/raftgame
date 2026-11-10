import { MapOut, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { walkTile, stairs, truss, TILE, STEP, DX, DY, WARM, COOL, type Dir } from '../kit/aperture';

/**
 * A small scene to check the kit's joining rules and the light pipeline:
 * walkway tiles of every kind, a stair, lamps with glows, a wall to catch
 * the light. Not a world.
 */
export function testbed(seed: number): MapOut {
  const m = new MapOut();
  const rng = new Rng(seed);
  // Walkway plan on the tile grid (x, y), bits: 1 east, 2 north, 4 west, 8 south.
  const plan: Record<string, number> = {};
  const link = (x: number, y: number, d: Dir) => {
    const k = `${x},${y}`, k2 = `${x + DX[d]},${y + DY[d]}`;
    plan[k] = (plan[k] ?? 0) | (1 << d);
    plan[k2] = (plan[k2] ?? 0) | (1 << ((d + 2) % 4));
  };
  for (let x = 0; x < 6; x++) link(x, 0, 0);          // a run east
  for (let y = 0; y < 4; y++) link(3, y, 1);          // a branch north (T at 3,0)
  for (let x = 3; x > 0; x--) link(x, 4, 2);          // west along the top (L at 3,4)
  link(1, 4, 3); link(1, 3, 3);                       // south again
  for (let y = 0; y > -3; y--) link(3, y, 3);         // south from the T: makes it an X
  for (const [k, mask] of Object.entries(plan)) {
    const [x, y] = k.split(',').map(Number);
    walkTile(m, [x * TILE, y * TILE, 0], mask);
  }
  // Stairs up from the east end, then a short upper run.
  stairs(m, [6 * TILE + TILE / 2, 0, 0], 0);
  walkTile(m, [9 * TILE, 0, STEP], 4 | 1);
  walkTile(m, [10 * TILE, 0, STEP], 4);
  // A truss above the first run, a wall beside it.
  truss(m, [3 * TILE, 0, 320], 0, 1024);
  m.box([-256, 6 * TILE, -512], [12 * TILE, 6 * TILE + 64, 640], { tex: 'metal/black_wall_metal_002a', lightmapscale: 32 });
  // Lamps: warm ones along the run, a cool spot from above.
  for (let x = 0; x <= 6; x += 3) {
    const p: V3 = [x * TILE, 52, 96];
    m.prop('props_bts/cage_light', p, [0, 0, 0]);
    m.light([p[0], p[1], p[2] + 4], WARM, 60, 96, 420);
    m.glow([p[0], p[1], p[2] + 2], WARM, 40);
  }
  m.spot([3 * TILE, -64, 600], [80, 90, 0], COOL, 900, 20, 38, 600, 2400);
  m.beam([3 * TILE, -64, 600], [0, 0.17, -0.98], 500, 90, COOL, 0.5);
  void rng;
  m.start([0, 0, 2], 0, 0);
  return m;
}

/** Map settings for an Aperture-style industrial space: Source's camera and Portal 2's "behind the scenes" fog. */
export const BTS_SETTINGS = {
  camera: { model: 'source' },
  render: { internalHeight: 0, textureFilter: 'linear' },
  // @environment_bts_fog (every Portal 2 map carries it): colour 56 95 141, 1..5000, full density.
  fog: { enabled: true, source: true, color: '#385f8d', near: 1, far: 5000, maxDensity: 1 },
  hull: { voidZ: -3000 },
};
