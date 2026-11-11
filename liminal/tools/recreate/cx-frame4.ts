/**
 * A rebuild of one captured frame of the reference game (capture frame
 * 19893; reference/complex/FINDINGS.md), to tune our camera and light against
 * it. Run: npx vite-node tools/recreate/cx-frame4.ts → maps/cx_frame4.json
 *
 * The room was measured from the frame's G-buffer: the ceiling tile grid
 * (taken as 2 ft tiles) gives the scale, the normals and edges give every
 * wall. Camera-relative numbers (cm): ceiling +147, floor −90, right wall
 * 128 to the right, back wall 527 ahead, the far left wall 109 to the left
 * with a step at 238 ahead, a soffit 53 to the left, bottom at +72. 2×2 ft
 * LED panels in the tile grid, four tiles apart.
 *
 *  y=150   ┌──────────────────┐ near left wall (alcove; the soffit's
 *          │   [panel]        │   underside slopes up to the ceiling at y=110)
 *          │      soffit      ├──────────────────────┐ y=60.3 far left wall
 *  y=38.1  │ · · · · · · · · · · · · · · · · · · · · │ soffit edge
 *          │  cam→  [panel]          [panel]          │
 *  y=-34.2 └─────────────────────────────────────────┘ right wall
 *        x=-102.6         x=112.6 (step)          x=228.4 (back wall)
 *
 * Light and materials, as the capture shows them (FINDINGS.md, "Rebuilding
 * frame 19893"):
 * - Each panel is a downward spot (87° cone, colour #fff0a7) with no shadows:
 *   the frame draws its lights unshadowed, so light reaches the wall under the
 *   soffit and the alcove's face. The panel itself is a dim emitter
 *   (cx/ledpanel), about 7× the lit wall.
 * - Paint #f0ec81 (the G-buffer's), with the game's sheen: F0 0.04 at
 *   roughness 1 (textures/surfaces.json). Carpet and ceiling tiles are
 *   stand-ins darker than the G-buffer's #a39644 and #a29d78: our bounce light
 *   reaches them more than the game's even, weak bounce does.
 *
 * Units are inches, Z up. The camera stands at (17.4, 16.8), eye 36.1" up,
 * looking +x, yaw −3.56°, pitch 1.07° down. (The frame's camera is low
 * against its room: the picture is what counts here, and it is the same at
 * any scale.)
 *
 * To compare with the capture: npm run studio -- load cx_frame4, size 1440
 * 1080, set the camcorder's clock to the frame's (eval
 * "window.liminal.game.renderer.camcorderPost.debugTime = 93.907": its hue
 * wobble), then views <out> "17.4,16.8,-11.9,-3.56,1.07", and
 * python3 -I tools/recreate/compare.py <out>_1.png <capture final, true colours>.
 */
import { MapBuilder } from '../lib/build';

const PAINT = 'cx/paint_yellow', CARPET = 'cx/carpet_dim', CEIL = 'cx/ceiling_dim', PANEL = 'cx/ledpanel';
const T = 6;                       // wall thickness
const Z_CEIL = 95, Z_SOFFIT = 64.9;
const X_NEAR = -102.6, X_STEP = 112.6, X_BACK = 228.4;
const Y_RIGHT = -34.2, Y_SOFFIT = 38.1, Y_FARLEFT = 60.3, Y_NEARLEFT = 150, Y_SLOPE_TOP = 110;
const BASE_H = 4, BASE_T = 0.6;
const LUMENS = 3000;

const m = new MapBuilder();
// floor and ceiling
m.box([X_NEAR - T, Y_RIGHT - T, -T], [X_BACK + T, Y_NEARLEFT + T, 0], CARPET);
m.box([X_NEAR - T, Y_RIGHT - T, Z_CEIL], [X_BACK + T, Y_NEARLEFT + T, Z_CEIL + T], CEIL);
// walls
m.box([X_NEAR - T, Y_RIGHT - T, 0], [X_BACK + T, Y_RIGHT, Z_CEIL], PAINT);                 // right
m.box([X_BACK, Y_RIGHT, 0], [X_BACK + T, Y_NEARLEFT + T, Z_CEIL], PAINT);                 // back
m.box([X_STEP, Y_FARLEFT, 0], [X_BACK, Y_FARLEFT + T, Z_CEIL], PAINT);                    // far left
m.box([X_STEP, Y_FARLEFT, 0], [X_STEP + T, Y_NEARLEFT, Z_CEIL], PAINT);                   // the step's face
m.box([X_NEAR - T, Y_NEARLEFT, 0], [X_STEP + T, Y_NEARLEFT + T, Z_CEIL], PAINT);         // near left
m.box([X_NEAR - T, Y_RIGHT, 0], [X_NEAR, Y_NEARLEFT, Z_CEIL], PAINT);                     // behind the camera
// the soffit along the left, under the ceiling: flat underside out to the far left wall's line,
// then (over the wider near part) a sloped underside rising to the ceiling — the step face's top
// edge in the capture climbs from the soffit to the ceiling across the alcove.
m.box([X_NEAR, Y_SOFFIT, Z_SOFFIT], [X_BACK, Y_FARLEFT, Z_CEIL], PAINT);
m.prismX([[Y_FARLEFT, Z_SOFFIT], [Y_SLOPE_TOP, Z_CEIL], [Y_FARLEFT, Z_CEIL]], X_NEAR, X_STEP, PAINT);
// baseboards, painted like the walls
m.box([X_NEAR, Y_RIGHT, 0], [X_BACK, Y_RIGHT + BASE_T, BASE_H], PAINT);
m.box([X_BACK - BASE_T, Y_RIGHT, 0], [X_BACK, Y_FARLEFT, BASE_H], PAINT);
m.box([X_STEP, Y_FARLEFT - BASE_T, 0], [X_BACK, Y_FARLEFT, BASE_H], PAINT);
m.box([X_STEP - BASE_T, Y_FARLEFT, 0], [X_STEP, Y_NEARLEFT, BASE_H], PAINT);
m.box([X_NEAR, Y_NEARLEFT - BASE_T, 0], [X_STEP, Y_NEARLEFT, BASE_H], PAINT);
// 2×2 ft LED panels in the tile grid, four tiles apart (the third is above and behind the camera).
// Each is a downward spot in the capture: 87° outer cone, colour (1, 0.871, 0.386) linear = #fff0a7,
// unshadowed (the frame has no shadow passes for them).
for (const [x0, y0] of [[-24, 0], [72, 0], [168, 0], [72, 120]]) {
  m.box([x0, y0, Z_CEIL - 0.25], [x0 + 24, y0 + 24, Z_CEIL], CEIL, { faces: { nz: { tex: PANEL } } });
  m.light([x0 + 12, y0 + 12, Z_CEIL - 1], { type: 'spot', lumens: LUMENS, color: '#fff0a7', n: 2.2, cutoff: 87, shadows: 0 });
}
m.start([17.4, 16.8, 0], 1.07, -3.56);

m.write('cx_frame4', [{ name: 'room', min: [X_NEAR, Y_RIGHT, 0], max: [X_BACK, Y_NEARLEFT, Z_CEIL], paint: PAINT }], {
  camera: { model: 'camcorder', flash: false },
  view: { fov: 98.2, viewBob: 0 },
  render: { internalHeight: 756 },
  fog: { enabled: false },
  camcorder: { exposure: 0.0047 },
});
