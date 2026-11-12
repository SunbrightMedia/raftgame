# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Sample every curve (RGB Curves, Float Curve, Hue Correct) in a project's compositor node groups with Blender's own
curve evaluation, so a copy can use the exact shape: OUT.json {"<tree>/<node>": {"curves": [[y...]...], "x0", "x1", "n",
"slope_lo": [...], "slope_hi": [...]}}. x runs from x0 to x1 in n steps; outside it Blender extends with the slopes given.
usage: bpyenv/bin/python -I tools/blender/bl_curves.py PROJECT.blend OUT.json [N=4097]"""
import sys, os, json
import bpy
proj, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
N = int(sys.argv[3]) if len(sys.argv) > 3 else 4097
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=proj, load_ui=False, use_scripts=False)
res = {}
trees = [(ng.name, ng) for ng in bpy.data.node_groups]
sc = bpy.context.scene
if getattr(sc, 'compositing_node_group', None): trees.append(('', sc.compositing_node_group))
for tname, t in trees:
    for n in t.nodes:
        mp = getattr(n, 'mapping', None)
        if mp is None or not hasattr(mp, 'curves'): continue
        mp.initialize()
        x0, x1 = mp.clip_min_x, mp.clip_max_x
        if not mp.use_clip: x0, x1 = min(0.0, x0), max(1.0, x1)
        xs = [x0 + (x1 - x0) * i / (N - 1) for i in range(N)]
        curves, lo, hi = [], [], []
        for c in mp.curves:
            ys = [mp.evaluate(c, x) for x in xs]
            curves.append(ys)
            e = (x1 - x0) * 0.25
            lo.append((mp.evaluate(c, x0) - mp.evaluate(c, x0 - e)) / e)
            hi.append((mp.evaluate(c, x1 + e) - mp.evaluate(c, x1)) / e)
        res[f'{tname}/{n.name}'] = {'type': n.bl_idname, 'x0': x0, 'x1': x1, 'n': N, 'curves': curves, 'slope_lo': lo, 'slope_hi': hi,
                                    'extend': getattr(mp, 'extend', None), 'black': list(mp.black_level), 'white': list(mp.white_level)}
json.dump(res, open(out, 'w'))
print('curves', len(res), list(res)[:20])
