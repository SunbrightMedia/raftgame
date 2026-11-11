"""Make the true final pictures from the `complex-capture` branch.

RenderDoc saved the window image with one extra sRGB encode, so `final.jpg`
looks washed out. This undoes it and crops the 4:3 picture.

    git archive origin/complex-capture | tar -x -C <dir>
    python3 -I true_final.py <dir>/exports <out-dir>
"""
import glob
import os
import sys

import numpy as np
from PIL import Image


def main(exports: str, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(exports, 'complex_frame*', 'final.jpg'))):
        a = np.asarray(Image.open(f).convert('RGB')).astype(float) / 255
        h, w, _ = a.shape
        x0 = (w - h * 4 // 3) // 2
        a = a[:, x0:x0 + h * 4 // 3]
        d = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        name = os.path.basename(os.path.dirname(f)).split('_')[-1]
        Image.fromarray((np.clip(d, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(out, name + '.jpg'), quality=92)
        print(name)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
