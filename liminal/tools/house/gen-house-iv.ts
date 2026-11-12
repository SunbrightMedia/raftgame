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
 * The user's notes on the first rebuild (Nov 2026), all in here: nothing has a hard edge (rounded
 * corners, profiled trim); doors with real depth, set into their openings, panels deep enough for the
 * camcorder's sharpening to catch; white baseboards; crown moulding on the ceiling; lamps blown out;
 * no shadows on the ceiling; and frame 1's room as it really is (the wall right of the light strip has
 * a door and the sconce, it is not a dark room).
 *
 *  K (frame 1): a kitchenette on the north wall; a bathroom block standing out of it, its door in the
 *     west face and a key rack and a plastic chair on its south face; east of the block a 12" pilaster
 *     (the light strip), then the north wall again with a dark door and a sconce.
 *  F (frame 2): from a wide passage into a room: a basement window in a deep well, an empty dark
 *     bookcase, a red-brick chimney breast with a deep firebox, a door; a door on the east wall; a grey
 *     armchair turned away; two flush lights on the ceiling.
 *  D (frame 3): a tall hall with six-panel closet doors along its west wall, which steps in halfway;
 *     a door in the far wall; crown moulding; a flush light near the step.
 *
 * Camera poses (studio `views`: x,y,feet z,yaw,pitch; feet = eye - 48) are in house_iv_frames.json.
 */
import { MapBuilder } from '../lib/build';
import { HouseKit, type HouseTex } from './kit';
import { HOUSE_IV_ROOMS } from './rooms';

const T = 5;
/** Share of the domes' light that leaves the glass bowl evenly every way: it lights the ceiling round each lamp and is
 *  what the satin ceiling reflects (the glare patch round the video's lamps). */
const DOME_UP = Number(process.env.DOME_UP ?? 0.5);
/** Their downward lobe, cos^n: 1 = an even (Lambertian) bowl bottom; the default 0.6 sends more to the walls. */
const DOME_N = Number(process.env.DOME_N ?? 1);
const TEX: HouseTex = {
  paint: 'house6/paint_ivory', carpet: 'house6/carpet_brown', ceiling: 'house6/ceiling_paint', trim: 'house6/trim_white',
  brass: 'pmp/brass', dome: 'fixture/dome', chrome: 'fixture/chrome', brick: 'house6/brick', soot: 'house6/soot',
  woodDark: 'house6/wood_dark', fabric: 'house6/fabric_grey', counter: 'house6/counter', glassDark: 'house6/dark',
  woodPlaque: 'house6/wood_mid', sconce: 'fixture/sconce', door: 'house6/door_white',
};
const m = new MapBuilder();

// ---------------------------------------------------------------- K: the kitchenette room (camera at 0, 0)
{
  const k = new HouseKit(m, 101, TEX); k.domeUp = DOME_UP; k.domeN = DOME_N;
  const W = -200, S = -150, N = 189, E = 380, NE = 115;   // the north wall: y 189 west of the block, 115 east of the pilaster
  const bx0 = 90, bx1 = 165, px1 = 177, pz = 94;          // the block (x 90-165, y 115-189) and the pilaster (x 165-177 to y 94)
  k.slabs(W, S, E, N);
  k.wallX(N, N + T, W - T, bx0 + T);                      // north (the kitchenette)
  k.wallX(S - T, S, W - T, E + T);                        // south
  k.wallY(W - T, W, S, N + T);                            // west
  k.wallY(E, E + T, S, NE + T);                           // east
  // the block: a 5" skin with the door's opening in its west face, solid behind; its outside corner rounded
  const dg = k.doorGap(147, 32);
  k.rblock(bx0, NE, bx0 + T, dg.a, [true, false, false, false]);
  k.wallY(bx0, bx0 + T, dg.b, N);
  m.box([bx0, dg.a, dg.top], [bx0 + T, dg.b, k.H], TEX.paint);
  m.box([bx0 + T, NE, 0], [bx1, N, k.H], TEX.paint);
  k.door('y', bx0, -1, 147, -1, { w: 32 });
  k.plaque('x', NE, -1, 128, 78, 34, 6);
  // The chair: Poly Haven's SchoolChair_01 (CC0) with a padded seat and back (tools/models/padded_chair.json),
  // its back to the pilaster, facing west (the video sees the back's face, the seat reaching to the left).
  m.prop([150, 104.5, 0], 'cc0/padded_chair', -90, 0.9);
  // the pilaster: its two outside corners rounded
  k.rblock(bx1, pz, px1, N, [true, true, false, false]);
  // the north wall east of the pilaster, with a door (dark, far from the lamp) and the sconce
  const dg2 = k.doorGap(264, 32);
  k.wallX(NE, NE + T, px1, E + T, [dg2]);
  k.door('x', NE, -1, 264, 1, { w: 32 });
  k.sconce('x', NE, -1, 332, 78, 160, 2300, 0.85);       // an uplight: an orange glow and a bright fan on the ceiling above, the corridor dark
  // the kitchenette: base cabinets to x 60 (counter 36"), an upper cabinet 60-95" with open shelves to its left
  k.baseCabinets('x', N, -1, -110, 0, 4);
  k.baseCabinets('x', N, -1, 0, 60, 2);
  k.upperCabinets('x', N, -1, -110, 18, 60, 95, 4);
  k.upperCabinets('x', N, -1, 30, 57, 60, 95, 1, true);
  // No trim in this room: at full size the video shows no baseboard on the block or under the cabinets, and no crown.
  // The lamp is overhead in front of the camera (the floor in view as bright as the ceiling, as in the video).
  // East of the pilaster is a hall of its own, lit only by its sconce (the video's far right is dark, its door
  // grey): a wall along its south side, out of the picture, keeps the room's lamp off it.
  k.wallX(45 - T, 45, px1, E);
  k.dome(40, 55, 1600, 2850);                            // a little cooler than the others: the video's frame 1 is greyer
}

// ---------------------------------------------------------------- F: the fireplace room (camera at 1000, 0)
{
  const ox = 1000, k = new HouseKit(m, 115.5, TEX); k.domeUp = DOME_UP; k.domeN = DOME_N;
  const W = ox - 118, E = ox + 70, N = 239, S0 = 120, S1 = 131;  // the room: x W..E, y S0..N (S1 east of the passage)
  const PW = ox - 66, PE = ox + 51, PS = -100;                    // the passage the camera stands in
  k.slabs(W, PS, E, N);
  const wg = { a: ox - 108, b: ox - 62, top: 114, bottom: 79 };
  const fd = k.doorGap(ox + 47, 32), ed = k.doorGap(182, 30);
  k.wallX(N, N + T, W - T, E + T, [wg, fd]);
  k.wallY(W - T, W, S0 - T, N + T);
  k.wallY(E, E + T, S1 - T, N + T, [ed]);
  // the opening into the room: its two outside corners rounded (the light jamb edges of the picture)
  k.rblock(W - T, S0 - T, PW, S0, [false, false, true, false]);
  k.rblock(PE, S1 - T, E + T, S1, [false, false, false, true]);
  k.rblock(PW - T, PS, PW, S0, [false, false, true, false]);
  k.rblock(PE, PS, PE + T, S1, [false, false, false, true]);
  k.wallX(PS - T, PS, PW - T, PE + T);
  // the far wall: window in its well, bookcase, chimney breast, a door; a door on the east wall
  k.window('x', N, -1, ox - 107, ox - 63, 80, 113, 'house6/window', 12, false);
  k.bookshelf('x', N, -1, ox - 92, ox - 44, 50, 12);
  k.fireplace('x', N, -1, ox - 7, { d: 12, fd: 10 });
  k.door('x', N, -1, ox + 47, 1, { w: 32 });
  k.door('y', E, -1, 182, 1, { w: 30 });
  // The armchair: soft cushions, not stepped boxes (tools/models/armchair_soft.json); it faces away from the camera,
  // turned left (front at 120°), so its back and left arm show, as in the video. The model's front is -y: yaw = that + 90.
  m.prop([ox + 24, 150, 0], 'house/armchair_soft', 120 + 90, 1.15);
  // trim
  k.baseRun('x', N, -1, W, ox - 38.5); k.baseRun('x', N, -1, ox + 24.5, fd.a - 3.25); k.baseRun('x', N, -1, fd.b + 3.25, E);
  k.baseRun('y', W, 1, S0, N); k.baseRun('y', E, -1, S1, ed.a - 3.25); k.baseRun('y', E, -1, ed.b + 3.25, N);
  k.baseRun('x', S0, 1, W, PW); k.baseRun('x', S1, 1, PE, E);
  k.baseRun('y', PW, 1, PS, S0); k.baseRun('y', PE, -1, PS, S1); k.baseRun('x', PS, 1, PW, PE);
  k.crownRun('x', N, -1, W, E); k.crownRun('y', W, 1, S0, N); k.crownRun('y', E, -1, S1, N);
  k.crownRun('x', S0, 1, W, PW); k.crownRun('x', S1, 1, PE, E);
  k.crownRun('y', PW, 1, PS, S0); k.crownRun('y', PE, -1, PS, S1); k.crownRun('x', PS, 1, PW, PE);
  k.dome(ox - 90, 182, 1600, 2700);
  k.dome(ox + 40, 180, 1600, 2700);
  k.dome(ox + 28, 60, 2400, 2700);                        // in the passage, over its right side, above the picture
}

// ---------------------------------------------------------------- D: the hall of doors (camera at 2000, 0)
{
  const ox = 2000, k = new HouseKit(m, 115, TEX); k.domeUp = DOME_UP; k.domeN = DOME_N;
  const W0 = ox - 112, W1 = ox - 90, JOG = 142, N = 312, E = ox + 40, S = -80;
  k.slabs(W0, S, E, N);
  // west wall, near part, with two doors
  const d1 = k.doorGap(44, 32), d2 = k.doorGap(112, 34);
  k.wallY(W0 - T, W0, S - T, JOG, [d1, d2]);
  // where the wall steps in: a 5" wall with two doors, solid behind it; the step's outside corner rounded
  const d3 = k.doorGap(170, 32), d4 = k.doorGap(216, 30);
  k.rblock(W1 - T, JOG, W1, d3.a, [false, true, false, false]);
  k.wallY(W1 - T, W1, d3.b, N + T, [d4]);
  m.box([W1 - T, d3.a, d3.top], [W1, d3.b, k.H], TEX.paint);
  m.box([W0 - T, JOG, 0], [W1 - T, N + T, k.H], TEX.paint);
  // far wall with a door; east wall; south wall behind the camera
  const d5 = k.doorGap(ox - 49, 30);
  k.wallX(N, N + T, W1, E + T, [d5]);
  k.wallY(E, E + T, S - T, N + T);
  k.wallX(S - T, S, W0 - T, E + T);
  k.door('y', W0, 1, 44, 1, { w: 32 });
  k.door('y', W0, 1, 112, 1, { w: 34 });
  k.door('y', W1, 1, 170, 1, { w: 32 });
  k.door('y', W1, 1, 216, 1, { w: 30 });
  k.door('x', N, -1, ox - 49, 1, { w: 30 });
  // trim along the walls only (none across the hall where the wall steps)
  k.baseRun('y', W0, 1, S, d1.a - 3.25); k.baseRun('y', W0, 1, d1.b + 3.25, d2.a - 3.25); k.baseRun('y', W0, 1, d2.b + 3.25, JOG);
  k.baseRun('x', JOG, 1, W0, W1);
  k.baseRun('y', W1, 1, JOG + 1, d3.a - 3.25); k.baseRun('y', W1, 1, d3.b + 3.25, d4.a - 3.25); k.baseRun('y', W1, 1, d4.b + 3.25, N);
  k.baseRun('x', N, -1, W1, d5.a - 3.25); k.baseRun('x', N, -1, d5.b + 3.25, E);
  k.baseRun('y', E, -1, S, N); k.baseRun('x', S, 1, W0, E);
  k.crownRun('y', W0, 1, S, JOG); k.crownRun('x', JOG, 1, W0, W1); k.crownRun('y', W1, 1, JOG, N);
  k.crownRun('x', N, -1, W1, E); k.crownRun('y', E, -1, S, N); k.crownRun('x', S, 1, W0, E);
  k.dome(ox - 75, 135, 1600, 2700);                       // close to the stepped wall: its top glows, as in the video
  k.dome(ox - 36, -30, 1600, 2700);                       // behind the camera
}

m.start([-0, 0, 18], 4.9, 50.3);
m.write('house_iv', HOUSE_IV_ROOMS, {
  // A fill in the lamps' colour: the video's renderer lights far walls and ceilings more evenly than bounce alone.
  // Little corner darkening: the video's wall-ceiling line and crown are bright, with no shadow band under them.
  light: { luxelSize: 3, bounces: 2, extraBounces: 1, ambientLux: 6, ambientKelvin: 2700, aoStrength: 0.25, aoRadius: 24, aoDirect: 0 },
  fog: { enabled: false },
  // full resolution, then the camera's own softness: thin lines (mortar, panel shadows) survive as in the video
  render: { internalHeight: 1080 },
  // a camera held by hand: the found-footage research's first cue (a locked-off view reads as a render)
  view: { fov: 64.4, viewBob: 0, handheld: 0.6 },
  camera: { model: 'camcorder', flash: false },
  // "Cassette": the video's camera, as measured on its frames (STYLE.md): soft but edge-enhanced, warm, lamps
  // blown out with a wide bloom.
  camcorder: {
    exposure: 0.012, whiteBalance: 2950, autoExposure: true, aeKey: 0.12, aeRange: 3, aeRate: 1.5, aeLinear: 1,
    // the lamps: the bright patch round each is the ceiling lit by the fixture's glass (lighting.ts "dome"), not bloom;
    // bloom stays small, as in the reference projects (Unity HDRP 0.13, Blender 0.125)
    tintR: 1, tintG: 1, tintB: 1, glow: 0.15, glowSize: 0.8, glowNear: 0.3, glowMid: 0.6, glowFar: 0.1, glowThreshold: 2, contrast: 0.75, dirt: 0, fringe: 0.15,
    vignette: 0.15, soften: 1.8, sharpen: 0.5, sharpenRadius: 2.0, posterize: 0, grain: 0, lift: 0.02, lineChroma: 0, hueWobble: 0, streaks: 0, lens: 0, bars: true,
    // The video signal, fitted to the frames (scratchpad meas/metrics.py): brightness edges 3-4 px wide at 960 with no
    // halo, colour edges ~11 px, little fine texture but colour blotches in flat areas.
    chromaBlur: 5.2, chromaDelay: 0.4, lumaNoise: 0.025, chromaNoise: 0.13, codec: 0.035, codecRadius: 1.5,
    // a 1/50 s shutter: turning smears the picture (the video's frame 1 is smeared ~9 px sideways)
    motionBlur: 20,
  },
});
