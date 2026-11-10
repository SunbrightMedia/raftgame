"""
Write src/world/kit/apertureModels.json: the bounds of every Portal 2 kit model
the world generator may place (from the converted library, models/p2lib), so
generator code can fit pieces together without reading model files.

    python3 tools/world/kit_data.py

{ "<model path without models/ and .mdl>": { "min": [x, y, z], "max": [x, y, z], "solid": 0|1 } }
solid = it has a collision model (the player can walk on it / bump into it).
"""
import glob, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
SKIP = ('player', 'npcs', 'gibs', 'weapons', 'stars', 'portals', 'portal/', 'info_character', 'handles_map_editor', 'props_map_editor', 'br_', 'error', 'black', 'extras', 'effects')

out = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'models/p2lib/**/*.json'), recursive=True)):
    h = json.load(open(f))
    if h.get('format') != 'liminal-mesh':
        continue
    name = h['source'].replace('p2lib/models/', '')[:-4]
    if name.startswith(SKIP):
        continue
    mn, mx = h['bounds']
    out[name] = {'min': [round(v, 1) for v in mn], 'max': [round(v, 1) for v in mx], 'solid': 1 if h.get('collision') else 0}
p = os.path.join(ROOT, 'src/world/kit/apertureModels.json')
with open(p, 'w') as f:
    f.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in out.items()) + '\n}\n')
print(p, len(out), 'models', os.path.getsize(p) // 1024, 'KB')
