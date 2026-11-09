import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { solidPlanes } from '../src/engine/light/faces';
import { SolidGrid, castRay, occluded, insideAny } from '../src/engine/light/bake';
import { parseMap } from '../src/data/map';

// The bake's ray grid must answer exactly like testing every brush.
describe.each(['laquinta', 'pmp_basement', 'flatgrass'])('ray grid on %s', (name) => {
  const map = parseMap(JSON.parse(readFileSync(new URL(`../junk/maps/${name}.json`, import.meta.url), 'utf8')));
  const boxes = map.brushes.filter((b) => b.solid !== false).map(solidPlanes);
  const grid = new SolidGrid(boxes);
  const lo = [0, 1, 2].map((i) => Math.min(...boxes.map((b) => b.min[i])));
  const hi = [0, 1, 2].map((i) => Math.max(...boxes.map((b) => b.max[i])));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pt = () => [0, 1, 2].map((i) => lo[i] + (hi[i] - lo[i]) * rnd()) as [number, number, number];

  it('casts, occludes and contains the same as the brute-force reference', () => {
    for (let k = 0; k < 3000; k++) {
      const a = pt(), b = pt();
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const g = grid.cast(a[0], a[1], a[2], d[0], d[1], d[2]), r = castRay(boxes, a[0], a[1], a[2], d[0], d[1], d[2]);
      expect(g?.faceId ?? null).toBe(r?.faceId ?? null);
      if (g && r) expect(g.t).toBeCloseTo(r.t, 9);
      expect(grid.occluded(a[0], a[1], a[2], b[0], b[1], b[2])).toBe(occluded(boxes, a[0], a[1], a[2], b[0], b[1], b[2]));
      expect(grid.inside(a)).toBe(insideAny(boxes, a));
    }
  });
});
