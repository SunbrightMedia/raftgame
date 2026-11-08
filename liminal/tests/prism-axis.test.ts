import { describe, it, expect } from 'vitest';
import { buildFaces, solidPlanes, insideSolid, facePoint } from '../src/engine/light/faces';
import { parseMap } from '../src/data/map';

// A sideways prism (like a tunnel's curved ceiling slice): outline in (z, x), extruded along y.
const map = parseMap({
  format: 'liminal-map', version: 1, name: 't', entities: [],
  brushes: [{ id: 1, type: 'prism', axis: 'y', points: [[0, 0], [10, 0], [10, 20], [0, 20]], z0: -5, z1: 5, tex: 'dev/gray' }],
});

describe('prism along y', () => {
  const b = map.brushes[0];
  it('has world bounds from (z, x) points and y extent', () => {
    expect(b.min).toEqual([0, -5, 0]);
    expect(b.max).toEqual([20, 5, 10]);
  });
  it('builds 6 faces with outward normals around a solid centre', () => {
    const sp = solidPlanes(b);
    const c: [number, number, number] = [10, 0, 5];
    expect(insideSolid(sp, c)).toBe(true);
    const faces = buildFaces(map.brushes);
    expect(faces.length).toBe(6);
    for (const f of faces) {
      const p = facePoint(f, f.width / 2, f.height / 2);
      const out = (p[0] - c[0]) * f.n[0] + (p[1] - c[1]) * f.n[1] + (p[2] - c[2]) * f.n[2];
      expect(out).toBeGreaterThan(0);
      // The face's centre lies on the brush surface (just outside when lifted).
      expect(insideSolid(sp, facePoint(f, f.width / 2, f.height / 2, 0.5))).toBe(false);
    }
  });
});
