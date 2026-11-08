/**
 * Generates maps/test_room.json. Run: npm run gen:testmap
 *
 * Hand-authoring dozens of boxes in JSON is tedious, so the Milestone 1 test
 * map is built in code. From Milestone 2 on, maps are made in the editor.
 */
import { writeFileSync } from 'node:fs';
import { type BoxBrushDef, type EntityDef, type FaceKey, type FaceTex, type V3, MAP_FORMAT, MAP_VERSION, serializeMap } from '../src/data/map';

const brushes: BoxBrushDef[] = [];
const entities: EntityDef[] = [];
let nextId = 1;

function box(min: V3, max: V3, tex: string, opts: { faces?: Partial<Record<FaceKey, FaceTex>>; group?: string; solid?: boolean } = {}): void {
  const b: BoxBrushDef = { id: nextId++, type: 'box', min, max, tex };
  if (opts.faces) b.faces = opts.faces;
  if (opts.group) b.group = opts.group;
  if (opts.solid === false) b.solid = false;
  brushes.push(b);
}

/**
 * A wall running along `axis` from `a` to `b`, `t` thick on the other axis
 * starting at `at`, from z0 to z1, with door gaps [from, to, height].
 */
function wall(axis: 'x' | 'y', a: number, b: number, at: number, t: number, z0: number, z1: number, tex: string, doors: [number, number, number][] = []): void {
  const mk = (s: number, e: number, lo: number, hi: number) => {
    if (e <= s || hi <= lo) return;
    if (axis === 'x') box([s, at, lo], [e, at + t, hi], tex);
    else box([at, s, lo], [at + t, e, hi], tex);
  };
  let cur = a;
  for (const [s, e, h] of [...doors].sort((p, q) => p[0] - q[0])) {
    mk(cur, s, z0, z1);
    mk(s, e, z0 + h, z1); // header above the door
    cur = e;
  }
  mk(cur, b, z0, z1);
}

/**
 * A ceiling light fixture with its texture fitted to the underside exactly
 * once (world-aligned UVs would otherwise cut it at arbitrary places).
 */
function lightPanel(x0: number, y0: number, x1: number, y1: number, zTop: number): void {
  const T = 48; // office/lightpanel texture size
  const sx = (x1 - x0) / T, sy = (y1 - y0) / T;
  // Underside (nz): u = x, v = -y. Shift so the texture starts at the brush corner.
  box([x0, y0, zTop - 1], [x1, y1, zTop], 'office/lightpanel', { solid: false, faces: { nz: { scale: [sx, sy], offset: [-x0 / sx, y1 / sy] } } });
}

/** Floor + ceiling slabs for an interior volume. */
function slabs(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, floor: string, ceil: string, t = 16): void {
  box([x0, y0, z0 - t], [x1, y1, z0], floor);
  box([x0, y0, z1], [x1, y1, z1 + t], ceil);
}

const W = 16; // wall thickness
const WALL = 'office/plaster', CARPET = 'office/carpet_blue', CEIL = 'office/ceiling';

// ---------------------------------------------------------------- office floor
// 1536 x 1024, 112 tall (a little too tall for a drop ceiling: on purpose).
{
  const X0 = 0, X1 = 1536, Y0 = 0, Y1 = 1024, H = 112;
  slabs(X0 - W, Y0 - W, X1 + W, Y1 + W, 0, H, CARPET, CEIL);
  wall('x', X0 - W, X1 + W, Y0 - W, W, 0, H, WALL);
  wall('x', X0 - W, X1 + W, Y1, W, 0, H, WALL, [[704, 800, 96]]); // door north → long corridor
  wall('y', Y0, Y1, X0 - W, W, 0, H, WALL);
  wall('y', Y0, Y1, X1, W, 0, H, WALL, [[448, 576, 104]]); // door east → test hall

  // Pillars on a 384 grid.
  for (let x = 384; x < X1; x += 384) for (let y = 256; y < Y1; y += 512) box([x - 16, y - 16, 0], [x + 16, y + 16, H], WALL);
  // Light panels: thin, non-solid, flush under the ceiling.
  for (let x = 192; x < X1; x += 384) for (let y = 128; y < Y1; y += 256) lightPanel(x - 24, y - 48, x + 24, y + 48, H);
  // Low cubicle partitions, 48 tall: you can jump on them (and walk the tops).
  for (let i = 0; i < 3; i++) {
    const x = 480 + i * 256;
    box([x, 96, 0], [x + 8, 352, 48], 'office/carpet_beige', { faces: { pz: { tex: 'office/trim' } } });
    box([x, 96, 0], [x + 160, 104, 48], 'office/carpet_beige', { faces: { pz: { tex: 'office/trim' } } });
  }
  // Baseboard trim around the room as a scale cue.
  box([X0, Y0, 0], [X1, Y0 + 2, 4], 'office/trim', { solid: false });
  box([X0, Y1 - 2, 0], [704, Y1, 4], 'office/trim', { solid: false });
  box([800, Y1 - 2, 0], [X1, Y1, 4], 'office/trim', { solid: false });
}

// ------------------------------------------------------------ the long corridor
// North out of the office: 96 wide, 2048 long, ending in a small dead-end room.
// (Milestone 4 makes it longer than it should be.)
{
  const X0 = 704, X1 = 800, Y0 = 1040, Y1 = 3088, H = 96;
  slabs(X0 - W, Y0, X1 + W, Y1, 0, H, 'office/carpet_yellow', 'office/ceiling_vent');
  wall('y', Y0, Y1, X0 - W, W, 0, H, 'house/wallpaper_motif');
  wall('y', Y0, Y1, X1, W, 0, H, 'house/wallpaper_motif');
  for (let y = Y0 + 128; y < Y1; y += 256) lightPanel(X0 + 24, y - 24, X1 - 24, y + 24, H);
  // End room.
  // End room: a suburban kitchen, lit by one warm lamp instead of fluorescents.
  const R0x = 560, R1x = 944, R0y = Y1, R1y = Y1 + 384, RH = 104;
  const PAPER = 'house/wallpaper_stripe';
  slabs(R0x - W, R0y, R1x + W, R1y + W, 0, RH, 'house/tile_checker', 'office/plaster');
  wall('x', R0x - W, R1x + W, R0y - W, W, 0, RH, PAPER, [[X0, X1, H]]);
  wall('x', R0x - W, R1x + W, R1y, W, 0, RH, PAPER);
  wall('y', R0y, R1y, R0x - W, W, 0, RH, PAPER);
  wall('y', R0y, R1y, R1x, W, 0, RH, PAPER);
  // Counters along the back wall, with a wood-paneled front.
  box([R0x, R1y - 24, 0], [R1x, R1y, 36], 'house/paneling', { faces: { pz: { tex: 'house/tile_white' } } });
  // A table in the middle.
  box([R0x + 152, R0y + 152, 28], [R0x + 232, R0y + 232, 30], 'house/woodfloor');
  box([R0x + 188, R0y + 188, 0], [R0x + 196, R0y + 196, 28], 'house/woodfloor');
  entities.push({ id: 2000, class: 'light', origin: [R0x + 192, R0y + 192, RH - 14], props: { color: '#ffcf8f', intensity: 1.6, fifty: 120 } });
}

// ------------------------------------------------------------- movement test hall
// East of the office. Tall, dev-textured, labelled by layout:
//   south row: step tests 8/16/18/20/24 (18 is the max step)
//   middle:    stairs to a 64-high mezzanine
//   north row: jump tests 32/48/56/64/72 (57 standing, ~66 crouch-jump)
//   a 48-high crawlspace (crouch)
//   the rest: 2000 units of open floor for bhop / strafing
{
  const X0 = 1552, X1 = 3600, Y0 = 0, Y1 = 1024, H = 384;
  slabs(X0, Y0 - W, X1 + W, Y1 + W, 0, H, 'ind/concrete_floor', 'ind/concrete_forms');
  wall('x', X0, X1 + W, Y0 - W, W, 0, H, 'ind/cinderblock');
  wall('x', X0, X1 + W, Y1, W, 0, H, 'ind/cinderblock');
  wall('y', Y0, Y1, X1, W, 0, H, 'ind/cinderblock');
  // The office's east wall is only 112 tall; close the hall above it.
  box([1536, -16, 112], [1552, 1040, H], 'ind/cinderblock');
  // Cold work lights up in the rafters.
  let lid = 3000;
  for (let x = 1800; x < X1; x += 512) for (const y of [256, 768]) entities.push({ id: lid++, class: 'light', origin: [x, y, H - 24], props: { color: '#dde6f0', intensity: 2.6, fifty: 300, emit: 'down' } });

  // Step tests.
  const steps = [8, 16, 18, 20, 24];
  steps.forEach((h, i) => box([1664 + i * 128, 32, 0], [1664 + i * 128 + 96, 128, h], i < 3 ? 'dev/green' : 'dev/orange'));

  // Jump tests.
  const jumps = [32, 48, 56, 64, 72];
  jumps.forEach((h, i) => box([1664 + i * 128, 896, 0], [1664 + i * 128 + 96, 992, h], 'dev/blue'));

  // Stairs: 8 steps of 8 up × 16 deep, then a mezzanine.
  for (let i = 0; i < 8; i++) box([2400 + i * 16, 384, 0], [2400 + (i + 1) * 16, 640, (i + 1) * 8], 'dev/white');
  box([2528, 384, 0], [2784, 640, 64], 'dev/gray');
  // ...and down the other side, 16 high steps × 24 deep (steeper, still under step height).
  for (let i = 0; i < 3; i++) box([2784 + i * 24, 384, 0], [2784 + (i + 1) * 24, 640, 64 - (i + 1) * 16], 'dev/white');

  // Crawlspace: 256 long, 48 tall. You must crouch to get through.
  box([3000, 768, 48], [3256, 896, 64], 'ind/metal_corrugated'); // roof
  box([3000, 752, 0], [3256, 768, 64], 'ind/metal_corrugated');
  box([3000, 896, 0], [3256, 912, 64], 'ind/metal_corrugated');

  // A low wall to vault and a ledge to slide along.
  box([3300, 64, 0], [3316, 640, 40], 'ind/diamondplate');
}

entities.push({ id: 1000, class: 'player_start', origin: [160, 512, 0], angles: [0, 0, 0] });

const map = { format: MAP_FORMAT, version: MAP_VERSION, name: 'test_room', brushes, entities } as const;
writeFileSync(new URL('../maps/test_room.json', import.meta.url), serializeMap({ ...map }));
console.log(`wrote maps/test_room.json: ${brushes.length} brushes`);
