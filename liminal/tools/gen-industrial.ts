/**
 * maps/industrial.json: "industrial world". Run: npm run gen:industrial
 *
 * A vertical forest of steel in grey fog (reference: a tower under
 * construction seen straight up, scaffold-clad shells, curved trusses and a
 * rack-rail climbing through the void). No lamps: the only light is a flat,
 * foggy overcast sky. Generated from a fixed seed:
 *   - a column grid (288" bays) running far above and below the fog,
 *   - girders hung between columns at every storey, Warren trusses spanning
 *     whole rows, curved truss arcs around the central void,
 *   - a walkable maze of grated catwalks with railings on three levels around
 *     the void, joined by steel stairs (grid offset half a bay from the
 *     columns so walkways never run into them),
 *   - pipe runs, two scaffold-clad concrete shells out in the fog, and a
 *     rack-rail truss climbing diagonally through the void.
 * The fog closes in well before the structure ends, so it reads as endless.
 * Fall off and you come back at the start.
 */
import { MapBuilder, circle } from './lib/build';

const m = new MapBuilder();
const STEEL = 'iw/steel', LIGHT = 'iw/steel_light', GRATE = 'iw/grate', PIPE = 'iw/pipe', CONC = 'iw/concrete', SCAF = 'iw/scaffold', RUST = 'iw/rust';
const BAY = 288, N = 12, C = (N / 2) * BAY;            // world 0..3456, centre 1728
const ZB = -1600, ZT = 2300;                           // columns run past the fog both ways
const LEVELS = [0, 192, 384];                          // catwalk floor heights
const R_IN = 760, R_OUT = 1450;                        // catwalk annulus around the void

// Seeded random (mulberry32).
let seed = 0x1d57a1;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const r2 = (v: number) => Math.round(v * 100) / 100;
const dist = (x: number, y: number) => Math.hypot(x - C, y - C);

// ---- helpers
/** Bar in the y-z plane (a diagonal of a truss running along y), `t` thick, spanning x0..x1. */
const barYZ = (y0: number, z0: number, y1: number, z1: number, t: number, x0: number, x1: number, tex: string) => {
  const dy = y1 - y0, dz = z1 - z0, l = Math.hypot(dy, dz) || 1, ny = (-dz / l) * t / 2, nz = (dy / l) * t / 2;
  m.prismX([[y0 - ny, z0 - nz], [y1 - ny, z1 - nz], [y1 + ny, z1 + nz], [y0 + ny, z0 + nz]].map(([a, b]) => [r2(a), r2(b)]) as [number, number][], x0, x1, tex);
};
/** Horizontal tube along x or y. */
const tube = (axis: 'x' | 'y', c: number, z: number, a0: number, a1: number, r: number, tex: string) => {
  const ring = circle(c, z, r, Math.max(16, Math.round(r * 2.5 / 4) * 4)).map(([p, q]) => [r2(p), r2(q)] as [number, number]);
  if (axis === 'x') m.prismX(ring, a0, a1, tex); else m.prismY(ring, a0, a1, tex);
};
/** An I-beam along x or y: flanges + web. */
const ibeam = (axis: 'x' | 'y', c: number, z: number, a0: number, a1: number, depth: number, flange: number, tex: string) => {
  const f = flange / 2, w = 0.6;
  const box = (lo: number, hi: number, z0: number, z1: number) =>
    axis === 'x' ? m.box([a0, c + lo, z0], [a1, c + hi, z1], tex) : m.box([c + lo, a0, z0], [c + hi, a1, z1], tex);
  box(-f, f, z - 1.2, z);
  box(-w, w, z - depth + 1.2, z - 1.2);
  box(-f, f, z - depth, z - depth + 1.2);
};
/** Warren truss along x or y: two chords and alternating diagonals, `h` tall, top at z. */
const truss = (axis: 'x' | 'y', c: number, z: number, a0: number, a1: number, h: number, tex: string) => {
  const chord = (z0: number, z1: number) => axis === 'x' ? m.box([a0, c - 3, z0], [a1, c + 3, z1], tex) : m.box([c - 3, a0, z0], [c + 3, a1, z1], tex);
  chord(z - 5, z); chord(z - h, z - h + 5);
  const n = Math.max(2, Math.round((a1 - a0) / h)), step = (a1 - a0) / n;
  for (let i = 0; i < n; i++) {
    const p0 = a0 + i * step, p1 = p0 + step, up = i % 2 === 0;
    const [za, zb] = up ? [z - h + 5, z - 5] : [z - 5, z - h + 5];
    if (axis === 'x') m.barXZ(r2(p0 + 3), za, r2(p1 - 3), zb, 3, c - 2, c + 2, tex);
    else barYZ(r2(p0 + 3), za, r2(p1 - 3), zb, 3, c - 2, c + 2, tex);
  }
};

// ---- columns: most grid nodes, none inside the void
const cols = new Set<string>();
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
  const x = i * BAY, y = j * BAY;
  if (dist(x, y) < 640 || rnd() < 0.5) continue;
  cols.add(`${i},${j}`);
  if (rnd() < 0.5) m.box([x - 8, y - 8, ZB], [x + 8, y + 8, ZT], STEEL);
  else { m.box([x - 7, y - 7, ZB], [x + 7, y - 6, ZT], STEEL); m.box([x - 0.6, y - 6, ZB], [x + 0.6, y + 6, ZT], STEEL); m.box([x - 7, y + 6, ZB], [x + 7, y + 7, ZT], STEEL); }
}

// ---- girders between neighbouring columns, hung just under each storey
for (let z = ZB + 216; z < ZT - 100; z += 192) {
  for (const k of cols) {
    const [i, j] = k.split(',').map(Number);
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      if (!cols.has(`${i + di},${j + dj}`) || rnd() > 0.14) continue;
      const zz = z - 24;
      if (di) ibeam('x', j * BAY, zz, i * BAY + 8, (i + 1) * BAY - 8, 16, 8, STEEL);
      else ibeam('y', i * BAY, zz, j * BAY + 8, (j + 1) * BAY - 8, 16, 8, STEEL);
    }
  }
}

// ---- X-bracing in some bays between columns (vertical planes), every other storey
for (let z = ZB + 216; z < ZT - 300; z += 384) {
  for (const k of cols) {
    const [i, j] = k.split(',').map(Number);
    for (const [di, dj] of [[1, 0], [0, 1]] as const) {
      if (!cols.has(`${i + di},${j + dj}`) || rnd() > 0.08) continue;
      const z0 = z, z1 = z + 192;
      if (z0 < 480 && z1 > -100) continue;              // keep the catwalk band open
      if (di) { const y = j * BAY, x0 = i * BAY + 10, x1 = (i + 1) * BAY - 10; m.barXZ(x0, z0, x1, z1, 3, y - 1.5, y + 1.5, STEEL); m.barXZ(x0, z1, x1, z0, 3, y - 4.5, y - 1.5, STEEL); }
      else { const x = i * BAY, y0 = j * BAY + 10, y1 = (j + 1) * BAY - 10; barYZ(y0, z0, y1, z1, 3, x - 1.5, x + 1.5, STEEL); barYZ(y0, z1, y1, z0, 3, x - 4.5, x - 1.5, STEEL); }
    }
  }
}

// ---- long Warren trusses across whole rows, above and below the catwalk band
for (let t = 0; t < 9; t++) {
  const axis = rnd() < 0.5 ? 'x' : 'y';
  const line = (1 + Math.floor(rnd() * (N - 1))) * BAY;
  const z = pick([-1100, -860, -620, -380, 760, 1000, 1240, 1480, 1720, 1960]) + Math.round(rnd() * 3) * 24;
  const a = Math.floor(rnd() * 4) * BAY, b = Math.min(N * BAY, a + (4 + Math.floor(rnd() * 6)) * BAY);
  truss(axis, line, z, a, b, 48, LIGHT);
}

// ---- curved truss arcs around the void (≥ 24 segments per quarter turn)
const arc = (r: number, z: number, a0: number, sweep: number, h: number) => {
  const n = Math.round((Math.abs(sweep) / (Math.PI / 2)) * 24), w = 4;
  const P = (a: number, rr: number) => [r2(C + rr * Math.cos(a)), r2(C + rr * Math.sin(a))] as [number, number];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (sweep * i) / n, t1 = a0 + (sweep * (i + 1)) / n;
    const quad = sweep > 0 ? [P(t0, r - w), P(t1, r - w), P(t1, r + w), P(t0, r + w)] : [P(t0, r + w), P(t1, r + w), P(t1, r - w), P(t0, r - w)];
    m.prism(quad, z - 6, z, LIGHT);
    m.prism(quad, z - h, z - h + 6, LIGHT);
    if (i % 2 === 0) {
      const tm = (t0 + t1) / 2, [px, py] = P(tm, r);
      m.box([r2(px - 2.5), r2(py - 2.5), z - h + 6], [r2(px + 2.5), r2(py + 2.5), z - 6], LIGHT);
    }
  }
};
arc(600, -420, 0.3, Math.PI * 1.1, 54);
arc(560, 640, 2.2, -Math.PI * 1.25, 60);
arc(620, 1120, -0.9, Math.PI * 1.0, 54);
arc(580, 1650, 1.4, Math.PI * 1.3, 60);

// ---- the catwalk maze: nodes on the half-bay grid in the annulus, three levels
type Node = { i: number; j: number; L: number };
const key = (n: Node) => `${n.i},${n.j},${n.L}`;
const nodes = new Map<string, Node>();
for (let L = 0; L < LEVELS.length; L++) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const d = dist((i + 0.5) * BAY, (j + 0.5) * BAY);
  if (d < R_IN || d > R_OUT || rnd() < 0.08) continue;
  const n = { i, j, L };
  nodes.set(key(n), n);
}
type Edge = { a: Node; b: Node; stair: boolean };
const cand: Edge[] = [];
for (const n of nodes.values()) for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
  const flat = nodes.get(key({ i: n.i + di, j: n.j + dj, L: n.L }));
  if (flat && (di > 0 || dj > 0)) cand.push({ a: n, b: flat, stair: false });
  const up = nodes.get(key({ i: n.i + di, j: n.j + dj, L: n.L + 1 }));
  if (up) cand.push({ a: n, b: up, stair: true });
}
// Randomised Kruskal: a spanning tree (every node reachable), then a few loops.
for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
const parent = new Map<string, string>();
const find = (k: string): string => { while (parent.has(k) && parent.get(k) !== k) k = parent.get(k)!; return k; };
const used = new Set<string>();                          // corridors (i,j side, level) a stair or walk already occupies
const corridor = (e: Edge, L: number) => `${Math.min(e.a.i, e.b.i)},${Math.min(e.a.j, e.b.j)},${e.a.i !== e.b.i ? 'x' : 'y'},${L}`;
const edges: Edge[] = [];
const take = (e: Edge) => {
  const c0 = corridor(e, e.a.L), c1 = corridor(e, e.b.L);
  if (used.has(c0) || used.has(c1)) return false;
  if (e.stair) { used.add(c0); used.add(c1); } else used.add(c0);
  edges.push(e);
  return true;
};
for (const e of cand) { const ra = find(key(e.a)), rb = find(key(e.b)); if (ra !== rb && take(e)) parent.set(ra, rb); }
for (const e of cand) if (!edges.includes(e) && rnd() < 0.12) take(e);
// Keep the part connected to the most nodes (anything cut off stays as scenery-free space).
const comp = new Map<string, number>();
for (const n of nodes.values()) { const r = find(key(n)); comp.set(r, (comp.get(r) ?? 0) + 1); }
const main = [...comp.entries()].sort((p, q) => q[1] - p[1])[0][0];
const live = (n: Node) => find(key(n)) === main;

const W = 24, RAIL = 42;
const nx = (n: Node) => (n.i + 0.5) * BAY, ny = (n: Node) => (n.j + 0.5) * BAY, nz = (n: Node) => LEVELS[n.L];
const open = new Map<string, Set<string>>();             // node → open sides
const side = (from: Node, to: Node) => (to.i > from.i ? 'px' : to.i < from.i ? 'nx' : to.j > from.j ? 'py' : 'ny');
for (const e of edges) {
  if (!live(e.a)) continue;
  for (const [p, q] of [[e.a, e.b], [e.b, e.a]] as const) {
    if (!open.has(key(p))) open.set(key(p), new Set());
    open.get(key(p))!.add(side(p, q));
  }
}
// Node platforms with corner posts and railings on the closed sides.
for (const n of nodes.values()) {
  if (!live(n) || !open.has(key(n))) continue;
  const x = nx(n), y = ny(n), z = nz(n), o = open.get(key(n))!;
  m.box([x - W, y - W, z - 3], [x + W, y + W, z], GRATE);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box([sx < 0 ? x - W : x + W - 2, sy < 0 ? y - W : y + W - 2, z], [sx < 0 ? x - W + 2 : x + W, sy < 0 ? y - W + 2 : y + W, z + RAIL], STEEL);
  for (const s of ['px', 'nx', 'py', 'ny']) {
    if (o.has(s)) continue;
    for (const zz of [RAIL - 2, RAIL / 2 - 1]) {
      if (s === 'px') m.box([x + W - 2, y - W + 2, z + zz], [x + W, y + W - 2, z + zz + 2], STEEL);
      if (s === 'nx') m.box([x - W, y - W + 2, z + zz], [x - W + 2, y + W - 2, z + zz + 2], STEEL);
      if (s === 'py') m.box([x - W + 2, y + W - 2, z + zz], [x + W - 2, y + W, z + zz + 2], STEEL);
      if (s === 'ny') m.box([x - W + 2, y - W, z + zz], [x + W - 2, y - W + 2, z + zz + 2], STEEL);
    }
  }
}
// Walkways and stairs.
for (const e of edges) {
  if (!live(e.a)) continue;
  const [a, b] = nx(e.a) + ny(e.a) < nx(e.b) + ny(e.b) || (nx(e.a) === nx(e.b) && ny(e.a) < ny(e.b)) || (ny(e.a) === ny(e.b) && nx(e.a) < nx(e.b)) ? [e.a, e.b] : [e.b, e.a];
  const alongX = a.i !== b.i;
  const c = alongX ? ny(a) : nx(a);
  const s0 = (alongX ? nx(a) : ny(a)) + W, s1 = (alongX ? nx(b) : ny(b)) - W;
  const za = nz(a), zb = nz(b);
  const bx = (p0: number, p1: number, q0: number, q1: number, z0: number, z1: number, tex: string) =>
    alongX ? m.box([p0, c + q0, z0], [p1, c + q1, z1], tex) : m.box([c + q0, p0, z0], [c + q1, p1, z1], tex);
  if (!e.stair) {
    bx(s0, s1, -W, W, za - 3, za, GRATE);
    for (const q of [-1, 1]) {
      const q0 = q < 0 ? -W : W - 2, q1 = q0 + 2;
      for (const zz of [RAIL - 2, RAIL / 2 - 1]) bx(s0, s1, q0, q1, za + zz, za + zz + 2, STEEL);
    }
    continue;
  }
  // Stair: open steel treads between two stringers, handrails on both sides.
  const rise = zb - za, steps = Math.round(Math.abs(rise) / 7.4), run = (s1 - s0) / steps, dz = rise / steps;
  for (let k = 0; k < steps - 1; k++) {
    const p0 = r2(s0 + k * run), p1 = r2(s0 + (k + 1) * run);
    const top = r2(rise > 0 ? za + (k + 1) * dz : za + (k + 1) * dz);
    bx(p0, p1, -W + 2, W - 2, top - 2, top, GRATE);
  }
  for (const q of [-1, 1]) {
    const y0 = q < 0 ? -W : W - 2, y1 = y0 + 2;
    const lo = alongX ? [c + y0, c + y1] : [c + y0, c + y1];
    const bar = (z0: number, z1: number, t: number) => alongX
      ? m.barXZ(r2(s0), r2(z0), r2(s1), r2(z1), t, lo[0], lo[1], STEEL)
      : barYZ(r2(s0), r2(z0), r2(s1), r2(z1), t, lo[0], lo[1], STEEL);
    bar(za - 6, zb - 6, 8);                             // stringer
    bar(za + RAIL - 1, zb + RAIL - 1, 2);               // handrail
  }
}
const spawnNode = [...nodes.values()].find((n) => live(n) && n.L === 0 && open.has(key(n)))!;

// ---- pipe runs (outside the catwalk band) and risers along columns
for (let p = 0; p < 16; p++) {
  const axis = rnd() < 0.5 ? 'x' : 'y';
  const line = Math.floor(rnd() * N) * BAY + pick([-30, 30]);
  const z = pick([-1300, -980, -700, -420, -200, 620, 900, 1300, 1600, 1950]) + Math.round(rnd() * 8) * 12;
  const a = Math.floor(rnd() * 3) * BAY, b = Math.min(N * BAY, a + (5 + Math.floor(rnd() * 7)) * BAY);
  const k = 1 + Math.floor(rnd() * 3), r = pick([3, 4, 6, 9]);
  for (let q = 0; q < k; q++) tube(axis, line + q * (2 * r + 4), z, a, b, r, PIPE);
}
for (const k of [...cols].filter(() => rnd() < 0.18)) {
  const [i, j] = k.split(',').map(Number);
  const r = pick([3, 5, 7]);
  m.cylinder(r2(i * BAY + 8 + r + 2), r2(j * BAY), r, ZB, ZT, PIPE);
}

// ---- two scaffold-clad concrete shells out in the fog (curved, 24 segments per quarter)
const shell = (cx: number, cy: number, r: number, a0: number, sweep: number) => {
  const n = Math.round((sweep / (Math.PI / 2)) * 24), t = 24;
  const P = (a: number, rr: number) => [r2(cx + rr * Math.cos(a)), r2(cy + rr * Math.sin(a))] as [number, number];
  for (let i = 0; i < n; i++) {
    const t0 = a0 + (sweep * i) / n, t1 = a0 + (sweep * (i + 1)) / n;
    m.prism([P(t0, r), P(t1, r), P(t1, r + t), P(t0, r + t)], ZB, ZT, CONC);
  }
  // Scaffolding on the outside: standards every 4 segments, ledgers every 156".
  for (let i = 0; i <= n; i += 4) {
    const [x, y] = P(a0 + (sweep * i) / n, r + t + 30);
    m.cylinder(x, y, 1.5, ZB, ZT, SCAF);
  }
  for (let z = ZB + 156; z < ZT; z += 156) for (let i = 0; i < n; i += 4) {
    const [xa, ya] = P(a0 + (sweep * i) / n, r + t + 30), [xb, yb] = P(a0 + (sweep * Math.min(n, i + 4)) / n, r + t + 30);
    const dx = xb - xa, dy = yb - ya, l = Math.hypot(dx, dy) || 1, ox = (-dy / l) * 1.2, oy = (dx / l) * 1.2;
    m.prism([[r2(xa - ox), r2(ya - oy)], [r2(xb - ox), r2(yb - oy)], [r2(xb + ox), r2(yb + oy)], [r2(xa + ox), r2(ya + oy)]], z, z + 2.4, SCAF);
  }
};
shell(C - 2000, C + 300, 420, -0.9, Math.PI * 0.9);
shell(C + 1900, C - 500, 380, Math.PI - 0.6, Math.PI);

// ---- a rack-rail truss climbing diagonally through the void
{
  const y = C + 40, x0 = C - 700, z0 = -1500, x1 = C + 260, z1 = ZT;
  for (const q of [-14, 14]) m.barXZ(x0, z0, x1, z1, 5, y + q - 2.5, y + q + 2.5, RUST);
  const n = 60;
  for (let k = 1; k < n; k++) {
    const t = k / n, x = r2(x0 + (x1 - x0) * t), z = r2(z0 + (z1 - z0) * t);
    m.box([x - 1.5, y - 12, z - 1.5], [x + 1.5, y + 12, z + 1.5], RUST);
  }
}

m.start([nx(spawnNode), ny(spawnNode), 0], 0, (Math.atan2(C - ny(spawnNode), C - nx(spawnNode)) * 180) / Math.PI);
m.write('industrial', [{ name: 'world', min: [-200, -200, ZB], max: [N * BAY + 200, N * BAY + 200, ZT], paint: 'iw/steel' }], {
  // No lamps: an overcast sky is the only light, soft and even, so coarse luxels are enough
  // (thousands of thin members would otherwise need millions).
  light: { luxelSize: 256, thinSamples: 1, skyLuminance: 2500, skyZenith: '#c3c7cb', skyHorizon: '#b9bdc1', skyBand: 0.6 },
  // Thick grey fog: near steel stays dark against it, everything dissolves within ~300 ft, so it never ends.
  fog: { enabled: true, haze: true, color: '#b9bdc1', luminance: 2500, near: 150, far: 3600 },
  camera: { whiteBalanceK: 6500, saturation: 0.25, flash: false },
  hull: { voidZ: -1500 },
});
console.log(`spawn at node ${key(spawnNode)}; ${edges.filter((e) => live(e.a)).length} walkways/stairs, ${[...nodes.values()].filter(live).length} catwalk nodes`);
