# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Blender's output of ONE node of a project's compositor, fed with a given image.

    bpyenv/bin/python -I tools/blender/bl_node_ref.py PROJECT.blend NODE INPUT.exr OUT.exr [FRAME=1] [SOCKET=0]

Opens the project (scripts off), builds a new compositor tree: Image(INPUT, scene linear) -> a copy of NODE (same
group or settings) -> output, and writes OUT (linear EXR, 32-bit float). Use it to test one stage at a time with an
exact input, so that a stage's error is never mixed with the error of the stages before it.
"""
import sys, os
import bpy
proj, node_name, inp, out = sys.argv[1], sys.argv[2], os.path.abspath(sys.argv[3]), os.path.abspath(sys.argv[4])
frame = int(sys.argv[5]) if len(sys.argv) > 5 else 1
sock = int(sys.argv[6]) if len(sys.argv) > 6 else 0
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(proj), load_ui=False, use_scripts=False)
sc = bpy.context.scene
for ob in list(bpy.data.objects):
    if ob.type != 'CAMERA': ob.hide_render = True
sc.cycles.device = 'CPU'; sc.cycles.samples = 1; sc.cycles.use_denoising = False
sc.render.compositor_device = 'CPU'; sc.render.use_compositing = True
sc.frame_set(frame)
tree = sc.compositing_node_group
src = tree.nodes[node_name]
image = bpy.data.images.load(inp); image.colorspace_settings.name = 'Linear Rec.709'
img_node = tree.nodes.new('CompositorNodeImage'); img_node.image = image
gout = next(n for n in tree.nodes if n.bl_idname == 'NodeGroupOutput')
# keep the node itself; cut its image input and its output, then wire image -> node -> output
for l in list(tree.links):
    if l.to_node == src and l.to_socket == src.inputs[sock]: tree.links.remove(l)
for l in list(tree.links):
    if l.to_node == gout: tree.links.remove(l)
tree.links.new(img_node.outputs['Image'], src.inputs[sock])
tree.links.new(src.outputs[0], gout.inputs[0])
sc.render.image_settings.media_type = 'IMAGE'; sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_depth = '32'; sc.render.image_settings.exr_codec = 'ZIP'
sc.render.image_settings.color_management = 'FOLLOW_SCENE'
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('wrote', out, flush=True)
