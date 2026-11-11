"""
Compare a render of a rebuilt capture frame with the capture's own final picture.

  python3 -I tools/recreate/compare.py <render.png> <capture.jpg> [side.jpg] [errors.png] [--regions file.json]

Both pictures are cropped to 4:3 and brought to 1440x1080. Prints the mean
colour of the regions below (ours | capture | brightness ratio) and the mean
absolute error over the whole picture; optionally saves a side-by-side and an
error map (grey = equal, white = ours brighter, black = ours darker, ×4).
The regions are those of frame 19893 (tools/recreate/cx-frame4.ts) unless --regions gives a JSON
object {name: [x0, y0, x1, y1]} (tools/recreate/regions/).
The capture's picture must be in true colours: RenderDoc saved the finals
with one sRGB curve too many (reference/complex/true_final.py).
"""
import json
import sys
import numpy as np
from PIL import Image

REGIONS = {  # x0, y0, x1, y1 in the 1440x1080 picture
    'right wall': (1200, 300, 1400, 700),
    'back wall': (600, 350, 850, 600),
    'floor': (500, 850, 900, 1050),
    'ceiling tiles': (820, 30, 1050, 120),
    'soffit side': (380, 120, 520, 300),
    'near-left face': (40, 420, 180, 700),
    'far-left wall': (260, 420, 400, 650),
    'light panel': (650, 155, 740, 190),
}


def load(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    cw = min(w, round(h * 4 / 3))
    return np.asarray(im.crop(((w - cw) // 2, 0, (w - cw) // 2 + cw, h)).resize((1440, 1080))).astype(float) / 255


if '--regions' in sys.argv:
    k = sys.argv.index('--regions')
    REGIONS = json.load(open(sys.argv[k + 1]))
    sys.argv = sys.argv[:k] + sys.argv[k + 2:]
ours, ref = load(sys.argv[1]), load(sys.argv[2])
tot = 0.0
for k, (x0, y0, x1, y1) in REGIONS.items():
    a, b = ours[y0:y1, x0:x1].reshape(-1, 3).mean(0), ref[y0:y1, x0:x1].reshape(-1, 3).mean(0)
    tot += np.abs(a - b).mean()
    print('%-15s ours %.3f %.3f %.3f | capture %.3f %.3f %.3f | ratio %.2f' % (k, *a, *b, a.mean() / max(b.mean(), 1e-3)))
print('mean abs error: whole picture %.4f | regions %.4f' % (np.abs(ours - ref).mean(), tot / len(REGIONS)))
if len(sys.argv) > 3:
    Image.fromarray((np.concatenate([ours, ref], 1) * 255).astype(np.uint8)).save(sys.argv[3], quality=90)
if len(sys.argv) > 4:
    e = np.clip(0.5 + (ours - ref).mean(-1) * 4, 0, 1)
    Image.fromarray((e * 255).astype(np.uint8)).save(sys.argv[4])
