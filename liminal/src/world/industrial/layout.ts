import { Rng } from '../rng';
import type { Dir } from '../kit/aperture';

/**
 * The plan of an industrial world, before any geometry: a city of huge
 * masses (machines, chamber stacks, piers) cut by narrow streets, a few
 * blocks left empty as halls, and a maze of catwalks through the streets on
 * several levels. Everything is on the kit's tile grid (one tile = 128 units).
 *
 *  0. Districts: the plan is shared out between a few districts, each of one
 *     kind (canyons, alleys, yards, works, racks). A kind sets the grain of
 *     everything below: how big the blocks are, how wide the streets, how
 *     many halls, how many tunnels. No two neighbours are of one kind.
 *  1. Blocks and streets: the plan is split again and again, each cut leaving
 *     a street. Cuts stop at random sizes, so streets meet at T-junctions and
 *     no two blocks are alike.
 *  2. Lanes: each street has one line of tiles a catwalk can run on. Some
 *     masses are cut by tunnels: lanes that leave a street's lane, cross the
 *     street, and run through the mass (straight, with a bend, or with a
 *     dog-leg), out to another street or to a dead end inside. Most halls
 *     are crossed by a lane or two: a bridge through the open air. Where
 *     lanes meet or turn is a junction; between junctions is a segment.
 *  3. The maze: over (junction, level) pairs. A segment can carry a level
 *     catwalk on any level, or stairs from one level to the next. A random
 *     tree is grown from the start (winding, with branches), then a few
 *     loops are added.
 *
 * Pure data, fixed by the seed: the same seed is always the same world.
 */
export interface Rect { x0: number; y0: number; x1: number; y1: number }   // tiles, x1/y1 exclusive
export interface Block { id: number; rect: Rect; kind: 'mass' | 'hall'; /** A hall with a bridge across it. */ bridged?: boolean }
export type DistrictKind = 'canyons' | 'alleys' | 'yards' | 'works' | 'racks';
/** The grain of one kind of district. */
export interface Grain {
  /** Blocks are cut until no side is longer than maxBlock (tiles), and never below minBlock. */
  maxBlock: number; minBlock: number;
  /** Street widths to pick from (tiles), with weights. */
  streets: (readonly [number, number])[];
  /** Chance that an inner block is left empty as a hall. */
  halls: number;
  /** Share of masses cut by tunnels, and the most tunnels one mass can have. */
  tunnels: number; tunnelMax: number;
}
export interface District extends Grain { id: number; kind: DistrictKind; /** Its middle, in tiles. */ x: number; y: number }
/**
 * canyons: big masses, middling streets, some tunnels (the world as it was).
 * alleys: small masses and one-tile streets: a tight maze of catwalks in the open.
 * yards: wide streets and many halls: open, with bridges.
 * works: huge solid masses with hardly a street between: you walk inside them.
 * racks: middling blocks, most of them open steel.
 */
export const GRAIN: Record<DistrictKind, Grain> = {
  canyons: { maxBlock: 30, minBlock: 12, streets: [[1, 1], [3, 5], [5, 2]], halls: 0.1, tunnels: 0.6, tunnelMax: 3 },
  alleys: { maxBlock: 12, minBlock: 6, streets: [[1, 6], [3, 2]], halls: 0.03, tunnels: 0.3, tunnelMax: 1 },
  yards: { maxBlock: 34, minBlock: 16, streets: [[3, 1], [5, 3], [7, 2]], halls: 0.5, tunnels: 0.5, tunnelMax: 2 },
  works: { maxBlock: 36, minBlock: 20, streets: [[1, 3], [3, 3]], halls: 0.04, tunnels: 1, tunnelMax: 6 },
  racks: { maxBlock: 22, minBlock: 10, streets: [[3, 4], [5, 1]], halls: 0.15, tunnels: 0.3, tunnelMax: 2 },
};
export interface Street { id: number; rect: Rect; /** 0 = runs along x, 1 = along y. */ axis: 0 | 1; /** The lane's fixed coordinate (y for axis 0, x for axis 1). */ lane: number; width: number }
export interface Junction { id: number; x: number; y: number }
/** A run of lane tiles between two junctions (a's and b's tiles not included). */
export interface Segment {
  id: number; a: number; b: number; /** Direction from a to b. */ dir: Dir; tiles: [number, number][];
  /** Some of its tiles are inside a mass (a closed corridor). */
  tunnel: boolean;
  /** Some of its tiles cross a hall (a bridge). */
  bridge: boolean;
  /** It is long enough for stairs, and the stairs would be wholly inside a mass or wholly in a street. */
  stair: boolean;
}
/** A catwalk on a segment: level `la` at a to level `lb` at b (equal = flat, else one level of stairs). */
export interface Walk { segment: number; la: number; lb: number; /** A spare connection: the maze stays in one piece without it. */ loop: boolean }

export interface LayoutParams {
  /** Plan size in tiles. */
  size: number;
  /** Districts along each side of the plan (so districts² in all). */
  districts: number;
  /** Number of catwalk levels. */
  levels: number;
  /** How much of the (junction, level) lattice the maze takes. */
  fill: number;
  /** Chance that a spare connection between two parts of the maze is built (loops). */
  loops: number;
  /** Chance a step of the maze is a stair rather than level (when both are possible). */
  stairs: number;
  /** Tiles a stair segment needs (two flights of two tiles, with a tile to spare each end). */
  stairTiles: number;
  /** How much likelier the maze is to go on through a tunnel or over a bridge than along a street. */
  tunnelBias: number;
  /** Chance that a hall is crossed by a bridge. */
  bridges: number;
  /** One kind for every district (for trying a kind out); normally each district draws its own. */
  only?: DistrictKind;
}

export const DEFAULT_LAYOUT: LayoutParams = {
  size: 160, districts: 3,
  levels: 5, fill: 0.5, loops: 0.5, stairs: 0.3, stairTiles: 6,
  tunnelBias: 2.5, bridges: 0.8,
};

export interface Layout {
  params: LayoutParams;
  blocks: Block[];
  streets: Street[];
  junctions: Junction[];
  segments: Segment[];
  walks: Walk[];
  /** Per tile (y * size + x): the block that tile belongs to, or −1 for a street tile. */
  tileBlock: Int16Array;
  /** Maze nodes in use: key `${junction}:${level}` → bit mask of directions with a catwalk. */
  nodes: Map<string, number>;
  start: { junction: number; level: number };
  districts: District[];
  /** The district a tile is in. */
  districtAt: (x: number, y: number) => District;
}

export function makeLayout(seed: number, params: Partial<LayoutParams> = {}): Layout {
  const P = { ...DEFAULT_LAYOUT, ...params };
  const root = new Rng(seed);
  const N = P.size;

  // ---- 0. districts: one in each cell of a coarse grid, its middle moved about; a tile belongs to the nearest
  const dr = root.fork('districts');
  const G = P.districts;
  const kinds = Object.keys(GRAIN) as DistrictKind[];
  const districts: District[] = [];
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    // Not the kind of the district before it in the row, nor of the one below it.
    const taken = [gx > 0 ? districts[districts.length - 1].kind : null, gy > 0 ? districts[(gy - 1) * G + gx].kind : null];
    const kind = P.only ?? dr.pick(kinds.filter((k) => !taken.includes(k)));
    districts.push({ id: districts.length, kind, x: ((gx + dr.range(0.25, 0.75)) * N) / G, y: ((gy + dr.range(0.25, 0.75)) * N) / G, ...GRAIN[kind] });
  }
  const districtAt = (x: number, y: number) => districts.reduce((b, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(b.x - x, b.y - y) ? d : b));

  // ---- 1. blocks and streets, in the grain of the district each piece lies in
  const blocks: Block[] = [], streets: Street[] = [];
  const cut = new Rng(root.fork('blocks').seed);
  const split = (r: Rect) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    const big = Math.max(w, h);
    const D = districtAt((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    // Stop when small enough; sometimes earlier, for variety in block size.
    if (big <= D.maxBlock && (big < 2 * D.minBlock + 2 || cut.chance(0.55))) { blocks.push({ id: blocks.length, rect: r, kind: 'mass' }); return; }
    const sw = cut.weighted(D.streets);
    const along: 0 | 1 = w > h || (w === h && cut.chance(0.5)) ? 0 : 1;   // 0: cut the x extent
    const len = along === 0 ? w : h;
    if (len < 2 * D.minBlock + sw) { blocks.push({ id: blocks.length, rect: r, kind: 'mass' }); return; }
    const p = Math.round(cut.range(D.minBlock, len - sw - D.minBlock));
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
  const districtOf = (b: Block) => districtAt((b.rect.x0 + b.rect.x1) / 2, (b.rect.y0 + b.rect.y1) / 2);
  // Halls: some blocks stay empty, by their district's share. Never ones on the plan's edge, nor too small to be a space.
  const hallRng = root.fork('halls');
  for (const b of blocks) {
    const inner = b.rect.x0 > 0 && b.rect.y0 > 0 && b.rect.x1 < N && b.rect.y1 < N;
    const least = Math.min(b.rect.x1 - b.rect.x0, b.rect.y1 - b.rect.y0);
    if (hallRng.chance(districtOf(b).halls) && inner && least >= 8) b.kind = 'hall';
  }
  const tileBlock = new Int16Array(N * N).fill(-1);
  for (const b of blocks) for (let y = b.rect.y0; y < b.rect.y1; y++) for (let x = b.rect.x0; x < b.rect.x1; x++) tileBlock[y * N + x] = b.id;

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
  const STEPX = [1, 0, -1, 0], STEPY = [0, 1, 0, -1];

  // ---- 2b. tunnels through the masses
  // A tunnel is a path of tiles: from a street's lane, across the street, into
  // the mass and through it. It may only touch other lanes where it joins or
  // crosses them squarely; everywhere else it keeps a tile's distance.
  const lanePath = (tiles: number[]): boolean => {
    const own = new Set(tiles);
    if (own.size !== tiles.length) return false;
    const contact = tiles.map((p) => lane[p] === 1);
    for (let i = 0; i < tiles.length; i++) {
      const p = tiles[i], px = p % N, py = (p - px) / N;
      if (contact[i]) {
        if (i > 0 && contact[i - 1]) return false;                                              // never along a lane
        if (i > 0 && i < tiles.length - 1 && tiles[i - 1] + tiles[i + 1] !== 2 * p) return false;   // cross it straight
        continue;
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const qx = px + dx, qy = py + dy;
        if ((!dx && !dy) || qx < 0 || qy < 0 || qx >= N || qy >= N) continue;
        const q = qy * N + qx;
        if (!lane[q] || own.has(q)) continue;
        // Another lane this close is only all right if it is the one this path joins or crosses at the next tile.
        let joined = false;
        for (const n of [i - 1, i + 1]) {
          if (n < 0 || n >= tiles.length || !contact[n]) continue;
          const c = tiles[n], cx = c % N, cy = (c - cx) / N;
          if (Math.abs(cx - qx) + Math.abs(cy - qy) === 1) joined = true;
        }
        if (!joined) return false;
      }
    }
    for (const p of tiles) lane[p] = 1;
    return true;
  };
  /** From a block's face (side d, at fixed coordinate c) out across the street to its lane: the tiles, lane last. Null if there is no lane to reach. */
  const mouth = (b: Block, d: Dir, c: number): number[] | null => {
    let x = d === 0 ? b.rect.x1 : d === 2 ? b.rect.x0 - 1 : c, y = d === 1 ? b.rect.y1 : d === 3 ? b.rect.y0 - 1 : c;
    const out: number[] = [];
    while (x >= 0 && y >= 0 && x < N && y < N && street[y * N + x] >= 0) {
      out.push(y * N + x);
      if (lane[y * N + x]) return out;
      x += STEPX[d]; y += STEPY[d];
    }
    return null;
  };
  /** Tiles of a straight run inside a block, from (x, y) for n tiles towards d. */
  const runTiles = (x: number, y: number, d: Dir, n: number): number[] => Array.from({ length: n }, (_, i) => (y + STEPY[d] * i) * N + x + STEPX[d] * i);
  const tn = root.fork('tunnels');
  for (const b of blocks) {
    if (b.kind !== 'mass') continue;
    const r = tn.fork(b.id);
    const D = districtOf(b);
    if (!r.chance(D.tunnels)) continue;
    const { x0, y0, x1, y1 } = b.rect;
    const w = x1 - x0, h = y1 - y0;
    const want = r.int(D.tunnelMax > 3 ? 2 : 1, Math.max(1, Math.min(D.tunnelMax, Math.floor(Math.max(w, h) / (D.tunnelMax > 3 ? 5 : 7)))));
    const rows: number[] = [], cols: number[] = [];   // rows (fixed y) and columns (fixed x) already taken in this block
    const clear = (taken: number[], v: number) => taken.every((t) => Math.abs(t - v) >= 4);
    // A row or column that keeps two tiles of wall to the block's sides and four tiles to its own kind.
    const pickRow = () => { const v = r.int(y0 + 2, y1 - 3); return h >= 5 && clear(rows, v) ? v : null; };
    const pickCol = () => { const v = r.int(x0 + 2, x1 - 3); return w >= 5 && clear(cols, v) ? v : null; };
    let made = 0;
    for (let t = 0; t < want * 8 && made < want; t++) {
      const shape = r.weighted([['straight', 5], ['bend', 3], ['dogleg', 2]] as const);
      let path: number[] | null = null;
      const usedRows: number[] = [], usedCols: number[] = [];
      if (shape === 'straight') {
        const alongX = r.chance(w / (w + h));
        const c = alongX ? pickRow() : pickCol();
        if (c === null) continue;
        const [dA, dB]: [Dir, Dir] = alongX ? [2, 0] : [3, 1];
        const len = alongX ? w : h;
        let mA = mouth(b, dA, c), mB = mouth(b, dB, c);
        if (!mA && !mB) continue;
        // Some tunnels stop inside the mass, in a room, even when they could go through.
        const through = mA !== null && mB !== null;
        if (through && r.chance(0.22)) { if (r.chance(0.5)) mA = null; else mB = null; }
        const inside = alongX ? runTiles(x0, c, 0, len) : runTiles(c, y0, 1, len);
        if (mA && mB) path = [...mA.reverse(), ...inside, ...mB];
        else {
          // At least three tiles in. Most stop well short of the far side; some go on to its last tile but one (a look-out).
          const deep = through && r.chance(0.45) ? len - 1 : r.int(3, Math.max(3, len - 3));   // a look-out needs a street to look at
          path = mA ? [...mA.reverse(), ...inside.slice(0, deep)] : [...mB!.reverse(), ...inside.reverse().slice(0, deep)];
        }
        (alongX ? usedRows : usedCols).push(c);
      } else if (shape === 'bend') {
        // In by a row from the west or east side, out by a column to the south or north side.
        const row = pickRow(), col = pickCol();
        if (row === null || col === null) continue;
        const dA: Dir = r.chance(0.5) ? 2 : 0, dB: Dir = r.chance(0.5) ? 3 : 1;
        const mA = mouth(b, dA, row), mB = mouth(b, dB, col);
        if (!mA || !mB) continue;
        const legA = dA === 2 ? runTiles(x0, row, 0, col - x0) : runTiles(x1 - 1, row, 2, x1 - 1 - col);       // up to the corner, not on it
        const legB = dB === 3 ? runTiles(col, row, 3, row - y0 + 1) : runTiles(col, row, 1, y1 - row);           // from the corner out
        path = [...mA.reverse(), ...legA, ...legB, ...mB];
        usedRows.push(row); usedCols.push(col);
      } else {
        // Through, with a side-step in the middle.
        const alongX = r.chance(w / (w + h));
        if (alongX) {
          const r1 = pickRow(), r2 = pickRow(), col = pickCol();
          if (r1 === null || r2 === null || col === null || Math.abs(r1 - r2) < 4) continue;
          const mA = mouth(b, 2, r1), mB = mouth(b, 0, r2);
          if (!mA || !mB) continue;
          const step: Dir = r2 > r1 ? 1 : 3;
          path = [...mA.reverse(), ...runTiles(x0, r1, 0, col - x0), ...runTiles(col, r1, step, Math.abs(r2 - r1)), ...runTiles(col, r2, 0, x1 - col), ...mB];
          usedRows.push(r1, r2); usedCols.push(col);
        } else {
          const c1 = pickCol(), c2 = pickCol(), row = pickRow();
          if (c1 === null || c2 === null || row === null || Math.abs(c1 - c2) < 4) continue;
          const mA = mouth(b, 3, c1), mB = mouth(b, 1, c2);
          if (!mA || !mB) continue;
          const step: Dir = c2 > c1 ? 0 : 2;
          path = [...mA.reverse(), ...runTiles(c1, y0, 1, row - y0), ...runTiles(c1, row, step, Math.abs(c2 - c1)), ...runTiles(c2, row, 1, y1 - row), ...mB];
          usedCols.push(c1, c2); usedRows.push(row);
        }
      }
      if (path && lanePath(path)) { made++; rows.push(...usedRows); cols.push(...usedCols); }
    }
  }

  // ---- 2c. bridges across the halls: a lane straight over, from the street on one side to the street on the other
  const br = root.fork('bridges');
  for (const b of blocks) {
    if (b.kind !== 'hall') continue;
    const r = br.fork(b.id);
    if (!r.chance(P.bridges)) continue;
    const { x0, y0, x1, y1 } = b.rect;
    const w = x1 - x0, h = y1 - y0;
    const want = r.chance(0.35) ? 2 : 1;
    let made = 0;
    let lastAlongX: boolean | null = null;
    for (let t = 0; t < 10 && made < want; t++) {
      // The second bridge crosses the first.
      const alongX: boolean = lastAlongX === null ? r.chance(w / (w + h)) : !lastAlongX;
      const c = alongX ? r.int(y0 + 2, y1 - 3) : r.int(x0 + 2, x1 - 3);
      const mA = mouth(b, alongX ? 2 : 3, c), mB = mouth(b, alongX ? 0 : 1, c);
      if (!mA || !mB) continue;
      const over = alongX ? runTiles(x0, c, 0, w) : runTiles(c, y0, 1, h);
      if (lanePath([...mA.reverse(), ...over, ...mB])) { made++; lastAlongX = alongX; b.bridged = true; }
    }
  }

  const isLane = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && lane[y * N + x] === 1;
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
    if (b === undefined) continue;
    // What each tile is in: 0 = a street, 1 = a mass, 2 = a hall.
    const medium = tiles.map(([tx, ty]) => { const k = tileBlock[ty * N + tx]; return k < 0 ? 0 : blocks[k].kind === 'mass' ? 1 : 2; });
    // Stairs take the middle four tiles (or one further on, going the other way), with a level tile at each end in
    // the same kind of place; never on a bridge.
    let stair = tiles.length >= P.stairTiles;
    if (stair) {
      const i0 = Math.floor((tiles.length - 4) / 2), i1 = tiles.length - 4 - i0;
      for (let i = Math.min(i0, i1) - 1; i <= Math.max(i0, i1) + 4; i++) if (medium[i] !== medium[i0] || medium[i] === 2) stair = false;
    }
    segments.push({ id: segments.length, a: j.id, b, dir: d, tiles, tunnel: medium.includes(1), bridge: medium.includes(2), stair });
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
  const mid = junctions.filter((j) => bySeg[j.id].length >= 2 && tileBlock[j.y * N + j.x] < 0).sort((p, q) => Math.hypot(p.x - N / 2, p.y - N / 2) - Math.hypot(q.x - N / 2, q.y - N / 2))[0] ?? junctions[0];
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
        if (dl !== 0 && !s.stair) continue;
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
    const from = ramp.length && (!flat.length || mz.chance(P.stairs)) ? ramp : flat;
    const pick = mz.weighted(from.map((o) => [o, o[0].tunnel || o[0].bridge ? P.tunnelBias : 1] as const));
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
  return { params: P, blocks, streets, junctions, segments, walks, nodes, start, tileBlock, districts, districtAt };
}
