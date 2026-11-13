#!/usr/bin/env python3
"""
The Complex's temporal upscaler (Unreal's TAAU, compute shader cs_19050: 1008 x 756 -> 1440 x 1080), run by
dxbc.py on the exact inputs the real card used (deep export: the frame, its depth and stencil, its motion vectors,
the previous frame's output, the exposure), and compared with what the card wrote. Then our own GLSL port
(src/engine/render/complexTAA.ts) against the same step, on the same inputs.

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_taa.py <first export frame dir> [--ours] [--save F]
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_lamps as CL  # noqa: E402
import deep  # noqa: E402
import dxbc  # noqa: E402

POINT = dxbc.Sampler('point', ('clamp', 'clamp', 'clamp'))
LINEAR = dxbc.Sampler('linear', ('clamp', 'clamp', 'clamp'))


def inputs(fr, dp):
    st = fr.find('cs_19050')
    step = st['index']
    reads = {r['binding']: r for v in st['reads']['cs'].values() for r in v}
    rid = lambda b: int(reads[b]['id'].split('::')[1])   # noqa: E731
    def pic(b, role='input'):
        recs = [t for t in dp.targets if t['id'].endswith('::%d' % rid(b)) and t['step'] <= step]
        recs = [t for t in recs if t['step'] == step and t['role'] == role] or recs
        r = recs[-1]
        return deep.decode(dp.raw(r), r['format'], r['w'], r['h'])
    scene = pic('texture1')
    gb = max(t['step'] for t in dp.targets if 'BasePass' in ' / '.join(t['markers']))
    ds = CL.by_id(dp, gb, rid('texture2'))
    velocity = pic('texture3')
    history = pic('texture5')
    stencil = np.zeros(ds.shape[:2] + (4,), np.uint32)
    stencil[..., 1] = ds[..., 1].astype(np.uint32)
    eye = np.frombuffer(dp.buffer(int(reads['structuredbuffer0']['id'].split('::')[1])), np.uint32)[:4].copy()
    out = [t for t in dp.targets if t['step'] == step and t['role'] == 'output'][0]
    real = deep.decode(dp.raw(out), out['format'], out['w'], out['h'])
    return st, dict(scene=scene, depth=ds, velocity=velocity, history=history, stencil=stencil, eye=eye), real


def run_game(fr, st, x, shape):
    cbs = fr.deep_constants(st, 'cs')
    H, W = shape
    out = dxbc.Texture(np.zeros((H, W, 4), np.float32), fmt='R16G16B16A16_FLOAT')
    tex = {0: dxbc.Buffer(x['eye'], stride=16), 1: dxbc.Texture(x['scene']), 2: dxbc.Texture(x['depth']),
           3: dxbc.Texture(x['velocity']), 4: dxbc.Texture(x['stencil'], int_=True), 5: dxbc.Texture(x['history'])}
    dxbc.run_compute(fr.program('cs_19050'), ((W + 7) // 8, (H + 7) // 8, 1), cbs, textures=tex,
                     samplers={0: POINT, 1: POINT, 2: LINEAR}, uavs={0: out})
    return out.levels[0]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    dp = deep.Deep(fr.deep)
    st, x, real = inputs(fr, dp)
    game = run_game(fr, st, x, real.shape[:2])
    d = np.abs(game[..., :3] - real[..., :3])
    rel = d.sum(-1) / np.maximum(real[..., :3].sum(-1), 1e-4)
    print(f'TAAU emulated vs real: mean {np.round(game[..., :3].reshape(-1, 3).mean(0), 5)} vs {np.round(real[..., :3].reshape(-1, 3).mean(0), 5)};'
          f' equal {100 * (d.max(-1) == 0).mean():.3f} %, per pixel relative difference median {np.median(rel):.2e} p99 {np.percentile(rel, 99):.2e} max {rel.max():.2e}')
    if '--save' in sys.argv:
        np.save(sys.argv[sys.argv.index('--save') + 1], game)


if __name__ == '__main__':
    main()
