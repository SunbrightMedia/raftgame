/**
 * The first realism test for the house style (STYLE.md, reference 6: the
 * "Infinite house" video). Run: npm run gen:house → maps/house_test.json
 *
 * Modelled on the video's frames: a long carpeted basement room with too
 * many six-panel doors along one wall, crown moulding and baseboards, two
 * frosted dome lights; at its far end an open doorway into a small pale
 * green room with a lamp and a chair, a closed door and a square post; on
 * the near side a dark hall lit only by a sconce at its end.
 *
 *            x=0                                   x=384   x=581
 *   y=232                                            +------+
 *   y=168  +--[door]---[door][door]---[door]---[door]-+  B   |
 *          |                                 post     [open] |
 *          |  A (cream, beige carpet)                 [door] |
 *   y=0    +-[open]-------------------------------------+------+
 *            | C: dark hall, sconce at the end (y=-269)
 *
 * Units are inches; Z is up; 8' ceilings (96"); doors 36" × 80".
 */
import type { V3 } from '../../src/data/map';
import { MapBuilder, circle } from '../lib/build';
import { HOUSE_H, HOUSE_TEST_ROOMS } from './rooms';

const H = HOUSE_H, T = 5;                                   // ceiling height, wall thickness
const PAINT = 'house6/paint_cream', CEIL = 'house6/ceiling', CARPET = 'house6/carpet';
const TRIM = 'house/trim_white', DOOR = 'house/door_6panel', BRASS = 'pmp/brass', DOME = 'fixture/dome';
const CHROME = 'fixture/chrome', PLASTIC = 'house/trim_white';

const m = new MapBuilder();

interface Gap { a: number; b: number; top: number }
/** A wall along x (between y0 and y1) from x = a to x = b, with openings (x range and height). */
function wallX(y0: number, y1: number, a: number, b: number, gaps: Gap[] = []): void {
  let cur = a;
  for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
    if (g.a > cur) m.box([cur, y0, 0], [g.a, y1, H], PAINT);
    m.box([g.a, y0, g.top], [g.b, y1, H], PAINT);     // the header over the opening
    cur = g.b;
  }
  if (b > cur) m.box([cur, y0, 0], [b, y1, H], PAINT);
}
/** A wall along y (between x0 and x1) from y = a to y = b, with openings. */
function wallY(x0: number, x1: number, a: number, b: number, gaps: Gap[] = []): void {
  let cur = a;
  for (const g of [...gaps].sort((p, q) => p.a - q.a)) {
    if (g.a > cur) m.box([x0, cur, 0], [x1, g.a, H], PAINT);
    m.box([x0, g.a, g.top], [x1, g.b, H], PAINT);
    cur = g.b;
  }
  if (b > cur) m.box([x0, cur, 0], [x1, b, H], PAINT);
}
/** A room's floor and ceiling slabs. */
function slabs(x0: number, y0: number, x1: number, y1: number): void {
  m.box([x0, y0, -6], [x1, y1, 0], CARPET);
  m.box([x0, y0, H], [x1, y1, H + 6], CEIL);
}

/** Casing (3" trim, 0.8" proud) round an opening `a..b` × `top` in a wall whose face is at `face` along the other axis; `dir` is the way into the room. */
function casing(axis: 'x' | 'y', face: number, dir: 1 | -1, a: number, b: number, top: number): void {
  const t = 0.8, w = 3, f0 = dir > 0 ? face : face - t, f1 = dir > 0 ? face + t : face;
  const put = (u0: number, u1: number, z0: number, z1: number) => (axis === 'x' ? m.box([u0, f0, z0], [u1, f1, z1], TRIM) : m.box([f0, u0, z0], [f1, u1, z1], TRIM));
  put(a - w, a, 0, top); put(b, b + w, 0, top); put(a - w, b + w, top, top + w);
}

/**
 * A closed six-panel door on a wall face (36" × 80"), standing 0.75" proud
 * of the wall inside its casing, with a brass knob on the `knob` side.
 */
function door(axis: 'x' | 'y', face: number, dir: 1 | -1, centre: number, knob: 1 | -1): void {
  const a = centre - 18, b = centre + 18, s0 = dir > 0 ? face : face - 0.75, s1 = dir > 0 ? face + 0.75 : face;
  // The painted face looks into the room. Its texture starts at the door's edge (world-aligned UVs: shift them).
  if (axis === 'x') {
    const key = dir > 0 ? 'py' : 'ny', off = dir > 0 ? b : -a;
    m.box([a, s0, 0], [b, s1, 80], TRIM, { faces: { [key]: { tex: DOOR, offset: [off, 0] } } });
  } else {
    const key = dir > 0 ? 'px' : 'nx', off = dir > 0 ? -a : b;
    m.box([s0, a, 0], [s1, b, 80], TRIM, { faces: { [key]: { tex: DOOR, offset: [off, 0] } } });
  }
  casing(axis, face, dir, a, b, 80);
  // The knob: a short brass cylinder out of the door face, 36" up, 2.75" from the edge.
  const k = centre + knob * 15.25, f = dir > 0 ? s1 : s0, out = dir > 0 ? f + 2.4 : f - 2.4;
  const ring = circle(k, 36, 1.1, 20);
  if (axis === 'x') m.prismY(ring, Math.min(f, out), Math.max(f, out), BRASS, { solid: false });
  else m.prismX(ring.map(([u, z]) => [u, z]), Math.min(f, out), Math.max(f, out), BRASS, { solid: false });
}

/** White baseboards (3.5" × 0.6") along a room's walls, stopping at the given spans (casings, openings). */
function baseboards(x0: number, y0: number, x1: number, y1: number, skip: { side: 'n' | 's' | 'e' | 'w'; a: number; b: number }[]): void {
  const t = 0.6, h = 3.5;
  const run = (side: 'n' | 's' | 'e' | 'w', a: number, b: number) => {
    let cur = a;
    const seg = (s: number, e: number) => {
      if (e - s < 0.5) return;
      if (side === 's') m.box([s, y0, 0], [e, y0 + t, h], TRIM);
      if (side === 'n') m.box([s, y1 - t, 0], [e, y1, h], TRIM);
      if (side === 'w') m.box([x0, s, 0], [x0 + t, e, h], TRIM);
      if (side === 'e') m.box([x1 - t, s, 0], [x1, e, h], TRIM);
    };
    for (const g of skip.filter((q) => q.side === side).sort((p, q) => p.a - q.a)) { seg(cur, Math.max(cur, g.a)); cur = Math.max(cur, g.b); }
    seg(cur, b);
  };
  run('s', x0, x1); run('n', x0, x1); run('w', y0 + t, y1 - t); run('e', y0 + t, y1 - t);
}

/** Crown moulding round a room: a 3" face with a 1.5" step under it. */
function crown(x0: number, y0: number, x1: number, y1: number): void {
  const strip = (lo: V3, hi: V3) => m.box(lo, hi, TRIM);
  strip([x0, y0, H - 3], [x1, y0 + 1.2, H]); strip([x0, y1 - 1.2, H - 3], [x1, y1, H]);
  strip([x0, y0 + 1.2, H - 3], [x0 + 1.2, y1 - 1.2, H]); strip([x1 - 1.2, y0 + 1.2, H - 3], [x1, y1 - 1.2, H]);
  strip([x0, y0 + 1.2, H - 1.5], [x1, y0 + 2.2, H]); strip([x0, y1 - 2.2, H - 1.5], [x1, y1 - 1.2, H]);
  strip([x0 + 1.2, y0 + 2.2, H - 1.5], [x0 + 2.2, y1 - 2.2, H]); strip([x1 - 2.2, y0 + 2.2, H - 1.5], [x1 - 1.2, y1 - 2.2, H]);
}

/** A frosted dome on the ceiling (12" across) and its light: a 60 W-equivalent pair of bulbs, 2700 K. */
function domeLight(x: number, y: number, lumens = 1100): void {
  m.prism(circle(x, y, 6.5, 32), H - 2.5, H, DOME, { solid: false });
  m.light([x, y, H - 3], { type: 'dome', lumens, kelvin: 2700 });
}

/** A white moulded-plastic chair with chrome legs, its back to the wall it faces away from (`yaw` 0 = seat faces +x). */
function chair(x: number, y: number, yaw: 0 | 90 | 180 | 270): void {
  const R = (u: number, v: number): [number, number] => {
    const a = (yaw * Math.PI) / 180;
    return [x + u * Math.cos(a) - v * Math.sin(a), y + u * Math.sin(a) + v * Math.cos(a)];
  };
  const quad = (u0: number, v0: number, u1: number, v1: number) => [R(u0, v0), R(u1, v0), R(u1, v1), R(u0, v1)];
  const ccw = (q: [number, number][]) => { let s = 0; for (let i = 0; i < q.length; i++) { const [a, b] = q[i], [c, d] = q[(i + 1) % q.length]; s += a * d - c * b; } return s < 0 ? [...q].reverse() : q; };
  m.prism(ccw(quad(-8, -8, 8, 8)), 16.5, 18, PLASTIC);                       // seat
  m.prism(ccw(quad(-9, -8, -7.8, 8)), 18, 33, PLASTIC);                      // back
  for (const [u, v] of [[-7, -7], [7, -7], [-7, 7], [7, 7]] as const) m.prism(ccw(quad(u - 0.4, v - 0.4, u + 0.4, v + 0.4)), 0, 16.5, CHROME);
}

// ---- room A: the long room with too many doors
slabs(0, 0, 384, 168);
const doorsN = [36, 112, 152, 236, 312];           // along the north wall (two close together, as in the video)
wallX(168, 168 + T, -T, 384 + T);                  // north wall (the doors stand on its face)
for (const [i, c] of doorsN.entries()) door('x', 168, -1, c, i % 2 ? 1 : -1);
wallX(-T, 0, -T, 384 + T, [{ a: 60, b: 96, top: 80 }]);   // south wall, the opening to the dark hall
wallY(-T, 0, 0, 168);                              // west wall
wallY(384, 384 + T, 0, 173, [{ a: 104, b: 140, top: 80 }]);   // east wall, the open doorway to room B
door('y', 384, -1, 38, 1);                         // a closed door on the east wall
casing('x', 0, 1, 60, 96, 80);
casing('y', 384, -1, 104, 140, 80);
m.box([366, 92, 0], [376, 102, H], PAINT);           // a square post near the end wall
crown(0, 0, 384, 168);
baseboards(0, 0, 384, 168, [
  ...doorsN.map((c) => ({ side: 'n' as const, a: c - 21, b: c + 21 })),
  { side: 's', a: 57, b: 99 }, { side: 'e', a: 17, b: 59 }, { side: 'e', a: 101, b: 143 },
]);
domeLight(110, 84); domeLight(290, 84);
chair(214, 14, 90);

// ---- room B: small, pale green, lit, seen through the doorway
slabs(389, 60, 581, 232);
wallX(232, 232 + T, 384, 581 + T);
wallX(60 - T, 60, 389, 581 + T);
m.box([384, 104, -6], [389, 140, 0], CARPET);     // the floor through the doorway
wallY(581, 581 + T, 60, 232);
wallY(384, 389, 173, 232);                         // the bit of its west wall past room A's corner
casing('y', 389, 1, 104, 140, 80);
crown(389, 60, 581, 232);
baseboards(389, 60, 581, 232, [{ side: 'w', a: 101, b: 143 }]);
domeLight(485, 146, 900);
chair(560, 196, 180);

// ---- C: the dark hall, lit only by a sconce at its end
slabs(58, -269, 98, -5);
m.box([58, -5, -6], [98, 0, 0], CARPET);         // the floor through the opening
wallY(58 - T, 58, -269 - T, -5);
wallY(98, 98 + T, -269 - T, -5);
wallX(-269 - T, -269, 58 - T, 98 + T);
casing('x', -5, -1, 60, 96, 80);
baseboards(58, -269, 98, -5, [{ side: 'n', a: 57, b: 99 }]);
m.box([72, -269, 64], [84, -267, 72], DOME, { solid: false });
m.light([78, -266, 68], { type: 'bulb', lumens: 250, kelvin: 2700 });

m.start([40, 84, 0], 0, 0);

m.write('house_test', HOUSE_TEST_ROOMS, {
  light: { luxelSize: 4, bounces: 2, extraBounces: 1 },
  fog: { enabled: false },
  // A home camcorder's picture: 480 lines, auto exposure, white balance set too cool for the bulbs (warm cast).
  render: { internalHeight: 480 },
  camera: { model: 'digicam' },
});
