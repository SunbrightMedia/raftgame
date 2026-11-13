#!/usr/bin/env python3
"""
The Complex camera's tone table: ours (src/engine/render/complexTone.ts) vs the game's own CombineLUTs step
(shader ps_7952 of the capture), run by dxbc.py on the same 32 x 32 x 32 cells with the capture's constants.

    python3 tools/complex/check_tone.py <capture frame dir> [--exact-bytes DIR]

Prints how many float values are bit-identical and how many of the stored 10-bit values differ, twice: with
numpy's float32 exp2/log2 in the emulator (like a GPU, they can be off in the last bit) and with exactly rounded
ones (as our code computes them). Equal in the second run = the same maths.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import dxbc  # noqa: E402


def game_table(frame_dir, exact_math):
    fr = capture.Frame(frame_dir)
    step = fr.find('ps_7952')
    p = fr.program('ps_7952')
    n = 32
    z, y, x = np.mgrid[0:n, 0:n, 0:n]
    m = dxbc.Machine(p, n ** 3, exact_math=exact_math)
    for k, v in fr.constants(step, 'ps').items():
        m.cb[k] = v
    uv = np.zeros((n ** 3, 4), np.float32)
    uv[:, 0] = (x.ravel() + 0.5) / n
    uv[:, 1] = (y.ravel() + 0.5) / n
    lay = np.zeros((n ** 3, 4), np.uint32)
    lay[:, 0] = z.ravel()
    m.V[0] = dxbc.f2u(uv)      # the interpolated UV (the volume pass draws a full-slice quad)
    m.V[2] = lay               # SV_RenderTargetArrayIndex: the slice
    m.run()
    return dxbc.u2f(m.O[0]).reshape(n, n, n, 4)[..., :3]


def our_table():
    root = os.path.dirname(os.path.dirname(HERE))
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, 'ours.f32')
        subprocess.run(['npx', 'vite-node', 'tools/complex/dump_tone.ts', '--', out], cwd=root, check=True, capture_output=True)
        return np.fromfile(out, np.float32).reshape(32, 32, 32, 4)[..., :3]


def main():
    frame_dir = sys.argv[1]
    ours = our_table()
    q = lambda a: np.rint(np.clip(a, 0, 1) * 1023).astype(int)   # noqa: E731 (R10G10B10A2 storage)
    for exact in (False, True):
        game = game_table(frame_dir, exact)
        d = np.abs(ours.astype(np.float64) - game)
        print('%-34s floats identical %8.4f %%, max |diff| %.3g, stored 10-bit values differing %d of %d' % (
            'game step, ' + ('exactly rounded exp2/log2' if exact else 'float32 exp2/log2 (GPU-like)'),
            100 * (ours == game).mean(), d.max(), (q(ours) != q(game)).sum(), ours.size))


if __name__ == '__main__':
    main()
