# Run with Blender's Python (bpy) and -I.
"""Convert every .exr in a directory to raw float32 RGBA (.f32, top row first) next to it, and write
sizes.json {name: [w, h]}.   bpyenv/bin/python -I tools/blender/bl_exr_dir.py DIR"""
import sys, os, glob, json, array
import bpy
d = os.path.abspath(sys.argv[-1])
sizes = {}
for f in sorted(glob.glob(os.path.join(d, '*.exr'))):
    out = f[:-4] + '.f32'
    if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(f):
        continue
    im = bpy.data.images.load(f)
    w, h = im.size
    px = array.array('f', im.pixels[:])
    rows = [px[(h - 1 - y) * w * 4:(h - y) * w * 4] for y in range(h)]
    with open(out, 'wb') as fo:
        for r in rows:
            r.tofile(fo)
    sizes[os.path.basename(out)] = [w, h]
    bpy.data.images.remove(im)
old = {}
p = os.path.join(d, 'sizes.json')
if os.path.exists(p):
    old = json.load(open(p))
old.update(sizes)
json.dump(old, open(p, 'w'))
print('converted', len(sizes))
