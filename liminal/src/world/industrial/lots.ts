import { Rng } from '../rng';
import type { Dir } from '../kit/aperture';
import { DEFAULT_LAYOUT, GRAIN, tunnelsAndBridges, type Block, type District, type DistrictKind, type Junction, type Layout, type LayoutParams, type Rect, type Segment, type Street, type Walk } from './layout';

/**
 * The industrial world as an endless grid of lots (docs/WORLD_DESIGN.md,
 * section 10). A lot is LOT tiles square. Everything about a lot is a pure
 * function of (seed, lot x, lot y): it is the same lot whatever was made
 * before it, and from whichever side it is come upon.
 *
 *  - Every lot owns the avenue along its south side and the one along its
 *    west side (and the crossing in its south-west corner). An avenue keeps
 *    one width and one lane for the whole of its line, so the lanes of the
 *    lots along it are one straight lane, and lanes cross squarely.
 *  - Inside its avenues a lot is planned like the old whole world: blocks and
 *    streets by cutting, tunnels through masses, bridges over halls. Its
 *    streets run out to the avenues round it (its own, and its northern and
 *    eastern neighbours'), and join their lanes there.
 *  - The maze. Every avenue lane carries a level catwalk on the middle level
 *    for its whole length: the backbone, in one piece over the whole world.
 *    Each lot then grows its own maze from the backbone on its own avenues,
 *    over the segments it owns (all levels, stairs, tunnels, bridges). So the
 *    world's maze is in one piece, and a lot's maze needs nothing from its
 *    neighbours' mazes.
 *
 * To build one lot's geometry the generator is given the plan of a square of
 * lots round it (`windowLayout`), and keeps what belongs to the lot.
 */
export const LOT = 32;
/** How far past a lot's north and east sides its plan may reach (to its neighbours' avenue lanes). */
const PAD = 6;
const KINDS = Object.keys(GRAIN) as DistrictKind[];
const mod = (a: number, n: number) => ((a % n) + n) % n;
const STEPX = [1, 0, -1, 0], STEPY = [0, 1, 0, -1];

export interface Avenue { width: number; lane: number }
const avenues = new Map<string, Avenue>();
/** The avenue along the south side of every lot in row `n` (axis 0), or along the west side of every lot in column `n` (axis 1): its width, and its lane's place across it (tiles). */
export function avenue(seed: number, axis: 0 | 1, n: number): Avenue {
  const k = `${seed}:${axis}:${n}`;
  let a = avenues.get(k);
  if (!a) {
    const width = new Rng(seed).fork(`avenue${axis}:${n}`).weighted([[1, 2], [3, 5], [5, 2]] as const);
    a = { width, lane: Math.floor(width / 2) };
    if (avenues.size > 4096) avenues.clear();
    avenues.set(k, a);
  }
  return a;
}

/** Where to stand in lot i, j: on the backbone, at the crossing in the lot's south-west corner (world units; the feet). */
export function lotStart(seed: number, i: number, j: number): [number, number, number] {
  return [(i * LOT + avenue(seed, 1, i).lane) * 128 + 64, (j * LOT + avenue(seed, 0, j).lane) * 128 + 64, 2];
}

/** A lot's kind. No lot has a neighbour to the north, south, east or west of its own kind. */
export function lotKind(seed: number, i: number, j: number, only?: DistrictKind): DistrictKind {
  if (only) return only;
  return new Rng(seed).fork('kinds').shuffle([...KINDS])[mod(i + 2 * j, KINDS.length)];
}

/** One lot's own plan. Places are in world tiles (the lot's south-west corner is at i × LOT, j × LOT). */
export interface LotPlan {
  i: number; j: number; kind: DistrictKind;
  blocks: Block[];
  /** The south avenue, the west avenue, then the streets inside. */
  streets: Street[];
  /**
   * The lane tiles this plan sets: its two avenues' lanes, its streets' lanes
   * and where they run on to meet another lane, its tunnels and bridges. Some
   * lie in the lots to the north and east, as far as their avenues' lanes.
   */
  lanes: [number, number][];
}
const planCache = new Map<string, LotPlan>();

export function lotPlan(seed: number, i: number, j: number, P: LayoutParams = DEFAULT_LAYOUT): LotPlan {
  const ck = `${seed}:${i},${j}:${P.only ?? ''}:${P.bridges}`;
  const hit = planCache.get(ck);
  if (hit) return hit;
  const root = new Rng(seed).fork(`lot${i},${j}`);
  const kind = lotKind(seed, i, j, P.only), G = GRAIN[kind];
  const aS = avenue(seed, 0, j), aW = avenue(seed, 1, i), aN = avenue(seed, 0, j + 1), aE = avenue(seed, 1, i + 1);
  const M = LOT + PAD, FOREIGN = 30000;
  const street = new Int16Array(M * M).fill(-1), lane = new Uint8Array(M * M);
  const streets: Street[] = [
    { id: 0, rect: { x0: 0, y0: 0, x1: LOT, y1: aS.width }, axis: 0, lane: aS.lane, width: aS.width },
    { id: 1, rect: { x0: 0, y0: aS.width, x1: aW.width, y1: LOT }, axis: 1, lane: aW.lane, width: aW.width },
  ];
  // The avenues round the lot: its own two, and what shows of its neighbours' in the strip past its north and east sides.
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    let id = -1;
    if (x < LOT && y < LOT) id = y < aS.width ? 0 : x < aW.width ? 1 : -1;
    else if (y < LOT) id = y < aS.width || x - LOT < aE.width ? FOREIGN : -1;                      // the lot to the east
    else id = y - LOT < aN.width || x < aW.width || (x >= LOT && x - LOT < aE.width) ? FOREIGN : -1;   // the lots to the north
    street[y * M + x] = id;
  }
  for (let v = 0; v < M; v++) { lane[aS.lane * M + v] = 1; lane[v * M + aW.lane] = 1; lane[(LOT + aN.lane) * M + v] = 1; lane[v * M + LOT + aE.lane] = 1; }

  // Blocks and streets inside, by cutting (as the old whole-world plan did).
  const blocks: Block[] = [];
  const cut = root.fork('blocks');
  const split = (r: Rect) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0, big = Math.max(w, h);
    const done = () => { blocks.push({ id: blocks.length, rect: r, kind: 'mass' }); };
    if (big <= G.maxBlock && (big < 2 * G.minBlock + 2 || cut.chance(0.55))) return done();
    const sw = cut.weighted(G.streets);
    const along: 0 | 1 = w > h || (w === h && cut.chance(0.5)) ? 0 : 1;
    const len = along === 0 ? w : h;
    if (len < 2 * G.minBlock + sw) return done();
    const p = Math.round(cut.range(G.minBlock, len - sw - G.minBlock));
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
  split({ x0: aW.width, y0: aS.width, x1: LOT, y1: LOT });
  // Halls: some blocks stay empty, by the kind's share (never ones too small to be a space).
  const hallRng = root.fork('halls');
  for (const b of blocks) {
    b.key = `${i * LOT + b.rect.x0},${j * LOT + b.rect.y0}`;
    if (hallRng.fork(b.key).chance(G.halls) && Math.min(b.rect.x1 - b.rect.x0, b.rect.y1 - b.rect.y0) >= 8) b.kind = 'hall';
  }
  for (const s of streets.slice(2)) {
    for (let y = s.rect.y0; y < s.rect.y1; y++) for (let x = s.rect.x0; x < s.rect.x1; x++) street[y * M + x] = s.id;
    if (s.axis === 1) for (let y = s.rect.y0; y < s.rect.y1; y++) lane[y * M + s.lane] = 1;
    else for (let x = s.rect.x0; x < s.rect.x1; x++) lane[s.lane * M + x] = 1;
  }
  // Each street's lane runs on past its ends, across the street it meets, as far as that street's lane.
  for (const s of streets.slice(2)) {
    const run = (x: number, y: number, dx: number, dy: number) => {
      const path: number[] = [];
      while (x >= 0 && y >= 0 && x < M && y < M && street[y * M + x] >= 0) {
        if (lane[y * M + x]) { for (const t of path) lane[t] = 1; return; }
        path.push(y * M + x);
        x += dx; y += dy;
      }
    };
    if (s.axis === 1) { run(s.lane, s.rect.y0 - 1, 0, -1); run(s.lane, s.rect.y1, 0, 1); }
    else { run(s.rect.x0 - 1, s.lane, -1, 0); run(s.rect.x1, s.lane, 1, 0); }
  }
  tunnelsAndBridges({ N: M, lane, street, blocks, tunnels: (b) => root.fork('tunnels').fork(b.key!), bridges: (b) => root.fork('bridges').fork(b.key!), grainOf: () => G, bridgeChance: P.bridges });

  // Out in world tiles. The neighbours' own lanes (the lines past this lot's sides) are theirs to list.
  const X = i * LOT, Y = j * LOT;
  const lanes: [number, number][] = [];
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
    if (!lane[y * M + x]) continue;
    const theirs = (y >= LOT || x >= LOT) && (y === LOT + aN.lane || x === LOT + aE.lane || y === aS.lane || x === aW.lane);
    if (!theirs) lanes.push([X + x, Y + y]);
  }
  const shift = (r: Rect): Rect => ({ x0: r.x0 + X, y0: r.y0 + Y, x1: r.x1 + X, y1: r.y1 + Y });
  const plan: LotPlan = {
    i, j, kind,
    blocks: blocks.map((b) => ({ ...b, rect: shift(b.rect) })),
    streets: streets.map((s) => ({ ...s, rect: shift(s.rect), lane: s.lane + (s.axis === 0 ? Y : X), key: `${s.rect.x0 + X},${s.rect.y0 + Y}` })),
    lanes,
  };
  if (planCache.size > 512) planCache.clear();
  planCache.set(ck, plan);
  return plan;
}

/** The plans of a square of lots as one raster, with its junctions and segments. Places are in tiles from the square's south-west corner. */
interface Region {
  /** The square's south-west corner, in world tiles; its side in tiles. */
  ox: number; oy: number; N: number;
  blocks: Block[]; streets: Street[];
  tileBlock: Int16Array;
  junctions: Junction[]; segments: Segment[];
  /** tile index → junction. */
  jAt: Map<number, number>;
  /** The lot each block and street came from (index into `lots`). */
  lots: LotPlan[];
}

function region(seed: number, i0: number, j0: number, n: number, P: LayoutParams): Region {
  // A strip past the north and east sides too, as far as the next avenues' lanes: the last lots' streets and avenues
  // must reach the junctions they end at, or their segments would be cut short here.
  const N = n * LOT + PAD, ox = i0 * LOT, oy = j0 * LOT;
  const blocks: Block[] = [], streets: Street[] = [], lots: LotPlan[] = [];
  const lane = new Uint8Array(N * N);
  const shift = (r: Rect): Rect => ({ x0: r.x0 - ox, y0: r.y0 - oy, x1: r.x1 - ox, y1: r.y1 - oy });
  // The lots a row and a column outside to the south and west reach in with their streets' ends: their lanes count too.
  for (let j = j0 - 1; j < j0 + n; j++) for (let i = i0 - 1; i < i0 + n; i++) {
    const p = lotPlan(seed, i, j, P);
    for (const [gx, gy] of p.lanes) { const x = gx - ox, y = gy - oy; if (x >= 0 && y >= 0 && x < N && y < N) lane[y * N + x] = 1; }
    if (i < i0 || j < j0) continue;
    lots.push(p);
    for (const b of p.blocks) blocks.push({ ...b, id: blocks.length, rect: shift(b.rect) });
    for (const s of p.streets) streets.push({ ...s, id: streets.length, rect: shift(s.rect), lane: s.lane - (s.axis === 0 ? oy : ox) });
  }
  const tileBlock = new Int16Array(N * N).fill(-1);
  for (const b of blocks) for (let y = b.rect.y0; y < b.rect.y1; y++) for (let x = b.rect.x0; x < b.rect.x1; x++) tileBlock[y * N + x] = b.id;
  // The lanes of the avenues just past the square (they are lines: known without their lots), and of the avenue
  // lines that run on through the strip.
  const north = n * LOT + avenue(seed, 0, j0 + n).lane, east = n * LOT + avenue(seed, 1, i0 + n).lane;
  for (let v = 0; v < N; v++) { lane[north * N + v] = 1; lane[v * N + east] = 1; }
  for (let k = 0; k < n; k++) {
    const row = k * LOT + avenue(seed, 0, j0 + k).lane, col = k * LOT + avenue(seed, 1, i0 + k).lane;
    for (let v = n * LOT; v < N; v++) { lane[row * N + v] = 1; lane[v * N + col] = 1; }
  }

  const isLane = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && lane[y * N + x] === 1;
  const junctions: Junction[] = [];
  const jAt = new Map<number, number>();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!isLane(x, y)) continue;
    const nb = [0, 1, 2, 3].filter((d) => isLane(x + STEPX[d], y + STEPY[d]));
    const straight = nb.length === 2 && (nb[0] + 2) % 4 === nb[1];
    if (!straight) { jAt.set(y * N + x, junctions.length); junctions.push({ id: junctions.length, x, y, key: `${x + ox},${y + oy}` }); }
  }
  const segments: Segment[] = [];
  for (const j of junctions) for (const d of [0, 1] as Dir[]) {   // each segment once: walk east and north
    let x = j.x + STEPX[d], y = j.y + STEPY[d];
    if (!isLane(x, y)) continue;
    const tiles: [number, number][] = [];
    while (isLane(x, y) && !jAt.has(y * N + x)) { tiles.push([x, y]); x += STEPX[d]; y += STEPY[d]; }
    const b = jAt.get(y * N + x);
    if (b === undefined) continue;
    // What each tile is in: 0 = a street, 1 = a mass, 2 = a hall.
    const medium = tiles.map(([tx, ty]) => { const k = tileBlock[ty * N + tx]; return k < 0 ? 0 : blocks[k].kind === 'mass' ? 1 : 2; });
    let stair = tiles.length >= P.stairTiles;
    if (stair) {
      const a0 = Math.floor((tiles.length - 4) / 2), a1 = tiles.length - 4 - a0;
      for (let t = Math.min(a0, a1) - 1; t <= Math.max(a0, a1) + 4; t++) if (medium[t] !== medium[a0] || medium[t] === 2) stair = false;
    }
    segments.push({ id: segments.length, a: j.id, b, dir: d, tiles, tunnel: medium.includes(1), bridge: medium.includes(2), stair });
  }
  return { ox, oy, N, blocks, streets, tileBlock, junctions, segments, jAt, lots };
}

/** A catwalk of a lot's maze, named so that any plan that holds the segment can find it: the segment's first junction (world tile) and its direction. */
export interface LotWalk { ax: number; ay: number; dir: Dir; /** How many tiles the segment has (a plan that shows less of it has not got all of it). */ tiles: number; la: number; lb: number; loop: boolean }
const mazeCache = new Map<string, LotWalk[]>();

/**
 * One lot's maze: the backbone on its own avenues, and a random tree grown
 * from it over the segments the lot owns, with a few loops. A segment
 * belongs to the lot one of its ends is inside of (an end on an avenue's
 * lane is "inside" no lot); with both ends on avenue lanes, to the lot its
 * middle tile is in.
 */
export function lotMaze(seed: number, i: number, j: number, P: LayoutParams = DEFAULT_LAYOUT): LotWalk[] {
  const ck = `${seed}:${i},${j}:${P.only ?? ''}:${P.levels}:${P.fill}:${P.loops}:${P.stairs}:${P.tunnelBias}:${P.bridges}`;
  const hit = mazeCache.get(ck);
  if (hit) return hit;
  const R = region(seed, i - 1, j - 1, 3, P);
  const { N, ox, oy, junctions, segments } = R;
  const L = P.levels, MID = Math.floor(L / 2);
  const lotOf = (x: number, y: number): [number, number] => [Math.floor((x + ox) / LOT), Math.floor((y + oy) / LOT)];
  const mine = (x: number, y: number) => { const [a, b] = lotOf(x, y); return a === i && b === j; };
  /** On an avenue's lane? (So: on the backbone.) */
  const onLane = (x: number, y: number) => { const [a, b] = lotOf(x, y); return mod(y + oy, LOT) === avenue(seed, 0, b).lane || mod(x + ox, LOT) === avenue(seed, 1, a).lane; };
  const jLane = junctions.map((J) => onLane(J.x, J.y));
  const owned = segments.map((s) => {
    const A = junctions[s.a], B = junctions[s.b];
    if (!jLane[s.a]) return mine(A.x, A.y);
    if (!jLane[s.b]) return mine(B.x, B.y);
    const [mx, my] = s.tiles.length ? s.tiles[Math.floor(s.tiles.length / 2)] : [A.x, A.y];
    return mine(mx, my);
  });
  /** Along an avenue's lane (and so part of the backbone)? */
  const along = (s: Segment) => {
    if (!jLane[s.a] || !jLane[s.b]) return false;
    const A = junctions[s.a], [a, b] = lotOf(A.x, A.y);
    return s.dir === 0 ? mod(A.y + oy, LOT) === avenue(seed, 0, b).lane : mod(A.x + ox, LOT) === avenue(seed, 1, a).lane;
  };

  const mz = new Rng(seed).fork(`maze${i},${j}`);
  const bySeg: Segment[][] = junctions.map(() => []);
  segments.forEach((s, k) => { if (owned[k]) { bySeg[s.a].push(s); bySeg[s.b].push(s); } });
  const used = new Set<string>(), visited = new Set<string>();
  const walks: LotWalk[] = [];
  const key = (jn: number, l: number) => `${jn}:${l}`;
  const free = (s: Segment, la: number, lb: number) => !used.has(`${s.id}:${la}`) && !used.has(`${s.id}:${lb}`);
  let looping = false;
  const take = (s: Segment, la: number, lb: number) => {
    used.add(`${s.id}:${la}`); used.add(`${s.id}:${lb}`);
    const A = junctions[s.a];
    walks.push({ ax: A.x + ox, ay: A.y + oy, dir: s.dir, tiles: s.tiles.length, la, lb, loop: looping });
  };
  // The backbone: the whole world's, as far as this plan shows it, is "reached"; this lot builds its own part.
  junctions.forEach((_, jn) => { if (jLane[jn]) visited.add(key(jn, MID)); });
  const active: [number, number][] = [];
  let reached = 0, home = 0;
  junctions.forEach((J, jn) => { if (mine(J.x, J.y)) { home++; if (jLane[jn]) { active.push([jn, MID]); reached++; } } });
  segments.forEach((s, k) => { if (owned[k] && along(s)) take(s, MID, MID); });
  const target = Math.round(home * L * P.fill);
  const options = (jn: number, l: number) => {
    const out: [Segment, number, number, number][] = [];
    for (const s of bySeg[jn]) {
      const far = s.a === jn ? s.b : s.a;
      for (const dl of [0, 1, -1]) {
        const l2 = l + dl;
        if (l2 < 0 || l2 >= L) continue;
        if (dl !== 0 && !s.stair) continue;
        if (free(s, l, l2)) out.push([s, l, l2, far]);
      }
    }
    return out;
  };
  mz.shuffle(active);
  while (active.length && reached < target) {
    const at = mz.chance(0.72) ? active.length - 1 : mz.int(0, active.length - 1);
    const [jn, l] = active[at];
    const opts = options(jn, l).filter(([, , l2, far]) => !visited.has(key(far, l2)));
    if (!opts.length) { active.splice(at, 1); continue; }
    const flat = opts.filter((o) => o[1] === o[2]), ramp = opts.filter((o) => o[1] !== o[2]);
    const from = ramp.length && (!flat.length || mz.chance(P.stairs)) ? ramp : flat;
    const [s, , l2, far] = mz.weighted(from.map((o) => [o, o[0].tunnel || o[0].bridge ? P.tunnelBias : 1] as const));
    if (s.a === jn) take(s, l, l2); else take(s, l2, l);
    visited.add(key(far, l2));
    const F = junctions[far];
    // A spot on a neighbour's avenue is the end of this lot's way there: the neighbour's own maze goes on from it, or it is a dead end.
    if (mine(F.x, F.y)) { active.push([far, l2]); reached++; }
  }
  // Loops: spare connections between spots already reached (this is also how the lot's streets join its neighbours' backbone).
  looping = true;
  for (const k of [...visited]) {
    const [jn, l] = k.split(':').map(Number);
    for (const [s, , l2, far] of options(jn, l)) {
      if (visited.has(key(far, l2)) && free(s, l, l2) && mz.chance(P.loops)) { if (s.a === jn) take(s, l, l2); else take(s, l2, l); }
    }
  }
  void N;
  if (mazeCache.size > 512) mazeCache.clear();
  mazeCache.set(ck, walks);
  return walks;
}

/**
 * The plan of a square of lots (n by n, from lot i0, j0) as a Layout the
 * generator can build from. Only the lots at least one lot in from the
 * square's edge are whole: the outer ring is there to be built against.
 */
export function windowLayout(seed: number, i0: number, j0: number, n: number, params: Partial<LayoutParams> = {}): Layout {
  const P = { ...DEFAULT_LAYOUT, ...params };
  const R = region(seed, i0, j0, n, P);
  const { N, ox, oy, junctions, segments } = R;
  const segAt = new Map<string, Segment>();
  for (const s of segments) { const A = junctions[s.a]; segAt.set(`${A.x + ox},${A.y + oy}:${s.dir}`, s); }
  const walks: Walk[] = [];
  const nodes = new Map<string, number>();
  for (let j = j0; j < j0 + n; j++) for (let i = i0; i < i0 + n; i++) {
    for (const w of lotMaze(seed, i, j, P)) {
      const s = segAt.get(`${w.ax},${w.ay}:${w.dir}`);
      if (!s || s.tiles.length !== w.tiles) continue;   // it lies past this square's edge, or is cut short by it
      walks.push({ segment: s.id, la: w.la, lb: w.lb, loop: w.loop });
      const ka = `${s.a}:${w.la}`, kb = `${s.b}:${w.lb}`;
      nodes.set(ka, (nodes.get(ka) ?? 0) | (1 << s.dir));
      nodes.set(kb, (nodes.get(kb) ?? 0) | (1 << ((s.dir + 2) % 4)));
    }
  }
  const districts: District[] = R.lots.map((p, id) => ({ id, kind: p.kind, x: (p.i - i0 + 0.5) * LOT, y: (p.j - j0 + 0.5) * LOT, key: `${p.i},${p.j}`, ...GRAIN[p.kind] }));
  const districtAt = (x: number, y: number) => districts[Math.min(n - 1, Math.max(0, Math.floor(y / LOT))) * n + Math.min(n - 1, Math.max(0, Math.floor(x / LOT)))];
  // The start: the crossing in the south-west corner of the middle lot, on the backbone.
  const c = i0 + Math.floor(n / 2), d = j0 + Math.floor(n / 2);
  const sj = R.jAt.get((d * LOT + avenue(seed, 0, d).lane - oy) * N + c * LOT + avenue(seed, 1, c).lane - ox) ?? 0;
  return { params: { ...P, size: N }, blocks: R.blocks, streets: R.streets, junctions, segments, walks, nodes, start: { junction: sj, level: Math.floor(P.levels / 2) }, tileBlock: R.tileBlock, districts, districtAt, origin: [ox, oy] };
}
