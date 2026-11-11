/**
 * Three scenes of the "Infinite house" video (STYLE.md, reference 6), rebuilt from the three frames
 * YouTube keeps of it (i.ytimg.com/vi/qs5LrOkvVKM/maxres1-3.jpg), to bring our light and camera to
 * that look. Run: npx vite-node tools/house/gen-house-iv.ts → maps/house_iv.json
 *
 * Measured on the frames (no depth exists for a video): straight edges snapped to the picture give
 * the vanishing points of the room's three directions; one lens fitted to all three frames gives a
 * 64.4° field of view (4:3) with no measurable bend, and each frame's yaw and pitch. Floor points
 * then give the plan, and an 80" door (36" counter in frame 1) gives the scale: the eye is at
 * 66 / 53 / 59" and the ceilings are 101 / 115 / 115" — the rooms are taller than a normal
 * basement, which is much of their look. Each scene is drawn round its camera, placed at (ox, 0).
 *
 *  K (frame 1): a kitchenette on the north wall; a bathroom block standing in the room, its door on
 *     the west face and a plaque and a plastic chair on the south face; east of it a wall coming
 *     forward, and past its corner a dark corridor to the east with a sconce.
 *  F (frame 2): from a wide passage into a room: a basement window high on the far wall, an empty
 *     dark bookcase, a red-brick chimney breast with a raised firebox, a door; a door on the east
 *     wall; a grey armchair turned away; two domes on the ceiling.
 *  D (frame 3): a tall hall with six-panel closet doors along its west wall, which steps in halfway;
 *     a door in the far wall; crown moulding; a dome near the step.
 *
 * Camera poses (studio `views`: x,y,feet z,yaw,pitch; feet = eye - 48) are in house_iv_frames.json.
 */
import { MapBuilder } from '../lib/build';
import { HouseKit, type HouseTex } from './kit';
import { HOUSE_IV_ROOMS } from './rooms';

const T = 5;
const TEX: HouseTex = {
  paint: 'house6/paint_cream', carpet: 'house6/carpet_brown', ceiling: 'house6/ceiling', trim: 'house6/trim_cream',
  brass: 'pmp/brass', dome: 'fixture/dome_soft', chrome: 'fixture/chrome', brick: 'house6/brick', soot: 'house6/soot',
  woodDark: 'house6/wood_dark', fabric: 'house6/fabric_grey', counter: 'house6/counter', glassDark: 'house6/dark',
  woodPlaque: 'house6/wood_mid', sconce: 'fixture/sconce',
};
const m = new MapBuilder();

// ---------------------------------------------------------------- K: the kitchenette room (camera at 0, 0)
{
  const k = new HouseKit(m, 101, TEX);
  const W = -200, S = -150, N = 189;              // west wall, south wall, the kitchenette (north) wall
  const PX = 177, DX = 330, DS = -40, DN = 260;   // a partition's east face; the dark room east of it
  k.slabs(W, S, PX, N);
  k.wallX(N, N + T, W - T, 90);                   // north wall up to the block
  k.wallX(S - T, S, W - T, PX + T);               // south
  k.wallY(W - T, W, S, N + T);                    // west
  k.wallY(PX, PX + T, S, 40);                     // east, up to an opening (y 40-94) into the dark room
  // the bathroom block: west face (door) at x 90, south face (plaque, chair) at y 115
  m.box([90, 115, 0], [165, N + T, k.H], TEX.paint);
  k.door('y', 90, -1, 147, -1, { w: 32 });
  k.plaque('x', 115, -1, 128, 78, 37, 8);
  k.chair(150, 105, 270);
  // east of the block a 12" partition comes forward to y 94: its west face is the light strip, its end the
  // dark band beside it; past it the picture opens into a dark room lit only by a sconce on its far wall
  m.box([165, 94, 0], [PX, DN + T, k.H], TEX.paint);
  k.slabs(PX, DS, DX, DN);
  k.wallX(DS - T, DS, PX, DX + T);
  k.wallX(DN, DN + T, PX - 12, DX + T);
  k.wallY(DX, DX + T, DS - T, DN + T);
  k.wallY(PX, PX + T, DS, 40);
  k.sconce('y', DX, -1, 115, 78, 60, 2700);
  // the kitchenette: base cabinets to x 60 (counter 36"), upper cabinets 60-95" with an open shelf
  k.baseCabinets('x', N, -1, -110, 60);
  k.upperCabinets('x', N, -1, -110, 18, 60, 95);
  k.upperCabinets('x', N, -1, 18, 57, 60, 95, true);
  k.dome(40, 55, 1600, 2700);                     // just above the top of the picture
}

// ---------------------------------------------------------------- F: the fireplace room (camera at 1000, 0)
{
  const ox = 1000, k = new HouseKit(m, 115.5, TEX);
  const W = ox - 118, E = ox + 70, N = 239, S0 = 120;   // the room: x W..E, y S0..N; the passage x -66..51
  const PW = ox - 66, PE = ox + 51;
  k.slabs(W, -100, E, N);
  k.wallX(N, N + T, W - T, E + T);
  k.wallY(W - T, W, S0 - T, N + T);
  k.wallY(E, E + T, S0 + 11 - T, N + T);
  k.wallX(S0 - T, S0, W - T, PW); k.wallX(S0 + 11 - T, S0 + 11, PE, E + T);
  // the passage the camera stands in (its right wall reaches 11" further, as the picture shows)
  k.wallY(PW - T, PW, -100, S0); k.wallY(PE, PE + T, -100, S0 + 11);
  k.wallX(-100 - T, -100, PW - T, PE + T);
  // the far wall: window high up, bookcase, chimney breast with its firebox, a door
  k.window('x', N, -1, ox - 105, ox - 65, 81, 112, 'house6/window');
  k.bookshelf('x', N, -1, ox - 92, ox - 44, 50, 12);
  k.fireplace('x', N, -1, ox - 7);
  k.door('x', N, -1, ox + 47, 1, { w: 32 });
  k.door('y', E, -1, 182, 1, { w: 30 });
  k.armchair(ox + 32, 150, 65, 32);
  k.baseboards(W, S0, E, N, [{ side: 'n', a: ox - 38.5, b: ox + 24.5 }, { side: 'n', a: ox + 28, b: ox + 66 }, { side: 'e', a: 164, b: 200 }, { side: 's', a: PW, b: PE }]);
  k.baseboards(PW, -100, PE, S0, [{ side: 'n', a: PW, b: PE }, { side: 's', a: PW, b: PE }]);
  k.dome(ox - 90, 182, 1600, 2700);
  k.dome(ox + 40, 180, 1600, 2700);
  k.dome(ox + 30, 90, 1600, 2700);                 // in the passage, over its right side, above the picture
}

// ---------------------------------------------------------------- D: the hall of doors (camera at 2000, 0)
{
  const ox = 2000, k = new HouseKit(m, 115, TEX);
  const W0 = ox - 112, W1 = ox - 90, JOG = 142, N = 312, E = ox + 40, S = -80;
  k.slabs(W0, S, E, N);
  k.wallY(W0 - T, W0, S - T, JOG);                // the west wall, near part
  m.box([W0 - T, JOG, 0], [W1, N + T, k.H], TEX.paint);   // ... and where it steps in
  k.wallX(N, N + T, W1, E + T);
  k.wallY(E, E + T, S - T, N + T);
  k.wallX(S - T, S, W0 - T, E + T);
  k.door('y', W0, 1, 44, 1, { w: 32 });
  k.door('y', W0, 1, 112, 1, { w: 34 });
  k.door('y', W1, 1, 170, 1, { w: 32 });
  k.door('y', W1, 1, 216, 1, { w: 30 });
  k.door('x', N, -1, ox - 49, 1, { w: 30 });
  k.baseboards(W0, S, E, JOG, [{ side: 'w', a: 28 - 3, b: 60 + 3 }, { side: 'w', a: 95 - 3, b: 129 + 3 }, { side: 'n', a: W0, b: E }]);
  k.baseboards(W1, JOG, E, N, [{ side: 'w', a: 154 - 3, b: 186 + 3 }, { side: 'w', a: 201 - 3, b: 231 + 3 }, { side: 'n', a: ox - 64 - 3, b: ox - 34 + 3 }, { side: 's', a: W1, b: E }]);
  m.box([W0, JOG - 0.6, 0], [W1, JOG, 3.5], TEX.trim);  // baseboard on the step's face
  k.crown(W0, S, E, JOG);
  k.crown(W1, JOG, E, N);
  k.dome(ox - 62, 118, 1600, 2700);
  k.dome(ox - 36, -30, 1600, 2700);               // behind the camera
}

m.start([-0, 0, 18], 4.9, 50.3);
m.write('house_iv', HOUSE_IV_ROOMS, {
  // A fill in the lamps' colour: the video's renderer lights far walls and ceilings more evenly than bounce alone.
  light: { luxelSize: 4, bounces: 2, extraBounces: 1, ambientLux: 4, ambientKelvin: 2700 },
  fog: { enabled: false },
  render: { internalHeight: 480 },
  view: { fov: 64.4, viewBob: 0 },
  camera: { model: 'camcorder', flash: false },
  // "Cassette": the video's camera, as measured on its frames (STYLE.md): soft, warm, a wide glow round the lamps only.
  camcorder: {
    exposure: 0.012, whiteBalance: 2900, autoExposure: true, aeKey: 0.11, aeRange: 3, aeRate: 1.5,
    tintR: 1, tintG: 1, tintB: 1, glow: 0.3, glowSize: 0.5, glowThreshold: 1.5, contrast: 0.75, dirt: 0, fringe: 0.15,
    vignette: 0.15, soften: 4, sharpen: 0.3, posterize: 0, grain: 0.12, lift: 0.02, lineChroma: 0, hueWobble: 0, streaks: 0, lens: 0, bars: true,
  },
});
