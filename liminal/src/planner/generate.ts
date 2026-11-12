/**
 * The Backrooms map generator (docs/BACKROOMS_MAPS.md section 6).
 *
 * 1. Plan: a tree of zones grown by rules (hubs with spokes, chains, branches
 *    that end in a payout, long runs to far groups), each node a feature from
 *    the catalogue, neighbours of different families.
 * 2. Place: grow outwards from the hub. Each zone has its own frame (origin +
 *    turn); a child snaps port-to-port onto its parent, touching it or at the
 *    end of a corridor. Collisions try other sides, sizes, then give up.
 * 3. Loops: zones that ended up close but far apart in the tree get a routed
 *    corridor (grid search, then pulled straight), or a portal when no route.
 * 4. Fill: every zone runs its recipe (recipes.ts); walls come from the
 *    outline of all floors together, so parts wrap and merge.
 * 5. Edges, impossible links, layer 2 (vents, ducts, crawlspaces, hatches).
 *
 * The same seed, settings and edits always give the same map.
 */
import { Rng } from '../world/rng';
import { DISTRICT_THEMES, FEATURE, TAG_FEATURES, ZONE_FEATURES, type Role } from './catalogue';
import {
  add, arcPoints, bboxOf, box, convexOverlap, dir, dist, dot, mul, norm, obb, perp, rot, segBox, sub, toLocal, toWorld, v2,
  type BBox, type Frame, type V2,
} from './geom';
import { buildZone } from './recipes';
import { analyze } from './analyze';
import type { Edits, LinkKind, Link, MapOut, Params, Prim, Zone } from './types';

export const DEFAULT_PARAMS: Params = {
  seed: 1, size: 150, turn: 0.15, density: 0.6, loops: 0.35, deadEnds: 0.4, corridors: 0.55,
  longRuns: 0.3, landmarks: 0.4, themes: 0.5, heights: 0.3, anomalies: 0.2, tight: 0, squish: 0, weights: {},
};

export const emptyEdits = (): Edits => ({ zones: {}, added: [], notes: [] });

const wOf = (p: Params, id: string): number => p.weights[id] ?? FEATURE[id]?.weight ?? 0;
const HALF_PI = Math.PI / 2;

interface GNode {
  key: string;
  parent: number;
  depth: number;
  feature: string;
  link: LinkKind;
  children: number[];
  tags: string[];
  theme: string;
  level: number;
  seed: number;
  w?: number;
  h?: number;
  pin?: Frame;
  copyOf?: number;
  edges: string[];
  linkEdge?: string;
}

// ------------------------------------------------------------------ 1. plan

function targetCount(p: Params): number {
  const area = Math.PI * p.size * p.size;
  return Math.max(6, Math.min(420, Math.round((area * 0.42 * (0.25 + p.density)) / 330)));
}

function pickZone(r: Rng, p: Params, parentFeature: string | null, depth: number, used: Map<string, number>): string {
  const pf = parentFeature ? FEATURE[parentFeature] : null;
  const items = ZONE_FEATURES.map((f) => {
    let w = wOf(p, f.id);
    if (f.role === 'landmark' || f.role === 'hub') w *= 0.3 ** (used.get(f.id) ?? 0);
    if (w > 0) {
      const role: Role = f.role ?? 'part';
      if (role === 'hub') w *= depth <= 1 ? 0.35 : 0.12;
      else if (role === 'landmark') w *= p.landmarks * (depth >= 2 ? 1.1 : 0.15);
      else if (role === 'end') w *= p.deadEnds * (depth >= 2 ? 1.1 : 0.2);
      if (f.family && pf?.family === f.family) w *= 0.15;
    }
    return [f.id, Math.max(0, w)] as const;
  });
  if (!items.some(([, w]) => w > 0)) return 'room';
  return r.weighted(items);
}

function pickHub(r: Rng, p: Params): string {
  const items = ZONE_FEATURES.filter((f) => f.role === 'hub').map((f) => [f.id, wOf(p, f.id)] as const);
  return items.some(([, w]) => w > 0) ? r.weighted(items) : 'room';
}

function pickLink(r: Rng, p: Params, parent: string, child: string, depth: number): LinkKind {
  if (child === 'mass') return 'open';
  if (child === 'tinyroom' || parent === 'tinyroom') return 'narrow';
  const far = FEATURE[child].role === 'end' && child === 'farm' ? 3 : 1;
  const items: (readonly [LinkKind, number])[] = [
    ['open', (1 - p.corridors) * 1.3 * (1 + 2 * (p.tight ?? 0))],
    ['corridor', p.corridors * wOf(p, 'corridor')],
    ['bent', p.corridors * wOf(p, 'bent') * (1.2 - p.turn * 0.6)],
    ['curved', p.corridors * wOf(p, 'curved') * (0.25 + p.turn)],
    ['long', p.longRuns * wOf(p, 'long') * (depth >= 3 ? 1.6 : depth >= 2 ? 0.6 : 0.05) * far],
    ['narrow', wOf(p, 'narrow') * 0.6],
    ['wrap', wOf(p, 'wrap') * p.corridors * 0.6],
    ['stair', p.heights * wOf(p, 'stair')],
    ['ramp', p.heights * wOf(p, 'ramp')],
    ['impossible', p.anomalies * wOf(p, 'impossible') * 0.6],
  ];
  const ok = items.filter(([, w]) => w > 0);
  return ok.length ? r.weighted(ok) : 'open';
}

function pickTags(r: Rng, p: Params, feature: string): string[] {
  const f = FEATURE[feature];
  if (feature === 'mass' || f.role === 'end') return [];
  const tags: string[] = [];
  for (const t of TAG_FEATURES) {
    let ch = wOf(p, t.id);
    if (['sloped', 'splitlevel', 'ceilingdrop', 'pit', 'flooded'].includes(t.id)) ch *= p.heights * 2.5;
    if (['melted', 'repeat', 'circle'].includes(t.id)) ch *= p.anomalies * 3;
    if (r.chance(ch)) tags.push(t.id);
  }
  // only one ceiling kind
  const ceil = tags.filter((t) => t === 'tall' || t === 'low' || t === 'noceiling' || t === 'ceilingdrop');
  for (const c of ceil.slice(1)) tags.splice(tags.indexOf(c), 1);
  if (tags.includes('melted') && r.chance(0.5)) tags[tags.indexOf('melted')] = 'mono';
  return tags;
}

function plan(p: Params, edits: Edits, root: Rng): GNode[] {
  const N = Math.ceil(targetCount(p) * 1.25);
  const fr = root.fork('features'), lr = root.fork('links'), cr = root.fork('capacity'), tr = root.fork('tags');
  const nodes: GNode[] = [];
  const make = (parent: number, depth: number, feature: string, link: LinkKind): number => {
    const key = `z${nodes.length}`;
    const ed = edits.zones[key];
    const f = ed?.feature && FEATURE[ed.feature]?.kind === 'zone' ? ed.feature : feature;
    nodes.push({
      key, parent, depth, feature: f, link: parent >= 0 && nodes[parent] ? (f === 'mass' ? 'open' : link) : 'open', children: [],
      tags: pickTags(tr.fork(key), p, f), theme: 'base', level: 0, seed: (root.fork(`seed:${key}`).int(0, 1e9) + (ed?.seed ?? 0)) >>> 0,
      edges: [],
    });
    if (parent >= 0) nodes[parent].children.push(nodes.length - 1);
    return nodes.length - 1;
  };
  make(-1, 0, pickHub(fr.fork('hub'), p), 'open');
  const capacity = (i: number): number => {
    const n = nodes[i], f = FEATURE[n.feature];
    const r = cr.fork(n.key);
    switch (f.role) {
      case 'hub': return r.int(3, 5);
      case 'end': return 0;
      case 'landmark': return r.chance(0.25) ? 1 : 0;
      default: return r.weighted([[0, 0.15 + p.deadEnds * 0.5], [1, 1], [2, 0.75], [3, 0.2 + (1 - p.deadEnds) * 0.35]]);
    }
  };
  const queue: number[] = [0];
  const used = new Map<string, number>([[nodes[0].feature, 1]]);
  let reopen = 0;
  while (nodes.length < N) {
    if (!queue.length) {
      // every branch ended early: grow again from a part with room left
      const cands = nodes.map((_, i) => i).filter((i) => FEATURE[nodes[i].feature].role !== 'end' && nodes[i].feature !== 'mass' && nodes[i].children.length < 4);
      if (!cands.length || reopen++ > 400) break;
      queue.push(cr.fork(`reopen:${reopen}`).pick(cands));
    }
    const i = queue.shift()!;
    const k = queue.length || nodes.length === 1 ? capacity(i) : Math.max(1, capacity(i));
    for (let c = 0; c < k && nodes.length < N; c++) {
      const parent = nodes[i];
      const feature = pickZone(fr.fork(`${parent.key}:${c}`), p, parent.feature, parent.depth + 1, used);
      used.set(feature, (used.get(feature) ?? 0) + 1);
      const link = pickLink(lr.fork(`${parent.key}:${c}`), p, parent.feature, feature, parent.depth + 1);
      const j = make(i, parent.depth + 1, feature, link);
      queue.push(j);
    }
  }
  // the user's added zones hang on the nearest placed zone later
  for (const a of edits.added) {
    nodes.push({ key: a.key, parent: -2, depth: 1, feature: FEATURE[a.feature]?.kind === 'zone' ? a.feature : 'room', link: 'corridor', children: [], tags: [], theme: 'base', level: 0, seed: root.fork(`seed:${a.key}`).int(0, 1e9), w: a.w, h: a.h, pin: { x: a.x, y: a.y, a: a.a }, edges: [] });
  }
  // edits on generated zones
  nodes.forEach((n) => {
    const ed = edits.zones[n.key];
    if (!ed) return;
    if (ed.w) n.w = ed.w;
    if (ed.h) n.h = ed.h;
    if (ed.tags) n.tags = ed.tags.slice();
    if (ed.level !== undefined) n.level = ed.level;
    if (ed.x !== undefined && ed.y !== undefined) n.pin = { x: ed.x, y: ed.y, a: ed.a ?? 0 };
  });
  // deleted zones: their children hang on the grandparent
  nodes.forEach((n, i) => {
    if (!edits.zones[n.key]?.deleted) return;
    for (const c of n.children) { nodes[c].parent = n.parent; if (n.parent >= 0) nodes[n.parent].children.push(c); }
    if (n.parent >= 0) nodes[n.parent].children = nodes[n.parent].children.filter((c) => c !== i);
    n.children = [];
    n.parent = -3; // never placed
  });
  // repeat rooms copy their parent
  nodes.forEach((n) => {
    if (n.tags.includes('repeat') && n.parent >= 0 && FEATURE[nodes[n.parent].feature].role !== 'hub') { n.copyOf = n.parent; n.feature = nodes[n.parent].feature; }
  });
  // edges on zones and links (a closed link only cuts off a small branch)
  const er = root.fork('edges');
  const subtree = (i: number): number => 1 + nodes[i].children.reduce((t, c) => t + subtree(c), 0);
  nodes.forEach((n) => {
    const r = er.fork(n.key);
    if (n.feature === 'mass') return;
    for (const id of ['windowwall', 'fakewindow', 'shopfront']) if (r.chance(wOf(p, id) * 1.5)) n.edges.push(id);
    if (n.parent >= 0 && n.link !== 'impossible' && subtree(nodes.indexOf(n)) <= 3) for (const id of ['stuckdoor', 'blocked', 'gate']) if (!n.linkEdge && r.chance(wOf(p, id) * 0.6)) n.linkEdge = id;
    if (n.tags.includes('circle')) n.edges.push('circle');
  });
  assignThemes(nodes, p, root.fork('themes'), edits);
  return nodes;
}

function assignThemes(nodes: GNode[], p: Params, r: Rng, edits: Edits): void {
  for (const n of nodes) n.theme = FEATURE[n.feature].theme ?? 'base';
  const weights: Record<string, number> = { yellow: 3, light: 2.5, tan: 2, office: 1.6, concrete: 1, hotel: 0.6, red: 0.5, green: 0.6, wood: 0.4 };
  const districts = Math.round((nodes.length * p.themes * (wOf(p, 'carpetchange') / 0.5)) / 7);
  const nb = (i: number) => [nodes[i].parent, ...nodes[i].children].filter((j) => j >= 0);
  for (let d = 0; d < districts; d++) {
    const dr = r.fork(`d${d}`);
    const free = nodes.map((_, i) => i).filter((i) => nodes[i].theme === 'base' && nodes[i].parent !== -3);
    if (!free.length) break;
    const theme = dr.weighted(DISTRICT_THEMES.map((t) => [t, weights[t] ?? 1] as const));
    const size = dr.int(3, 12);
    const q = [dr.pick(free)];
    let done = 0;
    while (q.length && done < size) {
      const i = q.shift()!;
      if (nodes[i].theme !== 'base') continue;
      nodes[i].theme = theme;
      done++;
      for (const j of nb(i)) if (nodes[j].theme === 'base') q.push(j);
    }
  }
  for (const n of nodes) {
    if (n.tags.includes('mono')) n.theme = 'mono';
    if (n.tags.includes('melted')) n.theme = 'melted';
    const ed = edits.zones[n.key];
    if (ed?.theme) n.theme = ed.theme;
  }
}

// ------------------------------------------------------------------ 2. place

/** Obstacles in a coarse grid so collision tests only look nearby. */
class Hash {
  private cells = new Map<number, number[]>();
  /** `level`: a flat corridor's floor level (others may cross it on that level: a junction); NaN = rooms and
   * stairs or ramps, which nothing may cross. `seg`: a corridor piece's centre line and width. */
  readonly items: { poly: V2[]; bb: BBox; zone: number; corridor: boolean; level: number; seg?: [V2, V2, number] }[] = [];
  private static S = 16;
  private key(i: number, j: number): number { return (i + 4096) * 8192 + (j + 4096); }
  add(poly: V2[], zone: number, corridor: boolean, level = NaN, seg?: [V2, V2, number]): void {
    const bb = bboxOf(poly);
    const id = this.items.length;
    this.items.push({ poly, bb, zone, corridor, level, seg });
    for (let i = Math.floor(bb.x0 / Hash.S); i <= Math.floor(bb.x1 / Hash.S); i++) for (let j = Math.floor(bb.y0 / Hash.S); j <= Math.floor(bb.y1 / Hash.S); j++) {
      const k = this.key(i, j);
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(id);
    }
  }
  near(bb: BBox): number[] {
    const out = new Set<number>();
    for (let i = Math.floor(bb.x0 / Hash.S); i <= Math.floor(bb.x1 / Hash.S); i++) for (let j = Math.floor(bb.y0 / Hash.S); j <= Math.floor(bb.y1 / Hash.S); j++) for (const id of this.cells.get(this.key(i, j)) ?? []) out.add(id);
    return [...out];
  }
  hits(poly: V2[], skip: (zone: number, corridor: boolean, level: number) => boolean): boolean {
    const bb = bboxOf(poly);
    for (const id of this.near(bb)) {
      const it = this.items[id];
      if (skip(it.zone, it.corridor, it.level)) continue;
      if (it.bb.x1 <= bb.x0 || it.bb.x0 >= bb.x1 || it.bb.y1 <= bb.y0 || it.bb.y0 >= bb.y1) continue;
      if (convexOverlap(poly, it.poly)) return true;
    }
    return false;
  }
}

/** A point on side `s` (0 +x, 1 +y, 2 -x, 3 -y) of a w×h zone, `t` along it. */
function sidePoint(s: number, t: number, w: number, h: number): V2 {
  switch (s & 3) {
    case 0: return v2(w / 2, t);
    case 1: return v2(t, h / 2);
    case 2: return v2(-w / 2, t);
    default: return v2(t, -h / 2);
  }
}
const sideHalf = (s: number, w: number, h: number): number => ((s & 1) === 0 ? h / 2 : w / 2);

function sizeFor(n: GNode, r: Rng, shrink: number, p: Params): [number, number] {
  if (n.w && n.h) return [n.w * shrink, n.h * shrink];
  const f = FEATURE[n.feature];
  const [w0, w1] = f.w ?? [6, 10], [h0, h1] = f.h ?? [6, 10];
  const big = f.role === 'hub' ? 0.6 + Math.min(1, p.size / 200) * 0.4 : 1;
  const w = w0 + (w1 - w0) * r.next() ** 1.4 * big, h = h0 + (h1 - h0) * r.next() ** 1.4 * big;
  const sw = Math.max(3, Math.round(w * shrink)), sh = Math.max(3, Math.round(h * shrink));
  return r.chance(0.5) && f.role !== 'landmark' && n.feature !== 'longroom' && n.feature !== 'street' ? [sh, sw] : [sw, sh];
}

function linkWidth(kind: LinkKind, r: Rng): number {
  switch (kind) {
    case 'narrow': return r.chance(0.5) ? 1 : 1.4;
    case 'long': return 2;
    case 'stair': case 'impossible': return 2.5;
    case 'ramp': return 3;
    case 'open': return r.int(2, 4);
    default: return r.int(2, 3);
  }
}

interface Ctx {
  p: Params;
  nodes: GNode[];
  zones: Zone[];
  links: Link[];
  hash: Hash;
  nodeZone: Int32Array;
  pending: { a: number; b: number; kind: LinkKind; edge?: string; loop: boolean }[];
  dropped: number;
  /** Links between rooms that could not be routed (debug). */
  unrouted: string[];
}

function addZone(c: Ctx, i: number, frame: Frame, w: number, h: number, parent: number): Zone {
  const n = c.nodes[i];
  const z: Zone = {
    id: c.zones.length, key: n.key, feature: n.feature, frame, w, h, seed: n.seed, theme: n.theme, level: n.level,
    tags: n.tags, ports: [], parent, depth: n.depth, pinned: !!n.pin, edges: n.edges,
  };
  c.zones.push(z);
  c.nodeZone[i] = z.id;
  c.hash.add(obb(frame, w, h), z.id, false);
  return z;
}

function addPort(z: Zone, world: V2, worldAngle: number, w: number, link: number): void {
  z.ports.push({ p: toLocal(z.frame, world), a: worldAngle - z.frame.a, w, link });
}

/** Try to put node i next to its parent zone. */
function attach(c: Ctx, i: number, pz: Zone, r: Rng, tries = 40): boolean {
  const n = c.nodes[i], p = c.p;
  const pf = pz.frame;
  for (let t0 = 0; t0 < tries; t0++) {
    // fewer tries skip ahead through the same stages (as is, smaller, corridor, stretched)
    const t = Math.floor((t0 * 40) / tries);
    const shrink = t < 10 ? 1 : t < 20 ? 0.8 : t < 30 ? 0.65 : 0.5;
    let kind: LinkKind = n.link;
    if (t >= 16 && kind === 'open' && n.feature !== 'mass') kind = 'corridor';
    // late tries: longer plain corridors (never a long run unless the plan asked for one)
    const stretch = t >= 30 ? 2 : 1;
    const [w, h] = n.copyOf !== undefined && c.nodeZone[n.copyOf] >= 0 ? [c.zones[c.nodeZone[n.copyOf]].w, c.zones[c.nodeZone[n.copyOf]].h] : sizeFor(n, r, shrink, p);
    const lw = linkWidth(kind, r);
    const s = r.int(0, 3);
    const half = sideHalf(s, pz.w, pz.h);
    const m = lw / 2 + 0.8;
    if (half - m < -half + m) continue;
    const tOff = r.range(-half + m, half - m);
    const Pl = sidePoint(s, tOff, pz.w, pz.h);
    const P0 = toWorld(pf, Pl);
    const nA = pf.a + s * HALF_PI;
    const nV = dir(nA);
    // where the passage ends and which way it arrives
    let path: V2[] = [P0];
    let arrive = nA;
    let end = P0;
    let ca = pf.a;
    const turnChild = (base: number) => (p.turn > 0 && r.chance(p.turn * 0.75) ? base + r.range(-1, 1) * p.turn * (Math.PI / 3) : base);
    switch (kind) {
      case 'open': break;
      case 'bent': case 'wrap': {
        const d1 = kind === 'wrap' ? r.range(1.5, 2.5) : r.range(3, 10);
        const side = r.chance(0.5) ? 1 : -1;
        const mV = mul(perp(nV), side);
        const d2 = kind === 'wrap' ? r.range(0.5, 1) * half * 2 : r.range(3, 12);
        const e1 = add(P0, mul(nV, d1));
        end = add(e1, mul(mV, d2));
        path = [P0, e1, end];
        arrive = Math.atan2(mV.y, mV.x);
        ca = turnChild(pf.a);
        break;
      }
      case 'curved': {
        const turn = r.range(0.5, 1.6) * (r.chance(0.5) ? 1 : -1);
        const arc = arcPoints(P0, nA, turn, r.range(8, 18), 10);
        path = arc.pts;
        end = arc.end;
        arrive = arc.a1;
        ca = arrive;
        break;
      }
      default: {
        const L = kind === 'long' ? r.range(30, 90) * Math.max(0.6, p.size / 150) : kind === 'narrow' ? r.range(2, 8) * stretch : kind === 'stair' || kind === 'ramp' || kind === 'impossible' ? r.range(5, 10) : r.range(3, 12) * stretch;
        end = add(P0, mul(nV, L));
        path = [P0, end];
        ca = turnChild(pf.a);
      }
    }
    // the child's side that faces back along the arrival
    let sc = 0, best = -Infinity;
    for (let k = 0; k < 4; k++) {
      const d = dot(dir(ca + k * HALF_PI), dir(arrive + Math.PI));
      if (d > best) { best = d; sc = k; }
    }
    if (kind === 'open') sc = (s + 2) & 3;
    // align the child exactly to the arrival direction
    ca = arrive + Math.PI - sc * HALF_PI;
    if (kind === 'open') ca = pf.a;
    const halfC = sideHalf(sc, w, h);
    const mc = lw / 2 + 0.8;
    if (halfC - mc < -halfC + mc) continue;
    const tc = r.range(-halfC + mc, halfC - mc);
    const Ql = sidePoint(sc, tc, w, h);
    const Q = rot(Ql, ca);
    let frame: Frame = { x: end.x - Q.x, y: end.y - Q.y, a: ca };
    // collisions. Clearance to other rooms: 0.8 tiles, down to almost touching with tight packing.
    const parentId = pz.id;
    const touch = kind === 'open';
    const clear = 0.8 - 0.75 * (p.tight ?? 0);
    const flat = kind !== 'stair' && kind !== 'ramp' && kind !== 'impossible';
    // squish: a touching room sinks into its parent on purpose
    const sink = touch && n.feature !== 'mass' && FEATURE[pz.feature].role !== 'hub' && (p.squish ?? 0) > 0 && r.chance(p.squish * 0.6)
      ? r.range(0.15, 0.4) * Math.min(w, h) : 0;
    if (sink > 0) frame = { ...frame, x: frame.x - nV.x * sink, y: frame.y - nV.y * sink };
    if (touch) {
      if (c.hash.hits(obb(frame, w, h, -0.05), (zone, corr) => sink > 0 && zone === parentId && !corr)) continue;
      if (c.hash.hits(obb(frame, w, h, clear), (zone, corr) => zone === parentId && !corr)) continue;
    } else {
      if (c.hash.hits(obb(frame, w, h, clear), () => false)) continue;
      let bad = false;
      for (let k = 0; k + 1 < path.length && !bad; k++) {
        const a = path[k], b = path[k + 1];
        const d = norm(sub(b, a));
        const a2 = k === 0 ? add(a, mul(d, 0.7)) : a, b2 = k + 2 === path.length ? sub(b, mul(d, 0.7)) : b;
        if (dist(a2, b2) < 0.2) continue;
        // a corridor may cross another one on the same floor (a junction), never one on another floor or a stair
        if (c.hash.hits(segBox(a2, b2, lw + 1.2), (zone, corr, lvl) => (zone === parentId && !corr) || (corr && flat && lvl === pz.level))) bad = true;
      }
      if (bad) continue;
    }
    // commit
    const z = addZone(c, i, frame, w, h, parentId);
    const link: Link = { id: c.links.length, a: parentId, b: z.id, kind, path: touch ? [] : path, w: lw, loop: false, edge: n.linkEdge };
    c.links.push(link);
    addPort(pz, P0, nA, lw, link.id);
    addPort(z, end, ca + sc * HALF_PI, lw, link.id);
    if (!touch) for (let k = 0; k + 1 < path.length; k++) c.hash.add(segBox(path[k], path[k + 1], lw), parentId, true, flat ? pz.level : NaN, [path[k], path[k + 1], lw]);
    if (kind === 'stair' || kind === 'ramp') z.level = Math.max(-3, Math.min(3, pz.level + (r.chance(0.6) ? -1 : 1)));
    else z.level = n.level || pz.level;
    if (sink > 0) z.tags = [...z.tags, 'squished'];
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ 2b. the user's edits, applied locally

/** The smallest move of polygon B that takes it off polygon A (both convex), or null when they do not overlap. */
function pushOut(A: V2[], B: V2[]): V2 | null {
  let best = Infinity, axis: V2 | null = null;
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % poly.length];
      const n = norm({ x: p1.y - p0.y, y: p0.x - p1.x });
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of A) { const d = q.x * n.x + q.y * n.y; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const q of B) { const d = q.x * n.x + q.y * n.y; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      const over = Math.min(a1 - b0, b1 - a0);
      if (over <= 0) return null;
      if (over < best) { best = over; axis = n; }
    }
  }
  if (!axis) return null;
  const ca = A.reduce((s, q) => add(s, q), v2(0, 0)), cb = B.reduce((s, q) => add(s, q), v2(0, 0));
  const away = dot(sub(mul(cb, 1 / B.length), mul(ca, 1 / A.length)), axis) >= 0 ? 1 : -1;
  return mul(axis, (best + 0.02) * away);
}

/** A room at a new place pushes the unpinned rooms it lands on out of the way; they push in turn. */
function pushApart(c: Ctx, start: number, clear: number, pinned: Set<number>, dead: Set<number>, changed: Set<number>): void {
  const q = [start];
  let steps = 0;
  const squishPair = (a: Zone, b: Zone) => (a.tags.includes('squished') && a.parent === b.id) || (b.tags.includes('squished') && b.parent === a.id);
  while (q.length && steps++ < 800) {
    const zi = c.zones[q.shift()!];
    const A = obb(zi.frame, zi.w, zi.h, clear / 2), ab = bboxOf(A);
    for (const zj of c.zones) {
      if (zj === zi || dead.has(zj.id) || pinned.has(zj.id) || squishPair(zi, zj)) continue;
      const B = obb(zj.frame, zj.w, zj.h, clear / 2), bb = bboxOf(B);
      if (bb.x1 <= ab.x0 || ab.x1 <= bb.x0 || bb.y1 <= ab.y0 || ab.y1 <= bb.y0) continue;
      const m = pushOut(A, B);
      if (!m) continue;
      zj.frame = { ...zj.frame, x: zj.frame.x + m.x, y: zj.frame.y + m.y };
      changed.add(zj.id);
      q.push(zj.id);
    }
  }
}

/** New size for a zone; its doors stay on its walls. */
function resize(z: Zone, w: number, h: number): void {
  for (const pt of z.ports) pt.p = v2((pt.p.x * w) / z.w, (pt.p.y * h) / z.h);
  z.w = w; z.h = h;
}

/** Is the doorway of a link between two touching rooms still on both rooms' walls? */
function stillTouching(c: Ctx, l: Link): boolean {
  const za = c.zones[l.a], zb = c.zones[l.b];
  const pa = za.ports.find((pt) => pt.link === l.id);
  if (!pa) return false;
  const q = toLocal(zb.frame, toWorld(za.frame, pa.p));
  const ex = Math.abs(Math.abs(q.x) - zb.w / 2), ey = Math.abs(Math.abs(q.y) - zb.h / 2);
  return (ex < 0.35 && Math.abs(q.y) <= zb.h / 2) || (ey < 0.35 && Math.abs(q.x) <= zb.w / 2);
}

/**
 * Hand edits on top of the seed's layout, in a fixed order: what a room is (feature, size, seed, district, tags,
 * floor), deletions, moves (in the order they were made: each moved room pushes the unpinned rooms it lands on),
 * added rooms. Links of rooms that changed place or size are routed again; touching rooms that still touch keep
 * their doorway; corridors that a moved room now sits on are routed round it.
 */
function applyEdits(c: Ctx, edits: Edits, root: Rng): void {
  const p = c.p;
  const clear = 0.8 - 0.75 * (p.tight ?? 0);
  const byKey = new Map(c.zones.map((z) => [z.key, z]));
  const changed = new Set<number>(), dead = new Set<number>(), pinned = new Set<number>(), deadLinks = new Set<number>();
  const sizeOf = (feature: string, key: string): [number, number] => {
    const f = FEATURE[feature], r = root.fork(`size:${key}:${feature}`);
    const [w0, w1] = f.w ?? [6, 10], [h0, h1] = f.h ?? [6, 10];
    return [Math.max(3, Math.round(w0 + (w1 - w0) * r.next() ** 1.4)), Math.max(3, Math.round(h0 + (h1 - h0) * r.next() ** 1.4))];
  };
  // 1. what a room is
  for (const [key, ed] of Object.entries(edits.zones)) {
    const z = byKey.get(key);
    if (!z) continue;
    if (ed.deleted) { dead.add(z.id); continue; }
    if (ed.feature && FEATURE[ed.feature]?.kind === 'zone' && ed.feature !== z.feature) {
      z.feature = ed.feature;
      if (FEATURE[ed.feature].theme) z.theme = FEATURE[ed.feature].theme!;
      if (!ed.w || !ed.h) { const [w, h] = sizeOf(ed.feature, key); resize(z, w, h); changed.add(z.id); }
    }
    if (ed.w && ed.h && (ed.w !== z.w || ed.h !== z.h)) { resize(z, ed.w, ed.h); changed.add(z.id); }
    if (ed.seed) z.seed = (z.seed + ed.seed) >>> 0;
    if (ed.theme) z.theme = ed.theme;
    if (ed.tags) z.tags = ed.tags.slice();
    if (ed.level !== undefined && ed.level !== z.level) { z.level = ed.level; changed.add(z.id); }
  }
  // 2. deleted rooms: the rooms that hung on them are joined to each other by corridors instead
  for (const d of dead) {
    const nb: number[] = [];
    for (const l of c.links) {
      if (deadLinks.has(l.id) || (l.a !== d && l.b !== d)) continue;
      deadLinks.add(l.id);
      const o = l.a === d ? l.b : l.a;
      if (!dead.has(o)) nb.push(o);
    }
    const parent = c.zones[d].parent;
    const hub = nb.includes(parent) ? parent : nb[0];
    for (const o of nb) if (o !== hub) c.pending.push({ a: hub, b: o, kind: 'corridor', loop: false });
  }
  // 3. moves, in the order they were made, then added rooms
  const place = (z: Zone, f: Frame) => { z.frame = f; z.pinned = true; pinned.add(z.id); changed.add(z.id); pushApart(c, z.id, clear, pinned, dead, changed); };
  for (const [key, ed] of Object.entries(edits.zones)) {
    if (ed.x === undefined || ed.y === undefined) continue;
    const z = byKey.get(key);
    if (z && !dead.has(z.id)) place(z, { x: ed.x, y: ed.y, a: ed.a ?? z.frame.a });
  }
  for (const a of edits.added) {
    const feature = FEATURE[a.feature]?.kind === 'zone' ? a.feature : 'room';
    const [w0, h0] = sizeOf(feature, a.key);
    const z: Zone = {
      id: c.zones.length, key: a.key, feature, frame: { x: a.x, y: a.y, a: a.a }, w: a.w ?? w0, h: a.h ?? h0,
      seed: root.fork(`seed:${a.key}`).int(0, 1e9), theme: FEATURE[feature].theme ?? 'base', level: 0, tags: [], ports: [],
      parent: -1, depth: 1, pinned: true, edges: [],
    };
    c.zones.push(z);
    place(z, z.frame);
    let best = -1, bd = Infinity;
    for (const o of c.zones) {
      if (o === z || dead.has(o.id) || o.feature === 'mass') continue;
      const d0 = dist(v2(o.frame.x, o.frame.y), v2(z.frame.x, z.frame.y));
      if (d0 < bd) { bd = d0; best = o.id; }
    }
    if (best >= 0) { z.parent = best; c.pending.push({ a: best, b: z.id, kind: 'corridor', loop: false }); }
  }
  // 4. links of rooms that changed, and corridors that a changed room now sits on, are routed again
  const boxes = new Map<number, V2[]>();
  for (const id of changed) { const z = c.zones[id]; boxes.set(id, obb(z.frame, z.w, z.h)); }
  for (const l of c.links) {
    if (deadLinks.has(l.id) || l.kind === 'portal') continue;
    let redo = changed.has(l.a) || changed.has(l.b);
    if (!redo && l.path.length >= 2) {
      for (const [id, bx] of boxes) {
        if (id === l.a || id === l.b) continue;
        for (let k = 0; k + 1 < l.path.length && !redo; k++) if (dist(l.path[k], l.path[k + 1]) > 0.2 && convexOverlap(segBox(l.path[k], l.path[k + 1], l.w), bx)) redo = true;
        if (redo) break;
      }
    }
    if (!redo || (l.kind === 'open' && stillTouching(c, l))) continue;
    deadLinks.add(l.id);
    const kind: LinkKind = l.kind === 'stair' || l.kind === 'ramp' || l.kind === 'impossible' ? l.kind : 'corridor';
    c.pending.push({ a: l.a, b: l.b, kind, edge: l.edge, loop: l.loop });
  }
  // 5. drop deleted rooms and dead links, renumber
  const newId = new Int32Array(c.zones.length).fill(-1);
  const zones = c.zones.filter((z) => !dead.has(z.id));
  zones.forEach((z, i) => { newId[z.id] = i; });
  const linkId = new Int32Array(c.links.length).fill(-1);
  const links = c.links.filter((l) => !deadLinks.has(l.id) && !dead.has(l.a) && !dead.has(l.b));
  links.forEach((l, i) => { linkId[l.id] = i; });
  for (const z of zones) {
    z.ports = z.ports.filter((pt) => linkId[pt.link] >= 0).map((pt) => ({ ...pt, link: linkId[pt.link] }));
    z.parent = z.parent >= 0 ? newId[z.parent] : -1;
  }
  links.forEach((l, i) => { l.id = i; l.a = newId[l.a]; l.b = newId[l.b]; });
  zones.forEach((z, i) => { z.id = i; });
  for (let i = 0; i < c.nodeZone.length; i++) if (c.nodeZone[i] >= 0) c.nodeZone[i] = newId[c.nodeZone[i]];
  c.pending = c.pending.filter((pl) => !dead.has(pl.a) && !dead.has(pl.b) && pl.a !== pl.b).map((pl) => ({ ...pl, a: newId[pl.a], b: newId[pl.b] }));
  c.zones = zones; c.links = links;
  // 6. the collision grid again, from the rooms and the corridors that stay
  c.hash = new Hash();
  for (const z of zones) c.hash.add(obb(z.frame, z.w, z.h), z.id, false);
  for (const l of links) {
    if (l.path.length < 2) continue;
    const flat = l.kind !== 'stair' && l.kind !== 'ramp' && l.kind !== 'impossible';
    for (let k = 0; k + 1 < l.path.length; k++) c.hash.add(segBox(l.path[k], l.path[k + 1], l.w), l.a, true, flat ? zones[l.a].level : NaN, [l.path[k], l.path[k + 1], l.w]);
  }
}

/**
 * A doorway between two rooms that sit side by side on one grid: through their shared wall when they touch, or a
 * very short corridor across the gap. Null when they are not side by side with enough shared wall.
 */
function direct(za: Zone, zb: Zone, w: number, maxGap: number): { pa: V2; aa: number; pb: V2; ab: number; gap: number } | null {
  const da = (((zb.frame.a - za.frame.a) % HALF_PI) + HALF_PI) % HALF_PI;
  if (Math.min(da, HALF_PI - da) > 1e-3) return null;
  const cs = obb(zb.frame, zb.w, zb.h).map((q) => toLocal(za.frame, q));
  const bx0 = Math.min(...cs.map((q) => q.x)), bx1 = Math.max(...cs.map((q) => q.x));
  const by0 = Math.min(...cs.map((q) => q.y)), by1 = Math.max(...cs.map((q) => q.y));
  const hw = za.w / 2, hh = za.h / 2;
  const sides = [
    { s: 0, gap: bx0 - hw, lo: Math.max(-hh, by0), hi: Math.min(hh, by1) },
    { s: 2, gap: -hw - bx1, lo: Math.max(-hh, by0), hi: Math.min(hh, by1) },
    { s: 1, gap: by0 - hh, lo: Math.max(-hw, bx0), hi: Math.min(hw, bx1) },
    { s: 3, gap: -hh - by1, lo: Math.max(-hw, bx0), hi: Math.min(hw, bx1) },
  ].filter((q) => q.gap >= -0.3 && q.gap <= maxGap && q.hi - q.lo >= w + 1.6).sort((a, b) => a.gap - b.gap);
  if (!sides.length) return null;
  const { s, gap, lo, hi } = sides[0];
  const t = (lo + hi) / 2;
  const aa = za.frame.a + s * HALF_PI;
  const pa = toWorld(za.frame, sidePoint(s, t, za.w, za.h));
  const pb = add(pa, mul(dir(aa), Math.max(0, gap)));
  return { pa, aa, pb, ab: aa + Math.PI, gap: Math.max(0, gap) };
}

// ------------------------------------------------------------------ 3. loops

/** Grid search between two zones around everything else, then pulled straight. */
function route(c: Ctx, za: Zone, zb: Zone, w: number, free: boolean, r: Rng, level = za.level): { path: V2[]; pa: V2; aa: number; pb: V2; ab: number } | null {
  const portOn = (z: Zone, target: V2): { p: V2; a: number } => {
    let best = -Infinity, s = 0;
    const toT = norm(sub(target, v2(z.frame.x, z.frame.y)));
    for (let k = 0; k < 4; k++) { const d = dot(dir(z.frame.a + k * HALF_PI), toT); if (d > best) { best = d; s = k; } }
    const half = sideHalf(s, z.w, z.h), m = w / 2 + 0.8;
    if (half - m < -half + m) return { p: toWorld(z.frame, sidePoint(s, 0, z.w, z.h)), a: z.frame.a + s * HALF_PI };
    const along = dot(sub(target, v2(z.frame.x, z.frame.y)), dir(z.frame.a + s * HALF_PI + HALF_PI));
    const t = Math.max(-half + m, Math.min(half - m, along + r.range(-2, 2)));
    return { p: toWorld(z.frame, sidePoint(s, t, z.w, z.h)), a: z.frame.a + s * HALF_PI };
  };
  const A = portOn(za, v2(zb.frame.x, zb.frame.y)), B = portOn(zb, v2(za.frame.x, za.frame.y));
  const S = add(A.p, mul(dir(A.a), 1.5)), G = add(B.p, mul(dir(B.a), 1.5));
  const bb = bboxOf([S, G]);
  const M = 30;
  const x0 = Math.floor(bb.x0 - M), y0 = Math.floor(bb.y0 - M);
  const W = Math.ceil(bb.x1 + M) - x0, H = Math.ceil(bb.y1 + M) - y0;
  if (W * H > 600_000) return null;
  const block = new Uint8Array(W * H);
  const grow = w / 2 + 0.5;
  for (const id of c.hash.near({ x0, y0, x1: x0 + W, y1: y0 + H })) {
    const it = c.hash.items[id];
    if (it.corridor) {
      // corridors on this floor are crossed (junctions); on another floor, or stairs, they are walls to go round
      if (it.level === level || !it.seg) continue;
      const [a, b, sw] = it.seg;
      const g2 = sw / 2 + grow;
      const pb = { x0: Math.min(a.x, b.x) - g2, y0: Math.min(a.y, b.y) - g2, x1: Math.max(a.x, b.x) + g2, y1: Math.max(a.y, b.y) + g2 };
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      for (let gy = Math.max(0, Math.floor(pb.y0 - y0)); gy <= Math.min(H - 1, Math.ceil(pb.y1 - y0)); gy++) {
        for (let gx = Math.max(0, Math.floor(pb.x0 - x0)); gx <= Math.min(W - 1, Math.ceil(pb.x1 - x0)); gx++) {
          const px = x0 + gx + 0.5, py = y0 + gy + 0.5;
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L2));
          if (Math.hypot(a.x + dx * t - px, a.y + dy * t - py) <= g2) block[gy * W + gx] = 1;
        }
      }
      continue;
    }
    if (it.zone === za.id || it.zone === zb.id) continue;
    const z = c.zones[it.zone];
    const poly = obb(z.frame, z.w, z.h, grow);
    const pb = bboxOf(poly);
    for (let gy = Math.max(0, Math.floor(pb.y0 - y0)); gy <= Math.min(H - 1, Math.ceil(pb.y1 - y0)); gy++) {
      for (let gx = Math.max(0, Math.floor(pb.x0 - x0)); gx <= Math.min(W - 1, Math.ceil(pb.x1 - x0)); gx++) {
        const q = toLocal(z.frame, v2(x0 + gx + 0.5, y0 + gy + 0.5));
        if (Math.abs(q.x) <= z.w / 2 + grow && Math.abs(q.y) <= z.h / 2 + grow) block[gy * W + gx] = 1;
      }
    }
  }
  const cell = (p: V2) => [Math.floor(p.x - x0), Math.floor(p.y - y0)] as const;
  const [sx, sy] = cell(S), [gx, gy] = cell(G);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H || gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
  block[sy * W + sx] = 0; block[gy * W + gx] = 0;
  const cells = astar(block, W, H, sx, sy, gx, gy, free);
  if (!cells) return null;
  let pts: V2[] = cells.map(([x, y]) => v2(x0 + x + 0.5, y0 + y + 0.5));
  pts[0] = S; pts[pts.length - 1] = G;
  const clear = (a: V2, b: V2): boolean => {
    const n = Math.ceil(dist(a, b) * 2);
    for (let k = 0; k <= n; k++) {
      const q = v2(a.x + ((b.x - a.x) * k) / n - x0, a.y + ((b.y - a.y) * k) / n - y0);
      const ix = Math.floor(q.x), iy = Math.floor(q.y);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H || block[iy * W + ix]) return false;
    }
    return true;
  };
  if (free) {
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !clear(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    pts = out;
  } else {
    const out = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const a = out[out.length - 1], b = pts[k], cN = pts[k + 1];
      if (Math.abs((b.x - a.x) * (cN.y - b.y) - (b.y - a.y) * (cN.x - b.x)) > 1e-6) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return { path: [A.p, ...pts, B.p], pa: A.p, aa: A.a, pb: B.p, ab: B.a };
}

function astar(block: Uint8Array, W: number, H: number, sx: number, sy: number, gx: number, gy: number, free: boolean): [number, number][] | null {
  const D = free ? 8 : 4;
  const dx = [1, -1, 0, 0, 1, 1, -1, -1], dy = [0, 0, 1, -1, 1, -1, 1, -1];
  const cost = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
  const S = free ? W * H : W * H * 4;
  const g = new Float32Array(S).fill(Infinity);
  const from = new Int32Array(S).fill(-1);
  const heap: number[] = [], hf: number[] = [];
  const push = (s: number, f: number) => {
    heap.push(s); hf.push(f);
    let i = heap.length - 1;
    while (i > 0) { const pI = (i - 1) >> 1; if (hf[pI] <= hf[i]) break; [heap[i], heap[pI]] = [heap[pI], heap[i]]; [hf[i], hf[pI]] = [hf[pI], hf[i]]; i = pI; }
  };
  const pop = (): number => {
    const top = heap[0];
    const ls = heap.pop()!, lf = hf.pop()!;
    if (heap.length) {
      heap[0] = ls; hf[0] = lf;
      let i = 0;
      for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < heap.length && hf[l] < hf[m]) m = l; if (rr < heap.length && hf[rr] < hf[m]) m = rr; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; [hf[i], hf[m]] = [hf[m], hf[i]]; i = m; }
    }
    return top;
  };
  const h = (x: number, y: number) => { const ax = Math.abs(x - gx), ay = Math.abs(y - gy); return free ? Math.max(ax, ay) + (Math.SQRT2 - 1) * Math.min(ax, ay) : ax + ay; };
  const start = free ? sy * W + sx : (sy * W + sx) * 4;
  g[start] = 0; push(start, h(sx, sy));
  let n = 0;
  while (heap.length) {
    const s = pop();
    if (++n > 400_000) return null;
    const c = free ? s : s >> 2, pd = free ? -1 : s & 3;
    const x = c % W, y = (c / W) | 0;
    if (x === gx && y === gy) {
      const out: [number, number][] = [];
      for (let k = s; k >= 0; k = from[k]) { const cc = free ? k : k >> 2; out.push([cc % W, (cc / W) | 0]); }
      return out.reverse();
    }
    for (let d = 0; d < D; d++) {
      const nx = x + dx[d], ny = y + dy[d];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || block[ny * W + nx]) continue;
      if (d >= 4 && (block[y * W + nx] || block[ny * W + x])) continue;
      const ns = free ? ny * W + nx : (ny * W + nx) * 4 + d;
      const ng = g[s] + cost[d] + (!free && pd >= 0 && pd !== d ? 3 : 0);
      if (ng < g[ns]) { g[ns] = ng; from[ns] = s; push(ns, ng + h(nx, ny)); }
    }
  }
  return null;
}

// ------------------------------------------------------------------ 4. prims for links and edges

/** One polygon for a whole corridor: both sides offset, mitred at the bends. Null if a bend is too sharp. */
function band(pts: V2[], w: number, ext: number): V2[] | null {
  const P = pts.filter((q, i) => i === 0 || dist(q, pts[i - 1]) > 1e-3);
  if (P.length < 2) return null;
  const n = P.length;
  const d0 = norm(sub(P[1], P[0])), dn = norm(sub(P[n - 1], P[n - 2]));
  P[0] = sub(P[0], mul(d0, ext));
  P[n - 1] = add(P[n - 1], mul(dn, ext));
  const L: V2[] = [], Rr: V2[] = [];
  for (let i = 0; i < n; i++) {
    let m: V2, l = w / 2;
    if (i === 0) m = perp(d0);
    else if (i === n - 1) m = perp(dn);
    else {
      const a = perp(norm(sub(P[i], P[i - 1]))), b = perp(norm(sub(P[i + 1], P[i])));
      m = norm(add(a, b));
      const c = dot(m, a);
      if (c < 0.35) return null;
      l = w / 2 / c;
    }
    L.push(add(P[i], mul(m, l)));
    Rr.push(sub(P[i], mul(m, l)));
  }
  return [...L, ...Rr.reverse()];
}

function corridorPrims(link: Link, zones: Zone[], r: Rng): Prim[] {
  const out: Prim[] = [];
  const zone = link.a;
  const P = link.path;
  const one = band(P, link.w, 0.6);
  if (one) out.push({ t: 'floor', pts: one, zone, corr: true });
  else {
    for (let k = 0; k + 1 < P.length; k++) {
      const first = k === 0, last = k + 2 === P.length;
      const a = P[k], b = P[k + 1];
      if (dist(a, b) < 1e-3) continue;
      const d = norm(sub(b, a));
      const a2 = first ? sub(a, mul(d, 0.6)) : a, b2 = last ? add(b, mul(d, 0.6)) : b;
      out.push({ t: 'floor', pts: segBox(a2, b2, link.w, first || last ? 0 : link.w / 2), zone, corr: true });
      if (!last) out.push({ t: 'floor', pts: octagon(b, link.w / 2), zone, corr: true });
    }
  }
  // lights along the middle
  let acc = 1.5;
  for (let k = 0; k + 1 < P.length; k++) {
    const a = P[k], b = P[k + 1], L = dist(a, b);
    for (; acc < L; acc += 3) {
      const q = v2(a.x + ((b.x - a.x) * acc) / L, a.y + ((b.y - a.y) * acc) / L);
      if (dist(q, P[0]) > 1.2 && dist(q, P[P.length - 1]) > 1.2) out.push({ t: 'light', p: q, zone, kind: r.chance(0.03) ? 'off' : r.chance(0.03) ? 'flicker' : undefined });
    }
    acc -= L;
  }
  // stairs and ramps on the longest straight piece
  if (link.kind === 'stair' || link.kind === 'ramp' || link.kind === 'impossible') {
    let best = 0, bk = 0;
    for (let k = 0; k + 1 < P.length; k++) { const L = dist(P[k], P[k + 1]); if (L > best) { best = L; bk = k; } }
    const a = P[bk], b = P[bk + 1];
    const L = Math.min(best - 1.2, link.kind === 'ramp' ? 7 : 5);
    if (L > 1) {
      const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2), d = norm(sub(b, a));
      const down = zones[link.b].level < zones[link.a].level || link.kind === 'impossible' ? Math.atan2(d.y, d.x) : Math.atan2(-d.y, -d.x);
      out.push({ t: 'stairs', pts: segBox(sub(mid, mul(d, L / 2)), add(mid, mul(d, L / 2)), link.w), dir: down, steps: Math.round(L * 2), zone, ramp: link.kind === 'ramp', impossible: link.kind === 'impossible' });
    }
  }
  return out;
}

function octagon(c: V2, r: number): V2[] {
  const pts: V2[] = [];
  for (let k = 0; k < 8; k++) { const a = ((k + 0.5) / 8) * Math.PI * 2; pts.push(v2(c.x + Math.cos(a) * r * 1.08, c.y + Math.sin(a) * r * 1.08)); }
  return pts;
}

/** The wall between two zones that touch, with its doorway. */
function openPrims(link: Link, zones: Zone[]): Prim[] {
  const za = zones[link.a], zb = zones[link.b];
  const pa = za.ports.find((p) => p.link === link.id);
  if (!pa) return [];
  const s = Math.round((((pa.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / HALF_PI) & 3;
  // child's corners in the parent's frame, measured along the side
  const corners = obb(zb.frame, zb.w, zb.h).map((q) => toLocal(za.frame, q));
  const along = (q: V2) => ((s & 1) === 0 ? q.y : q.x);
  const vals = corners.map(along);
  const half = sideHalf(s, za.w, za.h);
  const lo = Math.max(-half, Math.min(...vals)), hi = Math.min(half, Math.max(...vals));
  const t = along(pa.p);
  const out: Prim[] = [];
  const seg = (u0: number, u1: number) => {
    if (u1 - u0 < 0.15) return;
    const a = toWorld(za.frame, sidePoint(s, u0, za.w, za.h)), b = toWorld(za.frame, sidePoint(s, u1, za.w, za.h));
    out.push({ t: 'wall', a, b, w: 0.3, zone: za.id });
  };
  if (zb.feature === 'mass') { seg(lo, hi); return out; }
  seg(lo, t - link.w / 2);
  seg(t + link.w / 2, hi);
  return out;
}

function edgePrims(link: Link, zones: Zone[]): Prim[] {
  if (!link.edge) return [];
  const zb = zones[link.b];
  const pb = zb.ports.find((p) => p.link === link.id);
  if (!pb) return [];
  const at = toWorld(zb.frame, pb.p);
  const ang = zb.frame.a + pb.a;
  const n = dir(ang), t = perp(n);
  const a = sub(at, mul(t, link.w / 2 + 0.1)), b = add(at, mul(t, link.w / 2 + 0.1));
  switch (link.edge) {
    case 'stuckdoor': return [{ t: 'wall', a, b, w: 0.25, zone: zb.id, closed: true }, { t: 'mark', p: add(at, mul(n, -0.7)), a: ang + Math.PI, s: link.w, zone: zb.id, kind: 'stuckdoor' }];
    case 'blocked': return [{ t: 'solid', pts: segBox(add(a, mul(n, -0.6)), add(b, mul(n, -0.6)), 1), zone: zb.id, kind: 'furniture', closed: true }, { t: 'mark', p: add(at, mul(n, -0.6)), a: ang, s: link.w, zone: zb.id, kind: 'cupboard' }];
    case 'gate': return [{ t: 'wall', a, b, w: 0.2, zone: zb.id, kind: 'bars', closed: true }];
    default: return [];
  }
}

function zoneEdgePrims(z: Zone, r: Rng): Prim[] {
  const out: Prim[] = [];
  const used = new Set(z.ports.map((p) => Math.round((((p.a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / HALF_PI) & 3));
  const free = [0, 1, 2, 3].filter((s) => !used.has(s));
  for (const e of z.edges) {
    if (e === 'circle') {
      for (const p of z.ports) out.push({ t: 'mark', p: toWorld(z.frame, add(p.p, mul(dir(p.a), -1.2))), a: z.frame.a + p.a, s: 0.9, zone: z.id, kind: 'exit' });
      continue;
    }
    if (!free.length) break;
    const s = r.pick(free);
    const half = sideHalf(s, z.w, z.h);
    const W = (t: number, inset: number) => toWorld(z.frame, add(sidePoint(s, t, z.w, z.h), mul(dir(s * HALF_PI), -inset)));
    const ang = z.frame.a + s * HALF_PI;
    if (e === 'windowwall') { const a = W(-half * 0.85, 0.15), b = W(half * 0.85, 0.15); out.push({ t: 'wall', a, b, w: 0.35, zone: z.id, kind: 'glass' }); }
    if (e === 'fakewindow') { const k = r.int(2, 4); for (let i = 0; i < k; i++) out.push({ t: 'mark', p: W(-half * 0.7 + (1.4 * half * (i + 0.5)) / k, 0.3), a: ang, s: Math.min(2.4, (1.2 * half) / k), zone: z.id, kind: 'fakewindow' }); }
    if (e === 'shopfront') out.push({ t: 'mark', p: W(0, 0.3), a: ang, s: Math.min(8, half * 1.2), zone: z.id, kind: 'shopfront' });
  }
  return out;
}

/** Where two corridors cross on the same floor: a square of floor and a light, so it reads as a crossroads. */
function junctions(links: Link[], zones: Zone[]): Prim[] {
  type Seg = { l: Link; a: V2; b: V2; bb: BBox };
  const segs: Seg[] = [];
  for (const l of links) {
    if (l.path.length < 2 || l.kind === 'stair' || l.kind === 'ramp' || l.kind === 'impossible' || l.kind === 'portal') continue;
    if (zones[l.a].level !== zones[l.b].level) continue;
    for (let k = 0; k + 1 < l.path.length; k++) segs.push({ l, a: l.path[k], b: l.path[k + 1], bb: bboxOf([l.path[k], l.path[k + 1]]) });
  }
  const G = 24, cells = new Map<string, number[]>();
  segs.forEach((sg, i) => {
    for (let x = Math.floor(sg.bb.x0 / G); x <= Math.floor(sg.bb.x1 / G); x++) for (let y = Math.floor(sg.bb.y0 / G); y <= Math.floor(sg.bb.y1 / G); y++) {
      const k = `${x},${y}`; let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(i);
    }
  });
  const out: Prim[] = [], seen = new Set<string>();
  for (const ids of cells.values()) for (let u = 0; u < ids.length; u++) for (let v = u + 1; v < ids.length; v++) {
    const A = segs[ids[u]], B = segs[ids[v]];
    if (A.l === B.l || zones[A.l.a].level !== zones[B.l.a].level) continue;
    const key = ids[u] < ids[v] ? `${ids[u]}:${ids[v]}` : `${ids[v]}:${ids[u]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (A.bb.x1 < B.bb.x0 || B.bb.x1 < A.bb.x0 || A.bb.y1 < B.bb.y0 || B.bb.y1 < A.bb.y0) continue;
    const r = sub(A.b, A.a), q = sub(B.b, B.a), den = r.x * q.y - r.y * q.x;
    if (Math.abs(den) < 1e-9) continue;
    const w0 = sub(B.a, A.a);
    const t = (w0.x * q.y - w0.y * q.x) / den, s2 = (w0.x * r.y - w0.y * r.x) / den;
    const La = Math.hypot(r.x, r.y), Lb = Math.hypot(q.x, q.y);
    // not where a corridor meets its own room
    const ea = 1.5 / La, eb = 1.5 / Lb;
    if (t < ea || t > 1 - ea || s2 < eb || s2 > 1 - eb) continue;
    const at = add(A.a, mul(r, t));
    const side = Math.max(A.l.w, B.l.w) + 1;
    const d = norm(r);
    out.push({ t: 'floor', pts: segBox(sub(at, mul(d, side / 2)), add(at, mul(d, side / 2)), side), zone: A.l.a, corr: true });
    out.push({ t: 'light', p: at, zone: A.l.a });
  }
  return out;
}

// ------------------------------------------------------------------ 5. layer 2

function layer2(zones: Zone[], links: Link[], p: Params, r: Rng): Prim[] {
  const out: Prim[] = [];
  const vents: V2[] = [];
  for (const z of zones) {
    if (z.feature === 'mass' || z.tags.includes('noceiling')) continue;
    const zr = r.fork(z.key);
    if (zr.chance(Math.min(1, 0.35 * wOf(p, 'vent')))) {
      const s = zr.int(0, 3), half = sideHalf(s, z.w, z.h);
      const q = toWorld(z.frame, add(sidePoint(s, zr.range(-half * 0.7, half * 0.7), z.w, z.h), mul(dir(s * HALF_PI), -0.6)));
      out.push({ t: 'mark', p: q, a: z.frame.a + s * HALF_PI, s: 0.8, zone: z.id, kind: 'vent' });
      vents.push(q);
    }
    if (zr.chance(Math.min(1, 0.08 * wOf(p, 'hatch')))) {
      const q = toWorld(z.frame, v2(zr.range(-z.w / 3, z.w / 3), zr.range(-z.h / 3, z.h / 3)));
      out.push({ t: 'mark', p: q, a: z.frame.a, s: 1, zone: z.id, kind: 'hatch' });
      vents.push(q);
    }
  }
  // ducts: a tree over the vents (Prim's algorithm)
  if (vents.length > 1 && wOf(p, 'duct') > 0) {
    const inTree = new Uint8Array(vents.length);
    const best = new Float64Array(vents.length).fill(Infinity), from = new Int32Array(vents.length).fill(-1);
    inTree[0] = 1;
    for (let j = 1; j < vents.length; j++) { best[j] = dist(vents[0], vents[j]); from[j] = 0; }
    for (let k = 1; k < vents.length; k++) {
      let m = -1;
      for (let j = 0; j < vents.length; j++) if (!inTree[j] && (m < 0 || best[j] < best[m])) m = j;
      inTree[m] = 1;
      const a = vents[from[m]], b = vents[m];
      if (best[m] < 60) out.push({ t: 'duct', pts: p.turn < 0.3 ? [a, v2(b.x, a.y), b] : [a, b], kind: 'duct', w: 0.8 });
      for (let j = 0; j < vents.length; j++) if (!inTree[j]) { const d = dist(b, vents[j]); if (d < best[j]) { best[j] = d; from[j] = m; } }
    }
  }
  // crawlspaces between close zones that are not joined
  const linked = new Set(links.map((l) => `${Math.min(l.a, l.b)}:${Math.max(l.a, l.b)}`));
  for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
    const a = zones[i], b = zones[j];
    if (a.feature === 'mass' || b.feature === 'mass' || linked.has(`${i}:${j}`)) continue;
    const ca = v2(a.frame.x, a.frame.y), cb = v2(b.frame.x, b.frame.y);
    const ra = Math.min(a.w, a.h) / 2, rb = Math.min(b.w, b.h) / 2;
    const d = dist(ca, cb);
    const gap = d - Math.max(a.w, a.h) / 2 - Math.max(b.w, b.h) / 2;
    if (gap > 3 || d < 1) continue;
    if (!r.fork(`crawl:${i}:${j}`).chance(Math.min(1, 0.25 * wOf(p, 'crawl')))) continue;
    const u = norm(sub(cb, ca));
    out.push({ t: 'duct', pts: [add(ca, mul(u, ra * 0.8)), sub(cb, mul(u, rb * 0.8))], kind: 'crawl', w: 0.7 });
  }
  return out;
}

// ------------------------------------------------------------------ main

/** `stats: false` skips the walk/fill raster (analyze), which can follow later with addStats(). */
export function generate(p: Params, edits: Edits = emptyEdits(), opts: { stats?: boolean } = {}): MapOut {
  const t0 = performance.now();
  const root = new Rng(p.seed >>> 0);
  // the layout comes from the seed and settings alone; the user's edits are applied on top of it afterwards
  // (applyEdits), so an edit only changes the rooms it touches
  const nodes = plan(p, emptyEdits(), root);
  const c: Ctx = { p, nodes, zones: [], links: [], hash: new Hash(), nodeZone: new Int32Array(nodes.length).fill(-1), pending: [], dropped: 0, unrouted: [] };
  const placeR = root.fork('place');
  // the hub
  {
    const n = nodes[0];
    const [w, h] = sizeFor(n, placeR.fork(n.key), 1, p);
    const f = { x: 0, y: 0, a: p.turn > 0 ? placeR.fork('rootturn').range(-0.5, 0.5) * p.turn : 0 };
    addZone(c, 0, f, w, h, -1);
  }
  // breadth first from the hub
  const order: number[] = [];
  const q = [0];
  while (q.length) { const i = q.shift()!; order.push(i); q.push(...nodes[i].children); }
  const goal = targetCount(p);
  for (const i of order) {
    if (i === 0) continue;
    const n = nodes[i];
    // the map is full: planned rooms beyond the count stay out
    if (c.zones.length >= goal) continue;
    // a parent that found no place hands its children up to the nearest placed ancestor
    let anc = n.parent;
    while (anc >= 0 && c.nodeZone[anc] < 0) anc = nodes[anc].parent;
    const pz = anc >= 0 ? c.nodeZone[anc] : -1;
    if (pz < 0) { c.dropped++; continue; }
    const r = placeR.fork(n.key);
    if (attach(c, i, c.zones[pz], r)) continue;
    // no room next to the parent: hang it on a nearby zone instead
    const pzZ = c.zones[pz];
    const others = c.zones.filter((z) => z.id !== pz && z.feature !== 'mass' && FEATURE[z.feature].role !== 'end')
      .map((z) => [z, dist(v2(z.frame.x, z.frame.y), v2(pzZ.frame.x, pzZ.frame.y))] as const)
      .sort((a, b) => a[1] - b[1]).slice(0, 24);
    let ok = false;
    for (const [z] of others) if (attach(c, i, z, r.fork(`alt:${z.key}`), 12)) { ok = true; break; }
    if (!ok) c.dropped++;
  }
  // loops between zones that are close in space but far in the tree (chosen on the seed's layout, before edits)
  const loopR = root.fork('loops');
  const adj: number[][] = c.zones.map(() => []);
  for (const l of c.links) { adj[l.a].push(l.b); adj[l.b].push(l.a); }
  const hops = (a: number, b: number, max: number): number => {
    const seen = new Map<number, number>([[a, 0]]);
    const qq = [a];
    while (qq.length) { const x = qq.shift()!; const d = seen.get(x)!; if (x === b) return d; if (d >= max) continue; for (const y of adj[x]) if (!seen.has(y)) { seen.set(y, d + 1); qq.push(y); } }
    return max + 1;
  };
  const cands: [number, number, number][] = [];
  const okLoop = (z: Zone) => z.feature !== 'mass' && FEATURE[z.feature].role !== 'end';
  for (let i = 0; i < c.zones.length; i++) for (let j = i + 1; j < c.zones.length; j++) {
    const a = c.zones[i], b = c.zones[j];
    if (!okLoop(a) || !okLoop(b)) continue;
    const d = dist(v2(a.frame.x, a.frame.y), v2(b.frame.x, b.frame.y));
    const reach = Math.max(a.w, a.h) / 2 + Math.max(b.w, b.h) / 2 + 6 + 22 * p.loops;
    if (d > reach) continue;
    const h = hops(i, j, 12);
    if (h < 4) continue;
    cands.push([i, j, h + loopR.next() * 3]);
  }
  cands.sort((x, y) => y[2] - x[2]);
  const want = Math.round(c.zones.length * p.loops * 0.3);
  let made = 0;
  for (const [i, j] of cands) {
    if (made >= want) break;
    if (hops(i, j, 12) < 4) continue;
    c.pending.push({ a: i, b: j, kind: 'corridor', loop: true });
    adj[i].push(j); adj[j].push(i);
    made++;
  }
  // the user's edits, on top of the seed's layout
  applyEdits(c, edits, root);
  // route the pending links
  for (const pl of c.pending) {
    const za = c.zones[pl.a], zb = c.zones[pl.b];
    const r = loopR.fork(`route:${za.key}:${zb.key}`);
    const w = r.int(2, 3);
    const sameFloor = za.level === zb.level;
    // rooms side by side (often after a move pushed them together): a doorway through the shared wall
    const dr = sameFloor ? direct(za, zb, w, 2) : null;
    if (dr) {
      const touch = dr.gap < 0.15;
      const link: Link = { id: c.links.length, a: za.id, b: zb.id, kind: touch ? 'open' : 'corridor', path: touch ? [] : [dr.pa, dr.pb], w, loop: pl.loop, edge: pl.edge };
      c.links.push(link);
      addPort(za, dr.pa, dr.aa, w, link.id);
      addPort(zb, dr.pb, dr.ab, w, link.id);
      if (!touch) c.hash.add(segBox(dr.pa, dr.pb, w), za.id, true, za.level, [dr.pa, dr.pb, w]);
      continue;
    }
    let res = route(c, za, zb, w, p.turn >= 0.3, r, sameFloor ? za.level : NaN);
    // a link the map needs (not a loop): try the other kind of search before giving up
    if (!res && !pl.loop) res = route(c, za, zb, w, p.turn < 0.3, r, sameFloor ? za.level : NaN);
    const d0 = dist(v2(za.frame.x, za.frame.y), v2(zb.frame.x, zb.frame.y));
    const length = res ? res.path.reduce((s, q, k) => (k ? s + dist(res.path[k - 1], q) : 0), 0) : Infinity;
    if (!res || (pl.loop && length > d0 * 2.4 + 20)) {
      if (!pl.loop) c.unrouted.push(`${za.key}/${za.feature} -> ${zb.key}/${zb.feature}: ${res ? `too long (${length.toFixed(0)} vs ${d0.toFixed(0)})` : 'no route'}`);
      if (pl.loop && r.chance(Math.min(1, p.anomalies * wOf(p, 'portal') * 3))) {
        const link: Link = { id: c.links.length, a: za.id, b: zb.id, kind: 'portal', path: [], w: 1.6, loop: true };
        c.links.push(link);
        const sa = r.int(0, 3), sb = r.int(0, 3);
        addPort(za, toWorld(za.frame, sidePoint(sa, 0, za.w, za.h)), za.frame.a + sa * HALF_PI, 1.6, link.id);
        addPort(zb, toWorld(zb.frame, sidePoint(sb, 0, zb.w, zb.h)), zb.frame.a + sb * HALF_PI, 1.6, link.id);
      }
      continue;
    }
    const link: Link = { id: c.links.length, a: za.id, b: zb.id, kind: sameFloor ? pl.kind : 'stair', path: res.path, w, loop: pl.loop, edge: pl.edge };
    c.links.push(link);
    addPort(za, res.pa, res.aa, w, link.id);
    addPort(zb, res.pb, res.ab, w, link.id);
    for (let k = 0; k + 1 < res.path.length; k++) c.hash.add(segBox(res.path[k], res.path[k + 1], w), za.id, true, sameFloor ? za.level : NaN, [res.path[k], res.path[k + 1], w]);
  }
  // fill
  const prims: Prim[] = [];
  const fillR = root.fork('fill');
  for (const l of c.links) {
    if (l.kind === 'open') prims.push(...openPrims(l, c.zones));
    else if (l.kind === 'portal') {
      l.path = [];
      for (const zid of [l.a, l.b]) {
        const z = c.zones[zid], pt = z.ports.find((pp) => pp.link === l.id)!;
        prims.push({ t: 'mark', p: toWorld(z.frame, add(pt.p, mul(dir(pt.a), -0.6))), a: z.frame.a + pt.a, s: 1.4, zone: zid, kind: 'portal', label: `P${l.id}` });
      }
    } else prims.push(...corridorPrims(l, c.zones, fillR.fork(`link:${l.id}`)));
    prims.push(...edgePrims(l, c.zones));
  }
  for (const z of c.zones) {
    const n = nodes[c.nodeZone.indexOf(z.id)];
    const seed = n?.copyOf !== undefined && c.nodeZone[n.copyOf] >= 0 ? c.zones[c.nodeZone[n.copyOf]].seed : z.seed;
    prims.push(...buildZone(z, new Rng(seed)));
    prims.push(...zoneEdgePrims(z, fillR.fork(`edge:${z.key}`)));
  }
  prims.push(...junctions(c.links, c.zones));
  prims.push(...layer2(c.zones, c.links, p, root.fork('layer2')));
  for (const note of edits.notes) prims.push({ t: 'label', p: v2(note.x, note.y), text: note.text, zone: -1, size: 1.1 });
  // bounds
  const bb: BBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const pr of prims) if (pr.t === 'floor' || pr.t === 'solid') bboxOf(pr.pts, bb);
  if (!Number.isFinite(bb.x0)) Object.assign(bb, box(-10, -10, 10, 10).reduce((b, q) => bboxOf([q], b), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }));
  const out: MapOut = {
    params: p, zones: c.zones, links: c.links, prims, bounds: bb,
    stats: { zones: c.zones.length, links: c.links.length, loops: 0, deadEnds: 0, reached: 0, cutOff: [], floorShare: 0, landmarks: 0, dropped: c.dropped, ms: 0, widthFt: (bb.x1 - bb.x0) * 2, heightFt: (bb.y1 - bb.y0) * 2 },
  };
  const deg = c.zones.map(() => 0);
  for (const l of c.links) { deg[l.a]++; deg[l.b]++; }
  out.stats.deadEnds = c.zones.filter((z, i) => deg[i] === 1 && z.feature !== 'mass').length;
  out.stats.loops = Math.max(0, c.links.length - (c.zones.length - 1));
  out.stats.landmarks = c.zones.filter((z) => FEATURE[z.feature].role === 'landmark').length;
  out.stats.ms = Math.round(performance.now() - t0);
  if (c.unrouted.length) out.stats.unrouted = c.unrouted;
  if (opts.stats !== false) addStats(out);
  return out;
}

/** The walk/fill checks (analyze.ts) into the map's stats. */
export function addStats(m: MapOut): MapOut {
  Object.assign(m.stats, analyze(m));
  return m;
}
