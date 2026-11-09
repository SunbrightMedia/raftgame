/**
 * maps/rec_room.json: reference 4 (STYLE.md), the trophy room with the
 * arcade window. Run: npm run gen:rec
 *
 * A green-beige institutional room: high display case built into the wall,
 * a freestanding trophy case, a flush door, an oak cabinet, and a long
 * chest-height window of white turned balusters into a dark arcade lit only
 * by purple neon and screens. Light sparingly: two dim troffers here, the
 * neon there.
 */
import { MapBuilder } from './lib/build';
import { REC_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'rec/paint_green', FLOOR = 'rec/vinyl_pale', CEIL = 'office/ceiling', TRIM = 'commercial/cove_base_plum';
const DARK = 'arcade/paint_dark', OAK = 'rec/oak', DWOOD = 'rec/dark_wood', WHITE = 'house/trim_white', GOLD = 'rec/gold';
const H = 108, W = 8;

// ---- the trophy room: x 0..240, y 0..300
m.box([-W, -W, -16], [248, 308, 0], FLOOR);
m.box([-W, -W, H], [248, 308, H + 16], CEIL);
m.box([-W, -W, 0], [248, 0, H], PAINT);                 // front (behind the camera)
m.box([-W, 0, 0], [0, 300, H], PAINT);                  // left
m.box([-W, 300, 0], [248, 308, H], PAINT);              // back wall (the photo's left wall)
// Right wall (x 240..248) with the long baluster window: y 60..280, z 36..72.
m.box([240, 0, 0], [248, 60, H], PAINT);
m.box([240, 280, 0], [248, 300, H], PAINT);
m.box([240, 60, 0], [248, 280, 36], PAINT);
m.box([240, 60, 72], [248, 280, H], PAINT);
// Turned balusters: a square foot, a vase, a neck, a square head; white, every 12".
for (let y = 66; y <= 274; y += 12) {
  const x = 244;
  m.box([x - 1.6, y - 1.6, 36], [x + 1.6, y + 1.6, 41], WHITE);
  m.cylinder(x, y, 1.2, 41, 44, WHITE);
  m.cylinder(x, y, 1.75, 44, 54, WHITE);
  m.cylinder(x, y, 1.0, 54, 64, WHITE);
  m.cylinder(x, y, 1.4, 64, 67, WHITE);
  m.box([x - 1.6, y - 1.6, 67], [x + 1.6, y + 1.6, 72], WHITE);
}
// Cove base (commercial: dark rubber, STYLE.md).
m.box([0, 0, 0], [240, 0.5, 4], TRIM);
m.box([0, 0.5, 0], [0.5, 299.5, 4], TRIM);
for (const [a, b] of [[0, 30], [78, 196], [236, 240]]) m.box([a, 299.5, 0], [b, 300, 4], TRIM); // not behind the case and cabinet
m.box([239.5, 0.5, 0], [240, 60, 4], TRIM);
m.box([239.5, 280, 0], [240, 299.5, 4], TRIM);

// High display case built into the top of the back wall: open front (no glass
// in this renderer), dark inside, mullions every 40".
m.box([6, 296, 74], [170, 300, 104], 'rec/case_back');
m.box([6, 286, 72], [170, 300, 74], PAINT);              // bottom ledge
m.box([6, 286, 104], [170, 300, 108], PAINT);            // head
for (let x = 6; x <= 166; x += 40) m.box([x, 286, 74], [x + 4, 296, 104], PAINT);
for (const [x, h] of [[18, 10], [26, 14], [52, 9], [64, 12], [98, 15], [108, 8], [136, 11], [150, 13]] as const) {
  m.cylinder(x, 292, 1.6, 74, 74 + h * 0.3, GOLD);
  m.cylinder(x, 292, 0.6, 74 + h * 0.3, 74 + h * 0.8, GOLD);
  m.cylinder(x, 292, 2.2, 74 + h * 0.8, 74 + h, GOLD);
}

// Freestanding trophy case: dark base and cap, corner posts, two shelves, trophies.
const tx0 = 30, tx1 = 78, ty0 = 282, ty1 = 300;   // stands below the high case (its ledge is at 72)
m.box([tx0, ty0, 0], [tx1, ty1, 12], DWOOD);
m.box([tx0, ty0, 62], [tx1, ty1, 70], DWOOD);
m.box([tx0 + 1, ty1 - 1, 12], [tx1 - 1, ty1, 62], 'rec/case_back');
for (const x of [tx0, tx1 - 1]) for (const y of [ty0, ty1 - 1]) m.box([x, y, 12], [x + 1, y + 1, 62], 'fixture/chrome');
for (const z of [29, 45]) m.box([tx0 + 1, ty0 + 1, z], [tx1 - 1, ty1 - 1, z + 0.5], 'fixture/chrome');
for (const z of [12, 29.5, 45.5]) for (let i = 0; i < 5; i++) {
  const x = tx0 + 6 + i * 9, y = 290 + (i % 2) * 3, h = 8 + ((i * 7 + z) % 5);
  m.cylinder(x, y, 2, z, z + 1.5, GOLD);
  m.cylinder(x, y, 0.6, z + 1.5, z + h * 0.6, GOLD);
  m.cylinder(x, y, 2.2, z + h * 0.6, z + h, GOLD);
}

// Flush door painted the wall colour, with a small lever.
m.box([150, 299.5, 0], [186, 300, 82], 'rec/door', { solid: false });
m.box([180, 298.6, 38], [183.5, 299.5, 39.2], 'fixture/chrome', { solid: false });
// Oak cabinet near the corner.
m.box([196, 280, 0], [236, 300, 48], OAK);

// Drop ceiling: two dim troffers and one dark tile.
const troffer = (x0: number, y0: number) => m.box([x0, y0, H - 1], [x0 + 24, y0 + 48, H], 'mall/troffer', { solid: false, faces: { nz: { offset: [-x0, y0 + 48] } } });
troffer(60, 96);
troffer(156, 168);
m.box([150, 236, H - 0.6], [174, 284, H], 'rec/ceiling_dark', { solid: false });

// ---- the arcade beyond the window: x 248..560, dark, neon and screens
m.box([248, -W, -16], [568, 308, 0], 'mall/arcade_carpet_dark');
m.box([248, -W, H], [568, 308, H + 16], DARK);
m.box([248, -W, 0], [568, 0, H], DARK);
m.box([248, 300, 0], [568, 308, H], DARK);
m.box([560, 0, 0], [568, 300, H], DARK);
// Arcade cabinets along the far wall, screens facing the window.
for (let y = 30; y < 280; y += 36) {
  m.box([524, y, 0], [552, y + 30, 66], DWOOD, { faces: { nx: { tex: DARK } } });
  m.box([518, y + 4, 40], [524, y + 26, 58], DWOOD, { faces: { nx: { tex: 'arcade/screen', offset: [0, 0] } } });
}
// Purple neon tubes high on the arcade walls (they light the arcade, and leak through the window).
m.box([300, 298, 90], [540, 300, 92], 'arcade/neon_purple', { solid: false });
m.box([300, 0, 90], [540, 2, 92], 'arcade/neon_purple', { solid: false });

// Where the photo was taken: near the front-left, looking toward the far corner.
m.start([30, 30, 0], -2, 52);
m.write('rec_room', REC_ROOMS, {
  light: { luxelSize: 8 },
  camera: { evComp: -0.4 },
  fog: { enabled: false },
});
