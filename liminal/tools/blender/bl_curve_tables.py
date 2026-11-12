# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Exact curve-mapping tables of every Float Curve, RGB Curves and Hue Correct node in a project, as Blender
evaluates them.

    bpyenv/bin/python -I tools/blender/bl_curve_tables.py PROJECT.blend OUT.json

Blender evaluates a curve from a 257-entry table over [mintable, maxtable] (the clip range widened to the points):
fi = (x - mintable) * range, linear between entries, and a straight line past the ends. For each table entry
we evaluate at an x where fi is exactly that index, so the stored value is the table's own (bit for bit). The
slopes past the ends are measured far out. Keys: '<tree name>/<node name>'.
"""
import sys, os, json, struct
import bpy

proj, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=proj, load_ui=False, use_scripts=False)


def f32(x):
    return struct.unpack('f', struct.pack('f', x))[0]


def nextf(x, d):
    b = struct.unpack('I', struct.pack('f', x))[0]
    if x == 0.0:
        return f32(1e-45) if d > 0 else -f32(1e-45)
    b += (1 if (x > 0) == (d > 0) else -1)
    return struct.unpack('f', struct.pack('I', b))[0]


def table_of(mp, cm, k):
    global unresolved
    clip_min, clip_max = mp.clip_min_x, mp.clip_max_x
    xs = [p.location[0] for p in cm.points]
    mn, mx = f32(clip_min), f32(clip_max)
    for x in xs:
        mn = min(mn, f32(x)); mx = max(mx, f32(x))
    trange = f32(mx - mn)
    rloc = f32(f32(1.0 / 256.0) * trange)
    rng = f32(1.0 / rloc)
    ys, tx = [], []
    for a in range(257):
        x = f32(mn + f32(rloc * float(a)))
        tx.append(x)
        # find x' near x with f32((x' - mn) * rng) == a exactly
        best = None
        cand = x
        for _ in range(64):
            fi = f32(f32(cand - mn) * rng)
            if fi == float(a):
                best = cand; break
            cand = nextf(cand, 1 if fi < a else -1)
        if best is not None:
            ys.append(mp.evaluate(cm, best))
            continue
        # no x gives fi == a: use the last x below (fi in [a-1, a)), where the value mixes y[a-1] (known) and
        # y[a]; solve for y[a] and keep the float32 value that reproduces Blender's result exactly
        lo = x
        while f32(f32(lo - mn) * rng) >= a:
            lo = nextf(lo, -1)
        fi = f32(f32(lo - mn) * rng); fr = f32(fi - float(a - 1))
        v = mp.evaluate(cm, lo)
        y0 = ys[a - 1]
        guess = (v - (1.0 - fr) * y0) / fr if fr != 0 else v
        g = f32(guess); found = None
        cands = [g]
        up = dn = g
        for _ in range(40):
            up = nextf(up, 1); dn = nextf(dn, -1); cands += [up, dn]
        for c in cands:
            if f32(f32(f32(1.0 - fr) * y0) + f32(fr * c)) == v:
                found = c; break
        ys.append(found if found is not None else g)
        unresolved.append((a, found is None))
    first, last = (tx[0], ys[0]), (tx[256], ys[256])
    far = 1048576.0
    s_in = (mp.evaluate(cm, f32(first[0] - far)) - first[1]) / -far
    s_out = (mp.evaluate(cm, f32(last[0] + far)) - last[1]) / far
    return {'mintable': mn, 'maxtable': mx, 'rangeloc': rloc, 'range': rng, 'x': tx, 'y': ys,
            'slope_in': s_in, 'slope_out': s_out}


res = {}
unresolved = []
trees = [(t.name, t) for t in bpy.data.node_groups]
sc = bpy.context.scene
for name, t in trees:
    for n in t.nodes:
        mp = getattr(n, 'mapping', None)
        if mp is None or not hasattr(mp, 'curves'):
            continue
        mp.initialize()
        e = {'type': n.bl_idname, 'use_clip': mp.use_clip, 'extend': mp.extend,
             'clip': [mp.clip_min_x, mp.clip_min_y, mp.clip_max_x, mp.clip_max_y],
             'black': list(mp.black_level), 'white': list(mp.white_level), 'curves': []}
        for k, cm in enumerate(mp.curves):
            e['curves'].append(table_of(mp, cm, k))
        res[name + '/' + n.name] = e
json.dump(res, open(out, 'w'))
print('curve mappings', len(res), 'solved entries', len(unresolved), 'not exact', sum(1 for a, bad in unresolved if bad))
