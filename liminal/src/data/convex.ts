/**
 * Geometry of convex brushes given as planes (n · p ≤ d inside), as Hammer
 * and the Source engine store them. Plain math, no three.js: used by the map
 * parser (bounds), the face builder and collision.
 */
export type Plane4 = [number, number, number, number];
type P3 = [number, number, number];

const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Two unit vectors spanning the plane with normal n. */
export function planeBasis(n: P3): [P3, P3] {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const helper: P3 = az >= ax && az >= ay ? [1, 0, 0] : [0, 0, 1];
  const t1 = norm(cross(helper, n));
  return [t1, cross(n, t1)];
}

/**
 * The polygon of side `i`: a huge square on its plane, clipped by every other
 * plane (Sutherland–Hodgman). Counter-clockwise seen from outside. Empty if
 * the side is degenerate.
 */
export function sidePolygon(planes: Plane4[], i: number, eps = 1e-4): P3[] {
  const [nx, ny, nz, d] = planes[i];
  const n: P3 = [nx, ny, nz];
  const [t1, t2] = planeBasis(n);
  const c: P3 = [nx * d, ny * d, nz * d];
  const R = 1 << 20;
  // CCW seen from outside (looking along -n): t1, t2 with t1 × t2 = n.
  let poly: P3[] = [[-R, -R], [R, -R], [R, R], [-R, R]].map(([a, b]) => [c[0] + t1[0] * a + t2[0] * b, c[1] + t1[1] * a + t2[1] * b, c[2] + t1[2] * a + t2[2] * b] as P3);
  for (let j = 0; j < planes.length && poly.length; j++) {
    if (j === i) continue;
    const pn: P3 = [planes[j][0], planes[j][1], planes[j][2]], pd = planes[j][3];
    const out: P3[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const da = dot(pn, a) - pd, db = dot(pn, b) - pd;
      if (da <= eps) out.push(a);
      if ((da < -eps && db > eps) || (da > eps && db < -eps)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    poly = out;
  }
  // Drop near-duplicate points (clipping through a vertex).
  const clean: P3[] = [];
  for (const p of poly) {
    const q = clean[clean.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 1e-3) clean.push(p);
  }
  if (clean.length > 1) {
    const f = clean[0], l = clean[clean.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1], f[2] - l[2]) <= 1e-3) clean.pop();
  }
  return clean.length >= 3 ? clean : [];
}

/** Bounds of a convex brush. */
export function convexBounds(planes: Plane4[]): { min: P3; max: P3 } | null {
  const min: P3 = [Infinity, Infinity, Infinity], max: P3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let i = 0; i < planes.length; i++) {
    for (const p of sidePolygon(planes, i)) {
      any = true;
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
    }
  }
  return any ? { min, max } : null;
}
