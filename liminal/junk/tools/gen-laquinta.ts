/**
 * maps/laquinta.json: reference 5 (STYLE.md). Run: npm run gen:laquinta
 *
 * Measured from the photo with a calibrated camera, not guessed: the lens and
 * tilt come from the photo's vanishing points (focal 2279 px on 1178 wide:
 * ~29° across, 5.3° down), the room axes from the same vanishing lines, and
 * plan positions from where floor-contact pixels' rays meet the floor. Scale:
 * counter 35", door handle 35", doors 34-35" wide, railing 39". The
 * photographer stood on the upper floor across the atrium, leaning over the
 * railing (eye 175" above the lobby floor).
 *
 * Plan (x along the bar wall, y into it):
 *   - corridor wall x 148 under and along the balcony (edge x 260, floor 132,
 *     its underside 100); columns on the edge at y 355 (and further left).
 *   - left hallways (both floors) going -x between y 370 and 442; a door at
 *     x 55..90 on the 442 wall.
 *   - centre hallways (both floors) going +y from y 512 between x 167 and 232;
 *     a white door on their left wall at y 518..554.
 *   - breakfast alcove x 260..433 under an 86" soffit; soffit/mural wall face
 *     y 506, bar wall y 545, counter front y 510 at 35"; TV on the soffit face
 *     at x 334..371; columns at (225, 540) and (436, 498).
 *   - tile under the balcony to x 274 and a strip in front of the counter.
 *   - tables at (319, 427), (330, 350), (420, 346), (414, 424).
 */
import { MapBuilder } from './lib/build';
import { LQ_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'lq/paint_beige', CARPET = 'lq/carpet', CEIL = 'lq/ceiling', IRON = 'lq/iron', WHITE = 'house/trim_white';
const OAK = 'rec/oak', DOOR = 'house/door_6panel', TILE = 'lq/tile', W = 8;
const TOP = 220, UP = 132, UNDER = 100;          // ceiling, upper floor, underside of the upper floor
const CW = 148, EDGE = 260, LH0 = 370, LH1 = 442, HC0 = 167, HC1 = 232, HEND = 640;
const SOFF = 506, HCY = SOFF, BAR = 545, AL1 = 433, SOFFZ = 86, XR = 760, YN = -60;
const DOORS = { solid: false, faces: {} as Record<string, { tex: string }> };
const door = (min: [number, number, number], max: [number, number, number], face: string) =>
  m.box(min, max, DOOR, { ...DOORS, faces: { [face]: { tex: DOOR } } });

// ---- floors and ceiling
m.box([CW, YN, -16], [XR, SOFF, 0], CARPET);                        // lobby carpet
m.box([CW, YN, 0], [274, HCY, 0.25], TILE);                          // tile under the balcony
m.box([274, 490, 0], [AL1 + 8, SOFF, 0.25], TILE);                  // tile strip in front of the counter
m.box([40, LH0, -16], [CW, LH1, 0], CARPET);                         // left hallway
m.box([HC0, HCY, -16], [HC1, HEND, 0], CARPET);                      // centre hallway
m.box([EDGE, SOFF, -16], [AL1, BAR, 0], CARPET);                     // alcove
m.box([CW - W, YN - W, TOP], [XR + W, BAR + W, TOP + 16], CEIL);
m.box([40, LH0, TOP], [CW - W, LH1, TOP + 16], CEIL);
m.box([HC0 - W, BAR + W, TOP], [EDGE, HEND + W, TOP + 16], CEIL);

// ---- outer walls
m.box([CW - W, YN - W, 0], [XR + W, YN, TOP], PAINT);                // near
m.box([XR, YN, 0], [XR + W, SOFF, TOP], PAINT);                     // right
m.box([AL1 + 8, SOFF, 0], [XR, SOFF + W, TOP], PAINT);              // back, right of the alcove
// Corridor wall (both floors), open where the left hallways leave.
m.box([CW - W, YN, 0], [CW, LH0, TOP], PAINT);
m.box([CW - W, LH1, 0], [CW, HCY, TOP], PAINT);
m.box([CW - W, LH0, UNDER], [CW, LH1, UP], PAINT);                  // between the two hallway mouths
m.box([CW - W, HCY, 0], [HC0, HCY + W, TOP], PAINT);                // the jog at the centre hallway
// Left hallways (to x 40).
m.box([40, LH0 - W, 0], [CW - W, LH0, TOP], PAINT);
m.box([40, LH1, 0], [CW - W, LH1 + W, TOP], PAINT);
m.box([40 - W, LH0 - W, 0], [40, LH1 + W, TOP], PAINT);
m.box([40, LH0, UNDER], [CW - W, LH1, UP], CEIL, { faces: { pz: { tex: CARPET } } });
door([55, LH1 - 0.5, 0], [90, LH1, 80], 'ny');
door([52, LH1 - 0.5, UP], [87, LH1, UP + 80], 'ny');
m.box([97, LH1 - 0.6, UP + 56], [105, LH1, UP + 64], 'fixture/chrome');   // room-number sign
// Centre hallways (to y 640).
m.box([HC0 - W, HCY + W, 0], [HC0, HEND, TOP], PAINT);
m.box([HC1, SOFF, 0], [EDGE, HEND, TOP], PAINT);                    // partition: hallway | alcove
m.box([HC0 - W, HEND, 0], [HC1, HEND + W, TOP], PAINT);
m.box([HC0, HCY, UNDER], [HC1, HEND, UP], CEIL, { faces: { pz: { tex: CARPET } } });
door([HC0, 518, 0], [HC0 + 0.5, 554, 80], 'px');
door([HC0, 516, UP], [HC0 + 0.5, 551, UP + 80], 'px');

// Baseboards (white, as in the photo) on the lower walls the camera sees, and door casings.
const BB = 4;
m.box([CW, LH1, 0.25], [CW + 0.6, HCY, BB], WHITE);                  // corridor wall, between the hallways
m.box([CW + 0.6, HCY - 0.6, 0.25], [HC0, HCY, BB], WHITE);           // the jog
m.box([HC0, HCY + W, 0], [HC0 + 0.6, 518 - 2, BB], WHITE);          // centre hallway, left wall
m.box([HC0, 554 + 2, 0], [HC0 + 0.6, HEND, BB], WHITE);
m.box([40, LH1 - 0.6, 0], [55 - 2, LH1, BB], WHITE);                // left hallway, door wall
m.box([90 + 2, LH1 - 0.6, 0], [CW - W, LH1, BB], WHITE);
m.box([AL1 + 8, SOFF - 0.6, 0], [XR, SOFF, BB], WHITE);             // back wall right of the alcove
for (const [y0, y1, z] of [[518, 554, 0], [516, 551, UP]] as const) {                      // centre hallway doors
  m.box([HC0, y0 - 2, z], [HC0 + 0.8, y0, z + 82], WHITE);
  m.box([HC0, y1, z], [HC0 + 0.8, y1 + 2, z + 82], WHITE);
  m.box([HC0, y0, z + 80], [HC0 + 0.8, y1, z + 82], WHITE);
}
for (const [x0, x1, z] of [[55, 90, 0], [52, 87, UP]] as const) {                          // left hallway doors
  m.box([x0 - 2, LH1 - 0.8, z], [x0, LH1, z + 82], WHITE);
  m.box([x1, LH1 - 0.8, z], [x1 + 2, LH1, z + 82], WHITE);
  m.box([x0, LH1 - 0.8, z + 80], [x1, LH1, z + 82], WHITE);
}

// ---- the balcony (upper floor x 148..260) and its railing
m.box([CW, YN, UNDER], [EDGE, HCY, UP], CEIL, { faces: { pz: { tex: CARPET }, px: { tex: PAINT } } });
for (const z of [UNDER + 4, UP - 4]) m.box([EDGE, YN, z], [EDGE + 0.6, SOFF, z + 1], WHITE);
m.box([EDGE - 10, YN, 209], [EDGE + 2, SOFF, TOP], PAINT);         // header beam along the edge
m.box([EDGE - 8, SOFF - 8, UP], [EDGE + 4, SOFF, 209], PAINT);       // corner pier
const COLS = [53, 204, 355];
for (const y of COLS) {
  m.cylinder(EDGE, y, 7, 0, 209, WHITE);
  m.cylinder(EDGE, y, 9, 0, 5, WHITE);
}
// Railing between the columns and the pier: top rail, posts, wavy balusters.
const spans: [number, number][] = [[YN, COLS[0] - 9], ...COLS.slice(0, -1).map((y, i) => [y + 9, COLS[i + 1] - 9] as [number, number]), [COLS[COLS.length - 1] + 9, SOFF - 8]];
for (const [a, b] of spans) {
  m.box([EDGE - 2, a, UP + 37], [EDGE, b, UP + 39], IRON);
  m.box([EDGE - 1.6, a, UP + 2], [EDGE - 0.4, b, UP + 3.5], IRON);
  for (let y = a; y < b - 2; y += 48) m.box([EDGE - 2, y, UP + 3.5], [EDGE, y + 2, UP + 37], IRON);
  for (let y = a + 6; y < b - 3; y += 5) {
    if ((y - a) % 48 < 4) continue;
    const n = 10, z0 = UP + 3.5, z1 = UP + 37, amp = 1.6;
    let py = y, pz = z0;
    for (let i = 1; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n, yy = y + amp * Math.sin((Math.PI * 2 * i) / n);
      m.prismX([[py - 0.3, pz], [yy - 0.3, z], [yy + 0.3, z], [py + 0.3, pz]], EDGE - 1.4, EDGE - 0.6, IRON);
      py = yy; pz = z;
    }
  }
}

// ---- breakfast alcove under the soffit, mural wall above
m.box([EDGE, SOFF, SOFFZ], [AL1 + 8, BAR + W, TOP], PAINT);          // soffit + mural wall
m.box([EDGE, BAR, 0], [AL1 + 8, BAR + W, SOFFZ], PAINT);             // bar wall
m.box([AL1, SOFF, 0], [AL1 + 8, BAR, SOFFZ], PAINT);                 // alcove right end
for (const z of [126, 118, 97]) {
  const tv = z > 89 && z < 121;                                       // trims stop at the TV's sides
  m.box([EDGE + 4, SOFF - 0.6, z], [tv ? 334 : XR, SOFF, z + 1], WHITE);
  if (tv) m.box([371, SOFF - 0.6, z], [XR, SOFF, z + 1], WHITE);
}
const mx0 = 266, mx1 = 510, mz0 = 128, mz1 = 206, sx = (mx1 - mx0) / 160, sz = (mz1 - mz0) / 100;
m.box([mx0, SOFF - 0.4, mz0], [mx1, SOFF, mz1], 'lq/mural_tree', { solid: false, faces: { ny: { scale: [sx, sz], offset: [-mx0 / sx, -mz0 / sz] } } });
m.cylinder(225, 540, 7, 0, UNDER, WHITE);                              // at the centre hallway's mouth
m.cylinder(225, 540, 9, 0, 5, WHITE);
m.cylinder(436, 498, 7, 0, 209, WHITE);                                // at the alcove's right end
m.cylinder(436, 498, 9, 0, 5, WHITE);
// Counter against the bar wall, end to end in the alcove.
m.box([EDGE, 512, 0], [AL1, BAR, 33], OAK);
m.box([EDGE, 510, 33], [AL1, BAR, 35], 'lq/counter_dark');
m.box([270, 528, 35], [290, 543, 47], IRON, { faces: { ny: { tex: 'fixture/chrome' } } });   // microwave
m.box([272, 530, 47], [288, 543, 55], 'fixture/chrome');                                  // toaster oven
m.box([300, 532, 35], [318, 544, 41], OAK);                                               // bread baskets
for (const x of [340, 356, 372]) m.box([x, 534, 35], [x + 12, 544, 47], OAK, { faces: { ny: { tex: 'house/upholstery' } } });
m.box([385, 520, 35], [420, 540, 38], IRON);                                              // waffle iron tray
// CRT TV on the soffit face.
const tx = 334;
m.box([tx, 488, 89], [tx + 37, SOFF, 121], IRON);
m.box([tx + 4, 487.6, 93], [tx + 33, 488, 117], 'lq/tv_screen', { solid: false, faces: { ny: { scale: [29 / 16, 24 / 12], offset: [-(tx + 4) / (29 / 16), -93 / (24 / 12)] } } });
m.box([tx + 12, 492, 86], [tx + 25, SOFF, 89], IRON);

// ---- café tables with chairs, where the photo has them
const chairs: [number, number][] = [];
const table = (cx: number, cy: number) => {
  m.cylinder(cx, cy, 18, 28.5, 30, OAK);
  m.cylinder(cx, cy, 1.5, 2, 28.5, IRON);
  m.cylinder(cx, cy, 10, 0, 2, IRON);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const x = cx + dx * 25, y = cy + dy * 25;
    if (chairs.some(([qx, qy]) => Math.abs(qx - x) < 19 && Math.abs(qy - y) < 19)) continue;
    chairs.push([x, y]);
    m.box([x - 8, y - 8, 17], [x + 8, y + 8, 18.5], 'lq/seat');
    for (const [lx, ly] of [[-7, -7], [6, -7], [-7, 6], [6, 6]]) m.box([x + lx, y + ly, 0], [x + lx + 1, y + ly + 1, 17], OAK);
    if (dx) m.box([x + dx * 7, y - 8, 18.5], [x + dx * 8.5, y + 8, 34], OAK);
    else m.box([x - 8, y + dy * 7, 18.5], [x + 8, y + dy * 8.5, 34], OAK);
  }
};
table(319, 427); table(330, 350); table(420, 346); table(414, 424);

// ---- lights, as in the photo: two spots on the bar wall, the big sconce upstairs,
// the left hallway's ceiling light, a dim one under the balcony.
for (const x of [300, 395]) {
  m.light([x, 524, SOFFZ - 1], { type: 'can', lumens: 650, kelvin: 2900 });
  m.cylinder(x, 524, 3.2, SOFFZ - 0.5, SOFFZ, 'fixture/potlight', { solid: false });
}
m.cylinder(CW + 3, 475, 5, UP + 72, UP + 82, 'fixture/dome', { solid: false });
m.light([CW + 7, 475, UP + 77], { type: 'bulb', lumens: 500, kelvin: 2800 });
m.cylinder(110, 406, 6, UNDER - 1.5, UNDER, 'fixture/dome', { solid: false });
m.light([110, 406, UNDER - 2], { type: 'dome', lumens: 500, kelvin: 2800 });
m.cylinder(205, 470, 6, UNDER - 1.5, UNDER, 'fixture/dome', { solid: false });
m.light([205, 470, UNDER - 2], { type: 'dome', lumens: 300, kelvin: 2800 });

// ---- where the photo was taken: the upper floor on the near side, at its railing,
// with a stair down to the lobby along the right wall (out of the photo's view).
const LZ = 127, LX = 684, LY = 16;
m.box([LX, YN, LZ - 8], [XR, LY, LZ], CEIL, { faces: { pz: { tex: CARPET } } });
m.box([LX - 2, YN, LZ + 36], [LX, LY, LZ + 38], IRON);
m.box([LX, LY, LZ + 36], [700, LY + 2, LZ + 38], IRON);
for (const y of [YN + 2, -20, 12]) m.box([LX - 2, y, LZ], [LX, y + 2, LZ + 36], IRON);
m.box([LX - 2, LY, LZ], [LX, LY + 2, LZ + 38], IRON);
const steps = 16, rise = LZ / steps;
for (let i = 0; i < steps - 1; i++) {
  const y0 = LY + i * 10;
  m.box([720, y0, 0], [XR, y0 + 10, Math.round((LZ - (i + 1) * rise) * 100) / 100], CARPET);
}
m.box([700, LY, LZ - 8], [720, LY + 2, LZ + 38], IRON);   // stair rail end
m.start([700, 0, LZ], 5.3, 131.8);
m.write('laquinta', LQ_ROOMS, {
  light: { luxelSize: 10 },
  camera: { evComp: -0.5, whiteBalanceK: 3300 },
  fog: { enabled: false },
});
