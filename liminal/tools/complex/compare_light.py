#!/usr/bin/env python3
"""
Our cx_area_a against the game, light before the camera passes, from a capture frame's camera (ingame.mjs makes
ours): direct lamp light, the rest (bounce + glowing panels) and the total, per surface (floor, walls, ceiling,
picked by the game's own G-buffer normals, edges left out), as ratios ours / game.

    COMPLEX_DEEP=<deep>/deep python3 tools/complex/compare_light.py <first export frame dir> <ingame dir> [--fog]

--fog: the game's picture after its height fog (ours with the same fog) instead of before it.
"""
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import check_lamps as CL  # noqa: E402
import deep  # noqa: E402
import ue_lamps as U  # noqa: E402

W, H = 1008, 756


def load(path):
    return np.fromfile(path, np.float32).reshape(H, W, 4)[..., :3].astype(np.float64)


def regions(g):
    N = g['N']
    lit = g['model'] != 0
    nz = N[..., 2]
    m = {'floor': lit & (nz > 0.95), 'ceiling': lit & (nz < -0.95), 'walls': lit & (np.abs(nz) < 0.05)}
    # leave out edges: a pixel and its 8 neighbours must agree
    for k, v in m.items():
        e = v.copy()
        for dy in (-2, 0, 2):
            for dx in (-2, 0, 2):
                e &= np.roll(np.roll(v, dy, 0), dx, 1)
        m[k] = e
    return m


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    fr = capture.Frame(args[0])
    frame = os.path.basename(os.path.normpath(args[0]))[-5:]
    dp = deep.Deep(fr.deep)
    ls = dp.light_steps()
    g = U.gbuffer(fr, dp, ls['lamps'])
    full, nod = load(f'{args[1]}/{frame}_full.f32'), load(f'{args[1]}/{frame}_nodirect.f32')
    pic = lambda step: CL.by_id(dp, step, ls['scene'])[:H, :W, :3].astype(np.float64)   # noqa: E731
    g370, g374 = pic(ls['bounce']), pic(ls['lamps'])
    parts = {'direct': (full - nod, g374 - g370), 'bounce + panels': (nod, g370), 'total': (full, g374)}
    if '--fog' in sys.argv:          # ours drawn with the game's fog: compare with the game's picture after its fog
        g374 = pic(ls['fog'])
        parts = {'total (fog)': (full, g374)}
    m = regions(g)
    print(f'frame {frame}: ours / game (R, G, B) per surface; pixels: ' + ', '.join(f'{k} {int(v.sum())}' for k, v in m.items()))
    for name, (o, gm) in parts.items():
        row = []
        for k, v in m.items():
            if v.sum() < 100:
                continue
            ro, rg = o[v].mean(0), gm[v].mean(0)
            row.append(f'{k}: {np.round(ro / np.maximum(rg, 1e-9), 3).tolist()} (game {np.round(rg, 4).tolist()})')
        print(f'  {name:16s} ' + '   '.join(row))
    whole = (g['model'] != 0)
    print(f'  whole view mean: ours {np.round(full[whole].mean(0), 4).tolist()}  game {np.round(g374[whole].mean(0), 4).tolist()}')


if __name__ == '__main__':
    main()
