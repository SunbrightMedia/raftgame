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
import { paintByRoom } from './lib/roomPaint';
import { PMP_ROOMS } from './lib/pmpRooms';

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
/** A rectangle with rounded corners, as a convex outline (for soft furniture). */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, seg = 3): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= seg; i++) {
    const a = deg(a0 + (90 * i) / seg);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

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
    prism([p(rIn, t0), o0, o1, p(rIn, t1)], z0, z1, tex, { faces: { ...faces, side1: { ...(faces.side ?? {}), ...(faces.side1 ?? {}), offset: [off, faces.side?.offset?.[1] ?? 0] } } });
    along += chord;
  }
}

/** A laminate counter top: printed top, edge strip with its seam line on every side. */
function counterTop(min: V3, max: V3): void {
  const edge = { tex: 'house/laminate_edge', offset: [0, -min[2]] as [number, number] };
  box(min, max, 'house/laminate_marble', { faces: { px: edge, nx: edge, py: edge, ny: edge } });
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

function potLight(x: number, y: number, ceiling: number, lumens = 650): void {
  // A white trim ring with a round lens: the lens is a light source (self-lit, blows out).
  prism(circle(x, y, 3.9, 20), ceiling - 0.4, ceiling, TRIM, { solid: false });
  prism(circle(x, y, 2.8, 20), ceiling - 0.55, ceiling - 0.4, 'fixture/potlight', { solid: false });
  // 65 W BR30 incandescent flood (≈650 lm, 2700 K) in a 6" recessed can: see engine/light/units.ts.
  entities.push({ id: 5000 + entities.length, class: 'light', origin: [x, y, ceiling - 3], props: { type: 'can', lumens, kelvin: 2700 } });
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
  // Left wall, with the den opening y 150..200 (50" wide, h 84) near the back corner.
  box([-6, 0, 0], [0, 150, 96], MINT, { faces: { py: jamb } });
  box([-6, 150, 84], [0, 200, 96], MINT, { faces: { nz: jamb } });
  box([-6, 200, 0], [0, 242, 96], MINT, { faces: { ny: jamb } });
  // Back wall: door x 24..56 (h 80) and the wide opening x 92..188 (h 88), both into the pink room.
  box([0, 216, 0], [24, 222, 96], MINT, { faces: { px: jamb } });
  box([24, 216, 80], [56, 222, 96], MINT, { faces: { nz: jamb } });
  box([56, 216, 0], [92, 222, 96], MINT, { faces: { nx: jamb, px: jamb } });
  box([92, 216, 88], [188, 222, 96], MINT, { faces: { nz: jamb } });
  box([188, 216, 0], [240, 222, 96], MINT, { faces: { nx: jamb } });
  // Bulkhead along the top of the left wall, over the den opening.
  box([0, 0, 88], [14, 216, 96], MINT, { faces: { nz: { tex: CEIL } } });

  // The door, closed, white six-panel, brass knob on both sides.
  // The door texture is drawn for a 36" door; squeeze it onto this 32" one.
  const dS = 32 / 36;
  box([24, 218, 0], [56, 219.75, 80], 'house/door_6panel', { faces: { ny: { scale: [dS, 1], offset: [-24 / dS, 0] }, py: { scale: [dS, 1], offset: [56 / dS, 0] } } });
  // Knob on the latch stile, ~2.4" from the edge at 36" high, with a round-ish rosette; both sides.
  for (const [face, dir] of [[218, -1], [219.75, 1]] as const) {
    box([52.4, Math.min(face, face + dir * 0.3), 34.8], [54.8, Math.max(face, face + dir * 0.3), 37.2], 'pmp/brass');
    box([52.9, Math.min(face + dir * 0.3, face + dir * 2.2), 35.3], [54.3, Math.max(face + dir * 0.3, face + dir * 2.2), 36.7], 'pmp/brass');
  }

  casingY(150, 200, 84, 0, 1);         // den opening, blue side
  casingX(24, 56, 80, 216, -1);         // door, blue side
  casingX(92, 188, 88, 216, -1);        // wide opening, blue side
  // Almond rocker switch plates at 48".
  box([0, 116, 46], [0.2, 119, 50.5], 'house/switchplate', { faces: { px: { offset: [-116, -46] } } });
  box([0.2, 117.1, 47.6], [0.65, 117.9, 49], 'pmp/switch_toggle'); // the toggle sticks out
  box([64, 215.8, 46], [67, 216, 50.5], 'house/switchplate', { faces: { ny: { offset: [-64, -46] } } });
  box([65.1, 215.35, 47.6], [65.9, 215.8, 49], 'pmp/switch_toggle');

  baseboards(0, 0, 240, 216, [
    { side: 'w', from: 147, to: 203 }, { side: 'n', from: 21, to: 59 }, { side: 'n', from: 89, to: 191 },
  ]);
  // Cans around the perimeter, ~30" off the walls, so each throws a scallop up the wall.
  for (const [x, y] of [[30, 40], [30, 110], [210, 40], [210, 110], [210, 180], [120, 186], [120, 40]]) potLight(x, y, 96);

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
  casingY(150, 200, 84, -6, -1);
  baseboards(-150, 100, -6, 236, [{ side: 'e', from: 147, to: 203 }, { side: 'w', from: 113, to: 223 }]);

  // Sofa along the far (left) wall, built soft: rounded corners in plan,
  // separate cushions with gaps and crowned tops, arms lower than the back.
  prism(roundRect(-150, 113, -120, 223, 2), 0, 9, FABRIC);
  for (const [y0, y1] of [[113, 121], [215, 223]]) {
    prism(roundRect(-150, y0, -119, y1, 3.5), 9, 21, FABRIC);
    prism(roundRect(-149, y0 + 1, -120, y1 - 1, 2.5), 21, 23, FABRIC);
  }
  for (let i = 0; i < 3; i++) {
    const y0 = 121.5 + i * 31.2, y1 = y0 + 30.2;
    prism(roundRect(-142, y0, -121, y1, 3), 9, 15, FABRIC);         // seat cushion
    prism(roundRect(-141, y0 + 1.2, -122, y1 - 1.2, 2.5), 15, 16.5, FABRIC); // its crown
    prism(roundRect(-150, y0, -142.5, y1, 2.5), 9, 29, FABRIC);     // back cushion
    prism(roundRect(-149.5, y0 + 1.2, -143.5, y1 - 1.2, 2), 29, 31, FABRIC);
  }
  // Round ottoman: striped band below a green cushion.
  prism(circle(-90, 168, 17, 24), 0, 11, 'house/ottoman_band', { faces: { pz: { tex: FABRIC } } });
  prism(circle(-90, 168, 17.5, 24), 11, 16, FABRIC);
  potLight(-80, 140, 92, 475); // 50 W BR30
  potLight(-80, 200, 92, 475);
}

// ------------------------------------------------------------------ pink bar room
// Behind the back wall, wider than its opening so the door also leads here:
// inner x 6..300, y 222..420, tray ceiling 112 with a dropped soffit
// (z 92..98) around the edge and cove lights hidden on top of it.
{
  box([6, 222, -16], [300, 420, 0], PINK);
  box([92, 216, -16], [188, 222, 0], PINK);  // wide opening threshold
  box([24, 216, -16], [56, 222, 0], PINK);   // door threshold
  box([0, 222, 112], [306, 426, 128], CEIL);
  box([0, 222, 0], [6, 420, 112], WARM);
  box([300, 216, 0], [306, 426, 112], WARM);
  box([0, 420, 0], [300, 426, 112], WARM);
  box([246, 216, 0], [300, 222, 112], WARM);
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
  // Cove: incandescent rope light hidden on the soffit, 14" below the tray
  // ceiling: the usual 90s cove product, ~30 lm per foot at ~2600 K. One
  // up-facing emitter per foot.
  const cove = (x: number, y: number) => entities.push({ id: 5000 + entities.length, class: 'light', origin: [x, y, SZ1 + 1], props: { type: 'up', lumens: 30, kelvin: 2600 } });
  for (let x = 36; x <= 270; x += 12) { cove(x, 243); cove(x, 399); }
  for (let y = 258; y <= 384; y += 12) { cove(33, y); cove(273, y); }
  for (const [x, y] of [[70, 290], [150, 290], [230, 290], [70, 350], [150, 350], [230, 350]]) potLight(x, y, 112);

  // Tall display cabinet on the back wall: orange wood, frosted glass, gold lines.
  box([120, 404, 0], [156, 420, 84], WOOD, { faces: { ny: { tex: 'house/cabinet_glass', offset: [-120, 0] } } });
  // Kitchenette run in the back-right corner.
  box([200, 396, 0], [300, 420, 35], WOOD);
  counterTop([200, 394, 35], [300, 420, 36.5]);
  box([200, 408, 54], [300, 420, 86], WOOD);

  // Curved L-shaped bar, its curve facing the openings, stools on that side.
  const bx = 214, by = 336;
  arcBand(bx, by, 40, 64, 180, 360, 10, 0, 40, 'pmp/bar_front');
  arcBand(bx, by, 38, 67, 180, 360, 10, 40, 41.5, MARBLE, { side: { tex: 'house/laminate_edge', offset: [0, -40] } });
  box([254, by, 0], [278, 380, 40], 'pmp/bar_front');
  counterTop([252, by, 40], [281, 383, 41.5]);
  for (const a of [210, 245, 280, 315]) {
    const sx = bx + 84 * Math.cos(deg(a)), sy = by + 84 * Math.sin(deg(a));
    prism(circle(sx, sy, 8, 12), 0, 1, 'fixture/chrome');
    prism(circle(sx, sy, 1.3, 8), 1, 26, 'fixture/chrome');
    prism(circle(sx, sy, 7.5, 14), 26, 30, 'house/vinyl_burgundy');
  }
}

entities.push({ id: 1, class: 'player_start', origin: [205, 25, 0], angles: [0, 122, 0] });

// Shared walls: each side takes the paint of the room it faces.
const repainted = paintByRoom(brushes, PMP_ROOMS);
writeFileSync(new URL('../maps/pmp_basement.json', import.meta.url), serializeMap({
  format: MAP_FORMAT, version: MAP_VERSION, name: 'pmp_basement', brushes, entities,
  // This room's mood (STYLE.md: residential = moody and warm, never sterile).
  settings: {
    light: { luxelSize: 8 },
    // The reference is underexposed: moody comes from the camera, not weaker bulbs
    // (auto exposure would just compensate for dimmer lamps).
    camera: { evComp: -0.8, whiteBalanceK: 3300, tint: 1 },
    fog: { enabled: true, color: '#3a2a20', luminance: 0.6, near: 120, far: 2600 },
  },
}));
console.log(`wrote maps/pmp_basement.json: ${brushes.length} brushes, ${entities.length} entities, ${repainted} wall faces repainted per room`);
