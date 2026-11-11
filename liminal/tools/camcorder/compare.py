"""Compare camcorder bench stages with the captured stages of the same frame."""
import sys, json, glob, os
import numpy as np
from PIL import Image

F, B = sys.argv[1], sys.argv[2]
def L(path): return np.asarray(Image.open(path).convert('RGB')).astype(np.float64) / 255

def find(ps):
    out = []
    for pf in sorted(glob.glob(F + '/passes/*.json')):
        p = json.load(open(pf))
        names = [os.path.basename(x)[:-4] for v in (p.get('shaders') or {}).values() for x in v]
        if ps in names: out.append(p)
    return out[-1]
cap = {
    'tone': L(f"{F}/{find('ps_8878')['images'][0]['file']}"),
    'sharp': L(f"{F}/{find('ps_8881')['images'][0]['file']}"),
    'finish': L(f"{F}/{find('ps_19325')['images'][0]['file']}"),
}
fin = L(f'{F}/final.jpg')
fin = fin[:, (fin.shape[1] - fin.shape[0] * 4 // 3) // 2:][:, :fin.shape[0] * 4 // 3]
cap['final'] = np.where(fin <= 0.04045, fin / 12.92, ((fin + 0.055) / 1.055) ** 2.4)
rows = []
for st in ('tone', 'sharp', 'finish', 'final'):
    ours = L(f'{B}/cam_{st}.png')
    c = cap[st]
    if ours.shape != c.shape:
        ours = np.asarray(Image.fromarray((ours * 255).astype(np.uint8)).resize((c.shape[1], c.shape[0]), Image.BILINEAR)).astype(np.float64) / 255
    e = ours - c
    lum = c.mean(-1)
    def lv(lo, hi):
        m = (lum >= lo) & (lum < hi)
        return e[m].mean(0) if m.sum() > 100 else np.zeros(3)
    print('%-6s mean abs %.4f | mean err %+.4f %+.4f %+.4f | dark %+.3f mid %+.3f bright %+.3f | ours mean %.3f %.3f %.3f  game %.3f %.3f %.3f' % (
        st, np.abs(e).mean(), *e.reshape(-1, 3).mean(0), lv(0, 0.25).mean(), lv(0.25, 0.6).mean(), lv(0.6, 1.01).mean(), *ours.reshape(-1, 3).mean(0), *c.reshape(-1, 3).mean(0)))
    Image.fromarray((np.concatenate([ours, c], 1) * 255).clip(0, 255).astype(np.uint8)).resize((1440, 540)).save(f'{B}/vs_{st}.jpg', quality=88)
