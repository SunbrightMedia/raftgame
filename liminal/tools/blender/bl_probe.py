# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Blender's own values at any socket inside a project's compositor, for one input image.

    bpyenv/bin/python -I tools/blender/bl_probe.py PROJECT.blend INPUT.exr OUT_DIR FRAME PROBE [PROBE ...]

PROBE is MODE:PATH:SOCKET. PATH is the group nodes from the top tree down to the node, joined by '/', for example
'Group.001/Group.002/Mix.001'. SOCKET is an output name or index. INPUT replaces the render (scene linear).
MODE:
  image  the socket's value as an image, realized on the render size (what an output node would show)
  info   the socket's domain from Blender's Image Info node, in three files info<k>_<tag>.exr whose pixels hold
         (Resolution.x, Resolution.y, Dimensions.x), (Dimensions.y, Location.x, Location.y),
         (Scale.x, Scale.y, Rotation). Resolution is the data size, Dimensions the size after the domain's
         transformation. The socket goes through a Scale node of 1 first (it keeps the domain): Image Info
         reads nothing from a pixel node directly.
The project is opened again for each probe, so probes never change each other.
"""
import sys, os
import bpy
proj, inp, out, frame = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]), os.path.abspath(sys.argv[3]), int(sys.argv[4])
probes = sys.argv[5:]
os.makedirs(out, exist_ok=True)
bpy.context.preferences.filepaths.use_scripts_auto_execute = False


def open_project():
    bpy.ops.wm.open_mainfile(filepath=proj, load_ui=False, use_scripts=False)
    sc = bpy.context.scene
    for ob in list(bpy.data.objects):
        if ob.type != 'CAMERA': ob.hide_render = True
    sc.cycles.device = 'CPU'; sc.cycles.samples = 1; sc.cycles.use_denoising = False
    sc.render.compositor_device = 'CPU'; sc.render.use_compositing = True
    sc.frame_set(frame)
    tree = sc.compositing_node_group
    rl = tree.nodes['Render Layers']
    image = bpy.data.images.load(inp); image.colorspace_settings.name = 'Linear Rec.709'
    img = tree.nodes.new('CompositorNodeImage'); img.image = image
    for l in list(tree.links):
        if l.from_node == rl:
            to = l.to_socket; tree.links.remove(l); tree.links.new(img.outputs['Image'], to)
    im = sc.render.image_settings
    im.media_type = 'IMAGE'; im.file_format = 'OPEN_EXR'; im.color_depth = '32'; im.exr_codec = 'ZIP'
    im.color_management = 'FOLLOW_SCENE'
    return sc, tree


def group_output(tree):
    return next(n for n in tree.nodes if n.bl_idname == 'NodeGroupOutput' and (n.is_active_output or True))


def route(tree, names, make_socket):
    """Wire make_socket(inner_tree) to the top output, through each group on the path. A group tree used by
    several nodes is copied first, so only this path changes."""
    if len(names) == 1:
        return make_socket(tree, tree.nodes[names[0]])
    gnode = tree.nodes[names[0]]
    gnode.node_tree = gnode.node_tree.copy()
    inner = gnode.node_tree
    sock = route(inner, names[1:], make_socket)
    gout = group_output(inner)
    for l in list(inner.links):
        if l.to_node == gout and l.to_socket == gout.inputs[0]: inner.links.remove(l)
    inner.links.new(sock, gout.inputs[0])
    return gnode.outputs[0]


def render(sc, tree, sock, path):
    gout = group_output(tree)
    for l in list(tree.links):
        if l.to_node == gout: tree.links.remove(l)
    tree.links.new(sock, gout.inputs[0])
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path, flush=True)


for k, pr in enumerate(probes):
    mode, path, socket = pr.split(':')
    names = path.split('/')
    socket = int(socket) if socket.isdigit() else socket
    tag = path.replace('/', '_').replace(' ', '_') + '_' + str(socket).replace(' ', '_')
    if mode == 'image':
        sc, tree = open_project()
        s = route(tree, names, lambda t, n: n.outputs[socket])
        render(sc, tree, s, os.path.join(out, f'image_{tag}.exr'))
    elif mode == 'info':
        for part in (0, 1, 2):
            sc, tree = open_project()
            def mk(t, n, part=part):
                keep = t.nodes.new('CompositorNodeScale')
                t.links.new(n.outputs[socket], keep.inputs['Image'])
                info = t.nodes.new('CompositorNodeImageInfo')
                t.links.new(keep.outputs[0], info.inputs['Image'])
                cc = t.nodes.new('CompositorNodeCombineColor'); cc.mode = 'RGB'
                sep = {}
                for o in ('Resolution', 'Dimensions', 'Location', 'Scale'):
                    sep[o] = t.nodes.new('ShaderNodeSeparateXYZ'); t.links.new(info.outputs[o], sep[o].inputs[0])
                src = [[(sep['Resolution'], 0), (sep['Resolution'], 1), (sep['Dimensions'], 0)],
                       [(sep['Dimensions'], 1), (sep['Location'], 0), (sep['Location'], 1)],
                       [(sep['Scale'], 0), (sep['Scale'], 1), (info, 'Rotation')]][part]
                for i, (node, o) in enumerate(src):
                    t.links.new(node.outputs[o], cc.inputs[i])
                return cc.outputs[0]
            s = route(tree, names, mk)
            render(sc, tree, s, os.path.join(out, f'info{part}_{tag}.exr'))
    else:
        raise SystemExit('bad mode ' + mode)
