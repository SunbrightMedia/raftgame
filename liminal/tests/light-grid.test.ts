import { describe, it, expect } from 'vitest';
import { lightGridUniforms, setLightGrid, type GridLamp } from '../src/engine/render/lightGrid';

/** The lamps listed for the cell that holds point p. */
function lampsAt(p: number[]): number[] {
  const u = lightGridUniforms, o = u.lgOrigin.value, c = u.lgCell.value, d = u.lgDims.value;
  const ci = [Math.floor((p[0] - o.x) / c.x), Math.floor((p[1] - o.y) / c.y), Math.floor((p[2] - o.z) / c.z)];
  if (ci.some((v, k) => v < 0 || v >= [d.x, d.y, d.z][k])) return [];
  const data = u.lgCells.value!.image.data as Float32Array;
  const at = ((ci[2] * d.y + ci[1]) * d.x * 2 + ci[0] * 2) * 4;
  return [...data.slice(at, at + 8)].filter((v) => v >= 0);
}
const lamp = (pos: [number, number, number], o: Partial<GridLamp> = {}): GridLamp => ({ pos, color: [300, 300, 300], size: 100, reach: 400, ...o });

describe('lamp grid', () => {
  it('is off with no lamps', () => {
    expect(setLightGrid([]).lamps).toBe(0);
    expect(lightGridUniforms.lgOn.value).toBe(0);
  });

  it('lists a lamp in the cells it reaches and in no others', () => {
    setLightGrid([lamp([1000, 1000, 100]), lamp([5000, 1000, 100])]);
    expect(lightGridUniforms.lgOn.value).toBe(1);
    expect(lampsAt([1000, 1000, 100])).toEqual([0]);
    expect(lampsAt([1300, 1000, 100])).toEqual([0]);
    expect(lampsAt([5100, 900, 100])).toEqual([1]);
    expect(lampsAt([3000, 1000, 100])).toEqual([]);    // between them, out of reach of both
  });

  it('keeps a boxed lamp to the cells its box touches', () => {
    setLightGrid([lamp([1000, 1000, 100], { box: { min: [900, 900, 0], max: [1100, 1100, 200] } }), lamp([3000, 3000, 100])]);
    expect(lampsAt([1000, 1000, 100])).toEqual([0]);
    expect(lampsAt([1300, 1000, 100])).toEqual([]);     // within its reach, outside its box
  });

  it('keeps a lamp in the open out of the cells wholly inside a shade box', () => {
    const shade = { min: [1024, 512, -512], max: [2048, 1536, 512] };
    setLightGrid([lamp([900, 1000, 100], { open: true }), lamp([900, 1000, 120])], [shade]);
    expect(lampsAt([1100, 1000, 100])).toEqual([1]);    // the open lamp is shut out, the other is not
    expect(lampsAt([960, 1000, 100])).toEqual([0, 1]);  // outside the shade both shine
  });

  it('keeps the eight strongest where more lamps meet', () => {
    const many = Array.from({ length: 12 }, (_, i) => lamp([1000 + i * 4, 1000, 100], { color: [10 * (i + 1), 0, 0] }));
    const stats = setLightGrid(many);
    expect(stats.full).toBeGreaterThan(0);
    const got = lampsAt([1000, 1000, 100]);
    expect(got.length).toBe(8);
    expect(Math.min(...got)).toBe(4);                   // the four weakest are dropped
  });
});
