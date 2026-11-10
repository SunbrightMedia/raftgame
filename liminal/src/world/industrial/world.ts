import { MapOut, NODRAW, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { walkTile, stairs, TILE, STEP, DX, DY, type Dir } from '../kit/aperture';
import { makeLayout, type Block, type Layout, type LayoutParams, type Street } from './layout';

/**
 * The industrial world's geometry, from a layout (layout.ts): what each mass
 * is made of, the steel around it, what runs through the streets. No lights
 * yet: this pass is judged in flat light.
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
};

export function industrial(seed: number, params: Partial<LayoutParams> = {}): { map: MapOut; layout: Layout } {
  const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]], ...params });
  const m = new MapOut();
  const root = new Rng(seed).fork('world');
  const L = lay.params.levels;
  const zOf = (level: number) => (level - Math.floor(L / 2)) * LEVEL;
  const centre = (x: number, y: number, level: number): V3 => [x * TILE + TILE / 2, y * TILE + TILE / 2, zOf(level)];
  const top = zOf(L - 1), bottom = zOf(0);
  /** A plain steel member (box), not lit finely. */
  const steel = (min: V3, max: V3, tex = T.steel) => m.box(min, max, { tex, group: 'func_detail', lightmapscale: 64, scale: 0.25 });

  // ---- masses
  for (const b of lay.blocks) {
    if (b.kind !== 'mass') continue;
    const r = root.fork(`mass${b.id}`);
    const x0 = b.rect.x0 * TILE + MARGIN, y0 = b.rect.y0 * TILE + MARGIN, x1 = b.rect.x1 * TILE - MARGIN, y1 = b.rect.y1 * TILE - MARGIN;
    // Most run out of sight above and below; some stop short, so you can see over or under them.
    const z1 = r.chance(0.3) ? zOf(r.int(1, L - 1)) + r.pick([-64, 96, 160]) : top + r.range(1500, 4500);
    const z0 = Math.min(r.chance(0.2) && z1 > top ? zOf(r.int(1, L - 1)) + 160 : bottom - r.range(1500, 4500), z1 - 512);
    const kind = r.weighted([['chambers', 4], ['machine', 3], ['pier', 2], ['frame', 2]] as const);
    if (kind === 'chambers') chamberStack(m, r, x0, y0, x1, y1, z0, z1, steel);
    else if (kind === 'frame') frameTower(m, r, x0, y0, x1, y1, z0, z1, steel);
    else {
      const tex = r.pick(kind === 'machine' ? T.dark : T.concrete);
      m.box([x0, y0, z0], [x1, y1, z1], { tex, lightmapscale: 64, scale: kind === 'pier' ? 0.5 : 0.25 });
      if (kind === 'machine') skeleton(r, x0, y0, x1, y1, z0, z1, 512, steel, r.pick([T.beamBlue, T.beamOrange, T.steel, T.steel]));
      wallRuns(m, r, x0, y0, x1, y1, z0, z1, kind === 'machine' ? 0.8 : 0.35);
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
      if (i >= i0 && i < i0 + 4) return;   // the stairs are here
      walkTile(m, centre(x, y, i < i0 ? lo : hi), axisMask);
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
    walkTile(m, centre(lay.junctions[j].x, lay.junctions[j].y, l), mask);
  }

  // ---- streets: frames across, hangers down to the catwalks, tube lines
  const walkAt = new Set<string>();   // `${tileX},${tileY},${level}` with a level catwalk tile
  for (const w of lay.walks) if (w.la === w.lb) for (const [x, y] of lay.segments[w.segment].tiles) walkAt.add(`${x},${y},${w.la}`);
  for (const s of lay.streets) streetSteel(m, root.fork(`street${s.id}`), s, lay, zOf, walkAt, steel);

  const S = lay.junctions[lay.start.junction];
  const sc = centre(S.x, S.y, lay.start.level);
  m.start([sc[0], sc[1], sc[2] + 2], 0, 0);
  return { map: m, layout: lay };
}

type Steel = (min: V3, max: V3, tex?: string) => number;

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
function chamberStack(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steel: Steel): void {
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
  skeleton(r, x0, y0, x1, y1, z0, z1, 512, steel, T.steel);
}

/** An open steel tower: columns, floors of beams, a few boxes held inside. You see through it. */
function frameTower(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steel: Steel): void {
  const bay = 512, C = 32;
  const grid = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  const xs = grid(x0, x1), ys = grid(y0, y1);
  const tex = r.pick([T.steel, T.steel, T.beamBlue, T.beamYellow]);
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

/** Ducts and pipes running along and up a mass's walls. */
function wallRuns(m: MapOut, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, density: number): void {
  // Each side: [a point on it, the direction along it, the outward normal, its length].
  const sides: { o: V3; along: Dir; out: Dir; len: number }[] = [
    { o: [x0, y0, 0], along: 0, out: 3, len: x1 - x0 }, { o: [x1, y0, 0], along: 1, out: 0, len: y1 - y0 },
    { o: [x1, y1, 0], along: 2, out: 1, len: x1 - x0 }, { o: [x0, y1, 0], along: 3, out: 2, len: y1 - y0 }];
  for (const { o, along, out, len } of sides) {
    // Vertical pipes (pipe_64_256: 67 across, 256 tall, standing on its origin's level ±128).
    for (let a = 256; a < len - 256; a += 256) {
      if (!r.chance(0.12 * density)) continue;
      const px = o[0] + DX[along] * a + DX[out] * 34, py = o[1] + DY[along] * a + DY[out] * 34;
      for (let z = Math.ceil(z0 / 256) * 256 + 128; z < z1; z += 256) m.prop('props_bts/pipe_64_256', [px, py, z], [0, 0, 0], { solid: false, hollow: true });
    }
    // Horizontal ducts (duct_512a: 512 long on its own x, 140 wide, 76 tall): flat against the wall.
    for (let z = Math.ceil(z0 / 384) * 384; z < z1; z += 384) {
      if (!r.chance(0.1 * density)) continue;
      const n = Math.floor(len / 512);
      for (let i = 0; i < n; i++) {
        const a = (len - n * 512) / 2 + 256 + i * 512;
        // Turned so its 76 side stands off the wall: roll 90 puts the duct's height along the outward normal.
        m.prop('props_bts/duct_512b', [o[0] + DX[along] * a + DX[out] * 22, o[1] + DY[along] * a + DY[out] * 22, z + 40], [0, along * 90, 90], { solid: false, hollow: true });
      }
    }
  }
}

/** What crosses and follows a street: frames across it, rods down to the catwalks, a vacuum tube line. */
function streetSteel(m: MapOut, r: Rng, s: Street, lay: Layout, zOf: (l: number) => number, walkAt: Set<string>, steel: Steel): void {
  const L = lay.params.levels;
  const along: Dir = s.axis === 0 ? 0 : 1, across: Dir = s.axis === 0 ? 1 : 0;
  const a0 = s.axis === 0 ? s.rect.x0 : s.rect.y0, a1 = s.axis === 0 ? s.rect.x1 : s.rect.y1;
  // The street runs wall to wall between the two masses' steel margins.
  const w0 = (s.axis === 0 ? s.rect.y0 : s.rect.x0) * TILE - MARGIN + 8, w1 = (s.axis === 0 ? s.rect.y1 : s.rect.x1) * TILE + MARGIN - 8;
  const laneC = s.lane * TILE + TILE / 2;
  const tile = (i: number): [number, number] => (s.axis === 0 ? [i, s.lane] : [s.lane, i]);
  const pt = (alongU: number, acrossU: number, z: number): V3 => (s.axis === 0 ? [alongU, acrossU, z] : [acrossU, alongU, z]);
  const bay = r.pick([3, 4, 4, 6]);
  for (let i = a0 + 1; i < a1; i += bay) {
    const [tx, ty] = tile(i);
    for (let l = 0; l < L; l++) {
      if (!walkAt.has(`${tx},${ty},${l}`)) continue;
      const z = zOf(l), u = i * TILE + TILE / 2;
      // A beam across the street above head height, with two rods down to a bar under the deck.
      const b0 = pt(u - 8, w0, z + 216), b1 = pt(u + 8, w1, z + 236);
      steel([Math.min(b0[0], b1[0]), Math.min(b0[1], b1[1]), z + 216], [Math.max(b0[0], b1[0]), Math.max(b0[1], b1[1]), z + 236]);
      for (const side of [-1, 1]) {
        const p = pt(u, laneC + side * 47, z);
        steel([p[0] - 1.5, p[1] - 1.5, z - 10], [p[0] + 1.5, p[1] + 1.5, z + 216]);
      }
      m.prop('props_bts/hanging_walkway_hanger_a', pt(u, laneC, z), [0, across * 90, 0], { solid: false });
    }
  }
  // A vacuum tube line beside the lane, where the street is wide enough, between two catwalk levels.
  if (s.width >= 3 && r.chance(0.55)) {
    const side = r.pick([-1, 1]);
    const off = laneC + side * Math.min(150, (s.width * TILE) / 2 - 20);
    const z = zOf(r.int(0, L - 1)) + r.pick([128, 128, 144, -112]);
    for (let u = a0 * TILE; u < a1 * TILE; u += TILE) {
      // vactube_128_straight runs from its origin along its own +y.
      m.prop('props_bts/vactube_128_straight', pt(u, off, z), [0, along * 90 - 90, 0], { solid: false, hollow: true });
      if ((u / TILE) % 4 === 0) m.prop('props_bts/vactube_connector', pt(u, off, z), [0, along * 90 - 90, 0], { solid: false });
    }
    // Hung from beams across the street every four tiles.
    for (let u = a0 * TILE + 2 * TILE; u < a1 * TILE; u += 4 * TILE) {
      const b0 = pt(u - 6, w0, z + 60), b1 = pt(u + 6, w1, z + 76);
      steel([Math.min(b0[0], b1[0]), Math.min(b0[1], b1[1]), z + 60], [Math.max(b0[0], b1[0]), Math.max(b0[1], b1[1]), z + 76]);
    }
  }
  void NODRAW; void lay;
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

export type { Block };
