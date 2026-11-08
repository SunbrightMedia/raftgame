"""
Fetch the CC0 photo textures listed in tools/textures.sources.json from
ambientCG, keep only the colour map, and store it as a 256px "source" JPEG
in textures/src/. The game crushes these at runtime (resolution, palette,
contrast...) using the Texture settings in the tweak panel, so these files
stay the clean originals.

Also writes textures/index.json (what the game loads) and CREDITS.md.

    python3 tools/fetch_textures.py            # fetch missing
    python3 tools/fetch_textures.py --force    # re-fetch everything

Requires: Pillow, curl.
"""
import io, json, os, subprocess, sys, zipfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'tools', 'textures.sources.json')
OUT = os.path.join(ROOT, 'textures', 'src')
SIZE = 256
force = '--force' in sys.argv

def curl(url):
    return subprocess.run(['curl', '-sfL', '-m', '120', url], capture_output=True, check=True).stdout

entries = json.load(open(SRC))['textures']
os.makedirs(OUT, exist_ok=True)
index = []
for e in entries:
    fname = e['name'].replace('/', '__') + '.jpg'
    path = os.path.join(OUT, fname)
    aid = e['ambientcg']
    if force or not os.path.exists(path):
        z = zipfile.ZipFile(io.BytesIO(curl(f'https://ambientcg.com/get?file={aid}_1K-JPG.zip')))
        color = [n for n in z.namelist() if n.lower().endswith(('_color.jpg', '_color.png'))]
        if not color:
            print('no colour map in', aid, z.namelist()); continue
        im = Image.open(io.BytesIO(z.read(color[0]))).convert('RGB')
        im = im.resize((SIZE, SIZE), Image.LANCZOS)
        im.save(path, quality=92)
        print('fetched', e['name'], '<-', aid)
    index.append({
        'name': e['name'], 'file': 'src/' + fname, 'size': [e['size'], e['size']],
        'material': e.get('material', 'default'),
        'credit': f'{aid} from ambientCG.com', 'url': f'https://ambientcg.com/a/{aid}', 'license': 'CC0 1.0',
    })

# Keep entries other importers own (fetch_freedoom.py, fetch_cc0.py...).
idx_path = os.path.join(ROOT, 'textures', 'index.json')
others = []
if os.path.exists(idx_path):
    others = [t for t in json.load(open(idx_path))['textures'] if 'ambientCG' not in t.get('credit', '')]
index_all = index + others
json.dump({'format': 'liminal-textures', 'version': 1, 'textures': index_all}, open(idx_path, 'w'), indent=1)
from credits import write_credits
write_credits()
print(len(index), 'ambientCG textures,', len(index_all), 'total in index')
