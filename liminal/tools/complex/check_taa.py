#!/usr/bin/env python3
"""
The Complex's temporal upscaler (Unreal's TAAU, compute shader cs_19050: 1008 x 756 -> 1440 x 1080), run by
dxbc.py on the exact inputs the real card used (deep export: the frame, its depth and stencil, its motion vectors,
the previous frame's output, the exposure), and compared with what the card wrote. Then our own GLSL port
(src/engine/render/complexTAA.ts) against the same step, on the same inputs.

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_taa.py <first export frame dir> [--ours] [--save F | --emulated F | --no-emu] [--save-ours F]
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_camera as CC  # noqa: E402
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
    # no moving things drawn: the game binds a 1 x 1 black stand-in for the motion vectors, not saved by the export
    has = lambda b: any(t['id'].endswith('::%d' % rid(b)) for t in dp.targets)   # noqa: E731
    velocity = pic('texture3') if has('texture3') else np.zeros((1, 1, 4), np.float32)
    history = pic('texture5')
    stencil = np.zeros(ds.shape[:2] + (4,), np.uint32)
    stencil[..., 1] = ds[..., 1].astype(np.uint32)
    try:
        eye = np.frombuffer(dp.buffer(int(reads['structuredbuffer0']['id'].split('::')[1])), np.uint32)[:4].copy()
    except Exception:   # not saved for this frame: the game's fixed exposure (frame 18325's buffer)
        eye = np.array([34.133327, 34.133327, 1, 32768], np.float32).view(np.uint32)
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


def our_uniforms(fr, st, x):
    """Our port's uniforms (complexTAA.ts) from the game's constants for this step."""
    cbs = fr.deep_constants(st, 'cs')
    f = lambda c: np.asarray(c, dtype=np.uint32).view(np.float32).reshape(-1, 4)   # noqa: E731
    u = lambda c: np.asarray(c, dtype=np.uint32).reshape(-1, 4)                    # noqa: E731
    cb0, cb1, cb0u, cb1u = f(cbs[0]), f(cbs[1]), u(cbs[0]), u(cbs[1])
    eye = x['eye'].view(np.float32)
    return {
        'u_out': cb0[11], 'u_in': cb0[26], 'u_inMin': cb0[27], 'u_buf': cb0[9], 'u_bufUV': cb0[0],
        'u_inClamp': cb0u[10].astype(np.float32), 'u_hist': cb0[14], 'u_histClamp': cb0[15], 'u_toHist': cb0[16],
        'u_resp': cb0[2], 'u_dither': cb0[13],
        'u_misc': [1.0 if cb0u[3][0] else 0.0, cb0[28][0], cb0[28][1], float(cb1u[145][0])],
        'u_c2p0': cb1[117], 'u_c2p1': cb1[118], 'u_c2p2': cb1[119], 'u_c2p3': cb1[120],
        'u_depthMap': [1, 0, 0, 0], 'u_exposure': np.float32(eye[0]) * np.float32(cb1[136][2]),
    }


def run_ours(fr, st, x, shape):
    H, W = shape
    stencil = np.zeros(x['stencil'].shape, np.float32)
    stencil[..., 0] = x['stencil'][..., 1]
    tex = {'t_scene': (x['scene'], 'clamp'), 't_depth': (x['depth'], 'clamp'), 't_vel': (x['velocity'], 'clamp'),
           't_stencil': (stencil, 'clamp'), 't_hist': (x['history'], 'clamp')}
    out = CC.gpu('taa', W, H, tex, our_uniforms(fr, st, x))
    assert np.array_equal(out, out.astype(np.float16).astype(np.float32)), 'our output should be half floats already'
    return out


def compare(name, a, b):
    d = np.abs(a[..., :3] - b[..., :3])
    rel = d.sum(-1) / np.maximum(b[..., :3].sum(-1), 1e-4)
    print(f'{name}: mean {np.round(a[..., :3].reshape(-1, 3).mean(0), 5)} vs {np.round(b[..., :3].reshape(-1, 3).mean(0), 5)};'
          f' equal {100 * (d.max(-1) == 0).mean():.3f} %, per pixel relative difference median {np.median(rel):.2e}'
          f' p99 {np.percentile(rel, 99):.2e} p99.9 {np.percentile(rel, 99.9):.2e} max {rel.max():.2e}; alpha equal {100 * (a[..., 3] == b[..., 3]).mean():.3f} %')
    return rel


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    dp = deep.Deep(fr.deep)
    st, x, real = inputs(fr, dp)
    # --emulated F: the emulator's output saved by an earlier --save (it takes minutes to run); --no-emu: only ours
    game = None
    if '--emulated' in sys.argv:
        game = np.load(sys.argv[sys.argv.index('--emulated') + 1])
    elif '--no-emu' not in sys.argv:
        game = run_game(fr, st, x, real.shape[:2])
    if game is not None:
        compare('TAAU emulated vs real', game, real)
    if '--save' in sys.argv and game is not None:
        np.save(sys.argv[sys.argv.index('--save') + 1], game)
    if '--ours' in sys.argv:
        ours = run_ours(fr, st, x, real.shape[:2])
        if game is not None:
            compare('ours vs emulated', ours, game)
        rel = compare('ours vs real', ours, real)
        if '--save-ours' in sys.argv:
            np.save(sys.argv[sys.argv.index('--save-ours') + 1], ours)
        d = (ours[..., :3].astype(np.float16).view(np.int16).astype(np.int32) - real[..., :3].astype(np.float16).view(np.int16).astype(np.int32))
        print('  ours - real in half-float steps: ' + ', '.join(f'{k}: {100 * (d == k).mean():.2f} %' for k in (-2, -1, 0, 1, 2))
              + f', further: {100 * (np.abs(d) > 2).mean():.3f} %')
        ys, xs = np.unravel_index(np.argsort(rel.ravel())[-5:], rel.shape)
        for yy, xx in zip(ys, xs):
            print(f'  worst ({xx}, {yy}): ours {ours[yy, xx]} real {real[yy, xx]}' + ('' if game is None else f' emulated {game[yy, xx]}'))


if __name__ == '__main__':
    main()
