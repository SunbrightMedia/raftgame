"""
Import Freedoom's wall textures and flats (BSD-3-Clause, https://freedoom.github.io).

Walls are assembled from Freedoom's patches exactly as its own build does,
following lumps/textures/textures.cfg. Flats are copied as-is. Output:
  textures/freedoom/walls/NAME.png, textures/freedoom/flats/NAME.png,
  textures/freedoom/LICENSE.txt, and entries merged into textures/index.json
  (marked pixelart: they are already 256-colour Doom art, so the crusher only
  grades them and never blurs or re-palettes them).

    python3 tools/fetch_freedoom.py

Requires: Pillow, curl.
"""
import concurrent.futures as cf, io, json, os, re, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = 'https://raw.githubusercontent.com/freedoom/freedoom/master/'
OUT = os.path.join(ROOT, 'textures', 'freedoom')
# Doom's player is 56 units tall, ours 72: scale Doom pixels up to match.
SCALE = 72 / 56

def get(path):
    return subprocess.run(['curl', '-sfL', '-m', '60', RAW + path], capture_output=True, check=True).stdout

def preprocess(text, defines=()):
    """The tiny #ifdef/#ifndef/#else/#endif subset textures.cfg uses."""
    out, stack = [], []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('#ifdef') or s.startswith('#ifndef'):
            name = s.split()[1]
            on = (name in defines) == s.startswith('#ifdef')
            stack.append(on)
        elif s.startswith('#else'):
            stack[-1] = not stack[-1]
        elif s.startswith('#endif'):
            stack.pop()
        elif all(stack):
            out.append(line)
    return out

def parse_textures(lines):
    tex, cur = {}, None
    for line in lines:
        s = line.split(';')[0].strip()
        if not s:
            continue
        parts = s.split()
        if parts[0] == '*':
            cur['patches'].append((parts[1].lower(), int(parts[2]), int(parts[3])))
        else:
            cur = {'w': int(parts[1]), 'h': int(parts[2]), 'patches': []}
            tex.setdefault(parts[0], cur)
    return tex

def save_indexed(im, path):
    # Doom art never has more than 256 colours, so an indexed PNG is lossless and ~3x smaller.
    colors = im.getcolors(256)
    out = im.quantize(colors=len(colors), method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) if colors else im.copy()
    out.info.pop('transparency', None)
    out.save(path, optimize=True)

os.makedirs(os.path.join(OUT, 'walls'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'flats'), exist_ok=True)
textures = parse_textures(preprocess(get('lumps/textures/textures.cfg').decode()))
buildcfg = get('buildcfg.txt').decode()
flats_section = buildcfg.split('[flats]')[1].split('\n[')[0]
flats = [l.strip() for l in flats_section.splitlines() if l.strip() and not l.strip().startswith(('#', ';', '-'))]

patch_names = sorted({p for t in textures.values() for p, _, _ in t['patches']})
patches = {}
def load_patch(name):
    try:
        return name, Image.open(io.BytesIO(get(f'patches/{name}.png'))).convert('RGBA')
    except Exception:
        return name, None
with cf.ThreadPoolExecutor(8) as ex:
    for name, im in ex.map(load_patch, patch_names):
        patches[name] = im
missing = [n for n, im in patches.items() if im is None]

entries = []
for name, t in textures.items():
    if name.startswith('AASHITTY') or not t['patches']:
        continue
    canvas = Image.new('RGBA', (t['w'], t['h']), (0, 0, 0, 0))
    ok = True
    for p, x, y in t['patches']:
        im = patches.get(p)
        if im is None:
            ok = False
            continue
        canvas.alpha_composite(im, (x, y)) if x >= 0 and y >= 0 else canvas.paste(im, (x, y), im)
    if not ok and canvas.getbbox() is None:
        continue
    # Holes (grates, fences) become black until the engine supports masked textures.
    flat = Image.new('RGB', canvas.size, (0, 0, 0))
    flat.paste(canvas, mask=canvas.split()[3])
    save_indexed(flat, os.path.join(OUT, 'walls', f'{name}.png'))
    entries.append({'name': f'freedoom/{name}', 'file': f'freedoom/walls/{name}.png',
                    'size': [round(t['w'] * SCALE), round(t['h'] * SCALE)], 'pixelart': True,
                    'credit': 'Freedoom', 'url': 'https://freedoom.github.io', 'license': 'BSD-3-Clause'})

def load_flat(name):
    try:
        return name, get(f'flats/{name.lower()}.png')
    except Exception:
        return name, None
with cf.ThreadPoolExecutor(8) as ex:
    for name, data in ex.map(load_flat, flats):
        if not data:
            continue
        im = Image.open(io.BytesIO(data)).convert('RGB')
        save_indexed(im, os.path.join(OUT, 'flats', f'{name}.png'))
        entries.append({'name': f'freedoom/flat/{name}', 'file': f'freedoom/flats/{name}.png',
                        'size': [round(im.width * SCALE), round(im.height * SCALE)], 'pixelart': True,
                        'credit': 'Freedoom', 'url': 'https://freedoom.github.io', 'license': 'BSD-3-Clause'})

with open(os.path.join(OUT, 'LICENSE.txt'), 'wb') as f:
    f.write(get('COPYING.adoc'))

idx_path = os.path.join(ROOT, 'textures', 'index.json')
idx = json.load(open(idx_path))
idx['textures'] = [t for t in idx['textures'] if not t['name'].startswith('freedoom/')] + entries
json.dump(idx, open(idx_path, 'w'), indent=1)
print(f'{sum(1 for e in entries if "/flat/" not in e["name"])} walls, {sum(1 for e in entries if "/flat/" in e["name"])} flats; {len(missing)} patches missing: {missing[:10]}')
