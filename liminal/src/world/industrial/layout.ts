import { Rng } from '../rng';
import type { Dir } from '../kit/aperture';

/**
 * The plan of an industrial world, before any geometry: a city of huge
 * masses (machines, chamber stacks, piers) cut by narrow streets, a few
 * blocks left empty as halls, and a maze of catwalks through the streets on
 * several levels. Everything is on the kit's tile grid (one tile = 128 units).
 *
 *  1. Blocks and streets: the plan is split again and again, each cut leaving
 *     a street. Cuts stop at random sizes, so streets meet at T-junctions and
 *     no two blocks are alike.
 *  2. Lanes: each street has one line of tiles a catwalk can run on. Where
 *     lanes meet is a junction; between junctions is a segment.
 *  3. The maze: over (junction, level) pairs. A segment can carry a level
 *     catwalk on any level, or stairs from one level to the next. A random
 *     tree is grown from the start (winding, with branches), then a few
 *     loops are added.
 *
 * Pure data, fixed by the seed: the same seed is always the same world.
 */
export interface Rect { x0: number; y0: number; x1: number; y1: number }   // tiles, x1/y1 exclusive
export interface Block { id: number; rect: Rect; kind: 'mass' | 'hall' }
export interface Street { id: number; rect: Rect; /** 0 = runs along x, 1 = along y. */ axis: 0 | 1; /** The lane's fixed coordinate (y for axis 0, x for axis 1). */ lane: number; width: number }
export interface Junction { id: number; x: number; y: number }
/** A run of lane tiles between two junctions (a's and b's tiles not included). */
export interface Segment { id: number; a: number; b: number; /** Direction from a to b. */ dir: Dir; tiles: [number, number][] }
/** A catwalk on a segment: level `la` at a to level `lb` at b (equal = flat, else one level of stairs). */
export interface Walk { segment: number; la: number; lb: number; /** A spare connection: the maze stays in one piece without it. */ loop: boolean }

export interface LayoutParams {
  /** Plan size in tiles. */
  size: number;
  /** Blocks are cut until no side is longer than this (tiles)... */
  maxBlock: number;
  /** ...and never below this. */
  minBlock: number;
  /** Street widths to pick from (tiles), with weights. */
  streets: (readonly [number, number])[];
  /** Number of catwalk levels. */
  levels: number;
  /** Share of blocks left empty as halls (by count, biggest favoured). */
  hallShare: number;
  /** How much of the (junction, level) lattice the maze takes. */
  fill: number;
  /** Chance that a spare connection between two parts of the maze is built (loops). */
  loops: number;
  /** Chance a step of the maze is a stair rather than level (when both are possible). */
  stairs: number;
  /** Tiles a stair segment needs (two flights of two tiles, with a tile to spare each end). */
  stairTiles: number;
}

export const DEFAULT_LAYOUT: LayoutParams = {
  size: 160, maxBlock: 30, minBlock: 9,
  streets: [[2, 3], [3, 4], [4, 2], [6, 1]],
  levels: 5, hallShare: 0.14, fill: 0.5, loops: 0.12, stairs: 0.3, stairTiles: 6,
};

export interface Layout {
  params: LayoutParams;
  blocks: Block[];
  streets: Street[];
  junctions: Junction[];
  segments: Segment[];
  walks: Walk[];
  /** Maze nodes in use: key `${junction}:${level}` → bit mask of directions with a catwalk. */
  nodes: Map<string, number>;
  start: { junction: number; level: number };
}

export function makeLayout(seed: number, params: Partial<LayoutParams> = {}): Layout {
  const P = { ...DEFAULT_LAYOUT, ...params };
  const root = new Rng(seed);
  const N = P.size;

  // ---- 1. blocks and streets
  const blocks: Block[] = [], streets: Street[] = [];
  const cut = new Rng(root.fork('blocks').seed);
  const split = (r: Rect) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const big = Math.max(w, h);
    // Stop when small enough; sometimes earlier, for variety in block size.
    if (big <= P.maxBlock && (big < 2 * P.minBlock + 2 || cut.chance(0.55))) { blocks.push({ id: blocks.length, rect: r, kind: 'mass' }); return; }
    const sw = cut.weighted(P.streets);
    const along: 0 | 1 = w > h || (w === h && cut.chance(0.5)) ? 0 : 1;   // 0: cut the x extent
    const len = along === 0 ? w : h;
    if (len < 2 * P.minBlock + sw) { blocks.push({ id: blocks.length, rect: r, kind: 'mass' }); return; }
    const p = Math.round(cut.range(P.minBlock, len - sw - P.minBlock));
    if (along === 0) {
      const sx = r.x0 + p;
      streets.push({ id: streets.length, rect: { x0: sx, y0: r.y0, x1: sx + sw, y1: r.y1 }, axis: 1, lane: sx + Math.floor(sw / 2), width: sw });
      split({ x0: r.x0, y0: r.y0, x1: sx, y1: r.y1 }); split({ x0: sx + sw, y0: r.y0, x1: r.x1, y1: r.y1 });
    } else {
      const sy = r.y0 + p;
      streets.push({ id: streets.length, rect: { x0: r.x0, y0: sy, x1: r.x1, y1: sy + sw }, axis: 0, lane: sy + Math.floor(sw / 2), width: sw });
      split({ x0: r.x0, y0: r.y0, x1: r.x1, y1: sy }); split({ x0: r.x0, y0: sy + sw, x1: r.x1, y1: r.y1 });
    }
  };
  split({ x0: 0, y0: 0, x1: N, y1: N });
  // Halls: some blocks stay empty. Bigger blocks are likelier, never ones on the plan's edge.
  const inner = blocks.filter((b) => b.rect.x0 > 0 && b.rect.y0 > 0 && b.rect.x1 < N && b.rect.y1 < N);
  const hallRng = root.fork('halls');
  const want = Math.round(blocks.length * P.hallShare);
  const pool = inner.map((b) => [b, ((b.rect.x1 - b.rect.x0) * (b.rect.y1 - b.rect.y0)) ** 1.5] as const);
  for (let i = 0; i < want && pool.length; i++) {
    const b = hallRng.weighted(pool);
    b.kind = 'hall';
    pool.splice(pool.findIndex((e) => e[0] === b), 1);
  }

  // ---- 2. lanes → junctions and segments
  // Lane tiles: each street's lane along its rect, run on at both ends until it meets a crossing lane.
  const lane = new Uint8Array(N * N);
  const street = new Int16Array(N * N).fill(-1);
  for (const s of streets) for (let y = s.rect.y0; y < s.rect.y1; y++) for (let x = s.rect.x0; x < s.rect.x1; x++) street[y * N + x] = s.id;
  for (const s of streets) {
    if (s.axis === 1) for (let y = s.rect.y0; y < s.rect.y1; y++) lane[y * N + s.lane] = 1;
    else for (let x = s.rect.x0; x < s.rect.x1; x++) lane[s.lane * N + x] = 1;
  }
  for (const s of streets) {
    const run = (x: number, y: number, dx: number, dy: number) => {
      // Past the street's end, across the crossing street, as far as its lane.
      const path: number[] = [];
      while (x >= 0 && y >= 0 && x < N && y < N && street[y * N + x] >= 0) {
        if (lane[y * N + x]) { for (const i of path) lane[i] = 1; return; }
        path.push(y * N + x);
        x += dx; y += dy;
      }
    };
    if (s.axis === 1) { run(s.lane, s.rect.y0 - 1, 0, -1); run(s.lane, s.rect.y1, 0, 1); }
    else { run(s.rect.x0 - 1, s.lane, -1, 0); run(s.rect.x1, s.lane, 1, 0); }
  }
  const isLane = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && lane[y * N + x] === 1;
  const STEPX = [1, 0, -1, 0], STEPY = [0, 1, 0, -1];
  const junctions: Junction[] = [];
  const jAt = new Map<number, number>();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isLane(x, y)) continue;
    const n = [0, 1, 2, 3].filter((d) => isLane(x + STEPX[d], y + STEPY[d]));
    const straight = n.length === 2 && (n[0] + 2) % 4 === n[1];
    if (!straight) { jAt.set(y * N + x, junctions.length); junctions.push({ id: junctions.length, x, y }); }
  }
  const segments: Segment[] = [];
  for (const j of junctions) for (const d of [0, 1] as Dir[]) {   // each segment once: walk east and north
    let x = j.x + STEPX[d], y = j.y + STEPY[d];
    if (!isLane(x, y)) continue;
    const tiles: [number, number][] = [];
    while (isLane(x, y) && !jAt.has(y * N + x)) { tiles.push([x, y]); x += STEPX[d]; y += STEPY[d]; }
    const b = jAt.get(y * N + x);
    if (b !== undefined) segments.push({ id: segments.length, a: j.id, b, dir: d, tiles });
  }

  // ---- 3. the maze over (junction, level)
  const mz = root.fork('maze');
  const L = P.levels;
  const bySeg: Segment[][] = junctions.map(() => []);
  for (const s of segments) { bySeg[s.a].push(s); bySeg[s.b].push(s); }
  const used = new Set<string>();                    // `${segment}:${level}` taken by a catwalk or stairs
  const visited = new Set<string>();
  const nodes = new Map<string, number>();
  const walks: Walk[] = [];
  const key = (j: number, l: number) => `${j}:${l}`;
  const free = (s: Segment, la: number, lb: number) => !used.has(`${s.id}:${la}`) && !used.has(`${s.id}:${lb}`);
  let looping = false;
  const take = (s: Segment, la: number, lb: number) => {
    used.add(`${s.id}:${la}`); used.add(`${s.id}:${lb}`);
    walks.push({ segment: s.id, la, lb, loop: looping });
    const ka = key(s.a, la), kb = key(s.b, lb);
    nodes.set(ka, (nodes.get(ka) ?? 0) | (1 << s.dir));
    nodes.set(kb, (nodes.get(kb) ?? 0) | (1 << ((s.dir + 2) % 4)));
  };
  // Start near the middle of the plan, on a middle level.
  const mid = junctions.filter((j) => bySeg[j.id].length >= 2).sort((p, q) => Math.hypot(p.x - N / 2, p.y - N / 2) - Math.hypot(q.x - N / 2, q.y - N / 2))[0] ?? junctions[0];
  const start = { junction: mid.id, level: Math.floor(L / 2) };
  const active: [number, number][] = [[start.junction, start.level]];
  visited.add(key(start.junction, start.level));
  const target = Math.round(junctions.length * L * P.fill);
  /** Ways on from (j, l): [segment, level here, level there, the far junction]. */
  const options = (j: number, l: number) => {
    const out: [Segment, number, number, number][] = [];
    for (const s of bySeg[j]) {
      const far = s.a === j ? s.b : s.a;
      for (const dl of [0, 1, -1]) {
        const l2 = l + dl;
        if (l2 < 0 || l2 >= L) continue;
        if (dl !== 0 && s.tiles.length < P.stairTiles) continue;
        if (free(s, l, l2)) out.push([s, l, l2, far]);
      }
    }
    return out;
  };
  while (active.length && visited.size < target) {
    // Mostly carry on from the newest spot (long winding runs), sometimes branch from an old one.
    const i = mz.chance(0.72) ? active.length - 1 : mz.int(0, active.length - 1);
    const [j, l] = active[i];
    const opts = options(j, l).filter(([, , l2, far]) => !visited.has(key(far, l2)));
    if (!opts.length) { active.splice(i, 1); continue; }
    const flat = opts.filter((o) => o[1] === o[2]), ramp = opts.filter((o) => o[1] !== o[2]);
    const pick = ramp.length && (!flat.length || mz.chance(P.stairs)) ? mz.pick(ramp) : mz.pick(flat);
    const [s, , l2, far] = pick;
    if (s.a === j) take(s, l, l2); else take(s, l2, l);
    visited.add(key(far, l2));
    active.push([far, l2]);
  }
  // Loops: spare connections between spots the maze already reaches.
  looping = true;
  for (const k of [...visited]) {
    const [j, l] = k.split(':').map(Number);
    for (const [s, , l2, far] of options(j, l)) {
      if (visited.has(key(far, l2)) && free(s, l, l2) && mz.chance(P.loops)) { if (s.a === j) take(s, l, l2); else take(s, l2, l); }
    }
  }
  return { params: P, blocks, streets, junctions, segments, walks, nodes, start };
}
