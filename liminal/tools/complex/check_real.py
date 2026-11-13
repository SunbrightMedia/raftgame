#!/usr/bin/env python3
"""
The Complex camera against the REAL graphics card's own results (deep export, lossless), not only against the
emulator: for the steps whose every input the export kept, the picture the game's step actually read goes into
(1) the game's step run by dxbc.py and (2) our pass (complexCamera.ts, headless Chromium), and both are compared
with the picture the game's step actually wrote. Also our tone table against the 3D table the game drew.

    COMPLEX_DEEP=<deep export>/deep python3 tools/complex/check_real.py <first export frame dir>

Grain, tape and the tonemapper read the game's own image files (not exported), so they cannot be checked
against the real output this way.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_camera as C  # noqa: E402
import check_tone  # noqa: E402
import deep  # noqa: E402
import dxbc  # noqa: E402


def codes(a):
    """10-bit codes as the user's graphics card stores them: ties go down (0.5 -> 511, measured on posterize)."""
    x = np.clip(np.nan_to_num(a[..., :3]), 0, 1).astype(np.float32) * np.float32(1023)
    return np.ceil(x - np.float32(0.5)).astype(np.int32)


def compare(name, real, got):
    d = np.abs(codes(real) - codes(got))
    hist = {int(k): int(v) for k, v in zip(*np.unique(d, return_counts=True)) if k > 0}
    print(f'{name:34s} stored 10-bit values equal {100 * (d == 0).mean():9.5f} %   largest difference {int(d.max())}   others {hist}')


def main():
    fr = capture.Frame(sys.argv[1])
    if not fr.deep:
        sys.exit('set COMPLEX_DEEP to the deep export folder (holding complex_frame*)')
    dp = deep.Deep(fr.deep)
    # the steps by shader (the two exports number steps the same way)
    num = {name: fr.find(name)['index'] for name in ('ps_7952', 'ps_8881', 'ps_19321')}
    # 1. tone table: ours vs the 3D table the card drew
    real = dp.target(num['ps_7952'])
    ours = check_tone.our_table()
    compare('tone table vs the real one', real, ours)
    # 2. sharpen: real input (the tonemapper's output) -> real output (kept as the next step's input)
    src = dp.target(num['ps_8881'] - 1)
    out = dp.target(num['ps_19321'], 'input')
    H, W = src.shape[:2]
    st = fr.find('ps_8881'); cbs = fr.constants(st, 'ps'); cb1 = cbs[1].view(np.float32)
    emu = C.emu(fr.program('ps_8881'), W, H, cbs, {0: dxbc.Texture(src)}, {0: C.POINT})
    compare('sharpen: emulated game step', out, emu)
    ours = C.gpu('sharpen', W, H, {'t_src': (src, 'clamp')}, {**C.view_uniforms(cbs[0]), 'u_amount': cb1[1, 0], 'u_blend': cb1[1, 1],
                                                              'u_blendColor': cb1[2, :3]})
    compare('sharpen: ours', out, ours)
    # 3. posterize: real input -> real output
    src, out = dp.target(num['ps_19321'], 'input'), dp.target(num['ps_19321'])
    st = fr.find('ps_19321'); cbs = fr.constants(st, 'ps'); c = C.vals(cbs[1], 1)
    emu = C.emu(fr.program('ps_19321'), W, H, cbs, {0: dxbc.Texture(src)}, {0: C.POINT})
    compare('posterize: emulated game step', out, emu)
    ours = C.gpu('posterize', W, H, {'t_src': (src, 'clamp')}, {**C.view_uniforms(cbs[0]), 'u_blend': c[0], 'u_blendColor': c[1:4]})
    compare('posterize: ours', out, ours)


if __name__ == '__main__':
    main()
