import { describe, it, expect } from 'vitest';
import { lightGridUniforms, setLightGrid } from '../src/engine/render/lightGrid';
import { buildLightGrid, gridLightAt, lampsListedAt, mergeBoxes, MAX_PER_CELL, type Box3, type GridLamp } from '../src/engine/render/lightGridCore';

const lamp = (pos: [number, number, number], o: Partial<GridLamp> = {}): GridLamp => ({ pos, color: [300, 300, 300], size: 100, reach: 400, ...o });
const box = (min: number[], max: number[]): Box3 => ({ min, max });
const lum = (e: number[]) => Math.max(...e);

describe('lamp grid', () => {
  it('is off with no lamps', () => {
    expect(setLightGrid([]).lamps).toBe(0);
    expect(lightGridUniforms.lgOn.value).toBe(0);
    expect(buildLightGrid([])).toBeNull();
  });

  it('makes its textures and turns on', () => {
    const stats = setLightGrid([lamp([1000, 1000, 100])]);
    expect(stats.lamps).toBe(1);
    expect(lightGridUniforms.lgOn.value).toBe(1);
    expect(lightGridUniforms.lgGrid.value).not.toBeNull();
    setLightGrid([]);
  });

  it('lists a lamp in the cells it reaches and in no others', () => {
    const g = buildLightGrid([lamp([1000, 1000, 100]), lamp([5000, 1000, 100])])!;
    expect(lampsListedAt(g, [1000, 1000, 100])).toEqual([0]);
    expect(lampsListedAt(g, [1300, 1000, 100])).toEqual([0]);
    expect(lampsListedAt(g, [5100, 900, 100])).toEqual([1]);
    expect(lampsListedAt(g, [3000, 1000, 100])).toEqual([]);    // between them, out of reach of both
  });

  it('gives the light the formula says', () => {
    const g = buildLightGrid([lamp([1000, 1000, 300])])!;
    // Straight under the lamp, 200 away, facing it: 300 · win² / (1 + d²/size²), win = 1 − d²/reach².
    const win = 1 - (200 * 200) / (400 * 400);
    expect(gridLightAt(g, [1000, 1000, 100], [0, 0, 1])[0]).toBeCloseTo((300 * win * win) / (1 + 4), 4);
    // Facing away it gets nothing (the wrap ends before a quarter turn past the edge).
    expect(gridLightAt(g, [1000, 1000, 100], [0, 0, -1])[0]).toBe(0);
    // The ambient, more from above.
    expect(gridLightAt(g, [3000, 3000, 100], [0, 0, 1], [10, 10, 10], 0.5)).toEqual([15, 15, 15]);
  });

  it('keeps a boxed lamp to its box, with a soft edge', () => {
    const g = buildLightGrid([lamp([1000, 1000, 100], { box: box([900, 900, 0], [1100, 1100, 200]) }), lamp([3000, 3000, 100])])!;
    expect(lampsListedAt(g, [1000, 1000, 100])).toEqual([0]);
    expect(lampsListedAt(g, [1300, 1000, 100])).toEqual([]);     // within its reach, outside its box
    const inside = lum(gridLightAt(g, [1090, 1000, 100], [-1, 0, 0])), edge = lum(gridLightAt(g, [1105, 1000, 100], [-1, 0, 0])), out = lum(gridLightAt(g, [1125, 1000, 100], [-1, 0, 0]));
    expect(inside).toBeGreaterThan(50);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(inside);
    expect(out).toBe(0);
  });

  it('keeps a lamp in the open out of the cells wholly inside a shade box', () => {
    const shade = box([1024, 512, -512], [2048, 1536, 512]);
    const g = buildLightGrid([lamp([900, 1000, 100], { open: true }), lamp([900, 1000, 120])], [shade])!;
    expect(lampsListedAt(g, [1100, 1000, 100])).toEqual([1]);    // the open lamp is shut out, the other is not
    expect(lampsListedAt(g, [960, 1000, 100])).toEqual([0, 1]);  // outside the shade both shine
  });

  it('keeps the strongest where more lamps meet than a cell can hold', () => {
    const n = MAX_PER_CELL + 4;
    const many = Array.from({ length: n }, (_, i) => lamp([1000 + i * 4, 1000, 100], { color: [10 * (i + 1), 0, 0] }));
    const g = buildLightGrid(many)!;
    expect(g.stats.full).toBeGreaterThan(0);
    const got = lampsListedAt(g, [1000, 1000, 100]);
    expect(got.length).toBe(MAX_PER_CELL);
    expect(Math.min(...got)).toBe(4);                   // the four weakest are dropped
  });
});

describe('boxes of air', () => {
  it('merges runs that meet end to end and drops boxes inside others', () => {
    const merged = mergeBoxes([
      box([0, 0, 0], [64, 96, 120]), box([64, 0, 0], [512, 96, 120]), box([512, 0, 0], [576, 96, 120]),   // a stub, a run, a stub: one corridor
      box([100, 10, 10], [200, 50, 50]),                                                                  // inside it
      box([0, 0, 256], [64, 96, 376]),                                                                    // the level above: apart
      box([576, 0, 0], [700, 128, 120]),                                                                  // a wider piece: stays its own
    ]);
    expect(merged.length).toBe(3);
    expect(merged.some((b) => b.min[0] === 0 && b.max[0] === 576 && b.max[2] === 120)).toBe(true);
  });

  // Two rooms side by side with a doorway between them, and a third room over the first with no way in.
  const roomA = box([0, 0, 0], [512, 512, 240]), door = box([512, 192, 0], [608, 320, 168]), roomB = box([608, 0, 0], [1120, 512, 240]);
  const above = box([0, 0, 256], [512, 512, 496]);
  const inA = lamp([256, 256, 200], { indoor: true, reach: 1200, size: 200 });

  it('sends light through a doorway in a wedge', () => {
    const g = buildLightGrid([inA], [], [roomA, door, roomB, above])!;
    expect(g.stats.lost).toBe(0);
    // Its own room: all lit, with no test.
    expect(lum(gridLightAt(g, [100, 100, 0], [0, 0, 1]))).toBeGreaterThan(10);
    // The next room's floor straight through the doorway: lit.
    expect(lum(gridLightAt(g, [900, 256, 0], [0, 0, 1]))).toBeGreaterThan(5);
    // Beside the doorway, behind the wall: dark.
    expect(lum(gridLightAt(g, [680, 40, 0], [0, 0, 1]))).toBe(0);
    expect(lum(gridLightAt(g, [680, 470, 0], [0, 0, 1]))).toBe(0);
    // The shadow's edge is soft: between lit and dark there is a place with some light.
    let prev = Infinity, soft = 0;
    let full = 0;
    for (let y = 256; y >= 40; y -= 0.5) {
      const v = lum(gridLightAt(g, [900, y, 0], [0, 0, 1]));
      if (y === 256) full = v;
      expect(v).toBeLessThanOrEqual(prev + 1e-6);     // it only ever falls as the point goes behind the wall
      if (v > 0.05 * full && v < 0.6 * full) soft++;
      prev = v;
    }
    expect(soft).toBeGreaterThan(1);
    expect(prev).toBe(0);
  });

  it('never lights through a floor or into a room with no way in', () => {
    const g = buildLightGrid([inA], [], [roomA, door, roomB, above])!;
    expect(lampsListedAt(g, [256, 256, 300])).toEqual([]);
    expect(lum(gridLightAt(g, [256, 256, 256], [0, 0, 1]))).toBe(0);
    expect(lum(gridLightAt(g, [256, 256, 496], [0, 0, -1]))).toBe(0);
  });

  it('counts the walls too thin to stop the light', () => {
    const lower = box([0, 0, 0], [512, 512, 250]), upper = box([0, 0, 256], [512, 512, 496]);
    expect(buildLightGrid([inA], [], [lower, upper])!.stats.thin).toBe(1);
    expect(buildLightGrid([inA], [], [roomA, door, roomB, above])!.stats.thin).toBe(0);
  });

  it('counts a lamp inside no box of air as lost, and it lights nothing', () => {
    const g = buildLightGrid([lamp([5000, 5000, 100], { indoor: true })], [], [roomA])!;
    expect(g.stats.lost).toBe(1);
    expect(lum(gridLightAt(g, [5000, 5000, 0], [0, 0, 1]))).toBe(0);
  });

  it('lights round two corners of a corridor only as far as the lamp can see', () => {
    // An L: a run along x, then a run along y from its far end.
    const runX = box([0, 0, 0], [640, 96, 120]), runY = box([544, 96, 0], [640, 700, 120]);
    const g = buildLightGrid([lamp([100, 48, 100], { indoor: true, reach: 1500, size: 300 })], [], [runX, runY])!;
    expect(lum(gridLightAt(g, [600, 48, 0], [0, 0, 1]))).toBeGreaterThan(1);       // along its own run
    expect(lum(gridLightAt(g, [636, 100, 60], [-1, 0, 0]))).toBeGreaterThan(0);    // the far wall just past the corner: seen
    expect(lum(gridLightAt(g, [636, 180, 60], [-1, 0, 0]))).toBe(0);               // a little further along it: behind the corner
    expect(lum(gridLightAt(g, [560, 600, 0], [0, 0, 1]))).toBe(0);                 // deep in the other arm: not seen
  });
});
