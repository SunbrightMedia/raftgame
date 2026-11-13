// The Complex camera's own-code pieces against numbers from the game's compiled steps (run by
// tools/complex/dxbc.py on the user's capture, frame 18325; the full checks are tools/complex/check_*.py).
import { describe, expect, it } from 'vitest';
import { makeToneTable, COMPLEX_TONE } from '../src/engine/render/complexTone';
import { lensConstants } from '../src/engine/render/complexCamera';

const bits = (x: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x); return b.getUint32(0); };

describe('complex camera', () => {
  it('tone table cells equal the game CombineLUTs step to the last bit', () => {
    // float32 bit patterns of the game's step (exactly rounded exp2/log2; every number in the step exact, from its
    // bytes in the deep export), cell "r,g,b" -> RGB
    const game: Record<string, number[]> = {
      '0,0,0': [630433922, 630433790, 630433849],
      '16,16,16': [1059635991, 1059635935, 1059635968],
      '31,31,31': [1064765012, 1064764919, 1064764961],
      '31,0,0': [1065561872, 1063501816, 1059228264],
      '0,31,0': [1064349079, 1064899098, 1063750850],
      '0,0,31': [1063062898, 1064259131, 1064813662],
      '7,19,6': [1036391612, 1063195472, 1038175877],
      '12,19,5': [1053292538, 1063144436, 1034046805],
      '29,31,31': [1064723150, 1064765294, 1064765209],
    };
    const t = makeToneTable(COMPLEX_TONE), n = COMPLEX_TONE.size;
    for (const [k, want] of Object.entries(game)) {
      const [x, y, z] = k.split(',').map(Number), o = ((z * n + y) * n + x) * 4;
      expect([bits(t[o]), bits(t[o + 1]), bits(t[o + 2])], k).toEqual(want);
    }
  });

  it('lens numbers equal the game lens step (FOV 1.71452 rad, render 1008 x 756)', () => {
    const L = lensConstants(1.71451998, 1008, 756);
    expect(bits(L.k)).toBe(1064596894);          // the step's own sin(atan(diag / f)), register r0.y (exact numbers)
    expect(L.a).toBe(Math.fround(1.200164));
    expect(L.diagW).toBe(1.25);
    expect(L.hw).toEqual([1, 0.75]);
  });
});
