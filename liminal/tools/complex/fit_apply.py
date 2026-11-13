#!/usr/bin/env python3
"""
The scene multiplier the game's glow step hands its tonemapper (a per-channel buffer; the first export could not
read it): fitted with the game's OWN tonemapper (ps_8878 in dxbc.py) on the game's own scene and glow pictures,
with our tone table (equal to the game's, check_tone.py), against the game's own tonemapper output.

    python3 tools/complex/fit_apply.py <capture frame dir> [...]

The pictures are JPEGs of the capture (scene stored linearly over 0..4.625, glow over 0..1): pixels near those
limits, and near white in the output, are left out. The lens dirt is the game's own image (not copied): its
measured mean (0.022) stands in, which leaves local errors but not a bias.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import dxbc  # noqa: E402
import check_camera as C  # noqa: E402

STEP = 3      # every 3rd pixel in each direction (speed)


def last_output(fr, shaders):
    hit = None
    for i in sorted(fr.steps):
        st = fr.steps[i]
        names = [os.path.basename(x)[:-4] for v in (st.get('shaders') or {}).values() for x in v]
        if any(s in names for s in shaders) and st.get('images'):
            hit = st
    return hit


def setup(frame_dir):
    fr = capture.Frame(frame_dir)
    st = fr.find('ps_8878')
    cbs = fr.constants(st, 'ps')
    c0 = cbs[0].view(np.float32)
    mb = last_output(fr, ('cs_9525', 'cs_9526', 'cs_9527', 'cs_9528'))
    bl = last_output(fr, ('cs_8862',))
    scene, (b0, w0) = fr.image(mb)
    bloom, (b1, w1) = fr.image(bl)
    out, _ = fr.image(st)
    scene = scene * (w0 - b0) + b0
    bloom = bloom * (w1 - b1) + b1
    H, W = out.shape[:2]
    # emulate only a grid of pixels: give the shader those pixels' interpolants
    ys, xs = np.mgrid[0:H:STEP, 0:W:STEP]
    fc = np.stack([xs.ravel() + 0.5, ys.ravel() + 0.5], 1).astype(np.float32)
    uv = (fc * c0[9, 2:4]).astype(np.float32)
    cpos = (uv.astype(np.float64) * [2, -2] + [-1, 1]).astype(np.float32)
    vig = np.array([1, 0.75], np.float32) * np.float32(np.sqrt(2) / np.sqrt(1 + 0.75 ** 2))
    inputs = {0: np.concatenate([uv, cpos * vig], 1), 1: np.concatenate([np.zeros_like(uv), uv + 0.37], 1),
              2: np.concatenate([cpos, np.zeros_like(cpos)], 1)}
    want = out[ys, xs].reshape(-1, 3)
    sc = scene[ys, xs].reshape(-1, 3)
    keep = (sc.max(1) < 0.95 * w0) & (want.max(1) < 0.97)
    # the bloom near its stored limit is clipped too
    bly = np.clip((uv[:, 1] * c0[33, 1] + c0[33, 3]) * bloom.shape[0], 0, bloom.shape[0] - 1).astype(int)
    blx = np.clip((uv[:, 0] * c0[33, 0] + c0[33, 2]) * bloom.shape[1], 0, bloom.shape[1] - 1).astype(int)
    keep &= bloom[bly, blx].max(1) < 0.95 * w1
    lut = C.our_tone_table()
    pre = np.float32(34.1333275)
    tex = {1: dxbc.Texture(C.rgba(scene * pre)), 2: dxbc.Texture(C.rgba(bloom * pre)),
           4: dxbc.Texture(np.full((8, 8, 4), 0.022, np.float32)), 5: dxbc.Texture(lut, dim=3),
           0: dxbc.Buffer(np.array([pre, 0, 0, 0], np.float32).view(np.uint32), stride=16)}
    return fr, cbs, tex, inputs, want, keep


def run(fr, cbs, tex, inputs, apply_):
    tex = dict(tex)
    tex[3] = dxbc.Buffer(np.array([*apply_, 1], np.float32).view(np.uint32), stride=16)
    n = len(inputs[0])
    m = dxbc.Machine(fr.program('ps_8878'), n)
    for k, v in cbs.items():
        m.cb[k] = v
    m.t = tex
    m.s = {0: C.CLAMP, 1: C.CLAMP, 2: C.CLAMP, 3: C.CLAMP}
    for k, v in inputs.items():
        m.V[k] = dxbc.f2u(np.asarray(v, np.float32))
    m.run()
    return dxbc.u2f(m.O[0])[:, :3]


def main():
    for frame_dir in sys.argv[1:]:
        fr, cbs, tex, inputs, want, keep = setup(frame_dir)
        err = lambda a: float(np.mean((run(fr, cbs, tex, inputs, a)[keep] - want[keep]) ** 2))   # noqa: E731
        a = np.array([0.84, 0.83, 0.64])
        best = err(a)
        for step in (0.08, 0.04, 0.02, 0.01, 0.005, 0.0025):
            improved = True
            while improved:
                improved = False
                for c in range(3):
                    for s in (step, -step):
                        b = a.copy()
                        b[c] += s
                        e = err(b)
                        if e < best:
                            a, best, improved = b, e, True
        got = run(fr, cbs, tex, inputs, a)[keep]
        print(f'{os.path.basename(frame_dir)}: scene multiplier {np.round(a, 4)}  rms {np.sqrt(best):.4f}  '
              f'mean ours {np.round(got.mean(0), 4)} game {np.round(want[keep].mean(0), 4)}  pixels {int(keep.sum())}')


if __name__ == '__main__':
    main()
