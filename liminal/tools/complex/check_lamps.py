#!/usr/bin/env python3
"""
The Complex's lamps: the game's own deferred-light step (ps_7913, every lamp of the frame) run by dxbc.py on the
game's own G-buffer and depth (deep export, lossless), summed, and compared with what the real graphics card
added (the scene light after the lamps minus before them). Proves the inputs and the lamps' numbers; our own lamp
code is then checked against the same step.

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_lamps.py <first export frame dir> [step] [--every N] [--save F]

Two engine textures the step reads (a 256 x 256 noise for contact-shadow dithering and a 66 x 64 table) were not
exported (they come from the game's files): zeros stand in, so contact-shadow edges may differ slightly.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import deep  # noqa: E402
import dxbc  # noqa: E402

POINT = dxbc.Sampler('point', ('clamp', 'clamp', 'clamp'))
LINEAR = dxbc.Sampler('linear', ('clamp', 'clamp', 'clamp'))


# GBufferC (base colour) is read through an sRGB view: the card turns it back to linear when the step reads it.
SRGB = {5}


def srgb_to_linear(c):
    c = np.asarray(c, np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def by_id(dp, step, rid):
    rec = [t for t in dp.targets if t['step'] == step and t['id'].endswith('::%d' % rid)][0]
    return deep.decode(dp.raw(rec), rec['format'], rec['w'], rec['h'], rec.get('depth', 1) or 1)


def lamp_inputs(fr, dp, step):
    st = fr.steps[step]
    reads = {r['binding']: r for v in st['reads']['ps'].values() for r in v}
    tex = {}
    gb_step = max(t['step'] for t in dp.targets if t['step'] < step and 'BasePass' in ' / '.join(t['markers']))
    for k in range(10):
        r = reads.get('texture%d' % k)
        rid = int(r['id'].split('::')[1]) if r else None
        try:
            a = by_id(dp, gb_step, rid)
            if k in SRGB:
                a = a.copy()
                a[..., :3] = srgb_to_linear(a[..., :3])
            tex[k] = dxbc.Texture(a)
        except (IndexError, TypeError):
            # not exported (the game's own files) or 1 x 1 defaults: white for the 1 x 1 ones, zeros otherwise
            w, h = (r['w'], r['h']) if r else (1, 1)
            tex[k] = dxbc.Texture(np.ones((h, w, 4), np.float32) if w * h == 1 else np.zeros((h, w, 4), np.float32))
    return tex


def run_lamps(fr, dp, step, every=1, draws=None):
    st = fr.steps[step]
    rec = fr._deep_steps()[step]
    prog = fr.program('ps_7913')
    tex = lamp_inputs(fr, dp, step)
    H, W = 756, 1344
    vw, vh = 1008, 756                         # the view rect (4:3 at 70 %)
    ys, xs = np.mgrid[0:vh:every, 0:vw:every]
    n = ys.size
    ndc = np.stack([(xs.ravel() + 0.5) / vw * 2 - 1, 1 - (ys.ravel() + 0.5) / vh * 2], 1).astype(np.float32)
    v0 = np.zeros((n, 4), np.float32); v0[:, :2] = ndc; v0[:, 3] = 1
    v1 = np.zeros((n, 4), np.float32); v1[:, 0] = xs.ravel() + 0.5; v1[:, 1] = ys.ravel() + 0.5
    total = np.zeros((n, 3), np.float64)
    per = []
    for j in (draws if draws is not None else range(len(rec['draws']))):
        cbs = fr.deep_constants(st, 'ps', draw=j)
        m = dxbc.Machine(prog, n)
        for k, v in cbs.items():
            m.cb[k] = v
        m.t = tex
        m.s = {0: LINEAR, 1: POINT, 2: POINT}
        m.V[0] = dxbc.f2u(v0)
        m.V[1] = dxbc.f2u(v1)
        m.run()
        o = dxbc.u2f(m.O[0])[:, :3].astype(np.float64)
        total += np.nan_to_num(o)
        per.append(o.sum(0))
    return total.reshape(ys.shape + (3,)), (ys, xs), per


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    dp = deep.Deep(fr.deep)
    step = int(args[1]) if len(args) > 1 else 374
    every = int(sys.argv[sys.argv.index('--every') + 1]) if '--every' in sys.argv else 1
    ours, (ys, xs), per = run_lamps(fr, dp, step, every)
    before = by_id(dp, 370, 47190)[..., :3]
    after = by_id(dp, step, 47190)[..., :3]
    real = (after - before)[ys, xs]
    d = ours - real
    print(f'lamps: {len(per)}; mean emulated {np.round(ours.reshape(-1, 3).mean(0), 5)}  real {np.round(real.reshape(-1, 3).mean(0), 5)}')
    rel = np.abs(d).sum(-1) / np.maximum(np.abs(real).sum(-1), 1e-3)
    print(f'per pixel |emulated - real| / real: median {np.median(rel):.4f}  p90 {np.percentile(rel, 90):.4f}  p99 {np.percentile(rel, 99):.4f}')
    if '--save' in sys.argv:
        np.save(sys.argv[sys.argv.index('--save') + 1], np.stack([ours, real]))


if __name__ == '__main__':
    main()
