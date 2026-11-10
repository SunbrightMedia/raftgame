"""
Draw a map's plan (top view) or a section (side view) as a PNG: brush
outlines by material kind, props as their rotated bounds, lights as dots.
For studying a layout at a glance.

    python3 tools/source/plan.py maps/p2ref/x.json out.png [--axis z|x|y] [--lo N --hi N] [--scale 0.25] [--box x0,y0,x1,y1] [--labels]

--axis: the view direction (z = plan). --lo/--hi: keep only what lies in this
range along the view axis (a slice). --scale: pixels per unit.
"""
import argparse, glob, itertools, json, math, os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))


def brush_points(planes):
    pts = []
    for a, b, c in itertools.combinations(planes, 3):
        m = [a[:3], b[:3], c[:3]]
        det = (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
        if abs(det) < 1e-9:
            continue
        d = [a[3], b[3], c[3]]
        def rep(col):
            mm = [row[:] for row in m]
            for r in range(3):
                mm[r][col] = d[r]
            return (mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1]) - mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0]) + mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0]))
        p = [rep(0) / det, rep(1) / det, rep(2) / det]
        if all(sum(q[i] * p[i] for i in range(3)) <= q[3] + 0.05 for q in planes):
            pts.append(p)
    return pts


def hull2(pts):
    pts = sorted(set((round(x, 2), round(y, 2)) for x, y in pts))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def axes(angles):
    p, y, r = (math.radians(a) for a in (angles or [0, 0, 0]))
    sp, cp, sy, cy, sr, cr = math.sin(p), math.cos(p), math.sin(y), math.cos(y), math.sin(r), math.cos(r)
    f = [cp * cy, cp * sy, -sp]
    l = [sr * sp * cy - cr * sy, sr * sp * sy + cr * cy, sr * cp]
    u = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp]
    return f, l, u


def model_bounds():
    out = {}
    for f in glob.glob(os.path.join(ROOT, 'models/**/*.json'), recursive=True):
        try:
            h = json.load(open(f))
        except Exception:
            continue
        if h.get('format') == 'liminal-mesh':
            out[h['source'].lower()] = h['bounds']
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('map'); ap.add_argument('out')
    ap.add_argument('--axis', default='z')
    ap.add_argument('--lo', type=float, default=-1e9); ap.add_argument('--hi', type=float, default=1e9)
    ap.add_argument('--scale', type=float, default=0.25)
    ap.add_argument('--box', default=None)
    ap.add_argument('--labels', action='store_true')
    a = ap.parse_args()
    m = json.load(open(a.map))
    k = 'xyz'.index(a.axis)
    ia, ib = [(1, 2), (0, 2), (0, 1)][k]          # the two axes drawn
    bounds = model_bounds()
    shapes = []                                     # (depth, kind, polygon, label)
    for b in m['brushes']:
        if b.get('type') != 'convex':
            lo, hi = b['min'], b['max']
            pts = [[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
            texs = [b.get('tex', '')]
        else:
            pts = brush_points(b['planes'])
            texs = [f.get('tex', '') for f in b['faces'].values()]
        if not pts:
            continue
        dmin, dmax = min(p[k] for p in pts), max(p[k] for p in pts)
        if dmax < a.lo or dmin > a.hi:
            continue
        vis = [t for t in texs if not t.startswith('tools/')]
        kind = 'clip' if not vis else 'beam' if any('squarebeam' in t or 'truss' in t for t in vis) else 'glass' if any('glass' in t for t in vis) else 'grate' if any('grate' in t for t in vis) else 'detail' if b.get('group') == 'func_detail' else 'ent' if b.get('group') else 'world'
        shapes.append((dmax, kind, hull2([(p[ia], p[ib]) for p in pts]), None))
    for e in m['entities']:
        if e['class'] == 'prop':
            name = e['props']['model'].lower()
            bb = bounds.get(name)
            if not bb:
                continue
            s = e['props'].get('scale', 1)
            f, l, u = axes(e.get('angles'))
            o = e['origin']
            pts = [[o[i] + s * (f[i] * x + l[i] * y + u[i] * z) for i in range(3)] for x in (bb[0][0], bb[1][0]) for y in (bb[0][1], bb[1][1]) for z in (bb[0][2], bb[1][2])]
            dmin, dmax = min(p[k] for p in pts), max(p[k] for p in pts)
            if dmax < a.lo or dmin > a.hi:
                continue
            shapes.append((dmax, 'prop', hull2([(p[ia], p[ib]) for p in pts]), os.path.basename(name)[:-4]))
        elif e['class'] == 'light':
            o = e['origin']
            if a.lo <= o[k] <= a.hi:
                shapes.append((1e9, 'light', [(o[ia], o[ib])], None))
    if not shapes:
        raise SystemExit('nothing to draw')
    if a.box:
        x0, y0, x1, y1 = (float(v) for v in a.box.split(','))
    else:
        xs = [p[0] for s in shapes for p in s[2]]; ys = [p[1] for s in shapes for p in s[2]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, H = int((x1 - x0) * a.scale) + 1, int((y1 - y0) * a.scale) + 1
    im = Image.new('RGB', (W, H), (14, 15, 18))
    d = ImageDraw.Draw(im, 'RGBA')
    px = lambda p: ((p[0] - x0) * a.scale, H - 1 - (p[1] - y0) * a.scale)
    col = {'world': ((70, 74, 82, 255), (120, 126, 138, 255)), 'detail': ((58, 70, 64, 255), (110, 135, 120, 255)), 'ent': ((70, 60, 84, 255), (140, 120, 170, 255)),
           'beam': ((120, 70, 40, 255), (200, 120, 70, 255)), 'grate': ((60, 80, 90, 200), (110, 150, 170, 255)), 'glass': ((40, 70, 110, 120), (90, 150, 220, 255)),
           'clip': ((0, 0, 0, 0), (90, 40, 40, 160)), 'prop': ((40, 90, 110, 110), (90, 200, 235, 255))}
    for depth, kind, poly, label in sorted(shapes, key=lambda s: s[0]):
        if kind == 'light':
            x, y = px(poly[0])
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=(255, 230, 120, 255))
            continue
        if len(poly) < 3:
            continue
        fill, line = col[kind]
        pts = [px(p) for p in poly]
        d.polygon(pts, fill=fill if fill[3] else None, outline=line)
        if a.labels and label:
            cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
            d.text((cx, cy), label, fill=(200, 230, 240, 255))
    # 512-unit grid ticks along the edges.
    for v in range(int(math.ceil(x0 / 512)) * 512, int(x1) + 1, 512):
        x = (v - x0) * a.scale
        d.line([x, H - 8, x, H], fill=(200, 200, 200, 255)); d.text((x + 2, H - 20), str(v), fill=(160, 160, 160, 255))
    for v in range(int(math.ceil(y0 / 512)) * 512, int(y1) + 1, 512):
        y = H - 1 - (v - y0) * a.scale
        d.line([0, y, 8, y], fill=(200, 200, 200, 255)); d.text((10, y - 6), str(v), fill=(160, 160, 160, 255))
    im.save(a.out)
    print(a.out, im.size, f'{len(shapes)} shapes, {"xyz"[ia]} {x0:.0f}..{x1:.0f}, {"xyz"[ib]} {y0:.0f}..{y1:.0f}')


if __name__ == '__main__':
    main()
