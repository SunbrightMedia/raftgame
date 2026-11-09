/**
 * maps/laquinta.json: reference 5 (STYLE.md). Run: npm run gen:laquinta
 *
 * Built from measurements of the photo (Depth Pro point cloud in the camera's
 * level frame, rotated 31.8° so the bar wall runs along x; scale checked by
 * the counter at 36", upstairs doors at 80" and railing at 36"):
 *   - bar wall y 415, recessed under a soffit; the upper wall with the mural
 *     overhangs it at y 390; counter front y 394, bar x 290..420; TV hangs
 *     from the soffit edge at x ~347.
 *   - balcony edge along x ~250 (perpendicular to the bar wall), corridor
 *     behind it to x 182; columns at (250,273), (262,389) and (417,389).
 *   - tables at (301,332), (290,274), (374,337), (357,278); tile path from
 *     (270,265) toward (177,343).
 *   - camera at (480,40), eye 136", yaw 121.8°, 4° down.
 * Light sparingly: two spots, one sconce upstairs, one dim dome under the
 * balcony, the TV.
 */
import { MapBuilder } from './lib/build';
import { LQ_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'lq/paint_beige', CARPET = 'lq/carpet', CEIL = 'lq/ceiling', IRON = 'lq/iron', WHITE = 'house/trim_white';
const OAK = 'rec/oak', DOOR = 'house/door_6panel', TOP = 216, UP = 120, W = 8;
const XL = 182, XR = 600, YB = 415, EDGE = 250, SOFF = 390;

// ---- shell
m.box([XL - W, -W, -16], [XR + W, YB + W, 0], CARPET);
m.box([XL - W, -W, TOP], [XR + W, YB + W, TOP + 16], CEIL);
m.box([XL - W, -W, 0], [XR + W, 0, TOP], PAINT);                // front
m.box([XR, 0, 0], [XR + W, YB, TOP], PAINT);                    // right
m.box([XL - W, YB, 0], [XR + W, YB + W, TOP], PAINT);           // back (the bar wall)
m.box([XL - W, 0, 0], [XL, YB, TOP], PAINT);                    // left: corridor wall, both floors
// Doors on the corridor wall: one downstairs at the end of the tile path, two upstairs.
m.box([XL, 322, 0], [XL + 0.5, 358, 80], DOOR, { solid: false, faces: { px: { tex: DOOR } } });
for (const y of [200, 300]) m.box([XL, y, UP], [XL + 0.5, y + 36, UP + 80], DOOR, { solid: false, faces: { px: { tex: DOOR } } });
// Tile path (a thin diagonal overlay) from the atrium toward that door.
{
  const ax = 270, ay = 265, bx = 182, by = 340, w = 34, dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), nx = (-dy / l) * w, ny = (dx / l) * w;
  m.prism([[ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny], [ax + nx, ay + ny]], 0, 0.25, 'mall/tile_diamond_tri');
}

// ---- balcony (upper corridor x 182..250) along the left, perpendicular to the bar wall
m.box([XL, 120, UP - 8], [EDGE, YB, UP], CEIL, { faces: { pz: { tex: CARPET } } });
m.box([EDGE, 120, UP - 24], [EDGE + 2, SOFF, UP], PAINT);                       // fascia
for (const z of [UP - 22, UP - 4]) m.box([EDGE + 2, 120, z], [EDGE + 2.5, SOFF, z + 1], WHITE);
// Railing on the balcony edge: rails, posts, wavy balusters (sine-curved segments).
m.box([EDGE, 120, UP + 34], [EDGE + 2, SOFF, UP + 36], IRON);
for (let y = 120; y < SOFF; y += 64) {
  m.box([EDGE, y, UP], [EDGE + 2, y + 2, UP + 34], IRON);
  m.box([EDGE + 0.4, y + 2, UP + 2], [EDGE + 1.6, Math.min(y + 64, SOFF), UP + 3.5], IRON);
}
for (let y = 126; y < SOFF - 2; y += 5) {
  if ((y - 120) % 64 < 4) continue;
  const n = 10, z0 = UP + 3.5, z1 = UP + 34, amp = 1.6;
  let py = y, pz = z0;
  for (let i = 1; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n, yy = y + amp * Math.sin((Math.PI * 2 * i) / n);
    // the railing runs along y here: segment in the y-z plane, thin in x
    m.prismX([[py - 0.3, pz], [yy - 0.3, z], [yy + 0.3, z], [py + 0.3, pz]], EDGE + 0.6, EDGE + 1.4, IRON);
    py = yy; pz = z;
  }
}

// ---- the overhang: soffit + upper wall (mural) in front of the recessed bar wall
m.box([EDGE, SOFF, UP - 24], [XR, YB, TOP], PAINT);
for (const z of [UP - 22, UP - 4]) m.box([EDGE + 2.5, SOFF - 0.5, z], [XR, SOFF, z + 1], WHITE);
const mx0 = 300, mx1 = 560, mz0 = UP + 8, mz1 = TOP - 8, sx = (mx1 - mx0) / 160, sz = (mz1 - mz0) / 100;
m.box([mx0, SOFF - 0.4, mz0], [mx1, SOFF, mz1], 'lq/mural_tree', { solid: false, faces: { ny: { scale: [sx, sz], offset: [-mx0 / sx, -mz0 / sz] } } });

// ---- columns (slim, two storeys at the balcony corner; one storey at the bar line)
for (const [x, y, top] of [[EDGE, 273, TOP], [262, SOFF - 1, UP - 24], [417, SOFF - 1, UP - 24]] as const) {
  m.cylinder(x, y, 5.5, 0, top, WHITE);
  m.cylinder(x, y, 7, 0, 4, WHITE);
  m.cylinder(x, y, 7, top - 4, top, WHITE);
}

// ---- breakfast bar (x 290..420, counter front y 394) under the soffit
m.box([290, 394, 0], [420, YB, 34], OAK);
m.box([288, 392, 34], [422, YB, 36], 'lq/counter_dark');
m.box([298, 400, 36], [318, 414, 48], IRON, { faces: { ny: { tex: 'fixture/chrome' } } });
m.box([324, 404, 36], [336, 414, 44], 'fixture/chrome');
for (const x of [350, 362, 374]) m.box([x, 406, 36], [x + 9, 414, 56], OAK, { faces: { ny: { tex: 'house/upholstery' } } });
// CRT TV hanging under the soffit edge.
const tx = 331;
m.box([tx, SOFF - 2, 72], [tx + 32, SOFF + 18, 94], IRON);
m.box([tx + 3, SOFF - 2.4, 75], [tx + 29, SOFF - 2, 91], 'lq/tv_screen', { solid: false, faces: { ny: { scale: [26 / 16, 16 / 12], offset: [-(tx + 3) / (26 / 16), -75 / (16 / 12)] } } });
m.box([tx + 14, SOFF + 4, 94], [tx + 18, SOFF + 8, UP - 24], IRON);

// ---- café tables with four chairs each, where the photo has them
const chairs: [number, number][] = [];
const table = (cx: number, cy: number) => {
  m.cylinder(cx, cy, 15, 28, 29.5, OAK);
  m.cylinder(cx, cy, 1.5, 2, 28, IRON);
  m.cylinder(cx, cy, 9, 0, 2, IRON);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = cx + dx * 22, y = cy + dy * 22;
    if (chairs.some(([qx, qy]) => Math.abs(qx - x) < 19 && Math.abs(qy - y) < 19)) continue; // tables this close share the space
    chairs.push([x, y]);
    m.box([x - 8, y - 8, 17], [x + 8, y + 8, 18.5], 'lq/seat');
    for (const [lx, ly] of [[-7, -7], [6, -7], [-7, 6], [6, 6]]) m.box([x + lx, y + ly, 0], [x + lx + 1, y + ly + 1, 17], OAK);
    if (dx) m.box([x + dx * 7, y - 8, 18.5], [x + dx * 8.5, y + 8, 34], OAK);
    else m.box([x - 8, y + dy * 7, 18.5], [x + 8, y + dy * 8.5, 34], OAK);
  }
};
table(301, 332); table(290, 274); table(374, 337); table(357, 278);

// ---- lights, sparingly
for (const x of [330, 400]) {
  m.light([x, 404, UP - 25], { type: 'can', lumens: 650, kelvin: 2900 });
  m.cylinder(x, 404, 3.2, UP - 24.5, UP - 24, 'fixture/potlight', { solid: false });
}
m.cylinder(XL + 3, 260, 4, UP + 62, UP + 70, 'fixture/dome', { solid: false });
m.light([XL + 6, 260, UP + 66], { type: 'bulb', lumens: 350, kelvin: 2800 });
m.cylinder(215, 300, 6, UP - 9.5, UP - 8, 'fixture/dome', { solid: false });
m.light([215, 300, UP - 10], { type: 'dome', lumens: 400, kelvin: 2800 });

// ---- where the photo was taken: a stair landing (floor 88") so the eye is ~136"
m.box([440, 0, 80], [540, 80, 88], CEIL, { faces: { pz: { tex: CARPET } } });
for (let i = 0; i < 11; i++) m.box([540, i * 8, 0], [580, i * 8 + 8, 88 - i * 8], CARPET); // steps down along the front wall
m.start([480, 40, 88], 4.2, 121.8);
m.write('laquinta', LQ_ROOMS, {
  light: { luxelSize: 8 },
  camera: { evComp: -0.5, whiteBalanceK: 3300 },
  fog: { enabled: false },
});
