/**
 * Zone recipes: each builds one zone in its own frame (centred on 0, extents
 * ±w/2 × ±h/2, tiles), like a geometry-nodes group. Floors are drawn first
 * and the outer walls come from the outline of all floors together, so
 * zones and corridors merge with no seams. Inside walls are thin pieces; the
 * openings at the zone's ports are cut clear afterwards.
 */
import { Rng } from '../world/rng';
import { FEATURE } from './catalogue';
import { box, convexOverlap, dir, segOutside, toWorld, v2, type V2 } from './geom';
import type { AreaKind, MarkKind, Prim, Zone } from './types';

export class Out {
  readonly prims: Prim[] = [];
  constructor(readonly z: Zone) {}
  get hw(): number { return this.z.w / 2; }
  get hh(): number { return this.z.h / 2; }
  floor(pts: V2[]): void { this.prims.push({ t: 'floor', pts, zone: this.z.id }); }
  rect(x0: number, y0: number, x1: number, y1: number): void { this.floor(box(x0, y0, x1, y1)); }
  wall(x0: number, y0: number, x1: number, y1: number, w = 0.3, kind?: 'short' | 'bars' | 'glass' | 'fake' | 'over'): void {
    this.prims.push({ t: 'wall', a: v2(x0, y0), b: v2(x1, y1), w, zone: this.z.id, kind });
  }
  solid(pts: V2[], kind: 'pillar' | 'block' | 'mass' | 'furniture'): void { this.prims.push({ t: 'solid', pts, zone: this.z.id, kind }); }
  block(x0: number, y0: number, x1: number, y1: number, kind: 'pillar' | 'block' | 'mass' | 'furniture' = 'block'): void { this.solid(box(x0, y0, x1, y1), kind); }
  area(pts: V2[], kind: AreaKind): void { this.prims.push({ t: 'area', pts, zone: this.z.id, kind }); }
  areaRect(x0: number, y0: number, x1: number, y1: number, kind: AreaKind): void { this.area(box(x0, y0, x1, y1), kind); }
  stairs(x0: number, y0: number, x1: number, y1: number, down: number, steps: number, ramp = false): void {
    this.prims.push({ t: 'stairs', pts: box(x0, y0, x1, y1), dir: down, steps, zone: this.z.id, ramp });
  }
  light(x: number, y: number, kind?: 'off' | 'flicker' | 'emergency'): void { this.prims.push({ t: 'light', p: v2(x, y), zone: this.z.id, kind }); }
  mark(x: number, y: number, a: number, kind: MarkKind, s = 1, label?: string): void { this.prims.push({ t: 'mark', p: v2(x, y), a, s, zone: this.z.id, kind, label }); }
  label(x: number, y: number, text: string, size?: number): void { this.prims.push({ t: 'label', p: v2(x, y), text, zone: this.z.id, size }); }

  /** Lights on a grid inside a box (2×4 ft panels every `pitch` tiles). */
  lights(x0: number, y0: number, x1: number, y1: number, pitch = 4, r?: Rng): void {
    const nx = Math.max(1, Math.round((x1 - x0) / pitch)), ny = Math.max(1, Math.round((y1 - y0) / pitch));
    const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const k = r ? r.next() : 1;
      this.light(x0 + sx * (i + 0.5), y0 + sy * (j + 0.5), k < 0.03 ? 'off' : k < 0.06 ? 'flicker' : undefined);
    }
  }

  /** Cut walls and lift solids where a port's opening must stay clear, then move all to world space. */
  finish(clearDepth = 3.2): Prim[] {
    const z = this.z;
    const clears = z.ports.map((p) => {
      const d = dir(p.a); // outward
      const n = { x: -d.y, y: d.x };
      const hw = p.w / 2 + 0.6;
      const a = { x: p.p.x + d.x * 0.6, y: p.p.y + d.y * 0.6 };
      const b = { x: p.p.x - d.x * clearDepth, y: p.p.y - d.y * clearDepth };
      return [
        { x: a.x + n.x * hw, y: a.y + n.y * hw }, { x: b.x + n.x * hw, y: b.y + n.y * hw },
        { x: b.x - n.x * hw, y: b.y - n.y * hw }, { x: a.x - n.x * hw, y: a.y - n.y * hw },
      ];
    });
    let prims = this.prims;
    if (clears.length && FEATURE[z.feature]?.id !== 'mass') {
      const out: Prim[] = [];
      for (const pr of prims) {
        if (pr.t === 'wall') {
          let pieces: [V2, V2][] = [[pr.a, pr.b]];
          for (const c of clears) pieces = pieces.flatMap(([a, b]) => segOutside(a, b, c));
          for (const [a, b] of pieces) if (Math.hypot(b.x - a.x, b.y - a.y) > 0.25) out.push({ ...pr, a, b });
          continue;
        }
        if (pr.t === 'solid' && pr.kind !== 'mass' && clears.some((c) => convexOverlap(c, pr.pts))) continue;
        if (pr.t === 'mark' && (pr.kind === 'seat' || pr.kind === 'pew' || pr.kind === 'desk' || pr.kind === 'table' || pr.kind === 'shelf' || pr.kind === 'crate') && clears.some((c) => convexOverlap(c, box(pr.p.x - 0.4, pr.p.y - 0.4, pr.p.x + 0.4, pr.p.y + 0.4)))) continue;
        out.push(pr);
      }
      prims = out;
    }
    if (z.feature !== 'mass' && z.ports.length) prims = connectPorts(z, prims);
    const f = z.frame;
    const W = (p: V2) => toWorld(f, p);
    return prims.map((pr): Prim => {
      switch (pr.t) {
        case 'floor': case 'solid': case 'area': return { ...pr, pts: pr.pts.map(W) };
        case 'stairs': return { ...pr, pts: pr.pts.map(W), dir: pr.dir + f.a };
        case 'wall': return { ...pr, a: W(pr.a), b: W(pr.b) };
        case 'light': return { ...pr, p: W(pr.p) };
        case 'mark': return { ...pr, p: W(pr.p), a: pr.a + f.a };
        case 'label': return { ...pr, p: W(pr.p) };
        case 'duct': return { ...pr, pts: pr.pts.map(W) };
      }
    });
  }
}

/**
 * Make sure every port of a zone can be walked to from the others (and, with
 * one port, that the port does not open into a closed side room): on a
 * half-tile raster of the zone, flood from the first port; where a port is
 * not reached, cut a straight way from it to the nearest reached cell through
 * any thin wall or loose block in between. Local coordinates.
 */
function connectPorts(z: Zone, prims: Prim[]): Prim[] {
  const R = 2, hw = z.w / 2 + 1.5, hh = z.h / 2 + 1.5;
  const W = Math.ceil(hw * 2 * R), H = Math.ceil(hh * 2 * R);
  const X = (gx: number) => -hw + (gx + 0.5) / R, Y = (gy: number) => -hh + (gy + 0.5) / R;
  const build = (): Uint8Array => {
    const g = new Uint8Array(W * H);
    const fill = (pts: V2[], val: number) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      for (let gy = Math.max(0, Math.floor((y0 + hh) * R)); gy <= Math.min(H - 1, Math.ceil((y1 + hh) * R)); gy++) {
        for (let gx = Math.max(0, Math.floor((x0 + hw) * R)); gx <= Math.min(W - 1, Math.ceil((x1 + hw) * R)); gx++) {
          if (inPoly({ x: X(gx), y: Y(gy) }, pts)) g[gy * W + gx] = val;
        }
      }
    };
    for (const p of prims) if (p.t === 'floor') fill(p.pts, 1);
    // the passage ends just outside each port belong to the floor too
    for (const pt of z.ports) { const d = dir(pt.a); fill(box(pt.p.x - 0.5 + d.x * 0.6, pt.p.y - 0.5 + d.y * 0.6, pt.p.x + 0.5 + d.x * 0.6, pt.p.y + 0.5 + d.y * 0.6), 1); }
    for (const p of prims) {
      if (p.t === 'solid' && !p.closed) fill(p.pts, 0);
      else if (p.t === 'area' && (p.kind === 'pit' || p.kind === 'pool' || p.kind === 'crevice')) fill(p.pts, 0);
      else if (p.t === 'wall' && p.kind !== 'fake' && p.kind !== 'over' && !p.closed) {
        const half = p.w / 2 + 0.1;
        const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, L2 = dx * dx + dy * dy || 1;
        for (let gy = Math.max(0, Math.floor((Math.min(p.a.y, p.b.y) - half + hh) * R)); gy <= Math.min(H - 1, Math.ceil((Math.max(p.a.y, p.b.y) + half + hh) * R)); gy++) {
          for (let gx = Math.max(0, Math.floor((Math.min(p.a.x, p.b.x) - half + hw) * R)); gx <= Math.min(W - 1, Math.ceil((Math.max(p.a.x, p.b.x) + half + hw) * R)); gx++) {
            const px = X(gx), py = Y(gy);
            const t = Math.max(0, Math.min(1, ((px - p.a.x) * dx + (py - p.a.y) * dy) / L2));
            if ((p.a.x + dx * t - px) ** 2 + (p.a.y + dy * t - py) ** 2 <= half * half) g[gy * W + gx] = 0;
          }
        }
      }
    }
    return g;
  };
  const cellOf = (p: V2) => { const gx = Math.floor((p.x + hw) * R), gy = Math.floor((p.y + hh) * R); return gx >= 0 && gy >= 0 && gx < W && gy < H ? gy * W + gx : -1; };
  const flood = (g: Uint8Array, start: number): Uint8Array => {
    const seen = new Uint8Array(W * H);
    if (start < 0 || !g[start]) return seen;
    const st = [start]; seen[start] = 1;
    while (st.length) {
      const c = st.pop()!, x = c % W;
      for (const n of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (n >= 0 && n < W * H && !seen[n] && g[n]) { seen[n] = 1; st.push(n); }
    }
    return seen;
  };
  const inner = (pt: { p: V2; a: number }) => { const d = dir(pt.a); return v2(pt.p.x + d.x * 0.6, pt.p.y + d.y * 0.6); };
  let out = prims;
  const cut = (from: V2, to: V2) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    if (len < 0.05) return;
    const ux = (to.x - from.x) / len, uy = (to.y - from.y) / len, nx = -uy * 0.8, ny = ux * 0.8;
    const lane = [v2(from.x + nx, from.y + ny), v2(to.x + nx + ux * 0.5, to.y + ny + uy * 0.5), v2(to.x - nx + ux * 0.5, to.y - ny + uy * 0.5), v2(from.x - nx, from.y - ny)];
    const next: Prim[] = [];
    for (const pr of out) {
      if (pr.t === 'wall' && !pr.closed) {
        for (const [a, b] of segOutside(pr.a, pr.b, lane)) if (Math.hypot(b.x - a.x, b.y - a.y) > 0.25) next.push({ ...pr, a, b });
        continue;
      }
      if (pr.t === 'solid' && pr.kind !== 'mass' && !pr.closed && convexOverlap(lane, pr.pts)) continue;
      next.push(pr);
    }
    // and make sure there is floor under the lane (inside the room's own box; the lane starts just outside the door)
    const inBox = clipToBox(lane, z.w / 2, z.h / 2);
    if (inBox.length >= 3) next.push({ t: 'floor', pts: inBox, zone: z.id });
    out = next;
  };
  for (let round = 0; round < z.ports.length + 1; round++) {
    prims = out;
    const g = build();
    const seen = flood(g, cellOf(inner(z.ports[0])));
    let floorCells = 0, reached = 0;
    for (let k = 0; k < g.length; k++) { floorCells += g[k]; reached += seen[k]; }
    const nearestSeen = (p: V2): V2 | null => {
      let best = -1, bd = Infinity;
      for (let k = 0; k < seen.length; k++) if (seen[k]) { const d = (X(k % W) - p.x) ** 2 + (Y((k / W) | 0) - p.y) ** 2; if (d < bd) { bd = d; best = k; } }
      return best < 0 ? null : v2(X(best % W), Y((best / W) | 0));
    };
    const stuck = z.ports.find((pt) => { const c = cellOf(inner(pt)); return c >= 0 && g[c] && !seen[c]; });
    if (stuck) {
      const from = inner(stuck);
      const to = nearestSeen(from);
      if (to) cut(from, to);
      continue;
    }
    if (reached < floorCells * 0.45) {
      // the first port opens into a closed corner: cut towards the middle
      const from = inner(z.ports[0]);
      cut(from, v2(0, 0));
      continue;
    }
    break;
  }
  return out;
}

/** A polygon clipped to the box [-hw, hw] x [-hh, hh] (Sutherland-Hodgman; the box is convex). */
function clipToBox(pts: V2[], hw: number, hh: number): V2[] {
  let out = pts;
  const edges: [(p: V2) => number, (a: V2, b: V2) => V2][] = [
    [(p) => hw - p.x, (a, b) => v2(hw, a.y + ((b.y - a.y) * (hw - a.x)) / (b.x - a.x))],
    [(p) => p.x + hw, (a, b) => v2(-hw, a.y + ((b.y - a.y) * (-hw - a.x)) / (b.x - a.x))],
    [(p) => hh - p.y, (a, b) => v2(a.x + ((b.x - a.x) * (hh - a.y)) / (b.y - a.y), hh)],
    [(p) => p.y + hh, (a, b) => v2(a.x + ((b.x - a.x) * (-hh - a.y)) / (b.y - a.y), -hh)],
  ];
  for (const [inside, cut] of edges) {
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const a = inp[k], b = inp[(k + 1) % inp.length];
      const ia = inside(a) >= 0, ib = inside(b) >= 0;
      if (ib) { if (!ia) out.push(cut(a, b)); out.push(b); } else if (ia) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function inPoly(p: V2, pts: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

type Recipe = (o: Out, r: Rng) => void;

/** A rectangle, kept as numbers. */
interface Cell { x0: number; y0: number; x1: number; y1: number }

/** Split a box into rooms (binary space partition with uneven sizes). */
function split(r: Rng, c: Cell, min: number, maxRoom: number, out: Cell[]): void {
  const w = c.x1 - c.x0, h = c.y1 - c.y0;
  const big = Math.max(w, h);
  const stop = big < min * 2 || (big <= maxRoom && r.chance(0.35)) || (big <= maxRoom * 0.6);
  if (stop) { out.push(c); return; }
  const vertical = w > h ? true : w < h ? false : r.chance(0.5);
  const span = vertical ? w : h;
  const t = Math.round(r.range(min, span - min));
  if (vertical) { split(r, { ...c, x1: c.x0 + t }, min, maxRoom, out); split(r, { ...c, x0: c.x0 + t }, min, maxRoom, out); }
  else { split(r, { ...c, y1: c.y0 + t }, min, maxRoom, out); split(r, { ...c, y0: c.y0 + t }, min, maxRoom, out); }
}

/** The shared edge of two touching cells, or null. */
function shared(a: Cell, b: Cell): [V2, V2] | null {
  const e = 1e-6;
  if (Math.abs(a.x1 - b.x0) < e || Math.abs(b.x1 - a.x0) < e) {
    const x = Math.abs(a.x1 - b.x0) < e ? a.x1 : a.x0;
    const y0 = Math.max(a.y0, b.y0), y1 = Math.min(a.y1, b.y1);
    if (y1 - y0 > 1) return [v2(x, y0), v2(x, y1)];
  }
  if (Math.abs(a.y1 - b.y0) < e || Math.abs(b.y1 - a.y0) < e) {
    const y = Math.abs(a.y1 - b.y0) < e ? a.y1 : a.y0;
    const x0 = Math.max(a.x0, b.x0), x1 = Math.min(a.x1, b.x1);
    if (x1 - x0 > 1) return [v2(x0, y), v2(x1, y)];
  }
  return null;
}

/** A wall along a–b with a gap of `gap` tiles at a random place (gap 0 = solid wall). */
function gapWall(o: Out, r: Rng, a: V2, b: V2, gap: number, w = 0.3, kind?: 'short'): void {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (gap <= 0) { o.wall(a.x, a.y, b.x, b.y, w, kind); return; }
  if (L <= gap + 0.6) return; // the whole wall is the opening
  const t0 = r.range(0.3, L - gap - 0.3) / L, t1 = t0 + gap / L;
  const p = (t: number) => v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  const q0 = p(t0), q1 = p(t1);
  o.wall(a.x, a.y, q0.x, q0.y, w, kind);
  o.wall(q1.x, q1.y, b.x, b.y, w, kind);
}

class DSU {
  p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number { while (this.p[i] !== i) { this.p[i] = this.p[this.p[i]]; i = this.p[i]; } return i; }
  join(a: number, b: number): boolean { a = this.find(a); b = this.find(b); if (a === b) return false; this.p[a] = b; return true; }
}

/** Rooms from a split box: walls between neighbours, openings on a spanning tree plus some loops. */
function roomsFrom(o: Out, r: Rng, cells: Cell[], loopShare: number, opts: { gap?: [number, number]; drop?: number; furnish?: number; wallKind?: 'short' } = {}): Cell[] {
  const z = o.z;
  // drop some edge cells to make the outline irregular (never one that holds a port)
  const holdsPort = (c: Cell) => z.ports.some((p) => p.p.x >= c.x0 - 0.6 && p.p.x <= c.x1 + 0.6 && p.p.y >= c.y0 - 0.6 && p.p.y <= c.y1 + 0.6);
  let keep = cells.slice();
  const drop = opts.drop ?? 0;
  if (drop > 0) {
    const onEdge = (c: Cell) => c.x0 <= -o.hw + 1e-6 || c.y0 <= -o.hh + 1e-6 || c.x1 >= o.hw - 1e-6 || c.y1 >= o.hh - 1e-6;
    for (const c of r.shuffle(cells.slice())) {
      if (keep.length <= 2 || !onEdge(c) || holdsPort(c) || !r.chance(drop)) continue;
      const rest = keep.filter((k) => k !== c);
      // stay connected
      const dsu = new DSU(rest.length);
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) if (shared(rest[i], rest[j])) dsu.join(i, j);
      if (rest.every((_, i) => dsu.find(i) === dsu.find(0))) keep = rest;
    }
  }
  for (const c of keep) o.rect(c.x0, c.y0, c.x1, c.y1);
  const pairs: [number, number, [V2, V2]][] = [];
  for (let i = 0; i < keep.length; i++) for (let j = i + 1; j < keep.length; j++) {
    const s = shared(keep[i], keep[j]);
    if (s) pairs.push([i, j, s]);
  }
  const dsu = new DSU(keep.length);
  const open = new Set<number>();
  r.shuffle(pairs.map((_, k) => k)).forEach((k) => { if (dsu.join(pairs[k][0], pairs[k][1])) open.add(k); });
  pairs.forEach((_, k) => { if (!open.has(k) && r.chance(loopShare)) open.add(k); });
  const [g0, g1] = opts.gap ?? [2, 3];
  pairs.forEach(([, , [a, b]], k) => gapWall(o, r, a, b, open.has(k) ? r.int(g0, g1) : 0, 0.3, opts.wallKind));
  for (const c of keep) {
    o.lights(c.x0, c.y0, c.x1, c.y1, 4, r);
    if (opts.furnish && r.chance(opts.furnish)) furnish(o, r, c);
  }
  return keep;
}

/** A few pieces of furniture against one wall of a room. */
function furnish(o: Out, r: Rng, c: Cell): void {
  const kinds: MarkKind[] = ['table', 'desk', 'shelf', 'sofa', 'seat', 'crate', 'cupboard', 'bed', 'pooltable'];
  const k = r.weighted(kinds.map((m, i) => [m, [3, 3, 2, 1.5, 2, 1.5, 1, 0.6, 0.3][i]] as const));
  const n = k === 'seat' ? r.int(3, 8) : 1;
  const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? r.range(c.x0 + 1, c.x1 - 1) : r.range(c.x0 + 1.2, c.x1 - 1.2);
    const y = n > 1 ? r.range(c.y0 + 1, c.y1 - 1) : (r.chance(0.5) ? c.y0 + 1 : c.y1 - 1);
    o.mark(x, y, n > 1 ? r.range(0, Math.PI * 2) : Math.atan2(cy - y, cx - x), k, k === 'seat' ? 0.6 : 1.4);
  }
}

/** A floor strip from a port on the edge in to (cx, cy), clamped to the room's own box. */
function portStub(o: Out, p: { p: V2; w: number }, cx = 0, cy = 0): void {
  const x0 = Math.max(-o.hw, Math.min(p.p.x, cx) - p.w / 2), x1 = Math.min(o.hw, Math.max(p.p.x, cx) + p.w / 2);
  const y0 = Math.max(-o.hh, Math.min(p.p.y, cy) - p.w / 2), y1 = Math.min(o.hh, Math.max(p.p.y, cy) + p.w / 2);
  if (x1 > x0 && y1 > y0) o.rect(x0, y0, x1, y1);
}

const RECIPES: Record<string, Recipe> = {
  room(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    if (r.chance(0.35)) furnish(o, r, { x0: -o.hw, y0: -o.hh, x1: o.hw, y1: o.hh });
  },

  oddroom(o, r) {
    const mw = o.z.w * r.range(0.55, 0.8), mh = o.z.h * r.range(0.55, 0.8);
    const main: Cell = { x0: -mw / 2, y0: -mh / 2, x1: mw / 2, y1: mh / 2 };
    const parts: Cell[] = [main];
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) {
      const side = r.int(0, 3);
      const ew = r.range(2.5, o.z.w * 0.5), eh = r.range(2.5, o.z.h * 0.5);
      let c: Cell;
      if (side === 0) { const y = r.range(-o.hh, o.hh - eh); c = { x0: main.x1 - 0.01, y0: y, x1: o.hw, y1: y + eh }; }
      else if (side === 2) { const y = r.range(-o.hh, o.hh - eh); c = { x0: -o.hw, y0: y, x1: main.x0 + 0.01, y1: y + eh }; }
      else if (side === 1) { const x = r.range(-o.hw, o.hw - ew); c = { x0: x, y0: main.y1 - 0.01, x1: x + ew, y1: o.hh }; }
      else { const x = r.range(-o.hw, o.hw - ew); c = { x0: x, y0: -o.hh, x1: x + ew, y1: main.y0 + 0.01 }; }
      // keep it touching the main box
      c.y0 = Math.max(c.y0, -o.hh); c.y1 = Math.min(c.y1, o.hh); c.x0 = Math.max(c.x0, -o.hw); c.x1 = Math.min(c.x1, o.hw);
      if ((side === 0 || side === 2) && (c.y1 < main.y0 + 1 || c.y0 > main.y1 - 1)) continue;
      if ((side === 1 || side === 3) && (c.x1 < main.x0 + 1 || c.x0 > main.x1 - 1)) continue;
      parts.push(c);
    }
    // ports must land on a floor: add a stub from each port to the main box
    for (const p of o.z.ports) parts.push({ x0: Math.max(-o.hw, Math.min(p.p.x, 0) - p.w / 2), y0: Math.max(-o.hh, Math.min(p.p.y, 0) - p.w / 2), x1: Math.min(o.hw, Math.max(p.p.x, 0) + p.w / 2), y1: Math.min(o.hh, Math.max(p.p.y, 0) + p.w / 2) });
    for (const c of parts) o.rect(c.x0, c.y0, c.x1, c.y1);
    o.lights(main.x0, main.y0, main.x1, main.y1, 4, r);
    if (r.chance(0.3)) furnish(o, r, main);
  },

  group(o, r) {
    const cells: Cell[] = [];
    split(r, { x0: -o.hw, y0: -o.hh, x1: o.hw, y1: o.hh }, 4, r.chance(0.3) ? 14 : 9, cells);
    roomsFrom(o, r, cells, 0.3, { drop: 0.35, furnish: 0.3 });
  },

  chain(o, r) {
    const k = Math.max(2, Math.round(o.z.w / r.range(5, 9)));
    const cells: Cell[] = [];
    for (let i = 0; i < k; i++) cells.push({ x0: -o.hw + (o.z.w * i) / k, y0: -o.hh, x1: -o.hw + (o.z.w * (i + 1)) / k, y1: o.hh });
    roomsFrom(o, r, cells, 0, { gap: [2, 3], furnish: 0.25 });
  },

  cells(o, r) {
    const cw = r.int(2, 3);
    const c0 = -cw / 2, c1 = cw / 2;
    o.rect(-o.hw, c0, o.hw, c1);
    for (let x = -o.hw + 1.5; x < o.hw; x += 3) o.light(x, 0);
    for (const side of [-1, 1]) {
      let x = -o.hw;
      while (x < o.hw - 2) {
        const cwid = Math.min(o.hw - x, r.int(4, 7));
        const y0 = side < 0 ? -o.hh : c1, y1 = side < 0 ? c0 : o.hh;
        o.rect(x, y0, x + cwid, y1);
        const wallY = side < 0 ? c0 : c1;
        gapWall(o, r, v2(x, wallY), v2(x + cwid, wallY), r.chance(0.9) ? 2 : 0);
        if (x > -o.hw) o.wall(x, y0, x, y1);
        o.lights(x, y0, x + cwid, y1, 4, r);
        if (r.chance(0.6)) o.mark(x + cwid / 2, side < 0 ? y0 + 1.2 : y1 - 1.2, side < 0 ? Math.PI / 2 : -Math.PI / 2, 'desk', 1.4);
        x += cwid;
      }
    }
  },

  cubicles(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    const s = 3;
    for (let y = -o.hh + 2; y + 2 * s <= o.hh - 1; y += 2 * s + 2) {
      for (let x = -o.hw + 2; x + s <= o.hw - 1.5; x += s) {
        // a back-to-back pair of cubicles
        o.wall(x, y + s, x + s, y + s, 0.2, 'short');
        o.wall(x, y, x, y + 2 * s, 0.2, 'short');
        if (x + 2 * s > o.hw - 1.5) o.wall(x + s, y, x + s, y + 2 * s, 0.2, 'short');
        o.mark(x + s / 2, y + 0.7, Math.PI / 2, 'desk', 1.2);
        o.mark(x + s / 2, y + 2 * s - 0.7, -Math.PI / 2, 'desk', 1.2);
      }
    }
  },

  tinyroom(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    if (r.chance(0.5)) furnish(o, r, { x0: -o.hw, y0: -o.hh, x1: o.hw, y1: o.hh });
  },

  longroom(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    for (let x = -o.hw + 2; x < o.hw - 1; x += 4) o.light(x, 0, r.chance(0.05) ? 'off' : undefined);
  },

  huge(o, r) {
    // a few bumps so it is not a perfect box: the main floor stops short of the side, the bump reaches it
    const bumps: { sx: number; sy: number; nw: number; nh: number }[] = [];
    for (let i = 0; i < 2; i++) if (r.chance(0.6)) bumps.push({ nw: r.range(4, o.z.w * 0.3), nh: r.range(4, o.z.h * 0.3), sx: r.chance(0.5) ? 1 : -1, sy: r.chance(0.5) ? 1 : -1 });
    const inR = Math.max(0, ...bumps.filter((b) => b.sx > 0).map((b) => b.nw * 0.3)), inL = Math.max(0, ...bumps.filter((b) => b.sx < 0).map((b) => b.nw * 0.3));
    o.rect(-o.hw + inL, -o.hh, o.hw - inR, o.hh);
    for (const b of bumps) {
      const d = b.nw * 0.3;
      o.rect(b.sx > 0 ? o.hw - d - 0.01 : -o.hw, b.sy * o.hh - (b.sy > 0 ? b.nh : 0), b.sx > 0 ? o.hw : -o.hw + d + 0.01, b.sy * o.hh + (b.sy > 0 ? 0 : b.nh));
    }
    o.lights(-o.hw + inL, -o.hh, o.hw - inR, o.hh, 6, r);
  },

  openplan(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    const n = Math.round((o.z.w * o.z.h) / 60);
    for (let i = 0; i < n; i++) {
      const vert = r.chance(0.5);
      const L = r.int(3, 9);
      const x = Math.round(r.range(-o.hw + 2, o.hw - 2) / 2) * 2, y = Math.round(r.range(-o.hh + 2, o.hh - 2) / 2) * 2;
      if (vert) o.wall(x, y, x, Math.min(o.hh, y + L)); else o.wall(x, y, Math.min(o.hw, x + L), y);
      if (r.chance(0.35)) { if (vert) o.wall(x, y, Math.min(o.hw, x + r.int(2, 5)), y); else o.wall(x, y, x, Math.min(o.hh, y + r.int(2, 5))); }
    }
    if (r.chance(0.4)) furnish(o, r, { x0: -o.hw, y0: -o.hh, x1: o.hw, y1: o.hh });
  },

  oddhall(o, r) {
    const parts: Cell[] = [{ x0: -o.hw * r.range(0.5, 0.8), y0: -o.hh * r.range(0.5, 0.8), x1: o.hw * r.range(0.5, 0.8), y1: o.hh * r.range(0.5, 0.8) }];
    for (let i = 0; i < r.int(2, 4); i++) {
      const w = r.range(6, o.z.w * 0.55), h = r.range(6, o.z.h * 0.55);
      const x = r.range(-o.hw, o.hw - w), y = r.range(-o.hh, o.hh - h);
      parts.push({ x0: x, y0: y, x1: x + w, y1: y + h });
    }
    for (const p of o.z.ports) parts.push({ x0: Math.max(-o.hw, Math.min(p.p.x, 0) - p.w / 2), y0: Math.max(-o.hh, Math.min(p.p.y, 0) - p.w / 2), x1: Math.min(o.hw, Math.max(p.p.x, 0) + p.w / 2), y1: Math.min(o.hh, Math.max(p.p.y, 0) + p.w / 2) });
    for (const c of parts) o.rect(c.x0, c.y0, c.x1, c.y1);
    for (const c of parts.slice(0, 3)) o.lights(c.x0, c.y0, c.x1, c.y1, 5, r);
    for (let i = 0; i < r.int(3, 8); i++) {
      const x = r.range(-o.hw * 0.6, o.hw * 0.6), y = r.range(-o.hh * 0.6, o.hh * 0.6);
      if (r.chance(0.5)) o.wall(x, y, x + r.range(3, 8), y); else o.wall(x, y, x, y + r.range(3, 8));
    }
  },

  pluspillars(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const pitch = 6;
    const nx = Math.floor(o.z.w / pitch), ny = Math.floor(o.z.h / pitch);
    const ox = -((nx - 1) * pitch) / 2, oy = -((ny - 1) * pitch) / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = ox + i * pitch, y = oy + j * pitch;
      o.block(x - 1.25, y - 0.45, x + 1.25, y + 0.45, 'pillar');
      o.block(x - 0.45, y - 1.25, x + 0.45, y + 1.25, 'pillar');
    }
    for (let j = 0; j <= ny; j++) {
      const y = oy + (j - 0.5) * pitch;
      if (y < -o.hh + 0.5 || y > o.hh - 0.5) continue;
      for (let x = -o.hw + 1; x < o.hw - 0.5; x += 2) o.light(x, y, r.chance(0.02) ? 'off' : undefined);
    }
  },

  squarepillars(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const pitch = r.int(4, 5);
    for (let x = -o.hw + pitch; x < o.hw - 1; x += pitch) for (let y = -o.hh + pitch; y < o.hh - 1; y += pitch) {
      const jx = r.chance(0.15) ? r.pick([-1, 1]) : 0, jy = r.chance(0.1) ? r.pick([-1, 1]) : 0;
      o.block(x + jx - 0.5, y + jy - 0.5, x + jx + 0.5, y + jy + 0.5, 'pillar');
    }
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
  },

  bayhall(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const pitch = 6;
    const nx = Math.floor(o.z.w / pitch), ny = Math.max(1, Math.floor((o.z.h - 2) / pitch));
    const ox = -((nx - 1) * pitch) / 2, oy = -((ny - 1) * pitch) / 2;
    for (let i = 0; i < nx; i++) {
      const x = ox + i * pitch;
      for (let j = 0; j < ny; j++) {
        const y = oy + j * pitch;
        o.block(x - 1.25, y - 0.45, x + 1.25, y + 0.45, 'pillar');
        o.block(x - 0.45, y - 1.25, x + 0.45, y + 1.25, 'pillar');
      }
      // bays: the wall steps out between columns, nibs stay at the columns
      if (i < nx - 1) {
        const bx0 = x + 0.8, bx1 = x + pitch - 0.8;
        o.rect(bx0, -o.hh - 1, bx1, -o.hh + 0.01);
        o.rect(bx0, o.hh - 0.01, bx1, o.hh + 1);
      }
    }
    for (let j = 0; j <= ny; j++) {
      const y = oy + (j - 0.5) * pitch;
      for (let x = -o.hw + 1; x < o.hw - 0.5; x += 2) o.light(x, Math.max(-o.hh + 0.6, Math.min(o.hh - 0.6, y)));
    }
    if (r.chance(0.5)) { const x = ox + r.int(0, nx - 1) * pitch; o.wall(x, o.hh, x, oy + (ny - 1) * pitch + 1.25); }
  },

  checker(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const s = r.int(3, 4);
    const nx = Math.floor((o.z.w - 2) / s), ny = Math.floor((o.z.h - 2) / s);
    const ox = -(nx * s) / 2, oy = -(ny * s) / 2;
    const blocks = r.chance(0.55);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if ((i + j) % 2) continue;
      const x = ox + i * s, y = oy + j * s;
      if (blocks) o.block(x + 0.5, y + 0.5, x + s - 0.5, y + s - 0.5, 'block');
      else o.areaRect(x, y, x + s, y + s, 'tile');
    }
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
  },

  arches(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const pitch = r.int(3, 4);
    for (let x = -o.hw + pitch; x < o.hw - 1; x += pitch) {
      o.block(x - 0.3, -o.hh, x + 0.3, -o.hh + 1, 'pillar');
      o.block(x - 0.3, o.hh - 1, x + 0.3, o.hh, 'pillar');
      o.wall(x, -o.hh + 1, x, o.hh - 1, 0.12, 'over');
    }
    for (let x = -o.hw + pitch / 2; x < o.hw; x += pitch) o.light(x, 0);
  },

  holes(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const pitch = 3, s = r.chance(0.5) ? 1 : 1.4;
    const kind: AreaKind = r.chance(0.6) ? 'pit' : 'grate';
    for (let x = -o.hw + 2; x < o.hw - 1.5; x += pitch) for (let y = -o.hh + 2; y < o.hh - 1.5; y += pitch) o.areaRect(x - s / 2, y - s / 2, x + s / 2, y + s / 2, kind);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 6, r);
  },

  wallfield(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    const g = 3;
    const nx = Math.max(2, Math.floor(o.z.w / g)), ny = Math.max(2, Math.floor(o.z.h / g));
    const ox = -(nx * g) / 2, oy = -(ny * g) / 2;
    // walls live on the edges between cells; keep the cells connected
    type E = { a: number; b: number; x0: number; y0: number; x1: number; y1: number };
    const edges: E[] = [];
    const id = (i: number, j: number) => j * nx + i;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (i < nx - 1) edges.push({ a: id(i, j), b: id(i + 1, j), x0: ox + (i + 1) * g, y0: oy + j * g, x1: ox + (i + 1) * g, y1: oy + (j + 1) * g });
      if (j < ny - 1) edges.push({ a: id(i, j), b: id(i, j + 1), x0: ox + i * g, y0: oy + (j + 1) * g, x1: ox + (i + 1) * g, y1: oy + (j + 1) * g });
    }
    const density = r.range(0.38, 0.5);
    const wall = edges.map(() => r.chance(density));
    const dsu = new DSU(nx * ny);
    edges.forEach((e, k) => { if (!wall[k]) dsu.join(e.a, e.b); });
    r.shuffle(edges.map((_, k) => k)).forEach((k) => { if (wall[k] && dsu.join(edges[k].a, edges[k].b)) wall[k] = false; });
    // and a few more openings so it braids
    edges.forEach((_, k) => { if (wall[k] && r.chance(0.12)) wall[k] = false; });
    edges.forEach((e, k) => { if (wall[k]) o.wall(e.x0, e.y0, e.x1, e.y1, 0.5); });
    for (let i = 1; i < nx; i++) for (let j = 1; j < ny; j++) if (r.chance(0.06)) o.block(ox + i * g - 0.35, oy + j * g - 0.35, ox + i * g + 0.35, oy + j * g + 0.35, 'pillar');
  },

  islands(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    const placed: Cell[] = [];
    for (let t = 0; t < 60; t++) {
      const w = r.int(2, 6), h = r.int(2, 6);
      const x = Math.round(r.range(-o.hw + 2, o.hw - 2 - w)), y = Math.round(r.range(-o.hh + 2, o.hh - 2 - h));
      const c = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (placed.some((p) => c.x0 < p.x1 + 2.5 && c.x1 > p.x0 - 2.5 && c.y0 < p.y1 + 2.5 && c.y1 > p.y0 - 2.5)) continue;
      placed.push(c);
      o.block(c.x0, c.y0, c.x1, c.y1, 'block');
    }
  },

  maze(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 4, r);
    const g = 2.5;
    const nx = Math.max(2, Math.floor(o.z.w / g)), ny = Math.max(2, Math.floor(o.z.h / g));
    const ox = -(nx * g) / 2, oy = -(ny * g) / 2;
    const id = (i: number, j: number) => j * nx + i;
    const seen = new Uint8Array(nx * ny);
    const open = new Set<string>();
    const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    // growing tree: newest-first mostly (long rivers), sometimes random (stubs)
    const stack = [r.int(0, nx * ny - 1)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const idx = r.chance(0.75) ? stack.length - 1 : r.int(0, stack.length - 1);
      const c = stack[idx];
      const i = c % nx, j = Math.floor(c / nx);
      const nb = ([[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as const).filter(([a, b]) => a >= 0 && b >= 0 && a < nx && b < ny && !seen[id(a, b)]);
      if (!nb.length) { stack.splice(idx, 1); continue; }
      const [a, b] = r.pick(nb);
      seen[id(a, b)] = 1;
      open.add(key(c, id(a, b)));
      stack.push(id(a, b));
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (i < nx - 1 && !open.has(key(id(i, j), id(i + 1, j))) && !r.chance(0.08)) o.wall(ox + (i + 1) * g, oy + j * g, ox + (i + 1) * g, oy + (j + 1) * g, 0.25);
      if (j < ny - 1 && !open.has(key(id(i, j), id(i, j + 1))) && !r.chance(0.08)) o.wall(ox + i * g, oy + (j + 1) * g, ox + (i + 1) * g, oy + (j + 1) * g, 0.25);
    }
  },

  sawtooth(o, r) {
    const steps = r.int(2, 4);
    const st = Math.min(o.z.w, o.z.h) / (steps + 2);
    o.rect(-o.hw + st, -o.hh, o.hw, o.hh - st);
    for (let k = 0; k < steps; k++) o.rect(-o.hw + st * (steps - k) * 0.6, -o.hh + st * k, o.hw - st * k * 0.5, o.hh - st * k * 0.3);
    o.rect(-o.hw, -o.hh, o.hw - st, -o.hh + st * 1.5);
    for (const p of o.z.ports) portStub(o, p);
    o.lights(-o.hw + st, -o.hh + st, o.hw - st, o.hh - st, 4, r);
  },

  wedge(o, r) {
    const c = Math.min(o.z.w * 0.3, o.z.h * 0.6);
    o.floor([v2(-o.hw, 0), v2(-o.hw + c, -o.hh), v2(o.hw - c, -o.hh), v2(o.hw, 0), v2(o.hw - c, o.hh), v2(-o.hw + c, o.hh)]);
    for (const p of o.z.ports) portStub(o, p);
    o.lights(-o.hw + c, -o.hh + 1, o.hw - c, o.hh - 1, 4, r);
    if (r.chance(0.5)) {
      // bow-tie wedges in the middle
      o.solid([v2(-1.5, -o.hh + 0.5), v2(1.5, -o.hh + 0.5), v2(0, -o.hh + 2.5)], 'block');
      o.solid([v2(-1.5, o.hh - 0.5), v2(0, o.hh - 2.5), v2(1.5, o.hh - 0.5)], 'block');
    }
  },

  mass(o, r) {
    o.block(-o.hw, -o.hh, o.hw, o.hh, 'mass');
    if (r.chance(0.4)) o.label(0, 0, '?');
  },

  knot(o, r) {
    const n = 3, cw = 2;
    const sx = (o.z.w - cw) / (n - 1), sy = (o.z.h - cw) / (n - 1);
    const X = (i: number) => -o.hw + cw / 2 + i * sx, Y = (j: number) => -o.hh + cw / 2 + j * sy;
    type S = { a: number; b: number; x0: number; y0: number; x1: number; y1: number };
    const segs: S[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i < n - 1) segs.push({ a: j * n + i, b: j * n + i + 1, x0: X(i), y0: Y(j), x1: X(i + 1), y1: Y(j) });
      if (j < n - 1) segs.push({ a: j * n + i, b: (j + 1) * n + i, x0: X(i), y0: Y(j), x1: X(i), y1: Y(j + 1) });
    }
    const dsu = new DSU(n * n);
    const use = segs.map(() => r.chance(0.55));
    segs.forEach((s, k) => { if (use[k]) dsu.join(s.a, s.b); });
    r.shuffle(segs.map((_, k) => k)).forEach((k) => { if (!use[k] && dsu.join(segs[k].a, segs[k].b)) use[k] = true; });
    segs.forEach((s, k) => {
      if (!use[k]) return;
      o.rect(Math.min(s.x0, s.x1) - cw / 2, Math.min(s.y0, s.y1) - cw / 2, Math.max(s.x0, s.x1) + cw / 2, Math.max(s.y0, s.y1) + cw / 2);
      const L = Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
      for (let t = 1.5; t < L - 0.5; t += 3) o.light(s.x0 + ((s.x1 - s.x0) * t) / L, s.y0 + ((s.y1 - s.y0) * t) / L);
    });
    for (const p of o.z.ports) {
      // join each port to the nearest knot node
      const i = Math.max(0, Math.min(n - 1, Math.round((p.p.x + o.hw - cw / 2) / sx))), j = Math.max(0, Math.min(n - 1, Math.round((p.p.y + o.hh - cw / 2) / sy)));
      portStub(o, p, X(i), Y(j));
    }
  },

  comb(o, r) {
    const cw = 2.5;
    const top = r.chance(0.5);
    const c0 = top ? o.hh - cw : -o.hh, c1 = top ? o.hh : -o.hh + cw;
    o.rect(-o.hw, c0, o.hw, c1);
    for (let x = -o.hw + 1.5; x < o.hw; x += 3) o.light(x, (c0 + c1) / 2);
    let x = -o.hw;
    while (x < o.hw - 1.5) {
      const w = Math.min(o.hw - x, r.int(2, 4));
      const y0 = top ? -o.hh : c1, y1 = top ? c0 : o.hh;
      o.rect(x, y0, x + w, y1);
      if (x > -o.hw) o.wall(x, y0, x, y1);
      const wy = top ? c0 : c1;
      gapWall(o, r, v2(x, wy), v2(x + w, wy), w >= 3 ? 1.6 : 1.2);
      o.light(x + w / 2, (y0 + y1) / 2);
      x += w;
    }
  },

  ring(o, r) {
    const cw = r.int(2, 3);
    if (r.chance(0.5)) {
      const R = Math.min(o.hw, o.hh), n = 28;
      const outer: V2[] = [], inner: V2[] = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; outer.push(v2(Math.cos(a) * R, Math.sin(a) * R)); inner.push(v2(Math.cos(a) * (R - cw), Math.sin(a) * (R - cw))); }
      o.floor(outer);
      o.solid(inner, 'mass');
      for (let k = 0; k < n; k += 2) { const a = (k / n) * Math.PI * 2; o.light(Math.cos(a) * (R - cw / 2), Math.sin(a) * (R - cw / 2)); }
    } else {
      o.rect(-o.hw, -o.hh, o.hw, o.hh);
      o.block(-o.hw + cw, -o.hh + cw, o.hw - cw, o.hh - cw, 'mass');
      for (let x = -o.hw + 1; x < o.hw; x += 3) { o.light(x, -o.hh + cw / 2); o.light(x, o.hh - cw / 2); }
      for (let y = -o.hh + 3; y < o.hh - 2; y += 3) { o.light(-o.hw + cw / 2, y); o.light(o.hw - cw / 2, y); }
    }
    for (const p of o.z.ports) portStub(o, p, p.p.x * 0.75, p.p.y * 0.75);
  },

  deadend(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.light(0, 0, r.chance(0.2) ? 'flicker' : undefined);
    const pay = r.weighted<[MarkKind, string?]>([
      [['sign', 'THE END'], 1], [['exit'], 1.5], [['hatch'], 1], [['vent'], 1], [['note'], 1.5], [['crate'], 1], [['fan'], 0.5], [['mannequin'], 0.5], [['portal'], 0.4], [['sign', 'ALL MUST GO'], 0.5],
    ].map(([k, w]) => [k as [MarkKind, string?], w as number] as const));
    o.mark(0, 0, 0, pay[0], 1, pay[1]);
  },

  pool(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.areaRect(-o.hw, -o.hh, o.hw, o.hh, 'tile');
    const m = r.range(2, 3.5);
    o.areaRect(-o.hw + m, -o.hh + m, o.hw - m, o.hh - m, 'pool');
    o.stairs(-o.hw + m, -1, -o.hw + m + 2, 1, 0, 4);
    if (r.chance(0.4)) o.label(0, 0, 'no bottom?');
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 5, r);
  },

  theatre(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const sd = 3;
    o.areaRect(-o.hw, -o.hh, o.hw, -o.hh + sd, 'stage');
    if (r.chance(0.5)) {
      // rows facing the stage
      for (let y = -o.hh + sd + 2.5; y < o.hh - 1.5; y += 1.6) {
        for (let x = -o.hw + 1.5; x < o.hw - 1; x += 1.1) if (Math.abs(x) > 1) o.mark(x, y, -Math.PI / 2, 'seat', 0.7);
      }
    } else {
      // seats in arcs
      for (let k = 0; k < 5; k++) {
        const R = sd + 3 + k * 1.6;
        for (let a = 0.35; a < Math.PI - 0.35; a += 1.1 / R) {
          const x = Math.cos(a) * R, y = -o.hh + Math.sin(a) * R;
          if (Math.abs(x) < o.hw - 0.8 && y < o.hh - 0.8) o.mark(x, y, a + Math.PI, 'seat', 0.7);
        }
      }
    }
    o.lights(-o.hw, -o.hh + sd, o.hw, o.hh, 5, r);
  },

  church(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.areaRect(-o.hw + 1, -o.hh, o.hw - 1, -o.hh + 3, 'stage');
    o.mark(0, -o.hh + 1.5, Math.PI / 2, 'table', 2);
    for (let y = -o.hh + 5; y < o.hh - 2; y += 2) {
      o.mark(-o.hw / 2 - 0.6, y, 0, 'pew', o.hw - 2);
      o.mark(o.hw / 2 + 0.6, y, 0, 'pew', o.hw - 2);
    }
    for (let y = -o.hh + 2; y < o.hh; y += 4) { o.light(-o.hw / 2, y); o.light(o.hw / 2, y); }
    if (r.chance(0.5)) o.label(0, o.hh - 1, 'feels like a church');
  },

  machine(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const n = r.int(1, 3);
    for (let i = 0; i < n; i++) o.mark(-o.hw + (o.z.w * (i + 1)) / (n + 1), r.range(-o.hh / 3, o.hh / 3), 0, r.pick(['boiler', 'tank'] as const), r.range(2.5, 4));
    o.mark(0, -o.hh + 0.8, 0, 'pipe', o.z.w - 1);
    if (r.chance(0.5)) o.mark(0, o.hh - 0.8, 0, 'pipe', o.z.w - 1);
    if (r.chance(0.4)) o.mark(o.hw - 2, o.hh - 2, 0, 'fan', 2);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 6, r);
  },

  house(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    // the house itself, a box inside with real walls and doors
    const m = 2;
    const x0 = -o.hw + m, y0 = -o.hh + m, x1 = o.hw - m, y1 = o.hh - m;
    const cells: Cell[] = [];
    split(r, { x0, y0, x1, y1 }, 4, 7, cells);
    // front door on the side nearest to the first port
    const p = o.z.ports[0]?.p ?? v2(0, o.hh);
    const fx = Math.max(x0 + 1.5, Math.min(x1 - 1.5, p.x)), fy = Math.max(y0 + 1.5, Math.min(y1 - 1.5, p.y));
    const side = Math.abs(p.x) / o.hw > Math.abs(p.y) / o.hh ? (p.x > 0 ? 0 : 2) : (p.y > 0 ? 1 : 3);
    const door = side === 0 ? v2(x1, fy) : side === 2 ? v2(x0, fy) : side === 1 ? v2(fx, y1) : v2(fx, y0);
    const doorBox = box(door.x - 0.8, door.y - 0.8, door.x + 0.8, door.y + 0.8);
    for (const [a, b] of [[v2(x0, y0), v2(x1, y0)], [v2(x1, y0), v2(x1, y1)], [v2(x0, y1), v2(x1, y1)], [v2(x0, y0), v2(x0, y1)]] as const) {
      for (const [c, d] of segOutside(a, b, doorBox)) o.wall(c.x, c.y, d.x, d.y, 0.4);
    }
    o.mark(door.x, door.y, [0, Math.PI / 2, Math.PI, -Math.PI / 2][side], 'door', 1.4);
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const s = shared(cells[i], cells[j]);
      if (!s) continue;
      const [a, b] = s;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const t = r.range(0.25, 0.75);
      const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      const d = 0.6 / L;
      o.wall(a.x, a.y, q.x - (b.x - a.x) * d, q.y - (b.y - a.y) * d, 0.25);
      o.wall(q.x + (b.x - a.x) * d, q.y + (b.y - a.y) * d, b.x, b.y, 0.25);
      o.mark(q.x, q.y, Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, 'door', 1.1);
    }
    const kinds: MarkKind[] = ['bed', 'sofa', 'table', 'counter', 'shelf'];
    cells.forEach((c, i) => { o.mark((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2, 0, kinds[i % kinds.length], 1.6); o.light((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2 - 1); });
    o.label(0, -o.hh + 0.9, 'a normal house');
  },

  park(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const m = 1.5;
    const sk = r.range(-0.25, 0.25) * o.z.w;
    const lawn = [v2(-o.hw + m + Math.max(0, sk), -o.hh + m), v2(o.hw - m, -o.hh + m), v2(o.hw - m + Math.min(0, sk), o.hh - m), v2(-o.hw + m, o.hh - m)];
    o.area(lawn, 'lawn');
    const R = Math.min(o.hw, o.hh) * 0.28;
    o.areaRect(-o.hw + m, -0.8, o.hw - m, 0.8, 'path');
    o.areaRect(-0.8, -o.hh + m, 0.8, o.hh - m, 'path');
    const disc: V2[] = [];
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; disc.push(v2(Math.cos(a) * R, Math.sin(a) * R)); }
    o.area(disc, 'path');
    o.mark(0, 0, 0, 'fountain', R * 0.9);
    for (let i = 0; i < r.int(5, 12); i++) {
      const x = r.range(-o.hw + 3, o.hw - 3), y = r.range(-o.hh + 3, o.hh - 3);
      if (Math.abs(x) > 2 && Math.abs(y) > 2 && Math.hypot(x, y) > R + 1.5) o.mark(x, y, 0, 'tree', 1.6);
    }
    for (let i = 0; i < 4; i++) o.mark(r.range(-o.hw + 3, o.hw - 3), r.pick([-1.6, 1.6]), 0, 'bench', 1.6);
    o.lights(-o.hw, -o.hh, o.hw, o.hh, 6, r);
  },

  farm(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    o.areaRect(-o.hw + 1, -o.hh + 1, o.hw - 1, o.hh - 1, 'field');
    for (let y = -o.hh + 2; y < o.hh - 1; y += 1.5) o.wall(-o.hw + 2, y, o.hw - 2, y, 0.08, 'fake');
    if (r.chance(0.6)) o.mark(o.hw - 2.5, -o.hh + 2.5, 0, 'tree', 2);
    o.label(0, 0, 'fake field');
  },

  street(o, r) {
    o.rect(-o.hw, -o.hh, o.hw, o.hh);
    const rh = o.z.h * 0.42;
    o.areaRect(-o.hw, -rh / 2, o.hw, rh / 2, 'road');
    o.areaRect(-o.hw, -rh / 2 - 1.5, o.hw, -rh / 2, 'walk');
    o.areaRect(-o.hw, rh / 2, o.hw, rh / 2 + 1.5, 'walk');
    for (const s of [-1, 1]) {
      const y0 = s < 0 ? -o.hh : rh / 2 + 1.5, y1 = s < 0 ? -rh / 2 - 1.5 : o.hh;
      const wy = s < 0 ? y1 : y0;
      let x = -o.hw;
      while (x < o.hw - 3) {
        const w = Math.min(o.hw - x, r.int(4, 8));
        if (r.chance(0.4)) o.mark(x + w / 2, wy, s < 0 ? -Math.PI / 2 : Math.PI / 2, 'shopfront', w - 1);
        else gapWall(o, r, v2(x, wy), v2(x + w, wy), r.chance(0.5) ? 1.6 : 0, 0.3);
        if (x > -o.hw) o.wall(x, y0, x, y1);
        x += w;
      }
    }
    for (let x = -o.hw + 3; x < o.hw; x += 6) { o.light(x, -rh / 2 - 0.75, 'emergency'); o.light(x, rh / 2 + 0.75, 'emergency'); }
  },

  backarea(o, r) {
    const cells: Cell[] = [];
    split(r, { x0: -o.hw, y0: -o.hh, x1: o.hw, y1: o.hh }, 4, 10, cells);
    const kept = roomsFrom(o, r, cells, 0.2, { drop: 0.25 });
    for (const c of kept) {
      if (r.chance(0.6)) o.mark((c.x0 + c.x1) / 2, c.y0 + 0.5, 0, 'pipe', c.x1 - c.x0 - 0.6);
      if (r.chance(0.3)) o.mark(c.x1 - 0.8, (c.y0 + c.y1) / 2, 0, 'vent', 0.8);
    }
  },
};

export function hasRecipe(feature: string): boolean { return feature in RECIPES; }

/** Build one zone and return its prims in world space. */
export function buildZone(z: Zone, r: Rng): Prim[] {
  const o = new Out(z);
  (RECIPES[z.feature] ?? RECIPES.room)(o, r);
  applyTags(o, r);
  return o.finish();
}

/** Zone tags that change what is drawn inside the zone. */
function applyTags(o: Out, r: Rng): void {
  const z = o.z, t = new Set(z.tags);
  if (t.has('shortwalls')) for (const p of o.prims) if (p.t === 'wall' && !p.kind) (p as { kind?: string }).kind = 'short';
  if (t.has('dark') || t.has('noceiling')) for (let i = o.prims.length - 1; i >= 0; i--) if (o.prims[i].t === 'light') o.prims.splice(i, 1);
  if (t.has('flooded')) {
    const s = r.chance(0.5) ? 1 : -1;
    const x0 = s > 0 ? o.hw * r.range(0, 0.4) : -o.hw, x1 = s > 0 ? o.hw : -o.hw * r.range(0, 0.4);
    o.areaRect(x0, -o.hh, x1, o.hh, 'water');
    o.stairs(s > 0 ? x0 - 2 : x1, -o.hh * 0.4, s > 0 ? x0 : x1 + 2, o.hh * 0.4, s > 0 ? 0 : Math.PI, 3, true);
  }
  if (t.has('pit')) {
    if (r.chance(0.5)) { const x = r.range(-o.hw + 2, o.hw - 3), y = r.range(-o.hh + 2, o.hh - 3); o.areaRect(x, y, x + 1, y + 1, 'pit'); }
    else { const x = r.range(-o.hw / 2, o.hw / 2); o.area([v2(x - 0.4, -o.hh + 1), v2(x + 0.5, -o.hh + 1), v2(x + 1.2, o.hh - 1), v2(x + 0.6, o.hh - 1)], 'crevice'); }
  }
  if (t.has('sloped')) o.stairs(-o.hw + 1, -o.hh + 1, o.hw - 1, o.hh - 1, r.range(0, Math.PI * 2), 0, true);
  if (t.has('splitlevel')) {
    const y = r.range(-o.hh / 3, o.hh / 3);
    o.areaRect(-o.hw, y, o.hw, o.hh, 'stage');
    o.stairs(-1.5, y - 0.1, 1.5, y + 1.8, Math.PI / 2, 3);
  }
  const notes: string[] = [];
  if (t.has('tall')) notes.push('tall');
  if (t.has('low')) notes.push('low ceiling');
  if (t.has('noceiling')) notes.push('no ceiling');
  if (t.has('ceilingdrop')) { notes.push('ceiling drops'); o.stairs(-o.hw + 0.5, -o.hh + 0.5, o.hw - 0.5, o.hh - 0.5, 0, 0, true); }
  if (t.has('melted')) notes.push('melted');
  if (t.has('repeat')) notes.push('same as before?');
  if (t.has('shortwalls')) notes.push('walls stop short');
  if (notes.length) o.label(0, o.hh - 0.8, notes.join(' · '), 0.9);
}
