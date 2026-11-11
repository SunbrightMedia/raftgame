/**
 * Building parts for the house style (STYLE.md, reference 6: "Infinite house"): walls with openings,
 * rounded corners, profiled trim (casings, baseboards, crown), doors set into their openings with deep
 * recessed panels, lamps, and furniture at true size (inches; z up).
 *
 * Nothing has a hard edge: outside corners are rounded (drywall corner bead), trim has a profile, panels
 * have bevels. All of it is convex prisms (the map's brushes), so it also collides and bakes as usual.
 *
 * Things on a wall are placed in the wall's own terms: `axis` is the direction the wall runs ('x': a
 * wall at y = face; 'y': a wall at x = face), `dir` (+1/-1) points from the wall into the room, `u`
 * runs along the wall, `v` out of its face into the room (negative v is inside the wall).
 */
import type { V3 } from '../../src/data/map';
import { MapBuilder, circle, type Opts } from '../lib/build';

/** An opening in a wall from u = a to b, up to `top`; from `bottom` up when set (a window). */
export interface Gap { a: number; b: number; top: number; bottom?: number }
export type Axis = 'x' | 'y';
export type Dir = 1 | -1;
type P2 = [number, number];

export interface HouseTex {
  paint: string; carpet: string; ceiling: string; trim: string; brass: string; dome: string; chrome: string;
  brick: string; soot: string; woodDark: string; fabric: string; counter: string; glassDark: string; woodPlaque: string;
  /** A wall sconce's shade (dimmer than a ceiling dome's lens). */
  sconce?: string;
  /** A door's slab, stiles, rails and panels (default: the trim): its own texture can ask for fine lightmap luxels
   * (textures/surfaces.json "luxel"), so the panel steps' thin shadows are baked. */
  door?: string;
}

/** A rounded rectangle (plan, counter-clockwise), radius r on the corners chosen in the order sw, se, ne, nw. */
export function rrect(x0: number, y0: number, x1: number, y1: number, r: number, c: [boolean, boolean, boolean, boolean] = [true, true, true, true], seg = 6): P2[] {
  const out: P2[] = [];
  const at: [number, number, number][] = [[x0 + r, y0 + r, 180], [x1 - r, y0 + r, 270], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90]];
  const sharp: P2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (let k = 0; k < 4; k++) {
    if (!c[k] || r <= 0) { out.push(sharp[k]); continue; }
    const [cx, cy, a0] = at[k];
    for (let i = 0; i <= seg; i++) { const a = ((a0 + (90 * i) / seg) * Math.PI) / 180; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  }
  return out;
}

/** A rounded rectangle in local (u forward, v left) turned by `yaw` degrees about (x, y). */
function rotated(x: number, y: number, yaw: number, u0: number, v0: number, u1: number, v1: number, r: number): P2[] {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return rrect(u0, v0, u1, v1, Math.max(0, Math.min(r, (u1 - u0) / 2 - 0.01, (v1 - v0) / 2 - 0.01))).map(([u, v]) => [x + u * c - v * s, y + u * s + v * c] as P2);
}

export class HouseKit {
  /** The domes' glow up and sideways, as a fraction of their peak (lighting.ts "dome" `up`); undefined = its default. */
  domeUp: number | undefined = undefined;
  constructor(readonly m: MapBuilder, readonly H: number, readonly t: HouseTex) {}

  // ---- placement in a wall's terms
  /** A box in a wall's terms: u along the wall, v out of its face, z up. */
  wbox(axis: Axis, face: number, dir: Dir, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, tex: string, o: Opts = {}): void {
    const a = face + dir * v0, b = face + dir * v1, lo = Math.min(a, b), hi = Math.max(a, b);
    if (axis === 'x') this.m.box([Math.min(u0, u1), lo, z0], [Math.max(u0, u1), hi, z1], tex, o);
    else this.m.box([lo, Math.min(u0, u1), z0], [hi, Math.max(u0, u1), z1], tex, o);
  }
  /** World point from a wall's terms. */
  wpt(axis: Axis, face: number, dir: Dir, u: number, v: number, z: number): V3 {
    return axis === 'x' ? [u, face + dir * v, z] : [face + dir * v, u, z];
  }
  private wxy(axis: Axis, face: number, dir: Dir, u: number, v: number): P2 {
    return axis === 'x' ? [u, face + dir * v] : [face + dir * v, u];
  }
  /** A prism running along the wall from u0 to u1, its cross-section given in (v, z). */
  along(axis: Axis, face: number, dir: Dir, u0: number, u1: number, profile: [number, number][], tex: string, o: Opts = {}): void {
    const p = profile.map(([v, z]) => [face + dir * v, z] as P2);
    if (axis === 'x') this.m.prismX(p, Math.min(u0, u1), Math.max(u0, u1), tex, o);
    else this.m.prismY(p, Math.min(u0, u1), Math.max(u0, u1), tex, o);
  }
  /** An upright prism (z0..z1) whose outline is given in the wall's (u, v). */
  upright(axis: Axis, face: number, dir: Dir, outline: [number, number][], z0: number, z1: number, tex: string, o: Opts = {}): void {
    this.m.prism(outline.map(([u, v]) => this.wxy(axis, face, dir, u, v)), z0, z1, tex, o);
  }

  // ---- walls, floors, ceilings
  /** A wall along x (between y0 and y1) from x = a to x = b, with openings. */
  wallX(y0: number, y1: number, a: number, b: number, gaps: Gap[] = [], tex = this.t.paint): void {
    let cur = a;
    for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
      if (g.a > cur) this.m.box([cur, y0, 0], [g.a, y1, this.H], tex);
      this.m.box([g.a, y0, g.top], [g.b, y1, this.H], tex);
      if (g.bottom) this.m.box([g.a, y0, 0], [g.b, y1, g.bottom], tex);
      cur = g.b;
    }
    if (b > cur) this.m.box([cur, y0, 0], [b, y1, this.H], tex);
  }
  /** A wall along y (between x0 and x1) from y = a to y = b, with openings. */
  wallY(x0: number, x1: number, a: number, b: number, gaps: Gap[] = [], tex = this.t.paint): void {
    let cur = a;
    for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
      if (g.a > cur) this.m.box([x0, cur, 0], [x1, g.a, this.H], tex);
      this.m.box([x0, g.a, g.top], [x1, g.b, this.H], tex);
      if (g.bottom) this.m.box([x0, g.a, 0], [x1, g.b, g.bottom], tex);
      cur = g.b;
    }
    if (b > cur) this.m.box([x0, cur, 0], [x1, b, this.H], tex);
  }
  /** A block of wall, floor to ceiling, whose chosen corners (sw, se, ne, nw) are rounded like drywall corner bead. */
  rblock(x0: number, y0: number, x1: number, y1: number, corners: [boolean, boolean, boolean, boolean], r = 1, tex = this.t.paint, z0 = 0, z1 = this.H): void {
    this.m.prism(rrect(x0, y0, x1, y1, r, corners), z0, z1, tex);
  }
  /** Floor and ceiling slabs. */
  slabs(x0: number, y0: number, x1: number, y1: number): void {
    this.m.box([x0, y0, -6], [x1, y1, 0], this.t.carpet);
    this.m.box([x0, y0, this.H], [x1, y1, this.H + 6], this.t.ceiling);
  }

  // ---- trim (white, semi-gloss, profiled)
  /** The opening a door needs (its jamb lining included). */
  doorGap(centre: number, w = 32, h = 80): Gap {
    return { a: centre - w / 2 - 0.75, b: centre + w / 2 + 0.75, top: h + 0.75 };
  }
  /** Casing round an opening u = a..b up to `top` (and from `bottom`, for a window): 3¼" with a rounded outer edge. */
  casing(axis: Axis, face: number, dir: Dir, a: number, b: number, top: number, bottom = 0): void {
    const T = this.t.trim, W = 3.25;
    // the profile across the casing: (distance out from the opening's edge, height off the wall)
    const prof: [number, number][] = [[0, 0], [0, 0.7], [0.2, 0.75], [2.6, 0.62], [3.0, 0.45], [3.2, 0.2], [W, 0]];
    const zs = bottom > 0 ? bottom - W : 0, ze = top + W;
    this.upright(axis, face, dir, prof.map(([d, v]) => [a - d, v]), zs, ze, T);
    this.upright(axis, face, dir, prof.map(([d, v]) => [b + d, v]), zs, ze, T);
    this.along(axis, face, dir, a - W, b + W, prof.map(([d, v]) => [v, top + d]), T);
    if (bottom > 0) this.along(axis, face, dir, a - W, b + W, prof.map(([d, v]) => [v, bottom - d]), T);
  }
  /** A baseboard run along a wall face: 4¼" with a rounded top. */
  baseRun(axis: Axis, face: number, dir: Dir, a: number, b: number): void {
    if (b - a < 0.5) return;
    this.along(axis, face, dir, a, b, [[0, 0], [0.6, 0], [0.6, 3.5], [0.55, 3.8], [0.42, 4.02], [0.22, 4.17], [0, 4.25]], this.t.trim);
  }
  /** Baseboards round a room's walls, leaving out the given spans (door casings, openings). */
  baseboards(x0: number, y0: number, x1: number, y1: number, skip: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number }[] = []): void {
    const run = (side: 'n' | 's' | 'e' | 'w', a: number, b: number) => {
      const seg = (s: number, e: number) => {
        if (side === 's') this.baseRun('x', y0, 1, s, e);
        if (side === 'n') this.baseRun('x', y1, -1, s, e);
        if (side === 'w') this.baseRun('y', x0, 1, s, e);
        if (side === 'e') this.baseRun('y', x1, -1, s, e);
      };
      let cur = a;
      for (const g of skip.filter((q) => q.side === side).sort((p, q) => p.a - q.a)) { seg(cur, Math.max(cur, g.a)); cur = Math.max(cur, g.b); }
      seg(cur, b);
    };
    run('s', x0, x1); run('n', x0, x1); run('w', y0, y1); run('e', y0, y1);
  }
  /** Crown moulding along one wall face: a 2¾" × 3¾" cove under the ceiling with a bead below it. */
  crownRun(axis: Axis, face: number, dir: Dir, a: number, b: number): void {
    const H = this.H, T = this.t.trim, cv = 2.75, ch = 3.75, n = 5;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const th = (i / n) * (Math.PI / 2); pts.push([cv * (1 - Math.cos(th)), H - ch + ch * Math.sin(th)]); }
    // the cove is concave: a fan of convex wedges from the wall-ceiling corner
    for (let i = 0; i < n; i++) this.along(axis, face, dir, a, b, [[0, H], pts[i], pts[i + 1]], T);
    this.along(axis, face, dir, a, b, [[0, H - ch - 0.9], [0.45, H - ch - 0.9], [0.55, H - ch - 0.45], [0.45, H - ch], [0, H - ch]], T);
  }
  /** Crown round a room (each side a run; leave sides out where the room is open). */
  crown(x0: number, y0: number, x1: number, y1: number, sides: ('n' | 's' | 'e' | 'w')[] = ['n', 's', 'e', 'w']): void {
    if (sides.includes('s')) this.crownRun('x', y0, 1, x0, x1);
    if (sides.includes('n')) this.crownRun('x', y1, -1, x0, x1);
    if (sides.includes('w')) this.crownRun('y', x0, 1, y0, y1);
    if (sides.includes('e')) this.crownRun('y', x1, -1, y0, y1);
  }

  // ---- doors
  /**
   * A closed six-panel door set into its opening (the wall needs doorGap(centre, w, h)): jamb lining, a
   * 1⅜" slab whose face sits ⅝" behind the wall's, profiled casing. Each panel sits 0.6" down behind a
   * steep, narrow step (0.3" wide, ~63°), so its top edge is a thin dark line and its bottom a thin light
   * one, as on a moulded door seen from a few yards (the video's doors: lines ~2 px at 9 ft, not a
   * soft 1¼" bevel). Rails and stiles at the usual sizes (top panels 12½", middle 29", bottom 13").
   * `depth` = the wall's thickness.
   */
  door(axis: Axis, face: number, dir: Dir, centre: number, knob: Dir, o: { w?: number; h?: number; depth?: number } = {}): void {
    const w = o.w ?? 32, h = o.h ?? 80, depth = o.depth ?? 5, T = this.t.trim, jt = 0.75;
    const a = centre - w / 2, b = centre + w / 2;
    // jamb lining in the opening
    this.wbox(axis, face, dir, a - jt, a, -depth, 0, 0, h + jt, T);
    this.wbox(axis, face, dir, b, b + jt, -depth, 0, 0, h + jt, T);
    this.wbox(axis, face, dir, a - jt, b + jt, -depth, 0, h, h + jt, T);
    // the slab
    const D = this.t.door ?? T, vf = -0.625, vr = vf - 0.6, vb = vf - 1.375, sw = 4.5, mid = w / 2;
    this.wbox(axis, face, dir, a + 0.1, b - 0.1, vb, vr, 0.5, h - 0.1, D);
    for (const [u0, u1] of [[0.1, sw], [mid - 2.25, mid + 2.25], [w - sw, w - 0.1]]) this.wbox(axis, face, dir, a + u0, a + u1, vr, vf, 0.5, h - 0.1, D);
    for (const [r0, r1] of [[0.1, 4.5], [17, 21.5], [50.5, 58.5], [71.5, 79.5]]) this.wbox(axis, face, dir, a + sw, b - sw, vr, vf, h - r1, h - r0, D);
    for (const [z0, z1] of [[4.5, 17], [21.5, 50.5], [58.5, 71.5]]) {
      for (const [u0, u1] of [[sw, mid - 2.25], [mid + 2.25, w - sw]]) this.panelBevels(axis, face, dir, a + u0, a + u1, h - z1, h - z0, vr, vf, 0.3, D);
    }
    this.casing(axis, face, dir, a - jt, b + jt, h + jt);
    // knob: a rose on the slab and a round knob 2¼" out, 2⅜" in from the edge, 36" up
    this.knob(axis, face, dir, centre + knob * (w / 2 - 2.375), 36, vf);
  }
  /** The four bevels of a recessed panel: wedges from the frame's face (vf) down to the field (vr). */
  private panelBevels(axis: Axis, face: number, dir: Dir, u0: number, u1: number, z0: number, z1: number, vr: number, vf: number, bw: number, T = this.t.trim): void {
    this.along(axis, face, dir, u0, u1, [[vr, z1], [vf, z1], [vr, z1 - bw]], T);
    this.along(axis, face, dir, u0, u1, [[vr, z0], [vr, z0 + bw], [vf, z0]], T);
    this.upright(axis, face, dir, [[u0, vr], [u0, vf], [u0 + bw, vr]], z0, z1, T);
    this.upright(axis, face, dir, [[u1, vr], [u1 - bw, vr], [u1, vf]], z0, z1, T);
  }
  /** A brass knob on a rose, sticking out of a face at v0. */
  private knob(axis: Axis, face: number, dir: Dir, u: number, z: number, v0: number): void {
    const B = this.t.brass;
    const out = (vA: number, vB: number, r: number) => {
      const p = face + dir * vA, q = face + dir * vB, lo = Math.min(p, q), hi = Math.max(p, q);
      if (axis === 'x') this.m.prismY(circle(u, z, r, 24), lo, hi, B, { solid: false });
      else this.m.prismX(circle(u, z, r, 24), lo, hi, B, { solid: false });
    };
    out(v0, v0 + 0.35, 1.25);       // rose
    out(v0 + 0.35, v0 + 1.4, 0.45); // neck
    out(v0 + 1.4, v0 + 2.3, 1.1);   // knob
  }

  // ---- lamps
  /** A flush ceiling light: a frosted lens `d` across (default 15") in a thin ring, and its light (two 60 W bulbs' worth). */
  dome(x: number, y: number, lumens = 1600, kelvin = 2700, o: { n?: number; d?: number; up?: number } = {}): void {
    const r = (o.d ?? 15) / 2;
    this.m.prism(circle(x, y, r + 0.75, 40), this.H - 1, this.H, this.t.trim, { solid: false });
    // the lens: bright in the middle, dimmer to the rim (a frosted dome), so it blooms into a soft blob
    this.m.prism(circle(x, y, r, 40), this.H - 2.2, this.H - 1, 'fixture/dome_rim', { solid: false });
    this.m.prism(circle(x, y, r * 0.72, 40), this.H - 2.8, this.H - 2.2, 'fixture/dome_mid', { solid: false });
    this.m.prism(circle(x, y, r * 0.45, 32), this.H - 3.1, this.H - 2.8, 'fixture/dome_core', { solid: false });
    const up = o.up ?? this.domeUp;
    this.m.light([x, y, this.H - 3.5], { type: 'dome', lumens, kelvin, ...(o.n !== undefined ? { n: o.n } : {}), ...(up !== undefined ? { up } : {}) });
  }
  /** A wall sconce: a frosted shade on a small back plate, with a bulb's light in it. */
  sconce(axis: Axis, face: number, dir: Dir, u: number, z: number, lumens = 450, kelvin = 2700): void {
    this.wbox(axis, face, dir, u - 2.5, u + 2.5, 0, 0.6, z - 3.5, z + 3.5, this.t.brass, { solid: false });
    this.upright(axis, face, dir, rrect(u - 3, 0.6, u + 3, 5.5, 1.5), z - 3, z + 4, this.t.sconce ?? this.t.dome, { solid: false });
    this.m.light(this.wpt(axis, face, dir, u, 4, z), { type: 'bulb', lumens, kelvin });
  }

  // ---- furniture (true size)
  /** A moulded plastic chair: a white seat and back shell on a dark metal frame (`yaw` 0 = it faces +x). */
  chair(x: number, y: number, yaw: number): void {
    const m = this.m, T = this.t.trim, F = this.t.woodDark;
    m.prism(rotated(x, y, yaw, -8, -9, 8.5, 9, 2.5), 17, 18.2, T);                     // seat shell
    m.prism(rotated(x, y, yaw, 8, -9, 9.6, 9, 0.7), 16.2, 18.8, T);                      // its rolled front edge
    m.prism(rotated(x, y, yaw, -10, -8.6, -8.6, 8.6, 0.6), 22, 35.5, T);                 // back shell, tall
    m.prism(rotated(x, y, yaw, -9.6, -2.5, -8.8, 2.5, 0.4), 16.5, 22.5, F);              // the back's post
    for (const [u, v] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) m.prism(rotated(x, y, yaw, u - 0.45, v - 0.45, u + 0.45, v + 0.45, 0.4), 0, 16.8, F);
    for (const v of [-7, 7]) m.prism(rotated(x, y, yaw, -7.4, v - 0.4, 7.4, v + 0.4, 0.3), 2, 2.8, F);   // rungs
  }
  /** Base cabinets against a wall from u = a to b: 24" deep, a 4" toe kick, a 1½" counter with a rounded front,
   *  doors with long bar pulls. */
  baseCabinets(axis: Axis, face: number, dir: Dir, a: number, b: number, doors = 2): void {
    const T = this.t.trim;
    this.wbox(axis, face, dir, a, b, 0, 21, 0, 4, this.t.glassDark);
    this.wbox(axis, face, dir, a, b, 0, 23.25, 4, 34.5, T);
    this.along(axis, face, dir, a, b, [[0, 34.5], [24.4, 34.5], [24.85, 34.65], [25, 35.25], [24.85, 35.85], [24.4, 36], [0, 36]], this.t.counter);
    const dw = (b - a) / doors;
    for (let i = 0; i < doors; i++) {
      const s0 = a + i * dw + 0.15, s1 = a + (i + 1) * dw - 0.15;
      this.along(axis, face, dir, s0, s1, [[23.25, 4.5], [23.9, 4.5], [24, 4.7], [24, 33.6], [23.9, 33.8], [23.25, 33.8]], T);
      for (const z of [30.5, 7.5]) this.wbox(axis, face, dir, s0 + 2, s1 - 2, 24, 24.9, z - 0.3, z + 0.3, this.t.chrome, { solid: false });
    }
  }
  /** Upper cabinets from u = a to b, 12" deep, z0..z1, `doors` doors; `openShelf` adds 12" of open shelves before a. */
  upperCabinets(axis: Axis, face: number, dir: Dir, a: number, b: number, z0 = 54, z1 = 84, doors = 1, openShelf = false): void {
    const T = this.t.trim;
    if (openShelf) {
      const s = a - 12;
      this.wbox(axis, face, dir, s, s + 0.75, 0, 12, z0, z1, T);
      for (const z of [z0, (2 * z0 + z1) / 3, (z0 + 2 * z1) / 3, z1 - 0.75]) this.wbox(axis, face, dir, s, a, 0, 11.5, z, z + 0.75, T);
    }
    this.wbox(axis, face, dir, a, b, 0, 11.25, z0, z1, T);
    const dw = (b - a) / doors;
    for (let i = 0; i < doors; i++) {
      const s0 = a + i * dw + 0.15, s1 = a + (i + 1) * dw - 0.15;
      this.along(axis, face, dir, s0, s1, [[11.25, z0 + 0.3], [11.9, z0 + 0.3], [12, z0 + 0.5], [12, z1 - 0.5], [11.9, z1 - 0.3], [11.25, z1 - 0.3]], T);
    }
  }
  /**
   * A brick chimney breast, floor to ceiling, `w` wide and `d` proud, its corners rounded a little; a lower
   * surround round a firebox `ow` × `oh` whose floor is `oz` up, the firebox `fd` deep and sooty.
   */
  fireplace(axis: Axis, face: number, dir: Dir, centre: number, o: { w?: number; d?: number; sh?: number; ow?: number; oh?: number; oz?: number; fd?: number } = {}): void {
    const B = this.t.brick, S = this.t.soot, w = o.w ?? 63, d = o.d ?? 16, sh = o.sh ?? 46, ow = o.ow ?? 41, oh = o.oh ?? 31, oz = o.oz ?? 7, fd = o.fd ?? 13;
    const a = centre - w / 2, b = centre + w / 2, o0 = centre - ow / 2, o1 = centre + ow / 2;
    const block = (u0: number, u1: number, z0: number, z1: number, rl: boolean, rr: boolean, dd = d) =>
      this.upright(axis, face, dir, rrect(u0, 0, u1, dd, 0.75, [false, false, rr, rl]), z0, z1, B);
    block(a, b, sh, this.H, true, true, d - 1);              // the breast above the surround, set back an inch
    block(a, o0, 0, sh, true, false);                        // the surround: sides, lintel, raised hearth
    block(o1, b, 0, sh, false, true);
    block(o0, o1, oz + oh, sh, false, false);
    block(o0, o1, 0, oz, false, false);
    // the firebox, `fd` deep: brick sides and roof (lit inside the opening, as the video's), soot at the back and floor
    this.wbox(axis, face, dir, o0, o1, d - fd - 1, d - fd, oz, oz + oh, S);
    this.wbox(axis, face, dir, o0, o0 + 1.5, d - fd, d, oz, oz + oh, B);
    this.wbox(axis, face, dir, o1 - 1.5, o1, d - fd, d, oz, oz + oh, B);
    this.wbox(axis, face, dir, o0, o1, d - fd, d, oz + oh - 1.5, oz + oh, B);
    this.wbox(axis, face, dir, o0 + 1.5, o1 - 1.5, d - fd, d, oz, oz + 0.4, S);
  }
  /** An empty bookcase of dark wood, open at the front, with rounded front edges: inch-thick boards, as the video's. */
  bookshelf(axis: Axis, face: number, dir: Dir, a: number, b: number, h = 52, d = 12): void {
    const W = this.t.woodDark, t = 1;
    const board = (z: number) => [[0, z], [d - 0.35, z], [d, z + 0.35], [d, z + t - 0.35], [d - 0.35, z + t], [0, z + t]] as [number, number][];
    this.wbox(axis, face, dir, a, b, 0, 0.5, 0, h, W);
    this.wbox(axis, face, dir, a, a + t, 0, d, 0, h, W);
    this.wbox(axis, face, dir, b - t, b, 0, d, 0, h, W);
    for (const z of [0, 3, 16, 29, 42]) this.along(axis, face, dir, a + t, b - t, board(z), W);
    this.along(axis, face, dir, a, b, board(h - t), W);
  }
  /**
   * An upholstered armchair (`yaw` 0 = it faces +x): a skirted base, a seat cushion, rolled arms and a
   * rounded back, each built of rounded slabs stepped in at the top so no edge is sharp.
   */
  armchair(x: number, y: number, yaw: number, scale = 1): void {
    const F = this.t.fabric, m = this.m, k = scale;
    const slab = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number, r: number) => m.prism(rotated(x, y, yaw, u0 * k, v0 * k, u1 * k, v1 * k, r * k), z0 * k, z1 * k, F);
    slab(-15, -16, 15, 16, 1, 15, 2.5);                       // base with its skirt
    slab(-9, -11, 14.5, 11, 15, 19, 2);                       // seat cushion
    slab(-9, -10.5, 15, 10.5, 15.5, 18.5, 2);                 // ... its rolled front
    for (const s of [-1, 1]) {                                // rolled arms
      const v0 = s < 0 ? -16 : 11, v1 = s < 0 ? -11 : 16;
      slab(-15, v0, 15, v1, 15, 23, 2.4);
      slab(-14.5, v0 + 0.5, 15.5, v1 - 0.5, 23, 24.5, 2.2);
      slab(-14, v0 + 1.3, 15.2, v1 - 1.3, 24.5, 25.3, 1.6);
    }
    slab(-15, -16, -8, 16, 15, 32, 3);                        // back, rounded over the top in fine steps
    slab(-14.8, -15.8, -8.2, 15.8, 32, 32.9, 2.9);
    slab(-14.5, -15.3, -8.5, 15.3, 32.9, 33.7, 2.7);
    slab(-14.1, -14.6, -8.9, 14.6, 33.7, 34.3, 2.4);
    slab(-13.5, -13.6, -9.5, 13.6, 34.3, 34.75, 1.9);
    slab(-12.7, -12.2, -10.3, 12.2, 34.75, 35, 1.1);
  }
  /**
   * A basement window high in a wall, set in a deep well: the wall needs a gap from z0 - 1 to z1 + 1 with
   * `bottom`; the well goes `depth` back with the dark pane at its end, a sill board and casing round it.
   */
  window(axis: Axis, face: number, dir: Dir, a: number, b: number, z0: number, z1: number, pane = this.t.glassDark, depth = 10, trimmed = true): void {
    const P = this.t.paint, T = this.t.trim;
    this.wbox(axis, face, dir, a, b, -depth - 1, -depth, z0, z1, pane);          // the pane, at the back of the well
    this.wbox(axis, face, dir, a - 1, a, -depth - 1, 0, z0, z1, P);              // the well's sides, top and bottom
    this.wbox(axis, face, dir, b, b + 1, -depth - 1, 0, z0, z1, P);
    this.wbox(axis, face, dir, a - 1, b + 1, -depth - 1, 0, z1, z1 + 1, P);
    this.wbox(axis, face, dir, a - 1, b + 1, -depth - 1, 0, z0 - 1, z0, P);
    if (!trimmed) return;   // a plain drywall return, as a basement window well often is
    this.along(axis, face, dir, a - 3.5, b + 3.5, [[0, z0 - 0.75], [1.6, z0 - 0.75], [1.75, z0 - 0.4], [1.6, z0], [0, z0]], T);   // sill
    this.casing(axis, face, dir, a - 1, b + 1, z1 + 1, z0 - 1);
  }
  /** A wooden key rack on a wall: a board with rounded edges and three hooks. */
  plaque(axis: Axis, face: number, dir: Dir, u: number, z: number, w = 26, h = 6): void {
    const W = this.t.woodPlaque;
    this.along(axis, face, dir, u - w / 2, u + w / 2, [[0, z - h / 2], [0.8, z - h / 2], [1.1, z - h / 2 + 0.4], [1.1, z + h / 2 - 0.4], [0.8, z + h / 2], [0, z + h / 2]], W);
    for (const k of [-w / 3, 0, w / 3]) this.upright(axis, face, dir, rrect(u + k - 0.3, 1.1, u + k + 0.3, 2.6, 0.25), z - 1.8, z - 1.1, this.t.brass, { solid: false });
  }
}
