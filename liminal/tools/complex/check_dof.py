#!/usr/bin/env python3
"""
The Complex's depth of field: the game's own steps run in the emulator (dxbc.py) on the deep export's inputs, in
order, each fed the previous step's emulated output; our port (src/engine/render/complexDOF.ts, in headless Chromium
via run_camera.cjs + dof_page.ts) on the same inputs; each step compared; and the emulated chain's last picture
compared with the card's own (the upscaler's input, 19595).

The game's temporal step needs last frame's picture, which the export did not save: both run it as a camera cut
(the new frame alone), so the last comparison shows how much that history matters. Only the steps that run with
the game's settings are here (see complexDOF.ts): the near-field gathers, bokeh sprites and translucency are empty.

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_dof.py <first export frame dir>
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_lamps as CL  # noqa: E402
import check_mb as M  # noqa: E402
import deep  # noqa: E402
import dxbc  # noqa: E402

POINT = dxbc.Sampler('point', ('clamp', 'clamp', 'clamp'))
LINEAR = dxbc.Sampler('linear', ('clamp', 'clamp', 'clamp'), weight_bits=8)   # the card's: 8-bit filter weights


def h16(a):
    """The card's half-float store: toward zero, sign kept."""
    a = np.clip(np.asarray(a, np.float32), -65504, 65504)
    n = (a.view(np.uint32) & np.uint32(0xffffe000)).view(np.float32)
    s = (np.trunc(a.astype(np.float64) * 2.0 ** 24) / 2.0 ** 24).astype(np.float32)
    return np.where(np.abs(a) >= 2.0 ** -14, n, s).astype(np.float32)


def cbs_of(fr, idx):
    return {k: np.asarray(v, np.uint32).reshape(-1, 4).copy() for k, v in fr.deep_constants(fr.steps[idx], 'cs').items()}


def tex(shape):
    return dxbc.Texture(np.zeros(shape + (4,), np.float32))


def emulate(fr, dp):
    """The game's steps, in order. Returns the inputs, each step's picture and the constants used."""
    idx = {k: fr.find(s)['index'] for k, s in (('setup', 'cs_8836'), ('taa', 'cs_8837'), ('flatten', 'cs_19313'), ('dilate', 'cs_19314'),
                                               ('reduce', 'cs_19315'), ('slight', 'cs_8849'), ('recombine', 'cs_19317'))}
    ls = dp.light_steps()
    scene = CL.by_id(dp, ls['fog'], ls['scene']).astype(np.float32)
    gb = max(t['step'] for t in dp.targets if 'BasePass' in ' / '.join(t['markers']))
    ds = CL.by_id(dp, gb, 19356).astype(np.float32)
    depth = np.zeros(ds.shape[:2] + (4,), np.float32); depth[..., 0] = ds[..., 0]; depth[..., 1] = ds[..., 1]
    st_taa = fr.steps[idx['taa']]
    reads = {r['binding']: int(r['id'].split('::')[1]) for v in st_taa['reads']['cs'].values() for r in v}
    has_vel = any(t['id'].endswith('::%d' % reads['texture3']) for t in dp.targets)
    vel = M.picture(dp, reads['texture3']) if has_vel else np.zeros((1, 1, 4), np.float32)
    try:
        eye = np.frombuffer(dp.buffer(reads['structuredbuffer0']), np.uint32)[:4].copy()
    except Exception:
        eye = np.array([34.133327, 34.133327, 1, 32768], np.float32).view(np.uint32)
    stencil_u = np.zeros(ds.shape[:2] + (4,), np.uint32); stencil_u[..., 1] = ds[..., 1].astype(np.uint32)
    H, W = scene.shape[:2]
    E = {}
    # 1. setup
    full, half = tex((H, W)), tex((H // 2, W // 2))
    dxbc.run_compute(fr.program('cs_8836'), (63, 48, 1), cbs_of(fr, idx['setup']), textures={0: dxbc.Texture(scene), 1: dxbc.Texture(depth)},
                     samplers={0: LINEAR}, uavs={0: full, 1: half})
    E['full'], E['half'] = h16(full.levels[0]), h16(half.levels[0])
    # 2. its temporal step, as a camera cut
    c = cbs_of(fr, idx['taa'])
    c[0] = c[0].reshape(-1, 4)
    c[0][3, 0] = 1
    taa = tex((540, 720))
    dxbc.run_compute(fr.program('cs_8837'), (90, 68, 1), c, textures={0: dxbc.Buffer(eye, stride=16), 1: dxbc.Texture(E['half']), 2: dxbc.Texture(depth),
                     3: dxbc.Texture(vel), 4: dxbc.Texture(stencil_u, int_=True), 5: dxbc.Texture(np.zeros((540, 720, 4), np.float32))},
                     samplers={0: POINT, 1: POINT, 2: LINEAR}, uavs={0: taa})
    E['taa'] = h16(taa.levels[0])
    # 3, 4. tiles
    near, far = tex((68, 90)), tex((68, 90))
    dxbc.run_compute(fr.program('cs_19313'), (63, 48, 1), cbs_of(fr, idx['flatten']), textures={0: dxbc.Texture(E['taa'])}, samplers={0: POINT}, uavs={0: near, 1: far})
    E['tiles'], E['tiles2'] = h16(near.levels[0]), h16(far.levels[0])
    near2, far2 = tex((68, 90)), tex((68, 90))
    dxbc.run_compute(fr.program('cs_19314'), (8, 6, 1), cbs_of(fr, idx['dilate']), textures={0: dxbc.Texture(E['tiles']), 1: dxbc.Texture(E['tiles2'])}, uavs={0: near2, 1: far2})
    E['dilated'], E['dilated2'] = h16(near2.levels[0]), h16(far2.levels[0])
    # 5. reduce (level 0 is what the gather reads)
    mip0, mip1 = tex((544, 720)), tex((272, 360))
    dxbc.run_compute(fr.program('cs_19315'), (90, 68, 1), cbs_of(fr, idx['reduce']),
                     textures={0: dxbc.Buffer(eye, stride=16), 1: dxbc.Texture(E['taa']), 2: dxbc.Texture(np.zeros((270, 360, 4), np.float32))},
                     samplers={0: LINEAR}, uavs={0: mip0, 1: mip1, 2: dxbc.Buffer(np.zeros(16, np.uint32)), 3: dxbc.Buffer(np.zeros(4096, np.uint32), stride=16)})
    E['reduce'] = h16(mip0.levels[0])
    # 6. the slightly-out-of-focus gather
    slight = tex((H // 2, W // 2))
    dxbc.run_compute(fr.program('cs_8849'), (63, 48, 1), cbs_of(fr, idx['slight']),
                     textures={0: dxbc.Texture(E['reduce']), 1: dxbc.Texture(E['dilated']), 2: dxbc.Texture(E['dilated2'])}, samplers={0: LINEAR}, uavs={0: slight})
    E['slight'] = h16(slight.levels[0])
    # 7. recombine (the near, background and translucency layers empty)
    out = tex((H, W))
    trans = np.zeros((H, W, 4), np.float32); trans[..., 3] = 1
    bg = np.zeros((H // 2, W // 2, 4), np.float32); bg[..., 3] = 1
    dxbc.run_compute(fr.program('cs_19317'), (126, 95, 1), cbs_of(fr, idx['recombine']),
                     textures={0: dxbc.Texture(E['full']), 1: dxbc.Texture(depth), 2: dxbc.Texture(depth), 3: dxbc.Texture(trans), 4: dxbc.Texture(np.ones((1, 1, 4), np.float32)),
                               5: dxbc.Texture(np.zeros((H // 2, W // 2, 4), np.float32)), 6: dxbc.Texture(bg), 7: dxbc.Texture(E['slight'])},
                     samplers={0: LINEAR, 1: LINEAR}, uavs={0: out})
    E['out'] = h16(out.levels[0])
    # what ours needs
    cs = {k: {kk: np.asarray(v, np.uint32) for kk, v in fr.deep_constants(fr.steps[idx[k]], 'cs').items()} for k in ('setup', 'taa')}
    f0 = cs['setup'][0].view(np.float32).reshape(-1, 4); f1 = cs['setup'][1].view(np.float32).reshape(-1, 4)
    t0 = cs['taa'][0].view(np.float32).reshape(-1, 4); t1 = cs['taa'][1].view(np.float32).reshape(-1, 4)
    params = dict(inW=int(f1[129][0]) if f1[129][0] > 0 else 1008, inH=int(f1[129][1]) if f1[129][1] > 0 else 756, bufW=W, bufH=H, outW=1440, outH=1080,
                  depthMap=[1, 0, 0, 0], zToCm=f1[71].tolist(), focus=float(f1[155][1]), cocInf=float(f0[1][0]), cocMax=float(f0[1][2]),
                  jitter=[float(t0[27][2]) * 2, float(t0[27][3]) * 2], c2p=[t1[117 + k].tolist() for k in range(4)], cut=True,
                  frame=int(cs['taa'][1].reshape(-1, 4)[145][0]), exposure=float(np.float32(eye.view(np.float32)[0]) * np.float32(t1[136][2])))
    stencil_f = np.zeros(ds.shape[:2] + (4,), np.float32); stencil_f[..., 0] = ds[..., 1]
    inputs = dict(scene=scene, depth=depth, vel=vel, stencil=stencil_f, histIn=np.zeros((540, 720, 4), np.float32))
    return inputs, E, params


def compare(name, a, b, region=None):
    if region is not None:
        a, b = a[region], b[region]
    a, b = a[..., :4], b[..., :4]
    d = np.abs(a - b)
    rel = d / np.maximum(np.abs(b), 1e-6)
    print(f'{name:10s}: values equal {100 * (d == 0).mean():7.3f} %, within 1e-3 {100 * (rel <= 1e-3).mean():7.3f} %; max |diff| {d.max():.3e};'
          f' mean ours {np.round(a.reshape(-1, 4).mean(0), 5)} emulated {np.round(b.reshape(-1, 4).mean(0), 5)}')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    dp = deep.Deep(fr.deep)
    inputs, E, params = emulate(fr, dp)
    taa_step = fr.find('cs_19050')
    rid = int([r for v in taa_step['reads']['cs'].values() for r in v if r['binding'] == 'texture1'][0]['id'].split('::')[1])
    real = M.picture(dp, rid, taa_step['index'])
    iw, ih = params['inW'], params['inH']
    view = (slice(0, ih), slice(0, iw))
    d = np.abs(E['out'][view][..., :3] - real[view][..., :3])
    sc = inputs['scene'][view][..., :3]
    print(f'emulated game chain vs the card (19595): values equal {100 * (d == 0).mean():.2f} %, within 1e-3 rel {100 * (d / np.maximum(real[view][..., :3], 1e-6) <= 1e-3).mean():.2f} %;'
          f' the card changed {100 * (np.abs(real[view][..., :3] - sc).max(-1) > 0).mean():.1f} % of pixels from its input, the emulated chain {100 * (np.abs(E["out"][view][..., :3] - sc).max(-1) > 0).mean():.1f} %')
    ours = M.run_ours(inputs, params) if False else None
    import json, tempfile, subprocess, base64  # noqa: E401
    with tempfile.TemporaryDirectory() as td:
        job = {'textures': {}, 'params': params}
        for name, a in inputs.items():
            f = os.path.join(td, name + '.f32')
            np.ascontiguousarray(a, np.float32).tofile(f)
            job['textures'][name] = {'w': a.shape[1], 'h': a.shape[0], 'file': f}
        jf, of = os.path.join(td, 'job.json'), os.path.join(td, 'out.json')
        json.dump(job, open(jf, 'w'))
        r = subprocess.run(['node', os.path.join(HERE, 'run_camera.cjs'), jf, of, 'dof_page.ts'], cwd=os.path.join(HERE, '..', '..'), capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stdout + r.stderr)
        res = json.load(open(of))
    ours = {k: np.frombuffer(base64.b64decode(v['data']), np.float32).reshape(v['h'], v['w'], 4) for k, v in res['out'].items()}
    hv = (slice(0, ih // 2), slice(0, iw // 2))
    tl = (slice(0, (ih // 2 + 7) // 8), slice(0, (iw // 2 + 7) // 8))
    compare('full', ours['full'], E['full'], view)
    compare('half', ours['half'], E['half'], hv)
    compare('taa', ours['taaB'] if 'taaB' in ours else ours['taaA'], E['taa'])
    compare('tiles', ours['tiles'], E['tiles'], tl)
    compare('tiles2', ours['tiles2'], E['tiles2'], tl)
    compare('dilated', ours['dilated'], E['dilated'], tl)
    compare('dilated2', ours['dilated2'], E['dilated2'], tl)
    compare('reduce', ours['reduce'], E['reduce'])
    compare('slight', ours['slight'], E['slight'], hv)
    compare('out', ours['out'], E['out'], view)
    d = np.abs(ours['out'][view][..., :3] - real[view][..., :3])
    print(f'ours vs the card: values equal {100 * (d == 0).mean():.2f} %, within 1e-3 rel {100 * (d / np.maximum(real[view][..., :3], 1e-6) <= 1e-3).mean():.2f} %')
    if '--save' in sys.argv:
        np.savez_compressed(sys.argv[sys.argv.index('--save') + 1], **{'e_' + k: v for k, v in E.items()}, **{'o_' + k: v for k, v in ours.items()}, real=real, scene=inputs['scene'])


if __name__ == '__main__':
    main()
