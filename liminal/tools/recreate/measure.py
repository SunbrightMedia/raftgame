"""
Measure the room of a captured frame (reference/complex, first export) from its own buffers.

  python3 -I tools/recreate/measure.py <export dir of one frame> [out.json] [--world]

Uses: the depth the motion-blur step keeps (linear, in cm; the "Velocity Flatten" step's picture, blue
channel), the G-buffer of the base pass (world normals, material, base colour) and the camera of the view
constants (position, axes, projection). Every pixel becomes a point in the world; points are grouped by the
way they face (the six axis directions) and by their distance along that axis: each group is one plane of
the room (a wall, the floor, the ceiling, a box side). For each plane it prints where it is, how far it
reaches, how many pixels show it, and its material (base colour as sRGB hex, specular, roughness).

Coordinates are our map's: inches, z up, x = the game's y, y = the game's x (one swap turns the game's
left-handed world into ours), with the camera's foot point at x = y = 0 and the floor (the largest
upward-facing plane) at z = 0. The camera's yaw/pitch are given the same way, ready for MapBuilder.start
and the studio's `views` pose. With --world, x and y are the game's world position instead (so frames
taken in the same room line up), and the camera's foot point is printed.
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image

WORLD = '--world' in sys.argv
sys.argv = [a for a in sys.argv if a != '--world']
D = sys.argv[1].rstrip('/')
W, H = 1008, 756            # the view inside the 1344x756 targets
CM = 1 / 2.54


def passes():
    out = {}
    for pf in sorted(glob.glob(D + '/passes/*.json')):
        p = json.load(open(pf))
        m = ' / '.join(p.get('markers', []))
        if 'BasePass' in m and p.get('images'):
            out['base'] = p
        if 'Velocity Flatten' in m and p.get('images'):
            out['depth'] = p
        if 'BatchedLights' in m:
            out['lights'] = p
    return out


P = passes()


def load(im):
    a = np.asarray(Image.open(os.path.join(D, im['file'])).convert('RGB')).astype(np.float64) / 255
    return a * (im['white'] - im['black']) + im['black']


# ---- camera (the view constants of the light step's pixel shader)
cs = P['lights']['constants']['ps']
view = [b for b in cs[list(cs)[0]] if b['block'] == 'cbuffer0'][0]
rows = [v['v'] for v in view['vars']]
r = np.array(rows[20][:3]); f = np.array(rows[22][:3])
u = np.cross(r, f)
if u[2] < 0:
    u = -u
P00, P11 = rows[32][0], rows[33][1]
cam = np.array(rows[55][:3])          # world position (cm)

# ---- buffers
depth = load(P['depth']['images'][0])[:H, :W, 2]
imgs = {i['file'].split('_out')[1][0]: i for i in P['base']['images']}
nrm = load(imgs['1'])[:H, :W] * 2 - 1
mat = load(imgs['2'])[:H, :W]
base = load(imgs['3'])[:H, :W]
ys, xs = np.mgrid[0:H, 0:W]
nx = (xs + 0.5) / W * 2 - 1
ny = 1 - (ys + 0.5) / H * 2
ray = (nx / P00)[..., None] * r + (ny / P11)[..., None] * u + f
pts = cam + depth[..., None] * ray            # world, cm
valid = (depth > 1) & (depth < P['depth']['images'][0]['white'] * 0.995)

# ---- planes: group by facing axis, then by distance along it
ax = np.argmax(np.abs(nrm), -1)
sg = np.sign(np.take_along_axis(nrm, ax[..., None], -1)[..., 0])
good = valid & (np.abs(np.take_along_axis(nrm, ax[..., None], -1)[..., 0]) > 0.9)
step = P['depth']['images'][0]['white'] / 255.0   # depth step of the 8-bit picture (cm)
planes = []
for a in range(3):
    for s in (-1, 1):
        m = good & (ax == a) & (sg == s)
        if m.sum() < 400:
            continue
        c = pts[..., a][m]
        lo, hi = np.floor(c.min()), np.ceil(c.max()) + 1
        hist, edges = np.histogram(c, bins=np.arange(lo, hi + 1, 1.0))
        k = max(3, int(step))
        sm = np.convolve(hist, np.ones(2 * k + 1), 'same')
        used = np.zeros_like(hist, bool)
        order = np.argsort(-sm)
        for i in order:
            if sm[i] < 400 or used[max(0, i - 3 * k):i + 3 * k + 1].any():
                continue
            used[max(0, i - 3 * k):i + 3 * k + 1] = True
            sel = m & (np.abs(pts[..., a] - edges[i]) < 3 * k)
            q = pts[sel]
            pos = np.median(q[:, a])
            b = base[sel].mean(0)
            planes.append({'axis': 'xyz'[a], 'sign': s, 'pos_world': float(pos), 'px': int(sel.sum()),
                           'lo': np.percentile(q, 1, axis=0).tolist(), 'hi': np.percentile(q, 99, axis=0).tolist(),
                           'base_srgb': '#%02x%02x%02x' % tuple(int(round(v * 255)) for v in b),
                           'specular': float(mat[sel][:, 1].mean()), 'roughness': float(mat[sel][:, 2].mean())})

floor = max((p for p in planes if p['axis'] == 'z' and p['sign'] > 0), key=lambda p: p['px'])
fz = floor['pos_world']


def ours(v):
    """world cm -> our inches: x = game y, y = game x, camera's foot at x = y = 0 (or the world's origin), floor at z = 0"""
    ox, oy = (0.0, 0.0) if WORLD else (cam[1], cam[0])
    return [(v[1] - ox) * CM, (v[0] - oy) * CM, (v[2] - fz) * CM]


AXIS = {'x': 'y', 'y': 'x', 'z': 'z'}       # game axis -> our axis
fo = np.array([f[1], f[0], f[2]])
yaw = float(np.degrees(np.arctan2(fo[1], fo[0])))
pitch = float(np.degrees(np.arcsin(-fo[2])))     # positive = looking down
eye = (cam[2] - fz) * CM
print('camera: eye %.1f in above the floor (%.1f cm), yaw %.2f deg, pitch %.2f deg (down +), world %s cm, floor at world z %.1f cm' % (eye, cam[2] - fz, yaw, pitch, np.round(cam, 1).tolist(), fz))
print('camera foot point (ours, in): %.1f %.1f' % tuple(ours([cam[0], cam[1], fz])[:2]))
print('projection %.4f / %.4f; depth step %.1f cm' % (P00, P11, step))
print('%-4s %-9s %8s %7s | %-32s | %-9s %5s %5s' % ('ax', 'faces', 'at (in)', 'pixels', 'reaches (other two axes, in)', 'base', 'spec', 'rough'))
out = []
for p in sorted(planes, key=lambda p: (AXIS[p['axis']], p['sign'], p['pos_world'])):
    a = AXIS[p['axis']]
    lo, hi = ours(p['lo']), ours(p['hi'])
    at = ours([p['pos_world'] if p['axis'] == 'x' else cam[0], p['pos_world'] if p['axis'] == 'y' else cam[1], p['pos_world'] if p['axis'] == 'z' else fz])['xyz'.index(a)]
    others = [k for k in 'xyz' if k != a]
    span = '  '.join('%s %6.1f..%6.1f' % (k, min(lo['xyz'.index(k)], hi['xyz'.index(k)]), max(lo['xyz'.index(k)], hi['xyz'.index(k)])) for k in others)
    sign = p['sign'] if p['axis'] == 'z' else p['sign']   # (the swap keeps each axis' direction)
    face = ('+' if sign > 0 else '-') + a
    print('%-4s %-9s %8.1f %7d | %-32s | %-9s %5.2f %5.2f' % (a, 'faces ' + face, at, p['px'], span, p['base_srgb'], p['specular'], p['roughness']))
    out.append({'axis': a, 'faces': face, 'at': at, 'px': p['px'], 'span': {k: [min(lo['xyz'.index(k)], hi['xyz'.index(k)]), max(lo['xyz'.index(k)], hi['xyz'.index(k)])] for k in others},
                'base': p['base_srgb'], 'specular': p['specular'], 'roughness': p['roughness']})
# ---- light panels: what the base pass drew as light (emissive), grouped into blobs
emis = load(imgs['0'])[:H, :W].mean(-1)
hot = valid & (emis > max(0.5, np.percentile(emis[valid], 99.5) * 0.5)) & (base.mean(-1) < 0.05)
lab = np.zeros((H, W), int)
blobs = []
for y0, x0 in zip(*np.nonzero(hot)):
    if lab[y0, x0]:
        continue
    lab[y0, x0] = len(blobs) + 1
    stack, members = [(y0, x0)], []
    while stack:
        y, x = stack.pop()
        members.append((y, x))
        for yy, xx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= yy < H and 0 <= xx < W and hot[yy, xx] and not lab[yy, xx]:
                lab[yy, xx] = len(blobs) + 1
                stack.append((yy, xx))
    blobs.append(members)
panels = []
for mem in blobs:
    if len(mem) < 30:
        continue
    yy, xx = np.array(mem).T
    q = np.array([ours(v) for v in pts[yy, xx]])
    lo, hi = np.percentile(q, 2, axis=0), np.percentile(q, 98, axis=0)
    panels.append({'centre': ((lo + hi) / 2).tolist(), 'size': (hi - lo).tolist(), 'px': len(mem), 'emissive': float(emis[yy, xx].mean())})
print('light panels (emissive blobs): centre x y z (in), size x y (in), pixels, mean emissive (scene units)')
for pn in sorted(panels, key=lambda p: p['centre'][0]):
    print('  centre %7.1f %7.1f %6.1f | size %5.1f %5.1f | %5d px | %.2f' % (*pn['centre'], pn['size'][0], pn['size'][1], pn['px'], pn['emissive']))
if len(sys.argv) > 2:
    json.dump({'eye': eye, 'yaw': yaw, 'pitch': pitch, 'camera_world_cm': cam.tolist(), 'floor_world_cm': fz, 'planes': out, 'panels': panels},
              open(sys.argv[2], 'w'), indent=1)
