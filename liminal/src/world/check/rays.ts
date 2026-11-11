/**
 * Rays against a map's brushes, for checks that ask what can be seen from
 * where (tools/world/look.ts). Brushes are filed in grids by size (a brush
 * goes in the finest grid where it covers only a few cells), and a ray walks
 * each grid cell by cell. No three.js.
 */
export interface RayBrush {
  id: number;
  /** Planes n·p = d, n pointing out. */
  planes: { n: [number, number, number]; d: number; face: number | string }[];
  min: number[];
  max: number[];
}
export interface RayHit { t: number; brush: RayBrush; plane: RayBrush['planes'][number]; point: [number, number, number] }

const BASE = 256, MAX_SPAN = 4;
interface Level { cell: number; map: Map<number, number[]> }

export class RayWorld {
  private levels: Level[] = [];
  private stamp: Int32Array;
  private mark = 0;
  constructor(readonly brushes: RayBrush[]) {
    brushes.forEach((b, i) => {
      const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
      let level = 0, cell = BASE;
      while (size > cell * MAX_SPAN) { level++; cell *= 4; }
      while (this.levels.length <= level) this.levels.push({ cell: BASE * 4 ** this.levels.length, map: new Map() });
      const g = this.levels[level];
      for (let x = Math.floor(b.min[0] / g.cell); x <= Math.floor(b.max[0] / g.cell); x++)
        for (let y = Math.floor(b.min[1] / g.cell); y <= Math.floor(b.max[1] / g.cell); y++)
          for (let z = Math.floor(b.min[2] / g.cell); z <= Math.floor(b.max[2] / g.cell); z++) {
            const k = key(x, y, z), l = g.map.get(k);
            if (l) l.push(i); else g.map.set(k, [i]);
          }
    });
    this.stamp = new Int32Array(brushes.length);
  }

  /**
   * The first brush a ray from `o` along unit direction `dir` enters within
   * `far` units, or null. A brush the ray starts inside is not counted,
   * unless `inside` is given: then it is called for each such brush.
   */
  cast(o: ArrayLike<number>, dir: ArrayLike<number>, far: number, inside?: (b: RayBrush) => void): RayHit | null {
    const m = ++this.mark;
    let best = far, hitB: RayBrush | null = null, hitP: RayBrush['planes'][number] | null = null;
    const test = (i: number) => {
      if (this.stamp[i] === m) return;
      this.stamp[i] = m;
      const b = this.brushes[i];
      let enter = -Infinity, exit = Infinity, plane: RayBrush['planes'][number] | null = null;
      for (const p of b.planes) {
        const dist = p.n[0] * o[0] + p.n[1] * o[1] + p.n[2] * o[2] - p.d;
        const denom = p.n[0] * dir[0] + p.n[1] * dir[1] + p.n[2] * dir[2];
        if (Math.abs(denom) < 1e-9) { if (dist > 0) return; continue; }
        const t = -dist / denom;
        if (denom < 0) { if (t > enter) { enter = t; plane = p; } } else if (t < exit) exit = t;
        if (enter > exit) return;
      }
      if (enter < 0) { if (exit > 0 && inside) inside(b); return; }
      if (enter < best && plane) { best = enter; hitB = b; hitP = plane; }
    };
    for (const g of this.levels) {
      // Walk the grid's cells along the ray (a 3D DDA), as far as the best hit so far.
      const c = g.cell;
      const ix = [Math.floor(o[0] / c), Math.floor(o[1] / c), Math.floor(o[2] / c)];
      const step = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tDelta = [Infinity, Infinity, Infinity];
      for (let k = 0; k < 3; k++) {
        if (dir[k] > 1e-12) { step[k] = 1; tMax[k] = ((ix[k] + 1) * c - o[k]) / dir[k]; tDelta[k] = c / dir[k]; }
        else if (dir[k] < -1e-12) { step[k] = -1; tMax[k] = (ix[k] * c - o[k]) / dir[k]; tDelta[k] = -c / dir[k]; }
      }
      for (let t = 0; t <= best;) {
        const l = g.map.get(key(ix[0], ix[1], ix[2]));
        if (l) for (const i of l) test(i);
        const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
        t = tMax[k];
        ix[k] += step[k];
        tMax[k] += tDelta[k];
      }
    }
    if (!hitB || !hitP) return null;
    return { t: best, brush: hitB, plane: hitP, point: [o[0] + dir[0] * best, o[1] + dir[1] * best, o[2] + dir[2] * best] };
  }

  /** How much of the straight line from a to b lies inside brushes (its length in solid, each stretch counted once). */
  solid(a: ArrayLike<number>, b: ArrayLike<number>): number {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1e-6) return 0;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    const m = ++this.mark;
    const spans: [number, number][] = [];
    for (const g of this.levels) {
      const c = g.cell;
      const ix = [Math.floor(a[0] / c), Math.floor(a[1] / c), Math.floor(a[2] / c)];
      const step = [0, 0, 0], tMax = [Infinity, Infinity, Infinity], tDelta = [Infinity, Infinity, Infinity];
      for (let k = 0; k < 3; k++) {
        if (dir[k] > 1e-12) { step[k] = 1; tMax[k] = ((ix[k] + 1) * c - a[k]) / dir[k]; tDelta[k] = c / dir[k]; }
        else if (dir[k] < -1e-12) { step[k] = -1; tMax[k] = (ix[k] * c - a[k]) / dir[k]; tDelta[k] = -c / dir[k]; }
      }
      for (let t = 0; t <= len;) {
        const l = g.map.get(key(ix[0], ix[1], ix[2]));
        if (l) for (const i of l) {
          if (this.stamp[i] === m) continue;
          this.stamp[i] = m;
          let enter = 0, exit = len, out = false;
          for (const p of this.brushes[i].planes) {
            const dist = p.n[0] * a[0] + p.n[1] * a[1] + p.n[2] * a[2] - p.d;
            const denom = p.n[0] * dir[0] + p.n[1] * dir[1] + p.n[2] * dir[2];
            if (Math.abs(denom) < 1e-9) { if (dist > 0) { out = true; break; } continue; }
            const tt = -dist / denom;
            if (denom < 0) { if (tt > enter) enter = tt; } else if (tt < exit) exit = tt;
            if (enter >= exit) { out = true; break; }
          }
          if (!out) spans.push([enter, exit]);
        }
        const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
        t = tMax[k];
        ix[k] += step[k];
        tMax[k] += tDelta[k];
      }
    }
    spans.sort((p, q) => p[0] - q[0]);
    let total = 0, end = -Infinity;
    for (const [s0, s1] of spans) { if (s1 <= end) continue; total += s1 - Math.max(s0, end); end = s1; }
    return total;
  }

  /** Is the straight line from a to b free of every brush (but for the ends, by `skin`)? */
  clear(a: ArrayLike<number>, b: ArrayLike<number>, skin = 0.5): boolean {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2]);
    if (len <= 2 * skin) return true;
    const dir = [d[0] / len, d[1] / len, d[2] / len];
    const from = [a[0] + dir[0] * skin, a[1] + dir[1] * skin, a[2] + dir[2] * skin];
    let blocked = false;
    const hit = this.cast(from, dir, len - 2 * skin, () => { blocked = true; });
    return !blocked && !hit;
  }
}

const key = (x: number, y: number, z: number) => ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
