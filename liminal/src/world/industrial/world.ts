import { MapOut, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { walkTile, stairs, tubePath, TILE, STEP, DX, DY, type Dir } from '../kit/aperture';
import { makeLayout, type Block, type Layout, type LayoutParams, type Street } from './layout';

/**
 * The industrial world's geometry, from a layout (layout.ts): what each mass
 * is made of, the steel that carries everything, what runs through the
 * streets, what stands in the halls. A clean, working, empty plant. No lights
 * yet: this is judged in flat light.
 *
 * The rules it keeps (STYLE.md, "World: industrial v2"):
 *  - Nothing floats. Masses and columns run down out of sight (DEEP). Every
 *    catwalk hangs by rods from a beam; every beam ends on two columns that
 *    stand at the street's edges; tubes rest on brackets from those columns
 *    or on struts from a wall, and both their ends go into a wall.
 *  - A cable is tied at both ends, to beams.
 *  - Only the short kit list: walkways, stairs, beams, wall panels, tubes,
 *    pipes, ducts. What stands in a hall is built from the same.
 *  - Districts differ in what their masses are and how much pipe and tube
 *    they carry; steel is grey, here and there yellow.
 *
 * Every mass keeps a margin of MARGIN units inside its block for its own
 * steel (columns, ring beams, pipes), so nothing it carries can reach a
 * catwalk, however narrow the street.
 */
const LEVEL = 2 * STEP;   // one catwalk level = two flights of stairs
const MARGIN = 64;
/** How far below the lowest catwalk "out of sight" is (the review fog is solid well before this). */
const DEPTH = 9500;

// Materials of modern Aperture's back-of-house (docs/P2_STUDY.md).
const T = {
  panels: ['anim_wp/framework/backpanels02', 'anim_wp/framework/backpanels'],       // the outside of test chamber walls
  dark: ['metal/metalwall_bts_001b', 'metal/metalwall_bts_006a'],
  concrete: ['concrete/concrete_bts_wall001a', 'concrete/concrete_bts_modular_wall001a'],
  black: 'metal/black_wall_metal_002a',
  steel: 'anim_wp/framework/squarebeams',
  yellow: 'metal/metalbeam_bts_001c',
};

export type WorldParams = Partial<LayoutParams>;

type MassKind = 'chambers' | 'machine' | 'pier' | 'frame' | 'bridge';
interface MassBox { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; kind: MassKind }
interface District { x: number; y: number; steel: string; mass: (readonly [MassKind, number])[]; cables: number; tubes: number; pipes: number }
type Steel = (min: V3, max: V3, tex?: string) => number;

interface Ctx {
  m: MapOut; lay: Layout; root: Rng; L: number;
  zOf: (level: number) => number;
  steel: Steel;
  masses: MassBox[];
  /** Floor heights of catwalk and stair tiles, by `${tileX},${tileY}`. */
  walkZ: Map<string, number[]>;
  districtAt: (x: number, y: number) => District;
  top: number; bottom: number; deep: number; size: number;
}

export function industrial(seed: number, params: WorldParams = {}): { map: MapOut; layout: Layout } {
  const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]], ...params });
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
    steel: dr.pick([T.steel, T.steel, T.steel, T.steel, T.yellow]),
    mass: dr.pick([
      [['chambers', 6], ['machine', 2], ['pier', 1], ['frame', 2]],
      [['chambers', 2], ['machine', 5], ['pier', 2], ['frame', 1]],
      [['chambers', 1], ['machine', 2], ['pier', 5], ['frame', 1]],
      [['chambers', 2], ['machine', 2], ['pier', 1], ['frame', 6]],
    ] as (readonly [MassKind, number])[][]),
    cables: dr.pick([0, 0.5, 1, 1]), tubes: dr.pick([0.3, 0.7, 1, 1.6, 2.4]), pipes: dr.pick([0.2, 0.6, 1, 1.6]),
  }));
  const districtAt = (x: number, y: number) => districts.reduce((b, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(b.x - x, b.y - y) ? d : b));

  const bottom = zOf(0), top = zOf(L - 1);
  const ctx: Ctx = { m, lay, root, L, zOf, steel, masses: [], walkZ: new Map(), districtAt, top, bottom, deep: bottom - DEPTH, size };
  const noteWalk = (x: number, y: number, z: number) => { const k = `${x},${y}`; const a = ctx.walkZ.get(k); if (a) a.push(z); else ctx.walkZ.set(k, [z]); };

  // ---- masses: all stand on something that runs down out of sight
  for (const b of lay.blocks) {
    if (b.kind !== 'mass') continue;
    const r = root.fork(`mass${b.id}`);
    const x0 = b.rect.x0 * TILE + MARGIN, y0 = b.rect.y0 * TILE + MARGIN, x1 = b.rect.x1 * TILE - MARGIN, y1 = b.rect.y1 * TILE - MARGIN;
    const D = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
    const kind = r.weighted(D.mass);
    // Most run out of sight above; some stop short, so you can see over them.
    const z1 = r.chance(0.3) ? zOf(r.int(1, L - 1)) + r.pick([-64, 96, 160]) : top + r.range(1500, 4500);
    // A machine or a chamber stack may begin part-way up: then it stands on its steel frame, which goes on down.
    const raised = (kind === 'machine' || kind === 'chambers') && z1 > top && r.chance(0.2);
    const z0 = raised ? Math.min(zOf(r.int(1, L - 1)) + 160, z1 - 512) : ctx.deep;
    ctx.masses.push({ x0, y0, x1, y1, z0, z1, kind });
    if (kind === 'chambers') chamberStack(ctx, r, x0, y0, x1, y1, z0, z1, D.steel);
    else if (kind === 'frame') frameTower(ctx, r, x0, y0, x1, y1, z1, D.steel);
    else {
      m.box([x0, y0, z0], [x1, y1, z1], { tex: r.pick(kind === 'machine' ? T.dark : T.concrete), lightmapscale: 64, scale: kind === 'pier' ? 0.5 : 0.25 });
      if (kind === 'machine') skeleton(ctx, r, x0, y0, x1, y1, z0, z1, 512, D.steel);
      wallRuns(ctx, r, x0, y0, x1, y1, z0, z1, (kind === 'machine' ? 0.5 : 0.25) * D.pipes);
    }
  }

  // ---- catwalks
  for (const w of lay.walks) {
    const s = lay.segments[w.segment];
    const up = w.lb >= w.la;
    const seq = up ? s.tiles : [...s.tiles].reverse();
    const d = (up ? s.dir : (s.dir + 2) % 4) as Dir;
    const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
    const axisMask = (1 << s.dir) | (1 << ((s.dir + 2) % 4));
    const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
    seq.forEach(([x, y], i) => {
      if (i >= i0 && i < i0 + 4) { noteWalk(x, y, zOf(lo)); noteWalk(x, y, zOf(lo) + STEP); noteWalk(x, y, zOf(hi)); return; }   // the stairs are here
      const c = centre(x, y, i < i0 ? lo : hi);
      walkTile(m, c, axisMask);
      noteWalk(x, y, c[2]);
    });
    if (lo !== hi) {
      const [x, y] = seq[i0];
      const c = centre(x, y, lo);
      const foot: V3 = [c[0] - DX[d] * TILE / 2, c[1] - DY[d] * TILE / 2, c[2]];
      stairs(m, foot, d);
      stairs(m, [foot[0] + DX[d] * 2 * TILE, foot[1] + DY[d] * 2 * TILE, foot[2] + STEP], d);
    }
  }
  // Junction tiles. A few dead ends hold a small shelter; the rest just end.
  const er = root.fork('ends');
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
  const S = lay.junctions[lay.start.junction];
  const sc = centre(S.x, S.y, lay.start.level);
  // Shelters: far from the start and from each other.
  const sheltered: V3[] = [];
  for (const e of er.shuffle(ends)) {
    const farEnough = Math.hypot(e.c[0] - sc[0], e.c[1] - sc[1]) > size * 0.2 && sheltered.every((q) => Math.hypot(e.c[0] - q[0], e.c[1] - q[1]) > size * 0.25);
    if (sheltered.length < 4 && farEnough) { shelter(ctx, er, e.c, e.open); sheltered.push(e.c); } else walkTile(m, e.c, 1 << e.open);
  }

  // ---- streets: the frames that carry the catwalks and the tube lines; a few cables; bridges of machinery
  const walkAt = new Set<string>();   // `${tileX},${tileY},${level}` with a level catwalk tile
  for (const w of lay.walks) if (w.la === w.lb) for (const [x, y] of lay.segments[w.segment].tiles) walkAt.add(`${x},${y},${w.la}`);
  for (const s of lay.streets) street(ctx, root.fork(`street${s.id}`), s, walkAt);

  // ---- tubes that leave one wall and arrive in another; what stands in the halls
  wanderingTubes(ctx, root.fork('tubes'));
  for (const b of lay.blocks) if (b.kind === 'hall') hall(ctx, root.fork(`hall${b.id}`), b);

  m.start([sc[0], sc[1], sc[2] + 2], 0, 0);
  return { map: m, layout: lay };
}

// ---------------------------------------------------------------- masses

/**
 * Columns and ring beams standing off a box's four sides (inside the mass's
 * own margin). The columns always go down out of sight: a mass that begins
 * part-way up stands on them.
 */
function skeleton(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, bay: number, tex: string): void {
  const { steel } = ctx;
  const C = 24, OUT = 28;   // column size, how far its centre stands off the face
  const cols = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  for (const x of cols(x0, x1)) for (const y of [y0 - OUT, y1 + OUT]) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  for (const y of cols(y0, y1).slice(1, -1)) for (const x of [x0 - OUT, x1 + OUT]) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  // Ring beams up the height (closer together near the catwalks, where they are seen; under a raised mass they tie its legs).
  const step = bay * r.pick([1, 1, 2]);
  for (let z = Math.ceil((ctx.bottom - 2600) / step) * step + 208; z < z1; z += step) {
    steel([x0 - OUT - 8, y0 - OUT - 8, z - 12], [x1 + OUT + 8, y0 - OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y1 + OUT - 8, z - 12], [x1 + OUT + 8, y1 + OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y0 - OUT + 8, z - 12], [x0 - OUT + 8, y1 + OUT - 8, z + 12], tex);
    steel([x1 + OUT - 8, y0 - OUT + 8, z - 12], [x1 + OUT + 8, y1 + OUT - 8, z + 12], tex);
  }
  void z0;
}

/**
 * A stack of test chambers seen from outside: boxes clad in the backs of
 * their wall panels, one above the other with gaps, held in a steel frame.
 */
function chamberStack(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steelTex: string): void {
  const { m } = ctx;
  const tex = r.pick(T.panels);
  let z = z0;
  while (z < z1 - 256) {
    const h = Math.min(z1 - z, r.pick([768, 1024, 1024, 1536, 2048]));
    // Each chamber is a little smaller than the frame, and not always the same size.
    const ix = r.pick([0, 0, 64, 128]), iy = r.pick([0, 0, 64, 128]);
    m.box([x0 + ix, y0 + iy, z], [x1 - ix, y1 - iy, z + h], { tex, lightmapscale: 64, scale: 0.25 });
    z += h;
    const gap = r.pick([128, 192, 256, 256, 512]);
    if (z < z1 - 256) m.box([x0 + 192, y0 + 192, z], [x1 - 192, y1 - 192, z + gap], { tex: T.black, lightmapscale: 128, scale: 0.5 });   // the core the chambers hang on
    z += gap;
  }
  skeleton(ctx, r, x0, y0, x1, y1, z0, z1, 512, steelTex);
}

/** An open steel tower: columns, floors of beams, a few boxes held inside. You see through it. It stands out of sight below. */
function frameTower(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z1: number, tex: string): void {
  const { m, steel } = ctx;
  const bay = 512, C = 32;
  const grid = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  const xs = grid(x0, x1), ys = grid(y0, y1);
  for (const x of xs) for (const y of ys) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  // Floors of beams every 512 where they are seen, every 2048 far below.
  const near = ctx.bottom - 3072;
  for (let z = Math.ceil(ctx.deep / 2048) * 2048; z < z1; z += z < near ? 2048 : 512) {
    for (const y of ys) steel([x0, y - 10, z - 20], [x1, y + 10, z], tex);
    for (const x of xs) steel([x - 10, y0, z - 20], [x + 10, y1, z], tex);
    if (z < near) continue;
    // Here and there a floor holds a closed box (a plant room, a store), standing on the beams.
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (!r.chance(0.16)) continue;
      const h = r.pick([256, 384, 448]);
      m.box([xs[i] + 16, ys[j] + 16, z], [xs[i + 1] - 16, ys[j + 1] - 16, z + h], { tex: r.pick([...T.dark, ...T.panels]), lightmapscale: 64 });
    }
  }
}

/** Ducts and pipes fixed to a mass's walls. Pipes run from out of sight below to a collar near the top. */
function wallRuns(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, density: number): void {
  const { m } = ctx;
  const sides: { o: V3; along: Dir; out: Dir; len: number }[] = [
    { o: [x0, y0, 0], along: 0, out: 3, len: x1 - x0 }, { o: [x1, y0, 0], along: 1, out: 0, len: y1 - y0 },
    { o: [x1, y1, 0], along: 2, out: 1, len: x1 - x0 }, { o: [x0, y1, 0], along: 3, out: 2, len: y1 - y0 }];
  for (const { o, along, out, len } of sides) {
    // Vertical pipes (pipe_64_256: 67 across, 256 tall, centred on its origin), touching the wall.
    for (let a = 256; a < len - 256; a += 256) {
      if (!r.chance(0.1 * density)) continue;
      const px = o[0] + DX[along] * a + DX[out] * 34, py = o[1] + DY[along] * a + DY[out] * 34;
      let zt = z0;
      for (let z = Math.ceil(z0 / 256) * 256 + 128; z < z1 - 128; z += 256) { m.prop('props_bts/pipe_64_256', [px, py, z], [0, 0, 0], { solid: false, hollow: true }); zt = z + 128; }
      if (zt > z0) m.prop('props_bts/pipe_64_rim', [px, py, zt], [0, 0, 0], { solid: false });
    }
    // Horizontal ducts (duct_512b: 512 long on its own x, 70 wide, 38 tall), flat against the wall, the full width of it.
    for (let z = Math.ceil((ctx.bottom - 2600) / 384) * 384; z < z1 - 100; z += 384) {
      if (z < z0 + 100 || !r.chance(0.1 * density)) continue;
      const n = Math.ceil(len / 512);
      for (let i = 0; i < n; i++) {
        const a = Math.min(len - 256, 256 + i * 512);   // the last piece overlaps the one before, so the run ends at the wall's corner
        m.prop('props_bts/duct_512b', [o[0] + DX[along] * a + DX[out] * 19, o[1] + DY[along] * a + DY[out] * 19, z + 40], [0, along * 90, 90], { solid: false, hollow: true });
      }
    }
  }
}

// ---------------------------------------------------------------- streets

const inMass = (ctx: Ctx, p: V3, kinds?: MassKind[]) => ctx.masses.some((b) => (!kinds || kinds.includes(b.kind)) && p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1 && p[2] > b.z0 && p[2] < b.z1);
/** Masses with real walls a tube or a strut can go into (a chamber's wall may sit up to 128 inside its frame, so ends go in deep). */
const SOLID: MassKind[] = ['machine', 'pier', 'bridge', 'chambers'];

/**
 * A street's own structure: pairs of columns at its two edges (they stand
 * out of sight below), a beam across at each catwalk level with two rods
 * down to a bar under the deck, ties from frame to frame. Tube lines rest on
 * brackets from the same columns and turn into the walls at both ends. A few
 * cables run beam to beam. Here and there a box of machinery bridges the
 * street from wall to wall.
 */
function street(ctx: Ctx, r: Rng, s: Street, walkAt: Set<string>): void {
  const { m, lay, zOf, steel, L } = ctx;
  const N = lay.params.size;
  const across: Dir = s.axis === 0 ? 1 : 0;
  const a0 = s.axis === 0 ? s.rect.x0 : s.rect.y0, a1 = s.axis === 0 ? s.rect.x1 : s.rect.y1;
  const e0 = (s.axis === 0 ? s.rect.y0 : s.rect.x0), e1 = (s.axis === 0 ? s.rect.y1 : s.rect.x1);   // the street's two edges (tiles)
  const v0 = e0 * TILE - 12, v1 = e1 * TILE + 12;       // the column lines, just outside the street
  const laneC = s.lane * TILE + TILE / 2;
  const tile = (i: number): [number, number] => (s.axis === 0 ? [i, s.lane] : [s.lane, i]);
  const pt = (alongU: number, acrossU: number, z: number): V3 => (s.axis === 0 ? [alongU, acrossU, z] : [acrossU, alongU, z]);
  const box = (u0: number, u1: number, w0: number, w1: number, z0: number, z1: number, tex?: string) => {
    const p = pt(u0, w0, z0), q = pt(u1, w1, z1);
    return steel([Math.min(p[0], q[0]), Math.min(p[1], q[1]), z0], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z1], tex);
  };
  // Is there a block (a mass or a hall's edge), not another street's mouth, beside the street at tile i on this side?
  const blockBeside = (i: number, side: 0 | 1) => {
    const [x, y] = s.axis === 0 ? [i, side ? e1 : e0 - 1] : [side ? e1 : e0 - 1, i];
    return x >= 0 && y >= 0 && x < N && y < N && lay.tileBlock[y * N + x] >= 0;
  };
  const midP = pt(((a0 + a1) / 2) * TILE, laneC, 0);
  const D = ctx.districtAt(midP[0], midP[1]);

  // ---- a tube line beside the lane, between two catwalk levels; both ends turn into a solid wall
  const half = (s.width * TILE) / 2;
  let tube: { off: number; z: number; from: number; to: number; side: number } | null = null;
  if (s.width >= 3 && r.chance(Math.min(0.9, 0.4 * D.tubes))) {
    const side = r.pick([-1, 1]);
    const off = laneC + side * (half - 64);
    const z = zOf(r.int(0, L - 1)) + r.pick([128, 128, 144, -112]);
    const wallAt = (i: number) => inMass(ctx, pt(i * TILE + TILE / 2, laneC + side * (half + MARGIN + 60), z), SOLID);
    let from = a0, to = a1 - 1;
    while (from < to && !wallAt(from)) from++;
    while (to > from && !wallAt(to)) to--;
    if (to - from >= 4) {
      tube = { off, z, from, to, side };
      const uA = from * TILE + TILE / 2, uB = to * TILE + TILE / 2, into = off + side * 512;
      tubePath(m, [pt(uA, into, z), pt(uA, off, z), pt(uB, off, z), pt(uB, into, z)]);
    }
  }

  // ---- frames
  const bay = r.pick([3, 4, 4, 6]);
  const last: (number | null)[] = Array.from({ length: L }, () => null);   // per level: the last frame's position along the street
  let next = a0;
  for (let i = a0; i < a1; i++) {
    if (i < next || !blockBeside(i, 0) || !blockBeside(i, 1)) continue;
    const [tx, ty] = tile(i);
    const levels = Array.from({ length: L }, (_, l) => l).filter((l) => walkAt.has(`${tx},${ty},${l}`));
    const carriesTube = tube !== null && i > tube.from && i < tube.to;
    if (!levels.length && !carriesTube) { last.fill(null); continue; }
    next = i + bay;
    const u = i * TILE + TILE / 2;
    const zTop = Math.max(...levels.map((l) => zOf(l) + 236), carriesTube ? tube!.z + 40 : -1e9);
    for (const v of [v0, v1]) { const p = pt(u, v, 0); steel([p[0] - 8, p[1] - 8, ctx.deep], [p[0] + 8, p[1] + 8, zTop + 8], D.steel); }
    for (let l = 0; l < L; l++) {
      if (!levels.includes(l)) { last[l] = null; continue; }
      const z = zOf(l);
      // The beam across, the two rods down, the bar under the deck.
      box(u - 8, u + 8, v0, v1, z + 216, z + 236, D.steel);
      for (const side of [-1, 1]) { const p = pt(u, laneC + side * 47, z); steel([p[0] - 1.5, p[1] - 1.5, z - 10], [p[0] + 1.5, p[1] + 1.5, z + 216]); }
      m.prop('props_bts/hanging_walkway_hanger_a', pt(u, laneC, z), [0, across * 90, 0], { solid: false });
      const prev = last[l];
      if (prev !== null && u - prev <= 8 * TILE) {
        // Ties along both column lines, and now and then a pair of cables slung beam to beam beside the walk.
        for (const v of [v0, v1]) box(prev + 8, u - 8, v - 5, v + 5, z + 220, z + 232, D.steel);
        if (r.chance(0.3 * D.cables)) {
          const off = laneC + r.pick([-1, 1]) * Math.min(half - 12, r.range(58, 90));
          const sag = r.range(6, 22);
          m.rope(pt(prev, off, z + 217), pt(u, off, z + 217), sag, 3);
          if (r.chance(0.5)) m.rope(pt(prev, off + 6, z + 217), pt(u, off + 6, z + 217), sag + r.range(2, 6), 2);
        }
      }
      last[l] = u;
    }
    if (carriesTube) {
      // A bracket from the nearer column, under the tube (the tube is 104 across), with a ring round the tube above it.
      const v = tube!.side > 0 ? v1 : v0;
      box(u - 6, u + 6, Math.min(v, tube!.off - tube!.side * 56), Math.max(v, tube!.off - tube!.side * 56), tube!.z - 66, tube!.z - 54, D.steel);
      m.prop('props_bts/vactube_connector', pt(u, tube!.off, tube!.z), [0, (s.axis === 0 ? 0 : 1) * 90 - 90, 0], { solid: false });
    }
  }

  // ---- a box of machinery from wall to wall, above every catwalk under it: the street closes over for a stretch
  const len = (a1 - a0) * TILE;
  if (len >= 8 * TILE && r.chance(0.3)) {
    const n = r.int(2, 6), i = r.int(a0 + 1, a1 - n - 1);
    let z = -1e9;
    for (let t = i; t < i + n; t++) for (const wz of ctx.walkZ.get(tile(t).join(',')) ?? []) z = Math.max(z, wz + 248);
    if (z < -1e8) z = zOf(r.int(0, L - 1)) + 248;
    const h = r.pick([256, 384, 512, 1024, 2048]);
    const w0 = e0 * TILE - MARGIN, w1 = e1 * TILE + MARGIN;   // the two masses' faces
    // It needs a wall to sit in at both ends, along its whole length, at this height.
    let held = true;
    for (let t = i; t < i + n && held; t++) for (const zz of [z + 8, z + h - 8]) held &&= inMass(ctx, pt(t * TILE + 64, w0 - 40, zz)) && inMass(ctx, pt(t * TILE + 64, w1 + 40, zz));
    if (held) {
      const p = pt(i * TILE, w0, z), q = pt((i + n) * TILE, w1, z + h);
      const lo: V3 = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), z], hi: V3 = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z + h];
      m.box(lo, hi, { tex: r.pick([...T.dark, ...T.panels]), lightmapscale: 64 });
      ctx.masses.push({ x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1], z0: z, z1: z + h, kind: 'bridge' });
    }
  }
}

// ---------------------------------------------------------------- tubes

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
    for (const z of zs) if (p[2] > z - 18 - radius && p[2] < z + 248 + radius) return true;   // up to the beam over the walk
  }
  return false;
}

/** The nearest solid wall beside p (straight along x or y, at p's height): how far, and which way. */
function nearestWall(ctx: Ctx, p: V3): { dist: number; dir: [number, number] } | null {
  let best: { dist: number; dir: [number, number] } | null = null;
  const take = (dist: number, dir: [number, number]) => { if (dist >= 0 && (!best || dist < best.dist)) best = { dist, dir }; };
  for (const b of ctx.masses) {
    if (!SOLID.includes(b.kind) || p[2] < b.z0 + 8 || p[2] > b.z1 - 8) continue;
    if (p[1] > b.y0 + 8 && p[1] < b.y1 - 8) { take(b.x0 - p[0], [1, 0]); take(p[0] - b.x1, [-1, 0]); }
    if (p[0] > b.x0 + 8 && p[0] < b.x1 - 8) { take(b.y0 - p[1], [0, 1]); take(p[1] - b.y1, [0, -1]); }
  }
  return best;
}

/**
 * Transport tubes that leave a solid wall, turn a few times (up, down, along,
 * across) and enter another solid wall. One that finds no wall to end in, or
 * runs too far from any wall to be held, is not built. Each is held by struts
 * to the nearest wall along its way.
 */
function wanderingTubes(ctx: Ctx, r: Rng): void {
  const { m, steel } = ctx;
  const AX: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const snap = (v: number) => Math.round(v / 128) * 128;
  const REACH = 460;   // the longest strut
  for (const b of [...ctx.masses]) {
    if (b.kind !== 'machine' && b.kind !== 'pier' && b.kind !== 'chambers') continue;
    const D = ctx.districtAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const n = Math.round(r.range(1, 5) * D.tubes);
    let built = 0;
    for (let t = 0; t < n * 8 && built < n; t++) {
      const side = r.int(0, 3);
      let d: V3 = AX[side];
      const z = snap(r.range(Math.max(b.z0 + 200, ctx.bottom - 700), Math.min(b.z1 - 200, ctx.top + 900)));
      const p0: V3 = side < 2 ? [snap(side === 0 ? b.x1 : b.x0), snap(r.range(b.y0 + 128, b.y1 - 128)), z] : [snap(r.range(b.x0 + 128, b.x1 - 128)), snap(side === 2 ? b.y1 : b.y0), z];
      const pts: V3[] = [[p0[0] - d[0] * 384, p0[1] - d[1] * 384, p0[2] - d[2] * 384]];   // begins well inside the wall
      let cur = p0, arrived = false;
      for (let leg = 0; leg < r.int(2, 6) && !arrived; leg++) {
        const want = 128 * r.int(2, leg === 0 ? 4 : 16);
        let run = 0;
        for (let u = 64; u <= want; u += 64) {
          const q: V3 = [cur[0] + d[0] * u, cur[1] + d[1] * u, cur[2] + d[2] * u];
          if (hitsWalk(ctx, q, 70) || q[0] < 0 || q[1] < 0 || q[0] > ctx.size || q[1] > ctx.size) break;
          if (u % 128 === 0) run = u;
          if (leg > 0 && u % 128 === 0 && inMass(ctx, q, SOLID)) { arrived = true; run = u + 384; break; }
        }
        if (run < 256) break;
        cur = [cur[0] + d[0] * run, cur[1] + d[1] * run, cur[2] + d[2] * run];
        pts.push(cur);
        const turns = AX.filter((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2] === 0);
        const upDown = turns.filter((a) => a[2] !== 0);
        d = r.chance(0.3) && upDown.length ? r.pick(upDown) : r.pick(turns);
      }
      if (!arrived || pts.length < 3) continue;
      // Struts: every 512 along each leg that is out in the open. No wall within reach on a long leg: not built.
      const struts: { p: V3; w: { dist: number; dir: [number, number] } }[] = [];
      let held = true;
      for (let i = 0; i < pts.length - 1 && held; i++) {
        const a = pts[i], e = pts[i + 1], len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
        const dir: V3 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len, (e[2] - a[2]) / len];
        for (let u = 256; u < len - 128; u += 512) {
          const p: V3 = [a[0] + dir[0] * u, a[1] + dir[1] * u, a[2] + dir[2] * u];
          if (inMass(ctx, p)) continue;
          const w = nearestWall(ctx, p);
          // A strut must run square to the tube, not along it.
          if (w && w.dist <= REACH && Math.abs(w.dir[0] * dir[0] + w.dir[1] * dir[1]) < 0.5) struts.push({ p, w });
          else if (len > 1024) held = false;
        }
      }
      if (!held) continue;
      built++;
      tubePath(m, pts);
      for (const { p, w } of struts) {
        const q: V3 = [p[0] + w.dir[0] * (w.dist + 136), p[1] + w.dir[1] * (w.dist + 136), p[2]];
        const s0: V3 = [p[0] + w.dir[0] * 50, p[1] + w.dir[1] * 50, p[2]];
        steel([Math.min(s0[0], q[0]) - 5, Math.min(s0[1], q[1]) - 5, p[2] - 6], [Math.max(s0[0], q[0]) + 5, Math.max(s0[1], q[1]) + 5, p[2] + 6]);
      }
    }
  }
}

// ---------------------------------------------------------------- halls

/**
 * An open hall: sometimes left empty (the open space is the point), sometimes
 * with one free-standing steel tower in the middle, built like the others and
 * standing out of sight below.
 */
function hall(ctx: Ctx, r: Rng, b: Block): void {
  if (r.chance(0.45)) return;
  const x0 = b.rect.x0 * TILE, y0 = b.rect.y0 * TILE, x1 = b.rect.x1 * TILE, y1 = b.rect.y1 * TILE;
  const w = x1 - x0, d = y1 - y0;
  // The tower takes the middle; a wide ring of open air stays round it.
  const fx = Math.max(512, Math.round((w * r.range(0.35, 0.6)) / 512) * 512), fy = Math.max(512, Math.round((d * r.range(0.35, 0.6)) / 512) * 512);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const D = ctx.districtAt(cx, cy);
  frameTower(ctx, r, cx - fx / 2, cy - fy / 2, cx + fx / 2, cy + fy / 2, ctx.top + r.range(600, 3000), D.steel);
  ctx.masses.push({ x0: cx - fx / 2, y0: cy - fy / 2, x1: cx + fx / 2, y1: cy + fy / 2, z0: ctx.deep, z1: ctx.top + 600, kind: 'frame' });
}

// ---------------------------------------------------------------- shelters

/**
 * At a dead end, a wider landing with a small lean-to in its corner: three
 * wall panels someone carried here. Easy to walk past.
 */
function shelter(ctx: Ctx, r: Rng, c: V3, open: Dir): void {
  const { m } = ctx;
  const away = ((open + 2) % 4) as Dir;
  const yaw = away * 90 - 90;   // the landing's own +y points away from the way in
  // hanging_walkway_end_b: a 110 × 110 landing (x −70..40, y −40..70) entered from its −y side.
  m.prop('props_bts/hanging_walkway_end_b', c, [0, yaw, 0]);
  const a = (yaw * Math.PI) / 180;
  const at = (x: number, y: number, z: number): V3 => [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), c[2] + z];
  const panel = 'props_factory/factory_panel_metal_dirty_128x128';   // 130 × 130 × 7 lying flat; used at just over half size
  const sc = 0.56;
  // In the far corner: one panel upright along the back rail, one along the side rail, one laid over them.
  m.prop(panel, at(-34, 64, 36), [90, yaw + 90, 0], { scale: sc, solid: false });
  m.prop(panel, at(-66, 30, 36), [90, yaw, 0], { scale: sc, solid: false });
  m.prop(panel, at(-33, 31, 74), [r.range(-4, 2), yaw + r.range(-3, 3), 0], { scale: sc, solid: false });
}

/** Flat light, no bake: for judging geometry. A neutral haze hides what runs out of sight. */
export const GEOMETRY_SETTINGS = {
  camera: { model: 'source', sourceHdr: false },
  light: { enabled: false },
  render: { internalHeight: 0, textureFilter: 'linear', faceShade: 0.75 },
  fog: { enabled: true, source: true, color: '#8f979f', near: 400, far: 9000, maxDensity: 1 },
  // The Portal 2 kit is made for Source's player: 32 wide, 72 tall, eyes at 64.
  hull: { hullWidth: 32, standHeight: 72, duckHeight: 36, eyeHeight: 64, duckEyeHeight: 28, voidZ: -2600 },
};
