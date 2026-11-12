# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Blender's own compositor output after each step of a project's chain, for one input image.

    bpyenv/bin/python -I tools/blender/bl_comp_ref.py PROJECT.blend INPUT.exr OUT_DIR [FRAME=1]

Opens the project (scripts off), feeds INPUT (scene linear) to its compositor in place of the render, and writes
OUT_DIR/stage_<k>_<node>.exr: the image after the k-th node of the main chain (linear, no view transform).
"""
import sys, os
import bpy
proj, inp, out = (os.path.abspath(a) for a in sys.argv[1:4])
frame = int(sys.argv[4]) if len(sys.argv) > 4 else 1
os.makedirs(out, exist_ok=True)
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=proj, load_ui=False, use_scripts=False)
sc = bpy.context.scene
for ob in list(bpy.data.objects):
    if ob.type != 'CAMERA': ob.hide_render = True
sc.cycles.device = 'CPU'; sc.cycles.samples = 1; sc.cycles.use_denoising = False
sc.render.compositor_device = 'CPU'; sc.render.use_compositing = True
sc.frame_set(frame)
tree = sc.compositing_node_group
nodes = tree.nodes
rl = nodes['Render Layers']
image = bpy.data.images.load(inp); image.colorspace_settings.name = 'Linear Rec.709'
img_node = nodes.new('CompositorNodeImage'); img_node.image = image
# rewire: whatever read the render now reads the image
for l in list(tree.links):
    if l.from_node == rl:
        to = l.to_socket; tree.links.remove(l); tree.links.new(img_node.outputs['Image'], to)
gout = next(n for n in nodes if n.bl_idname == 'NodeGroupOutput')
# the main chain, from the image to the output
chain, cur = [], img_node
while True:
    nxt = [l.to_node for l in tree.links if l.from_node == cur and l.to_node.bl_idname not in ('CompositorNodeViewer', 'NodeGroupOutput')]
    if not nxt: break
    cur = nxt[0]; chain.append(cur)
print('chain', [n.name + (':' + n.node_tree.name if getattr(n, 'node_tree', None) else '') for n in chain])
sc.render.image_settings.media_type = 'IMAGE'; sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
sc.render.image_settings.color_management = 'FOLLOW_SCENE'
for k, n in enumerate([img_node] + chain):
    for l in list(tree.links):
        if l.to_node == gout: tree.links.remove(l)
    tree.links.new(n.outputs[0], gout.inputs[0])
    tag = (n.node_tree.name if getattr(n, 'node_tree', None) else n.name).replace(' ', '_').replace('/', '_')
    sc.render.filepath = os.path.join(out, f'stage_{k}_{tag}.exr')
    bpy.ops.render.render(write_still=True)
    print('stage', k, tag, flush=True)
