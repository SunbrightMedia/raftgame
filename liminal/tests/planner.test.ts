import { describe, expect, it } from 'vitest';
import { FEATURES, ZONE_FEATURES } from '../src/planner/catalogue';
import { DEFAULT_PARAMS, emptyEdits, generate } from '../src/planner/generate';
import { buildZone } from '../src/planner/recipes';
import { check } from '../src/planner/faults';
import { Rng } from '../src/world/rng';
import type { Zone } from '../src/planner/types';

describe('Backrooms planner', () => {
  it('has the 71 features, numbered 1–71, ids unique', () => {
    expect(FEATURES.length).toBe(71);
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(71);
    expect(FEATURES.map((f) => f.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 71 }, (_, i) => i + 1));
  });

  it('builds every zone feature, with a port on each side', () => {
    for (const f of ZONE_FEATURES) {
      const w = f.w?.[1] ?? 10, h = f.h?.[1] ?? 10;
      const z: Zone = {
        id: 0, key: 't', feature: f.id, frame: { x: 0, y: 0, a: 0 }, w, h, seed: 1, theme: 'base', level: 0, tags: [], parent: -1, depth: 0, edges: [],
        ports: [0, 1, 2, 3].map((s) => ({ p: s === 0 ? { x: w / 2, y: 0 } : s === 1 ? { x: 0, y: h / 2 } : s === 2 ? { x: -w / 2, y: 0 } : { x: 0, y: -h / 2 }, a: (s * Math.PI) / 2, w: 2, link: s })),
      };
      const prims = buildZone(z, new Rng(7));
      if (f.id === 'mass') expect(prims.some((p) => p.t === 'solid')).toBe(true);
      else expect(prims.some((p) => p.t === 'floor'), f.id).toBe(true);
    }
  });

  it('is the same map for the same seed', () => {
    const a = generate({ ...DEFAULT_PARAMS, seed: 42 });
    const b = generate({ ...DEFAULT_PARAMS, seed: 42 });
    expect(a.zones.length).toBe(b.zones.length);
    expect(a.prims.length).toBe(b.prims.length);
    expect(a.zones.map((z) => [z.key, z.feature, z.frame.x.toFixed(4), z.frame.y.toFixed(4)])).toEqual(b.zones.map((z) => [z.key, z.feature, z.frame.x.toFixed(4), z.frame.y.toFixed(4)]));
  });

  it('places nearly everything, and every zone can be walked to', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const turn of [0, 0.85]) {
        const m = generate({ ...DEFAULT_PARAMS, seed, turn });
        expect(m.stats.dropped, `seed ${seed} turn ${turn}`).toBeLessThanOrEqual(6);
        expect(m.stats.cutOff, `seed ${seed} turn ${turn}`).toEqual([]);
        expect(m.stats.reached).toBeGreaterThan(0.95);
        // map 1 measured 0.66 floor in its mapped area
        expect(m.stats.floorShare).toBeGreaterThan(0.5);
        expect(m.stats.floorShare).toBeLessThan(0.85);
      }
    }
  });

  it('keeps hand edits: delete, move, add', () => {
    const p = { ...DEFAULT_PARAMS, seed: 11 };
    const base = generate(p);
    const victim = base.zones.find((z) => z.depth >= 2 && z.feature !== 'mass')!;
    const e = emptyEdits();
    e.zones[victim.key] = { deleted: true };
    expect(generate(p, e).zones.some((z) => z.key === victim.key)).toBe(false);

    const mover = base.zones[3];
    const e2 = emptyEdits();
    e2.zones[mover.key] = { x: mover.frame.x + 40, y: mover.frame.y - 25, a: 0.3 };
    const moved = generate(p, e2).zones.find((z) => z.key === mover.key)!;
    expect(moved.frame.x).toBeCloseTo(mover.frame.x + 40);
    expect(moved.frame.a).toBeCloseTo(0.3);

    const e3 = emptyEdits();
    e3.added.push({ key: 'u1', feature: 'pool', x: 300, y: 300, a: 0 });
    const withPool = generate(p, e3);
    const pool = withPool.zones.find((z) => z.key === 'u1')!;
    expect(pool.feature).toBe('pool');
    expect(withPool.links.some((l) => l.a === pool.id || l.b === pool.id)).toBe(true);
  });
  it('has no stray long runs, overlaps or crossings between floors', () => {
    const big = { size: 420, turn: 0.15, density: 0.6, loops: 0.35, deadEnds: 0.4, corridors: 0.4, landmarks: 0.4, themes: 0.5, heights: 0.3, anomalies: 0.2 };
    const runs: [number, Partial<typeof DEFAULT_PARAMS>][] = [[1, {}], [2, {}], [3, { longRuns: 0 }], [4, { longRuns: 0, turn: 0.6 }], [398604, { ...big, longRuns: 0 }], [7, { ...big, longRuns: 0 }]];
    for (const [seed, over] of runs) {
      const m = generate({ ...DEFAULT_PARAMS, ...over, seed });
      const f = check(m);
      if (over.longRuns === 0) expect(f.long, `seed ${seed}: long runs at 0`).toBeLessThanOrEqual(1);
      expect(f.roomRoom, `seed ${seed}: rooms on rooms`).toEqual([]);
      expect(f.corrRoom, `seed ${seed}: corridors through rooms`).toEqual([]);
      expect(f.crossLevel, `seed ${seed}: corridors crossing between floors`).toEqual([]);
      expect(Object.values(f.outside).reduce((a, b) => a + b, 0), `seed ${seed}: pieces on other rooms ${JSON.stringify(f.outside)}`).toBe(0);
    }
  }, 30_000);
  it('moving a room only pushes the rooms it lands on; the rest stays where it was', () => {
    for (const seed of [11, 5, 23]) {
      const p = { ...DEFAULT_PARAMS, seed };
      const base = generate(p);
      // a room in the middle of the map, dropped half onto its nearest neighbour
      const mover = base.zones.filter((z) => z.depth >= 2 && z.feature !== 'mass')[3];
      let near = base.zones[0], nd = Infinity;
      for (const z of base.zones) {
        if (z === mover) continue;
        const d = Math.hypot(z.frame.x - mover.frame.x, z.frame.y - mover.frame.y);
        if (d < nd) { nd = d; near = z; }
      }
      const e = emptyEdits();
      const to = { x: (mover.frame.x + near.frame.x) / 2, y: (mover.frame.y + near.frame.y) / 2 };
      e.zones[mover.key] = { x: to.x, y: to.y, a: mover.frame.a };
      const m = generate(p, e);
      const after = new Map(m.zones.map((z) => [z.key, z]));
      const moved = base.zones.filter((z) => { const a = after.get(z.key)!; return Math.hypot(a.frame.x - z.frame.x, a.frame.y - z.frame.y) > 1e-9; });
      expect(after.get(mover.key)!.frame.x).toBeCloseTo(to.x);
      expect(moved.length, `seed ${seed}: rooms that moved`).toBeLessThanOrEqual(12);
      expect(m.zones.length).toBe(base.zones.length);
      const f = check(m);
      expect(f.roomRoom, `seed ${seed}: rooms on rooms after the move`).toEqual([]);
      // no room is cut off by the move (some seeds have a cut-off room already)
      const cutBefore = new Set(base.stats.cutOff.map((i) => base.zones[i].key));
      expect(m.stats.cutOff.map((i) => m.zones[i].key).filter((k) => !cutBefore.has(k)), `seed ${seed}: cut off by the move`).toEqual([]);
      // the same edits give the same map again (what a reload shows)
      expect(JSON.stringify(generate(p, e).zones.map((z) => z.frame))).toBe(JSON.stringify(m.zones.map((z) => z.frame)));
    }
  });
});
