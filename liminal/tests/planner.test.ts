import { describe, expect, it } from 'vitest';
import { FEATURES, ZONE_FEATURES } from '../src/planner/catalogue';
import { DEFAULT_PARAMS, emptyEdits, generate } from '../src/planner/generate';
import { buildZone } from '../src/planner/recipes';
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
});
