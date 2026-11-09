/**
 * maps/pmp_nook.json: reference 3 (STYLE.md). Run: npm run gen:nook
 *
 * Built from measurements of the photo (Depth Pro point cloud in the camera's
 * level frame, rotated so the wall is axis-aligned): a half-wall window
 * (sill 17", top 69") in the front room's wall, opening onto a low room 130"
 * deep whose floor is the main floor and whose ceiling is at 77", lit by one
 * dome ~48" behind the wall. Its left wall sits ~19" left of the window's
 * jamb. The front room has one dim light behind the camera. Camera: 109" from the wall, 83" right of
 * the jamb, turned ~26° left of square, ~10° down.
 */
import { MapBuilder } from './lib/build';
import { NOOK_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'nook/paint_tan', CARPET = 'nook/carpet_tan', CEIL = 'nook/ceiling', TRIM = 'house/trim_white';
const H = 96, T = 6, WY = 170;                         // the wall's front face is at y = 170
const J0 = 40, J1 = 190, SILL = 17, TOPZ = 69;         // the window
const LX0 = 21, LX1 = 230, LY1 = 306, LH = 77;         // the low room behind

m.box([-T, -T, -16], [246, WY + T, 0], CARPET);
m.box([LX0 - T, WY + T, -16], [LX1 + T, LY1 + T, 0], 'nook/floor_pale'); // the low room's floor is pale (photo)
m.box([-T, -T, H], [246, WY + T, H + 16], CEIL);
m.box([-T, -T, 0], [246, 0, H], PAINT);
m.box([-T, 0, 0], [0, WY, H], PAINT);
m.box([240, 0, 0], [246, WY, H], PAINT);
// The wall with the window.
m.box([-T, WY, 0], [J0, WY + T, H], PAINT);
m.box([J1, WY, 0], [246, WY + T, H], PAINT);
m.box([J0, WY, 0], [J1, WY + T, SILL], PAINT);
m.box([J0, WY, TOPZ], [J1, WY + T, H], PAINT);
// The low room behind.
m.box([LX0 - T, WY + T, LH], [LX1 + T, LY1 + T, LH + 16], CEIL);
m.box([LX0 - T, WY + T, 0], [LX0, LY1, LH], PAINT);
m.box([LX1, WY + T, 0], [LX1 + T, LY1, LH], PAINT);
m.box([LX0 - T, LY1, 0], [LX1 + T, LY1 + T, LH], PAINT);
// Flat white sill (photo): a board projecting ~1.5" with a small apron moulding under it.
m.box([J0 - 3, WY - 1.5, SILL], [J1 + 3, WY, SILL + 1], TRIM);
m.box([J0, WY, SILL], [J1, WY + T, SILL + 1], TRIM);
m.box([J0 - 2, WY - 0.75, SILL - 3.5], [J1 + 2, WY, SILL], TRIM);
// Baseboards (front room only: the low room has none in the photo).
m.box([0, 0, 0], [240, 0.6, 3.5], TRIM);
m.box([0, 0.6, 0], [0.6, WY - 0.6, 3.5], TRIM);
m.box([239.4, 0.6, 0], [240, WY - 0.6, 3.5], TRIM);
m.box([0, WY - 0.6, 0], [240, WY, 3.5], TRIM);
// The one light: a flush dome on the low room's ceiling, ~48" behind the wall.
m.cylinder(72, 218, 7, LH - 4, LH, 'fixture/dome', { solid: false }); // a 4" deep dome, its bottom just shows under the header
m.light([72, 218, LH - 4.5], { type: 'dome', lumens: 900, kelvin: 3000 });
// The front wall is lit warm from behind the camera in the photo: one dim ceiling light, out of view.
m.cylinder(170, 24, 5, H - 1.5, H, 'fixture/dome', { solid: false });
m.light([170, 24, H - 2], { type: 'dome', lumens: 800, kelvin: 2800 });

m.start([123, 61, 0], 9.7, 115.6);
m.write('pmp_nook', NOOK_ROOMS, {
  light: { luxelSize: 8 },
  hull: { eyeHeight: 56 },   // the photo's camera height
  camera: { evComp: -0.6, whiteBalanceK: 3300 },
  fog: { enabled: false },
});
