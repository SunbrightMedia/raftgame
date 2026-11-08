/**
 * Generates maps/mall_hall.json: a test room for the lighting/camera work,
 * laid out after the first two frames of the "Mall Run" reference (lighting
 * study only; textures are original). Run: npm run gen:mall
 *
 *   - Room A (spawn): gold wallpaper, maroon flecked carpet, drop ceiling,
 *     2×4 troffers, one row close to the front wall so its top blows out.
 *   - Front wall: thick partitions with a wide full-height opening into
 *   - Corridor B: two rows of troffers running away, wider than the opening.
 *   - Hall C: a cross hall at the far end, exit sign on the far wall.
 * Dark rubber cove base everywhere. Units are inches; Z is up.
 */
import { writeFileSync } from 'node:fs';
import { type BrushDef, type EntityDef, type FaceTex, type V3, MAP_FORMAT, MAP_VERSION, serializeMap } from '../src/data/map';

const brushes: BrushDef[] = [];
const entities: EntityDef[] = [];
let nextId = 1;
function box(min: V3, max: V3, tex: string, o: { faces?: Record<string, FaceTex>; solid?: boolean } = {}): void {
  brushes.push({ id: nextId++, type: 'box', min, max, tex, ...(o.faces ? { faces: o.faces } : {}), ...(o.solid === false ? { solid: false } : {}) } as BrushDef);
}

const H = 108, W = 8, T = 16;
const PAPER = 'mall/wallpaper_gold', CARPET = 'mall/carpet_maroon', CEIL = 'office/ceiling', BASE = 'commercial/cove_base_plum';

function slab(x0: number, y0: number, x1: number, y1: number): void {
  box([x0, y0, -T], [x1, y1, 0], CARPET);
  box([x0, y0, H], [x1, y1, H + T], CEIL);
}
/** 2×4 troffer flush under the ceiling, texture fitted once (24 wide in x, 48 long in y). */
function troffer(x0: number, y0: number): void {
  box([x0, y0, H - 1], [x0 + 24, y0 + 48, H], 'mall/troffer', { solid: false, faces: { nz: { offset: [-x0 / 1, (y0 + 48) / 1] } } });
}
/** Cove base along an inner wall face: side is the direction the face looks. */
function base(side: 'px' | 'nx' | 'py' | 'ny', at: number, a: number, b: number): void {
  const h = 4, t = 0.5;
  if (side === 'px') box([at, a, 0], [at + t, b, h], BASE);
  if (side === 'nx') box([at - t, a, 0], [at, b, h], BASE);
  if (side === 'py') box([a, at, 0], [b, at + t, h], BASE);
  if (side === 'ny') box([a, at - t, 0], [b, at, h], BASE);
}

// ---- Room A: x 0..400, y 0..300
slab(-W, -W, 400 + W, 312);
box([-W, -W, 0], [400 + W, 0, H], PAPER);          // back
box([-W, 0, 0], [0, 300, H], PAPER);                // left
box([400, 0, 0], [400 + W, 300, H], PAPER);         // right
box([-W, 300, 0], [140, 312, H], PAPER);            // front partitions, 12" thick
box([260, 300, 0], [400 + W, 312, H], PAPER);
base('py', 0, 0, 400); base('px', 0, 0.5, 299.5); base('nx', 400, 0.5, 299.5);
base('ny', 300, 0, 140); base('ny', 300, 260, 400);
for (const y of [60, 230]) for (const x of [48, 188, 328]) troffer(x, y);

// ---- Corridor B: x 100..300, y 312..992
slab(100 - W, 312, 300 + W, 1000 - W);
box([100 - W, 312, 0], [100, 1000 - W, H], PAPER);
box([300, 312, 0], [300 + W, 1000 - W, H], PAPER);
base('px', 100, 312.5, 992); base('nx', 300, 312.5, 992);
base('py', 312, 100.5, 140); base('py', 312, 260, 299.5);
for (let y = 360; y + 48 <= 992; y += 96) { troffer(140, y); troffer(236, y); }

// ---- Hall C: x -150..550, y 1000..1200
slab(-150 - W, 1000 - W, 550 + W, 1200 + W);
box([-150 - W, 1000 - W, 0], [100, 1000, H], PAPER);
box([300, 1000 - W, 0], [550 + W, 1000, H], PAPER);
box([-150 - W, 1200, 0], [550 + W, 1200 + W, H], PAPER);
box([-150 - W, 1000, 0], [-150, 1200, H], PAPER);
box([550, 1000, 0], [550 + W, 1200, H], PAPER);
base('py', 1000, -150, 100); base('py', 1000, 300, 550); base('ny', 1200, -150, 550);
base('px', -150, 1000.5, 1199.5); base('nx', 550, 1000.5, 1199.5);
for (let x = -110; x + 24 <= 550; x += 96) troffer(x, 1076);
// Exit sign near the ceiling on the far wall, right of the corridor.
box([420, 1198, 92], [432, 1200, 98], 'mall/exit_sign', { solid: false });

entities.push({ id: 1, class: 'player_start', origin: [200, 110, 0], angles: [0, 90, 0] });

writeFileSync(new URL('../maps/mall_hall.json', import.meta.url), serializeMap({
  format: MAP_FORMAT, version: MAP_VERSION, name: 'mall_hall', brushes, entities,
  settings: { light: { luxelSize: 12 } },
}));
console.log(`wrote maps/mall_hall.json: ${brushes.length} brushes, ${entities.length} entities`);
