import { MapOut, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { walkTile, stairs, TILE, STEP, DX, DY, WARM, type Dir } from '../kit/aperture';
import { makeLayout, type Layout, type LayoutParams } from './layout';

/**
 * The layout as bare geometry: masses as plain boxes, catwalks, stairs and
 * lamps. For judging the plan (sight lines, how tight the streets feel, where
 * the open halls fall) before any dressing, the way level designers block
 * out a map.
 */
const LEVEL = 2 * STEP;   // one catwalk level = two flights of stairs

export function blockout(seed: number, params: Partial<LayoutParams> = {}): { map: MapOut; layout: Layout } {
  const lay = makeLayout(seed, params);
  const m = new MapOut();
  const rng = new Rng(seed).fork('blockout');
  const L = lay.params.levels;
  const zOf = (level: number) => (level - Math.floor(L / 2)) * LEVEL;
  const centre = (x: number, y: number, level: number): V3 => [x * TILE + TILE / 2, y * TILE + TILE / 2, zOf(level)];
  const top = zOf(L - 1), bottom = zOf(0);

  // ---- masses: plain boxes, most running out of sight above and below, some stopping short.
  const WALLS = ['metal/black_wall_metal_002a', 'metal/black_wall_metal_002b', 'concrete/concrete_modular_wall001a', 'metal/metalwall_bts_006a'];
  for (const b of lay.blocks) {
    if (b.kind !== 'mass') continue;
    const r = rng.fork(`mass${b.id}`);
    const z1 = r.chance(0.3) ? zOf(r.int(0, L - 1)) + r.pick([-64, 96, 160]) : top + r.range(1200, 4200);
    const z0 = r.chance(0.2) && z1 > top ? zOf(r.int(1, L - 1)) + 160 : bottom - r.range(1500, 4500);
    m.box([b.rect.x0 * TILE, b.rect.y0 * TILE, Math.min(z0, z1 - 256)], [b.rect.x1 * TILE, b.rect.y1 * TILE, z1], { tex: r.pick(WALLS), lightmapscale: 64, scale: 0.5 });
  }

  // ---- catwalks
  const lamp = (c: V3, side: Dir) => {
    const p: V3 = [c[0] + DX[side] * 46, c[1] + DY[side] * 46, c[2] + 70];
    m.prop('props_bts/cage_light', p);
    m.light([p[0], p[1], p[2] + 6], WARM, 40, 96, 480);
    m.glow([p[0], p[1], p[2] + 2], WARM, 36);
  };
  let tileCount = 0;
  for (const w of lay.walks) {
    const s = lay.segments[w.segment];
    const up = w.lb >= w.la;
    const seq = up ? s.tiles : [...s.tiles].reverse();
    const d = (up ? s.dir : (s.dir + 2) % 4) as Dir;
    const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
    const axisMask = (1 << s.dir) | (1 << ((s.dir + 2) % 4));
    const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
    seq.forEach(([x, y], i) => {
      if (i >= i0 && i < i0 + 4) return;   // under the stairs
      const c = centre(x, y, i < i0 ? lo : hi);
      walkTile(m, c, axisMask);
      if (tileCount++ % 4 === 1) lamp(c, ((s.dir + 1 + 2 * (tileCount & 1)) % 4) as Dir);
    });
    if (lo !== hi) {
      const [x, y] = seq[i0];
      const c = centre(x, y, lo);
      const foot: V3 = [c[0] - DX[d] * TILE / 2, c[1] - DY[d] * TILE / 2, c[2]];
      stairs(m, foot, d);
      stairs(m, [foot[0] + DX[d] * 2 * TILE, foot[1] + DY[d] * 2 * TILE, foot[2] + STEP], d);
    }
  }
  for (const [k, mask] of lay.nodes) {
    const [j, l] = k.split(':').map(Number);
    const J = lay.junctions[j];
    const c = centre(J.x, J.y, l);
    walkTile(m, c, mask);
    lamp(c, ([0, 1, 2, 3] as Dir[]).find((dd) => !(mask & (1 << dd))) ?? 0);
  }
  const S = lay.junctions[lay.start.junction];
  const sc = centre(S.x, S.y, lay.start.level);
  m.start([sc[0], sc[1], sc[2] + 2], 0, 0);
  return { map: m, layout: lay };
}
