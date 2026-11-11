"""
Fetch the CC0 materials listed in tools/textures.polyhaven.json from Poly Haven (polyhaven.com/license: CC0),
keep the colour map, store it as a `px` JPEG in textures/src/, and add them to textures/index.json (keeping
every entry other importers own) and CREDITS.md. The game crushes them at runtime like every photo texture.

    python3 tools/fetch_polyhaven.py            # fetch missing
    python3 tools/fetch_polyhaven.py --force    # re-fetch everything

Requires: Pillow, curl.
"""
import io, json, os, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'textures.polyhaven.json')
OUT = os.path.join(ROOT, 'textures', 'src')
force = '--force' in sys.argv


def curl(url):
    return subprocess.run(['curl', '-sfL', '-m', '120', url], capture_output=True, check=True).stdout


entries = json.load(open(SRC))['textures']
index = []
for e in entries:
    pid, fname = e['polyhaven'], e['name'].replace('/', '__') + '.jpg'
    path = os.path.join(OUT, fname)
    info = json.loads(curl(f'https://api.polyhaven.com/info/{pid}'))
    # Poly Haven gives the real size the texture covers in mm
    size = e.get('size') or round(max(info.get('dimensions', [2000, 2000])) / 25.4, 1)
    if force or not os.path.exists(path):
        files = json.loads(curl(f'https://api.polyhaven.com/files/{pid}'))
        url = files['Diffuse']['1k']['jpg']['url']
        im = Image.open(io.BytesIO(curl(url))).convert('RGB').resize((e.get('px', 512), e.get('px', 512)), Image.LANCZOS)
        im.save(path, quality=92)
        print('fetched', e['name'], '<-', pid, f'({size}" a repeat)')
    authors = ', '.join(info.get('authors', {}).keys())
    index.append({
        'name': e['name'], 'file': 'src/' + fname, 'size': [size, size], 'material': e.get('material', 'default'),
        'credit': f'{pid} by {authors}, from Poly Haven', 'url': f'https://polyhaven.com/a/{pid}', 'license': 'CC0 1.0',
    })

idx_path = os.path.join(ROOT, 'textures', 'index.json')
others = [t for t in json.load(open(idx_path))['textures'] if 'Poly Haven' not in t.get('credit', '') or t['name'].startswith('cc0/')]
index_all = others + index
json.dump({'format': 'liminal-textures', 'version': 1, 'textures': index_all}, open(idx_path, 'w'), indent=1)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from credits import write_credits
write_credits()
print(len(index), 'Poly Haven textures,', len(index_all), 'total in index')
