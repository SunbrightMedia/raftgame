import { type Vec3, v3, copy } from '../vec3';
import type { CollisionBrush, Plane } from './brush';

/**
 * How far traces stop short of a surface. Keeping the hull a hair off every
 * plane is what lets it slide along floors and across brush seams without
 * snagging (Quake 3's SURFACE_CLIP_EPSILON).
 */
export const SURFACE_CLIP_EPSILON = 0.125;

export interface TraceResult {
  /** 0..1 along start→end that the hull got before touching something. */
  fraction: number;
  endpos: Vec3;
  /** Normal of the surface hit (zero vector if nothing was hit). */
  normal: Vec3;
  /** The start position was inside a solid. */
  startsolid: boolean;
  /** The whole move was inside a solid. */
  allsolid: boolean;
  brush: CollisionBrush | null;
}

/** Anything a hull can be swept through: one map's collision world, or several side by side (a world loaded piece by piece). */
export interface TraceWorld {
  trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): TraceResult;
  testPosition(pos: Vec3, mins: Vec3, maxs: Vec3): boolean;
}

/**
 * The static collision world: convex brushes in uniform grids, so a trace only
 * tests the brushes near its swept bounds, then a per-brush bounding-box
 * rejection. There are several grids, each with cells four times the size of
 * the last (64, 256, 1024...): a brush goes in the finest grid where it covers
 * only a few cells, so a wall a mile long costs as little to index as a chair.
 * Maps with tens of thousands of brushes, of any size, stay cheap.
 */
const CELL = 64;
/** A brush is filed in the first grid where its longest side spans at most this many cells. */
const MAX_SPAN = 4;
interface Grid { cell: number; map: Map<number, number[]>; all: number[] }
export class CollisionWorld implements TraceWorld {
  brushes: CollisionBrush[] = [];
  private grids: Grid[] = [];
  private stamp: Int32Array;
  private mark = 0;

  constructor(brushes: CollisionBrush[] = []) {
    this.brushes = brushes;
    brushes.forEach((b, i) => {
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      let level = 0, cell = CELL;
      while (size > cell * MAX_SPAN) { level++; cell *= 4; }
      while (this.grids.length <= level) this.grids.push({ cell: CELL * 4 ** this.grids.length, map: new Map(), all: [] });
      const g = this.grids[level];
      g.all.push(i);
      this.cells(g.cell, b.min, b.max, (k) => { const l = g.map.get(k); if (l) l.push(i); else g.map.set(k, [i]); });
    });
    this.stamp = new Int32Array(brushes.length);
  }

  /** Visit a grid's cells overlapping [lo, hi]; keys pack three cell indices (±2^16 cells each way). */
  private cells(cell: number, lo: Vec3, hi: Vec3, f: (k: number) => void): void {
    const x0 = Math.floor(lo.x / cell), x1 = Math.floor(hi.x / cell), y0 = Math.floor(lo.y / cell), y1 = Math.floor(hi.y / cell), z0 = Math.floor(lo.z / cell), z1 = Math.floor(hi.z / cell);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) f(((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768));
  }

  /**
   * Sweep an axis-aligned box (mins/maxs relative to the origin) from start
   * to end. Quake 3's CM_TraceThroughBrush, generalised to any brush.
   */
  trace(start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): TraceResult {
    const tr: TraceResult = {
      fraction: 1,
      endpos: copy(end),
      normal: v3(),
      startsolid: false,
      allsolid: false,
      brush: null,
    };

    // Swept bounds of the hull, for cheap rejection.
    const lo = v3(Math.min(start.x, end.x) + mins.x - 1, Math.min(start.y, end.y) + mins.y - 1, Math.min(start.z, end.z) + mins.z - 1);
    const hi = v3(Math.max(start.x, end.x) + maxs.x + 1, Math.max(start.y, end.y) + maxs.y + 1, Math.max(start.z, end.z) + maxs.z + 1);

    const m = ++this.mark;
    const test = (i: number) => {
      if (this.stamp[i] === m) return;
      this.stamp[i] = m;
      const b = this.brushes[i];
      if (b.max.x < lo.x || b.min.x > hi.x || b.max.y < lo.y || b.min.y > hi.y || b.max.z < lo.z || b.min.z > hi.z) return;
      if (!tr.allsolid) traceBrush(tr, b, start, end, mins, maxs);
    };
    for (const g of this.grids) {
      // Long sweeps (noclip, huge falls) would visit many empty cells of a fine grid: test all its brushes instead.
      const span = ((hi.x - lo.x) / g.cell + 1) * ((hi.y - lo.y) / g.cell + 1) * ((hi.z - lo.z) / g.cell + 1);
      if (span > 4096 || span > g.all.length) for (const i of g.all) test(i);
      else this.cells(g.cell, lo, hi, (k) => { const l = g.map.get(k); if (l) for (const i of l) test(i); });
    }

    if (tr.fraction < 1) {
      tr.endpos = v3(
        start.x + (end.x - start.x) * tr.fraction,
        start.y + (end.y - start.y) * tr.fraction,
        start.z + (end.z - start.z) * tr.fraction,
      );
    } else {
      tr.endpos = copy(end);
    }
    if (tr.allsolid) tr.endpos = copy(start);
    return tr;
  }

  /** True if a hull at `pos` overlaps any solid. */
  testPosition(pos: Vec3, mins: Vec3, maxs: Vec3): boolean {
    return this.trace(pos, pos, mins, maxs).startsolid;
  }
}

function traceBrush(tr: TraceResult, b: CollisionBrush, start: Vec3, end: Vec3, mins: Vec3, maxs: Vec3): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let clipPlane: Plane | null = null;
  let getout = false;
  let startout = false;

  for (const p of b.planes) {
    const n = p.n;
    // Push the plane out by the hull: use the hull corner that reaches furthest
    // against the plane normal.
    const ox = n.x < 0 ? maxs.x : mins.x;
    const oy = n.y < 0 ? maxs.y : mins.y;
    const oz = n.z < 0 ? maxs.z : mins.z;
    const dist = p.d - (n.x * ox + n.y * oy + n.z * oz);

    const d1 = start.x * n.x + start.y * n.y + start.z * n.z - dist;
    const d2 = end.x * n.x + end.y * n.y + end.z * n.z - dist;

    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;

    // Completely in front of this plane: the move never touches the brush.
    if (d1 > 0 && (d2 >= SURFACE_CLIP_EPSILON || d2 >= d1)) return;
    // Completely behind: this plane doesn't constrain the move.
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      // Entering the brush through this plane.
      let f = (d1 - SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f < 0) f = 0;
      if (f > enterFrac) { enterFrac = f; clipPlane = p; }
    } else {
      // Leaving.
      let f = (d1 + SURFACE_CLIP_EPSILON) / (d1 - d2);
      if (f > 1) f = 1;
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startout) {
    tr.startsolid = true;
    if (!getout) {
      tr.allsolid = true;
      tr.fraction = 0;
      tr.brush = b;
    }
    return;
  }

  if (enterFrac < leaveFrac && enterFrac > -1 && enterFrac < tr.fraction && clipPlane) {
    tr.fraction = Math.max(0, enterFrac);
    tr.normal = copy(clipPlane.n);
    tr.brush = b;
  }
}
