# Run with Blender's Python (bpy) and -I.
"""EXR (or any image Blender reads) -> raw float32 RGBA, top row first. usage: bl_exr2f32.py IN OUT.f32 -> prints W H"""
import sys, numpy as np, bpy
im = bpy.data.images.load(sys.argv[1]); im.colorspace_settings.name = 'Non-Color'
w, h = im.size
a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
a = a.reshape(h, w, 4)[::-1]          # Blender stores bottom row first
a.astype('<f4').tofile(sys.argv[2])
print(w, h)
