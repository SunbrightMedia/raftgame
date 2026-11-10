"""
The Portal 2 catalogue rooms: every material and model of the full export,
laid out on labelled grids (A1, B7 ...) to walk through and pick from.

    python3 tools/source/make_catalogue.py

Reads textures/p2lib/index.json and models/p2lib/**/*.json (made by
convert_materials.py / convert_models.py with P2_PREFIX=p2lib, --all) and
writes maps/p2lib/room0.json ... room9.json. Keys 0-9 switch rooms (map
"links"). Room 0 lists what is where.

Textures: each on a tile showing it once (96 units on its longer side), on a
grid of 144-unit cells; columns are letters (west to east), rows numbers
(south to north). Models: each standing in a cell sized to it, rows packed
west to east. Every item has its cell name and path on the floor in front.
Lit flat (no baked light) so colours read as they are.
"""
import json, os, glob, math, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
OUT = os.path.join(ROOT, 'maps/p2lib')

TEX_ROOMS = [
    (1, 'World surfaces', ['concrete', 'tile', 'metal', 'plaster', 'carpet', 'wood', 'plastic', 'glass', 'paint', 'wallpaper', 'liquids', 'nature',
                           'anim_wp', 'animated_wallpanels', 'elevator', 'traincar_interior', 'traincars', 'motel', 'props', 'lights', 'br_debris',
                           'console', 'cable', 'moon', 'logo', 'fabric', 'detail', 'de_chateau']),
    (2, 'Signs, decals, overlays', ['signage', 'decals', 'overlays']),
    (3, 'Effects, sky, dev, tools', ['particle', 'particles', 'effects', 'sprites', 'skybox', 'dev', 'debug', 'tools', 'engine', 'hud', 'backpack',
                                     'paintblobs', 'sun', 'voice', 'shadertest', 'cubemaps']),
    (4, 'Screens and UI', ['vgui', 'vguiedit']),
    (5, 'Model skins', ['models']),
]
MODEL_ROOMS = [
    (6, 'Office and underground props', ['props_underground', 'props_office', 'props_motel', 'props_basement', 'props_lab', 'props_junk', 'props_debris',
                                         'props_urban', 'props_street', 'props_highway', 'props_downtown', 'props_mall', 'props_lighting', 'props_buildings',
                                         'props_unique', 'props_wasteland', 'props_trainstation', 'props_vehicles', 'props_diorama']),
    (7, 'Behind the scenes', ['props_bts', 'props_factory', 'props_lights', 'prop_cables', 'props_backstage', 'props_p1_backstage', 'props_sabotage',
                              'catwalk_destruction', 'props_animsigns', 'props_livingwall', 'br_debris', 'br_camera']),
    (8, 'Test chambers', ['props', 'anim_wp', 'props_map_editor', 'handles_map_editor', 'props_gameplay', 'props_test_chamber', 'props_ingame', 'props_hub',
                          'props_vac_anim', 'elevator', 'container_ride', 'container_ride_360', 'portal', 'portals', 'effects']),
    (9, 'Destruction, characters, plants, the rest', None),   # everything not placed above
]
CELL, TILE, WALL_H = 144, 96, 384
FLOOR, WALL, SIDE = 'p2lib/dev/dev_measuregeneric01b', 'p2lib/dev/dev_measurewall01a', 'p2lib/tools/toolsblack'
SETTINGS = {'camera': {'model': 'source', 'sourceHdr': False, 'sourceScale': 1}, 'light': {'enabled': False}, 'fog': {'enabled': False},
            'render': {'internalHeight': 0, 'textureFilter': 'linear'}}
LINKS = {str(i): f'p2lib/room{i}' for i in range(10)}


def col_name(i: int) -> str:
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def wrap(path: str, width: int = 34) -> list[str]:
    out, line = [], ''
    for part in re.split(r'(?<=[/_ ])', path):
        if len(line) + len(part) > width and line:
            out.append(line); line = ''
        while len(part) > width:
            out.append(part[:width]); part = part[width:]
        line += part
    if line:
        out.append(line)
    return out


class Room:
    def __init__(self, name: str):
        self.name, self.brushes, self.entities, self.nid = name, [], [], 1

    def box(self, lo, hi, faces=None, tex=None, solid=True):
        """An axis-aligned box as a convex brush (its faces take Source texture axes). faces: {'pz': {...}} etc."""
        planes = [[1, 0, 0, hi[0]], [-1, 0, 0, -lo[0]], [0, 1, 0, hi[1]], [0, -1, 0, -lo[1]], [0, 0, 1, hi[2]], [0, 0, -1, -lo[2]]]
        keys = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
        fs = {str(i): (faces or {}).get(k) or {'tex': tex or WALL} for i, k in enumerate(keys)}
        b = {'id': self.nid, 'type': 'convex', 'planes': [[c if isinstance(c, int) else round(c, 3) for c in p] for p in planes], 'faces': fs}
        if not solid: b['solid'] = False
        self.brushes.append(b); self.nid += 1

    def ent(self, cls, origin, angles=None, props=None):
        e = {'id': 100000 + len(self.entities), 'class': cls, 'origin': [round(v, 3) for v in origin]}
        if angles: e['angles'] = angles
        if props: e['props'] = props
        self.entities.append(e)

    def label(self, x, y, z, text, size, yaw=0, plane='floor'):
        self.ent('label', (x, y, z), [0, yaw, 0], {'text': text, 'size': size, 'plane': plane})

    def shell(self, x0, y0, x1, y1, title):
        """Floor, four walls (grid texture at Source's usual 0.25 scale), the start point and the room's name."""
        grid = lambda: {'uaxis': [1, 0, 0, 0], 'vaxis': [0, -1, 0, 0], 'scale': [0.25, 0.25]}
        self.box((x0 - 64, y0 - 64, -16), (x1 + 64, y1 + 64, 0), {'pz': {'tex': FLOOR, **grid()}}, tex=SIDE)
        for lo, hi in [((x0 - 64, y0 - 80, 0), (x1 + 64, y0 - 64, WALL_H)), ((x0 - 64, y1 + 64, 0), (x1 + 64, y1 + 80, WALL_H)),
                       ((x0 - 80, y0 - 64, 0), (x0 - 64, y1 + 64, WALL_H)), ((x1 + 64, y0 - 64, 0), (x1 + 80, y1 + 64, WALL_H))]:
            self.box(lo, hi, tex=WALL)
        self.ent('player_start', (x0 + 24, y0 - 40, 0), [0, 60, 0])
        self.label(x0 + 200, y0 - 63, 200, title, 28, 90, 'wall')
        self.label(x0 + 200, y0 - 63, 140, 'keys 0-9: rooms   0: list of rooms', 10, 90, 'wall')

    def save(self, n):
        os.makedirs(OUT, exist_ok=True)
        m = {'format': 'liminal-map', 'version': 1, 'name': f'p2lib/room{n}', 'settings': SETTINGS, 'links': LINKS,
             'brushes': self.brushes, 'entities': self.entities}
        with open(os.path.join(OUT, f'room{n}.json'), 'w') as f:
            # one brush/entity per line, as serializeMap
            f.write('{\n')
            for k in ('format', 'version', 'name', 'settings', 'links'):
                f.write(f'  "{k}": {json.dumps(m[k])},\n')
            for k in ('brushes', 'entities'):
                f.write(f'  "{k}": [\n' + ',\n'.join('    ' + json.dumps(x) for x in m[k]) + ('\n  ]' + (',' if k == 'brushes' else '') + '\n'))
            f.write('}\n')


def texture_room(n, title, folders, textures):
    items = sorted((t for t in textures if t['name'].split('/')[1] in folders), key=lambda t: t['name'])
    cols = max(1, math.ceil(math.sqrt(len(items))))
    rows = math.ceil(len(items) / cols)
    r = Room(title)
    W, H = cols * CELL, rows * CELL
    r.shell(0, 0, W, H, f'{n}  {title}  ({len(items)} textures)')
    for c in range(cols):
        r.label(c * CELL + CELL / 2, -36, 0, col_name(c), 20)
    for k in range(rows):
        r.label(-36, k * CELL + CELL / 2 + 40, 0, str(k + 1), 20)
    for i, t in enumerate(items):
        c, k = i % cols, i // cols
        cx, cy = c * CELL + CELL / 2, k * CELL + CELL / 2 + 20
        tw, th = t['size']
        w, h = (TILE, TILE * th / tw) if tw >= th else (TILE * tw / th, TILE)
        x0, y0 = cx - w / 2, cy - h / 2
        su, sv = w / tw, h / th
        top = {'tex': t['name'], 'uaxis': [1, 0, 0, round(-x0 / su, 4)], 'vaxis': [0, -1, 0, round((y0 + h) / sv, 4)], 'scale': [round(su, 6), round(sv, 6)]}
        r.box((x0, y0, 0), (x0 + w, y0 + h, 8), {'pz': top}, tex=SIDE)
        path = t['name'][len('p2lib/'):]
        r.label(cx, cy - TILE / 2 - 22, 0.2, '\n'.join([f'{col_name(c)}{k + 1}'] + wrap(path)), 9)
    r.save(n)
    return len(items)


def model_room(n, title, items):
    items = sorted(items, key=lambda h: h['source'])
    r = Room(title)
    ROW_W = max(2048, int(math.sqrt(sum(max(CELL, (h['bounds'][1][0] - h['bounds'][0][0]) + 64) * max(CELL, (h['bounds'][1][1] - h['bounds'][0][1]) + 96) for h in items)) * 1.1))
    x = y = 0.0
    row_h, col, row = 0.0, 0, 0
    placed = []
    for h in items:
        (bx0, by0, bz0), (bx1, by1, bz1) = h['bounds']
        cw = max(CELL, math.ceil((bx1 - bx0 + 64) / 16) * 16)
        ch = max(CELL, math.ceil((by1 - by0 + 112) / 16) * 16)
        if x + cw > ROW_W and x > 0:
            y += row_h; x = 0.0; row_h = 0.0; col = 0; row += 1
        placed.append((h, x, y, cw, ch, col, row))
        x += cw; row_h = max(row_h, ch); col += 1
    W = max(p[1] + p[3] for p in placed); Hh = y + row_h
    r.shell(0, 0, W, Hh, f'{n}  {title}  ({len(items)} models)')
    for k in range(row + 1):
        ys = [p[2] for p in placed if p[6] == k]
        r.label(-36, ys[0] + 60, 0, str(k + 1), 20)
    for h, x, y, cw, ch, c, k in placed:
        (bx0, by0, bz0), (bx1, by1, bz1) = h['bounds']
        cx, cy = x + cw / 2, y + 80 + (ch - 80) / 2
        r.ent('prop', (cx - (bx0 + bx1) / 2, cy - (by0 + by1) / 2, -bz0), [0, 0, 0], {'model': h['source'], 'solid': False})
        path = h['source'][len('p2lib/models/'):]
        r.label(cx, y + 40, 0.2, '\n'.join([f'{col_name(c)}{k + 1}'] + wrap(path)), 9)
    r.save(n)
    return len(items)


def main():
    textures = json.load(open(os.path.join(ROOT, 'textures/p2lib/index.json')))['textures']
    headers = []
    for f in glob.glob(os.path.join(ROOT, 'models/p2lib/**/*.json'), recursive=True):
        h = json.load(open(f))
        if h.get('format') == 'liminal-mesh':
            headers.append(h)
    counts = {}
    placed_folders = set()
    for n, title, folders in TEX_ROOMS:
        counts[n] = (title, texture_room(n, title, folders, textures), 'textures')
        placed_folders |= set(folders)
    left = [t for t in textures if t['name'].split('/')[1] not in placed_folders]
    if left:   # any folder not named above goes to the world-surfaces room's list too
        print('textures in no room:', collections.Counter(t['name'].split('/')[1] for t in left))
    folder = lambda h: h['source'].split('/')[2] if h['source'].count('/') > 2 else '(top)'
    used = set()
    for n, title, folders in MODEL_ROOMS:
        its = [h for h in headers if (folders is None and h['source'] not in used) or (folders and folder(h) in folders)]
        used |= {h['source'] for h in its}
        counts[n] = (title, model_room(n, title, its), 'models')
    # Room 0: what is where.
    r = Room('Catalogue')
    r.shell(0, 0, 1600, 1200, 'Portal 2 catalogue')
    for i, n in enumerate(sorted(counts)):
        title, cnt, kind = counts[n]
        r.label(170 + (i % 5) * 310, 1263, 290 - (i // 5) * 190, '\n'.join([str(n)] + [l.strip() for l in wrap(title, 16)] + [f'{cnt} {kind}']), 40, 270, 'wall')
    r.label(420, 260, 0.2, '\n'.join(['HOW TO USE', 'Number keys 0-9: go to a room.', 'Each item has a cell name on the floor (A1, B7...).',
                                       'Tell Claude the room and cell, e.g. "6 C12".', 'V: fly. Shift: run.']), 24)
    r.save(0)
    for n in sorted(counts):
        print(n, counts[n])


if __name__ == '__main__':
    main()
