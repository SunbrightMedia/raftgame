// The Complex camera's own-code pieces against numbers from the game's compiled steps (run by
// tools/complex/dxbc.py on the user's capture, frame 18325; the full checks are tools/complex/check_*.py).
import { describe, expect, it } from 'vitest';
import { makeToneTable, COMPLEX_TONE } from '../src/engine/render/complexTone';
import { lensConstants } from '../src/engine/render/complexCamera';

const bits = (x: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, x); return b.getUint32(0); };

describe('complex camera', () => {
  it('tone table cells equal the game CombineLUTs step to the last bit', () => {
    // float32 bit patterns of the game's step (exactly rounded exp2/log2), cell "r,g,b" -> RGB
    const game: Record<string, number[]> = {
      '0,0,0': [0, 0, 0],
      '16,16,16': [1059635961, 1059635905, 1059635944],
      '31,31,31': [1064765013, 1064764914, 1064764964],
      '31,0,0': [1065561871, 1063501826, 1059228235],
      '0,31,0': [1064349075, 1064899093, 1063750843],
      '0,0,31': [1063062867, 1064259119, 1064813667],
      '7,19,6': [1036390402, 1063195457, 1038175243],
      '12,19,5': [1053292441, 1063144423, 1034045977],
      '29,31,31': [1064723154, 1064765291, 1064765211],
    };
    const t = makeToneTable(COMPLEX_TONE), n = COMPLEX_TONE.size;
    for (const [k, want] of Object.entries(game)) {
      const [x, y, z] = k.split(',').map(Number), o = ((z * n + y) * n + x) * 4;
      expect([bits(t[o]), bits(t[o + 1]), bits(t[o + 2])], k).toEqual(want);
    }
  });

  it('lens numbers equal the game lens step (FOV 1.71452 rad, render 1008 x 756)', () => {
    const L = lensConstants(1.71451998, 1008, 756);
    expect(bits(L.k)).toBe(bits(0.9549195));     // the step's own sin(atan(diag / f)), register r0.y
    expect(L.a).toBe(Math.fround(1.200164));
    expect(L.diagW).toBe(1.25);
    expect(L.hw).toEqual([1, 0.75]);
  });
});
