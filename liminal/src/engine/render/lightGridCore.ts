/**
 * Lamps without a bake: the part with no three.js in it. It sorts a map's
 * lamps into a grid of cells, and can work out the light at a point with the
 * same sum the shader does (lightGrid.ts), so tools and tests can ask what
 * light falls where.
 *
 * Shadows with no shadow maps. A world made by cutting boxes of air out of
 * solid masses (corridors, rooms, shafts) already says where light can go: a
 * lamp inside a mass lights a point only if the straight line between them
 * stays inside those boxes of air. Each such lamp gets the boxes near it that
 * join up with the one it hangs in; a cell lists, with the lamp, the few of
 * those boxes a line from the lamp to anywhere in that cell could pass
 * through (a "chain"). The shader finds how much of the line lies outside
 * them: none = lit, a little = the soft edge of the shadow, more = dark.
 * So light goes through a doorway in a wedge, stops at a corner, and never
 * comes through a wall or a floor.
 *
 * A lamp in the open (a street) has no such test: it lights all it reaches,
 * but not the cells that lie wholly inside a "shade" box (a mass with rooms).
 *
 * Light here is irradiance in the renderer's flat-light units: 300 = a
 * surface fully lit (Source's "1.0").
 */
export interface GridLamp {
  pos: [number, number, number];
  /** Irradiance on a surface facing the lamp, right at it (linear r, g, b). */
  color: [number, number, number];
  /** The distance at which that has halved, and the distance past which the lamp gives nothing. */
  size: number; reach: number;
  /** A spot: its axis, and the angles (degrees from the axis) where it is full and where it ends. */
  dir?: [number, number, number]; inner?: number; cone?: number;
  /** It hangs inside a mass: it lights what it can see through the map's boxes of air. */
  indoor?: boolean;
  /** It lights only what lies inside this one box (a lamp shut in a room, in a map with no boxes of air). */
  box?: Box3;
  /** It hangs in the open: it does not light the inside of shade boxes. */
  open?: boolean;
}
export interface Box3 { min: number[]; max: number[] }

/** The size of a cell. */
export const CELL = [128, 128, 256];
/** At most this many lamps are summed for one cell (the strongest there). */
export const MAX_PER_CELL = 12;
/** At most this many boxes in one chain. */
export const MAX_CHAIN = 6;
/** Boxes of air are grown by this, so the walls that bound them are inside. */
export const GROW = 1;
/**
 * The length of line outside the air over which a lamp's light fades to
 * nothing: the soft edge of its shadows. A wall or a floor between two boxes
 * of air must be thicker than SOFT + 2 × GROW, or light shows through it
 * (the grid's `thin` count; the thinnest in the industrial world is 12).
 */
export const SOFT = 8;
/** The widths of the list and chain textures, and the lamps to a row (four texels each). */
export const LIST_W = 1024, CHAIN_W = 1024, LAMP_ROW = 256, LAMP_TEXELS = 4;

export interface LightGrid {
  origin: number[];
  dims: number[];
  /** Per cell: where its entries begin in the list, how many (two numbers). */
  grid: Float32Array;
  /** Per entry: the lamp, and where its chain begins (−1 = no test: all of the cell is lit). Two numbers. */
  list: Float32Array;
  listRows: number;
  /** Per lamp four texels: place, reach (negative = a spot) | colour, size (negative = indoor) | axis, cosine of the cone | cosine of the inner cone. */
  lamps: Float32Array;
  lampRows: number;
  /** Chains: per box two texels (min, max, already grown); the first texel's fourth number is how many boxes. */
  chains: Float32Array;
  chainRows: number;
  /**
   * lamps, cells with a lamp, entries in all; `full`: cells that had more lamps than they can hold; chains and the
   * longest; `cut`: chains that had more boxes than they can hold; `lost`: indoor lamps in no box of air (they light
   * nothing); airs: boxes of air after merging; `thin`: walls between two boxes of air too thin to stop the light.
   */
  stats: { lamps: number; cells: number; entries: number; full: number; chains: number; longest: number; cut: number; lost: number; airs: number; thin: number };
  /** Where the thin walls are (the middle of the gap between the two boxes), and the indoor lamps in no box of air: for tools. */
  thinAt: number[][];
  lostAt: number[][];
}

const overlapLen = (a: Box3, b: Box3, k: number) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);

/**
 * The same space in fewer boxes: a box inside another is dropped, and two
 * boxes with the same section that meet end to end become one (a corridor cut
 * as several runs and stubs becomes one long box).
 */
export function mergeBoxes(boxes: Box3[]): Box3[] {
  let list = boxes.map((b) => ({ min: [...b.min], max: [...b.max] }));
  const E = 0.01;
  const key = (v: number) => Math.round(v * 16);
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const groups = new Map<string, Box3[]>();
      for (const b of list) {
        const k = `${key(b.min[u])},${key(b.max[u])},${key(b.min[v])},${key(b.max[v])}`;
        const g = groups.get(k);
        if (g) g.push(b); else groups.set(k, [b]);
      }
      const next: Box3[] = [];
      for (const g of groups.values()) {
        g.sort((a, b) => a.min[axis] - b.min[axis]);
        let cur = g[0];
        for (let i = 1; i < g.length; i++) {
          if (g[i].min[axis] <= cur.max[axis] + E) { cur.max[axis] = Math.max(cur.max[axis], g[i].max[axis]); changed = true; }
          else { next.push(cur); cur = g[i]; }
        }
        next.push(cur);
      }
      list = next;
    }
    // Boxes that lie inside another.
    const hash = new SpatialHash(list, 512);
    const keep: Box3[] = [];
    list.forEach((a, i) => {
      let inside = false;
      hash.near(a, (j) => {
        if (inside || j === i) return;
        const b = list[j];
        let all = true, same = true;
        for (let k = 0; k < 3; k++) { if (a.min[k] < b.min[k] - E || a.max[k] > b.max[k] + E) all = false; if (Math.abs(a.min[k] - b.min[k]) > E || Math.abs(a.max[k] - b.max[k]) > E) same = false; }
        if (all && (!same || j < i)) inside = true;
      });
      if (inside) changed = true; else keep.push(a);
    });
    list = keep;
    if (!changed) break;
  }
  return list;
}

/** Boxes filed in a coarse grid, to find the ones near a box. */
class SpatialHash {
  private map = new Map<string, number[]>();
  constructor(boxes: Box3[], private cell: number) {
    boxes.forEach((b, i) => this.cells(b, 0, (k) => { const l = this.map.get(k); if (l) l.push(i); else this.map.set(k, [i]); }));
  }
  private cells(b: Box3, pad: number, f: (k: string) => void): void {
    const c = this.cell;
    for (let x = Math.floor((b.min[0] - pad) / c); x <= Math.floor((b.max[0] + pad) / c); x++)
      for (let y = Math.floor((b.min[1] - pad) / c); y <= Math.floor((b.max[1] + pad) / c); y++)
        for (let z = Math.floor((b.min[2] - pad) / c); z <= Math.floor((b.max[2] + pad) / c); z++) f(`${x},${y},${z}`);
  }
  /** Calls f once for each box whose grid cells touch b's (grown by pad). */
  near(b: Box3, f: (i: number) => void, pad = 1): void {
    const seen = new Set<number>();
    this.cells(b, pad, (k) => { for (const i of this.map.get(k) ?? []) if (!seen.has(i)) { seen.add(i); f(i); } });
  }
}

/**
 * How much of the lamp's light gets from L to P through a chain of boxes
 * (`boxes`: min, max per box, six numbers each, already grown): 1 = the whole
 * line is inside them, 0 = SOFT or more of it is not. The shader's lgSees.
 */
const seesLo = new Float64Array(64), seesHi = new Float64Array(64);
export function lampSees(L: ArrayLike<number>, P: ArrayLike<number>, boxes: ArrayLike<number>, n: number, at = 0, stride = 6): number {
  const d0 = P[0] - L[0], d1 = P[1] - L[1], d2 = P[2] - L[2];
  const lo = seesLo, hi = seesHi, half = stride === 6 ? 3 : 4;
  for (let k = 0; k < n; k++) {
    const o = at + k * stride;
    let a = -Infinity, b = Infinity;
    for (let c = 0; c < 3; c++) {
      const dv = c === 0 ? d0 : c === 1 ? d1 : d2;
      const dc = Math.abs(dv) < 1e-6 ? (dv < 0 ? -1e-6 : 1e-6) : dv;
      const t0 = (boxes[o + c] - L[c]) / dc, t1 = (boxes[o + half + c] - L[c]) / dc;
      if (t0 < t1) { if (t0 > a) a = t0; if (t1 < b) b = t1; } else { if (t1 > a) a = t1; if (t0 < b) b = t0; }
    }
    lo[k] = a; hi[k] = b;
  }
  let t = 0;
  for (let pass = 0; pass < 2; pass++) for (let k = 0; k < n; k++) if (lo[k] <= hi[k] && lo[k] <= t + 1e-4 && hi[k] > t) t = hi[k];
  if (t >= 1) return 1;
  let s = 1;
  for (let pass = 0; pass < 2; pass++) for (let k = n - 1; k >= 0; k--) if (lo[k] <= hi[k] && hi[k] >= s - 1e-4 && lo[k] < s) s = lo[k];
  const gap = Math.max(0, s - t) * Math.hypot(d0, d1, d2);
  const x = Math.min(1, gap / SOFT);
  return 1 - x * x * (3 - 2 * x);
}

/**
 * The planes that bound all the straight lines from point L to a box (the
 * box itself, and the planes through L and the box's outline as seen from
 * L): [nx, ny, nz, d] with n·p ≤ d inside.
 */
export function hullPlanes(L: ArrayLike<number>, min: number[], max: number[]): number[][] {
  const planes: number[][] = [];
  // Which of the box's six faces L is in front of.
  const front = [L[0] > max[0], L[0] < min[0], L[1] > max[1], L[1] < min[1], L[2] > max[2], L[2] < min[2]];
  for (let k = 0; k < 3; k++) {
    if (!front[k * 2]) { const n = [0, 0, 0]; n[k] = 1; planes.push([n[0], n[1], n[2], max[k]]); }
    if (!front[k * 2 + 1]) { const n = [0, 0, 0]; n[k] = -1; planes.push([n[0], n[1], n[2], -min[k]]); }
  }
  if (!front.some(Boolean)) return planes;   // L is in the box
  const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  // Each edge lies along one axis, where a face of each of the other two axes meet: part of the outline if L is in front of just one of them.
  for (let c = 0; c < 3; c++) {
    const a = (c + 1) % 3, b = (c + 2) % 3;
    for (let sa = 0; sa < 2; sa++) for (let sb = 0; sb < 2; sb++) {
      if (front[a * 2 + (sa ? 0 : 1)] === front[b * 2 + (sb ? 0 : 1)]) continue;
      const p0 = [0, 0, 0];
      p0[a] = sa ? max[a] : min[a]; p0[b] = sb ? max[b] : min[b]; p0[c] = min[c];
      const e = [0, 0, 0]; e[c] = 1;
      const v = [p0[0] - L[0], p0[1] - L[1], p0[2] - L[2]];
      let n = [e[1] * v[2] - e[2] * v[1], e[2] * v[0] - e[0] * v[2], e[0] * v[1] - e[1] * v[0]];
      const len = Math.hypot(n[0], n[1], n[2]);
      if (len < 1e-9) continue;
      n = [n[0] / len, n[1] / len, n[2] / len];
      let d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > d) { n = [-n[0], -n[1], -n[2]]; d = -d; }
      planes.push([n[0], n[1], n[2], d]);
    }
  }
  return planes;
}
/** Can a box be wholly outside the planes (so no line they bound passes through it)? */
function outsideHull(planes: number[][], min: ArrayLike<number>, max: ArrayLike<number>, shrink: number): boolean {
  for (const p of planes) {
    // The box's corner furthest back along the plane's normal.
    const x = p[0] > 0 ? min[0] + shrink : max[0] - shrink, y = p[1] > 0 ? min[1] + shrink : max[1] - shrink, z = p[2] > 0 ? min[2] + shrink : max[2] - shrink;
    if (p[0] * x + p[1] * y + p[2] * z > p[3]) return true;
  }
  return false;
}

/**
 * Sorts the lamps into the grid. `shades`: boxes whose insides lamps in the
 * open do not light. `airs`: the map's boxes of air (the insides of its
 * masses), for the lamps that hang there. Null when there are no lamps.
 */
export function buildLightGrid(lamps: GridLamp[], shades: Box3[] = [], airs: Box3[] = []): LightGrid | null {
  if (!lamps.length) return null;
  const air = mergeBoxes(airs);
  const airHash = new SpatialHash(air, 512);
  // Which boxes of air open into which: they overlap or touch over an area (not just along an edge).
  const joins: number[][] = air.map(() => []);
  air.forEach((a, i) => airHash.near(a, (j) => {
    if (j <= i) return;
    const e = [0, 1, 2].map((k) => overlapLen(a, air[j], k));
    if (e.every((v) => v >= -0.01) && e.filter((v) => v >= 8).length >= 2) { joins[i].push(j); joins[j].push(i); }
  }));
  const grown = (b: Box3, by = GROW): Box3 => ({ min: b.min.map((v) => v - by), max: b.max.map((v) => v + by) });
  const airG = air.map((b) => grown(b));

  // The boxes each lamp can shine through, nearest first (by the number of openings the light has passed).
  const stats = { lamps: lamps.length, cells: 0, entries: 0, full: 0, chains: 0, longest: 0, cut: 0, lost: 0, airs: air.length, thin: 0 };
  const thinAt: number[][] = [], lostAt: number[][] = [];
  // Walls too thin to stop the light: two boxes face to face, a little apart.
  air.forEach((a, i) => airHash.near(a, (j) => {
    if (j <= i) return;
    const e = [0, 1, 2].map((k) => overlapLen(a, air[j], k));
    const apart = e.filter((v) => v < -0.01);
    if (apart.length === 1 && -apart[0] < SOFT + 2 * GROW && e.filter((v) => v >= 8).length === 2) {
      // The middle of the gap between them. In a third box of air (two corridors that end in one shaft), there is no wall there.
      const mid = [0, 1, 2].map((k) => (Math.max(a.min[k], air[j].min[k]) + Math.min(a.max[k], air[j].max[k])) / 2);
      let inAir = false;
      airHash.near({ min: mid, max: mid }, (k) => { if (k !== i && k !== j && [0, 1, 2].every((c) => mid[c] > air[k].min[c] && mid[c] < air[k].max[c])) inAir = true; });
      if (!inAir) { stats.thin++; thinAt.push(mid); }
    }
  }, SOFT + 2 * GROW));
  /** A lamp's boxes (already grown), the first `homes` of them the ones it hangs in; `ids` name them (the same box has the same id for every lamp). */
  interface LampSet { boxes: Box3[]; ids: number[]; homes: number }
  const sets: (LampSet | null)[] = lamps.map((l, li) => {
    if (l.box && !l.indoor) return { boxes: [grown(l.box)], ids: [-1 - li], homes: 1 };
    if (!l.indoor) return null;
    const home: number[] = [];
    airHash.near({ min: l.pos, max: l.pos }, (i) => { const b = airG[i]; if (l.pos[0] >= b.min[0] && l.pos[0] <= b.max[0] && l.pos[1] >= b.min[1] && l.pos[1] <= b.max[1] && l.pos[2] >= b.min[2] && l.pos[2] <= b.max[2]) home.push(i); }, GROW + 1);
    if (!home.length) { stats.lost++; lostAt.push([...l.pos]); return { boxes: [], ids: [], homes: 0 }; }
    const seen = new Set(home), order = [...home];
    for (let q = 0; q < order.length && order.length < 48; q++) {
      for (const j of joins[order[q]]) {
        if (seen.has(j)) continue;
        // Within the lamp's reach?
        let d2 = 0;
        for (let k = 0; k < 3; k++) { const p = Math.max(air[j].min[k], Math.min(l.pos[k], air[j].max[k])); d2 += (p - l.pos[k]) ** 2; }
        if (d2 >= l.reach * l.reach) continue;
        seen.add(j); order.push(j);
      }
    }
    return { boxes: order.map((i) => airG[i]), ids: order, homes: home.length };
  });

  // The grid's extent: all that any lamp can light.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  lamps.forEach((l, i) => {
    const set = sets[i]?.boxes;
    for (let k = 0; k < 3; k++) {
      let a = l.pos[k] - l.reach, b = l.pos[k] + l.reach;
      if (set) { a = Math.max(a, Math.min(...set.map((s) => s.min[k]), l.pos[k]) - SOFT); b = Math.min(b, Math.max(...set.map((s) => s.max[k]), l.pos[k]) + SOFT); }
      lo[k] = Math.min(lo[k], a); hi[k] = Math.max(hi[k], b);
    }
  });
  const origin = lo.map((v, k) => Math.floor(v / CELL[k]) * CELL[k]);
  const dims = hi.map((v, k) => Math.max(1, Math.min(k === 2 ? 64 : 512, Math.ceil((v - origin[k]) / CELL[k]))));
  const [nx, ny, nz] = dims;
  const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x;
  const cellRange = (min: number[], max: number[]) => [0, 1, 2].map((k) => [Math.max(0, Math.floor((min[k] - origin[k]) / CELL[k])), Math.min(dims[k] - 1, Math.floor((max[k] - origin[k]) / CELL[k]))]);

  // Cells wholly inside a shade box.
  const shaded = new Uint8Array(nx * ny * nz);
  for (const s of shades) {
    const a = s.min.map((v, k) => Math.max(0, Math.ceil((v - origin[k]) / CELL[k]))), b = s.max.map((v, k) => Math.min(dims[k], Math.floor((v - origin[k]) / CELL[k])));
    for (let z = a[2]; z < b[2]; z++) for (let y = a[1]; y < b[1]; y++) for (let x = a[0]; x < b[0]; x++) shaded[at(x, y, z)] = 1;
  }

  const chainData: number[] = [];
  const chainAt = new Map<string, number>();
  const picks = new Map<number, { i: number; chain: number; score: number }[]>();
  const add = (c: number, i: number, chain: number, score: number) => { const l = picks.get(c); const p = { i, chain, score }; if (l) l.push(p); else picks.set(c, [p]); };
  const flat = new Float64Array(MAX_CHAIN * 6), probe = [0, 0, 0];

  lamps.forEach((l, i) => {
    const power = Math.max(l.color[0], l.color[1], l.color[2]), r2 = l.reach * l.reach;
    const score = (x: number, y: number, z: number): number => {
      // What the lamp gives at the cell's nearest point (0 = out of reach).
      let d2 = 0;
      const cell = [x, y, z];
      for (let k = 0; k < 3; k++) { const c0 = origin[k] + cell[k] * CELL[k], p = Math.max(c0, Math.min(l.pos[k], c0 + CELL[k])); d2 += (p - l.pos[k]) ** 2; }
      if (d2 >= r2) return 0;
      const win = 1 - d2 / r2;
      return (power * win * win) / (1 + d2 / (l.size * l.size));
    };
    const mine0 = sets[i];
    if (!mine0) {
      // In the open: every cell in reach, but for those wholly inside a shade box.
      const [rx, ry, rz] = cellRange(l.pos.map((v) => v - l.reach), l.pos.map((v) => v + l.reach));
      for (let z = rz[0]; z <= rz[1]; z++) for (let y = ry[0]; y <= ry[1]; y++) for (let x = rx[0]; x <= rx[1]; x++) {
        const c = at(x, y, z);
        if (l.open && shaded[c]) continue;
        const s = score(x, y, z);
        if (s > 0) add(c, i, -1, s);
      }
      return;
    }
    // Inside: the cells its boxes of air touch.
    const set = mine0.boxes, homes = mine0.homes;
    const touched = new Map<number, number[]>();
    set.forEach((b, bi) => {
      const [rx, ry, rz] = cellRange(b.min.map((v, k) => Math.max(v - SOFT, l.pos[k] - l.reach)), b.max.map((v, k) => Math.min(v + SOFT, l.pos[k] + l.reach)));
      for (let z = rz[0]; z <= rz[1]; z++) for (let y = ry[0]; y <= ry[1]; y++) for (let x = rx[0]; x <= rx[1]; x++) {
        const c = at(x, y, z), t = touched.get(c);
        if (t) t.push(bi); else touched.set(c, [bi]);
      }
    });
    for (const [c, mine] of touched) {
      const x = c % nx, y = ((c - x) / nx) % ny, z = (c - x - y * nx) / (nx * ny);
      const s = score(x, y, z);
      if (s <= 0) continue;
      const cmin = [origin[0] + x * CELL[0], origin[1] + y * CELL[1], origin[2] + z * CELL[2]], cmax = [cmin[0] + CELL[0], cmin[1] + CELL[1], cmin[2] + CELL[2]];
      // All of the cell inside one box the lamp hangs in: lit with no test.
      if (mine.some((bi) => bi < homes && set[bi].min[0] <= cmin[0] && set[bi].max[0] >= cmax[0] && set[bi].min[1] <= cmin[1] && set[bi].max[1] >= cmax[1] && set[bi].min[2] <= cmin[2] && set[bi].max[2] >= cmax[2])) { add(c, i, -1, s); continue; }
      // The boxes a line from the lamp to anywhere in the cell can pass through: those that reach into the space
      // between the lamp and the cell (by more than their skin).
      const hull = hullPlanes(l.pos, cmin.map((v) => v - SOFT), cmax.map((v) => v + SOFT));
      let chain: number[] = [];
      for (let bi = 0; bi < set.length; bi++) if (bi < homes || !outsideHull(hull, set[bi].min, set[bi].max, 2 * GROW)) chain.push(bi);
      if (chain.length > MAX_CHAIN) {
        // Too many: the lamp's own boxes first, then those nearest the straight line to the cell's middle.
        stats.cut++;
        const mid = [cmin[0] + CELL[0] / 2, cmin[1] + CELL[1] / 2, cmin[2] + CELL[2] / 2];
        const far = (b: Box3) => {
          let best = Infinity;
          for (let t = 0; t <= 1.001; t += 0.125) {
            let d2 = 0;
            for (let k = 0; k < 3; k++) { const p = l.pos[k] + (mid[k] - l.pos[k]) * t, q = Math.max(b.min[k], Math.min(p, b.max[k])); d2 += (p - q) ** 2; }
            best = Math.min(best, d2);
          }
          return best;
        };
        chain = chain.map((bi) => ({ bi, k: bi < homes ? -1 : far(set[bi]) })).sort((p, q) => p.k - q.k).slice(0, MAX_CHAIN).map((p) => p.bi).sort((p, q) => p - q);
      }
      chain.forEach((bi, n) => { flat.set(set[bi].min, n * 6); flat.set(set[bi].max, n * 6 + 3); });
      // Can any of the cell be lit? In a box the lamp hangs in, yes. Else try points all through the cell's part of each box.
      let lit = mine.some((bi) => bi < homes);
      for (let m = 0; m < mine.length && !lit; m++) {
        const b = set[mine[m]];
        const q0 = Math.max(cmin[0], b.min[0]), q1 = Math.max(cmin[1], b.min[1]), q2 = Math.max(cmin[2], b.min[2]);
        const w0 = Math.min(cmax[0], b.max[0]) - q0, w1 = Math.min(cmax[1], b.max[1]) - q1, w2 = Math.min(cmax[2], b.max[2]) - q2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // (Three each way: an opening is never narrower than a door, so no wedge of light is thinner than the spacing.)
        for (let a = 0; a < 3 && !lit; a++) for (let bb = 0; bb < 3 && !lit; bb++) for (let cc = 0; cc < 3 && !lit; cc++) {
          probe[0] = q0 + (w0 * a) / 2; probe[1] = q1 + (w1 * bb) / 2; probe[2] = q2 + (w2 * cc) / 2;
          if (lampSees(l.pos, probe, flat, chain.length) > 0.02) lit = true;
        }
      }
      if (!lit) continue;
      const key = chain.map((bi) => mine0.ids[bi]).join(',');
      let where = chainAt.get(key);
      if (where === undefined) {
        where = chainData.length / 4;
        chain.forEach((bi, n) => chainData.push(set[bi].min[0], set[bi].min[1], set[bi].min[2], n === 0 ? chain.length : 0, set[bi].max[0], set[bi].max[1], set[bi].max[2], 0));
        chainAt.set(key, where);
        stats.chains++;
        stats.longest = Math.max(stats.longest, chain.length);
      }
      add(c, i, where, s);
    }
  });

  // The list: each cell's entries in a row, the strongest first where there are too many.
  const grid = new Float32Array(nx * ny * nz * 2);
  let total = 0;
  for (const l of picks.values()) total += Math.min(MAX_PER_CELL, l.length);
  const listRows = Math.max(1, Math.ceil(total / LIST_W));
  const list = new Float32Array(listRows * LIST_W * 2).fill(-1);
  let e = 0;
  for (const [c, l] of picks) {
    if (l.length > MAX_PER_CELL) { l.sort((p, q) => q.score - p.score); stats.full++; }
    const n = Math.min(MAX_PER_CELL, l.length);
    grid[c * 2] = e; grid[c * 2 + 1] = n;
    for (let k = 0; k < n; k++, e++) { list[e * 2] = l[k].i; list[e * 2 + 1] = l[k].chain; }
  }
  stats.cells = picks.size; stats.entries = total;

  const lampRows = Math.ceil(lamps.length / LAMP_ROW);
  const data = new Float32Array(lampRows * LAMP_ROW * LAMP_TEXELS * 4);
  lamps.forEach((l, i) => {
    const o = i * LAMP_TEXELS * 4;
    const spot = !!l.dir && l.cone !== undefined;
    const shut = !!l.indoor || !!l.box;
    data.set([l.pos[0], l.pos[1], l.pos[2], spot ? -l.reach : l.reach, l.color[0], l.color[1], l.color[2], shut ? -l.size : l.size], o);
    if (spot) {
      const n = Math.hypot(...l.dir!) || 1;
      data.set([l.dir![0] / n, l.dir![1] / n, l.dir![2] / n, Math.cos((l.cone! * Math.PI) / 180), Math.cos(((l.inner ?? l.cone! * 0.5) * Math.PI) / 180), 0, 0, 0], o + 8);
    }
  });
  const chainRows = Math.max(1, Math.ceil(chainData.length / 4 / CHAIN_W));
  const chains = new Float32Array(chainRows * CHAIN_W * 4);
  chains.set(chainData);
  return { origin, dims, grid, list, listRows, lamps: data, lampRows, chains, chainRows, stats, thinAt, lostAt };
}

/** One lamp's part of the light at a point, as gridLightAt found it. */
export interface LampLight { lamp: number; e: [number, number, number]; shut: number }

/** What lamp `i` gives at `wp` on a surface facing `n` with nothing in the way (zero out of its reach or its cone). */
export function lampGives(g: LightGrid, i: number, wp: ArrayLike<number>, n: ArrayLike<number>): [number, number, number] {
  const o = i * LAMP_TEXELS * 4, L = g.lamps;
  const to = [L[o] - wp[0], L[o + 1] - wp[1], L[o + 2] - wp[2]];
  const reach = Math.abs(L[o + 3]), d2 = to[0] * to[0] + to[1] * to[1] + to[2] * to[2], r2 = reach * reach;
  if (d2 >= r2) return [0, 0, 0];
  const indoor = L[o + 7] < 0, size = Math.abs(L[o + 7]);
  const inv = 1 / Math.sqrt(Math.max(d2, 1e-4)), l = [to[0] * inv, to[1] * inv, to[2] * inv];
  // (The shader's own words on wrap and fill: lightGrid.ts.)
  const wrap = indoor ? 0.5 : 0.25;
  const lam = Math.min(1, Math.max(0, (n[0] * l[0] + n[1] * l[1] + n[2] * l[2] + wrap) / (1 + wrap)));
  const win = 1 - d2 / r2;
  let cone = 1;
  if (L[o + 3] < 0) {
    const x = Math.min(1, Math.max(0, (-(l[0] * L[o + 8] + l[1] * L[o + 9] + l[2] * L[o + 10]) - L[o + 11]) / (L[o + 12] - L[o + 11])));
    cone = x * x * (3 - 2 * x);
  }
  const att = (win * win) / (1 + d2 / (size * size));
  const fill = indoor ? 0.08 * win * win : 0;
  const k = (att * lam + fill) * cone;
  return [L[o + 4] * k, L[o + 5] * k, L[o + 6] * k];
}

/**
 * The light (irradiance) at world point `wp` on a surface facing `n`: the
 * shader's gridLight, number for number. `each` is told what each lamp gave.
 */
export function gridLightAt(g: LightGrid, wp: number[], n: number[], ambient: number[] = [0, 0, 0], ambientUp = 0, each?: (l: LampLight) => void): [number, number, number] {
  const E: [number, number, number] = [ambient[0] * (1 + ambientUp * n[2]), ambient[1] * (1 + ambientUp * n[2]), ambient[2] * (1 + ambientUp * n[2])];
  const ci = [0, 1, 2].map((k) => Math.floor((wp[k] + n[k] * 2 - g.origin[k]) / CELL[k]));
  if (ci.some((v, k) => v < 0 || v >= g.dims[k])) return E;
  const c = (ci[2] * g.dims[1] + ci[1]) * g.dims[0] + ci[0];
  const from = g.grid[c * 2], count = g.grid[c * 2 + 1];
  for (let q = 0; q < count; q++) {
    const i = g.list[(from + q) * 2], chain = g.list[(from + q) * 2 + 1];
    const e = lampGives(g, i, wp, n);
    if (e[0] <= 0 && e[1] <= 0 && e[2] <= 0) continue;
    let shut = 1;
    if (chain >= 0) {
      const o = i * LAMP_TEXELS * 4, at = chain * 4;
      shut = lampSees([g.lamps[o], g.lamps[o + 1], g.lamps[o + 2]], wp, g.chains, g.chains[at + 3], at, 8);
      if (shut <= 0) continue;
      e[0] *= shut; e[1] *= shut; e[2] *= shut;
    }
    E[0] += e[0]; E[1] += e[1]; E[2] += e[2];
    each?.({ lamp: i, e, shut });
  }
  return E;
}

/** The lamps listed for the cell that holds point p (for tests). */
export function lampsListedAt(g: LightGrid, p: number[]): number[] {
  const ci = [0, 1, 2].map((k) => Math.floor((p[k] - g.origin[k]) / CELL[k]));
  if (ci.some((v, k) => v < 0 || v >= g.dims[k])) return [];
  const c = (ci[2] * g.dims[1] + ci[1]) * g.dims[0] + ci[0];
  const out: number[] = [];
  for (let q = 0; q < g.grid[c * 2 + 1]; q++) out.push(g.list[(g.grid[c * 2] + q) * 2]);
  return out;
}
