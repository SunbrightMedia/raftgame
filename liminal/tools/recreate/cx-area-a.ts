/**
 * One area of the reference game, rebuilt once to check our light against every capture frame taken
 * in it, with nothing retuned per frame: the hall of frames 18325, 18829 and 19259, and the corridor
 * south of it where frame 19893 was taken (its "alcove" is the hall's south recess; the hall's lamps
 * light it too: the game's lamps cast no shadows).
 * Run: npx vite-node tools/recreate/cx-area-a.ts → maps/cx_area_a.json
 *
 * Measured with tools/recreate/measure.py --world (our inches; x = the game's y / 2.54, y = its
 * x / 2.54, floor at z = 0; ceiling 159" everywhere). Plan (north up):
 *
 *            ┌─────┐ y=-590 (dark doorway)
 *            │ box │ north corridor x 700-820
 *   ┌────────┘     └────────┐ y=-727.5 hall's north wall (thicker at x 600-700 and 830-950)
 *   │ [p]    box  [p]   [p] │      panels: 3 × 3 grid, x 534.7 / 767.6 / 999.3,
 *   │      tarp     ▣▢      │                         y -774.5 / -964.3 / -1154.3
 *   │ [p]         [p]   [p] │      boxes under cloth (▣ = two stacked)
 *   │ [p]         [p]▢  [p] │
 *   x=466.3  ┌─────┐  x=1089.9 y=-1273.4 hall's south wall; recess x 690-855.5
 * ┌──┬───────┘recess└────────┐ y=-1356.3 corridor's north wall; soffit y -1395..-1356.3,
 * │  ▯ [off]   cam19893 → [p] [p]│   underside z 109.4, sloping up over the recess
 * └──┴───────────────────────┘ y=-1511.9, corridor x 265 (portal, lintel) - 1048.6;
 *  x=38 room beyond the portal (lamp guessed)       tape (#f0ce22) along y -1466, then north at x 777
 *
 * Studio `views` poses (x,y,feet z,yaw,pitch; feet = eye 63.3 - 48) and the tape clocks are in
 * tools/recreate/frames.json. Lamps: all 30 whose reach touches the area, from the game's own light
 * constants (deep export; tools/recreate/cx-lamps.json), as Unreal lamps (render/ueLight.ts).
 */
import { MapBuilder } from '../lib/build';
import { readFileSync } from 'node:fs';
import { PAINT, CARPET, CEIL, CLOTH, TAPE, PANEL_OFF, EYE, EXPOSURE, panel, settings, ueLamps, type CxLamp } from './cx';

type V3 = [number, number, number];
const T = 8, Z = 160.6;                                             // ceiling: 160.63" in the deep export's depth
const X0 = 466.3, X1 = 1089.9, Y0 = -1273.4, Y1 = -727.5;          // the hall
const RX0 = 690, RX1 = 855.5;                                        // the south recess
const CX0 = 265, CX1 = 1048.6, CY0 = -1511.9, CY1 = -1356.3;         // frame 19893's corridor (20169 looks west down it)
const WX0 = 38, WY0 = -1560, WY1 = -1315;                          // the room beyond its west portal
const SOFFIT_Y = -1395.0, SOFFIT_Z = 109.4, SLOPE_TOP_Y = -1278.2;
const BASE_H = 6.5, BASE_T = 1;

const m = new MapBuilder();
const box = (a: V3, b: V3, tex = PAINT) => m.box(a, b, tex);
// floor and ceiling over everything
box([WX0 - T, WY0 - T, -T], [X1 + T, -590 + T, 0], CARPET);
box([WX0 - T, WY0 - T, Z], [X1 + T, -590 + T, Z + T], CEIL);
// ---- the hall
box([X0 - T, Y0, 0], [X0, Y1 + T, Z]);                                 // west
box([X1, CY1, 0], [X1 + T, Y1 + T, Z]);                                // east
box([X0 - T, Y1, 0], [600, Y1 + T, Z]);                                // north wall, with its thicker parts and opening
box([600, Y1 - 18.3, 0], [700, Y1 + T, Z]);
box([820, Y1 - 18.3, 0], [950, Y1 + T, Z]);
box([950, Y1, 0], [X1 + T, Y1 + T, Z]);
box([700 - T, Y1, 0], [700, -590, Z]); box([820, Y1, 0], [820 + T, -590, Z]);   // north corridor
box([700 - T, -590, 0], [735, -590 + T, Z]); box([785, -590, 0], [820 + T, -590 + T, Z]); box([735, -590, 90], [785, -590 + T, Z]);
box([735, -590 + T, 0], [785, -590 + T + 4, 90], 'cx/door_dark');     // a dark door in the doorway (G-buffer #1b1d1c, glossy)
// solid between the hall and the corridor (the hall's south wall and the corridor's north wall are its faces)
box([CX0, CY1, 0], [RX0, Y0, Z]);
box([RX1, CY1, 0], [X1 + T, Y0, Z]);
// ---- the corridor of frame 19893
box([CX0, CY0 - T, 0], [X1 + T, CY0, Z]);                              // south
// the west portal: a lintel down to the soffit's height across the corridor, into a wider room (lit; its lamp is guessed)
box([CX0 - T, CY0, SOFFIT_Z], [CX0, CY1, Z]);
box([CX0 - T, WY0, 0], [CX0, CY0, Z]); box([CX0 - T, CY1, 0], [CX0, WY1, Z]);
box([WX0 - T, WY0 - T, 0], [CX0, WY0, Z]); box([WX0 - T, WY1, 0], [CX0, WY1 + T, Z]); box([WX0 - T, WY0, 0], [WX0, WY1, Z]);
panel(m, 151.5, -1437.5, Z, { lamp: false });
box([CX1, CY0, 0], [X1 + T, CY1, Z]);                                  // east end
// the soffit along the corridor's north side; over the recess its underside slopes up to the ceiling
box([CX0, SOFFIT_Y, SOFFIT_Z], [CX1, CY1, Z]);
m.prismX([[CY1, SOFFIT_Z], [SLOPE_TOP_Y, Z], [CY1, Z]], RX0, RX1, PAINT);
// ---- baseboards
for (const [a, b] of [
  [[X0, Y0, 0], [X0 + BASE_T, Y1, BASE_H]], [[X1 - BASE_T, Y0, 0], [X1, Y1, BASE_H]],
  [[X0, Y0, 0], [RX0, Y0 + BASE_T, BASE_H]], [[RX1, Y0, 0], [X1, Y0 + BASE_T, BASE_H]],
  [[CX0, CY0, 0], [CX1, CY0 + BASE_T, BASE_H]], [[CX1 - BASE_T, CY0, 0], [CX1, CY1, BASE_H]],
  [[RX1, CY1 - BASE_T, 0], [CX1, CY1, BASE_H]], [[CX0, CY1 - BASE_T, 0], [RX0, CY1, BASE_H]],
  [[RX1 - BASE_T, CY1, 0], [RX1, Y0, BASE_H]], [[RX0, CY1, 0], [RX0 + BASE_T, Y0, BASE_H]],
] as [V3, V3][]) box(a, b);
// ---- the floor tape (G-buffer colour #f0ce22): along the corridor, then north through the recess into the hall
m.box([237, -1469.5, 0], [780.5, -1462.5, 0.1], TAPE, { faces: { pz: { tex: TAPE } } });
m.box([773.5, -1462.5, 0], [780.5, -600, 0.1], TAPE, { faces: { pz: { tex: TAPE, rot: 90 } } });
// ---- boxes under cloth (measured from the three hall frames), and a tarp on the floor
box([678, -870, 0], [720, -824, 43], CLOTH);
box([840, -1116, 0], [888, -1074, 43], CLOTH);
box([845, -896, 0], [893, -856, 42], CLOTH); box([848, -893, 42], [890, -859, 75], CLOTH);
box([918, -896, 0], [966, -856, 42], CLOTH);
box([616, -1082, 0], [678, -980, 1], CLOTH);
box([724, -695, 0], [760, -648, 46], CLOTH);
// ---- the ceiling panels (measured from the pictures)
const COLS = [534.7, 767.6, 999.3], ROWS = [-774.5, -964.3, -1154.3];
for (const x of COLS) for (const y of ROWS) panel(m, x, y, Z, { lamp: false });
panel(m, 806.4, -1437.0, Z, { lamp: false });
panel(m, 958.9, -1437.1, Z, { lamp: false });
// ---- the lamps: every lamp whose reach touches this area, exactly as the game's light constants give them (deep
// export, all ten frames; tools/recreate/cx-lamps.json). Unshadowed, as in the game: light from the rooms round the
// area reaches through its walls.
ueLamps(m, (JSON.parse(readFileSync(new URL('./cx-lamps.json', import.meta.url), 'utf8')) as { lamps: CxLamp[] }).lamps);
// a switched-off panel in the corridor (dark in 20169's view)
m.box([348.9 - 18, -1437 - 18, Z - 0.25], [348.9 + 18, -1437 + 18, Z], CEIL, { faces: { nz: { tex: PANEL_OFF } } });
m.start([756.9, -946.5, 63.3 - EYE], -0.25, -32.66);

m.write('cx_area_a', [
  { name: 'hall', min: [X0, Y0, 0], max: [X1, Y1, Z], paint: PAINT },
  { name: 'corridor', min: [CX0, CY0, 0], max: [CX1, Y0, Z], paint: PAINT },
], { ...settings(), camera: { model: 'complex', flash: false }, complex: { exposure: EXPOSURE } });
