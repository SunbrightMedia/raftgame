"""
Measure how a Portal 2 map is built, from its import (tools/source/import_bsp.py):
which models and materials it uses and how much, how kit pieces sit next to
each other, how lamps are set up, the fog. Numbers for docs/P2_STUDY.md and
for the world generator's rules, instead of guesses from screenshots.

    python3 tools/source/study.py maps/p2ref/<map>.json [--pairs FAMILY] [--top N] [--region x0,y0,z0,x1,y1,z1]

--pairs FAMILY: for models whose name contains FAMILY (e.g. hanging_), list how
their nearest neighbours of the same family sit in each piece's own frame
(offset and relative yaw), most common first: the kit's joining rules as Valve
used them.
"""
import argparse, collections, itertools, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from plan import axes, brush_points, hull2  # noqa: E402


def short(model):
    return model.split('models/')[-1].replace('.mdl', '')


def local(e, p):
    """World point p in prop e's own frame."""
    f, l, u = axes(e.get('angles'))
    d = [p[i] - e['origin'][i] for i in range(3)]
    s = e['props'].get('scale', 1)
    return [sum(d[i] * a[i] for i in range(3)) / s for a in (f, l, u)]


def q(v, step=4):
    return tuple(int(round(c / step) * step) for c in v)


def poly_area(pts):
    """Area of the largest face-like extent: bounding box areas of a convex brush, by axis."""
    lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
    return [hi[i] - lo[i] for i in range(3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('map')
    ap.add_argument('--pairs', default=None)
    ap.add_argument('--top', type=int, default=25)
    ap.add_argument('--region', default=None)
    a = ap.parse_args()
    m = json.load(open(a.map))
    R = [float(v) for v in a.region.split(',')] if a.region else None
    inside = lambda o: R is None or all(R[i] <= o[i] <= R[i + 3] for i in range(3))
    ents = [e for e in m['entities'] if inside(e['origin'])]
    props = [e for e in ents if e['class'] == 'prop']
    lights = [e for e in ents if e['class'] == 'light']
    print(f"# {m['name']}: {len(m['brushes'])} brushes, {len(props)} props, {len(lights)} lights")
    print('settings:', json.dumps(m.get('settings', {}).get('fog', {})))

    # ---- props by model and by folder
    byModel = collections.Counter(short(e['props']['model']) for e in props)
    byFolder = collections.Counter(k.split('/')[0] for k in byModel.elements())
    print('\n## Props by folder'); print(', '.join(f'{k} {v}' for k, v in byFolder.most_common()))
    print(f'\n## Props by model (top {a.top * 2} of {len(byModel)})')
    for k, v in byModel.most_common(a.top * 2):
        print(f'{v:5d}  {k}')

    # ---- how pieces of a family sit next to each other
    if a.pairs:
        fam = [e for e in props if a.pairs in e['props']['model']]
        print(f'\n## Neighbours within the "{a.pairs}" family ({len(fam)} pieces): piece → neighbour at (forward, left, up) in the piece\'s frame, relative yaw')
        pat = collections.Counter()
        for e in fam:
            near = sorted(((sum((e['origin'][i] - o['origin'][i]) ** 2 for i in range(3)), o) for o in fam if o is not e), key=lambda t: t[0])[:4]
            for d2, o in near:
                if d2 > 400 ** 2:
                    continue
                rel = q(local(e, o['origin']))
                dyaw = int(round(((o.get('angles') or [0, 0, 0])[1] - (e.get('angles') or [0, 0, 0])[1]) % 360 / 15) * 15) % 360
                tilt = any(abs(v) > 1 for v in ((e.get('angles') or [0, 0, 0])[0], (e.get('angles') or [0, 0, 0])[2]))
                if not tilt:
                    pat[(short(e['props']['model']).split('/')[-1], short(o['props']['model']).split('/')[-1], rel, dyaw)] += 1
        for (ma, mb, rel, dyaw), n in pat.most_common(a.top * 3):
            print(f'{n:4d}  {ma} → {mb} at {rel} yaw {dyaw}')

    # ---- lights
    print('\n## Lights: class, colour + brightness, cones, falloff')
    lc = collections.Counter()
    for e in lights:
        s = e['props']['source']
        lc[(s.get('classname'), s.get('_light'), s.get('_inner_cone', ''), s.get('_cone', ''), s.get('_fifty_percent_distance', ''), s.get('_zero_percent_distance', ''), s.get('_quadratic_attn', ''), s.get('_linear_attn', ''), s.get('_constant_attn', ''))] += 1
    for k, v in lc.most_common(a.top):
        print(f'{v:4d}  {k[0]:10s} _light "{k[1]}" cone {k[2]}/{k[3]} 50%/0% {k[4]}/{k[5]} attn q{k[6]} l{k[7]} c{k[8]}')
    # Which model each light sits at, and where in that model's frame.
    print('\n## Lights by the nearest prop (within 96 units): model, light class, offset in the prop\'s frame')
    fx = collections.Counter()
    for e in lights:
        best = min(props, key=lambda p: sum((p['origin'][i] - e['origin'][i]) ** 2 for i in range(3)), default=None)
        if best is None or sum((best['origin'][i] - e['origin'][i]) ** 2 for i in range(3)) > 96 ** 2:
            fx[('(no prop near)', e['props']['source'].get('classname'), None)] += 1
            continue
        fx[(short(best['props']['model']), e['props']['source'].get('classname'), q(local(best, e['origin']), 8))] += 1
    for (mdl, cls, off), n in fx.most_common(a.top):
        print(f'{n:4d}  {mdl}  {cls}  {off}')

    # ---- glows and beams
    for cls in ('glow', 'beam'):
        g = [e for e in ents if e['class'] == cls]
        if not g:
            continue
        c = collections.Counter((e['props'].get('tex', '').split('/')[-1], e['props'].get('size', e['props'].get('width')), tuple(e['props'].get('color', [])), e['props'].get('brightness'), e['props'].get('length')) for e in g)
        print(f'\n## {cls}s ({len(g)}): texture, size/width, colour, brightness, length')
        for k, v in c.most_common(12):
            print(f'{v:4d}  {k}')

    # ---- other kept entities
    oc = collections.Counter(e['class'] for e in ents if e['class'].startswith('source_'))
    print('\n## Other entities:', ', '.join(f'{k[7:]} {v}' for k, v in oc.most_common()))
    ropes = [e for e in ents if e['class'] in ('source_move_rope', 'source_keyframe_rope')]
    if ropes:
        rc = collections.Counter((e['props']['source'].get('RopeMaterial'), e['props']['source'].get('Width'), e['props']['source'].get('Slack')) for e in ropes)
        print('ropes (material, width, slack):', rc.most_common(8))

    # ---- brushes: materials by visible area, and brush sizes for beam-like materials
    area = collections.Counter(); sizes = collections.defaultdict(collections.Counter)
    groups = collections.Counter(b.get('group') or 'world' for b in m['brushes'])
    for b in m['brushes']:
        if b.get('type') != 'convex':
            continue
        pts = brush_points(b['planes'])
        if not pts or (R and not inside([sum(p[i] for p in pts) / len(pts) for i in range(3)])):
            continue
        ext = poly_area(pts)
        for i, pl in enumerate(b['planes']):
            f = b['faces'].get(str(i))
            if not f or f['tex'].startswith('tools/'):
                continue
            # A side's area, roughly: the box extents across its normal's two other axes.
            k = max(range(3), key=lambda j: abs(pl[j]))
            o = [j for j in range(3) if j != k]
            area[f['tex']] += ext[o[0]] * ext[o[1]]
        texs = {f['tex'] for f in b['faces'].values() if not f['tex'].startswith('tools/')}
        for t in texs:
            if any(w in t for w in ('squarebeam', 'truss', 'beam', 'grate', 'railing')):
                sizes[t][tuple(sorted(int(round(v / 4) * 4) for v in ext))] += 1
    print('\n## Brush groups:', dict(groups))
    print(f'\n## Materials by visible area (top {a.top}), 1000 sq units')
    for t, v in area.most_common(a.top):
        print(f'{v / 1000:9.0f}  {t}')
    for t, c in sizes.items():
        print(f'\nbrush sizes with {t}:', ', '.join(f'{k}×{v}' for k, v in c.most_common(10)))


if __name__ == '__main__':
    main()
