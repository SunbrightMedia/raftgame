/**
 * maps/pmp_nook.json: reference 3 (STYLE.md), the lit niche. Run: npm run gen:nook
 *
 * A bare tan room with a big recessed niche at chest height in the far wall.
 * The only light is a flush dome on the niche ceiling: the niche glows cream,
 * the room sits in brown dusk, and the niche's left jamb throws the one hard
 * diagonal shadow across the niche floor.
 */
import { MapBuilder } from './lib/build';
import { NOOK_ROOMS } from './lib/rooms';

const m = new MapBuilder();
const PAINT = 'nook/paint_tan', CARPET = 'nook/carpet_tan', CEIL = 'nook/ceiling', TRIM = 'house/trim_white';
const W = 6, H = 96;

// Floor and ceiling.
m.box([-W, -W, -16], [174, 240, 0], CARPET);
m.box([-W, -W, H], [174, 240, H + 16], CEIL);
// Room walls.
m.box([-W, -W, 0], [174, 0, H], PAINT);          // front (behind the camera)
m.box([-W, 0, 0], [0, 180, H], PAINT);            // left
m.box([168, 0, 0], [174, 180, H], PAINT);         // right
// Back wall around the niche opening (x 36..120, z 30..90).
m.box([-W, 180, 0], [36, 186, H], PAINT);
m.box([120, 180, 0], [174, 186, H], PAINT);
m.box([36, 180, 0], [120, 186, 30], PAINT);
m.box([36, 180, 90], [120, 186, H], PAINT);
// The niche: 84 wide, 60 tall, 42 deep beyond the wall.
m.box([36, 186, 0], [120, 228, 30], PAINT);       // its floor (sill height 30)
m.box([30, 186, 0], [36, 234, H], PAINT);         // left jamb wall
m.box([120, 186, 0], [126, 234, H], PAINT);       // right jamb wall
m.box([36, 228, 0], [120, 234, H], PAINT);        // back
m.box([36, 186, 90], [120, 228, H], PAINT);       // niche ceiling
// Thick rounded sill trim in the wall colour, running along x, projecting 4" into the room.
// Profile in (y, z): flat against the wall at y = 180, a half-round nose 2.5" radius out front.
const sill: [number, number][] = [[180, 31]];
for (let i = 0; i <= 24; i++) { const a = Math.PI / 2 + (Math.PI * i) / 24; sill.push([177.5 + 2.5 * Math.cos(a), 28.5 + 2.5 * Math.sin(a)]); }
sill.push([180, 26]);
m.prismX(sill, 32, 124, PAINT);
// Baseboards (white-ish), along the room walls.
m.box([0, 0, 0], [168, 0.6, 3.5], TRIM);
m.box([0, 0.6, 0], [0.6, 180, 3.5], TRIM);
m.box([167.4, 0.6, 0], [168, 180, 3.5], TRIM);
m.box([0.6, 179.4, 0], [36, 180, 3.5], TRIM);
m.box([120, 179.4, 0], [167.4, 180, 3.5], TRIM);
m.box([36, 179.4, 0], [120, 180, 3.5], TRIM);
// The dome: flush on the niche ceiling, front-right, as in the photo.
m.cylinder(100, 197, 6, 88.5, 90, 'fixture/dome', { solid: false });
m.light([100, 197, 87.5], { type: 'dome', lumens: 900, kelvin: 3000 });

// Where the photo was taken: ~9' back, a little left, looking up into the niche.
m.start([58, 112, 0], -8, 72);
m.write('pmp_nook', NOOK_ROOMS, {
  light: { luxelSize: 6 },
  // Warm bulb, cream niche: balance near the bulb, as in the basement (STYLE.md).
  camera: { evComp: -0.6, whiteBalanceK: 3300 },
  fog: { enabled: false },
});
