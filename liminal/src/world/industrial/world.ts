import { MapOut, type V3 } from '../mapOut';
import { Rng } from '../rng';
import { carve, type Finish, type Hollow } from '../carve';
import { walkTile, stairs, tubePath, TILE, STEP, DX, DY, opposite, type Dir } from '../kit/aperture';
import { makeLayout, type Block, type Layout, type LayoutParams, type Street } from './layout';

/**
 * The industrial world's geometry, from a layout (layout.ts): what each mass
 * is made of, the steel that carries everything, what runs through the
 * streets, what stands in the halls, and what is cut into the masses
 * (corridors, rooms, stair halls). A clean, working, empty plant. No lights
 * yet: this is judged in flat light.
 *
 * The rules it keeps (STYLE.md, "World: industrial v2"):
 *  - Nothing floats. Masses and columns run down out of sight (DEEP). Every
 *    catwalk hangs by rods from a beam; every beam ends on two columns that
 *    stand at the street's edges; a catwalk from a doorway out to the lane
 *    rests on brackets from the wall; tubes rest on brackets from the columns
 *    or on struts from a wall, and both their ends go into a wall.
 *  - A cable is tied at both ends, to beams.
 *  - Only the short kit list: walkways, stairs, beams, wall panels, tubes,
 *    pipes, ducts. What stands in a hall is built from the same.
 *  - Districts differ in what their masses are and how much pipe and tube
 *    they carry; steel is grey, here and there yellow.
 *
 * Every mass keeps a margin of MARGIN units inside its block for its own
 * steel (columns, ring beams, pipes), so nothing it carries can reach a
 * catwalk, however narrow the street. A doorway crosses that margin in a
 * porch.
 */
const LEVEL = 2 * STEP;   // one catwalk level = two flights of stairs
const MARGIN = 64;
/** How far below the lowest catwalk "out of sight" is (the review fog is solid well before this). */
const DEPTH = 9500;

// Materials of modern Aperture's back-of-house (docs/P2_STUDY.md).
const T = {
  panels: ['anim_wp/framework/backpanels02', 'anim_wp/framework/backpanels'],       // the outside of test chamber walls
  dark: ['metal/metalwall_bts_001b', 'metal/metalwall_bts_006a'],
  concrete: ['concrete/concrete_bts_wall001a', 'concrete/concrete_bts_modular_wall001a'],
  black: 'metal/black_wall_metal_002a',
  steel: 'anim_wp/framework/squarebeams',
  yellow: 'metal/metalbeam_bts_001c',
};
/** What a corridor or a room cut into a mass is finished in, by what the mass is. */
const FINISH: Record<'machine' | 'pier', Finish[]> = {
  pier: [
    { floor: 'concrete/concrete_bts_floor001a', wall: 'concrete/concrete_bts_wall001a', ceil: 'concrete/concrete_bts_ceiling001a', scale: 0.25, lightmapscale: 16 },
    { floor: 'concrete/concrete_bts_floor001a', wall: 'concrete/concrete_bts_modular_wall001a', ceil: 'concrete/concrete_bts_ceiling001a', scale: 0.25, lightmapscale: 16 },
  ],
  machine: [
    { floor: 'metal/black_floor_metal_001c', wall: 'metal/metalwall_bts_001b', ceil: 'metal/black_ceiling_metal_001a', scale: 0.25, lightmapscale: 16 },
    { floor: 'concrete/concrete_bts_floor001a', wall: 'metal/metalwall_bts_001b', ceil: 'concrete/concrete_bts_ceiling001a', scale: 0.25, lightmapscale: 16 },
  ],
};

export type WorldParams = Partial<LayoutParams>;

type MassKind = 'chambers' | 'machine' | 'pier' | 'frame' | 'bridge';
interface MassBox { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number; kind: MassKind }
interface District { x: number; y: number; steel: string; mass: (readonly [MassKind, number])[]; cables: number; tubes: number; pipes: number }
type Steel = (min: V3, max: V3, tex?: string) => number;
type Box = { min: V3; max: V3 };
export interface Note { kind: string; at: V3; yaw: number }

/** An opening in a mass's face: a doorway (with a porch across the margin) or a look-out slit. */
interface Door {
  /** Which face of the mass. */ side: Dir;
  /** Its middle along the face (y on the east and west faces, x on the north and south). */ at: number;
  z: number; w: number; h: number;
  slit?: boolean;
  /** Tiles of catwalk between the porch and the street's lane, and whether the catwalk ends there (a balcony). */
  stub: number; balcony: boolean;
}
/** What is cut into one mass. */
interface Inner { finish: Finish; hollows: Hollow[]; doors: Door[]; steps: { min: V3; max: V3; riser: Dir }[]; ribs: [V3, V3][] }

interface Ctx {
  m: MapOut; lay: Layout; root: Rng; L: number;
  zOf: (level: number) => number;
  steel: Steel;
  masses: MassBox[];
  /** Floor heights of catwalk, stair and corridor tiles, by `${tileX},${tileY}`. */
  walkZ: Map<string, number[]>;
  /** What a street's frames must carry, by tile: deck heights, and whether the deck there is level (or a stair). */
  decks: Map<string, { z: number; flat: boolean }[]>;
  /** Everything cut into the masses, doorways out to the block's edge included: nothing else may pass through these. */
  hollows: Box[];
  districtAt: (x: number, y: number) => District;
  top: number; bottom: number; deep: number; size: number;
  /** Places worth a look when reviewing (kind, a point to stand on, the way to face). */
  notes: Note[];
}

export function industrial(seed: number, params: WorldParams = {}): { map: MapOut; layout: Layout; notes: Note[] } {
  const lay = makeLayout(seed, { streets: [[1, 2], [3, 5], [5, 2], [7, 1]], ...params });
  const m = new MapOut();
  const root = new Rng(seed).fork('world');
  const L = lay.params.levels, N = lay.params.size;
  const zOf = (level: number) => (level - Math.floor(L / 2)) * LEVEL;
  const centre = (x: number, y: number, level: number): V3 => [x * TILE + TILE / 2, y * TILE + TILE / 2, zOf(level)];
  const size = N * TILE;
  const steel: Steel = (min, max, tex = T.steel) => m.box(min, max, { tex, group: 'func_detail', lightmapscale: 64, scale: 0.25 });
  const blockOf = (x: number, y: number) => lay.tileBlock[y * N + x];

  // ---- districts
  const dr = root.fork('districts');
  const districts: District[] = Array.from({ length: 7 }, () => ({
    x: dr.range(0, size), y: dr.range(0, size),
    steel: dr.pick([T.steel, T.steel, T.steel, T.steel, T.yellow]),
    mass: dr.pick([
      [['chambers', 6], ['machine', 2], ['pier', 1], ['frame', 2]],
      [['chambers', 2], ['machine', 5], ['pier', 2], ['frame', 1]],
      [['chambers', 1], ['machine', 2], ['pier', 5], ['frame', 1]],
      [['chambers', 2], ['machine', 2], ['pier', 1], ['frame', 6]],
    ] as (readonly [MassKind, number])[][]),
    cables: dr.pick([0, 0.5, 1, 1]), tubes: dr.pick([0.3, 0.7, 1, 1.6, 2.4]), pipes: dr.pick([0.2, 0.6, 1, 1.6]),
  }));
  const districtAt = (x: number, y: number) => districts.reduce((b, d) => (Math.hypot(d.x - x, d.y - y) < Math.hypot(b.x - x, b.y - y) ? d : b));

  const bottom = zOf(0), top = zOf(L - 1);
  const ctx: Ctx = { m, lay, root, L, zOf, steel, masses: [], walkZ: new Map(), decks: new Map(), hollows: [], districtAt, top, bottom, deep: bottom - DEPTH, size, notes: [] };
  const noteWalk = (x: number, y: number, z: number) => { const k = `${x},${y}`; const a = ctx.walkZ.get(k); if (a) a.push(z); else ctx.walkZ.set(k, [z]); };
  const noteDeck = (x: number, y: number, z: number, flat: boolean) => { const k = `${x},${y}`; const a = ctx.decks.get(k); if (a) a.push({ z, flat }); else ctx.decks.set(k, [{ z, flat }]); };

  // ---- what each mass is. One the maze goes through must be solid, stand from below and reach above every level.
  const cutBlocks = new Set<number>();
  for (const w of lay.walks) for (const [x, y] of lay.segments[w.segment].tiles) if (blockOf(x, y) >= 0) cutBlocks.add(blockOf(x, y));
  for (const k of lay.nodes.keys()) { const J = lay.junctions[Number(k.split(':')[0])]; if (blockOf(J.x, J.y) >= 0) cutBlocks.add(blockOf(J.x, J.y)); }
  interface Plan { r: Rng; D: District; kind: MassKind; x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }
  const plans = new Map<number, Plan>();
  for (const b of lay.blocks) {
    if (b.kind !== 'mass') continue;
    const r = root.fork(`mass${b.id}`);
    const x0 = b.rect.x0 * TILE + MARGIN, y0 = b.rect.y0 * TILE + MARGIN, x1 = b.rect.x1 * TILE - MARGIN, y1 = b.rect.y1 * TILE - MARGIN;
    const D = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
    let kind = r.weighted(D.mass);
    // Most run out of sight above; some stop short, so you can see over them.
    let z1 = r.chance(0.3) ? zOf(r.int(1, L - 1)) + r.pick([-64, 96, 160]) : top + r.range(1500, 4500);
    // A machine or a chamber stack may begin part-way up: then it stands on its steel frame, which goes on down.
    const raised = (kind === 'machine' || kind === 'chambers') && z1 > top && r.chance(0.2);
    let z0 = raised ? Math.min(zOf(r.int(1, L - 1)) + 160, z1 - 512) : ctx.deep;
    if (cutBlocks.has(b.id)) {
      if (kind !== 'machine' && kind !== 'pier') kind = r.weighted(D.mass.filter(([k]) => k === 'machine' || k === 'pier'));
      z0 = ctx.deep;
      if (z1 < top + 700) z1 = top + r.range(700, 3000);
    }
    plans.set(b.id, { r, D, kind, x0, y0, x1, y1, z0, z1 });
  }
  const inner = interiors(ctx, (blk) => plans.get(blk)!.kind as 'machine' | 'pier');

  // ---- masses: all stand on something that runs down out of sight
  for (const [id, p] of plans) {
    const { r, D, kind, x0, y0, x1, y1, z0, z1 } = p;
    ctx.masses.push({ x0, y0, x1, y1, z0, z1, kind });
    if (kind === 'chambers') chamberStack(ctx, r, x0, y0, x1, y1, z0, z1, D.steel);
    else if (kind === 'frame') frameTower(ctx, r, x0, y0, x1, y1, z1, D.steel);
    else {
      const cut = inner.get(id);
      const shell = { tex: r.pick(kind === 'machine' ? T.dark : T.concrete), lightmapscale: 64, scale: kind === 'pier' ? 0.5 : 0.25 };
      carve(m, [x0, y0, z0], [x1, y1, z1], cut?.hollows ?? [], shell);
      const doors = cut?.doors ?? [];
      if (kind === 'machine') skeleton(ctx, r, x0, y0, x1, y1, z0, z1, 512, D.steel, doors);
      wallRuns(ctx, r, x0, y0, x1, y1, z0, z1, (kind === 'machine' ? 0.5 : 0.25) * D.pipes, doors);
      if (cut) { fitOut(ctx, p, cut); m.fogVolume([x0, y0, bottom - 64], [x1, y1, z1], INSIDE_FOG); }
    }
  }

  // ---- catwalks (the parts of the maze out in the streets)
  for (const w of lay.walks) {
    const s = lay.segments[w.segment];
    const up = w.lb >= w.la;
    const seq = up ? s.tiles : [...s.tiles].reverse();
    const d = (up ? s.dir : (s.dir + 2) % 4) as Dir;
    const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
    const axisMask = (1 << s.dir) | (1 << ((s.dir + 2) % 4));
    const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
    seq.forEach(([x, y], i) => {
      const open = blockOf(x, y) < 0;
      if (i >= i0 && i < i0 + 4) {   // the stairs are here
        noteWalk(x, y, zOf(lo)); noteWalk(x, y, zOf(lo) + STEP); noteWalk(x, y, zOf(hi));
        if (open) noteDeck(x, y, zOf(lo) + 32 + 64 * (i - i0), false);
        return;
      }
      const c = centre(x, y, i < i0 ? lo : hi);
      noteWalk(x, y, c[2]);
      if (!open) return;
      walkTile(m, c, axisMask);
      noteDeck(x, y, c[2], true);
    });
    if (lo !== hi && blockOf(seq[i0][0], seq[i0][1]) < 0) {
      const [x, y] = seq[i0];
      const c = centre(x, y, lo);
      const foot: V3 = [c[0] - DX[d] * TILE / 2, c[1] - DY[d] * TILE / 2, c[2]];
      stairs(m, foot, d);
      stairs(m, [foot[0] + DX[d] * 2 * TILE, foot[1] + DY[d] * 2 * TILE, foot[2] + STEP], d);
    }
  }
  // Junction tiles. A few dead ends hold a small shelter; the rest just end.
  const er = root.fork('ends');
  const ends: { c: V3; open: Dir }[] = [];
  for (const [k, mask] of lay.nodes) {
    const [j, l] = k.split(':').map(Number);
    const J = lay.junctions[j];
    const c = centre(J.x, J.y, l);
    noteWalk(J.x, J.y, c[2]);
    if (blockOf(J.x, J.y) >= 0) continue;   // inside a mass: a room or a corner, cut with the rest
    const open = ([0, 1, 2, 3] as Dir[]).filter((dd) => mask & (1 << dd));
    if (open.length === 1) ends.push({ c, open: open[0] });
    else walkTile(m, c, mask);
  }
  const S = lay.junctions[lay.start.junction];
  const sc = centre(S.x, S.y, lay.start.level);
  // Shelters: far from the start and from each other.
  const sheltered: V3[] = [];
  for (const e of er.shuffle(ends)) {
    const farEnough = Math.hypot(e.c[0] - sc[0], e.c[1] - sc[1]) > size * 0.2 && sheltered.every((q) => Math.hypot(e.c[0] - q[0], e.c[1] - q[1]) > size * 0.25);
    if (sheltered.length < 4 && farEnough) { shelter(ctx, er, e.c, e.open); sheltered.push(e.c); } else walkTile(m, e.c, 1 << e.open);
  }

  // ---- streets: the frames that carry the catwalks and the tube lines; a few cables; bridges of machinery
  for (const s of lay.streets) street(ctx, root.fork(`street${s.id}`), s);

  // ---- tubes that leave one wall and arrive in another; what stands in the halls
  wanderingTubes(ctx, root.fork('tubes'));
  for (const b of lay.blocks) if (b.kind === 'hall') hall(ctx, root.fork(`hall${b.id}`), b);

  m.start([sc[0], sc[1], sc[2] + 2], 0, 0);
  return { map: m, layout: lay, notes: ctx.notes };
}

// ---------------------------------------------------------------- inside the masses

/** A box that runs from `from` to `to` along direction d (measured from c), from l0 to l1 across (left of d is positive), between two heights. */
function slab(c: V3, d: Dir, from: number, to: number, l0: number, l1: number, z0: number, z1: number): [V3, V3] {
  const lx = -DY[d], ly = DX[d];
  const xs = [c[0] + DX[d] * from + lx * l0, c[0] + DX[d] * to + lx * l1], ys = [c[1] + DY[d] * from + ly * l0, c[1] + DY[d] * to + ly * l1];
  return [[Math.min(...xs), Math.min(...ys), z0], [Math.max(...xs), Math.max(...ys), z1]];
}
/** The same, `w` wide about the line through c. */
const along = (c: V3, d: Dir, from: number, to: number, w: number, z0: number, z1: number) => slab(c, d, from, to, -w / 2, w / 2, z0, z1);

/**
 * Everything the maze needs cut into the masses, decided before any mass is
 * built: a corridor for each run of tiles a walk has inside a block, a stair
 * hall where the walk climbs, a corner or a room at each junction, a doorway
 * where a corridor comes out to a street.
 *
 * Each tunnel (one straight line of tiles through a block) has its own width
 * and height, the same on every level. Rooms differ in size, in height and
 * in which way they are long; a dead end one tile short of a face has a slit
 * to look out through.
 */
function interiors(ctx: Ctx, kindOf: (blk: number) => 'machine' | 'pier'): Map<number, Inner> {
  const { lay, zOf, root } = ctx;
  const N = lay.params.size;
  const blockOf = (x: number, y: number) => lay.tileBlock[y * N + x];
  const out = new Map<number, Inner>();
  const get = (blk: number): Inner => {
    let v = out.get(blk);
    if (!v) { v = { finish: root.fork(`finish${blk}`).pick(FINISH[kindOf(blk)]), hollows: [], doors: [], steps: [], ribs: [] }; out.set(blk, v); }
    return v;
  };
  const cut = (blk: number, box: [V3, V3]) => { const v = get(blk); v.hollows.push({ min: box[0], max: box[1], finish: v.finish }); ctx.hollows.push({ min: box[0], max: box[1] }); };
  interface Profile { w: number; h: number; ribs: number }
  const profiles = new Map<string, Profile>();
  /**
   * The section of the tunnel through block `blk` along `axis` at row or column
   * `fixed`: its width and height (from a crawl-low passage to a tall slot),
   * and how far apart its steel ribs stand (0 = none).
   */
  const profile = (blk: number, axis: number, fixed: number): Profile => {
    const k = `${blk}:${axis}:${fixed}`;
    let p = profiles.get(k);
    if (!p) {
      const r = root.fork(`tunnel${k}`);
      const [w, h] = r.weighted([[[96, 120], 2], [[96, 160], 2], [[104, 136], 3], [[112, 128], 3], [[128, 128], 2], [[128, 200], 2], [[96, 232], 1.5], [[160, 112], 1.5], [[144, 144], 1]] as const);
      p = { w, h, ribs: r.weighted([[0, 5], [256, 3], [384, 2]] as const) };
      profiles.set(k, p);
    }
    return p;
  };
  /** A doorway in a mass's face is never wider or taller than this, whatever the corridor behind it. */
  const DOOR_W = 128, DOOR_H = 168, NECK = 96;
  const dirs: Dir[] = [0, 1, 2, 3];

  // ---- corridors and stair halls, walk by walk
  for (const w of lay.walks) {
    const s = lay.segments[w.segment];
    if (!s.tunnel) continue;
    const up = w.lb >= w.la;
    const seq = up ? s.tiles : [...s.tiles].reverse();
    const d = (up ? s.dir : opposite(s.dir)) as Dir;
    const lo = Math.min(w.la, w.lb), hi = Math.max(w.la, w.lb);
    const i0 = lo === hi ? seq.length : Math.floor((seq.length - 4) / 2);
    const ends = [lay.junctions[up ? s.a : s.b], lay.junctions[up ? s.b : s.a]];
    const endLevel = [up ? w.la : w.lb, up ? w.lb : w.la];
    const where = (i: number) => (i < 0 ? blockOf(ends[0].x, ends[0].y) : i >= seq.length ? blockOf(ends[1].x, ends[1].y) : blockOf(seq[i][0], seq[i][1]));
    const onStairs = (i: number) => i >= i0 && i < i0 + 4;
    const levelAt = (i: number) => (i < i0 ? lo : hi);
    const fixed = d % 2 === 0 ? seq[0][1] : seq[0][0];
    for (let i = 0; i < seq.length;) {
      const blk = where(i);
      if (blk < 0 || onStairs(i)) { i++; continue; }
      let e = i;
      while (e + 1 < seq.length && where(e + 1) === blk && !onStairs(e + 1)) e++;
      const p = profile(blk, d % 2, fixed);
      const c: V3 = [seq[i][0] * TILE + TILE / 2, seq[i][1] * TILE + TILE / 2, 0];
      const z = zOf(levelAt(i));
      // Where the run comes out to a street: a doorway (a neck through the face, no bigger than a door), with the
      // catwalk beyond it resting on beams from the wall.
      const at = d % 2 === 0 ? c[1] : c[0];
      const dw = Math.min(p.w, DOOR_W), dh = Math.min(p.h, DOOR_H);
      let u0 = -TILE / 2, u1 = (e - i) * TILE + TILE / 2;
      if (where(i - 1) < 0) {
        cut(blk, along(c, d, u0, u0 + NECK, dw, z, z + dh));
        get(blk).doors.push({ side: opposite(d), at, z, w: dw, h: dh, stub: i, balcony: lay.nodes.get(`${ends[0].id}:${endLevel[0]}`) === (1 << d) });
        u0 += NECK;
      }
      if (where(e + 1) < 0) {
        cut(blk, along(c, d, u1 - NECK, u1, dw, z, z + dh));
        get(blk).doors.push({ side: d, at, z, w: dw, h: dh, stub: seq.length - 1 - e, balcony: lay.nodes.get(`${ends[1].id}:${endLevel[1]}`) === (1 << opposite(d)) });
        u1 -= NECK;
      }
      cut(blk, along(c, d, u0, u1, p.w, z, z + p.h));
      // Steel ribs along it: two posts and a head, standing a little proud of the walls.
      if (p.ribs) for (let u = u0 + p.ribs / 2; u < u1 - 32; u += p.ribs) {
        get(blk).ribs.push(slab(c, d, u - 3, u + 3, -p.w / 2, -p.w / 2 + 4, z, z + p.h), slab(c, d, u - 3, u + 3, p.w / 2 - 4, p.w / 2, z, z + p.h), slab(c, d, u - 3, u + 3, -p.w / 2 + 4, p.w / 2 - 4, z + p.h - 5, z + p.h));
      }
      i = e + 1;
    }
    if (lo !== hi && where(i0) >= 0) {
      // A stair hall: the floor climbs in steps, the ceiling stays level, so the low end is very tall.
      const blk = where(i0);
      const p = profile(blk, d % 2, fixed);
      const c: V3 = [seq[i0][0] * TILE + TILE / 2, seq[i0][1] * TILE + TILE / 2, 0];
      const z = zOf(lo);
      cut(blk, along(c, d, -TILE / 2, 3 * TILE + TILE / 2, p.w, z, zOf(hi) + p.h));
      ctx.notes.push({ kind: 'stairhall', at: [c[0] - DX[d] * 100, c[1] - DY[d] * 100, z], yaw: d * 90 });
      const RUN = 32, RISE = 16;   // 16 steps: one level over four tiles
      for (let k = 0; k < LEVEL / RISE; k++) {
        const b = along(c, d, -TILE / 2 + k * RUN, -TILE / 2 + (k + 1) * RUN, p.w, z, z + (k + 1) * RISE);
        get(blk).steps.push({ min: b[0], max: b[1], riser: opposite(d) });
      }
    }
  }

  // ---- junctions inside a mass: a plain corner, or a room
  for (const [k, mask] of lay.nodes) {
    const [j, l] = k.split(':').map(Number);
    const J = lay.junctions[j];
    const blk = blockOf(J.x, J.y);
    if (blk < 0) continue;
    const z = zOf(l), c: V3 = [J.x * TILE + TILE / 2, J.y * TILE + TILE / 2, z];
    const open = dirs.filter((dd) => mask & (1 << dd));
    const profs = open.map((dd) => profile(blk, dd % 2, dd % 2 === 0 ? J.y : J.x));
    open.forEach((dd, n) => cut(blk, along(c, dd, 0, TILE / 2, profs[n].w, z, z + profs[n].h)));
    const W = Math.max(...profs.map((p) => p.w)), H = Math.max(...profs.map((p) => p.h));
    const r = root.fork(`node${k}`);
    const straight = open.length === 2 && opposite(open[0]) === open[1];
    const roomy = open.length === 1 ? 1 : open.length >= 3 ? 0.75 : straight ? 0.25 : 0.45;
    if (!r.chance(roomy)) { cut(blk, [[c[0] - W / 2, c[1] - W / 2, z], [c[0] + W / 2, c[1] + W / 2, z + H]]); continue; }

    // A room: how far it reaches each way from the junction's middle. Never more than 160, so it keeps a wall to whatever passes two tiles away.
    const R = lay.blocks[blk].rect;
    const face = [R.x1 * TILE - MARGIN, R.y1 * TILE - MARGIN, R.x0 * TILE + MARGIN, R.y0 * TILE + MARGIN];   // the mass's face on each side
    const shape = r.weighted([['square', 3], ['long', 2], ['wide', 2], ['odd', 2]] as const);
    const big = r.pick([120, 136, 152]), small = r.pick([72, 88, 104]);
    const ext = dirs.map((v) => {
      const alongEntry = open.some((o) => o % 2 === v % 2);
      if (shape === 'square') return big;
      if (shape === 'long') return alongEntry ? 152 : small;
      if (shape === 'wide') return alongEntry ? small : 152;
      return r.pick([72, 104, 136, 152]);
    });
    let slit: Dir | null = null;
    for (const v of dirs) {
      const dist = v < 2 ? face[v] - c[v % 2] : c[v % 2] - face[v];
      // One tile from a face that looks onto a street: a thin wall with a slit to look out through.
      const bx = J.x + 2 * DX[v], by = J.y + 2 * DY[v];
      const street = bx >= 0 && by >= 0 && bx < N && by < N && blockOf(bx, by) < 0;
      if (open.length === 1 && dist <= 136 && street && slit === null && !open.includes(v)) { ext[v] = dist - 16; slit = v; }
      else ext[v] = Math.max(W / 2, Math.min(ext[v], dist - 48));
    }
    for (const v of open) ext[v] = Math.max(ext[v], profs[open.indexOf(v)].w / 2);
    // Height: most rooms a little taller than their corridors; with nothing on the level above, some go up through it.
    let hgt = Math.min(244, Math.max(H + 16, r.pick([160, 176, 200, 224, 240])));
    if (!lay.nodes.has(`${j}:${l + 1}`) && r.chance(0.3)) hgt = r.pick([336, 400, 464]);
    const lo: V3 = [c[0] - ext[2], c[1] - ext[3], z], hi: V3 = [c[0] + ext[0], c[1] + ext[1], z + hgt];
    cut(blk, [lo, hi]);
    const entry = open[0];
    ctx.notes.push({ kind: slit !== null ? 'lookout' : hgt > 300 ? 'tallroom' : open.length === 1 ? 'endroom' : 'room', at: [c[0] + DX[entry] * 30, c[1] + DY[entry] * 30, z], yaw: opposite(entry) * 90 });
    if (slit !== null) {
      const sw = Math.min(192, 2 * Math.min(ext[(slit + 1) % 4], ext[(slit + 3) % 4]) - 32);
      cut(blk, along(c, slit, ext[slit] - 1, ext[slit] + 17, sw, z + 46, z + 78));
      get(blk).doors.push({ side: slit, at: slit % 2 === 0 ? c[1] : c[0], z: z + 46, w: sw, h: 32, slit: true, stub: 0, balcony: false });
    }
  }
  return out;
}

/**
 * What is added to a cut mass after the cutting: the steps of its stair
 * halls, the ribs of its corridors, a porch at each doorway, and the beams
 * and rods that carry the catwalk from the porch to the street's lane.
 */
function fitOut(ctx: Ctx, p: { x0: number; y0: number; x1: number; y1: number; D: District }, cut: Inner): void {
  const { m, steel } = ctx;
  const side = ['x+', 'y+', 'x-', 'y-'] as const;
  for (const s of cut.steps) {
    m.box(s.min, s.max, { tex: { 'z+': cut.finish.floor, [side[s.riser]]: cut.finish.floor }, scale: cut.finish.scale, lightmapscale: cut.finish.lightmapscale });
  }
  for (const [lo, hi] of cut.ribs) steel(lo, hi, p.D.steel);
  const face = [p.x1, p.y1, p.x0, p.y0];
  for (const d of cut.doors) {
    if (d.slit) continue;
    const f = face[d.side], sgn = d.side < 2 ? 1 : -1, alongX = d.side % 2 === 0;
    // u runs out from the face, v along it.
    const box = (u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, tex: string, group?: string) => {
      const a0 = f + sgn * u0, a1 = f + sgn * u1;
      const lo: V3 = alongX ? [Math.min(a0, a1), v0, z0] : [v0, Math.min(a0, a1), z0], hi: V3 = alongX ? [Math.max(a0, a1), v1, z1] : [v1, Math.max(a0, a1), z1];
      return m.box(lo, hi, { tex, group, lightmapscale: 32, scale: 0.25 });
    };
    const { at, z, w, h } = d;
    // The porch: a steel box through the margin, from the face to the block's edge.
    box(0, MARGIN, at - w / 2 - 8, at + w / 2 + 8, z - 12, z, p.D.steel);
    box(0, MARGIN, at - w / 2 - 8, at - w / 2, z, z + h, p.D.steel);
    box(0, MARGIN, at + w / 2, at + w / 2 + 8, z, z + h, p.D.steel);
    box(0, MARGIN, at - w / 2 - 8, at + w / 2 + 8, z + h, z + h + 8, p.D.steel);
    // The catwalk from the porch to the lane rests on two beams out of the wall, one each side of the porch, with
    // bars across under the deck; a rod from the wall above the doorway holds the far end of each beam.
    const len = MARGIN + d.stub * TILE + (d.balcony ? 100 : 0);
    if (d.stub === 0 && !d.balcony) continue;
    const off = w / 2 + 14;
    for (const o of [-off, off]) {
      box(-24, len, at + o - 4, at + o + 4, z - 28, z - 14, p.D.steel, 'func_detail');
      const a: V3 = alongX ? [f - sgn * 8, at + o, z + 214] : [at + o, f - sgn * 8, z + 214];
      const b: V3 = alongX ? [f + sgn * (len - 12), at + o, z - 20] : [at + o, f + sgn * (len - 12), z - 20];
      m.bar(a, b, 3, 3, T.steel, { group: 'func_detail', lightmapscale: 64, scale: 0.25 });
    }
    for (let u = MARGIN + TILE / 2; u < len; u += TILE) box(u - 4, u + 4, at - off - 4, at + off + 4, z - 14, z - 4, p.D.steel, 'func_detail');
    box(len - 8, len, at - off - 4, at + off + 4, z - 14, z - 4, p.D.steel, 'func_detail');
  }
}

/** Can a column (16 across) stand at p, from far below up to zTop, without passing through a doorway or a room? */
function columnClear(ctx: Ctx, p: V3, zTop: number): boolean {
  return !ctx.hollows.some((h) => p[0] > h.min[0] - 14 && p[0] < h.max[0] + 14 && p[1] > h.min[1] - 14 && p[1] < h.max[1] + 14 && h.min[2] < zTop + 8);
}

/** Is p (with `radius` to spare) in anything cut into a mass, or in a doorway's porch? */
function inHollow(ctx: Ctx, p: V3, radius: number): boolean {
  for (const h of ctx.hollows) {
    if (p[0] > h.min[0] - radius && p[0] < h.max[0] + radius && p[1] > h.min[1] - radius && p[1] < h.max[1] + radius && p[2] > h.min[2] - radius && p[2] < h.max[2] + radius) return true;
  }
  return false;
}

// ---------------------------------------------------------------- masses

/** Doors on one face of a mass, as [middle along the face, half-width] pairs. */
const doorsOn = (doors: Door[], side: Dir) => doors.filter((d) => d.side === side);

/**
 * Columns and ring beams standing off a box's four sides (inside the mass's
 * own margin). The columns always go down out of sight: a mass that begins
 * part-way up stands on them. No column stands in front of a doorway.
 */
function skeleton(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, bay: number, tex: string, doors: Door[] = []): void {
  const { steel } = ctx;
  const C = 24, OUT = 28;   // column size, how far its centre stands off the face
  const cols = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  const clear = (side: Dir, a: number) => doorsOn(doors, side).every((d) => Math.abs(d.at - a) > d.w / 2 + 30);
  for (const x of cols(x0, x1)) for (const [y, side] of [[y0 - OUT, 3], [y1 + OUT, 1]] as [number, Dir][]) if (clear(side, x)) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  for (const y of cols(y0, y1).slice(1, -1)) for (const [x, side] of [[x0 - OUT, 2], [x1 + OUT, 0]] as [number, Dir][]) if (clear(side, y)) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  // Ring beams up the height (closer together near the catwalks, where they are seen; under a raised mass they tie its legs).
  // Their heights (208 above a multiple of 512) fall between the doorways of any level.
  const step = bay * r.pick([1, 1, 2]);
  for (let z = Math.ceil((ctx.bottom - 2600) / step) * step + 208; z < z1; z += step) {
    steel([x0 - OUT - 8, y0 - OUT - 8, z - 12], [x1 + OUT + 8, y0 - OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y1 + OUT - 8, z - 12], [x1 + OUT + 8, y1 + OUT + 8, z + 12], tex);
    steel([x0 - OUT - 8, y0 - OUT + 8, z - 12], [x0 - OUT + 8, y1 + OUT - 8, z + 12], tex);
    steel([x1 + OUT - 8, y0 - OUT + 8, z - 12], [x1 + OUT + 8, y1 + OUT - 8, z + 12], tex);
  }
  void z0;
}

/**
 * A stack of test chambers seen from outside: boxes clad in the backs of
 * their wall panels, one above the other with gaps, held in a steel frame.
 */
function chamberStack(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, steelTex: string): void {
  const { m } = ctx;
  const tex = r.pick(T.panels);
  let z = z0;
  while (z < z1 - 256) {
    const h = Math.min(z1 - z, r.pick([768, 1024, 1024, 1536, 2048]));
    // Each chamber is a little smaller than the frame, and not always the same size.
    const ix = r.pick([0, 0, 64, 128]), iy = r.pick([0, 0, 64, 128]);
    m.box([x0 + ix, y0 + iy, z], [x1 - ix, y1 - iy, z + h], { tex, lightmapscale: 64, scale: 0.25 });
    z += h;
    const gap = r.pick([128, 192, 256, 256, 512]);
    if (z < z1 - 256) m.box([x0 + 192, y0 + 192, z], [x1 - 192, y1 - 192, z + gap], { tex: T.black, lightmapscale: 128, scale: 0.5 });   // the core the chambers hang on
    z += gap;
  }
  skeleton(ctx, r, x0, y0, x1, y1, z0, z1, 512, steelTex);
}

/** An open steel tower: columns, floors of beams, a few boxes held inside. You see through it. It stands out of sight below. */
function frameTower(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z1: number, tex: string): void {
  const { m, steel } = ctx;
  const bay = 512, C = 32;
  const grid = (a0: number, a1: number) => { const n = Math.max(1, Math.round((a1 - a0) / bay)); return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n); };
  const xs = grid(x0, x1), ys = grid(y0, y1);
  for (const x of xs) for (const y of ys) steel([x - C / 2, y - C / 2, ctx.deep], [x + C / 2, y + C / 2, z1], tex);
  // Floors of beams every 512 where they are seen, every 2048 far below.
  const near = ctx.bottom - 3072;
  for (let z = Math.ceil(ctx.deep / 2048) * 2048; z < z1; z += z < near ? 2048 : 512) {
    for (const y of ys) steel([x0, y - 10, z - 20], [x1, y + 10, z], tex);
    for (const x of xs) steel([x - 10, y0, z - 20], [x + 10, y1, z], tex);
    if (z < near) continue;
    // Here and there a floor holds a closed box (a plant room, a store), standing on the beams.
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (!r.chance(0.16)) continue;
      const h = r.pick([256, 384, 448]);
      m.box([xs[i] + 16, ys[j] + 16, z], [xs[i + 1] - 16, ys[j + 1] - 16, z + h], { tex: r.pick([...T.dark, ...T.panels]), lightmapscale: 64 });
    }
  }
}

/** Ducts and pipes fixed to a mass's walls. Pipes run from out of sight below to a collar near the top. None crosses a doorway. */
function wallRuns(ctx: Ctx, r: Rng, x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, density: number, doors: Door[] = []): void {
  const { m } = ctx;
  const sides: { o: V3; along: Dir; out: Dir; len: number }[] = [
    { o: [x0, y0, 0], along: 0, out: 3, len: x1 - x0 }, { o: [x1, y0, 0], along: 1, out: 0, len: y1 - y0 },
    { o: [x1, y1, 0], along: 2, out: 1, len: x1 - x0 }, { o: [x0, y1, 0], along: 3, out: 2, len: y1 - y0 }];
  for (const { o, along: al, out, len } of sides) {
    const here = doorsOn(doors, out);
    // Vertical pipes (pipe_64_256: 67 across, 256 tall, centred on its origin), touching the wall.
    for (let a = 256; a < len - 256; a += 256) {
      if (!r.chance(0.1 * density)) continue;
      const px = o[0] + DX[al] * a + DX[out] * 34, py = o[1] + DY[al] * a + DY[out] * 34;
      if (here.some((d) => Math.abs(d.at - (al % 2 === 0 ? px : py)) < d.w / 2 + 52)) continue;
      let zt = z0;
      for (let z = Math.ceil(z0 / 256) * 256 + 128; z < z1 - 128; z += 256) { m.prop('props_bts/pipe_64_256', [px, py, z], [0, 0, 0], { solid: false, hollow: true }); zt = z + 128; }
      if (zt > z0) m.prop('props_bts/pipe_64_rim', [px, py, zt], [0, 0, 0], { solid: false });
    }
    // Horizontal ducts (duct_512b: 512 long on its own x, 70 wide, 38 tall), flat against the wall, the full width of it.
    for (let z = Math.ceil((ctx.bottom - 2600) / 384) * 384; z < z1 - 100; z += 384) {
      if (z < z0 + 100 || !r.chance(0.1 * density)) continue;
      if (here.some((d) => z + 80 > d.z - 30 && z < d.z + d.h + 30)) continue;
      const n = Math.ceil(len / 512);
      for (let i = 0; i < n; i++) {
        const a = Math.min(len - 256, 256 + i * 512);   // the last piece overlaps the one before, so the run ends at the wall's corner
        m.prop('props_bts/duct_512b', [o[0] + DX[al] * a + DX[out] * 19, o[1] + DY[al] * a + DY[out] * 19, z + 40], [0, al * 90, 90], { solid: false, hollow: true });
      }
    }
  }
}

// ---------------------------------------------------------------- streets

const inMass = (ctx: Ctx, p: V3, kinds?: MassKind[]) => ctx.masses.some((b) => (!kinds || kinds.includes(b.kind)) && p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1 && p[2] > b.z0 && p[2] < b.z1);
/** Masses with real walls a tube or a strut can go into (a chamber's wall may sit up to 128 inside its frame, so ends go in deep). */
const SOLID: MassKind[] = ['machine', 'pier', 'bridge', 'chambers'];

/**
 * A street's own structure: pairs of columns at its two edges (they stand
 * out of sight below), a beam across over each catwalk and each flight of
 * stairs, with two rods down to it; ties from frame to frame. Tube lines rest
 * on brackets from the same columns and turn into the walls at both ends. A
 * few cables run beam to beam. Here and there a box of machinery bridges the
 * street from wall to wall.
 */
function street(ctx: Ctx, r: Rng, s: Street): void {
  const { m, lay, zOf, steel, L } = ctx;
  const N = lay.params.size;
  const across: Dir = s.axis === 0 ? 1 : 0;
  const a0 = s.axis === 0 ? s.rect.x0 : s.rect.y0, a1 = s.axis === 0 ? s.rect.x1 : s.rect.y1;
  const e0 = (s.axis === 0 ? s.rect.y0 : s.rect.x0), e1 = (s.axis === 0 ? s.rect.y1 : s.rect.x1);   // the street's two edges (tiles)
  const v0 = e0 * TILE - 12, v1 = e1 * TILE + 12;       // the column lines, just outside the street
  const laneC = s.lane * TILE + TILE / 2;
  const tile = (i: number): [number, number] => (s.axis === 0 ? [i, s.lane] : [s.lane, i]);
  const pt = (alongU: number, acrossU: number, z: number): V3 => (s.axis === 0 ? [alongU, acrossU, z] : [acrossU, alongU, z]);
  const box = (u0: number, u1: number, w0: number, w1: number, z0: number, z1: number, tex?: string) => {
    const p = pt(u0, w0, z0), q = pt(u1, w1, z1);
    return steel([Math.min(p[0], q[0]), Math.min(p[1], q[1]), z0], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z1], tex);
  };
  // Is there a block (a mass or a hall's edge), not another street's mouth, beside the street at tile i on this side?
  const blockBeside = (i: number, side: 0 | 1) => {
    const [x, y] = s.axis === 0 ? [i, side ? e1 : e0 - 1] : [side ? e1 : e0 - 1, i];
    return x >= 0 && y >= 0 && x < N && y < N && lay.tileBlock[y * N + x] >= 0;
  };
  const midP = pt(((a0 + a1) / 2) * TILE, laneC, 0);
  const D = ctx.districtAt(midP[0], midP[1]);

  // ---- a tube line beside the lane, between two catwalk levels; both ends turn into a solid wall
  const half = (s.width * TILE) / 2;
  let tube: { off: number; z: number; from: number; to: number; side: number } | null = null;
  if (s.width >= 3 && r.chance(Math.min(0.9, 0.4 * D.tubes))) {
    for (let attempt = 0; attempt < 6 && !tube; attempt++) {
      const side = r.pick([-1, 1]);
      const off = laneC + side * (half - 64);
      const z = zOf(r.int(0, L - 1)) + r.pick([128, 128, 144, -112]);
      // An end may turn into the wall at tile i if the wall is solid there and nothing is cut into it or walks in front of it.
      const wallAt = (i: number) => {
        const u = i * TILE + TILE / 2;
        if (!inMass(ctx, pt(u, laneC + side * (half + MARGIN + 60), z), SOLID)) return false;
        for (let v = 0; v <= 512; v += 64) { const p = pt(u, off + side * v, z); if (inHollow(ctx, p, 60) || hitsWalk(ctx, p, 54)) return false; }
        return true;
      };
      let from = a0, to = a1 - 1;
      while (from < to && !wallAt(from)) from++;
      while (to > from && !wallAt(to)) to--;
      if (to - from < 4) continue;
      // Nothing may cross its line: a catwalk from a doorway out to the lane would.
      let free = true;
      for (let i = from; i <= to && free; i++) free = !hitsWalk(ctx, pt(i * TILE + TILE / 2, off, z), 52);
      if (!free) continue;
      tube = { off, z, from, to, side };
      const uA = from * TILE + TILE / 2, uB = to * TILE + TILE / 2, into = off + side * 512;
      tubePath(m, [pt(uA, into, z), pt(uA, off, z), pt(uB, off, z), pt(uB, into, z)]);
    }
  }

  // ---- frames
  const bay = r.pick([3, 4, 4, 6]);
  const last = new Map<number, number>();   // per deck height: where the last frame that carried it stands
  let next = a0;
  for (let i = a0; i < a1; i++) {
    if (i < next || !blockBeside(i, 0) || !blockBeside(i, 1)) continue;
    const decks = ctx.decks.get(tile(i).join(',')) ?? [];
    const carriesTube = tube !== null && i > tube.from && i < tube.to;
    if (!decks.length && !carriesTube) { last.clear(); continue; }
    const u = i * TILE + TILE / 2;
    const zTop = Math.max(...decks.map((k) => k.z + 236), carriesTube ? tube!.z + 40 : -1e9);
    // Its columns must not stand in a doorway (one tile on, they will not).
    if (![v0, v1].every((v) => columnClear(ctx, pt(u, v, 0), zTop))) continue;
    next = i + bay;
    for (const v of [v0, v1]) { const p = pt(u, v, 0); steel([p[0] - 8, p[1] - 8, ctx.deep], [p[0] + 8, p[1] + 8, zTop + 8], D.steel); }
    const seen = new Set<number>();
    for (const { z, flat } of decks) {
      // The beam across, the two rods down, the bar under the deck (under a stair, lower: below its stringers).
      box(u - 8, u + 8, v0, v1, z + 216, z + 236, D.steel);
      const under = flat ? 0 : -30;
      for (const side of [-1, 1]) { const p = pt(u, laneC + side * 47, z); steel([p[0] - 1.5, p[1] - 1.5, z - 10 + under], [p[0] + 1.5, p[1] + 1.5, z + 216]); }
      m.prop('props_bts/hanging_walkway_hanger_a', pt(u, laneC, z + under), [0, across * 90, 0], { solid: false });
      if (!flat) continue;
      seen.add(z);
      const prev = last.get(z);
      if (prev !== undefined && u - prev <= 8 * TILE) {
        // Ties along both column lines, and now and then a pair of cables slung beam to beam beside the walk.
        for (const v of [v0, v1]) box(prev + 8, u - 8, v - 5, v + 5, z + 220, z + 232, D.steel);
        if (r.chance(0.3 * D.cables)) {
          const off = laneC + r.pick([-1, 1]) * Math.min(half - 12, r.range(58, 90));
          const sag = r.range(6, 22);
          m.rope(pt(prev, off, z + 217), pt(u, off, z + 217), sag, 3);
          if (r.chance(0.5)) m.rope(pt(prev, off + 6, z + 217), pt(u, off + 6, z + 217), sag + r.range(2, 6), 2);
        }
      }
      last.set(z, u);
    }
    for (const z of [...last.keys()]) if (!seen.has(z)) last.delete(z);
    if (carriesTube) {
      // A bracket from the nearer column, under the tube (the tube is 104 across), with a ring round the tube above it.
      const v = tube!.side > 0 ? v1 : v0;
      box(u - 6, u + 6, Math.min(v, tube!.off - tube!.side * 56), Math.max(v, tube!.off - tube!.side * 56), tube!.z - 66, tube!.z - 54, D.steel);
      m.prop('props_bts/vactube_connector', pt(u, tube!.off, tube!.z), [0, (s.axis === 0 ? 0 : 1) * 90 - 90, 0], { solid: false });
    }
  }

  // ---- a box of machinery from wall to wall, above every catwalk under it: the street closes over for a stretch
  const len = (a1 - a0) * TILE;
  if (len >= 8 * TILE && r.chance(0.3)) {
    const n = r.int(2, 6), i = r.int(a0 + 1, a1 - n - 1);
    let z = -1e9;
    for (let t = i; t < i + n; t++) for (let e = e0; e < e1; e++) {
      const [x, y] = s.axis === 0 ? [t, e] : [e, t];
      for (const wz of ctx.walkZ.get(`${x},${y}`) ?? []) z = Math.max(z, wz + 248);
    }
    if (z < -1e8) z = zOf(r.int(0, L - 1)) + 248;
    const h = r.pick([256, 384, 512, 1024, 2048]);
    const w0 = e0 * TILE - MARGIN, w1 = e1 * TILE + MARGIN;   // the two masses' faces
    // It needs a wall to sit in at both ends, along its whole length, at this height; and no doorway or slit behind it.
    let held = true;
    for (let t = i; t < i + n && held; t++) {
      for (const zz of [z + 8, z + h - 8]) held &&= inMass(ctx, pt(t * TILE + 64, w0 - 40, zz)) && inMass(ctx, pt(t * TILE + 64, w1 + 40, zz));
      for (let zz = z + 8; zz < z + h && held; zz += 64) held &&= !inHollow(ctx, pt(t * TILE + 64, w0 + 16, zz), 70) && !inHollow(ctx, pt(t * TILE + 64, w1 - 16, zz), 70);
    }
    if (held) {
      const p = pt(i * TILE, w0, z), q = pt((i + n) * TILE, w1, z + h);
      const lo: V3 = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), z], hi: V3 = [Math.max(p[0], q[0]), Math.max(p[1], q[1]), z + h];
      m.box(lo, hi, { tex: r.pick([...T.dark, ...T.panels]), lightmapscale: 64 });
      ctx.masses.push({ x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1], z0: z, z1: z + h, kind: 'bridge' });
    }
  }
}

// ---------------------------------------------------------------- tubes

/** Would something `radius` thick, centred on p, cut through a catwalk or a corridor, or the space a walker needs in it? */
function hitsWalk(ctx: Ctx, p: V3, radius: number): boolean {
  const tx = Math.floor(p[0] / TILE), ty = Math.floor(p[1] / TILE);
  const reach = Math.ceil(radius / TILE);
  for (let x = tx - reach; x <= tx + reach; x++) for (let y = ty - reach; y <= ty + reach; y++) {
    const zs = ctx.walkZ.get(`${x},${y}`);
    if (!zs) continue;
    // Further from this tile sideways than the thing's size: no problem.
    const cx = Math.max(x * TILE - 8, Math.min(p[0], (x + 1) * TILE + 8)), cy = Math.max(y * TILE - 8, Math.min(p[1], (y + 1) * TILE + 8));
    if (Math.hypot(p[0] - cx, p[1] - cy) > radius) continue;
    for (const z of zs) if (p[2] > z - 18 - radius && p[2] < z + 248 + radius) return true;   // up to the beam over the walk
  }
  return false;
}

/** The nearest solid wall beside p (straight along x or y, at p's height): how far, and which way. */
function nearestWall(ctx: Ctx, p: V3): { dist: number; dir: [number, number] } | null {
  let best: { dist: number; dir: [number, number] } | null = null;
  const take = (dist: number, dir: [number, number]) => { if (dist >= 0 && (!best || dist < best.dist)) best = { dist, dir }; };
  for (const b of ctx.masses) {
    if (!SOLID.includes(b.kind) || p[2] < b.z0 + 8 || p[2] > b.z1 - 8) continue;
    if (p[1] > b.y0 + 8 && p[1] < b.y1 - 8) { take(b.x0 - p[0], [1, 0]); take(p[0] - b.x1, [-1, 0]); }
    if (p[0] > b.x0 + 8 && p[0] < b.x1 - 8) { take(b.y0 - p[1], [0, 1]); take(p[1] - b.y1, [0, -1]); }
  }
  return best;
}

/**
 * Transport tubes that leave a solid wall, turn a few times (up, down, along,
 * across) and enter another solid wall. One that finds no wall to end in, or
 * runs too far from any wall to be held, is not built. Each is held by struts
 * to the nearest wall along its way. None passes through a corridor or a
 * room, in the open or inside a wall.
 */
function wanderingTubes(ctx: Ctx, r: Rng): void {
  const { m, steel } = ctx;
  const AX: V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const snap = (v: number) => Math.round(v / 128) * 128;
  const REACH = 460;   // the longest strut
  const blocked = (q: V3) => hitsWalk(ctx, q, 70) || inHollow(ctx, q, 64);
  /** Is the straight run from p for `len` along d free of walks and of anything cut into the masses? */
  const freeRun = (p: V3, d: V3, len: number) => { for (let u = 0; u <= len; u += 64) if (blocked([p[0] + d[0] * u, p[1] + d[1] * u, p[2] + d[2] * u])) return false; return true; };
  for (const b of [...ctx.masses]) {
    if (b.kind !== 'machine' && b.kind !== 'pier' && b.kind !== 'chambers') continue;
    const D = ctx.districtAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    const n = Math.round(r.range(1, 5) * D.tubes);
    let built = 0;
    for (let t = 0; t < n * 8 && built < n; t++) {
      const side = r.int(0, 3);
      let d: V3 = AX[side];
      const z = snap(r.range(Math.max(b.z0 + 200, ctx.bottom - 700), Math.min(b.z1 - 200, ctx.top + 900)));
      const p0: V3 = side < 2 ? [snap(side === 0 ? b.x1 : b.x0), snap(r.range(b.y0 + 128, b.y1 - 128)), z] : [snap(r.range(b.x0 + 128, b.x1 - 128)), snap(side === 2 ? b.y1 : b.y0), z];
      const pts: V3[] = [[p0[0] - d[0] * 384, p0[1] - d[1] * 384, p0[2] - d[2] * 384]];   // begins well inside the wall
      if (!freeRun(pts[0], d, 384)) continue;
      let cur = p0, arrived = false;
      for (let leg = 0; leg < r.int(2, 6) && !arrived; leg++) {
        const want = 128 * r.int(2, leg === 0 ? 4 : 16);
        let run = 0;
        for (let u = 64; u <= want; u += 64) {
          const q: V3 = [cur[0] + d[0] * u, cur[1] + d[1] * u, cur[2] + d[2] * u];
          if (blocked(q) || q[0] < 0 || q[1] < 0 || q[0] > ctx.size || q[1] > ctx.size) break;
          if (u % 128 === 0) run = u;
          if (leg > 0 && u % 128 === 0 && inMass(ctx, q, SOLID)) {
            if (!freeRun(q, d, 384)) break;   // something is cut into the wall behind here: no way in
            arrived = true; run = u + 384; break;
          }
        }
        if (run < 256) break;
        cur = [cur[0] + d[0] * run, cur[1] + d[1] * run, cur[2] + d[2] * run];
        pts.push(cur);
        const turns = AX.filter((a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2] === 0);
        const upDown = turns.filter((a) => a[2] !== 0);
        d = r.chance(0.3) && upDown.length ? r.pick(upDown) : r.pick(turns);
      }
      if (!arrived || pts.length < 3) continue;
      // Struts: every 512 along each leg that is out in the open. No wall within reach on a long leg: not built.
      const struts: { p: V3; w: { dist: number; dir: [number, number] } }[] = [];
      let held = true;
      for (let i = 0; i < pts.length - 1 && held; i++) {
        const a = pts[i], e = pts[i + 1], len = Math.hypot(e[0] - a[0], e[1] - a[1], e[2] - a[2]);
        const dir: V3 = [(e[0] - a[0]) / len, (e[1] - a[1]) / len, (e[2] - a[2]) / len];
        for (let u = 256; u < len - 128; u += 512) {
          const p: V3 = [a[0] + dir[0] * u, a[1] + dir[1] * u, a[2] + dir[2] * u];
          if (inMass(ctx, p)) continue;
          const w = nearestWall(ctx, p);
          // A strut must run square to the tube, not along it, and must not end in a doorway or a room.
          const sound = w && w.dist <= REACH && Math.abs(w.dir[0] * dir[0] + w.dir[1] * dir[1]) < 0.5
            && [w.dist - 40, w.dist + 20, w.dist + 80, w.dist + 136].every((v) => !inHollow(ctx, [p[0] + w.dir[0] * v, p[1] + w.dir[1] * v, p[2]], 16));
          if (sound) struts.push({ p, w: w! });
          else if (len > 1024) held = false;
        }
      }
      if (!held) continue;
      built++;
      tubePath(m, pts);
      for (const { p, w } of struts) {
        const q: V3 = [p[0] + w.dir[0] * (w.dist + 136), p[1] + w.dir[1] * (w.dist + 136), p[2]];
        const s0: V3 = [p[0] + w.dir[0] * 50, p[1] + w.dir[1] * 50, p[2]];
        steel([Math.min(s0[0], q[0]) - 5, Math.min(s0[1], q[1]) - 5, p[2] - 6], [Math.max(s0[0], q[0]) + 5, Math.max(s0[1], q[1]) + 5, p[2] + 6]);
      }
    }
  }
}

// ---------------------------------------------------------------- halls

/**
 * An open hall: sometimes left empty (the open space is the point), sometimes
 * with one free-standing steel tower in the middle, built like the others and
 * standing out of sight below.
 */
function hall(ctx: Ctx, r: Rng, b: Block): void {
  if (r.chance(0.45)) return;
  const x0 = b.rect.x0 * TILE, y0 = b.rect.y0 * TILE, x1 = b.rect.x1 * TILE, y1 = b.rect.y1 * TILE;
  const w = x1 - x0, d = y1 - y0;
  // The tower takes the middle; a wide ring of open air stays round it.
  const fx = Math.max(512, Math.round((w * r.range(0.35, 0.6)) / 512) * 512), fy = Math.max(512, Math.round((d * r.range(0.35, 0.6)) / 512) * 512);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const D = ctx.districtAt(cx, cy);
  frameTower(ctx, r, cx - fx / 2, cy - fy / 2, cx + fx / 2, cy + fy / 2, ctx.top + r.range(600, 3000), D.steel);
  ctx.masses.push({ x0: cx - fx / 2, y0: cy - fy / 2, x1: cx + fx / 2, y1: cy + fy / 2, z0: ctx.deep, z1: ctx.top + 600, kind: 'frame' });
}

// ---------------------------------------------------------------- shelters

/**
 * At a dead end, a wider landing with a small lean-to in its corner: three
 * wall panels someone carried here. Easy to walk past.
 */
function shelter(ctx: Ctx, r: Rng, c: V3, open: Dir): void {
  const { m } = ctx;
  const away = ((open + 2) % 4) as Dir;
  const yaw = away * 90 - 90;   // the landing's own +y points away from the way in
  // hanging_walkway_end_b: a 110 × 110 landing (x −70..40, y −40..70) entered from its −y side.
  m.prop('props_bts/hanging_walkway_end_b', c, [0, yaw, 0]);
  const a = (yaw * Math.PI) / 180;
  const at = (x: number, y: number, z: number): V3 => [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), c[2] + z];
  const panel = 'props_factory/factory_panel_metal_dirty_128x128';   // 130 × 130 × 7 lying flat; used at just over half size
  const sc = 0.56;
  // In the far corner: one panel upright along the back rail, one along the side rail, one laid over them.
  m.prop(panel, at(-34, 64, 36), [90, yaw + 90, 0], { scale: sc, solid: false });
  m.prop(panel, at(-66, 30, 36), [90, yaw, 0], { scale: sc, solid: false });
  m.prop(panel, at(-33, 31, 74), [r.range(-4, 2), yaw + r.range(-3, 3), 0], { scale: sc, solid: false });
}

/**
 * The air inside a mass: thin and dark, the same at every height. (The game
 * goes over to it when the camera is inside the mass's box, which it can only
 * be in a corridor or a room.)
 */
const INSIDE_FOG = {
  near: 150, d1: 1500, a1: 0.05, c1: '#3d4043', d2: 4500, a2: 0.3, c2: '#45484b', d3: 12000, a3: 0.9, c3: '#4c4f52',
  lowThicken: 0, lowTint: 0, highThicken: 0, highTint: 0, blur: 2,
};

/**
 * Flat light, no bake: for judging geometry. The fog is in three layers
 * (thin and dark near, thick and pale far), goes dark in the depths under the
 * lowest catwalks and pale in the heights, and far things are a little soft.
 * It hides what runs out of sight.
 */
export const GEOMETRY_SETTINGS = {
  camera: { model: 'source', sourceHdr: false },
  light: { enabled: false },
  render: { internalHeight: 0, textureFilter: 'linear', faceShade: 0.75 },
  surface: { reflections: 0 },
  fog: {
    enabled: true, source: true, color: '#8f979f', near: 300, far: 9000, maxDensity: 1,
    layers: true, d1: 1600, a1: 0.18, c1: '#7c858d', d2: 4200, a2: 0.62, c2: '#8d959c', d3: 8500, a3: 1, c3: '#a2a9ae',
    lowOn: true, lowTop: -600, lowDepth: 3600, lowThicken: 0.8, lowTint: 0.9, lowColor: '#3b4249',
    highOn: true, highBase: 900, highRise: 3000, highThicken: 0.5, highTint: 0.7, highColor: '#c3c8cb',
    blur: 4, blurStart: 1200, blurEnd: 6500,
  },
  // The Portal 2 kit is made for Source's player: 32 wide, 72 tall, eyes at 64.
  hull: { hullWidth: 32, standHeight: 72, duckHeight: 36, eyeHeight: 64, duckEyeHeight: 28, voidZ: -2600 },
};
