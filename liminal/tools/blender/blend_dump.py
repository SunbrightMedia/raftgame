# Run with Blender's Python (bpy) and -I. Files from elsewhere are untrusted: scripts in them are never run.
"""Full dump of a .blend (scripts NEVER run): objects, meshes, materials (whole node trees), node groups, compositor,
world, lights, cameras, render/colour settings, animation, images (packed ones saved for study).
usage: bpyenv/bin/python -I blend_dump.py FILE.blend OUT_DIR"""
import sys, os, json, math
import bpy

path, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
os.makedirs(out, exist_ok=True)
bpy.context.preferences.filepaths.use_scripts_auto_execute = False
bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
D = bpy.data
sc = bpy.context.scene

def val(x, depth=0):
    if x is None or isinstance(x, (bool, int, str)): return x
    # full precision: Blender stores float32, and repr() of the double keeps it exactly
    if isinstance(x, float): return x if math.isfinite(x) else str(x)
    if hasattr(x, 'bl_rna') and hasattr(x, 'name') and not hasattr(x, '__len__'):
        return f'<{type(x).__name__}:{x.name}>'
    if depth < 3:
        try: return [val(v, depth + 1) for v in x]
        except Exception: pass
    return str(x)

SKIP = {'rna_type', 'location', 'width', 'height', 'dimensions', 'select', 'show_options', 'show_preview', 'hide',
        'show_texture', 'color', 'use_custom_color', 'bl_idname', 'bl_label', 'bl_description', 'bl_icon',
        'bl_static_type', 'bl_width_default', 'bl_width_min', 'bl_width_max', 'bl_height_default', 'bl_height_min',
        'bl_height_max', 'location_absolute', 'warning_propagation', 'is_active_output', 'internal_links'}

def props(obj, skip=SKIP):
    d = {}
    for p in obj.bl_rna.properties:
        k = p.identifier
        if k in skip: continue
        try: v = getattr(obj, k)
        except Exception: continue
        if p.type == 'COLLECTION': continue
        if p.type == 'POINTER':
            if v is not None and hasattr(v, 'name'): d[k] = f'<{type(v).__name__}:{v.name}>'
            continue
        d[k] = val(v)
    return d

def curve_mapping(mp):
    out = {'black': val(mp.black_level), 'white': val(mp.white_level), 'clip': mp.use_clip,
           'clip_min': [mp.clip_min_x, mp.clip_min_y], 'clip_max': [mp.clip_max_x, mp.clip_max_y], 'curves': []}
    for c in mp.curves:
        out['curves'].append([[p.location[0], p.location[1], p.handle_type] for p in c.points])
    try: out['tone'] = mp.tone; out['extend'] = mp.extend
    except Exception: pass
    return out

def image_info(im):
    if im is None: return None
    return {'name': im.name, 'filepath': im.filepath, 'source': im.source, 'size': list(im.size),
            'colorspace': im.colorspace_settings.name, 'alpha_mode': im.alpha_mode, 'packed': bool(im.packed_file)}

def tree(nt):
    if nt is None: return None
    nodes = []
    for n in nt.nodes:
        nd = {'name': n.name, 'type': n.bl_idname, 'label': n.label, 'mute': n.mute,
              'parent': n.parent.name if n.parent else None, 'props': props(n)}
        if getattr(n, 'node_tree', None) is not None: nd['group'] = n.node_tree.name
        if getattr(n, 'image', None) is not None: nd['image'] = image_info(n.image)
        if getattr(n, 'image_user', None) is not None: nd['image_user'] = props(n.image_user)
        cr = getattr(n, 'color_ramp', None)
        if cr is not None:
            nd['ramp'] = {'interp': cr.interpolation, 'mode': cr.color_mode, 'hue': cr.hue_interpolation,
                          'elements': [[e.position, val(e.color)] for e in cr.elements]}
        mp = getattr(n, 'mapping', None)
        if mp is not None and hasattr(mp, 'curves'): nd['curve'] = curve_mapping(mp)
        ei = getattr(n, 'enum_items', None)
        if ei is not None:
            try: nd['enum_items'] = [{'name': e.name, 'description': getattr(e, 'description', ''), 'identifier': getattr(e, 'identifier', None)} for e in ei]
            except Exception as ex: nd['enum_items_err'] = str(ex)
        isi = getattr(n, 'index_switch_items', None)
        if isi is not None:
            try: nd['index_items'] = len(isi)
            except Exception: pass
        tm = getattr(n, 'texture_mapping', None)
        if tm is not None: nd['texture_mapping'] = props(tm)
        nd['inputs'] = []
        for s in n.inputs:
            e = {'name': s.name, 'id': s.identifier, 'type': s.type, 'linked': s.is_linked, 'enabled': s.enabled}
            if hasattr(s, 'default_value'): e['value'] = val(s.default_value)
            nd['inputs'].append(e)
        nd['outputs'] = []
        for s in n.outputs:
            e = {'name': s.name, 'id': s.identifier, 'type': s.type, 'linked': s.is_linked, 'enabled': s.enabled}
            if hasattr(s, 'default_value'): e['value'] = val(s.default_value)
            nd['outputs'].append(e)
        nd['active_output'] = getattr(n, 'is_active_output', None)
        nodes.append(nd)
    links = [{'from': l.from_node.name, 'from_socket': l.from_socket.identifier, 'from_name': l.from_socket.name,
              'to': l.to_node.name, 'to_socket': l.to_socket.identifier, 'to_name': l.to_socket.name,
              'muted': l.is_muted, 'valid': l.is_valid} for l in nt.links]
    iface = []
    if hasattr(nt, 'interface'):
        for it in nt.interface.items_tree:
            if getattr(it, 'item_type', '') == 'SOCKET':
                e = {'name': it.name, 'in_out': it.in_out, 'socket_type': it.socket_type, 'identifier': it.identifier}
                for k in ('default_value', 'min_value', 'max_value', 'subtype', 'description', 'hide_value'):
                    if hasattr(it, k): e[k] = val(getattr(it, k))
                iface.append(e)
    return {'name': nt.name, 'type': nt.bl_idname, 'nodes': nodes, 'links': links, 'interface': iface}

def anim(idb):
    ad = getattr(idb, 'animation_data', None)
    if not ad: return None
    out = {'action': ad.action.name if ad.action else None, 'drivers': [], 'fcurves': []}
    act = ad.action
    fcs = []
    if act is not None:
        try: fcs = list(act.fcurves)
        except Exception:
            try:
                for layer in act.layers:
                    for strip in layer.strips:
                        for cb in strip.channelbags: fcs += list(cb.fcurves)
            except Exception as ex: out['err'] = str(ex)
    for fc in fcs:
        out['fcurves'].append({'path': fc.data_path, 'index': fc.array_index, 'extrapolation': fc.extrapolation,
                               'modifiers': [m.type for m in fc.modifiers],
                               'keys': [[k.co[0], k.co[1], k.interpolation, k.easing,
                                         list(k.handle_left), list(k.handle_right)] for k in fc.keyframe_points]})
    for dr in ad.drivers:
        out['drivers'].append({'path': dr.data_path, 'index': dr.array_index, 'expr': dr.driver.expression})
    return out

R = {'file': os.path.basename(path), 'version': list(D.version)}
r = sc.render
R['scene'] = {'name': sc.name, 'frame': [sc.frame_start, sc.frame_end, sc.frame_current, r.fps, r.fps_base],
              'unit': props(sc.unit_settings), 'camera': sc.camera.name if sc.camera else None,
              'render': props(r), 'image_settings': props(r.image_settings)}
R['cycles'] = props(sc.cycles) if hasattr(sc, 'cycles') else None
R['eevee'] = props(sc.eevee) if hasattr(sc, 'eevee') else None
vs = sc.view_settings
R['color'] = {'view': props(vs), 'display': props(sc.display_settings), 'sequencer': sc.sequencer_colorspace_settings.name}
if vs.use_curve_mapping: R['color']['curve'] = curve_mapping(vs.curve_mapping)
R['view_layers'] = [{'name': vl.name, 'props': props(vl), 'cycles': props(vl.cycles) if hasattr(vl, 'cycles') else None} for vl in sc.view_layers]
R['world'] = {'name': sc.world.name, 'props': props(sc.world), 'tree': tree(sc.world.node_tree)} if sc.world else None
comp = getattr(sc, 'compositing_node_group', None) or getattr(sc, 'node_tree', None)
R['compositor'] = tree(comp)
R['use_nodes'] = getattr(sc, 'use_nodes', None)
R['node_groups'] = {ng.name: tree(ng) for ng in D.node_groups}
R['materials'] = {m.name: {'users': m.users, 'props': props(m), 'tree': tree(m.node_tree) if m.use_nodes else None} for m in D.materials}
R['lights'] = {}
for L in D.lights:
    R['lights'][L.name] = {'props': props(L), 'cycles': props(L.cycles) if hasattr(L, 'cycles') else None,
                           'tree': tree(L.node_tree) if getattr(L, 'use_nodes', False) else None, 'anim': anim(L)}
R['cameras'] = {}
for C in D.cameras:
    R['cameras'][C.name] = {'props': props(C), 'dof': props(C.dof), 'anim': anim(C)}
R['objects'] = []
for ob in D.objects:
    o = {'name': ob.name, 'type': ob.type, 'data': ob.data.name if ob.data else None, 'parent': ob.parent.name if ob.parent else None,
         'matrix_world': [list(row) for row in ob.matrix_world], 'loc': val(ob.location), 'rot': val(ob.rotation_euler),
         'rot_mode': ob.rotation_mode, 'scale': val(ob.scale), 'dims': val(ob.dimensions),
         'hide_render': ob.hide_render, 'hide_viewport': ob.hide_viewport,
         'vis': {k: getattr(ob, k, None) for k in ('visible_camera', 'visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow', 'is_holdout', 'is_shadow_catcher')},
         'collections': [c.name for c in ob.users_collection],
         'materials': [s.material.name if s.material else None for s in ob.material_slots],
         'mat_link': [s.link for s in ob.material_slots],
         'modifiers': [dict(props(m), _type=m.type) for m in ob.modifiers], 'anim': anim(ob),
         'constraints': [dict(props(c), _type=c.type) for c in ob.constraints], 'instance_type': ob.instance_type,
         'instance_collection': ob.instance_collection.name if ob.instance_collection else None}
    if ob.type == 'MESH':
        me = ob.data
        o['mesh'] = {'verts': len(me.vertices), 'faces': len(me.polygons), 'edges': len(me.edges), 'uv': [u.name for u in me.uv_layers],
                     'attributes': [[a.name, a.domain, a.data_type] for a in me.attributes],
                     'mat_hist': {}}
        for p in me.polygons:
            k = str(p.material_index); o['mesh']['mat_hist'][k] = o['mesh']['mat_hist'].get(k, 0) + 1
    R['objects'].append(o)
R['images'] = []
os.makedirs(f'{out}/images', exist_ok=True)
for im in D.images:
    e = image_info(im)
    if im.packed_file and im.size[0] > 0:
        safe = ''.join(ch if ch.isalnum() or ch in '._-' else '_' for ch in im.name)
        fn = f'{out}/images/{safe}'
        try:
            with open(fn + '.bin', 'wb') as f: f.write(im.packed_file.data)
            e['saved'] = os.path.basename(fn) + '.bin'
        except Exception as ex: e['save_err'] = str(ex)
    R['images'].append(e)
R['collections'] = [{'name': c.name, 'objects': [o.name for o in c.objects], 'children': [ch.name for ch in c.children], 'hide_render': c.hide_render} for c in D.collections]
R['texts'] = [t.name for t in D.texts]
R['libraries'] = [l.filepath for l in D.libraries]
json.dump(R, open(f'{out}/dump.json', 'w'), indent=1, default=str)
print('objects', len(R['objects']), 'materials', len(R['materials']), 'groups', len(R['node_groups']), 'images', len(R['images']))
