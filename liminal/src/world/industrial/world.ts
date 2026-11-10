import { MapOut, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { walkTile, stairs, tubePath, tubeLine, anglesFromYZ, TILE, STEP, DX, DY, type Dir } from '../kit/aperture';
import { makeLayout, type Block, type Layout, type LayoutParams, type Street } from './layout';

/**
 * The industrial world's geometry, from a layout (layout.ts): what each mass
 * is made of, the steel around it, what runs through the streets, what fills
 * the halls, and what has gone wrong. No lights yet: this is judged in flat
 * light.
 *
 * Three things keep places from repeating:
 *  - districts: the plan is shared out among a few district centres; each
 *    district has its own steel colour, mix of masses and amount of cables,
 *    tubes and pipes, so a walk crosses different characters;
 *  - the fault: one place where the world is breaking. Chaos (0..1) is high
 *    there and fades with distance: broken catwalks, tubes that end in mid
 *    air, things repeated like a stuck machine;
 *  - traces: a few shelters built from collected parts, at dead ends.
 *
 * Every mass keeps a margin of MARGIN units inside its block for its own
 * steel (columns, ring beams, pipes), so nothing it carries can reach a
 * catwalk, however narrow the street.
 */
const LEVEL = 2 * STEP;   // one catwalk level = two flights of stairs
const MARGIN = 64;

// Materials of modern Aperture's back-of-house (docs/P2_STUDY.md).
const T = {
  panels: ['anim_wp/framework/backpanels02', 'anim_wp/framework/backpanels'],       // the outside of test chamber walls
  dark: ['metal/metalwall_bts_001b', 'metal/metalwall_bts_006a'],
  concrete: ['concrete/concrete_bts_wall001a', 'concrete/concrete_bts_modular_wall001a'],
  black: 'metal/black_wall_metal_002a',
  steel: 'anim_wp/framework/squarebeams',
  beamBlue: 'metal/metalbeam_bts_001b', beamOrange: 'metal/metalbeam_bts_001a', beamYellow: 'metal/metalbeam_bts_001c',
  grate: 'metal/metalgrate_bts_001a',
  floor: 'metal/metalfloor_bts_001a',
};

export interface WorldParams extends Partial<LayoutParams> {
  /** How much goes wrong, overall (0 = a clean plant, 1 = badly broken near the fault). */
  chaos?: number;
}

interface MassBox { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }
interface District { x: number; y: number; steel: string; mass: (readonly [string, number])[]; cables: number; tubes: number; pipes: number }
type Steel = (min: V3, max: V3, tex?: string) => number;

interface Ctx {
  m: MapOut; lay: Layout; root: Rng; L: number;
  zOf: (level: number) => number;
  steel: Steel;
  masses: MassBox[];
  /** Floor heights of catwalk and stair tiles, by `${tileX},${tileY}`. */
  walkZ: Map<string, number[]>;
  districtAt: (x: number, y: number) => District;
  chaosAt: (x: number, y: number) => number;
  top: number; bottom: number; size: number;
}

export function industrial(seed: number, params: WorldParams = {}): { map: MapOut; layout: Layout } {
  const { chaos = 0.7, ...layoutParams } = params;
  const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]], ...layoutParams });
  const m = new MapOut();
  const root = new Rng(seed).fork('world');
  const L = lay.params.levels;
  const zOf = (level: number) => (level - Math.floor(L / 2)) * LEVEL;
  const centre = (x: number, y: number, level: number): V3 => [x * TILE + TILE / 2, y * TILE + TILE / 2, zOf(level)];
  const size = lay.params.size * TILE;
  const steel: Steel = (min, max, tex = T.steel) => m.box(min, max, { tex, group: 'func_detail', lightmapscale: 64, scale: 0.25 });

  // ---- districts
  const dr = root.fork('districts');
  const districts: District[] = Array.from({ length: 7 }, () => ({
    x: dr.range(0, size), y: dr.range(0, size),
    steel: dr.pick([T.steel, T.steel, T.steel, T.beamBlue, T.beamOrange, T.beamYellow]),
    mass: dr.pick([
      [['chambers', 6], ['machine', 2], ['pier', 1], ['frame', 2]],
      [['chambers', 2], ['machine', 5], ['pier', 2], ['frame', 1]],
      [['chambers', 1], ['machine', 2], ['pier', 5], ['frame', 1]],
      [['chambers', 2], ['machine', 2], ['pier', 1], ['frame', 6]],
    ] as (readonly [string, number])[][]),
    cables: dr.pick([0.3, 0.6, 1, 1.5, 2.5]), tubes: dr.pick([0.3, 0.7, 1, 1.6, 2.4]), pipes: dr.pick([0.2, 0.6, 1, 1.6]),
  }));
  const districtAt = (x: number, y: number) => districts.reduce((b, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(b.x - x, b.y - y) ? d : b));

  // ---- the fault: a used junction well away from the start
  const S = lay.junctions[lay.start.junction];
  const usedJ = [...new Set([...lay.nodes.keys()].map((k) => Number(k.split(':')[0])))].map((j) => lay.junctions[j]);
  // ...and not at the plan's edge: the break should have structure all around it.
  const N = lay.params.size;
  const far = usedJ.filter((j) => Math.hypot(j.x - S.x, j.y - S.y) > N * 0.25 && j.x > N * 0.2 && j.x < N * 0.8 && j.y > N * 0.2 && j.y < N * 0.8);
  const F = root.fork('fault').pick(far.length ? far : usedJ);
  const fault: [number, number] = [F.x * TILE, F.y * TILE];
  const chaosAt = (x: number, y: number) => chaos * Math.max(0.05, Math.min(1, 1 - Math.hypot(x - fault[0], y - fault[1]) / (size * 0.5)) ** 1.3);

  const ctx: Ctx = { m, lay, root, L, zOf, steel, masses: [], walkZ: new Map(), districtAt, chaosAt, top: zOf(L - 1), bottom: zOf(0), size };
  const noteWalk = (x: number, y: number, z: number) => { const k = `${x},${y}`; const a = ctx.walkZ.get(k); if (a) a.push(z); else ctx.walkZ.set(k, [z]); };

  // ---- masses
  for (const b of lay.blocks) {
    if (b.kind !== 'mass') continue;
    const r = root.fork(`mass${b.id}`);
    const x0 = b.rect.x0 * TILE + MARGIN, y0 = b.rect.y0 * TILE + MARGIN, x1 = b.rect.x1 * TILE - MARGIN, y1 = b.rect.y1 * TILE - MARGIN;
    const D = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
    // Most run out of sight above and below; some stop short, so you can see over or under them.
    const z1 = r.chance(0.3) ? zOf(r.int(1, L - 1)) + r.pick([-64, 96, 160]) : ctx.top + r.range(1500, 4500);
    const z0 = Math.min(r.chance(0.2) && z1 > ctx.top ? zOf(r.int(1, L - 1)) + 160 : ctx.bottom - r.range(1500, 4500), z1 - 512);
    ctx.masses.push({ x0, y0, x1, y1, z0, z1 });
    const kind = r.weighted(D.mass);
    if (kind === 'chambers') chamberStack(m, r, x0, y0, x1, y1, z0, z1, steel, D.steel);
    else if (kind === 'frame') frameTower(m, r, x0, y0, x1, y1, z0, z1, steel, D.steel);
    else {
      m.box([x0, y0, z0], [x1, y1, z1], { tex: r.pick(kind === 'machine' ? T.dark : T.concrete), lightmapscale: 64, scale: kind === 'pier' ? 0.5 : 0.25 });
      if (kind === 'machine') skeleton(r, x0, y0, x1, y1, z0, z1, 512, steel, D.steel);
      wallRuns(m, r, x0, y0, x1, y1, z0, z1, (kind === 'machine' ? 0.8 : 0.35) * D.pipes);
    }
  }

  // ---- catwalks
  const cw = root.fork('catwalks');
  for (const w of lay.walks) {
    const s = lay.segments[w.segment];
    const up = w.lb >= w.la;
    const seq = up ? s.tiles : [...s.tiles].reverse();
    const d = (up ? s.dir : (s.dir + 2) % 4) as Dir;
    const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
    const axisMask = (1 << s.dir) | (1 << ((s.dir + 2) % 4));
    const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
    // A spare connection near the fault may be broken: two tiles gone, torn ends hanging.
    const mid = seq[Math.floor(seq.length / 2)] ?? [0, 0];
    const broken = w.loop && lo === hi && seq.length >= 6 && cw.chance(Math.min(1, chaosAt(mid[0] * TILE, mid[1] * TILE) * 1.6)) ? Math.floor(seq.length / 2) - 1 : -1;
    seq.forEach(([x, y], i) => {
      if (i >= i0 && i < i0 + 4) { noteWalk(x, y, zOf(lo)); noteWalk(x, y, zOf(lo) + STEP); noteWalk(x, y, zOf(hi)); return; }   // the stairs are here
      if (i === broken || i === broken + 1) return;
      const c = centre(x, y, i < i0 ? lo : hi);
      walkTile(m, c, axisMask);
      noteWalk(x, y, c[2]);
    });
    if (broken >= 0) {
      const a = centre(seq[broken - 1][0], seq[broken - 1][1], lo), b = centre(seq[broken + 2][0], seq[broken + 2][1], lo);
      const back = ((d + 2) % 4) as Dir;
      // walkway_destroyed_128a hangs its wreck towards its own −y; _64a towards its +y.
      m.prop('props_bts/walkway_destroyed_128a', [a[0] + DX[d] * 64, a[1] + DY[d] * 64, a[2]], [0, back * 90 - 90, 0]);
      m.prop('props_bts/walkway_destroyed_64a', [b[0] - DX[d] * 64, b[1] - DY[d] * 64, b[2]], [0, back * 90 - 90, 0]);
    }
    if (lo !== hi) {
      const [x, y] = seq[i0];
      const c = centre(x, y, lo);
      const foot: V3 = [c[0] - DX[d] * TILE / 2, c[1] - DY[d] * TILE / 2, c[2]];
      stairs(m, foot, d);
      stairs(m, [foot[0] + DX[d] * 2 * TILE, foot[1] + DY[d] * 2 * TILE, foot[2] + STEP], d);
    }
  }
  // Junction tiles; dead ends may grow a spur, a shelter, or just stop.
  const ends: { c: V3; open: Dir }[] = [];
  for (const [k, mask] of lay.nodes) {
    const [j, l] = k.split(':').map(Number);
    const J = lay.junctions[j];
    const c = centre(J.x, J.y, l);
    noteWalk(J.x, J.y, c[2]);
    const open = ([0, 1, 2, 3] as Dir[]).filter((dd) => mask & (1 << dd));
    if (open.length === 1) ends.push({ c, open: open[0] });
    else walkTile(m, c, mask);
  }
  const er = root.fork('ends');
  let shelters = 0;
  for (const e of er.shuffle(ends)) {
    const withShelter = shelters < 6 && er.chance(0.5);
    if (er.chance(0.5) && spur(ctx, er, e.c, e.open, withShelter)) { if (withShelter) shelters++; continue; }
    walkTile(m, e.c, 1 << e.open);
  }

  // ---- streets: frames across, hangers down to the catwalks, tube lines, cables, bridges
  const walkAt = new Set<string>();   // `${tileX},${tileY},${level}` with a level catwalk tile
  for (const w of lay.walks) if (w.la === w.lb) for (const [x, y] of lay.segments[w.segment].tiles) walkAt.add(`${x},${y},${w.la}`);
  for (const s of lay.streets) streetSteel(ctx, root.fork(`street${s.id}`), s, walkAt);

  // ---- tubes in all directions, cables from wall to wall, the halls' machines, glitches
  wildTubes(ctx, root.fork('tubes'));
  for (const b of lay.blocks) if (b.kind === 'hall') hall(ctx, root.fork(`hall${b.id}`), b);
  glitches(ctx, root.fork('glitch'), fault);

  const sc = centre(S.x, S.y, lay.start.level);
  m.start([sc[0], sc[1], sc[2] + 2], 0, 0);
  return { map: m, layout: lay };
}

// ---------------------------------------------------------------- masses

/** Columns and ring beams standing off a box's four sides (inside the mass's own margin). */
function skeleton(r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, bay: number, steel: Steel, tex: string): void {
  const C = 24, OUT = 28;   // column size, how far its centre stands off the face
  const cols = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  for (const x of cols(x0, x1)) for (const y of [y0 - OUT, y1 + OUT]) steel([x - C / 2, y - C / 2, z0], [x + C / 2, y + C / 2, z1], tex);
  for (const y of cols(y0, y1).slice(1, -1)) for (const x of [x0 - OUT, x1 + OUT]) steel([x - C / 2, y - C / 2, z0], [x + C / 2, y + C / 2, z1], tex);
  // Ring beams every bay up the height, a little denser sometimes.
  const step = bay * r.pick([1, 1, 2]);
  for (let z = Math.ceil(z0 / step) * step; z < z1; z += step) {
    steel([x0 - OUT - 8, y0 - OUT - 8, z - 12], [x1 + OUT + 8, y0 - OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y1 + OUT - 8, z - 12], [x1 + OUT + 8, y1 + OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y0 - OUT + 8, z - 12], [x0 - OUT + 8, y1 + OUT - 8, z + 12], tex);
    steel([x1 + OUT - 8, y0 - OUT + 8, z - 12], [x1 + OUT + 8, y1 + OUT - 8, z + 12], tex);
  }
}

/**
 * A stack of test chambers seen from outside: boxes clad in the backs of
 * their wall panels, one above the other with gaps, held in a steel frame.
 */
function chamberStack(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steel: Steel, steelTex: string): void {
  const tex = r.pick(T.panels);
  let z = z0;
  while (z < z1 - 256) {
    const h = Math.min(z1 - z, r.pick([768, 1024, 1024, 1536, 2048]));
    // Each chamber is a little smaller than the frame, and not always the same size.
    const ix = r.pick([0, 0, 64, 128]), iy = r.pick([0, 0, 64, 128]);
    m.box([x0 + ix, y0 + iy, z], [x1 - ix, y1 - iy, z + h], { tex, lightmapscale: 64, scale: 0.25 });
    z += h;
    const gap = r.pick([128, 192, 256, 256, 512]);
    if (z < z1 - 256) m.box([x0 + 192, y0 + 192, z], [x1 - 192, y1 - 192, z + gap], { tex: T.black, lightmapscale: 128, scale: 0.5 });   // the dark core between chambers
    z += gap;
  }
  skeleton(r, x0, y0, x1, y1, z0, z1, 512, steel, steelTex);
}

/** An open steel tower: columns, floors of beams, a few boxes held inside. You see through it. */
function frameTower(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steel: Steel, tex: string): void {
  const bay = 512, C = 32;
  const grid = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  const xs = grid(x0, x1), ys = grid(y0, y1);
  for (const x of xs) for (const y of ys) steel([x - C / 2, y - C / 2, z0], [x + C / 2, y + C / 2, z1], tex);
  for (let z = Math.ceil(z0 / 512) * 512; z < z1; z += 512) {
    for (const y of ys) steel([x0, y - 10, z - 20], [x1, y + 10, z], tex);
    for (const x of xs) steel([x - 10, y0, z - 20], [x + 10, y1, z], tex);
    // Here and there a floor holds something: a tank room, a container.
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (!r.chance(0.16)) continue;
      const h = r.pick([256, 384, 448]);
      m.box([xs[i] + 48, ys[j] + 48, z], [xs[i + 1] - 48, ys[j + 1] - 48, z + h], { tex: r.pick([...T.dark, ...T.panels, 'metal/factory_container_01']), lightmapscale: 64 });
    }
  }
}

/** Ducts and pipes running along and up a mass's walls. Pipes end in a collar short of the mass's top and bottom. */
function wallRuns(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, density: number): void {
  const sides: { o: V3; along: Dir; out: Dir; len: number }[] = [
    { o: [x0, y0, 0], along: 0, out: 3, len: x1 - x0 }, { o: [x1, y0, 0], along: 1, out: 0, len: y1 - y0 },
    { o: [x1, y1, 0], along: 2, out: 1, len: x1 - x0 }, { o: [x0, y1, 0], along: 3, out: 2, len: y1 - y0 }];
  for (const { o, along, out, len } of sides) {
    // Vertical pipes (pipe_64_256: 67 across, 256 tall, centred on its origin).
    for (let a = 256; a < len - 256; a += 256) {
      if (!r.chance(0.12 * density)) continue;
      const px = o[0] + DX[along] * a + DX[out] * 34, py = o[1] + DY[along] * a + DY[out] * 34;
      const zs: number[] = [];
      for (let z = Math.ceil(z0 / 256) * 256 + 128; z < z1 - 128; z += 256) zs.push(z);
      for (const z of zs) m.prop('props_bts/pipe_64_256', [px, py, z], [0, 0, 0], { solid: false, hollow: true });
      if (zs.length) {
        m.prop('props_bts/pipe_64_rim', [px, py, zs[zs.length - 1] + 128], [0, 0, 0], { solid: false });
        m.prop('props_bts/pipe_64_rim', [px, py, zs[0] - 128], [0, 0, 0], { solid: false });
      }
    }
    // Horizontal ducts (duct_512b: 512 long on its own x, 70 wide, 38 tall): flat against the wall.
    for (let z = Math.ceil(z0 / 384) * 384; z < z1; z += 384) {
      if (!r.chance(0.1 * density)) continue;
      const n = Math.floor(len / 512);
      for (let i = 0; i < n; i++) {
        const a = (len - n * 512) / 2 + 256 + i * 512;
        m.prop('props_bts/duct_512b', [o[0] + DX[along] * a + DX[out] * 22, o[1] + DY[along] * a + DY[out] * 22, z + 40], [0, along * 90, 90], { solid: false, hollow: true });
      }
    }
  }
}

// ---------------------------------------------------------------- streets

/** What crosses and follows a street: frames across it, rods down to the catwalks, a tube line, cables, bridges of machinery. */
function streetSteel(ctx: Ctx, r: Rng, s: Street, walkAt: Set<string>): void {
  const { m, zOf, steel, L } = ctx;
  const along: Dir = s.axis === 0 ? 0 : 1, across: Dir = s.axis === 0 ? 1 : 0;
  const a0 = s.axis === 0 ? s.rect.x0 : s.rect.y0, a1 = s.axis === 0 ? s.rect.x1 : s.rect.y1;
  // The street runs wall to wall between the two masses' steel margins.
  const w0 = (s.axis === 0 ? s.rect.y0 : s.rect.x0) * TILE - MARGIN + 8, w1 = (s.axis === 0 ? s.rect.y1 : s.rect.x1) * TILE + MARGIN - 8;
  const laneC = s.lane * TILE + TILE / 2;
  const tile = (i: number): [number, number] => (s.axis === 0 ? [i, s.lane] : [s.lane, i]);
  const pt = (alongU: number, acrossU: number, z: number): V3 => (s.axis === 0 ? [alongU, acrossU, z] : [acrossU, alongU, z]);
  const box = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, tex?: string) => {
    const p = pt(u0, v0, z0), q = pt(u1, v1, z1);
    return steel([Math.min(p[0], q[0]), Math.min(p[1], q[1]), z0], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z1], tex);
  };
  const midU = ((a0 + a1) / 2) * TILE;
  const midP = pt(midU, laneC, 0);
  const D = ctx.districtAt(midP[0], midP[1]);
  const bay = r.pick([3, 4, 4, 6]);
  const last: (number | null)[] = Array.from({ length: L }, () => null);   // per level: the last frame's position along the street
  for (let i = a0 + 1; i < a1; i += bay) {
    const [tx, ty] = tile(i);
    for (let l = 0; l < L; l++) {
      if (!walkAt.has(`${tx},${ty},${l}`)) { last[l] = null; continue; }
      const z = zOf(l), u = i * TILE + TILE / 2;
      // A beam across the street above head height, with two rods down to a bar under the deck.
      box(u - 8, u + 8, w0, w1, z + 216, z + 236, D.steel);
      for (const side of [-1, 1]) {
        const p = pt(u, laneC + side * 47, z);
        steel([p[0] - 1.5, p[1] - 1.5, z - 10], [p[0] + 1.5, p[1] + 1.5, z + 216]);
      }
      m.prop('props_bts/hanging_walkway_hanger_a', pt(u, laneC, z), [0, across * 90, 0], { solid: false });
      // Cables strung from frame to frame along the walk.
      const prev = last[l];
      if (prev !== null) {
        const n = Math.round(r.range(0, 3) * D.cables);
        for (let k = 0; k < n; k++) {
          const off = laneC + r.pick([-1, 1]) * r.range(56, Math.max(60, (w1 - w0) / 2 - 20));
          m.rope(pt(prev, off, z + 216), pt(u, off + r.range(-6, 6), z + 216), r.range(10, 70), r.pick([2, 2, 3, 4]));
        }
      }
      last[l] = u;
    }
  }
  // A tube line beside the lane, where the street is wide enough, between two catwalk levels.
  if (s.width >= 3 && r.chance(Math.min(0.9, 0.4 * D.tubes))) {
    const n = r.chance(0.3) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const side = r.pick([-1, 1]);
      const off = laneC + side * Math.min(150, (s.width * TILE) / 2 - 20);
      const z = zOf(r.int(0, L - 1)) + r.pick([128, 128, 144, -112]) + k * 112;
      for (let u = a0 * TILE; u < a1 * TILE; u += TILE) {
        m.prop('props_bts/vactube_128_straight', pt(u, off, z), [0, along * 90 - 90, 0], { solid: false, hollow: true });
        if ((u / TILE) % 4 === 0) m.prop('props_bts/vactube_connector', pt(u, off, z), [0, along * 90 - 90, 0], { solid: false });
      }
      for (let u = a0 * TILE + 2 * TILE; u < a1 * TILE; u += 4 * TILE) box(u - 6, u + 6, w0, w1, z + 60, z + 76);
    }
  }
  // Cables from wall to wall, at any height, some very slack; a few hang loose.
  const len = (a1 - a0) * TILE;
  const nc = Math.round((len / 512) * r.range(0.5, 2) * D.cables * (1 + ctx.chaosAt(midP[0], midP[1])));
  for (let k = 0; k < nc; k++) {
    const u = a0 * TILE + r.range(0, len), z = r.range(ctx.bottom - 500, ctx.top + 900);
    const wide = w1 - w0;
    if (r.chance(0.2)) {
      // A loose end: fixed at one wall, hanging nearly straight down.
      const v = r.chance(0.5) ? w0 : w1;
      m.rope(pt(u, v, z), pt(u + r.range(-30, 30), v + (v === w0 ? 1 : -1) * r.range(4, 40), z - r.range(80, 700)), r.range(0, 12), r.pick([2, 3, 4]));
      continue;
    }
    const sag = r.chance(0.15) ? r.range(wide * 0.4, wide * 0.9) : r.range(wide * 0.04, wide * 0.25);
    const strands = r.chance(0.25) ? r.int(2, 5) : 1;
    const zb = z + r.range(-160, 160), du = r.range(-200, 200);
    for (let q = 0; q < strands; q++) m.rope(pt(u + q * 3, w0, z + q * 2), pt(u + du + q * 3, w1, zb), sag + q * r.range(2, 14), r.pick([2, 3, 3, 5]));
  }
  // A bridge of machinery across the street, above every catwalk under it: the canyon closes over for a stretch.
  if (len >= 8 * TILE && r.chance(0.3)) {
    const n = r.int(2, 6), i = r.int(a0 + 1, a1 - n - 1);
    let z = ctx.bottom - 4000;
    for (let t = i; t < i + n; t++) for (const wz of ctx.walkZ.get(tile(t).join(',')) ?? []) z = Math.max(z, wz + 240);
    if (z < ctx.bottom) z = zOf(r.int(0, L - 1)) + 240;
    const h = r.pick([256, 384, 512, 1024, 2048]);
    const p = pt(i * TILE, w0 - 8, z), q = pt((i + n) * TILE, w1 + 8, z + h);
    const lo: V3 = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), z], hi: V3 = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z + h];
    m.box(lo, hi, { tex: r.pick([...T.dark, ...T.panels]), lightmapscale: 64 });
    ctx.masses.push({ x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1], z0: z, z1: z + h });
  }
}

// ---------------------------------------------------------------- tubes

const inMass = (ctx: Ctx, p: V3, pad = 0) => ctx.masses.some((b) => p[0] > b.x0 - pad && p[0] < b.x1 + pad && p[1] > b.y0 - pad && p[1] < b.y1 + pad && p[2] > b.z0 - pad && p[2] < b.z1 + pad);
/** Would something `radius` thick, centred on p, cut through a catwalk or the space a walker needs on it? */
function hitsWalk(ctx: Ctx, p: V3, radius: number): boolean {
  const tx = Math.floor(p[0] / TILE), ty = Math.floor(p[1] / TILE);
  const reach = Math.ceil(radius / TILE);
  for (let x = tx - reach; x <= tx + reach; x++) for (let y = ty - reach; y <= ty + reach; y++) {
    const zs = ctx.walkZ.get(`${x},${y}`);
    if (!zs) continue;
    // Further from this tile sideways than the thing's size: no problem.
    const cx = Math.max(x * TILE - 8, Math.min(p[0], (x + 1) * TILE + 8)), cy = Math.max(y * TILE - 8, Math.min(p[1], (y + 1) * TILE + 8));
    if (Math.hypot(p[0] - cx, p[1] - cy) > radius) continue;
    for (const z of zs) if (p[2] > z - 18 - radius && p[2] < z + 98 + radius) return true;
  }
  return false;
}

/**
 * Transport tubes that leave a wall, wander in right-angle legs (up, down,
 * along, across) and enter another wall. Near the fault some never arrive:
 * they just stop in the open.
 */
function wildTubes(ctx: Ctx, r: Rng): void {
  const { m } = ctx;
  const AX: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const snap = (v: number) => Math.round(v / 128) * 128;
  for (const b of [...ctx.masses]) {
    const D = ctx.districtAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const n = Math.round(r.range(0, 4) * D.tubes);
    for (let t = 0; t < n; t++) {
      // Start on one of the mass's four sides, heading out.
      const side = r.int(0, 3);
      let d: V3 = AX[side];
      const z = snap(r.range(Math.max(b.z0, ctx.bottom - 700), Math.min(b.z1, ctx.top + 900)));
      const p0: V3 = side < 2 ? [snap(side === 0 ? b.x1 : b.x0), snap(r.range(b.y0 + 128, b.y1 - 128)), z] : [snap(r.range(b.x0 + 128, b.x1 - 128)), snap(side === 2 ? b.y1 : b.y0), z];
      const pts: V3[] = [[p0[0] - d[0] * 128, p0[1] - d[1] * 128, p0[2] - d[2] * 128]];   // begins inside the wall
      let cur = p0, ok = true, arrived = false;
      const legs = r.int(2, 6);
      for (let leg = 0; leg < legs && ok && !arrived; leg++) {
        const want = 128 * r.int(2, leg === 0 ? 5 : 18);
        // Walk the leg in steps; stop before a catwalk, stop (arrived) inside a mass once clear of the start.
        let run = 0;
        for (let u = 64; u <= want; u += 64) {
          const q: V3 = [cur[0] + d[0] * u, cur[1] + d[1] * u, cur[2] + d[2] * u];
          if (hitsWalk(ctx, q, 70) || q[0] < -500 || q[1] < -500 || q[0] > ctx.size + 500 || q[1] > ctx.size + 500) break;
          if (u % 128 === 0) run = u;
          if (leg > 0 && u % 128 === 0 && inMass(ctx, q)) { arrived = true; run = u + 128; break; }
        }
        if (run < 256) { ok = leg > 0; break; }
        cur = [cur[0] + d[0] * run, cur[1] + d[1] * run, cur[2] + d[2] * run];
        pts.push(cur);
        // Turn: any direction square to this one, a little more often up or down.
        const turns = AX.filter((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2] === 0);
        d = r.chance(0.3) ? r.pick(turns.filter((a) => a[2] !== 0).length ? turns.filter((a) => a[2] !== 0) : turns) : r.pick(turns);
      }
      if (!ok || pts.length < 3) continue;
      // Not arrived: near the fault it may simply end (a ring marks the torn end); otherwise it is not built.
      if (!arrived) {
        if (!r.chance(ctx.chaosAt(cur[0], cur[1]))) continue;
        const a = pts[pts.length - 2], e: V3 = [cur[0] - a[0], cur[1] - a[1], cur[2] - a[2]];
        m.prop('props_bts/vactube_connector', cur, anglesFromYZ(e, Math.abs(e[2]) > 1 ? [1, 0, 0] : [0, 0, 1]), { solid: false });
      }
      tubePath(m, pts);
    }
  }
}

// ---------------------------------------------------------------- halls

/** What fills an open hall: something very large, different from hall to hall. */
function hall(ctx: Ctx, r: Rng, b: Block): void {
  const { m, steel, zOf, L } = ctx;
  const x0 = b.rect.x0 * TILE, y0 = b.rect.y0 * TILE, x1 = b.rect.x1 * TILE, y1 = b.rect.y1 * TILE;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, d = y1 - y0;
  const D = ctx.districtAt(cx, cy);
  const kind = r.pick(['pods', 'tanks', 'fans', 'cluster', 'pods', 'tanks']);
  if (kind === 'pods') {
    // Container storage: gantry frames one above the other, rows of pods hanging under each.
    const turn = w < d;   // gantry_truss_a is 2048 long on its own x, 1006 wide
    for (let z = zOf(0) - 600; z < zOf(L - 1) + 1400; z += r.pick([520, 640, 900])) {
      m.prop('props_bts/gantry_truss_a', [cx, cy, z], [0, turn ? 90 : 0, 0], { solid: false });
      for (let k = -3; k <= 3; k++) {
        if (r.chance(0.35)) continue;
        // lab_pod_b: 246 wide, 522 long on its own y, 208 tall, standing on its origin.
        const p: V3 = turn ? [cx + r.pick([-260, 260]), cy + k * 280, z - 216 - 208] : [cx + k * 280, cy + r.pick([-260, 260]), z - 216 - 208];
        m.prop('props_bts/lab_pod_b', p, [0, turn ? 0 : 90, 0], { solid: false });
      }
    }
  } else if (kind === 'tanks') {
    // A tank farm on a deck: rows of tall tanks (neurotoxin_tank: 198 across, 729 tall, centred), on four legs.
    const z = zOf(r.int(0, L - 2)) - 80;
    const hw = Math.min(w, 2400) / 2 - 200, hd = Math.min(d, 2400) / 2 - 200;
    m.box([cx - hw - 100, cy - hd - 100, z - 48], [cx + hw + 100, cy + hd + 100, z], { tex: T.floor, lightmapscale: 32 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) steel([cx + sx * hw - 20, cy + sy * hd - 20, ctx.bottom - 3000], [cx + sx * hw + 20, cy + sy * hd + 20, z - 48], D.steel);
    for (let x = cx - hw + 150; x <= cx + hw - 150; x += 420) for (let y = cy - hd + 150; y <= cy + hd - 150; y += 420) {
      if (r.chance(0.2)) continue;
      m.prop('props_factory/neurotoxin_tank', [x, y, z + 365], [0, r.pick([0, 90, 180, 270]), 0]);
    }
  } else if (kind === 'fans') {
    // A wall of huge fans (huge_fan_rim: 1280 across, facing along its own y) on a slab across the hall.
    const alongX = w >= d;
    const span = Math.max(1, Math.floor((alongX ? w : d) / 1400)), rows = r.int(1, 3);
    const zc = zOf(Math.floor(L / 2));
    const a0 = (alongX ? cx : cy) - (span * 1400) / 2, zb = zc - (rows * 1400) / 2;
    const lo: V3 = alongX ? [a0 - 60, cy - 40, zb - 60] : [cx - 40, a0 - 60, zb - 60];
    const hi: V3 = alongX ? [a0 + span * 1400 + 60, cy + 40, zb + rows * 1400 + 60] : [cx + 40, a0 + span * 1400 + 60, zb + rows * 1400 + 60];
    m.box(lo, hi, { tex: r.pick(T.dark), lightmapscale: 64 });
    for (let i = 0; i < span; i++) for (let j = 0; j < rows; j++) {
      const a = a0 + 700 + i * 1400, z = zb + 700 + j * 1400;
      for (const face of [1, -1]) {
        const p: V3 = alongX ? [a, cy + face * 40, z] : [cx + face * 40, a, z];
        const yaw = alongX ? (face > 0 ? 180 : 0) : (face > 0 ? 90 : 270);
        m.prop('props_bts/huge_fan_rim', p, [0, yaw, 0], { solid: false });
        m.prop('props_bts/huge_fan', p, [0, yaw, r.range(0, 45)], { solid: false });
      }
    }
  } else {
    // A cluster of test chambers on their rails, hanging in the middle (Valve's own backdrop piece, scaled to the hall).
    const k = r.pick(['01', '02', '03']);
    const sc = Math.min(1, (Math.min(w, d) - 300) / (k === '01' ? 3500 : 2700));
    m.prop(`a4_destruction/bts_chambercluster_${k}`, [cx, cy, zOf(Math.floor(L / 2)) - 1200 * sc], [0, r.pick([0, 90, 180, 270]), 0], { solid: false, scale: Math.max(0.35, sc) });
  }
  // Tubes shot straight through the hall at any angle, wall to wall.
  const nt = Math.round(r.range(1, 5) * D.tubes);
  for (let t = 0; t < nt; t++) {
    const za = r.range(ctx.bottom - 600, ctx.top + 900), zb = r.range(ctx.bottom - 600, ctx.top + 900);
    const [p, q]: [V3, V3] = r.chance(0.5) ? [[x0 - 200, r.range(y0, y1), za], [x1 + 200, r.range(y0, y1), zb]] : [[r.range(x0, x1), y0 - 200, za], [r.range(x0, x1), y1 + 200, zb]];
    const steps = Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / 64);
    let clear = true;
    for (let i = 0; i <= steps && clear; i++) clear = !hitsWalk(ctx, [p[0] + ((q[0] - p[0]) * i) / steps, p[1] + ((q[1] - p[1]) * i) / steps, p[2] + ((q[2] - p[2]) * i) / steps], 70);
    if (clear) tubeLine(m, p, q);
  }
  // Long cables down into the hall from its edges.
  const nc = Math.round(r.range(4, 14) * D.cables);
  for (let k = 0; k < nc; k++) {
    const a: V3 = [r.pick([x0, x1]), r.range(y0, y1), r.range(ctx.top, ctx.top + 1500)];
    const e: V3 = [cx + r.range(-w / 4, w / 4), cy + r.range(-d / 4, d / 4), r.range(ctx.bottom - 300, ctx.top + 300)];
    m.rope(a, e, r.range(60, 500), r.pick([3, 4, 5, 6]));
  }
}

// ---------------------------------------------------------------- dead ends

/**
 * Past a dead end: the catwalk carries on at an angle (the kit's 60° piece),
 * a few tiles out over nothing, and ends at a platform. Some platforms hold a
 * shelter someone built from parts of the plant. Returns false if there is no
 * room for it.
 */
function spur(ctx: Ctx, r: Rng, c: V3, open: Dir, shelter: boolean): boolean {
  const { m } = ctx;
  const away = ((open + 2) % 4) as Dir;
  const h0: [number, number] = [DX[away], DY[away]];
  // hanging_walkway_angle_30 in its own frame: in at (0, −44) heading +y, out at (40.6, 23.45) heading 30° off +x.
  const turn = r.pick([1, 2]);
  const rot = (v: [number, number], yawDeg: number): [number, number] => { const a = (yawDeg * Math.PI) / 180; return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]; };
  // Plan it first (positions only), check for room, then build.
  const pieces: { model: string; p: V3; yaw: number }[] = [];
  let p: [number, number] = [c[0] + h0[0] * 64, c[1] + h0[1] * 64];   // the far edge of the dead-end tile
  let yaw = away * 90 - 90;                                            // yaw that points a piece's +y along the heading
  for (let k = 0; k < turn; k++) {
    const o1 = rot([0, 44], yaw), o: [number, number] = [p[0] + o1[0], p[1] + o1[1]];
    pieces.push({ model: 'hanging_walkway_angle_30', p: [o[0], o[1], c[2]], yaw });
    const ex = rot([40.6, 23.45], yaw);
    p = [o[0] + ex[0], o[1] + ex[1]];
    yaw -= 60;
  }
  const h = rot([0, 1], yaw);
  const n = r.int(2, 7);
  for (let k = 0; k < n; k++) pieces.push({ model: 'hanging_walkway_128a', p: [p[0] + h[0] * (64 + 128 * k), p[1] + h[1] * (64 + 128 * k), c[2]], yaw });
  const end: [number, number] = [p[0] + h[0] * 128 * n, p[1] + h[1] * 128 * n];
  // hanging_platform_a: a 395 × 235 deck; a walkway joins the middle of its notch at (128, 0), heading +y.
  const n0 = rot([128, 0], yaw), po: [number, number] = [end[0] - n0[0], end[1] - n0[1]];
  const c0 = rot([170, 120], yaw), pc: [number, number] = [po[0] + c0[0], po[1] + c0[1]];
  const probe: V3[] = [...pieces.map((e) => e.p), [pc[0], pc[1], c[2]], [pc[0] + 150, pc[1] + 150, c[2]], [pc[0] - 150, pc[1] - 150, c[2]], [pc[0] + 150, pc[1] - 150, c[2]], [pc[0] - 150, pc[1] + 150, c[2]]];
  for (const q of probe) {
    if (inMass(ctx, [q[0], q[1], q[2] + 40], 110)) return false;
    const k = `${Math.floor(q[0] / TILE)},${Math.floor(q[1] / TILE)}`;
    if ((ctx.walkZ.get(k) ?? []).some((z) => Math.abs(z - c[2]) < 200) && Math.hypot(q[0] - c[0], q[1] - c[1]) > 200) return false;
  }
  // Build: the dead-end tile becomes a plain straight, then the spur.
  walkTile(m, c, (1 << open) | (1 << away));
  for (const e of pieces) m.prop(`props_bts/${e.model}`, e.p, [0, e.yaw, 0]);
  m.prop('props_bts/hanging_platform_a', [po[0], po[1], c[2]], [0, yaw, 0]);
  if (shelter) shelterOn(ctx, r, [pc[0], pc[1], c[2]], yaw);
  return true;
}

/** A lean-to of wall panels with a bed, a chair, a radio, tins and bottles: somebody stayed here. */
function shelterOn(ctx: Ctx, r: Rng, c: V3, yaw: number): void {
  const { m } = ctx;
  const a = (yaw * Math.PI) / 180;
  const at = (x: number, y: number, z: number): V3 => [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), c[2] + z];
  const panel = 'props_factory/factory_panel_metal_dirty_128x128';   // 130 × 130 × 7, lying flat on its origin
  // Back wall and one side, each a little out of true; a roof of two panels, sagging.
  m.prop(panel, at(60, 96, 64), [r.range(84, 96), yaw + 90 + r.range(-4, 4), 0]);
  m.prop(panel, at(-70, 96, 64), [r.range(82, 97), yaw + 90 + r.range(-5, 5), 0]);
  m.prop(panel, at(124, 30, 64), [r.range(80, 95), yaw + r.range(-6, 6), 0]);
  m.prop(panel, at(55, 34, 122 + r.range(-4, 4)), [r.range(-9, 4), yaw + r.range(-5, 5), r.range(-4, 6)], { solid: false });
  m.prop(panel, at(-72, 36, 118 + r.range(-4, 4)), [r.range(-4, 10), yaw + r.range(-6, 6), r.range(-6, 4)], { solid: false });
  // Posts for the roof: two lengths of beam.
  m.prop('props_destruction/ibeam_256_8', at(124, -34, 60), [0, yaw, 0], { solid: false });
  m.prop('props_destruction/ibeam_256_8', at(-134, -30, 60), [r.range(-4, 4), yaw, r.range(-3, 3)], { solid: false });
  // Inside.
  m.prop('props/bed_body_reference', at(20, 60, 0), [0, yaw + r.range(-8, 8), 0], { solid: false });
  m.prop('props_bts/bts_chair', at(-70, 20, 19.5), [0, yaw + r.range(0, 360), 0], { solid: false });
  m.prop('props/metal_box', at(-20, -10, 18), [0, yaw + r.range(0, 90), 0], { solid: false });
  m.prop('props/radio_reference', at(-20, -10, 36), [0, yaw + r.range(120, 240), 0], { solid: false });
  for (let k = 0; k < r.int(3, 8); k++) m.prop(r.pick(['props/food_can/food_can_open', 'props/water_bottle/water_bottle']), at(r.range(-110, 100), r.range(-40, 70), r.pick([5, 10])), [0, r.range(0, 360), 0], { solid: false });
  m.prop('props_bts/bts_clipboard', at(-60, 70, 1), [0, r.range(0, 360), 0], { solid: false });
  // A line strung across, and a loose cable over the edge.
  m.rope(at(124, 34, 128), at(-134, 30, 124), r.range(8, 20), 2);
  m.rope(at(-134, 30, 124), at(-150, 60, r.range(-300, -80)), 4, 2);
}

// ---------------------------------------------------------------- glitches

/**
 * Near the fault, something repeats where it should not: one piece copied
 * again and again along a line, each copy shifted and turned a little, like
 * a machine stuck on one instruction.
 */
function glitches(ctx: Ctx, r: Rng, fault: [number, number]): void {
  const { m } = ctx;
  const n = Math.round(10 * ctx.chaosAt(fault[0], fault[1]));
  const kinds: { model: string; step: () => V3; turn: () => V3; count: [number, number] }[] = [
    { model: 'props_bts/hanging_stair_128', step: () => [0, 0, r.pick([24, 40, 64])], turn: () => [0, r.pick([15, 20, 30]), 0], count: [14, 40] },
    { model: 'props_bts/hanging_walkway_128a', step: () => [r.range(2, 10), 0, r.range(2, 12)], turn: () => [0, r.pick([4, 6, 10]), 0], count: [18, 60] },
    { model: 'props_bts/hanging_walkway_128a', step: () => [0, 0, r.pick([58, 64])], turn: () => [0, 0, 0], count: [10, 30] },
    { model: 'props_bts/truss_512', step: () => [r.range(10, 30), r.range(-6, 6), r.range(20, 60)], turn: () => [r.range(2, 6), r.range(3, 9), 0], count: [12, 36] },
    { model: 'props_bts/vactube_90deg_02', step: () => [0, 0, r.pick([40, 64])], turn: () => [0, r.pick([20, 30, 45]), 0], count: [12, 30] },
    { model: 'props_bts/bts_chair', step: () => [r.pick([0, 26]), r.pick([0, 26]), r.pick([0, 0, 40])], turn: () => [0, r.pick([0, 15, 90]), 0], count: [20, 70] },
    { model: 'props_bts/cage_light', step: () => [r.range(14, 30), 0, 0], turn: () => [0, 0, 0], count: [30, 90] },
  ];
  for (let g = 0; g < n; g++) {
    // Somewhere within reach of the fault, in the open, off the catwalks.
    let p: V3 | null = null;
    for (let tries = 0; tries < 30 && !p; tries++) {
      const a = r.range(0, Math.PI * 2), dist = r.range(0, ctx.size * 0.22);
      const q: V3 = [fault[0] + Math.cos(a) * dist, fault[1] + Math.sin(a) * dist, r.range(ctx.bottom - 200, ctx.top + 500)];
      if (!inMass(ctx, q, 260) && !hitsWalk(ctx, q, 260)) p = q;
    }
    if (!p) continue;
    const k = r.pick(kinds), st = k.step(), tu = k.turn();
    let ang: V3 = [0, r.pick([0, 90, 180, 270]), 0];
    const count = r.int(k.count[0], k.count[1]);
    for (let i = 0; i < count; i++) {
      const q: V3 = [p[0] + st[0] * i, p[1] + st[1] * i, p[2] + st[2] * i];
      if (inMass(ctx, q, 60) || hitsWalk(ctx, q, 150)) break;
      m.prop(k.model, q, ang, { solid: false, hollow: k.model.includes('vactube') });
      ang = [ang[0] + tu[0], ang[1] + tu[1], ang[2] + tu[2]];
    }
  }
}

/** Flat light, no bake: for judging geometry. A thin neutral haze only gives distance. */
export const GEOMETRY_SETTINGS = {
  camera: { model: 'source', sourceHdr: false },
  light: { enabled: false },
  render: { internalHeight: 0, textureFilter: 'linear', faceShade: 0.75 },
  fog: { enabled: true, source: true, color: '#8f979f', near: 600, far: 14000, maxDensity: 0.9 },
  // The Portal 2 kit is made for Source's player: 32 wide, 72 tall, eyes at 64.
  hull: { hullWidth: 32, standHeight: 72, duckHeight: 36, eyeHeight: 64, duckEyeHeight: 28, voidZ: -2600 },
};
