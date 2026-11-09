/**
 * maps/laquinta.json: reference 5 (STYLE.md), "La Quinta Inn, 2004 — it's
 * supposed to be fun, but everyone is yelling". Run: npm run gen:laquinta
 *
 * A two-storey atrium breakfast area: upper balcony corridor behind a black
 * wrought-iron railing with wavy balusters, round white two-storey columns,
 * a faux-painted tree mural on the upper wall, a breakfast bar with a CRT TV
 * above it and two spotlights scalloping the wall behind it, round café
 * tables on dark hotel carpet, a ceramic tile path by the doors. Light
 * sparingly: two spots, one sconce upstairs, one dim dome in the ground
 * corridor, and the TV's glow.
 */
import { MapBuilder } from './lib/build';
import { LQ_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'lq/paint_beige', CARPET = 'lq/carpet', CEIL = 'lq/ceiling', IRON = 'lq/iron', WHITE = 'house/trim_white';
const OAK = 'rec/oak', DOOR = 'house/door_6panel', TOP = 240, UP = 120, W = 8;

// ---- shell
m.box([-W, -W, -16], [428, 368, 0], CARPET);
m.box([-W, -W, TOP], [428, 368, TOP + 16], CEIL);
m.box([-W, -W, 0], [428, 0, TOP], PAINT);                    // front
m.box([-W, 0, 0], [0, 360, TOP], PAINT);                     // left
m.box([420, 0, 0], [428, 298, TOP], PAINT);                  // right
m.box([-W, 360, 0], [268, 368, TOP], PAINT);                 // back of the corridors
m.box([260, 290, 0], [420, 298, TOP], PAINT);                // back wall behind the breakfast bar
m.box([260, 298, 0], [268, 360, TOP], PAINT);                // corridor end wall
// Ceramic tile path by the doors (a thin overlay on the carpet).
m.box([20, 0, 0], [92, 250, 0.25], 'mall/tile_diamond_tri');

// ---- upper floor: balcony corridor along the back (x 0..260, y 250..360), a soffit over the bar
m.box([0, 250, UP - 8], [260, 360, UP], CEIL, { faces: { pz: { tex: CARPET } } });
m.box([260, 250, UP - 8], [420, 290, UP], CEIL);              // soffit over the breakfast bar
// Fascia band on the balcony edge with two white trim lines.
m.box([0, 248, UP - 12], [420, 250, UP], PAINT);
m.box([0, 247.5, UP - 10], [420, 248, UP - 9], WHITE);
m.box([0, 247.5, UP - 3], [420, 248, UP - 2], WHITE);
// Doors: upstairs and downstairs, on the corridor back wall.
for (const x of [36, 150]) m.box([x, 359.5, UP], [x + 36, 360, UP + 80], DOOR, { solid: false });
for (const x of [30, 180]) m.box([x, 359.5, 0], [x + 36, 360, 80], DOOR, { solid: false });

// ---- railing on the balcony edge (y 249..251, x 0..260): black iron, wavy balusters
const ry0 = 249.6, ry1 = 250.4;
m.box([0, 249, UP + 34], [260, 251, UP + 36], IRON);          // top rail
for (let x = 0; x <= 256; x += 64) {
  m.box([x, 249, UP], [x + 2, 251, UP + 34], IRON);                                   // post
  m.box([x + 2, 249.4, UP + 2], [Math.min(x + 64, 260), 250.6, UP + 3.5], IRON);      // bottom rail, post to post
}
// Each baluster: an S-curve waving sideways, built from 10 slanted segments along a sine.
for (let x = 6; x < 258; x += 5) {
  if (x % 64 < 4) continue;
  const n = 10, z0 = UP + 3.5, z1 = UP + 34, amp = 1.6;
  let px = x, pz = z0;
  for (let i = 1; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n, xx = x + amp * Math.sin((Math.PI * 2 * i) / n);
    m.barXZ(px, pz, xx, z, 0.6, ry0, ry1, IRON);
    px = xx; pz = z;
  }
}

// ---- round white two-storey columns at the balcony edge, with base and capital rings
for (const x of [96, 250]) {
  m.cylinder(x, 240, 8, 0, TOP, WHITE);
  m.cylinder(x, 240, 10, 0, 5, WHITE);
  m.cylinder(x, 240, 10, UP - 14, UP - 10, WHITE);
  m.cylinder(x, 240, 10, TOP - 5, TOP, WHITE);
}

// ---- the mural on the upper back wall above the bar, fitted once
const mx0 = 270, mx1 = 420, mz0 = 130, mz1 = 230, sx = (mx1 - mx0) / 160, sz = (mz1 - mz0) / 100;
m.box([mx0, 289.6, mz0], [mx1, 290, mz1], 'lq/mural_tree', { solid: false, faces: { ny: { scale: [sx, sz], offset: [-mx0 / sx, -mz0 / sz] } } });

// ---- breakfast bar against the back wall
m.box([272, 266, 0], [416, 290, 34], OAK);
m.box([270, 264, 34], [418, 290, 36], 'lq/counter_dark');
m.box([282, 274, 36], [302, 288, 48], IRON, { faces: { ny: { tex: 'fixture/chrome' } } });   // microwave
m.box([308, 278, 36], [320, 288, 44], 'fixture/chrome');                                   // toaster
for (const x of [340, 352, 364]) m.box([x, 280, 36], [x + 9, 288, 56], OAK, { faces: { ny: { tex: 'house/upholstery' } } }); // cereal dispensers
// CRT TV hanging from the soffit edge above the bar, screen toward the room.
m.box([328, 254, 88], [356, 274, 108], IRON, { faces: { ny: { tex: IRON } } });
m.box([331, 253.6, 91], [353, 254, 105], 'lq/tv_screen', { solid: false, faces: { ny: { scale: [22 / 16, 14 / 12], offset: [-331 / (22 / 16), -91 / (14 / 12)] } } });
m.box([340, 274, 104], [344, 290, 108], IRON);                                           // bracket

// ---- café tables with four chairs each
const table = (cx: number, cy: number) => {
  m.cylinder(cx, cy, 15, 28, 29.5, OAK);
  m.cylinder(cx, cy, 1.5, 2, 28, IRON);
  m.cylinder(cx, cy, 9, 0, 2, IRON);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = cx + dx * 22, y = cy + dy * 22;
    m.box([x - 8, y - 8, 17], [x + 8, y + 8, 18.5], 'lq/seat');
    for (const [lx, ly] of [[-7, -7], [6, -7], [-7, 6], [6, 6]]) m.box([x + lx, y + ly, 0], [x + lx + 1, y + ly + 1, 17], OAK);
    // back on the side away from the table
    if (dx) m.box([x + dx * 7, y - 8, 18.5], [x + dx * 8.5, y + 8, 34], OAK);
    else m.box([x - 8, y + dy * 7, 18.5], [x + 8, y + dy * 8.5, 34], OAK);
  }
};
table(150, 130); table(240, 170); table(320, 110); table(345, 205);

// ---- lights, sparingly
m.light([316, 280, UP - 9], { type: 'can', lumens: 650, kelvin: 2900 });   // the two spots scalloping the bar wall (1" below the soffit)
m.light([388, 280, UP - 9], { type: 'can', lumens: 650, kelvin: 2900 });
m.cylinder(316, 280, 3.2, UP - 8.5, UP - 8, 'fixture/potlight', { solid: false });
m.cylinder(388, 280, 3.2, UP - 8.5, UP - 8, 'fixture/potlight', { solid: false });
// Upstairs: one wall sconce between the doors.
m.cylinder(118, 357, 4, UP + 62, UP + 70, 'fixture/dome', { solid: false });
m.light([118, 354, UP + 66], { type: 'bulb', lumens: 350, kelvin: 2800 });
// Ground corridor: one dim dome.
m.cylinder(130, 320, 6, UP - 9.5, UP - 8, 'fixture/dome', { solid: false });
m.light([130, 320, UP - 10], { type: 'dome', lumens: 400, kelvin: 2800 });

// ---- a narrow front balcony to stand on (the photo is taken from upstairs)
m.box([0, 0, UP - 8], [420, 36, UP], CEIL, { faces: { pz: { tex: CARPET } } });
m.box([0, 36, UP + 34], [420, 37.5, UP + 36], IRON);           // its top rail
for (let x = 0; x <= 415; x += 5) m.box([x, 36.4, UP], [x + 0.6, 37.1, UP + 34], IRON); // plain bars to look through

// Where the photo was taken: upstairs on the near side, looking down and across.
m.start([210, 33, UP], 24, 90);
m.write('laquinta', LQ_ROOMS, {
  light: { luxelSize: 8 },
  camera: { evComp: -0.5, whiteBalanceK: 3300 },
  fog: { enabled: false },
});
