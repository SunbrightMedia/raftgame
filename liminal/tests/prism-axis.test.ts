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

describe('flatgrass map', () => {
  it('keeps every structure piece between the grass (z 0) and the platform top (z 1024)', async () => {
    const { readFileSync } = await import('node:fs');
    const m = parseMap(JSON.parse(readFileSync(new URL('../junk/maps/flatgrass.json', import.meta.url), 'utf8')));
    const bad = m.brushes.filter((b) => b.tex !== 'outdoor/grass' && (b.min[2] < -0.01 || b.max[2] > 1024.01));
    expect(bad.map((b) => `#${b.id} z ${b.min[2]}..${b.max[2]}`)).toEqual([]);
    expect(m.brushes.filter((b) => b.type === 'prism' && b.axis === 'y').length).toBe(56);
  });
});

describe('convex brushes', () => {
  // A wedge: a 64-unit cube cut by a 45° slope (Hammer-style planes).
  const s = Math.SQRT1_2;
  const wedge = parseMap({
    format: 'liminal-map', version: 1, name: 't', entities: [],
    brushes: [{ id: 1, type: 'convex', tex: 'dev/gray', planes: [[1, 0, 0, 64], [-1, 0, 0, 0], [0, 1, 0, 64], [0, -1, 0, 0], [0, 0, -1, 0], [s, 0, s, 64 * s]] }],
  });
  it('derives bounds, faces and collision from planes', () => {
    const b = wedge.brushes[0];
    expect(b.min).toEqual([0, 0, 0]);
    expect(b.max.map((v) => Math.round(v))).toEqual([64, 64, 64]);
    const faces = buildFaces(wedge.brushes);
    expect(faces.length).toBe(5);                     // the +x plane only touches along an edge: no face
    const slope = faces.find((f) => f.key === '5')!;
    expect(slope.poly!.length).toBe(4);
    expect(Math.round(slope.width * slope.height)).toBe(Math.round(64 * 64 * Math.SQRT2));
    const sp = solidPlanes(b);
    expect(sp.planes.length).toBe(6);
  });
});
