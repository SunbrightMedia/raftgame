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
const WOOD = 'house/wood_orange', MARBLE = 'house/laminate_marble';

// ------------------------------------------------------------------ blue room
// Inner x 0..240, y 0..216, ceiling 96. Back wall (north) y 216..222.
{
  // Blue floor: everywhere except the pink opening's threshold.
  box([-16, -16, -16], [256, 216, 0], BLUE);
  box([-16, 216, -16], [152, 222, 0], BLUE);
  box([232, 216, -16], [256, 222, 0], BLUE);
  box([-16, -16, 96], [256, 222, 112], CEIL, { faces: { py: { tex: WARM } } }); // its north edge shows above the pink opening
  box([-16, -16, 0], [256, 0, 96], MINT);       // south
  box([-16, 0, 0], [0, 216, 96], MINT);         // west
  box([240, 0, 0], [256, 222, 96], MINT);       // east
  // Back wall, split around: den opening x 24..72 (h 84), door 104..140 (closed), pink opening 152..232 (h 88).
  const jamb = { tex: TRIM };
  box([0, 216, 0], [24, 222, 96], MINT, { faces: { px: jamb } });
  box([24, 216, 84], [72, 222, 96], MINT, { faces: { nz: jamb } });
  box([72, 216, 0], [152, 222, 96], MINT, { faces: { nx: jamb, px: jamb } });
  box([152, 216, 88], [232, 222, 96], MINT, { faces: { nz: jamb } });
  box([232, 216, 0], [240, 222, 96], MINT, { faces: { nx: jamb } });
  // A bulkhead along the back wall on the left, like the photo's ceiling beam.
  box([0, 200, 88], [100, 216, 96], MINT, { faces: { nz: { tex: CEIL } } });

  // The door that leads nowhere: there's only wall behind it.
  box([104, 215.7, 0], [140, 216, 80], 'house/door_6panel', { faces: { ny: { offset: [-104, 0] } } });
  box([135, 213.6, 35], [137, 215.7, 37.5], 'pmp/brass'); // knob
  casingX(104, 140, 80, 216, -1);
  casingX(24, 72, 84, 216, -1);
  casingX(152, 232, 88, 216, -1);
  // Almond rocker switch plates at 48", beside the openings.
  box([77, 215.8, 46], [80, 216, 50.5], 'house/switchplate', { faces: { ny: { offset: [-77, -46] } } });
  box([97, 215.8, 46], [100, 216, 50.5], 'house/switchplate', { faces: { ny: { offset: [-97, -46] } } });

  baseboards(0, 0, 240, 216, [
    { side: 'n', from: 21, to: 75 }, { side: 'n', from: 101, to: 143 }, { side: 'n', from: 149, to: 235 },
  ]);
  for (const [x, y] of [[60, 60], [180, 60], [60, 156], [180, 156]]) potLight(x, y, 96);

  // The pink carpet spills through the opening in a big curve: the part of a
  // circle (through the opening's left jamb) that lies inside the blue room.
  // A 1/4" overlay on the blue carpet, so the edge reads like a carpet seam.
  const cx = 300, cy = 250, R = Math.hypot(152 - cx, 216 - cy);
  const arc: [number, number][] = [];
  const aStart = Math.atan2(216 - cy, 152 - cx), aEnd = Math.atan2(cy - Math.sqrt(R * R - (240 - cx) ** 2) - cy, 240 - cx);
  for (let i = 0; i <= 14; i++) {
    const a = aStart + ((aEnd - aStart) * i) / 14;
    arc.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  prism([...arc, [240, 216]], 0, 0.25, PINK, { solid: false });
}

// ------------------------------------------------------------------ fern den
// Behind the left opening: inner x -40..96, y 222..372, ceiling 92. Same blue
// carpet; it reads green because of its furniture, not its light.
{
  box([-46, 222, -16], [102, 378, 0], BLUE);
  box([-46, 222, 92], [102, 378, 108], CEIL);
  box([-46, 222, 0], [-40, 372, 92], MINT);
  box([96, 222, 0], [102, 372, 92], MINT);
  box([-46, 372, 0], [102, 378, 92], MINT);
  // The den's side of the back wall (y 222) is the blue room's wall pieces; add casing on this side too.
  box([-46, 216, 0], [0, 222, 92], MINT); // den's south wall west of the blue room
  casingX(24, 72, 84, 222, 1);
  baseboards(-40, 222, 96, 372, [{ side: 's', from: 21, to: 75 }, { side: 'w', from: 254, to: 346 }]); // stops behind the sofa

  // Green sofa along the west wall: base, back, arms.
  const F = 'pmp/fabric_green';
  box([-40, 262, 0], [-10, 338, 17], F);
  box([-40, 262, 17], [-30, 338, 32], F);
  box([-40, 254, 0], [-8, 262, 25], F);
  box([-40, 338, 0], [-8, 346, 25], F);
  // Round ottoman: patterned band below a green cushion.
  prism(circle(22, 300, 17, 20), 0, 11, 'house/ottoman_band', { faces: { pz: { tex: F } } });
  prism(circle(22, 300, 17.5, 20), 11, 16, F);
  potLight(28, 300, 92, 1.8);
  potLight(28, 340, 92, 1.4);
}

// ------------------------------------------------------------------ pink bar room
// Behind the right opening: inner x 150..390, y 222..420, tray ceiling 104
// with a dropped soffit (z 92..98) around the edge and cove lights on top of it.
{
  box([150, 222, -16], [390, 420, 0], PINK);   // room floor (walls stand outside it)
  box([152, 216, -16], [232, 222, 0], PINK);   // the threshold
  box([144, 222, 104], [396, 426, 120], CEIL);
  box([144, 222, 0], [150, 420, 104], WARM);
  box([390, 222, 0], [396, 420, 104], WARM);
  box([144, 420, 0], [396, 426, 104], WARM);
  box([256, 216, 0], [396, 222, 104], WARM); // south wall beyond the blue room
  casingX(152, 232, 88, 222, 1, 2); // only 2" between this opening and the west wall
  // Baseboards stop where cabinets stand against the wall.
  baseboards(150, 222, 390, 420, [
    { side: 's', from: 150, to: 234 }, { side: 'n', from: 176, to: 212 }, { side: 'n', from: 300, to: 390 }, { side: 'e', from: 396, to: 420 },
    { side: 'w', from: 222, to: 222.8 },
  ]);

  // Soffit band and its hidden cove lights.
  const SZ0 = 92, SZ1 = 98;
  box([150, 222, SZ0], [390, 246, SZ1], WARM);
  box([150, 396, SZ0], [390, 420, SZ1], WARM);
  box([150, 246, SZ0], [174, 396, SZ1], WARM);
  box([366, 246, SZ0], [390, 396, SZ1], WARM);
  const cove = (x: number, y: number) => entities.push({ id: 5000 + entities.length, class: 'light', origin: [x, y, SZ1 + 2], props: { color: '#ffd9a8', intensity: 0.9, fifty: 30, emit: 'up' } });
  for (let x = 186; x <= 354; x += 42) { cove(x, 243); cove(x, 399); }
  for (let y = 270; y <= 372; y += 34) { cove(177, y); cove(363, y); }
  for (const [x, y] of [[230, 290], [310, 290], [230, 350], [310, 350]]) potLight(x, y, 104, 1.6);

  // Tall display cabinet: orange wood, frosted glass, thin gold lines.
  box([176, 404, 0], [212, 420, 84], WOOD, { faces: { ny: { tex: 'house/cabinet_glass', offset: [-176, 0] } } });
  // Kitchenette run on the back wall: lower cabinets with laminate marble, upper cabinets.
  box([300, 396, 0], [390, 420, 35], WOOD);
  box([300, 394, 35], [390, 420, 36.5], MARBLE);
  box([300, 408, 54], [390, 420, 86], WOOD);

  // The curved L-shaped bar: a half ring (open to the north) plus a straight leg.
  const bx = 270, by = 318;
  arcBand(bx, by, 40, 64, 180, 360, 10, 0, 40, 'pmp/bar_front');
  arcBand(bx, by, 38, 67, 180, 360, 10, 40, 41.5, MARBLE);
  box([310, by, 0], [334, 380, 40], 'pmp/bar_front');
  box([308, by, 40], [337, 383, 41.5], MARBLE);
  // Chrome stools with burgundy vinyl seats around the curve.
  for (const a of [215, 250, 290, 325]) {
    const sx = bx + 84 * Math.cos(deg(a)), sy = by + 84 * Math.sin(deg(a));
    prism(circle(sx, sy, 8, 12), 0, 1, 'fixture/chrome');
    prism(circle(sx, sy, 1.3, 8), 1, 26, 'fixture/chrome');
    prism(circle(sx, sy, 7.5, 14), 26, 30, 'house/vinyl_burgundy');
  }
}

entities.push({ id: 1, class: 'player_start', origin: [52, 34, 0], angles: [0, 62, 0] });

writeFileSync(new URL('../maps/pmp_basement.json', import.meta.url), serializeMap({ format: MAP_FORMAT, version: MAP_VERSION, name: 'pmp_basement', brushes, entities }));
console.log(`wrote maps/pmp_basement.json: ${brushes.length} brushes, ${entities.length} entities`);
