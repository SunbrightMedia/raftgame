/**
 * Building parts for the house style (STYLE.md, reference 6: "Infinite house"): walls with openings,
 * casings, doors with real raised panels, louvred doors, baseboards, crown moulding, lamps, and
 * plain furniture at true size (inches; z up).
 *
 * Things on a wall are placed in the wall's own terms: `axis` is the direction the wall runs ('x':
 * a wall at y = face; 'y': a wall at x = face), `dir` (+1/-1) points from the wall into the room,
 * `u` runs along the wall, `v` out of its face into the room.
 */
import type { V3 } from '../../src/data/map';
import { MapBuilder, circle, type Opts } from '../lib/build';

export interface Gap { a: number; b: number; top: number }
export type Axis = 'x' | 'y';
export type Dir = 1 | -1;

export interface HouseTex {
  paint: string; carpet: string; ceiling: string; trim: string; brass: string; dome: string; chrome: string;
  brick: string; soot: string; woodDark: string; fabric: string; counter: string; glassDark: string; woodPlaque: string;
  /** A wall sconce's shade (dimmer than a ceiling dome's lens). */
  sconce?: string;
}

export class HouseKit {
  constructor(readonly m: MapBuilder, readonly H: number, readonly t: HouseTex) {}

  // ---- placement in a wall's terms
  /** A box in a wall's terms: u along the wall, v out of its face, z up. */
  wbox(axis: Axis, face: number, dir: Dir, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, tex: string, o: Opts = {}): void {
    const a = face + dir * v0, b = face + dir * v1, lo = Math.min(a, b), hi = Math.max(a, b);
    if (axis === 'x') this.m.box([Math.min(u0, u1), lo, z0], [Math.max(u0, u1), hi, z1], tex, o);
    else this.m.box([lo, Math.min(u0, u1), z0], [hi, Math.max(u0, u1), z1], tex, o);
  }
  /** The face name of a wall-mounted box that looks into the room. */
  front(axis: Axis, dir: Dir): string { return axis === 'x' ? (dir > 0 ? 'py' : 'ny') : (dir > 0 ? 'px' : 'nx'); }
  /** World point from a wall's terms. */
  wpt(axis: Axis, face: number, dir: Dir, u: number, v: number, z: number): V3 {
    return axis === 'x' ? [u, face + dir * v, z] : [face + dir * v, u, z];
  }

  // ---- walls, floors, ceilings
  /** A wall along x (between y0 and y1) from x = a to x = b, with openings (x range and height). */
  wallX(y0: number, y1: number, a: number, b: number, gaps: Gap[] = [], tex = this.t.paint): void {
    let cur = a;
    for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
      if (g.a > cur) this.m.box([cur, y0, 0], [g.a, y1, this.H], tex);
      this.m.box([g.a, y0, g.top], [g.b, y1, this.H], tex);
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
      cur = g.b;
    }
    if (b > cur) this.m.box([x0, cur, 0], [x1, b, this.H], tex);
  }
  /** Floor and ceiling slabs. */
  slabs(x0: number, y0: number, x1: number, y1: number): void {
    this.m.box([x0, y0, -6], [x1, y1, 0], this.t.carpet);
    this.m.box([x0, y0, this.H], [x1, y1, this.H + 6], this.t.ceiling);
  }

  // ---- trim
  /** Casing (3" wide, 0.8" proud) round an opening a..b × top. */
  casing(axis: Axis, face: number, dir: Dir, a: number, b: number, top: number): void {
    const w = 3, t = 0.8, T = this.t.trim;
    this.wbox(axis, face, dir, a - w, a, 0, t, 0, top, T);
    this.wbox(axis, face, dir, b, b + w, 0, t, 0, top, T);
    this.wbox(axis, face, dir, a - w, b + w, 0, t, top, top + w, T);
  }
  /** White baseboards (3.5" × 0.6") along a room's walls, stopping at the given spans. */
  baseboards(x0: number, y0: number, x1: number, y1: number, skip: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number }[] = []): void {
    const t = 0.6, h = 3.5, T = this.t.trim, m = this.m;
    const run = (side: 'n' | 's' | 'e' | 'w', a: number, b: number) => {
      let cur = a;
      const seg = (s: number, e: number) => {
        if (e - s < 0.5) return;
        if (side === 's') m.box([s, y0, 0], [e, y0 + t, h], T);
        if (side === 'n') m.box([s, y1 - t, 0], [e, y1, h], T);
        if (side === 'w') m.box([x0, s, 0], [x0 + t, e, h], T);
        if (side === 'e') m.box([x1 - t, s, 0], [x1, e, h], T);
      };
      for (const g of skip.filter((q) => q.side === side).sort((p, q) => p.a - q.a)) { seg(cur, Math.max(cur, g.a)); cur = Math.max(cur, g.b); }
      seg(cur, b);
    };
    run('s', x0, x1); run('n', x0, x1); run('w', y0 + t, y1 - t); run('e', y0 + t, y1 - t);
  }
  /** Crown moulding round a room: a 3" face with a 1.5" step under the ceiling. */
  crown(x0: number, y0: number, x1: number, y1: number): void {
    const H = this.H, T = this.t.trim, m = this.m;
    m.box([x0, y0, H - 3], [x1, y0 + 1.2, H], T); m.box([x0, y1 - 1.2, H - 3], [x1, y1, H], T);
    m.box([x0, y0 + 1.2, H - 3], [x0 + 1.2, y1 - 1.2, H], T); m.box([x1 - 1.2, y0 + 1.2, H - 3], [x1, y1 - 1.2, H], T);
    m.box([x0, y0 + 1.2, H - 1.5], [x1, y0 + 2.2, H], T); m.box([x0, y1 - 2.2, H - 1.5], [x1, y1 - 1.2, H], T);
    m.box([x0 + 1.2, y0 + 2.2, H - 1.5], [x0 + 2.2, y1 - 2.2, H], T); m.box([x1 - 2.2, y0 + 2.2, H - 1.5], [x1 - 1.2, y1 - 2.2, H], T);
  }

  // ---- doors
  /**
   * A closed door on a wall face in its casing. 'six': six raised panels (frame 1.1" proud, panel fields
   * 0.85", the grooves round them 0.6"), so the panels shade as a real door's do. 'louvred': a bifold pair,
   * slatted above the lock rail and with two raised panels below each leaf.
   */
  door(axis: Axis, face: number, dir: Dir, centre: number, knob: Dir, o: { w?: number; h?: number; kind?: 'six' | 'louvred' } = {}): void {
    const w = o.w ?? 36, h = o.h ?? 80, a = centre - w / 2, T = this.t.trim;
    const slab = 0.6, field = 0.85, frame = 1.1;   // louvred leaves' panels sit at `field`
    const box = (u0: number, u1: number, v1: number, z0: number, z1: number, tex = T) => this.wbox(axis, face, dir, a + u0, a + u1, 0, v1, z0, z1, tex);
    if ((o.kind ?? 'six') === 'six') {
      const s = w / 36;                                       // panel layout for a 36" door, scaled to the width
      box(0, w, slab, 0, h);
      // stiles and rails (z from the top of the door, as the layout is drawn)
      const stiles = [[0, 5 * s], [16 * s, 20 * s], [31 * s, w]], rails = [[0, 5], [22, 26], [56, 60], [75, 80]];
      for (const [u0, u1] of stiles) box(u0, u1, frame, 0, h);
      for (const [r0, r1] of rails) box(0, w, frame, h - r1, h - r0);
      // raised panels in the six openings: a bevel all round rising to a flat field just under the frame
      for (const [z0, z1] of [[5, 22], [26, 56], [60, 75]]) for (const [u0, u1] of [[5 * s, 16 * s], [20 * s, 31 * s]]) this.raisedPanel(axis, face, dir, a + u0 + 0.25, a + u1 - 0.25, h - z1 + 0.25, h - z0 - 0.25, slab, 1.0, 1.5);
    } else {
      // two leaves, each a frame with slats above the lock rail (z 40) and two raised panels below
      for (const L of [0, 1]) {
        const l0 = L * w / 2, l1 = l0 + w / 2;
        box(l0, l1, 0.3, 0, h, this.t.glassDark);            // the dark gap behind the slats
        box(l0, l0 + 3, frame, 0, h); box(l1 - 3, l1, frame, 0, h);
        for (const [z0, z1] of [[0, 6], [36, 42], [h - 4, h]]) box(l0, l1, frame, z0, z1);
        for (let z = 43; z < h - 5; z += 1.6) box(l0 + 3, l1 - 3, 0.9, z, z + 0.7);   // slats
        for (const [z0, z1] of [[7, 20], [22, 35]]) box(l0 + 4, l1 - 4, field, z0, z1);
        box(l0 + 3, l1 - 3, slab, 6, 36);
      }
    }
    this.casing(axis, face, dir, a, a + w, h);
    // the knob (or the pulls of a bifold pair): brass, 36" up
    const ks = (o.kind ?? 'six') === 'six' ? [centre + knob * (w / 2 - 2.75)] : [centre - 2.5, centre + 2.5];
    for (const k of ks) {
      const ring = circle(k, 36, 1.1, 20), f0 = face + dir * frame, f1 = face + dir * (frame + 2.2);
      if (axis === 'x') this.m.prismY(ring, Math.min(f0, f1), Math.max(f0, f1), this.t.brass, { solid: false });
      else this.m.prismX(ring, Math.min(f0, f1), Math.max(f0, f1), this.t.brass, { solid: false });
    }
  }

  /**
   * A raised panel in a door's frame: from v0 at its edges a bevel `b` wide rises to a flat field at v1, so
   * its top edge faces up and its bottom edge down and the panel reads in soft light, as a real door's.
   */
  raisedPanel(axis: Axis, face: number, dir: Dir, u0: number, u1: number, z0: number, z1: number, v0: number, v1: number, b: number): void {
    const T = this.t.trim, V0 = face + dir * v0, V1 = face + dir * v1;
    this.wbox(axis, face, dir, u0 + b, u1 - b, v0, v1, z0 + b, z1 - b, T);
    // top and bottom bevels: sideways prisms along the wall (profile in the wall's normal and z)
    const along = (profile: [number, number][]) => axis === 'x' ? this.m.prismX(profile, u0, u1, T) : this.m.prismY(profile, u0, u1, T);
    along([[V0, z1], [V1, z1 - b], [V0, z1 - b]]);
    along([[V0, z0], [V0, z0 + b], [V1, z0 + b]]);
    // side bevels: upright prisms between them
    const xy = (u: number, v: number): [number, number] => { const p = this.wpt(axis, face, dir, u, v, 0); return [p[0], p[1]]; };
    this.m.prism([xy(u0, v0), xy(u0 + b, v0), xy(u0 + b, v1)], z0 + b, z1 - b, T);
    this.m.prism([xy(u1, v0), xy(u1 - b, v1), xy(u1 - b, v0)], z0 + b, z1 - b, T);
  }

  // ---- lamps
  /**
   * A frosted dome on the ceiling (13" across) and its light (default: two 60 W-equivalent bulbs, 2700 K).
   * `n` shapes the downward light (0.6: brightest straight down; 0: even to the sides).
   */
  dome(x: number, y: number, lumens = 1600, kelvin = 2700, o: { n?: number } = {}): void {
    this.m.prism(circle(x, y, 6.5, 32), this.H - 2.5, this.H, this.t.dome, { solid: false });
    this.m.light([x, y, this.H - 3], { type: 'dome', lumens, kelvin, ...(o.n !== undefined ? { n: o.n } : {}) });
  }
  /** A wall sconce: a small frosted shade with a bare-bulb light in it. */
  sconce(axis: Axis, face: number, dir: Dir, u: number, z: number, lumens = 450, kelvin = 2700): void {
    this.wbox(axis, face, dir, u - 3, u + 3, 0, 4, z - 4, z + 3, this.t.sconce ?? this.t.dome, { solid: false });
    this.m.light(this.wpt(axis, face, dir, u, 5, z), { type: 'bulb', lumens, kelvin });
  }

  // ---- furniture (plain, true size)
  /** A white moulded-plastic chair with chrome legs (`yaw` 0 = the seat faces +x). */
  chair(x: number, y: number, yaw: 0 | 90 | 180 | 270): void {
    const R = (u: number, v: number): [number, number] => {
      const a = (yaw * Math.PI) / 180;
      return [x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)];
    };
    const quad = (u0: number, v0: number, u1: number, v1: number) => [R(u0, v0), R(u1, v0), R(u1, v1), R(u0, v1)];
    const ccw = (q: [number, number][]) => { let s = 0; for (let i = 0; i < q.length; i++) { const [a, b] = q[i], [c, d] = q[(i + 1) % q.length]; s += a * d - c * b; } return s < 0 ? [...q].reverse() : q; };
    const m = this.m, T = this.t.trim;
    m.prism(ccw(quad(-8, -8, 8, 8)), 16.5, 18, T);                       // seat
    m.prism(ccw(quad(-9, -8, -7.8, 8)), 18, 33, T);                      // back
    for (const [u, v] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) m.prism(ccw(quad(u - 0.4, v - 0.4, u + 0.4, v + 0.4)), 0, 16.5, this.t.chrome);
  }
  /** Base cabinets against a wall from u = a to b: 24" deep, 34.5" high on a 4" toe kick, a 1.5" counter
   *  (1" overhang), a drawer over two doors per 30" section. */
  baseCabinets(axis: Axis, face: number, dir: Dir, a: number, b: number): void {
    const T = this.t.trim;
    this.wbox(axis, face, dir, a, b, 0, 21, 0, 4, this.t.glassDark);          // toe kick, set back
    this.wbox(axis, face, dir, a, b, 0, 23.25, 4, 34.5, T);                   // the carcass
    this.wbox(axis, face, dir, a, b, 0, 25, 34.5, 36, this.t.counter);        // the counter
    const n = Math.max(1, Math.round((b - a) / 30)), sw = (b - a) / n;
    for (let i = 0; i < n; i++) {
      const s0 = a + i * sw;
      this.wbox(axis, face, dir, s0 + 0.25, s0 + sw - 0.25, 23.25, 24, 28, 34, T);                       // drawer front
      this.wbox(axis, face, dir, s0 + 0.25, s0 + sw / 2 - 0.15, 23.25, 24, 4.5, 27.5, T);                 // doors
      this.wbox(axis, face, dir, s0 + sw / 2 + 0.15, s0 + sw - 0.25, 23.25, 24, 4.5, 27.5, T);
      for (const [u, z] of [[s0 + sw / 2, 31], [s0 + sw / 2 - 2, 24], [s0 + sw / 2 + 2, 24]]) this.wbox(axis, face, dir, u - 0.4, u + 0.4, 24, 25, z - 1.5, z + 1.5, this.t.chrome, { solid: false });
    }
  }
  /** Upper cabinets from u = a to b, 12" deep, z0..z1, two doors per 30"; `openShelf` leaves the first
   *  12" open as shelves. */
  upperCabinets(axis: Axis, face: number, dir: Dir, a: number, b: number, z0 = 54, z1 = 84, openShelf = false): void {
    const T = this.t.trim;
    let s = a;
    if (openShelf) {
      this.wbox(axis, face, dir, a, a + 0.75, 0, 12, z0, z1, T); this.wbox(axis, face, dir, a + 11.25, a + 12, 0, 12, z0, z1, T);
      for (const z of [z0, (z0 + z1) / 2, z1 - 0.75]) this.wbox(axis, face, dir, a, a + 12, 0, 12, z, z + 0.75, T);
      s = a + 12;
    }
    this.wbox(axis, face, dir, s, b, 0, 11.25, z0, z1, T);
    const n = Math.max(1, Math.round((b - s) / 15)), dw = (b - s) / n;
    for (let i = 0; i < n; i++) this.wbox(axis, face, dir, s + i * dw + 0.15, s + (i + 1) * dw - 0.15, 11.25, 12, z0 + 0.3, z1 - 0.3, T);
  }
  /**
   * A brick chimney breast from floor to ceiling, `w` wide and `d` proud of the wall, with a lower surround
   * (`sh` high, `sd` proud) round a firebox opening `ow` × `oh` whose floor is `oz` up (a raised hearth
   * inside). Measured on the video's fireplace: 63" wide, surround 46" high, opening 41" × 31" at 7".
   */
  fireplace(axis: Axis, face: number, dir: Dir, centre: number, o: { w?: number; d?: number; sh?: number; sd?: number; ow?: number; oh?: number; oz?: number } = {}): void {
    const B = this.t.brick, w = o.w ?? 63, d = o.d ?? 6, sh = o.sh ?? 46, sd = o.sd ?? 10, ow = o.ow ?? 41, oh = o.oh ?? 31, oz = o.oz ?? 7;
    const a = centre - w / 2, b = centre + w / 2, o0 = centre - ow / 2, o1 = centre + ow / 2;
    this.wbox(axis, face, dir, a, b, 0, d, sh, this.H, B);                                 // the breast above the surround
    this.wbox(axis, face, dir, a, o0, 0, sd, 0, sh, B);                                     // the surround: sides, top, hearth
    this.wbox(axis, face, dir, o1, b, 0, sd, 0, sh, B);
    this.wbox(axis, face, dir, o0, o1, 0, sd, oz + oh, sh, B);
    this.wbox(axis, face, dir, o0, o1, 0, sd, 0, oz, B);
    this.wbox(axis, face, dir, o0, o1, 0, 0.5, oz, oz + oh, this.t.soot);                  // the firebox: sooty back, sides, roof
    this.wbox(axis, face, dir, o0, o0 + 0.5, 0.5, sd, oz, oz + oh, this.t.soot);
    this.wbox(axis, face, dir, o1 - 0.5, o1, 0.5, sd, oz, oz + oh, this.t.soot);
    this.wbox(axis, face, dir, o0 + 0.5, o1 - 0.5, 0.5, sd, oz + oh - 0.5, oz + oh, this.t.soot);
  }
  /** An empty bookcase of dark wood, open at the front. */
  bookshelf(axis: Axis, face: number, dir: Dir, a: number, b: number, h = 52, d = 12): void {
    const W = this.t.woodDark;
    this.wbox(axis, face, dir, a, b, 0, 0.5, 0, h, W);
    this.wbox(axis, face, dir, a, a + 0.75, 0, d, 0, h, W); this.wbox(axis, face, dir, b - 0.75, b, 0, d, 0, h, W);
    for (const z of [0, 3, 16, 29, 42, h - 0.75]) this.wbox(axis, face, dir, a, b, 0, d, z, z + 0.75, W);
  }
  /** A plain armchair upholstered in grey: seat, back and two arms (`yaw` in degrees, 0 = it faces +x). */
  armchair(x: number, y: number, yaw: number, back = 32): void {
    const F = this.t.fabric, a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const P = (u: number, v: number): [number, number] => [x + u * c - v * s, y + u * s + v * c];
    const block = (u0: number, v0: number, u1: number, v1: number, z0: number, z1: number) => {
      const q = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
      let area = 0; for (let i = 0; i < 4; i++) { const [p, r] = q[i], [k, l] = q[(i + 1) % 4]; area += p * l - k * r; }
      this.m.prism(area < 0 ? [...q].reverse() : q, z0, z1, F);
    };
    block(-15, -16, 15, 16, 3, 17);           // base and seat cushion
    block(-15, -16, -8, 16, 17, back);        // back
    block(-8, -16, 15, -11, 17, 25);          // arms
    block(-8, 11, 15, 16, 17, 25);
  }
  /** A basement window high on a wall: a dark pane in a white frame. */
  window(axis: Axis, face: number, dir: Dir, a: number, b: number, z0: number, z1: number, pane = this.t.glassDark): void {
    this.wbox(axis, face, dir, a, b, 0, 0.4, z0, z1, pane);
    const w = 3, t = 0.8, T = this.t.trim;     // casing round the window only (not down to the floor as a door's)
    this.wbox(axis, face, dir, a - w, a, 0, t, z0, z1, T);
    this.wbox(axis, face, dir, b, b + w, 0, t, z0, z1, T);
    this.wbox(axis, face, dir, a - w, b + w, 0, t, z1, z1 + w, T);
    this.wbox(axis, face, dir, a - w, b + w, 0, 1.5, z0 - 1.5, z0, T);
  }
  /** A small plain board on a wall (a key rack or plaque). */
  plaque(axis: Axis, face: number, dir: Dir, u: number, z: number, w = 26, h = 6): void {
    this.wbox(axis, face, dir, u - w / 2, u + w / 2, 0, 1, z - h / 2, z + h / 2, this.t.woodPlaque);
  }
}
