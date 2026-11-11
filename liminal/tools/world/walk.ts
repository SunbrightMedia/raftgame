/**
 * Walk test for the industrial world: the player's own movement code is
 * driven along every walk of the maze (catwalk, stairs, corridor, stair
 * hall), both ways, over the world's real collision. Anything that stops the
 * player, drops them, or leaves them short is listed.
 *
 *   npx vite-node tools/world/walk.ts -- [seed] [--lots n] [--old] [--json out.json] [--max N]
 * (Which world: tools/world/made.ts. In a world of lots only the walks wholly in the built lots are walked.)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { parseMap, serializeMap } from '../../src/data/map';
import { solidPlanes } from '../../src/engine/light/faces';
import { CollisionWorld } from '../../src/engine/collision/trace';
import { convexBrush } from '../../src/engine/collision/brush';
import { propSolids, type PropShape } from '../../src/engine/collision/props';
import { v3, type Vec3 } from '../../src/engine/vec3';
import { PlayerMove, DEFAULT_MOVE, newPlayerState, type UserCmd } from '../../src/engine/movement/pmove';
import { GEOMETRY_SETTINGS } from '../../src/world/industrial/world';
import { toolWorld, walkTiles } from './made';

const t0 = performance.now();
const tw = toolWorld();
const { seed, made, rest: args } = tw;
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const lay = made.layout;
const map = parseMap(JSON.parse(serializeMap(made.map.toMap('industrial', GEOMETRY_SETTINGS))));
const P = { ...DEFAULT_MOVE, ...GEOMETRY_SETTINGS.hull };
const hulls = new Map<string, PropShape>();
if (existsSync('models')) {
  for (const f of readdirSync('models', { recursive: true }) as string[]) {
    if (!f.endsWith('.json')) continue;
    const h = JSON.parse(readFileSync(`models/${f}`, 'utf8'));
    if (h.format === 'liminal-mesh') hulls.set(String(h.source).toLowerCase(), { hull: h.hull, collision: h.collision });
  }
}
const world = new CollisionWorld([
  ...map.brushes.filter((b) => b.solid !== false).map((b) => {
    const sp = solidPlanes(b);
    return convexBrush(b.id, sp.planes.map((p) => ({ n: v3(...p.n), d: p.d })), v3(...b.min), v3(...b.max));
  }),
  ...propSolids(map.entities, (m) => hulls.get(m.toLowerCase())),
]);
const tBuilt = performance.now();

const N = lay.params.size, L = lay.params.levels, LEVEL = 256;
const zOf = (l: number) => (l - Math.floor(L / 2)) * LEVEL;
const blockOf = (x: number, y: number) => lay.tileBlock[y * N + x];
const DT = 1 / 66;
const pm = new PlayerMove(world);

interface Fail { walk: number; segment: number; where: 'street' | 'tunnel'; stairs: boolean; dir: 'ab' | 'ba'; reason: string; at: number[]; target: number[] }
const fails: Fail[] = [];
const count = { street: 0, tunnel: 0, streetStairs: 0, tunnelStairs: 0 };

/** Waypoints of a walk from its a end to its b end: feet positions. */
function waypoints(w: (typeof lay.walks)[number]): Vec3[] {
  const s = lay.segments[w.segment];
  const A = lay.junctions[s.a], B = lay.junctions[s.b];
  const n = s.tiles.length;
  const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
  // The stairs take four tiles in the middle, counted from the low end.
  const up = w.lb >= w.la;
  const i0 = lo === hi ? n : Math.floor((n - 4) / 2);
  const zAt = (i: number) => {            // i counted from the low end
    if (i < i0) return zOf(lo);
    if (i >= i0 + 4) return zOf(hi);
    return zOf(lo) + 32 + 64 * (i - i0);
  };
  const pts: Vec3[] = [v3(tw.px(A.x), tw.py(A.y), zOf(w.la))];
  s.tiles.forEach(([x, y], k) => pts.push(v3(tw.px(x), tw.py(y), zAt(up ? k : n - 1 - k))));
  pts.push(v3(tw.px(B.x), tw.py(B.y), zOf(w.lb)));
  return pts;
}

function walk(pts: Vec3[]): { ok: boolean; reason: string; at: Vec3; target: Vec3 } {
  const ps = newPlayerState(v3(pts[0].x, pts[0].y, pts[0].z + 2));
  const idle: UserCmd = { forward: 0, side: 0, up: 0, jump: false, duck: false, speed: 'run', pitch: 0, yaw: 0 };
  for (let i = 0; i < 20; i++) pm.step(ps, idle, P, DT);
  if (!ps.onGround) return { ok: false, reason: 'no floor at the start', at: ps.origin, target: pts[0] };
  for (let k = 1; k < pts.length; k++) {
    const t = pts[k];
    const dist0 = Math.hypot(t.x - ps.origin.x, t.y - ps.origin.y);
    const limit = Math.ceil((dist0 / P.runSpeed) * 66 * 3) + 80;
    let best = dist0, since = 0;
    for (let i = 0; ; i++) {
      const dx = t.x - ps.origin.x, dy = t.y - ps.origin.y, d = Math.hypot(dx, dy);
      if (d < 10) break;
      if (i > limit) return { ok: false, reason: 'too slow', at: ps.origin, target: t };
      if (ps.origin.z < t.z - 100) return { ok: false, reason: 'fell', at: ps.origin, target: t };
      if (d < best - 0.5) { best = d; since = 0; } else if (++since > 40) return { ok: false, reason: 'blocked', at: ps.origin, target: t };
      pm.step(ps, { ...idle, forward: 1, yaw: (Math.atan2(dy, dx) * 180) / Math.PI }, P, DT);
    }
    if (Math.abs(ps.origin.z - t.z) > 40) return { ok: false, reason: `wrong height (${Math.round(ps.origin.z - t.z)})`, at: ps.origin, target: t };
  }
  return { ok: true, reason: '', at: ps.origin, target: pts[pts.length - 1] };
}

const maxArg = args.includes('--max') ? Number(args[args.indexOf('--max') + 1]) : Infinity;
let walked = 0;
lay.walks.forEach((w, wi) => {
  if (wi >= maxArg || !tw.built(walkTiles(made, w))) return;
  walked++;
  const s = lay.segments[w.segment];
  const stairs = w.la !== w.lb;
  const where = s.tunnel ? 'tunnel' : 'street';
  count[(where + (stairs ? 'Stairs' : '')) as keyof typeof count]++;
  const pts = waypoints(w);
  for (const dir of ['ab', 'ba'] as const) {
    const r = walk(dir === 'ab' ? pts : [...pts].reverse());
    if (!r.ok) fails.push({ walk: wi, segment: w.segment, where, stairs, dir, reason: r.reason, at: [r.at.x, r.at.y, r.at.z].map(Math.round), target: [r.target.x, r.target.y, r.target.z].map(Math.round) });
  }
});
void blockOf;

const by = new Map<string, number>();
for (const f of fails) { const k = `${f.where}${f.stairs ? ' stairs' : ''}: ${f.reason.replace(/\(.*\)/, '')}`; by.set(k, (by.get(k) ?? 0) + 1); }
console.log(`seed ${seed}: ${walked} walks (${count.street} street, ${count.streetStairs} street stairs, ${count.tunnel} tunnel, ${count.tunnelStairs} tunnel stairs), both ways`);
console.log(`world built in ${Math.round(tBuilt - t0)} ms, walked in ${Math.round(performance.now() - tBuilt)} ms`);
console.log(fails.length ? `${fails.length} FAILED` : 'all walks pass');
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`);
for (const f of fails.slice(0, 12)) console.log(`  walk ${f.walk} seg ${f.segment} ${f.where}${f.stairs ? ' stairs' : ''} ${f.dir}: ${f.reason} at ${f.at.join(',')} → ${f.target.join(',')}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ seed, count, fails }, null, 1));
process.exit(fails.length ? 1 : 0);
