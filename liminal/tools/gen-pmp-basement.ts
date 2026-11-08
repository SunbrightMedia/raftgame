/**
 * Generates maps/pmp_basement.json: the first Postmodern Palace reference
 * room (see STYLE.md, "reference 1"). Run: npm run gen:pmp
 *
 *   - Blue room (spawn): dull mint walls, royal-blue carpet, warm pot lights.
 *   - Back wall: a cased opening into a green-furnished den, a six-panel door
 *     that leads nowhere (illogical layout rule), and a wide cased opening
 *     into a pink bar room whose salmon carpet curves out into the blue room.
 *   - Pink room: dropped soffit with hidden cove lights, a curved L-shaped bar
 *     with fake laminate marble, chrome/burgundy stools, orange wood cabinets.
 *
 * Every wall gets a white baseboard and every opening gets casing; no crown molding.
 * Units are inches; Z is up.
 */
import { writeFileSync } from 'node:fs';
import { type BrushDef, type EntityDef, type FaceTex, type V3, MAP_FORMAT, MAP_VERSION, serializeMap } from '../src/data/map';

const brushes: BrushDef[] = [];
const entities: EntityDef[] = [];
let nextId = 1;
type Opts = { faces?: Record<string, FaceTex>; solid?: boolean };

function box(min: V3, max: V3, tex: string, o: Opts = {}): void {
  brushes.push({ id: nextId++, type: 'box', min, max, tex, ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}) } as BrushDef);
}
function prism(points: [number, number][], z0: number, z1: number, tex: string, o: Opts = {}): void {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const pts = points.map(([x, y]) => [r(x), r(y)] as [number, number]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  brushes.push({
    id: nextId++, type: 'prism', points: pts, z0, z1, tex,
    min: [Math.min(...xs), Math.min(...ys), z0], max: [Math.max(...xs), Math.max(...ys), z1],
    ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}),
  } as BrushDef);
}
const circle = (cx: number, cy: number, r: number, n: number): [number, number][] =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]);
const deg = (d: number) => (d * Math.PI) / 180;

/**
 * A curved band (part of a ring) as convex quads, with the outer face's
 * texture offset so it wraps around the curve without seams.
 */
function arcBand(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number, n: number, z0: number, z1: number, tex: string, faces: Record<string, FaceTex> = {}): void {
  let along = 0;
  for (let i = 0; i < n; i++) {
    const t0 = deg(a0 + ((a1 - a0) * i) / n), t1 = deg(a0 + ((a1 - a0) * (i + 1)) / n);
    const p = (r: number, t: number): [number, number] => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
    const o0 = p(rOut, t0), o1 = p(rOut, t1);
    const chord = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
    const dir = [(o1[0] - o0[0]) / chord, (o1[1] - o0[1]) / chord];
    // Mesh UVs use the world projection onto the face's direction; shift it so u = distance around the curve.
    const off = along - (o0[0] * dir[0] + o0[1] * dir[1]);
    prism([p(rIn, t0), o0, o1, p(rIn, t1)], z0, z1, tex, { faces: { ...faces, side1: { ...(faces.side ?? {}), ...(faces.side1 ?? {}), offset: [off, 0] } } });
    along += chord;
  }
}

/** Room trim: white baseboards along the inside of a rectangle, skipping gaps (openings). */
function baseboards(x0: number, y0: number, x1: number, y1: number, gaps: { side: 'n' | 's' | 'e' | 'w'; from: number; to: number }[] = [], tex = 'house/trim_white', h = 3.5, t = 0.6): void {
  const run = (side: 'n' | 's' | 'e' | 'w', a: number, b: number) => {
    const cuts = gaps.filter((g) => g.side === side).sort((p, q) => p.from - q.from);
    let cur = a;
    const seg = (s: number, e: number) => {
      if (e - s < 0.5) return;
      if (side === 's') box([s, y0, 0], [e, y0 + t, h], tex);
      if (side === 'n') box([s, y1 - t, 0], [e, y1, h], tex);
      if (side === 'w') box([x0, s, 0], [x0 + t, e, h], tex);
      if (side === 'e') box([x1 - t, s, 0], [x1, e, h], tex);
    };
    for (const g of cuts) { seg(cur, Math.max(cur, g.from)); cur = Math.max(cur, g.to); }
    seg(cur, b);
  };
  run('s', x0, x1); run('n', x0, x1);
  run('w', y0 + t, y1 - t); run('e', y0 + t, y1 - t); // short runs stop at the long ones: no overlap
}

/** Door-style casing around an opening in a wall that runs along x (faces ±y). */
function casingX(o0: number, o1: number, height: number, faceY: number, dir: 1 | -1, w = 3, t = 0.8, tex = 'house/trim_white'): void {
  const ya = dir > 0 ? faceY : faceY - t, yb = dir > 0 ? faceY + t : faceY;
  box([o0 - w, ya, 0], [o0, yb, height], tex);
  box([o1, ya, 0], [o1 + w, yb, height], tex);
  box([o0 - w, ya, height], [o1 + w, yb, height + w], tex);
}

function potLight(x: number, y: number, ceiling: number, intensity = 2.1): void {
  prism(circle(x, y, 3, 8), ceiling - 0.5, ceiling, 'fixture/potlight', { solid: false });
  entities.push({ id: 5000 + entities.length, class: 'light', origin: [x, y, ceiling - 2], props: { color: '#ffe2bd', intensity, fifty: 80, emit: 'down' } });
}

const MINT = 'pmp/paint_mint', WARM = 'pmp/paint_warmwhite', CEIL = 'pmp/ceiling_white';
const BLUE = 'pmp/carpet_royal', PINK = 'pmp/carpet_salmon', TRIM = 'house/trim_white';
const WOOD = 'house/wood_orange', MARBLE = 'house/laminate_marble', FABRIC = 'pmp/fabric_green';
const jamb = { tex: TRIM };

/** Casing around an opening in a wall that runs along y (faces ±x). */
function casingY(o0: number, o1: number, height: number, faceX: number, dir: 1 | -1, w = 3, t = 0.8, tex = TRIM): void {
  const xa = dir > 0 ? faceX : faceX - t, xb = dir > 0 ? faceX + t : faceX;
  box([xa, o0 - w, 0], [xb, o0, height], tex);
  box([xa, o1, 0], [xb, o1 + w, height], tex);
  box([xa, o0 - w, height], [xb, o1 + w, height + w], tex);
}

/*
 * Plan (top view, +y is "back", the camera starts front-right looking at the
 * back-left corner, as in the photo):
 *
 *            x=0                         x=240        x=300
 *   y=420     +---------- pink bar room ---------------+
 *             |  cabinet      curved bar     kitchenette|
 *   y=222  ---+--[door]------[ wide opening ]--+--------+
 *   den    |  |  x24..56       x92..188        |
 *  (x<0)   [opening y132..206] blue room       |
 *          |  |   (pink carpet arc spills in)  |
 *   y=0       +--------------------------------+
 *
 * The door and the wide opening lead into the SAME pink room: the door is
 * redundant, which is the illogical-layout rule from STYLE.md.
 */

// ------------------------------------------------------------------ blue room
// Inner x 0..240, y 0..216, ceiling 96.
{
  // Floor: everywhere except the two thresholds into the pink room.
  box([-6, -6, -16], [246, 216, 0], BLUE);
  box([-6, 216, -16], [24, 222, 0], BLUE);
  box([56, 216, -16], [92, 222, 0], BLUE);
  box([188, 216, -16], [246, 222, 0], BLUE);
  box([-6, -6, 96], [246, 222, 112], CEIL, { faces: { py: { tex: WARM } } }); // its back edge shows above the pink opening

  box([-6, -6, 0], [246, 0, 96], MINT);   // front (behind the camera)
  box([240, 0, 0], [246, 222, 96], MINT); // right
  // Left wall, with the den opening y 132..206 (h 84) near the back corner.
  box([-6, 0, 0], [0, 132, 96], MINT, { faces: { py: jamb } });
  box([-6, 132, 84], [0, 206, 96], MINT, { faces: { nz: jamb } });
  box([-6, 206, 0], [0, 242, 96], MINT, { faces: { ny: jamb } });
  // Back wall: door x 24..56 (h 80) and the wide opening x 92..188 (h 88), both into the pink room.
  box([0, 216, 0], [24, 222, 96], MINT, { faces: { px: jamb } });
  box([24, 216, 80], [56, 222, 96], MINT, { faces: { nz: jamb } });
  box([56, 216, 0], [92, 222, 96], MINT, { faces: { nx: jamb, px: jamb } });
  box([92, 216, 88], [188, 222, 96], MINT, { faces: { nz: jamb } });
  box([188, 216, 0], [240, 222, 96], MINT, { faces: { nx: jamb } });
  // Bulkhead along the top of the left wall, over the den opening.
  box([0, 0, 88], [14, 216, 96], MINT, { faces: { nz: { tex: CEIL } } });

  // The door, closed, white six-panel, brass knob on both sides.
  box([24, 218, 0], [56, 219.75, 80], 'house/door_6panel', { faces: { ny: { offset: [-24, 0] }, py: { offset: [-56, 0] } } });
  box([50, 216.2, 35], [52, 218, 37.5], 'pmp/brass');
  box([50, 219.75, 35], [52, 221.8, 37.5], 'pmp/brass');

  casingY(132, 206, 84, 0, 1);         // den opening, blue side
  casingX(24, 56, 80, 216, -1);         // door, blue side
  casingX(92, 188, 88, 216, -1);        // wide opening, blue side
  // Almond rocker switch plates at 48".
  box([0, 116, 46], [0.2, 119, 50.5], 'house/switchplate', { faces: { px: { offset: [-116, -46] } } });
  box([64, 215.8, 46], [67, 216, 50.5], 'house/switchplate', { faces: { ny: { offset: [-64, -46] } } });

  baseboards(0, 0, 240, 216, [
    { side: 'w', from: 129, to: 209 }, { side: 'n', from: 21, to: 59 }, { side: 'n', from: 89, to: 191 },
  ]);
  for (const [x, y] of [[70, 60], [180, 60], [70, 156], [180, 156]]) potLight(x, y, 96);

  // The pink carpet spills out of the wide opening in a big curve that
  // sweeps right, to the right-hand wall: the part of a circle (through the
  // opening's left jamb) inside the blue room, as a 1/4" overlay.
  const cx = 260, cy = 300, R = Math.hypot(92 - cx, 216 - cy);
  const a0 = Math.atan2(216 - cy, 92 - cx), a1 = Math.atan2(-Math.sqrt(R * R - (240 - cx) ** 2), 240 - cx);
  const arc: [number, number][] = [];
  for (let i = 0; i <= 16; i++) { const a = a0 + ((a1 - a0) * i) / 16; arc.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
  prism([...arc, [240, 216]], 0, 0.25, PINK, { solid: false });
}

// ------------------------------------------------------------------ fern den
// Left of the blue room: inner x -150..-6, y 100..236, ceiling 92. Blue
// carpet like the main room; it reads green because of its furniture.
{
  box([-156, 94, -16], [-6, 242, 0], BLUE);
  box([-156, 94, 92], [-6, 242, 108], CEIL);
  box([-156, 94, 0], [-150, 242, 92], MINT);
  box([-150, 94, 0], [-6, 100, 92], MINT);
  box([-150, 236, 0], [-6, 242, 92], MINT);
  // The blue room's left wall is this room's right wall (x -6..0); add the den-side casing.
  casingY(132, 206, 84, -6, -1);
  baseboards(-150, 100, -6, 236, [{ side: 'e', from: 129, to: 209 }, { side: 'w', from: 113, to: 223 }]);

  // Sectional sofa along the far (left) wall: base, seat cushions with gaps, back cushions, arms.
  box([-150, 120, 0], [-120, 216, 9], FABRIC);
  for (const [y0, y1] of [[120.5, 151.5], [152.5, 183.5], [184.5, 215.5]]) {
    box([-141, y0, 9], [-120, y1, 17], FABRIC);
    box([-150, y0, 9], [-141, y1, 32], FABRIC);
  }
  box([-150, 113, 0], [-118, 120, 24], FABRIC);
  box([-150, 216, 0], [-118, 223, 24], FABRIC);
  // Round ottoman: striped band below a green cushion.
  prism(circle(-90, 168, 17, 24), 0, 11, 'house/ottoman_band', { faces: { pz: { tex: FABRIC } } });
  prism(circle(-90, 168, 17.5, 24), 11, 16, FABRIC);
  potLight(-80, 140, 92, 1.8);
  potLight(-80, 200, 92, 1.5);
}

// ------------------------------------------------------------------ pink bar room
// Behind the back wall, wider than its opening so the door also leads here:
// inner x 6..300, y 222..420, tray ceiling 104 with a dropped soffit
// (z 92..98) around the edge and cove lights hidden on top of it.
{
  box([6, 222, -16], [300, 420, 0], PINK);
  box([92, 216, -16], [188, 222, 0], PINK);  // wide opening threshold
  box([24, 216, -16], [56, 222, 0], PINK);   // door threshold
  box([0, 222, 104], [306, 426, 120], CEIL);
  box([0, 222, 0], [6, 420, 104], WARM);
  box([300, 216, 0], [306, 426, 104], WARM);
  box([0, 420, 0], [300, 426, 104], WARM);
  box([246, 216, 0], [300, 222, 104], WARM);
  casingX(24, 56, 80, 222, 1);   // door, pink side
  casingX(92, 188, 88, 222, 1);  // wide opening, pink side

  baseboards(6, 222, 300, 420, [
    { side: 's', from: 21, to: 59 }, { side: 's', from: 89, to: 191 },
    { side: 'n', from: 120, to: 156 }, { side: 'n', from: 200, to: 300 }, { side: 'e', from: 396, to: 420 },
  ]);

  const SZ0 = 92, SZ1 = 98;
  box([6, 222, SZ0], [300, 246, SZ1], WARM);
  box([6, 396, SZ0], [300, 420, SZ1], WARM);
  box([6, 246, SZ0], [30, 396, SZ1], WARM);
  box([276, 246, SZ0], [300, 396, SZ1], WARM);
  const cove = (x: number, y: number) => entities.push({ id: 5000 + entities.length, class: 'light', origin: [x, y, SZ1 + 2], props: { color: '#ffd9a8', intensity: 0.9, fifty: 30, emit: 'up' } });
  for (let x = 40; x <= 268; x += 38) { cove(x, 243); cove(x, 399); }
  for (let y = 270; y <= 372; y += 34) { cove(33, y); cove(273, y); }
  for (const [x, y] of [[70, 290], [150, 290], [230, 290], [70, 350], [150, 350], [230, 350]]) potLight(x, y, 104, 1.4);

  // Tall display cabinet on the back wall: orange wood, frosted glass, gold lines.
  box([120, 404, 0], [156, 420, 84], WOOD, { faces: { ny: { tex: 'house/cabinet_glass', offset: [-120, 0] } } });
  // Kitchenette run in the back-right corner.
  box([200, 396, 0], [300, 420, 35], WOOD);
  box([200, 394, 35], [300, 420, 36.5], MARBLE);
  box([200, 408, 54], [300, 420, 86], WOOD);

  // Curved L-shaped bar, its curve facing the openings, stools on that side.
  const bx = 214, by = 336;
  arcBand(bx, by, 40, 64, 180, 360, 10, 0, 40, 'pmp/bar_front');
  arcBand(bx, by, 38, 67, 180, 360, 10, 40, 41.5, MARBLE);
  box([254, by, 0], [278, 380, 40], 'pmp/bar_front');
  box([252, by, 40], [281, 383, 41.5], MARBLE);
  for (const a of [210, 245, 280, 315]) {
    const sx = bx + 84 * Math.cos(deg(a)), sy = by + 84 * Math.sin(deg(a));
    prism(circle(sx, sy, 8, 12), 0, 1, 'fixture/chrome');
    prism(circle(sx, sy, 1.3, 8), 1, 26, 'fixture/chrome');
    prism(circle(sx, sy, 7.5, 14), 26, 30, 'house/vinyl_burgundy');
  }
}

entities.push({ id: 1, class: 'player_start', origin: [205, 25, 0], angles: [0, 122, 0] });

writeFileSync(new URL('../maps/pmp_basement.json', import.meta.url), serializeMap({ format: MAP_FORMAT, version: MAP_VERSION, name: 'pmp_basement', brushes, entities }));
console.log(`wrote maps/pmp_basement.json: ${brushes.length} brushes, ${entities.length} entities`);
