#!/usr/bin/env python3
"""
The Complex's motion blur: our own port (src/engine/render/complexMotionBlur.ts, run in headless Chromium by
run_camera.cjs + mb_page.ts) on the game's own inputs from the deep export (the depth and motion vectors the card
used, the upscaler's output, the frame's constants), compared step by step with what the card wrote: the motion per
pixel (48017), the tiles (48020), the scattered tiles (48025) and the blurred picture (48034).

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/check_mb.py <first export frame dir> [--depth LESS,GREATER] [--uneven]
"""
import ast
import base64
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_lamps as CL  # noqa: E402
import deep  # noqa: E402


def blocks(fr, marker):
    st = fr._deep_steps()
    for i, r in sorted(st.items()):
        mk = ' / '.join(r['markers']) if isinstance(r['markers'], list) else r['markers']
        if marker in mk:
            d = r['draws'] if isinstance(r['draws'], list) else ast.literal_eval(r['draws'])
            out = []
            for b in d[0].get('cs_blocks', []) + d[0].get('vs_blocks', []):
                u = np.asarray(b['u'], np.uint32) if 'u' in b else np.array(b['f'], np.float32).view(np.uint32)
                out.append(u)
            return i, out
    raise KeyError(marker)


def picture(dp, rid, step=None):
    recs = [t for t in dp.targets if t['id'].endswith('::%d' % rid) and (step is None or t['step'] == step)]
    r = recs[-1]
    return deep.decode(dp.raw(r), r['format'], r['w'], r['h'])


def inputs(fr, dp):
    i_flat, (cbf, cb1) = blocks(fr, 'Velocity Flatten')
    f0, f1 = cbf.view(np.float32).reshape(-1, 4), cb1.view(np.float32).reshape(-1, 4)
    st = fr.steps[i_flat]
    reads = {r['binding']: int(r['id'].split('::')[1]) for v in st['reads']['cs'].values() for r in v}
    gb = max(t['step'] for t in dp.targets if 'BasePass' in ' / '.join(t['markers']))
    depth = CL.by_id(dp, gb, reads['texture1']).astype(np.float32)
    depth[..., 1:] = 0
    has_vel = any(t['id'].endswith('::%d' % reads['texture0']) for t in dp.targets)
    vel = picture(dp, reads['texture0']) if has_vel else np.zeros((1, 1, 4), np.float32)
    i_filt, (cbq,) = blocks(fr, 'FullResFilter')
    q = cbq.view(np.float32).reshape(-1, 4)
    sf = fr.steps[i_filt]
    sread = {r['binding']: int(r['id'].split('::')[1]) for v in sf['reads']['cs'].values() for r in v}
    scene = picture(dp, sread['texture1'])
    out_id = [o for o in sf['outputs'] if o['w'] == 1440][0]['id']
    game = {'flat': picture(dp, 48017), 'tiles': picture(dp, 48020), 'dilated': picture(dp, 48025),
            'out': picture(dp, int(out_id.split('::')[1]))}
    params = dict(inW=int(f0[4][0]), inH=int(f0[4][1]), bufW=int(q[7][0]), bufH=int(q[7][1]), outW=int(q[0][0]), outH=int(q[0][1]),
                  c2p=[f1[117 + k].tolist() for k in range(4)], depthMap=[1, 0, 0, 0], zToCm=f1[71].tolist(),
                  shutter=float(f0[8][0] / (0.5 * q[0][0])), maxBlur=float(f0[8][2]), maxSamples=int(q[22].view(np.uint32)[0]))
    return dict(scene=scene, depth=depth, vel=vel), params, game


def run_ours(tex, params, depth_funcs=None):
    with tempfile.TemporaryDirectory() as td:
        job = {'textures': {}, 'params': params}
        if depth_funcs:
            job['scatterDepth'] = depth_funcs
        for name, a in tex.items():
            a = np.ascontiguousarray(a, np.float32)
            f = os.path.join(td, name + '.f32')
            a.tofile(f)
            job['textures'][name] = {'w': a.shape[1], 'h': a.shape[0], 'file': f}
        jf, of = os.path.join(td, 'job.json'), os.path.join(td, 'out.json')
        json.dump(job, open(jf, 'w'))
        r = subprocess.run(['node', os.path.join(HERE, 'run_camera.cjs'), jf, of, 'mb_page.ts'], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stdout + r.stderr)
        res = json.load(open(of))
    return {k: np.frombuffer(base64.b64decode(v['data']), np.float32).reshape(v['h'], v['w'], 4) for k, v in res['out'].items()}


def report(name, ours, game, chans, region=None):
    o, g = ours[..., chans], game[..., chans]
    if region is not None:
        o, g = o[region], g[region]
    d = np.abs(o - g)
    rel = d / np.maximum(np.abs(g), 1e-6)
    print(f'{name:8s}: values equal {100 * (d == 0).mean():7.3f} %, pixels equal {100 * (d.max(-1) == 0).mean():7.3f} %;'
          f' relative difference p99 {np.percentile(rel, 99):.2e} max {rel.max():.2e}; mean ours {np.round(o.reshape(-1, len(chans)).mean(0), 5)} game {np.round(g.reshape(-1, len(chans)).mean(0), 5)}')


def r11_down(v):
    """The card's R11G11B10 store: toward zero (as measured), negatives to 0."""
    v = np.minimum(np.maximum(np.asarray(v, np.float32), 0), np.array([65024, 65024, 64512], np.float32)[:v.shape[-1]])
    masks = np.array([0xfffe0000, 0xfffe0000, 0xfffc0000], np.uint32)[:v.shape[-1]]
    n = (v.view(np.uint32) & masks).view(np.float32)
    sub = np.floor(v * np.array([2.0 ** 20, 2.0 ** 20, 2.0 ** 19])[:v.shape[-1]]) / np.array([2.0 ** 20, 2.0 ** 20, 2.0 ** 19])[:v.shape[-1]]
    return np.where(v >= 2.0 ** -14, n, sub).astype(np.float32)


def check_uneven(fr, dp, tex, params, game, n_tiles=300, seed=1):
    """The uneven filter (cs_9528) does not run in the deep frames. Here: the game's own compiled step in the
    emulator against ours, on a made-up motion picture (the game's, with near things moving 30x faster), on tiles
    our kind step calls uneven."""
    import dxbc
    flat = game['flat'].copy()
    near = flat[..., 2] < 400.0
    flat[..., 0] = np.where(near, flat[..., 0] * 30.0, flat[..., 0])
    flat[..., :3] = r11_down(flat[..., :3])
    # its tiles: shortest and longest per 16 x 16 input pixels (no scatter: the filter reads these)
    ih, iw = params['inH'], params['inW']
    th, tw = (ih + 15) // 16, (iw + 15) // 16
    ln = np.zeros((th * 16, tw * 16), np.float32); an = np.zeros_like(ln)
    ln[:ih, :iw] = flat[:ih, :iw, 0]; an[:ih, :iw] = (flat[:ih, :iw, 1] - 0.5) * 2 * np.pi
    ln[ih:], an[ih:] = ln[ih - 1], an[ih - 1]
    L = ln.reshape(th, 16, tw, 16).transpose(0, 2, 1, 3).reshape(th, tw, 256)
    A = an.reshape(th, 16, tw, 16).transpose(0, 2, 1, 3).reshape(th, tw, 256)
    i_mx, i_mn = L.argmax(-1)[..., None], L.argmin(-1)[..., None]
    pick = lambda a, i: np.take_along_axis(a, i, -1)[..., 0]   # noqa: E731
    lx, ax, lm, am = pick(L, i_mx), pick(A, i_mx), pick(L, i_mn), pick(A, i_mn)
    tiles = np.stack([lm * np.cos(am), lm * np.sin(am), lx * np.cos(ax), lx * np.sin(ax)], -1).astype(np.float16).astype(np.float32)
    ours = run_ours({**tex, 'flatIn': flat, 'dilatedIn': tiles, 'tilesIn': tiles}, params)
    kind = ours['class'][..., 0]
    cand = np.argwhere(kind == 3)
    rng = np.random.default_rng(seed)
    chosen = cand[rng.choice(len(cand), min(n_tiles, len(cand)), replace=False)]
    print(f'uneven check: {len(cand)} uneven output tiles of {kind.size}; emulating {len(chosen)}')
    i_filt, (cbq,) = blocks(fr, 'FullResFilter')
    cb0 = cbq.copy().reshape(-1, 4)
    cb0[30, 2] = 0                                         # the list starts at 0
    lst = (chosen[:, 1].astype(np.uint32) | (chosen[:, 0].astype(np.uint32) << 16))
    H, W = params['outH'], params['outW']
    out = dxbc.Texture(np.zeros((H, W, 4), np.float32))
    half = dxbc.Texture(np.zeros((H // 2, W // 2, 4), np.float32)); quarter = dxbc.Texture(np.zeros((H // 4, W // 4, 4), np.float32))
    one = np.zeros((1, 1, 4), np.float32); one[..., 3] = 1
    point = dxbc.Sampler('point', ('clamp', 'clamp', 'clamp')); linear = dxbc.Sampler('linear', ('clamp', 'clamp', 'clamp'))
    cbs = dict(fr.deep_constants(fr.steps[i_filt], 'cs'))
    cbs[0] = cb0
    # the game's scene sampler (s0) reads by nearest pixel: with it its even step matches the card (99.97 %)
    dxbc.run_compute(fr.program('cs_9528'), (len(lst), 1, 1), cbs,
                     textures={0: dxbc.Buffer(lst, stride=4), 1: dxbc.Texture(tex['scene']), 2: dxbc.Texture(flat), 3: dxbc.Texture(tiles), 4: dxbc.Texture(one)},
                     samplers={0: point, 1: point, 2: linear}, uavs={0: out, 1: half, 2: quarter})
    emu = r11_down(out.levels[0][..., :3])
    m = np.zeros((H, W), bool)
    for ty, tx in chosen:
        m[ty * 16:(ty + 1) * 16, tx * 16:(tx + 1) * 16] = True
    o, g = ours['out'][..., :3][m], emu[m]
    d = np.abs(o - g)
    e = np.floor(np.log2(np.maximum(g, 1e-30)))
    st = d / 2.0 ** (e - 6)
    blurred = np.abs(g - r11_down(tex['scene'][..., :3])[m]).max(-1) > 0
    print(f'uneven ours vs the game\'s step (emulated): values equal {100 * (d == 0).mean():.2f} %, within 1 step {100 * (st <= 1).mean():.2f} %,'
          f' within 2 {100 * (st <= 2).mean():.2f} %; pixels the step changed {100 * blurred.mean():.1f} %; mean ours {o.mean(0).round(5)} game {g.mean(0).round(5)}')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    dp = deep.Deep(fr.deep)
    tex, params, game = inputs(fr, dp)
    if '--uneven' in sys.argv:
        return check_uneven(fr, dp, tex, params, game)
    depth = sys.argv[sys.argv.index('--depth') + 1].split(',') if '--depth' in sys.argv else None
    ours = run_ours(tex, params, depth)
    # each later step alone, on the game's own input to it: the scatter on the game's tiles; the filter on the
    # game's scattered tiles and motion picture
    alone = run_ours({**tex, 'tilesIn': game['tiles'], 'dilatedIn': game['dilated'], 'flatIn': game['flat']}, params, depth)
    sc = run_ours({**tex, 'tilesIn': game['tiles']}, params, depth)['dilated']
    print(f'frame {os.path.basename(os.path.normpath(args[0]))[-5:]}: shutter {params["shutter"]:.4f}, longest {params["maxBlur"]:.0f} px, motion vectors {"yes" if tex["vel"].size > 4 else "none"}')
    view = (slice(0, params['inH']), slice(0, params['inW']))
    report('flat', ours['flat'], game['flat'], [0, 1, 2], view)
    report('tiles', ours['tiles'], game['tiles'], [0, 1, 2, 3])
    report('dilated', ours['dilated'], game['dilated'], [0, 1, 2, 3])
    report('out', ours['out'], game['out'], [0, 1, 2])
    print('  each step on the game\'s own input to it:')
    report('dilated', sc, game['dilated'], [0, 1, 2, 3])
    report('out', alone['out'], game['out'], [0, 1, 2])
    k = alone['class'][..., 0]
    print('  kinds (output tiles): ' + ', '.join(f'{c}: {int((k == c).sum())}' for c in range(4)))
    moved = np.abs(game['out'][..., :3] - tex['scene'][..., :3]).max(-1) > 0
    print(f'  pixels the game blurred: {100 * moved.mean():.2f} %')


if __name__ == '__main__':
    main()
