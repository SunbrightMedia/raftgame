"""The sharpen step alone: our formula (camcorder.ts, amount 7, taps 0.001 of the view, bilinear) applied to
the game's own tone-stage picture, vs the game's own sharpened picture (both JPEG q85 in the capture).
Compares how much each raises fine detail, which the JPEG noise cannot fake the way it skews mean errors.
    python3 -I tools/camcorder/sharptest.py <capture frame dir>
"""
import sys, numpy as np
from PIL import Image
F = sys.argv[1]
L = lambda p: np.asarray(Image.open(p).convert('RGB')).astype(np.float64) / 255
import json, glob, os
def find(ps):
    for pf in sorted(glob.glob(F + '/passes/*.json')):
        p = json.load(open(pf))
        if ps in [os.path.basename(x)[:-4] for v in (p.get('shaders') or {}).values() for x in v]: out = p
    return out
tone, sharp = L(F + '/' + find('ps_8878')['images'][0]['file']), L(F + '/' + find('ps_8881')['images'][0]['file'])
H, W, _ = tone.shape
def shift(a, dx, dy):   # sample a at (x + dx, y + dy), bilinear, edges clamped
    def sh1(a, d, ax):
        i = int(np.floor(d)); f = d - i
        n = a.shape[ax]; idx0 = np.clip(np.arange(n) + i, 0, n - 1); idx1 = np.clip(idx0 + 1, 0, n - 1)
        return np.take(a, idx0, ax) * (1 - f) + np.take(a, idx1, ax) * f
    return sh1(sh1(a, dx, 1), dy, 0)
def ours(c, amount, rx, ry):
    n = shift(c, 0, ry) + shift(c, 0, -ry) + shift(c, rx, 0) + shift(c, -rx, 0)
    d = (c - n * 0.25) * amount
    return np.maximum(c + (d @ np.array([0.3, 0.59, 0.11]))[..., None], 0)
def lum(a): return a @ np.array([0.2126, 0.7152, 0.0722])
def hf(a):
    y = lum(a); b = (shift(y[..., None], 1, 0) + shift(y[..., None], -1, 0) + shift(y[..., None], 0, 1) + shift(y[..., None], 0, -1))[..., 0] / 4
    return np.abs(y - b)[50:-50, 50:-50].mean()
cut = lambda a: a[50:-50, 50:-50]
print(f'game: detail tone {hf(tone):.4f} -> sharp {hf(sharp):.4f} (x{hf(sharp) / hf(tone):.2f})')
for amount, rx, ry, name in ((7, 1.44, 1.08, 'ours (amount 7, 0.001 of the view)'), (7, 1, 1, 'amount 7, 1 px'), (5, 1.44, 1.08, 'amount 5'), (4, 1.44, 1.08, 'amount 4'), (3, 1.44, 1.08, 'amount 3')):
    o = np.clip(ours(tone, amount, rx, ry), 0, 1)
    # JPEG-code ours as the capture was, before comparing
    import io
    b = io.BytesIO(); Image.fromarray((o * 255 + 0.5).astype(np.uint8)).save(b, 'JPEG', quality=85); oj = np.asarray(Image.open(b)).astype(np.float64) / 255
    print(f'{name:38s} mean abs vs game {np.abs(cut(oj) - cut(sharp)).mean():.4f} | detail {hf(oj):.4f} (x{hf(oj) / hf(tone):.2f})')
