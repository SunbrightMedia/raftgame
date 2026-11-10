"""
Put chosen models side by side in a bare map, and print a camera pose for each,
to look at kit pieces in the studio:

    python3 tools/world/kit_sheet.py OUT.json model [model ...]     (names under models/p2lib, no extension; * allowed)

Prints one studio pose "x,y,z,yaw,pitch" per model (three-quarter view from above).
"""
import fnmatch, glob, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))


def main():
    out, pats = sys.argv[1], sys.argv[2:]
    heads = {}
    for f in glob.glob(os.path.join(ROOT, 'models/p2lib/**/*.json'), recursive=True):
        h = json.load(open(f))
        if h.get('format') == 'liminal-mesh':
            heads[os.path.relpath(f, os.path.join(ROOT, 'models/p2lib'))[:-5].replace('\\', '/')] = h
    names = []
    for p in pats:
        hit = sorted(n for n in heads if fnmatch.fnmatch(n, p))
        names += hit if hit else []
        if not hit:
            print('no model', p, file=sys.stderr)
    ents, poses, x = [], [], 0.0
    for i, n in enumerate(names):
        h = heads[n]
        mn, mx = h['bounds']
        size = [mx[k] - mn[k] for k in range(3)]
        r = max(size) / 2
        x += r + 64
        # Model placed with its bounds' centre at (x, 0, 0).
        o = [x - (mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -(mn[2] + mx[2]) / 2]
        ents.append({'id': 10 + i, 'class': 'prop', 'origin': [round(c, 2) for c in o], 'angles': [0, 0, 0], 'props': {'model': h['source'], 'skin': 0, 'source_class': 'prop_static', 'solid': False}})
        ents.append({'id': 5000 + i, 'class': 'label', 'origin': [round(x, 1), round(-size[1] / 2 - r * 0.25, 1), round(-size[2] / 2, 1)], 'angles': [0, 90, 0],
                     'props': {'text': n.split('/')[-1] + '\n' + 'x'.join(str(round(s)) for s in size), 'size': max(4, round(r / 9, 1)), 'plane': 'floor'}})
        d = r * 2.6 + 40
        yaw, pitch = 55, 24
        cy, sy, cp, sp = math.cos(math.radians(yaw)), math.sin(math.radians(yaw)), math.cos(math.radians(pitch)), math.sin(math.radians(pitch))
        cam = [x - cy * cp * d, -sy * cp * d, sp * d]
        poses.append(f'{cam[0]:.0f},{cam[1]:.0f},{cam[2]:.0f},{yaw},{pitch}')
        x += r + 64
    ents.insert(0, {'id': 1, 'class': 'player_start', 'origin': [0, 0, 0], 'angles': [0, 0, 0]})
    m = {'format': 'liminal-map', 'version': 1, 'name': 'kitsheet',
         'settings': {'camera': {'model': 'source', 'sourceHdr': False}, 'light': {'enabled': False}, 'fog': {'enabled': True, 'source': True, 'color': '#6a7480', 'near': 20000, 'far': 200000}, 'render': {'internalHeight': 0, 'textureFilter': 'linear', 'detailDistance': 0}},
         'brushes': [], 'entities': ents}
    json.dump(m, open(out, 'w'))
    print(' '.join(f'"{p}"' for p in poses))


if __name__ == '__main__':
    main()
