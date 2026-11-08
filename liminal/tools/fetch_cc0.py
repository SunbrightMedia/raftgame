"""
Import the hand-picked CC0 textures listed in tools/textures.cc0.json
(OpenGameArt packs, Smithsonian / Cooper Hewitt wallpaper scans).

For each entry: download (or extract from an archive), optionally crop
(scans of physical wallpaper samples) and blend the edges so it tiles,
shrink to at most 256px, and save to textures/cc0/. Merges entries into
textures/index.json and rewrites CREDITS.md.

    python3 tools/fetch_cc0.py

Requires: Pillow, numpy, curl.
"""
import io, json, os, subprocess, tarfile, zipfile
import numpy as np
from PIL import Image
from credits import write_credits

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'textures', 'cc0')
MAX = 256
_archives = {}

def curl(url):
    return subprocess.run(['curl', '-sfL', '-m', '180', url], capture_output=True, check=True).stdout

def from_archive(url, member):
    if url not in _archives:
        data = curl(url)
        files = {}
        if url.endswith('.zip'):
            z = zipfile.ZipFile(io.BytesIO(data))
            for n in z.namelist():
                files[n] = z.read(n) if not n.endswith('/') else None
        else:
            t = tarfile.open(fileobj=io.BytesIO(data))
            for m in t.getmembers():
                if m.isfile():
                    files[m.name] = t.extractfile(m).read()
        _archives[url] = files
    for n, d in _archives[url].items():
        if d is not None and n.endswith(member):
            return d
    raise KeyError(f'{member} not in {url}')

def make_seamless(im):
    """Blend each edge with the opposite one: show a half-offset copy near the edges."""
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape[:2]
    b = np.roll(a, (h // 2, w // 2), axis=(0, 1))
    wx = 1 - np.abs(np.linspace(-1, 1, w))
    wy = 1 - np.abs(np.linspace(-1, 1, h))
    m = np.clip(np.minimum(wx[None, :], wy[:, None]) * 3, 0, 1)[..., None]
    return Image.fromarray((a * m + b * (1 - m)).astype(np.uint8))

def stripe_period(im):
    """Horizontal repeat of a vertically striped image, from the autocorrelation of its column profile."""
    prof = np.asarray(im.convert('L')).astype(np.float32).mean(axis=0)
    prof -= prof.mean()
    n = len(prof)
    ac = np.correlate(prof, prof, 'full')[n - 1:]
    lo = max(6, n // 40)
    # First strong peak after the zero-lag lobe.
    for k in range(lo + 1, n // 2):
        if ac[k] > ac[k - 1] and ac[k] >= ac[k + 1] and ac[k] > 0.3 * ac[0]:
            return k
    return n

def make_seamless_stripes(im):
    p = stripe_period(im)
    w = (im.width // p) * p or im.width
    im = im.crop((0, 0, w, im.height))
    a = np.asarray(im).astype(np.float32)
    h = a.shape[0]
    b = np.roll(a, h // 2, axis=0)
    wy = np.clip((1 - np.abs(np.linspace(-1, 1, h))) * 3, 0, 1)[:, None, None]
    return Image.fromarray((a * wy + b * (1 - wy)).astype(np.uint8))

entries = json.load(open(os.path.join(ROOT, 'tools', 'textures.cc0.json')))['textures']
os.makedirs(OUT, exist_ok=True)
index = []
for e in entries:
    fname = e['name'].replace('/', '__') + '.png'
    path = os.path.join(OUT, fname)
    if not os.path.exists(path):
        try:
            data = from_archive(e['archive'], e['member']) if 'archive' in e else curl(e['url'])
        except Exception as ex:
            print('FAILED', e['name'], ex); continue
        im = Image.open(io.BytesIO(data)).convert('RGB')
        if 'crop' in e:
            x0, y0, x1, y1 = e['crop']
            im = im.crop((int(x0 * im.width), int(y0 * im.height), int(x1 * im.width), int(y1 * im.height)))
            if not e.get('stripes'):
                side = min(im.size)  # square repeat
                im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
        if e.get('stripes'):
            im = make_seamless_stripes(im)
        elif e.get('seamless'):
            im = make_seamless(im)
        im.thumbnail((MAX, MAX), Image.LANCZOS)
        im.save(path, optimize=True)
        print('imported', e['name'])
    w, h = Image.open(path).size
    index.append({'name': e['name'], 'file': 'cc0/' + fname, 'size': [e['size'], round(e['size'] * h / w)], 'material': e.get('material', 'default'),
                  'credit': e['credit'], 'url': e['page'], 'license': 'CC0 1.0'})

idx_path = os.path.join(ROOT, 'textures', 'index.json')
idx = json.load(open(idx_path))
names = {t['name'] for t in index}
idx['textures'] = [t for t in idx['textures'] if t['name'] not in names] + index
json.dump(idx, open(idx_path, 'w'), indent=1)
write_credits()
print(len(index), 'CC0 textures imported')
