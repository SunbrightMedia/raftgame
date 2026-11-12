# Run with Blender's Python (bpy) and -I.
"""Measure Blender's display pipeline as 3D LUTs, by sending a grid of colours through it.

    bpyenv/bin/python -I tools/blender/bl_view_lut.py OUT_DIR [N=65] [--view AgX --wb 9000,20 --look None]

  view_N.f32   the whole view: scene-linear Rec.709 -> display sRGB (encoded, 0..1), with the given white
               balance, look, exposure 0 and gamma 1. Grid: log2 of each channel from LO to HI (below), N steps.
  filmiclog_N.f32  Blender's "Linear Rec.709 -> Filmic Log" conversion (it includes Filmic's highlight
               desaturation cube, so it is not just a log curve), on the same grid.
Each file: N*N*N RGB float32, red fastest, then green, then blue. LO = -12.473931188, HI = 12.526068812 (log2).
"""
import sys, os, struct, math
import numpy as np
import bpy

out = os.path.abspath(sys.argv[1]); os.makedirs(out, exist_ok=True)
args = sys.argv[2:]
N = int(args[0]) if args and args[0].isdigit() else 65
def opt(name, default):
    return args[args.index(name) + 1] if name in args else default
view, look = opt('--view', 'AgX'), opt('--look', 'None')
wb = opt('--wb', '9000,20')
LO, HI = -12.473931188, 12.526068812

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
vs = sc.view_settings
sc.display_settings.display_device = 'sRGB'
vs.view_transform = view; vs.look = look; vs.exposure = 0.0; vs.gamma = 1.0; vs.use_curve_mapping = False
if wb != 'off':
    t, tint = (float(v) for v in wb.split(','))
    vs.use_white_balance = True; vs.white_balance_temperature = t; vs.white_balance_tint = tint
else:
    vs.use_white_balance = False
sc.render.dither_intensity = 0.0

g = np.linspace(LO, HI, N)
r, gg, b = np.meshgrid(g, g, g, indexing='ij')          # r slowest here; reorder below
lin = np.stack([2.0 ** r, 2.0 ** gg, 2.0 ** b], -1)        # [ri, gi, bi, 3]
lin = lin.transpose(2, 1, 0, 3).reshape(-1, 3)            # red fastest, then green, then blue
W = N * N; H = N
px = np.ones((H * W, 4), np.float32); px[:, :3] = lin
img = bpy.data.images.new('grid', W, H, alpha=True, float_buffer=True)
img.colorspace_settings.name = 'Linear Rec.709'
img.pixels.foreach_set(px.ravel())

def read_back(path):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'
    a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(-1, 4)[:, :3]

# 1) the view, written as a 16-bit PNG "as render"
sc.render.image_settings.media_type = 'IMAGE'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_depth = '16'; sc.render.image_settings.color_mode = 'RGB'
p = os.path.join(out, f'_view_{N}.png')
img.save_render(p, scene=sc)
v = read_back(p)
v.astype('<f4').tofile(os.path.join(out, f'view_{N}.f32'))

# 2) Linear -> Filmic Log through the compositor's Convert Colorspace node: done by colour-managing the grid
#    image itself (OCIO), image stored as float.
img2 = bpy.data.images.new('grid2', W, H, alpha=True, float_buffer=True)
img2.colorspace_settings.name = 'Linear Rec.709'
img2.pixels.foreach_set(px.ravel())
sc2 = sc
sc2.render.image_settings.file_format = 'OPEN_EXR'; sc2.render.image_settings.color_depth = '32'
sc2.render.image_settings.color_management = 'OVERRIDE'
sc2.render.image_settings.linear_colorspace_settings.name = 'Filmic Log'
p2 = os.path.join(out, f'_flog_{N}.exr')
img2.save_render(p2, scene=sc2)
im2 = bpy.data.images.load(p2); im2.colorspace_settings.name = 'Non-Color'
a2 = np.empty(im2.size[0] * im2.size[1] * 4, np.float32); im2.pixels.foreach_get(a2)
a2.reshape(-1, 4)[:, :3].astype('<f4').tofile(os.path.join(out, f'filmiclog_{N}.f32'))
print('wrote', out, 'N', N, 'view range', float(v.min()), float(v.max()))
