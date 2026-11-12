/**
 * Low-poly 3D of a planned room, from the same prims the 2D map draws. Used by the shift-click room view now, by
 * the isometric view of the whole map later, and by the engine when planned maps become levels.
 *
 * Units are tiles (1 tile = 2 ft), Z up; the plan's (x, y) becomes (x, -y) so that, seen from above with north
 * up, the 3D matches the 2D map. Everything is flat-shaded triangles with per-vertex colours: one mesh for lit
 * parts, one for glowing parts (lights).
 *
 * Walls follow the "only where needed" rule: no outer walls, except short pieces on both sides of every doorway
 * (with the lintel over it), and wall pieces behind things that hang on a wall (windows, shop fronts, vents,
 * exit signs, doors). Walls inside the room (partitions, cubicles, cells) are part of what the room is and stay.
 */
import * as THREE from 'three';
import { THEME } from './catalogue';
import { shade } from './draw';
import { toLocal, toWorld, v2, type V2 } from './geom';
import type { MapOut, MarkKind, Prim, Zone } from './types';

/** Heights in tiles. */
export const H3D = { ceil: 4, tall: 7, low: 2.75, noCeil: 6, door: 3.4, level: 1, wall: 0.3, doorSide: 1.5 };

/** Floor height and wall top of a zone. */
export function zoneHeights(z: Zone): { floor: number; top: number } {
  const floor = z.level * H3D.level;
  const t = new Set(z.tags);
  const h = t.has('tall') ? H3D.tall : t.has('low') ? H3D.low : t.has('noceiling') ? H3D.noCeil : H3D.ceil;
  return { floor, top: floor + h };
}

type RGB = [number, number, number];
const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Collects flat-shaded triangles. Plan points go in as (x, y) and come out as (x, -y). */
export class Mesher {
  private lit = { pos: [] as number[], nor: [] as number[], col: [] as number[] };
  private glow = { pos: [] as number[], nor: [] as number[], col: [] as number[] };

  private tri(into: { pos: number[]; nor: number[]; col: number[] }, a: number[], b: number[], c: number[], col: RGB): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) { into.pos.push(p[0], p[1], p[2]); into.nor.push(nx, ny, nz); into.col.push(col[0], col[1], col[2]); }
  }

  /** A flat polygon at height z (plan coordinates), facing up. */
  top(pts: V2[], z: number, hex: string, glow = false): void {
    if (pts.length < 3) return;
    const contour = pts.map((p) => new THREE.Vector2(p.x, -p.y));
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const col = rgb(hex);
    const into = glow ? this.glow : this.lit;
    for (const [i, j, k] of tris) this.tri(into, [contour[i].x, contour[i].y, z], [contour[j].x, contour[j].y, z], [contour[k].x, contour[k].y, z], col);
  }

  /** A polygon pushed up from z0 to z1: top and sides (no bottom). */
  prism(pts: V2[], z0: number, z1: number, hex: string, glow = false): void {
    if (pts.length < 3 || z1 - z0 < 1e-4) return;
    this.top(pts, z1, hex, glow);
    const col = rgb(shade(hex, 0.9));
    const into = glow ? this.glow : this.lit;
    const w = pts.map((p) => [p.x, -p.y]);
    // outward sides: with the contour counter-clockwise (seen from above), a, b, b-up is outward
    let area = 0;
    for (let i = 0; i < w.length; i++) { const p = w[i], q = w[(i + 1) % w.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) w.reverse();
    for (let i = 0; i < w.length; i++) {
      const p = w[i], q = w[(i + 1) % w.length];
      this.tri(into, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], col);
      this.tri(into, [p[0], p[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], col);
    }
  }

  /** A box w (along angle a) by d, centred at c (plan), from z0 to z1. */
  box(c: V2, w: number, d: number, a: number, z0: number, z1: number, hex: string, glow = false): void {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (x: number, y: number) => v2(c.x + x * ca - y * sa, c.y + x * sa + y * ca);
    this.prism([P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)], z0, z1, hex, glow);
  }

  /** A wall piece along a-b (plan), `t` thick, from z0 to z1. */
  wall(a: V2, b: V2, t: number, z0: number, z1: number, hex: string): void {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 0.05) return;
    this.box(v2((a.x + b.x) / 2, (a.y + b.y) / 2), L, t, Math.atan2(b.y - a.y, b.x - a.x), z0, z1, hex);
  }

  /** An upright octagon (posts, tanks, trees). */
  octa(c: V2, r: number, z0: number, z1: number, hex: string, glow = false): void {
    const pts: V2[] = [];
    for (let k = 0; k < 8; k++) { const a = ((k + 0.5) / 8) * Math.PI * 2; pts.push(v2(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r)); }
    this.prism(pts, z0, z1, hex, glow);
  }

  group(): THREE.Group {
    const g = new THREE.Group();
    const mk = (d: { pos: number[]; nor: number[]; col: number[] }, mat: THREE.Material) => {
      if (!d.pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(d.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
      geo.computeBoundingSphere();
      g.add(new THREE.Mesh(geo, mat));
    };
    mk(this.lit, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mk(this.glow, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    return g;
  }

  get triangles(): number { return (this.lit.pos.length + this.glow.pos.length) / 9; }
}

const AREA_COL: Record<string, string> = {
  water: '#6eaaf0', pool: '#5aa0e6', pit: '#1f1f1f', crevice: '#161616', lawn: '#8fb070', path: '#dcd2b4', road: '#5d5d5d',
  walk: '#bdb5a7', grate: '#3a3a3a', tile: '#d5dde0', stage: '#9a7a52', dark: '#6b6155', field: '#a9bf6a',
};
const WALL_MARKS = new Set<MarkKind>(['window', 'fakewindow', 'shopfront', 'vent', 'exit', 'door', 'stuckdoor']);
const WOOD = '#8a6a4a', WOOD_DARK = '#5c4430';

/** Which side of the zone's box (0 +x, 1 +y, 2 -x, 3 -y) a local point is nearest, and how far. */
function nearestSide(q: V2, z: Zone): { s: number; d: number; t: number } {
  const ds = [z.w / 2 - q.x, z.h / 2 - q.y, z.w / 2 + q.x, z.h / 2 + q.y];
  let s = 0;
  for (let k = 1; k < 4; k++) if (ds[k] < ds[s]) s = k;
  return { s, d: ds[s], t: s % 2 === 0 ? q.y : q.x };
}
/** A local point on side s at position t along it, `inset` inside the wall line. */
function sideAt(z: Zone, s: number, t: number, inset = 0): V2 {
  switch (s) {
    case 0: return v2(z.w / 2 - inset, t);
    case 1: return v2(t, z.h / 2 - inset);
    case 2: return v2(-z.w / 2 + inset, t);
    default: return v2(t, -z.h / 2 + inset);
  }
}
const sideHalf = (z: Zone, s: number) => (s % 2 === 0 ? z.h / 2 : z.w / 2);

/** Is a prim (mostly) inside the zone's box? Corridors carry their first room's id but lie outside it. */
function insideZone(p: Prim, z: Zone, m = 0.6): boolean {
  const pts = p.t === 'wall' ? [p.a, p.b] : p.t === 'light' || p.t === 'mark' || p.t === 'label' ? [p.p] : p.t === 'duct' ? [] : p.pts;
  if (!pts.length) return false;
  let cx = 0, cy = 0;
  for (const q of pts) { cx += q.x; cy += q.y; }
  const l = toLocal(z.frame, v2(cx / pts.length, cy / pts.length));
  return Math.abs(l.x) <= z.w / 2 + m && Math.abs(l.y) <= z.h / 2 + m;
}

/** Is a wall piece along the zone's own outline (a wall between touching rooms)? */
function onOutline(p: Extract<Prim, { t: 'wall' }>, z: Zone): boolean {
  const a = toLocal(z.frame, p.a), b = toLocal(z.frame, p.b);
  const sa = nearestSide(a, z), sb = nearestSide(b, z);
  return sa.d < 0.4 && sb.d < 0.4 && sa.s === sb.s;
}

export interface Room3D { group: THREE.Group; center: THREE.Vector3; radius: number; triangles: number }

/** The room `zi` of map `m`, with short stubs of the corridors and doorways that lead out. */
export function buildRoom3D(m: MapOut, zi: number): Room3D {
  const z = m.zones[zi];
  const th = THEME[z.theme] ?? THEME.base;
  const { floor, top } = zoneHeights(z);
  const M = new Mesher();
  const wallCol = shade(th.floor, 1.08);
  const W = (local: V2) => toWorld(z.frame, local);
  const prims = m.prims.filter((p) => 'zone' in p && p.zone === zi && !(p.t === 'floor' && p.corr) && insideZone(p, z));

  // floors and floor overlays
  for (const p of prims) if (p.t === 'floor') M.top(p.pts, floor, th.floor);
  for (const p of prims) {
    if (p.t !== 'area') continue;
    if (p.kind === 'stage') M.prism(p.pts, floor, floor + 0.4, AREA_COL.stage);
    else M.top(p.pts, floor + (p.kind === 'pit' || p.kind === 'crevice' ? 0.015 : 0.01), AREA_COL[p.kind] ?? '#888888');
  }

  // doorways: a short wall on each side and the lintel over the opening
  for (const pt of z.ports) {
    const s = ((Math.round(pt.a / (Math.PI / 2)) % 4) + 4) % 4;
    const t = s % 2 === 0 ? pt.p.y : pt.p.x;
    const half = sideHalf(z, s), hw = pt.w / 2;
    const piece = (u0: number, u1: number, z0: number, z1: number) => {
      const a = Math.max(-half, u0), b = Math.min(half, u1);
      if (b - a > 0.05) M.wall(W(sideAt(z, s, a, H3D.wall / 2)), W(sideAt(z, s, b, H3D.wall / 2)), H3D.wall, z0, z1, wallCol);
    };
    piece(t - hw - H3D.doorSide, t - hw, floor, top);
    piece(t + hw, t + hw + H3D.doorSide, floor, top);
    piece(t - hw, t + hw, floor + H3D.door, top);
    // the stub: a little of what lies beyond the doorway
    const link = m.links[pt.link];
    const other = link ? m.zones[link.a === zi ? link.b : link.a] : undefined;
    const oth = THEME[(link?.kind === 'open' ? other?.theme : m.zones[link?.a ?? zi]?.theme) ?? z.theme] ?? th;
    const out = (u: number, d: number) => W(add2(sideAt(z, s, u, 0), outward(s, d)));
    if (link?.kind !== 'portal') M.top([out(t - hw, 0), out(t + hw, 0), out(t + hw, 3), out(t - hw, 3)], floor - 0.005, shade(oth.floor, 0.92));
  }

  // things on the walls, each with the wall piece behind it
  for (const p of prims) {
    if (p.t !== 'mark' || !WALL_MARKS.has(p.kind)) continue;
    const q = toLocal(z.frame, p.p);
    const { s, d, t } = nearestSide(q, z);
    if (d > 1.4) continue;
    const half = sideHalf(z, s);
    const L = Math.max(2, p.s + 1);
    const a = Math.max(-half, t - L / 2), b = Math.min(half, t + L / 2);
    M.wall(W(sideAt(z, s, a, H3D.wall / 2)), W(sideAt(z, s, b, H3D.wall / 2)), H3D.wall, floor, top, wallCol);
    const panel = (w: number, z0: number, z1: number, hex: string, glow = false) => {
      const c = W(sideAt(z, s, t, H3D.wall + 0.04));
      M.box(c, Math.min(w, b - a), 0.06, z.frame.a + (s % 2 === 0 ? Math.PI / 2 : 0), floor + z0, floor + z1, hex, glow);
    };
    if (p.kind === 'window') panel(p.s, 1.2, 3.0, '#cfe6f7', true);
    else if (p.kind === 'fakewindow') panel(p.s, 1.2, 3.0, '#9fb4c2');
    else if (p.kind === 'shopfront') { panel(p.s, 0, 3.2, '#b0473b'); panel(p.s * 0.9, 0.3, 2.9, '#d9ecf5', true); }
    else if (p.kind === 'vent') panel(0.8, 3.0, 3.6, '#3d3d3d');
    else if (p.kind === 'exit') panel(1.0, H3D.door + 0.1, H3D.door + 0.5, '#2f9e44', true);
    else if (p.kind === 'door' || p.kind === 'stuckdoor') panel(Math.min(p.s, 2), 0, H3D.door - 0.1, p.kind === 'stuckdoor' ? WOOD_DARK : WOOD);
  }
  // window walls and closed doors drawn as wall prims
  for (const p of prims) {
    if (p.t !== 'wall') continue;
    if (p.kind === 'fake') continue;
    if (p.kind === 'glass') {
      M.wall(p.a, p.b, Math.max(0.25, p.w), floor, floor + 1.2, wallCol);
      M.wall(p.a, p.b, 0.08, floor + 1.2, floor + 3.0, '#cfe6f7');
      M.wall(p.a, p.b, Math.max(0.25, p.w), floor + 3.0, top, wallCol);
      continue;
    }
    if (onOutline(p, z) && !p.closed) continue;   // outer walls only near doors (above)
    if (p.kind === 'bars') {
      const L = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y), n = Math.max(2, Math.round(L / 0.45));
      for (let k = 0; k <= n; k++) M.box(v2(p.a.x + ((p.b.x - p.a.x) * k) / n, p.a.y + ((p.b.y - p.a.y) * k) / n), 0.1, 0.1, 0, floor, floor + H3D.door, '#2e2e2e');
      M.wall(p.a, p.b, 0.12, floor + H3D.door, floor + H3D.door + 0.15, '#2e2e2e');
      continue;
    }
    const thick = Math.max(0.15, p.w);
    if (p.kind === 'short') M.wall(p.a, p.b, thick, floor, floor + 2.2, wallCol);
    else if (p.kind === 'over') M.wall(p.a, p.b, thick, floor + H3D.door - 0.2, top, wallCol);
    else M.wall(p.a, p.b, thick, floor, top, p.closed ? WOOD_DARK : wallCol);
  }

  // pillars, blocks, masses, built-in furniture
  for (const p of prims) {
    if (p.t !== 'solid') continue;
    if (p.kind === 'mass') M.prism(p.pts, floor, top, '#4b4b4b');
    else if (p.kind === 'pillar') M.prism(p.pts, floor, top, shade(th.line, 1.15));
    else if (p.kind === 'furniture') M.prism(p.pts, floor, floor + 1.6, '#7a5f44');
    else M.prism(p.pts, floor, top, shade(th.line, 1.05));
  }

  // steps and ramps (rising against `dir`, one floor step high)
  for (const p of prims) {
    if (p.t !== 'stairs') continue;
    const [c0, c1, c2, c3] = p.pts;
    const d = v2(Math.cos(p.dir), Math.sin(p.dir));
    const along01 = Math.abs((c1.x - c0.x) * d.x + (c1.y - c0.y) * d.y) > Math.hypot(c1.x - c0.x, c1.y - c0.y) * 0.7;
    // a, b: the low end's corners; e, f: the high end's corners (low end is downhill: furthest along d)
    const ends = along01 ? [[c0, c3], [c1, c2]] : [[c0, c1], [c3, c2]];
    const dot0 = (ends[0][0].x + ends[0][1].x) * d.x + (ends[0][0].y + ends[0][1].y) * d.y;
    const dot1 = (ends[1][0].x + ends[1][1].x) * d.x + (ends[1][0].y + ends[1][1].y) * d.y;
    const [hi, lo] = dot0 < dot1 ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const rise = H3D.level;
    const n = p.ramp || p.steps <= 0 ? 1 : Math.min(12, p.steps);
    for (let k = 0; k < n; k++) {
      const u0 = k / n, u1 = (k + 1) / n;
      const L = (pt: V2, q: V2, u: number) => v2(pt.x + (q.x - pt.x) * u, pt.y + (q.y - pt.y) * u);
      const quad = [L(lo[0], hi[0], u0), L(lo[1], hi[1], u0), L(lo[1], hi[1], u1), L(lo[0], hi[0], u1)];
      M.prism(quad, floor - 0.01, floor + rise * u1 * 0.5, p.impossible ? '#b07070' : shade(th.floor, 0.85));
    }
  }

  // ceiling lights, hung at the top of the walls
  for (const p of prims) {
    if (p.t !== 'light') continue;
    const col = p.kind === 'off' ? '#7b7b7b' : p.kind === 'emergency' ? '#ff8a3c' : p.kind === 'flicker' ? '#fff2a0' : '#fffdf2';
    M.box(p.p, 0.7, 0.7, z.frame.a, top - 0.12, top, col, p.kind !== 'off');
  }

  // furniture and other things on the floor
  for (const p of prims) if (p.t === 'mark' && !WALL_MARKS.has(p.kind)) markMesh(M, p, floor, top);

  // centre and size for the camera
  const c = W(v2(0, 0));
  return { group: M.group(), center: new THREE.Vector3(c.x, -c.y, floor + (top - floor) * 0.35), radius: Math.hypot(z.w, z.h) / 2 + 3.5, triangles: M.triangles };
}

const add2 = (a: V2, b: V2): V2 => v2(a.x + b.x, a.y + b.y);
const outward = (s: number, d: number): V2 => (s === 0 ? v2(d, 0) : s === 1 ? v2(0, d) : s === 2 ? v2(-d, 0) : v2(0, -d));

function markMesh(M: Mesher, p: Extract<Prim, { t: 'mark' }>, f: number, top: number): void {
  const s = p.s, a = p.a, c = p.p;
  const at = (x: number, y: number) => v2(c.x + x * Math.cos(a) - y * Math.sin(a), c.y + x * Math.sin(a) + y * Math.cos(a));
  switch (p.kind) {
    case 'seat': M.box(c, s, s, a, f, f + 0.9, WOOD); M.box(at(0, -s * 0.42), s, 0.15, a, f + 0.9, f + 1.8, WOOD); break;
    case 'pew': M.box(c, s, 0.45, a, f, f + 0.9, WOOD); break;
    case 'sofa': M.box(c, s, s * 0.45, a, f, f + 0.8, '#7f5b3e'); M.box(at(0, -s * 0.2), s, s * 0.12, a, f + 0.8, f + 1.4, '#6a4a32'); break;
    case 'table': case 'counter': M.box(c, s, s * 0.6, a, f, f + 1.25, '#9b7650'); break;
    case 'desk': M.box(c, s, s * 0.5, a, f, f + 1.25, '#9b7650'); M.box(at(0, s * 0.1), s * 0.3, s * 0.2, a, f + 1.25, f + 1.75, '#5b5b5b'); break;
    case 'bed': M.box(c, s * 0.7, s, a, f, f + 0.8, '#d8d0c0'); M.box(at(0, -s * 0.36), s * 0.6, s * 0.2, a, f + 0.8, f + 1.0, '#f4efe6'); break;
    case 'shelf': case 'cupboard': M.box(c, s, Math.max(0.45, 0.45), a, f, Math.min(top, f + 3), '#6e5236'); break;
    case 'car': M.box(c, s * 0.5, s, a, f + 0.3, f + 1.4, '#56708c'); M.box(c, s * 0.45, s * 0.5, a, f + 1.4, f + 2.2, '#3f5368'); break;
    case 'boiler': M.octa(c, s / 2, f, Math.min(top, f + 3), '#8f8f8f'); break;
    case 'tank': M.box(c, s, s * 0.6, a, f, Math.min(top, f + 2.5), '#8a9494'); break;
    case 'pipe': M.box(c, s, 0.35, a, f + 2.8, f + 3.15, '#7a7a7a'); break;
    case 'fan': M.octa(c, s / 2, top - 0.25, top - 0.15, '#555555'); break;
    case 'lift': M.box(c, s, s, a, f, top, '#9a9a9a'); break;
    case 'sign': M.box(c, 0.12, 0.12, 0, f, f + 2.2, '#5a5040'); M.box(c, Math.max(1, s * 0.6), 0.08, a, f + 2.2, f + 2.9, '#e9e4d6'); break;
    case 'note': M.box(c, 0.6, 0.45, a, f, f + 0.03, '#f1e27a'); break;
    case 'tree': M.box(c, 0.25, 0.25, 0, f, f + 1.4, '#6b4f35'); M.octa(c, s / 2, f + 1.4, Math.min(top - 0.2, f + 3.6), '#5f8f4a'); break;
    case 'plant': M.octa(c, Math.max(0.3, s / 3), f, f + 0.9, '#5f8f4a'); break;
    case 'bench': M.box(c, s, 0.35, a, f, f + 0.6, WOOD); break;
    case 'fountain': M.octa(c, s / 2, f, f + 0.6, '#b8c4cc'); M.octa(c, s / 2 - 0.2, f + 0.6, f + 0.62, '#8cc0ea', true); break;
    case 'portal': M.box(c, 0.2, 1.6, a, f, f + H3D.door, '#b67cf0', true); break;
    case 'crate': M.box(c, s * 0.7, s * 0.7, a, f, f + s * 0.7, '#a07f55'); break;
    case 'pooltable': M.box(c, s, s * 0.55, a, f, f + 1.2, '#3f7f4f'); break;
    case 'stage': M.box(c, s, s, a, f, f + 0.5, '#9a7a52'); break;
    case 'mannequin': M.octa(c, 0.25, f, f + 2.8, '#d9c9b0'); break;
    case 'wires': M.box(c, s, 0.06, a, f, f + 0.04, '#333333'); break;
    case 'arrow': M.box(c, s, 0.15, a, f, f + 0.02, '#222222'); break;
    case 'hatch': case 'window': case 'fakewindow': case 'shopfront': case 'vent': case 'exit': case 'door': case 'stuckdoor': break;
    default: M.box(c, Math.max(0.5, s * 0.6), Math.max(0.5, s * 0.6), a, f, f + 1, '#8a8a8a');
  }
}
