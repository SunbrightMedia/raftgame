/**
 * Map checks in code, no rendering: what can be measured shouldn't be judged
 * from screenshots.  Run: npm run check -- maps/blank.json [--json out.json]
 *
 *  - reachability: every floor spot the player's hull fits on, walked from the
 *    spawn with the real step height (jumps not counted, so this is the
 *    walking network); unreachable areas are listed with their bounds;
 *  - headroom: spots where only a crouching player fits;
 *  - leaks: open space flooded from the spawn; reaching outside the map's
 *    bounds means a hole to the void (expected on maps with an open sky).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { parseMap } from '../../src/data/map';
import { solidPlanes, buildFaces, facePoint, inFace } from '../../src/engine/light/faces';
import { CollisionWorld } from '../../src/engine/collision/trace';
import { convexBrush } from '../../src/engine/collision/brush';
import { propSolids } from '../../src/engine/collision/props';
import { v3, type Vec3 } from '../../src/engine/vec3';
import { DEFAULT_MOVE, hullMins, hullMaxs } from '../../src/engine/movement/pmove';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--')) ?? 'maps/blank.json';
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const t0 = performance.now();

const map = parseMap(JSON.parse(readFileSync(path, 'utf8')));
const hullOver = ((map.settings as Record<string, unknown> | undefined)?.hull ?? {}) as Partial<typeof DEFAULT_MOVE>;
const P = { ...DEFAULT_MOVE, ...hullOver };
// Prop hulls from the converted models' headers (models/**/*.json, keyed by the name maps use).
const hulls = new Map<string, [[number, number, number], [number, number, number]]>();
if (existsSync('models')) {
  for (const f of readdirSync('models', { recursive: true }) as string[]) {
    if (!f.endsWith('.json')) continue;
    const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
    if (h.format === 'liminal-mesh') hulls.set(String(h.source).toLowerCase(), h.hull);
  }
}
const hullOf = (m: string) => hulls.get(m.toLowerCase());
const world = new CollisionWorld([
  ...map.brushes.filter((b) => b.solid !== false).map((b) => {
    const sp = solidPlanes(b);
    return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...b.min), v3(...b.max));
  }),
  ...propSolids(map.entities, hullOf),
]);
const MINS = hullMins(P), STAND = hullMaxs(P, false), DUCK = hullMaxs(P, true);
const STEP = P.stepHeight, G = 16;

const spawn = map.entities.find((e) => e.class === 'player_start');
const so = spawn ? v3(...spawn.origin) : v3(0, 0, 64);
// ---- 1. leaks: flood open space from the spawn on a coarse grid
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const b of map.brushes) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], b.min[k]); hi[k] = Math.max(hi[k], b.max[k]); }
const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
const C = Math.max(16, Math.ceil(Math.cbrt(vol / 400000) / 4) * 4);   // ≤ ~400k cells
const nx = Math.ceil((hi[0] - lo[0]) / C) + 2, ny = Math.ceil((hi[1] - lo[1]) / C) + 2, nz = Math.ceil((hi[2] - lo[2]) / C) + 2;
const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
const flood = new Uint8Array(nx * ny * nz);
const centre = (i: number, j: number, k: number) => v3(lo[0] + (i - 0.5) * C, lo[1] + (j - 0.5) * C, lo[2] + (k - 0.5) * C);
const small = v3(-1, -1, -1), smallMax = v3(1, 1, 1);
let leak: number[] | null = null;
{
  const si = Math.floor((so.x - lo[0]) / C) + 1, sj = Math.floor((so.y - lo[1]) / C) + 1, sk = Math.floor((so.z + 32 - lo[2]) / C) + 1;
  const st = [[si, sj, sk]];
  flood[idx(si, sj, sk)] = 1;
  while (st.length) {
    const [i, j, k] = st.pop()!;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      if (flood[idx(a, b, c)]) continue;
      // Open between the two cell centres?
      if (world.trace(centre(i, j, k), centre(a, b, c), small, smallMax).fraction < 1) continue;
      flood[idx(a, b, c)] = 1;
      if (a === 0 || b === 0 || c === 0 || a === nx - 1 || b === ny - 1 || c === nz - 1) { leak ??= [...Object.values(centre(i, j, k))].map(Math.round); continue; }
      st.push([a, b, c]);
    }
  }
}

// Only spots in the open space connected to the spawn count (checked at chest height, any of the 8 nearest cells).
const inOpenSpace = (o: Vec3) => {
  const fx = (o.x - lo[0]) / C + 0.5, fy = (o.y - lo[1]) / C + 0.5, fz = (o.z + 36 - lo[2]) / C + 0.5;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    const i = Math.floor(fx) + a, j = Math.floor(fy) + b, k = Math.floor(fz) + c;
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && flood[idx(i, j, k)]) return true;
  }
  return false;
};

// ---- 2. candidate standing spots on every walkable face (normal z ≥ 0.7)
type Spot = { p: Vec3; crouch: boolean; i: number };
const spots: Spot[] = [];
const byCell = new Map<string, Spot[]>();
const seen = new Set<string>();
for (const f of buildFaces(map.brushes)) {
  if (!f.solid || f.n[2] < 0.7) continue;
  // Grid points in world x/y over the face: walk its (s, t) rectangle finely, snap to the world grid.
  const ns = Math.max(1, Math.ceil(f.width / (G / 2))), nt = Math.max(1, Math.ceil(f.height / (G / 2)));
  for (let i = 0; i <= ns; i++) for (let j = 0; j <= nt; j++) {
    const s = Math.min(f.width - 0.01, Math.max(0.01, (f.width * i) / ns)), t = Math.min(f.height - 0.01, Math.max(0.01, (f.height * j) / nt));
    if (!inFace(f, s, t)) continue;
    const q = facePoint(f, s, t);
    const x = Math.round(q[0] / G) * G, y = Math.round(q[1] / G) * G;
    const k = `${x},${y},${Math.round(q[2] / 4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // Feet just above the surface at the snapped x, y: find the floor height there by a short trace down.
    const top = v3(x, y, q[2] + STEP + 1), down = world.trace(top, v3(x, y, q[2] - STEP), MINS, v3(MINS.x * -1, MINS.y * -1, 1));
    if (down.startsolid || down.fraction >= 1) continue;
    const o = v3(x, y, down.endpos.z + 0.25);
    if (!inOpenSpace(o)) continue;                       // outside the playable space (e.g. the top of a ceiling)
    if (!world.testPosition(o, MINS, STAND)) spots.push({ p: o, crouch: false, i: spots.length });
    else if (!world.testPosition(o, MINS, DUCK)) spots.push({ p: o, crouch: true, i: spots.length });
  }
}
for (const s of spots) {
  const k = `${s.p.x / G},${s.p.y / G}`;
  (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(s);
}

// ---- 3. walking edges: step up ≤ step height, any drop; the move itself must be clear
const can = (a: Spot, b: Spot): boolean => {
  if (b.p.z - a.p.z > STEP + 0.5) return false;
  const maxs = a.crouch || b.crouch ? DUCK : STAND;
  const lift = Math.max(a.p.z, b.p.z) + STEP;
  if (world.trace(a.p, v3(a.p.x, a.p.y, lift), MINS, maxs).fraction < 1) return false;
  if (world.trace(v3(a.p.x, a.p.y, lift), v3(b.p.x, b.p.y, lift), MINS, maxs).fraction < 1) return false;
  return world.trace(v3(b.p.x, b.p.y, lift), b.p, MINS, maxs).fraction >= 0.999 || world.testPosition(b.p, MINS, maxs) === false;
};
let start: Spot | null = null;
for (const s of spots) if (!start || Math.hypot(s.p.x - so.x, s.p.y - so.y, (s.p.z - so.z) * 2) < Math.hypot(start.p.x - so.x, start.p.y - so.y, (start.p.z - so.z) * 2)) start = s;
const reached = new Uint8Array(spots.length);
if (start) {
  const queue = [start];
  reached[start.i] = 1;
  while (queue.length) {
    const a = queue.pop()!;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      for (const b of byCell.get(`${a.p.x / G + dx},${a.p.y / G + dy}`) ?? []) {
        if (reached[b.i] || !can(a, b)) continue;
        reached[b.i] = 1;
        queue.push(b);
      }
    }
  }
}

// ---- 4. group the unreachable and crouch-only spots into areas (8-neighbour, similar height)
const areas = (pick: (s: Spot) => boolean) => {
  const done = new Uint8Array(spots.length), out: { n: number; min: number[]; max: number[] }[] = [];
  for (const s of spots) {
    if (done[s.i] || !pick(s)) continue;
    const a = { n: 0, min: [s.p.x, s.p.y, s.p.z], max: [s.p.x, s.p.y, s.p.z] }, st = [s];
    done[s.i] = 1;
    while (st.length) {
      const c = st.pop()!;
      a.n++;
      for (let k = 0; k < 3; k++) { const v = [c.p.x, c.p.y, c.p.z][k]; a.min[k] = Math.min(a.min[k], v); a.max[k] = Math.max(a.max[k], v); }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const b of byCell.get(`${c.p.x / G + dx},${c.p.y / G + dy}`) ?? [])
          if (!done[b.i] && pick(b) && Math.abs(b.p.z - c.p.z) <= STEP + 0.5) { done[b.i] = 1; st.push(b); }
    }
    out.push(a);
  }
  return out.sort((p, q) => q.n - p.n).map((a) => ({ ...a, min: a.min.map(Math.round), max: a.max.map(Math.round), sqft: Math.round((a.n * G * G) / 144) }));
};
const unreachable = areas((s) => !reached[s.i]);
const crouchOnly = areas((s) => s.crouch);

const nReach = reached.reduce((s, v) => s + v, 0);
const result = {
  map: path, ms: Math.round(performance.now() - t0), brushes: map.brushes.length,
  walkable_spots: spots.length, reachable_pct: spots.length ? Math.round((nReach / spots.length) * 1000) / 10 : 0,
  unreachable: unreachable.slice(0, 12), crouch_only: crouchOnly.slice(0, 12),
  leak: leak ? { near: leak, note: 'open space from the spawn reaches outside the map bounds (fine if the map has an open sky)' } : null,
};
console.log(`${path}: ${result.walkable_spots} floor spots, ${result.reachable_pct}% reachable on foot from the spawn (${result.ms} ms)`);
for (const a of result.unreachable) console.log(`  unreachable area ~${a.sqft} sq ft, x ${a.min[0]}..${a.max[0]} y ${a.min[1]}..${a.max[1]} z ${a.min[2]}..${a.max[2]}`);
for (const a of result.crouch_only) console.log(`  crouch-only area ~${a.sqft} sq ft, x ${a.min[0]}..${a.max[0]} y ${a.min[1]}..${a.max[1]} z ${a.min[2]}..${a.max[2]}`);
console.log(leak ? `  leak: open to outside near ${leak.join(', ')}` : '  sealed: no leak to the outside');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
