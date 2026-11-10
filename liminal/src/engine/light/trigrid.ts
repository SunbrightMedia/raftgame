/**
 * Triangles (static props' shadow shapes) in a uniform grid, for ray tests
 * in the light bakers. Same traversal as SolidGrid (Amanatides & Woo).
 */
export class TriGrid {
  private min = [0, 0, 0];
  private cell = 16;
  private n = [1, 1, 1];
  private start: Int32Array;
  private items: Int32Array;
  private stamp: Int32Array;
  private mark = 0;

  /** `tris`: 9 floats per triangle (world space). */
  constructor(private tris: Float32Array) {
    const count = tris.length / 9;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
    if (!count) { lo.fill(0); hi.fill(1); }
    this.min = lo.map((v) => v - 1);
    const ext = Math.max(...hi.map((v, k) => v + 1 - this.min[k]));
    this.cell = Math.max(16, ext / 128);
    this.n = hi.map((v, k) => Math.max(1, Math.ceil((v + 1 - this.min[k]) / this.cell)));
    const cells = this.n[0] * this.n[1] * this.n[2];
    const cnt = new Int32Array(cells + 1);
    const span = (t: number, f: (c: number) => void) => {
      const a = [0, 1, 2].map((k) => this.idx(Math.min(tris[t * 9 + k], tris[t * 9 + 3 + k], tris[t * 9 + 6 + k]), k));
      const z = [0, 1, 2].map((k) => this.idx(Math.max(tris[t * 9 + k], tris[t * 9 + 3 + k], tris[t * 9 + 6 + k]), k));
      for (let x = a[0]; x <= z[0]; x++) for (let y = a[1]; y <= z[1]; y++) for (let w = a[2]; w <= z[2]; w++) f((w * this.n[1] + y) * this.n[0] + x);
    };
    for (let t = 0; t < count; t++) span(t, (c) => cnt[c + 1]++);
    for (let i = 0; i < cells; i++) cnt[i + 1] += cnt[i];
    this.start = cnt;
    this.items = new Int32Array(cnt[cells]);
    const fill = cnt.slice();
    for (let t = 0; t < count; t++) span(t, (c) => { this.items[fill[c]++] = t; });
    this.stamp = new Int32Array(count);
  }

  get size(): number { return this.tris.length / 9; }

  private idx(v: number, k: number): number {
    return Math.min(this.n[k] - 1, Math.max(0, Math.floor((v - this.min[k]) / this.cell)));
  }

  /** Möller–Trumbore: parameter t along o + d·t, or -1. */
  private hit(t: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    const T = this.tris, i = t * 9;
    const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2];
    const e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const sx = ox - T[i], sy = oy - T[i + 1], sz = oz - T[i + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  /** Nearest triangle hit along o + d·t, t in (eps, 1]; -1 if none. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (!this.size) return -1;
    let best = -1;
    const m = ++this.mark;
    // Clip the segment to the grid, then walk the cells it crosses.
    let t0 = 0, t1 = 1;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let k = 0; k < 3; k++) {
      const lo = this.min[k], hi = this.min[k] + this.n[k] * this.cell;
      if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo || o[k] > hi) return -1; continue; }
      let a = (lo - o[k]) / d[k], b = (hi - o[k]) / d[k];
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return -1;
    }
    const c = [0, 1, 2].map((k) => this.idx(o[k] + d[k] * t0, k));
    const step = d.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const tNext = [0, 1, 2].map((k) => (step[k] === 0 ? Infinity : (this.min[k] + (c[k] + (step[k] > 0 ? 1 : 0)) * this.cell - o[k]) / d[k]));
    const tDelta = [0, 1, 2].map((k) => (step[k] === 0 ? Infinity : this.cell / Math.abs(d[k])));
    for (;;) {
      const cell = (c[2] * this.n[1] + c[1]) * this.n[0] + c[0];
      for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
        const t = this.items[k];
        if (this.stamp[t] === m) continue;
        this.stamp[t] = m;
        const h = this.hit(t, ox, oy, oz, dx, dy, dz);
        if (h > 1e-4 && h <= 1 && (best < 0 || h < best)) best = h;
      }
      const tExit = Math.min(tNext[0], tNext[1], tNext[2], t1);
      if (best >= 0 && best <= tExit) return best;
      if (tExit >= t1) return best;
      const a = tNext[0] <= tNext[1] && tNext[0] <= tNext[2] ? 0 : tNext[1] <= tNext[2] ? 1 : 2;
      c[a] += step[a];
      if (c[a] < 0 || c[a] >= this.n[a]) return best;
      tNext[a] += tDelta[a];
    }
  }

  occluded(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const t = this.cast(ax, ay, az, bx - ax, by - ay, bz - az);
    return t > 0 && t < 1 - 1e-4;
  }
}
