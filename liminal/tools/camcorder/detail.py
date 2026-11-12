"""Fine detail per stage, our camcorder bench vs the capture: mean |Y - blur(Y)| (sigma 1 px and 3 px).
Ours is JPEG-coded at quality 85 first, as the capture's pictures were (complex_export.py).
    python3 -I tools/camcorder/detail.py <capture frame dir> <bench outdir>
"""
import sys, io, json, glob, os
import numpy as np
from PIL import Image
F, B = sys.argv[1], sys.argv[2]
def lum(a): return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
def blur(y, s):
    r = int(3 * s + 1); x = np.arange(-r, r + 1); k = np.exp(-x * x / (2 * s * s)); k /= k.sum()
    y = np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, 'valid'), 1, y)
    return np.apply_along_axis(lambda v: np.convolve(np.pad(v, r, mode='edge'), k, 'valid'), 0, y)
def load(p, jpeg=False):
    im = Image.open(p).convert('RGB')
    if jpeg:
        b = io.BytesIO(); im.save(b, 'JPEG', quality=85); im = Image.open(io.BytesIO(b.getvalue())).convert('RGB')
    return np.asarray(im).astype(np.float64) / 255
def find(ps):
    for pf in sorted(glob.glob(F + '/passes/*.json')):
        p = json.load(open(pf))
        if ps in [os.path.basename(x)[:-4] for v in (p.get('shaders') or {}).values() for x in v]: out = p
    return out
cap = {'tone': f"{F}/{find('ps_8878')['images'][0]['file']}", 'sharp': f"{F}/{find('ps_8881')['images'][0]['file']}", 'finish': f"{F}/{find('ps_19325')['images'][0]['file']}"}
def hf(a, s):
    y = lum(a); c = y[100:-100, 100:-100]   # inside the frame edge
    return np.abs(y - blur(y, s))[100:-100, 100:-100].mean()
print(f"{'stage':7s} {'detail 1px ours/game':>22s} {'detail 3px ours/game':>22s}")
for st in ('tone', 'sharp', 'finish'):
    o, g = load(f'{B}/cam_{st}.png', jpeg=True), load(cap[st])
    print(f"{st:7s} {hf(o, 1):.4f}/{hf(g, 1):.4f} = {hf(o, 1) / hf(g, 1):4.2f}   {hf(o, 3):.4f}/{hf(g, 3):.4f} = {hf(o, 3) / hf(g, 3):4.2f}")
