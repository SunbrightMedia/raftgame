/**
 * Look check for the industrial world: the faults an eye catches at once,
 * found without looking. From eye points along every walk of the maze it
 * casts a fan of sight lines and checks:
 *
 *  1. See-through. The first surface a sight line meets must be one that is
 *     drawn. (A face with no texture, or one the engine judged hidden and
 *     dropped, shows as a hole: you see into the wall or through the stairs.)
 *  2. The floor. Where the feet stand on a brush, a drawn floor must lie
 *     under them (not far below, not above).
 *  3. Lamp light. What the lamp grid gives at the point must agree with the
 *     truth: for each lamp inside a mass, is the straight line from it to the
 *     point free of walls? Light through a wall or a floor is a leak; light
 *     missing in plain sight of the lamp is a cut (a hard edge with no cause).
 *
 * It also reports the lamp grid's own counts (lamps in no box of air, walls
 * too thin to stop the light) and how much of the open lamps' light falls
 * where a mass stands in the way (they have no shadows yet).
 *
 *   npx vite-node tools/world/look.ts -- [seed] [--step 128] [--json out.json]
 *
 * Each fault is listed with a studio pose ("x,y,z,yaw,pitch", z = the feet)
 * that looks straight at it.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { parseMap, serializeMap } from '../../src/data/map';
import { buildFaces, faceId, solidPlanes } from '../../src/engine/light/faces';
import { propSolids, type PropShape } from '../../src/engine/collision/props';
import { buildLightGrid, gridLightAt, lampGives, LAMP_TEXELS } from '../../src/engine/render/lightGridCore';
import { mapLamps } from '../../src/engine/render/mapLamps';
import { RayWorld, type RayBrush } from '../../src/world/check/rays';
import { industrial, GEOMETRY_SETTINGS } from '../../src/world/industrial/world';

const args = process.argv.slice(2).filter((a) => a !== '--');
const seed = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const opt = (name: string, d: number) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : d);
const STEP = opt('--step', 128);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const FAR = 2600, EYE = GEOMETRY_SETTINGS.hull.eyeHeight;
const AMBIENT = GEOMETRY_SETTINGS.light.lampAmbient;
const t0 = performance.now();

const made = industrial(seed);
const lay = made.layout;
const map = parseMap(JSON.parse(serializeMap(made.map.toMap('industrial', GEOMETRY_SETTINGS))));

// ---- the worlds the sight lines are cast against
const faces = buildFaces(map.brushes);
const kept = new Set(faces.map((f) => f.id));
const drawnBrush = new Set(faces.map((f) => f.brushId));
const toRay = (b: (typeof map.brushes)[number]): RayBrush => { const sp = solidPlanes(b); return { id: b.id, planes: sp.planes, min: sp.min, max: sp.max }; };
/** What is seen: every brush with a drawn face (solid or not). */
const vis = new RayWorld(map.brushes.filter((b) => drawnBrush.has(b.id)).map(toRay));
/** What stops light: the masses themselves (not steel sections, steps or other detail). */
const walls = new RayWorld(map.brushes.filter((b) => b.solid !== false && b.group !== 'clip' && b.group !== 'func_detail' && drawnBrush.has(b.id)).map(toRay));
const hulls = new Map<string, PropShape>();
if (existsSync('models')) {
  for (const f of readdirSync('models', { recursive: true }) as string[]) {
    if (!f.endsWith('.json')) continue;
    const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
    if (h.format === 'liminal-mesh') hulls.set(String(h.source).toLowerCase(), { hull: h.hull, collision: h.collision });
  }
}
const propBrushes: RayBrush[] = propSolids(map.entities, (m) => hulls.get(m.toLowerCase())).map((c) => ({ id: -1 - c.id, planes: c.planes.map((p) => ({ n: [p.n.x, p.n.y, p.n.z] as [number, number, number], d: p.d, face: 'prop' })), min: [c.min.x, c.min.y, c.min.z], max: [c.max.x, c.max.y, c.max.z] }));
/** What the feet stand on: solid brushes and the props' hulls. */
const phys = new RayWorld([...map.brushes.filter((b) => b.solid !== false).map(toRay), ...propBrushes]);
const props = new RayWorld(propBrushes);

const L = mapLamps(map.entities);
const grid = buildLightGrid(L.lamps, L.shades, L.airs)!;
// Lamps by place, to find those that reach a point.
const LCELL = 512, lampAt = new Map<string, number[]>();
L.lamps.forEach((l, i) => {
  for (let x = Math.floor((l.pos[0] - l.reach) / LCELL); x <= Math.floor((l.pos[0] + l.reach) / LCELL); x++)
    for (let y = Math.floor((l.pos[1] - l.reach) / LCELL); y <= Math.floor((l.pos[1] + l.reach) / LCELL); y++) {
      const k = `${x},${y}`, v = lampAt.get(k);
      if (v) v.push(i); else lampAt.set(k, [i]);
    }
});
const tBuilt = performance.now();

// ---- eye points: along every walk
const N = lay.params.size, LV = lay.params.levels, T = 128, LEVEL = 256;
const zOf = (l: number) => (l - Math.floor(LV / 2)) * LEVEL;
function waypoints(w: (typeof lay.walks)[number]): number[][] {
  const s = lay.segments[w.segment];
  const A = lay.junctions[s.a], B = lay.junctions[s.b];
  const n = s.tiles.length;
  const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
  const up = w.lb >= w.la;
  const i0 = lo === hi ? n : Math.floor((n - 4) / 2);
  const zAt = (i: number) => (i < i0 ? zOf(lo) : i >= i0 + 4 ? zOf(hi) : zOf(lo) + 32 + 64 * (i - i0));
  const pts = [[A.x * T + 64, A.y * T + 64, zOf(w.la)]];
  s.tiles.forEach(([x, y], k) => pts.push([x * T + 64, y * T + 64, zAt(up ? k : n - 1 - k)]));
  pts.push([B.x * T + 64, B.y * T + 64, zOf(w.lb)]);
  return pts;
}
void N;

interface Fault { kind: 'see-through' | 'floor' | 'leak' | 'cut'; pose: string; at: number[]; note: string; size: number }
const faults: Fault[] = [];
const seenKey = new Set<string>();
const count = { eyes: 0, rays: 0, lit: 0, behindProp: 0 };
const openLight = { all: 0, blocked: 0 };
const deg = (r: number) => Math.round((r * 180) / Math.PI);
const poseTo = (eye: number[], feetZ: number, p: number[]) => {
  const d = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  return `${Math.round(eye[0])},${Math.round(eye[1])},${Math.round(feetZ)},${deg(Math.atan2(d[1], d[0]))},${-deg(Math.atan2(d[2], Math.hypot(d[0], d[1])))}`;
};
const lum = (e: ArrayLike<number>) => Math.max(e[0], e[1], e[2]);
/** How many texels the shader reads to light one pixel at this point (what the lamp sum costs the graphics card). */
const reads = { points: 0, texels: 0, lamps: 0, worst: 0 };
function countReads(wp: number[], n: number[]): void {
  const ci = [0, 1, 2].map((k) => Math.floor((wp[k] + n[k] * 2 - grid.origin[k]) / [128, 128, 256][k]));
  reads.points++;
  if (ci.some((v, k) => v < 0 || v >= grid.dims[k])) return;
  const c = (ci[2] * grid.dims[1] + ci[1]) * grid.dims[0] + ci[0];
  let t = 1;
  for (let q = 0; q < grid.grid[c * 2 + 1]; q++) {
    const e = grid.grid[c * 2] + q, i = grid.list[e * 2], chain = grid.list[e * 2 + 1], o = i * LAMP_TEXELS * 4;
    t += 2;   // the entry, the lamp's place
    const d2 = (grid.lamps[o] - wp[0]) ** 2 + (grid.lamps[o + 1] - wp[1]) ** 2 + (grid.lamps[o + 2] - wp[2]) ** 2;
    if (d2 >= grid.lamps[o + 3] ** 2) continue;
    if (chain >= 0) t += 2 * grid.chains[chain * 4 + 3];
    t += 1 + (grid.lamps[o + 3] < 0 ? 2 : 0);
    reads.lamps++;
  }
  reads.texels += t;
  reads.worst = Math.max(reads.worst, t);
}

const YAWS = 12, PITCHES = [-70, -40, -20, -7, 0, 7, 20, 40, 70];
let turn = 0;
function lookFrom(x: number, y: number, zGuess: number): void {
  // Stand on whatever is there.
  const ground = phys.cast([x, y, zGuess + 40], [0, 0, -1], 140);
  if (!ground) return;
  const feet = ground.point[2], eye = [x, y, feet + EYE];
  count.eyes++;
  // The floor: on a brush, a drawn floor must be right under the feet.
  if (ground.plane.face !== 'prop') {
    const seen = vis.cast(eye, [0, 0, -1], EYE + 200);
    const dz = seen ? feet - seen.point[2] : Infinity;
    if (dz > 24 || dz < -8) {
      const k = `floor:${Math.round(x / 64)},${Math.round(y / 64)},${Math.round(feet / 64)}`;
      if (!seenKey.has(k)) { seenKey.add(k); faults.push({ kind: 'floor', pose: `${Math.round(x)},${Math.round(y)},${Math.round(feet)},0,60`, at: [x, y, feet], note: seen ? `the drawn floor is ${Math.round(dz)} under the feet` : 'no drawn floor under the feet', size: Math.min(999, Math.abs(dz)) }); }
    }
  }
  turn += 2.399963;
  const dirs: number[][] = [[0, 0, -1], [0, 0, 1]];
  for (let a = 0; a < YAWS; a++) for (const pd of PITCHES) {
    const yaw = turn + (a * 2 * Math.PI) / YAWS, p = (pd * Math.PI) / 180;
    dirs.push([Math.cos(yaw) * Math.cos(p), Math.sin(yaw) * Math.cos(p), Math.sin(p)]);
  }
  dirs.forEach((dir, n) => {
    count.rays++;
    const hit = vis.cast(eye, dir, FAR);
    if (!hit) return;
    const id = faceId(hit.brush.id, hit.plane.face as number);
    if (!kept.has(id)) {
      // A face that is not drawn. Hidden behind a prop's hull, it may never show: counted apart.
      const prop = props.cast(eye, dir, hit.t);
      if (prop) { count.behindProp++; return; }
      const k = `see:${id}`;
      if (!seenKey.has(k)) { seenKey.add(k); faults.push({ kind: 'see-through', pose: poseTo(eye, feet, hit.point), at: hit.point, note: `brush ${hit.brush.id} face ${hit.plane.face}, ${Math.round(hit.t)} away`, size: 1e6 / (hit.t + 1) }); }
      return;
    }
    if (n % 3 !== 0) return;
    // The light there: the grid's answer against the truth, lamp by lamp.
    const nrm = hit.plane.n, P = [hit.point[0] + nrm[0] * 0.5, hit.point[1] + nrm[1] * 0.5, hit.point[2] + nrm[2] * 0.5];
    const got = new Map<number, { e: number; shut: number }>();
    const E = gridLightAt(grid, P, nrm, [0, 0, 0], 0, (c) => got.set(c.lamp, { e: lum(c.e), shut: c.shut }));
    count.lit++;
    countReads(P, nrm);
    let leak = 0, cut = 0, worstLeak = -1, worstCut = -1, wl = 0, wc = 0;
    for (const i of lampAt.get(`${Math.floor(P[0] / LCELL)},${Math.floor(P[1] / LCELL)}`) ?? []) {
      const l = L.lamps[i];
      const want = lum(lampGives(grid, i, P, nrm));
      if (want <= 0) continue;
      const g = got.get(i);
      if (!l.indoor && !l.box) {
        // A lamp in the open has no shadows: only note how much of its light a mass should have stopped.
        if (g) { openLight.all += g.e; if (!walls.clear(l.pos, P, 1)) openLight.blocked += g.e; }
        continue;
      }
      if (g && g.shut > 0.02 && g.shut < 0.98) continue;   // the soft edge of a shadow
      // A surface that faces away from the lamp gets only the light that stands in for bounce: not checked.
      const to = [l.pos[0] - P[0], l.pos[1] - P[1], l.pos[2] - P[2]], dist = Math.hypot(to[0], to[1], to[2]);
      if ((to[0] * nrm[0] + to[1] * nrm[1] + to[2] * nrm[2]) / dist < 0.05) continue;
      // The truth: how much wall lies on the straight line from the lamp. None: lit. A good thickness: dark.
      // Between the two it is the edge of a shadow, where the grid's soft edge and a hard line need not agree.
      // The same is asked of points a little to each side and a little off the surface: a line that only runs
      // along inside a wall's skin, or clips a corner, is an edge too.
      const have = g ? g.e : 0;
      const inWall = walls.solid(l.pos, P);
      if (inWall >= 1.5 && inWall < 12) continue;
      const open = inWall < 1.5;
      if (open ? have >= want - 1e-3 : have <= 1e-3) continue;   // the grid agrees
      const ta = Math.abs(nrm[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1], tb = [nrm[1] * ta[2] - nrm[2] * ta[1], nrm[2] * ta[0] - nrm[0] * ta[2], nrm[0] * ta[1] - nrm[1] * ta[0]];
      const around = [[ta, 3], [ta, -3], [tb, 3], [tb, -3], [nrm, 3]].map(([v, k]) => walls.solid(l.pos, [P[0] + (v as number[])[0] * (k as number), P[1] + (v as number[])[1] * (k as number), P[2] + (v as number[])[2] * (k as number)]));
      if (around.some((c) => (open ? c >= 1.5 : c < 12))) continue;
      const truth = open ? want : 0;
      if (have > truth + 1e-3) { leak += have - truth; if (have - truth > wl) { wl = have - truth; worstLeak = i; } }
      if (truth > have + 1e-3) { cut += truth - have; if (truth - have > wc) { wc = truth - have; worstCut = i; } }
    }
    const base = lum(E) + AMBIENT;
    if (leak > Math.max(8, 0.3 * base)) {
      const k = `leak:${worstLeak}:${Math.floor(P[0] / 128)},${Math.floor(P[1] / 128)},${Math.floor(P[2] / 256)}`;
      if (!seenKey.has(k)) {
        seenKey.add(k);
        const lp = L.lamps[worstLeak].pos, d = [P[0] - lp[0], P[1] - lp[1], P[2] - lp[2]], len = Math.hypot(d[0], d[1], d[2]);
        const stop = walls.cast(lp, d.map((v) => v / len), len - 1);
        faults.push({ kind: 'leak', pose: poseTo(eye, feet, hit.point), at: P, note: `lamp ${worstLeak} at ${lp.map(Math.round).join(',')} gives ${leak.toFixed(0)} through a wall (all light there: ${lum(E).toFixed(0)}) at ${P.map(Math.round).join(',')}${stop ? `; stopped by brush ${stop.brush.id} [${stop.brush.min.map(Math.round).join(',')} .. ${stop.brush.max.map(Math.round).join(',')}] ${Math.round(stop.t)} from the lamp of ${Math.round(len)}` : ''}`, size: leak });
      }
    }
    if (cut > Math.max(8, 0.3 * (base + cut))) {
      const k = `cut:${worstCut}:${Math.floor(P[0] / 128)},${Math.floor(P[1] / 128)},${Math.floor(P[2] / 256)}`;
      if (!seenKey.has(k)) {
        seenKey.add(k);
        const g = got.get(worstCut);
        faults.push({ kind: 'cut', pose: poseTo(eye, feet, hit.point), at: P, note: `lamp ${worstCut} at ${L.lamps[worstCut].pos.map(Math.round).join(',')} is in plain sight of ${P.map(Math.round).join(',')} (facing ${nrm.map((v) => Math.round(v)).join(',')}, brush ${hit.brush.id}) but ${cut.toFixed(0)} of its light is missing (light there: ${lum(E).toFixed(0)}; ${g ? `the grid gives ${g.e.toFixed(0)}, shut ${g.shut.toFixed(2)}` : 'the grid does not list it or its chain stops it'})`, size: cut });
      }
    }
  });
}

for (const w of lay.walks) {
  const pts = waypoints(w);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(len / STEP));
    for (let i = k === 1 ? 0 : 1; i <= n; i++) { const t = i / n; lookFrom(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }
  }
}

const s = grid.stats;
console.log(`seed ${seed}: ${count.eyes} eye points, ${count.rays} sight lines, light checked at ${count.lit} points; built in ${Math.round(tBuilt - t0)} ms, looked in ${Math.round(performance.now() - tBuilt)} ms`);
console.log(`lamp grid: ${s.lamps} lamps, ${s.airs} boxes of air, ${s.chains} chains (longest ${s.longest}, ${s.cut} cut short), ${s.full} cells over-full; ${s.lost} lamps in no box of air, ${s.thin} walls too thin`);
console.log(`cost of the lamp sum: ${(reads.texels / reads.points).toFixed(1)} texture reads a pixel on average (${(reads.lamps / reads.points).toFixed(1)} lamps in reach), ${reads.worst} at worst`);
if (openLight.all > 0) console.log(`open lamps (no shadows yet): ${Math.round((100 * openLight.blocked) / openLight.all)}% of their light at the checked points falls where a mass stands in the way`);
if (count.behindProp) console.log(`${count.behindProp} sight lines met an undrawn face behind a prop's hull (not counted)`);
for (const p of grid.thinAt.slice(0, 6)) console.log(`  thin wall between two boxes of air at ${p.map(Math.round).join(',')}`);
for (const p of grid.lostAt.slice(0, 6)) console.log(`  a lamp inside a mass but in no box of air at ${p.map(Math.round).join(',')}`);
const kinds = ['see-through', 'floor', 'leak', 'cut'] as const;
const bad = faults.length + s.lost + s.thin;
console.log(bad ? `${faults.length} FAULTS: ${kinds.map((k) => `${faults.filter((f) => f.kind === k).length} ${k}`).join(', ')}` : 'nothing wrong to see');
for (const k of kinds) for (const f of faults.filter((f) => f.kind === k).sort((a, b) => b.size - a.size).slice(0, 8)) console.log(`  ${f.kind}: ${f.note}\n      look: "${f.pose}"`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ seed, count, grid: s, openLight, faults }, null, 1));
process.exit(bad ? 1 : 0);
