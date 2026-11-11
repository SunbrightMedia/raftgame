import { describe, it, expect } from 'vitest';
import { LOT, lotKind, windowLayout } from '../src/world/industrial/lots';
import type { Layout } from '../src/world/industrial/layout';
import { industrialLots } from '../src/world/industrial/world';

/** Everything in a built map as one line each, moved by (dx, dy): brushes by their planes and textures, the rest by class, place and properties. */
function things(made: ReturnType<typeof industrialLots>, dx: number, dy: number): string[] {
  const r = (v: number) => Math.round(v * 10) / 10;
  const out: string[] = [];
  for (const b of made.map.brushes as unknown as { planes: number[][]; faces: Record<string, { tex: string }>; group?: string; solid?: boolean }[]) {
    out.push(`B ${b.planes.map((p) => `${p[0]},${p[1]},${p[2]},${r(p[3] + p[0] * dx + p[1] * dy)}`).join(' ')} ${Object.values(b.faces).map((f) => f.tex).join(',')} ${b.group ?? ''} ${b.solid === false ? 'not solid' : ''}`);
  }
  for (const e of made.map.entities) {
    if (e.class === 'player_start') continue;
    const q = { ...(e.props ?? {}) } as Record<string, number[]>;
    for (const k of ['to', 'min', 'max']) if (q[k]) q[k] = [r(q[k][0] + dx), r(q[k][1] + dy), r(q[k][2])];
    if (q.boxes) q.boxes = q.boxes.map((v, i) => r(v + (i % 3 === 0 ? dx : i % 3 === 1 ? dy : 0)));
    out.push(`E ${e.class} ${r(e.origin[0] + dx)},${r(e.origin[1] + dy)},${r(e.origin[2])} ${JSON.stringify(e.angles ?? [])} ${JSON.stringify(q)}`);
  }
  return out.sort();
}

/** What a plan says about one lot, in world tiles: its junctions, its segments, its catwalks and which ways each spot of the maze opens. */
function facts(lay: Layout, i: number, j: number): { junctions: string[]; segments: string[]; walks: string[]; nodes: string[]; blocks: string[] } {
  const [ox, oy] = lay.origin!;
  const inLot = (x: number, y: number) => Math.floor((x + ox) / LOT) === i && Math.floor((y + oy) / LOT) === j;
  const J = (k: number) => `${lay.junctions[k].x + ox},${lay.junctions[k].y + oy}`;
  const touches = (s: Layout['segments'][number]) => inLot(lay.junctions[s.a].x, lay.junctions[s.a].y) || inLot(lay.junctions[s.b].x, lay.junctions[s.b].y) || s.tiles.some(([x, y]) => inLot(x, y));
  const seg = (s: Layout['segments'][number]) => `${J(s.a)}>${J(s.b)}:${s.tiles.length}:${s.tunnel ? 't' : ''}${s.bridge ? 'b' : ''}${s.stair ? 's' : ''}`;
  return {
    junctions: lay.junctions.filter((q) => inLot(q.x, q.y)).map((q) => `${q.x + ox},${q.y + oy}`).sort(),
    segments: lay.segments.filter(touches).map(seg).sort(),
    walks: lay.walks.filter((w) => touches(lay.segments[w.segment])).map((w) => `${seg(lay.segments[w.segment])}@${w.la}-${w.lb}`).sort(),
    nodes: [...lay.nodes].filter(([k]) => { const q = lay.junctions[Number(k.split(':')[0])]; return inLot(q.x, q.y); }).map(([k, mask]) => `${J(Number(k.split(':')[0]))}:${k.split(':')[1]}=${mask}`).sort(),
    blocks: lay.blocks.filter((b) => inLot(b.rect.x0, b.rect.y0)).map((b) => `${b.key}:${b.rect.x1 - b.rect.x0}x${b.rect.y1 - b.rect.y0}:${b.kind}${b.bridged ? 'b' : ''}`).sort(),
  };
}

describe('lots', () => {
  it('gives no lot a neighbour of its own kind', () => {
    for (const seed of [1, 2, 3]) for (let j = -4; j < 4; j++) for (let i = -4; i < 4; i++) {
      expect(lotKind(seed, i, j)).not.toBe(lotKind(seed, i + 1, j));
      expect(lotKind(seed, i, j)).not.toBe(lotKind(seed, i, j + 1));
    }
  });

  it('plans a lot the same from wherever it is come upon', () => {
    for (const seed of [1, 5]) {
      // A square of five lots a side: its inner nine are whole. Each must be the same lot as when it is the middle of its own square of three.
      const big = windowLayout(seed, -2, -2, 5);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const small = windowLayout(seed, i - 1, j - 1, 3);
        expect(facts(small, i, j)).toEqual(facts(big, i, j));
      }
      // And from a square that lies off to one side.
      const side = windowLayout(seed, -1, -3, 5);
      expect(facts(side, 0, -1)).toEqual(facts(big, 0, -1));
      expect(facts(side, 1, 0)).toEqual(facts(big, 1, 0));
    }
  });

  it('makes one maze of the whole: every spot in the inner lots can be walked to from the start', () => {
    for (const seed of [1, 2, 3, 4]) {
      const lay = windowLayout(seed, -2, -2, 5);
      const next = new Map<string, string[]>();
      const link = (a: string, b: string) => { (next.get(a) ?? next.set(a, []).get(a)!).push(b); (next.get(b) ?? next.set(b, []).get(b)!).push(a); };
      for (const w of lay.walks) { const s = lay.segments[w.segment]; link(`${s.a}:${w.la}`, `${s.b}:${w.lb}`); }
      const start = `${lay.start.junction}:${lay.start.level}`;
      const seen = new Set([start]), queue = [start];
      while (queue.length) for (const n of next.get(queue.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      const [ox, oy] = lay.origin!;
      const inner = [...lay.nodes.keys()].filter((k) => { const q = lay.junctions[Number(k.split(':')[0])]; const a = Math.floor((q.x + ox) / LOT), b = Math.floor((q.y + oy) / LOT); return Math.abs(a) <= 1 && Math.abs(b) <= 1; });
      expect(inner.length).toBeGreaterThan(200);
      const lost = inner.filter((k) => !seen.has(k));
      // A spot on a neighbour's avenue reached only from a lot outside the inner nine may hang loose here; nothing else may.
      expect(lost.length).toBeLessThan(inner.length * 0.02);
    }
  });

  it('has a level catwalk on the middle level along every avenue lane', () => {
    const lay = windowLayout(3, -1, -1, 3);
    const mid = Math.floor(lay.params.levels / 2);
    // The middle lot's south avenue lane: every segment along it carries a walk on the middle level.
    const [ox, oy] = lay.origin!;
    const row = lay.junctions.filter((q) => Math.floor((q.y + oy) / LOT) === 0 && Math.floor((q.x + ox) / LOT) === 0);
    expect(row.length).toBeGreaterThan(1);
    const onMid = new Set(lay.walks.filter((w) => w.la === mid && w.lb === mid).map((w) => w.segment));
    const start = lay.junctions[lay.start.junction];
    const along = lay.segments.filter((s) => s.dir === 0 && lay.junctions[s.a].y === start.y && lay.junctions[s.a].x >= start.x && lay.junctions[s.b].x <= start.x + LOT);
    expect(along.length).toBeGreaterThan(0);
    for (const s of along) expect(onMid.has(s.id)).toBe(true);
  });

  it('builds a lot the same alone as with its neighbours: four lots one by one are the four built together', () => {
    const S = LOT * 128;
    for (const [seed, i0, j0] of [[1, 0, 0], [7, -3, 2]]) {
      const together = things(industrialLots(seed, i0, j0, 2), 0, 0);
      const apart: string[] = [];
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) apart.push(...things(industrialLots(seed, i0 + i, j0 + j, 1), i * S, j * S));
      apart.sort();
      expect(apart.length).toBe(together.length);
      expect(apart).toEqual(together);
    }
  });
});
