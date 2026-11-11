/**
 * 2D geometry for the Backrooms planner. Units are tiles: 1 tile = one 2 ft
 * ceiling tile. +x is east, +y is south (screen order), angles in radians.
 */
export interface V2 { x: number; y: number }

/** A local frame: origin and turn. Zones are built in their own frame. */
export interface Frame { x: number; y: number; a: number }

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const cross = (a: V2, b: V2): number => a.x * b.y - a.y * b.x;
export const len = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: V2): V2 => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a: V2): V2 => ({ x: -a.y, y: a.x });
export const lerp2 = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const dir = (a: number): V2 => ({ x: Math.cos(a), y: Math.sin(a) });
export const rot = (p: V2, a: number): V2 => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

export function toWorld(f: Frame, p: V2): V2 {
  const c = Math.cos(f.a), s = Math.sin(f.a);
  return { x: f.x + p.x * c - p.y * s, y: f.y + p.x * s + p.y * c };
}

export function toLocal(f: Frame, p: V2): V2 {
  const c = Math.cos(f.a), s = Math.sin(f.a);
  const dx = p.x - f.x, dy = p.y - f.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

/** Corners of an axis-aligned box (clockwise on screen). */
export function box(x0: number, y0: number, x1: number, y1: number): V2[] {
  return [v2(x0, y0), v2(x1, y0), v2(x1, y1), v2(x0, y1)];
}

/** World corners of a w×h box centred on the frame origin, grown by `grow`. */
export function obb(f: Frame, w: number, h: number, grow = 0): V2[] {
  const hw = w / 2 + grow, hh = h / 2 + grow;
  return box(-hw, -hh, hw, hh).map((p) => toWorld(f, p));
}

/** A rectangle around segment a–b, `w` wide, stretched `ext` past both ends. */
export function segBox(a: V2, b: V2, w: number, ext = 0): V2[] {
  const d = norm(sub(b, a));
  const n = mul(perp(d), w / 2);
  const a2 = sub(a, mul(d, ext)), b2 = add(b, mul(d, ext));
  return [add(a2, n), add(b2, n), sub(b2, n), sub(a2, n)];
}

function project(pts: V2[], axis: V2): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const d = p.x * axis.x + p.y * axis.y; if (d < lo) lo = d; if (d > hi) hi = d; }
  return [lo, hi];
}

/** Separating-axis test for two convex polygons. */
export function convexOverlap(a: V2[], b: V2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const axis = { x: q.y - p.y, y: p.x - q.x };
      const [a0, a1] = project(a, axis), [b0, b1] = project(b, axis);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

export function pointInPoly(p: V2, pts: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polyArea(pts: V2[]): number {
  let s = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(s) / 2;
}

export interface BBox { x0: number; y0: number; x1: number; y1: number }

export function bboxOf(pts: V2[], into?: BBox): BBox {
  const b = into ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) {
    if (p.x < b.x0) b.x0 = p.x; if (p.y < b.y0) b.y0 = p.y;
    if (p.x > b.x1) b.x1 = p.x; if (p.y > b.y1) b.y1 = p.y;
  }
  return b;
}

/**
 * The parts of segment a–b that lie outside the convex polygon `poly`
 * (Cyrus–Beck clipping). Used to cut wall pieces where an opening must stay
 * clear.
 */
export function segOutside(a: V2, b: V2, poly: V2[]): [V2, V2][] {
  let t0 = 0, t1 = 1;
  const d = sub(b, a);
  // polygon winding: make normals point outward
  const area2 = poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0);
  const sgn = area2 > 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const e = sub(q, p);
    const n = { x: sgn * e.y, y: -sgn * e.x }; // outward
    const num = dot(n, sub(a, p));
    const den = dot(n, d);
    if (Math.abs(den) < 1e-12) { if (num > 0) return [[a, b]]; continue; }
    const t = -num / den;
    if (den < 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; }
    if (t0 >= t1) return [[a, b]];
  }
  const out: [V2, V2][] = [];
  if (t0 > 1e-6) out.push([a, lerp2(a, b, t0)]);
  if (t1 < 1 - 1e-6) out.push([lerp2(a, b, t1), b]);
  return out;
}

/** Points along an arc from `p` heading `a0`, turning by `turn` over `length`. */
export function arcPoints(p: V2, a0: number, turn: number, length: number, steps: number): { pts: V2[]; end: V2; a1: number } {
  const pts: V2[] = [p];
  let cur = p, a = a0;
  const ds = length / steps, da = turn / steps;
  for (let i = 0; i < steps; i++) {
    a += da / 2;
    cur = add(cur, mul(dir(a), ds));
    a += da / 2;
    pts.push(cur);
  }
  return { pts, end: cur, a1: a };
}

export const TAU = Math.PI * 2;
export const wrapAngle = (a: number): number => { a %= TAU; return a < 0 ? a + TAU : a; };
