import { describe, it, expect } from 'vitest';
import { makeLayout } from '../src/world/industrial/layout';
import { industrial } from '../src/world/industrial/world';

const STREETS: (readonly [number, number])[] = [[1, 2], [3, 5], [5, 2], [7, 1]];

describe('industrial layout', () => {
  it('is fixed by its seed', () => {
    const a = makeLayout(5, { streets: STREETS }), b = makeLayout(5, { streets: STREETS });
    expect(JSON.stringify([a.walks, a.segments.length, [...a.nodes]])).toBe(JSON.stringify([b.walks, b.segments.length, [...b.nodes]]));
    expect(JSON.stringify(makeLayout(6, { streets: STREETS }).walks)).not.toBe(JSON.stringify(a.walks));
  });

  for (const seed of [1, 2, 3, 4]) {
    const lay = makeLayout(seed, { streets: STREETS });
    const N = lay.params.size;
    const blockOf = (x: number, y: number) => lay.tileBlock[y * N + x];

    it(`seed ${seed}: every part of the maze can be reached from the start`, () => {
      const next = new Map<string, string[]>();
      const link = (a: string, b: string) => { (next.get(a) ?? next.set(a, []).get(a)!).push(b); (next.get(b) ?? next.set(b, []).get(b)!).push(a); };
      for (const w of lay.walks) { const s = lay.segments[w.segment]; link(`${s.a}:${w.la}`, `${s.b}:${w.lb}`); }
      const seen = new Set([`${lay.start.junction}:${lay.start.level}`]), todo = [...seen];
      while (todo.length) for (const n of next.get(todo.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); }
      expect(seen.size).toBe(lay.nodes.size);
      expect(blockOf(lay.junctions[lay.start.junction].x, lay.junctions[lay.start.junction].y)).toBe(-1);   // the start is out in a street
    });

    it(`seed ${seed}: tunnels keep their walls`, () => {
      const lane = new Uint8Array(N * N);
      for (const j of lay.junctions) lane[j.y * N + j.x] = 1;
      for (const s of lay.segments) for (const [x, y] of s.tiles) lane[y * N + x] = 1;
      let tunnels = 0;
      for (const s of lay.segments) {
        if (s.tunnel) tunnels++;
        // A tile of a segment is a plain straight piece: lane before and after it, none beside it.
        const side = s.dir % 2 === 0 ? [0, 1] : [1, 0];
        for (const [x, y] of s.tiles) {
          expect(lane[(y + side[1]) * N + x + side[0]] + lane[(y - side[1]) * N + x - side[0]]).toBe(0);
          const b = blockOf(x, y);
          if (b < 0) continue;
          // Inside a mass: two tiles of wall to the faces it runs along.
          const R = lay.blocks[b].rect;
          if (s.dir % 2 === 0) expect(Math.min(y - R.y0, R.y1 - 1 - y)).toBeGreaterThanOrEqual(2);
          else expect(Math.min(x - R.x0, R.x1 - 1 - x)).toBeGreaterThanOrEqual(2);
        }
        // Stairs never straddle a doorway.
        if (s.stair) {
          const i0 = Math.floor((s.tiles.length - 4) / 2), i1 = s.tiles.length - 4 - i0;
          const kinds = new Set(s.tiles.slice(Math.min(i0, i1) - 1, Math.max(i0, i1) + 5).map(([x, y]) => blockOf(x, y) >= 0));
          expect(kinds.size).toBe(1);
        }
      }
      expect(tunnels).toBeGreaterThan(10);
      // A junction inside a mass keeps at least one tile of wall on every side.
      for (const j of lay.junctions) {
        const b = blockOf(j.x, j.y);
        if (b < 0) continue;
        const R = lay.blocks[b].rect;
        expect(Math.min(j.x - R.x0, R.x1 - 1 - j.x, j.y - R.y0, R.y1 - 1 - j.y)).toBeGreaterThanOrEqual(1);
      }
    });
  }

  it('builds the same world twice from one seed', () => {
    const a = industrial(2).map, b = industrial(2).map;
    expect(a.brushes.length).toBe(b.brushes.length);
    expect(JSON.stringify(a.brushes.slice(0, 200))).toBe(JSON.stringify(b.brushes.slice(0, 200)));
    expect(JSON.stringify(a.entities.slice(-200))).toBe(JSON.stringify(b.entities.slice(-200)));
  });
});
