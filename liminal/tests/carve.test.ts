import { describe, it, expect } from 'vitest';
import { MapOut, NODRAW, type V3 } from '../src/world/mapOut';
import { carve, type Hollow } from '../src/world/carve';
import { Rng } from '../src/world/rng';

/** The boxes carve() wrote, with each side's texture (sides in the order x−, x+, y−, y+, z−, z+). */
function boxes(m: MapOut): { min: V3; max: V3; tex: string[] }[] {
  return (m.brushes as unknown as { planes: number[][]; faces: Record<string, { tex: string }> }[]).map((b) => ({
    min: [-b.planes[0][3], -b.planes[2][3], -b.planes[4][3]] as V3,
    max: [b.planes[1][3], b.planes[3][3], b.planes[5][3]] as V3,
    tex: [0, 1, 2, 3, 4, 5].map((i) => b.faces[String(i)].tex),
  }));
}
const inBox = (p: V3, b: { min: V3; max: V3 }) => p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2];
const FIN = { floor: 'floor', wall: 'wall', ceil: 'ceil' };

function randomCase(seed: number) {
  const r = new Rng(seed);
  const min: V3 = [0, 0, 0], max: V3 = [1024, 768, 640];
  const hollows: Hollow[] = Array.from({ length: r.int(1, 9) }, () => {
    const lo: V3 = [r.int(-2, 14) * 64, r.int(-2, 10) * 64, r.int(-1, 8) * 64];
    return { min: lo, max: [lo[0] + r.int(1, 6) * 64, lo[1] + r.int(1, 6) * 64, lo[2] + r.int(1, 4) * 64] as V3, finish: FIN };
  });
  const m = new MapOut('', '');
  carve(m, min, max, hollows, { tex: 'shell' });
  return { min, max, hollows, out: boxes(m) };
}

describe('carve', () => {
  it('leaves a plain box alone', () => {
    const m = new MapOut('', '');
    expect(carve(m, [0, 0, 0], [64, 64, 64], [], { tex: 'shell' })).toBe(1);
  });

  it('writes solid exactly where the box is and no hollow is (boxes never overlap, never enter a hollow)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { min, max, hollows, out } = randomCase(seed);
      const r = new Rng(seed * 7919);
      for (let n = 0; n < 400; n++) {
        // Points off the 64 grid, so never on a boundary.
        const p: V3 = [r.int(0, 15) * 64 + 32 + r.int(-20, 20), r.int(0, 11) * 64 + 32 + r.int(-20, 20), r.int(0, 9) * 64 + 32 + r.int(-20, 20)];
        if (!inBox(p, { min, max })) continue;
        const hollow = hollows.some((h) => inBox(p, h));
        const covering = out.filter((b) => inBox(p, b)).length;
        if (hollow) expect(covering).toBe(0);
        else expect(covering).toBeLessThanOrEqual(1);   // 0 only deep inside, where a buried piece was left out
      }
    }
  });

  it('gives every side one view: all of it sees the outside, a hollow, or more solid', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { min, max, hollows, out } = randomCase(seed);
      for (const b of out) {
        for (let side = 0; side < 6; side++) {
          const axis = side >> 1, sign = side & 1 ? 1 : -1;
          const a1 = (axis + 1) % 3, a2 = (axis + 2) % 3;
          const seen = new Set<string>();
          for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
            const p: V3 = [0, 0, 0];
            p[axis] = (sign > 0 ? b.max[axis] : b.min[axis]) + sign * 0.5;
            p[a1] = b.min[a1] + ((b.max[a1] - b.min[a1]) * (i + 0.37)) / 6;   // never on the 64 grid, where two hollows may meet
            p[a2] = b.min[a2] + ((b.max[a2] - b.min[a2]) * (j + 0.37)) / 6;
            seen.add(!inBox(p, { min, max }) ? 'outside' : hollows.some((h) => inBox(p, h)) ? 'hollow' : 'solid');
          }
          expect(seen.size).toBe(1);
          const view = [...seen][0], tex = b.tex[side];
          if (view === 'solid') expect(tex).toBe(NODRAW);
          else if (view === 'outside') expect(tex).toBe('shell');
          else expect(tex).toBe(side === 5 ? 'floor' : side === 4 ? 'ceil' : 'wall');
        }
      }
    }
  });
});
