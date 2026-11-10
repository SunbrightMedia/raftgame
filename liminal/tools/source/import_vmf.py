"""
Import a Hammer map source (VMF) into our map format.

    python3 tools/source/import_vmf.py in.vmf out.json [--name N] [--region x0,y0,z0,x1,y1,z1] [--tex-prefix p2/]

- Brushes (world, func_detail, func_brush, func_lod, doors, ...) become
  'convex' brushes: one plane per side, the side's material and Source
  texture axes (uaxis/vaxis + scale), Source units = inches, Z up, no change.
- Tool textures: nodraw faces are kept as part of the solid but not drawn;
  clip/playerclip/invisible brushes stay solid and invisible; trigger, hint,
  skip, areaportal, occluder and similar brushes are dropped.
- Entities: lights keep every Source key under props.source (the Source
  lighting model reads them); props become 'prop' entities (model, angles,
  skin, scale); info_player_start becomes the spawn.
- Overlays (info_overlay) become thin non-solid brushes carrying the overlay
  material (see overlay_brush).
- --region keeps only brushes and entities whose bounds touch the box.
"""
import argparse, json, math, re, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import kv  # noqa: E402

NUM = r'-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?'
BRUSH_ENTS = {'func_detail', 'func_brush', 'func_lod', 'func_door', 'func_door_rotating', 'func_wall', 'func_illusionary', 'func_physbox',
              'func_breakable', 'func_movelinear', 'func_rotating', 'func_tracktrain', 'func_button', 'func_reflective_glass', 'func_wall_toggle'}
NONSOLID_ENTS = {'func_illusionary'}
DROP_TOOLS = ('tools/toolstrigger', 'tools/toolshint', 'tools/toolsskip', 'tools/toolsareaportal', 'tools/toolsoccluder', 'tools/toolsfog',
              'tools/toolsblock_los', 'tools/toolsblocklight', 'tools/toolsblockbullets', 'tools/toolsdotted', 'tools/toolsorigin', 'tools/toolsbrushshadow')
INVISIBLE_SOLID = ('tools/toolsclip', 'tools/toolsplayerclip', 'tools/toolsinvisible', 'tools/toolsnpcclip', 'tools/toolsgrenadeclip')
LIGHT_ENTS = {'light', 'light_spot', 'light_environment', 'light_dynamic', 'env_lightglow'}
# Entities that draw a fixed model (the FGD's studioprop) when the map doesn't name one.
MODEL_ENTS = {'prop_under_button': 'models/props_underground/underground_testchamber_button.mdl',
              'prop_under_floor_button': 'models/props_underground/underground_floor_button.mdl'}
PROP_ENTS = {'prop_static', 'prop_dynamic', 'prop_dynamic_override', 'prop_physics', 'prop_physics_override', 'prop_physics_multiplayer'}


def plane_of(s: str):
    v = list(map(float, re.findall(NUM, s)))
    p1, p2, p3 = v[0:3], v[3:6], v[6:9]
    a = [p1[i] - p2[i] for i in range(3)]
    b = [p3[i] - p2[i] for i in range(3)]
    n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]   # outward (Hammer winding)
    l = math.sqrt(sum(c * c for c in n)) or 1
    n = [c / l for c in n]
    return n + [sum(n[i] * p1[i] for i in range(3))]


def axis_of(s: str):
    v = list(map(float, re.findall(NUM, s)))
    return v[0:4], (v[4] if len(v) > 4 else 0.25)


def vec(s: str):
    return [float(x) for x in re.findall(NUM, s or '0 0 0')][:3]


def convert_solid(solid: list, sid: int, prefix: str, solid_flag: bool):
    planes, faces = [], {}
    tools = []
    for side in kv.children(solid, 'side'):
        mat = kv.get(side, 'material', '').lower().replace('\\', '/')
        tools.append(mat)
        planes.append([round(c, 6) for c in plane_of(kv.get(side, 'plane'))])
        ua, su = axis_of(kv.get(side, 'uaxis', '[1 0 0 0] 0.25'))
        va, sv = axis_of(kv.get(side, 'vaxis', '[0 -1 0 0] 0.25'))
        f = {'tex': mat if mat.startswith('tools/') else prefix + mat, 'uaxis': ua, 'vaxis': va, 'scale': [su, sv]}
        lms = kv.get(side, 'lightmapscale')
        if lms and lms != '16':
            f['lightmapscale'] = float(lms)
        if kv.children(side, 'dispinfo'):
            f['displacement'] = True        # not imported yet: drawn as the flat face
        faces[str(len(planes) - 1)] = f
    if any(t.startswith(DROP_TOOLS) for t in tools):
        return None
    b = {'id': sid, 'type': 'convex', 'planes': planes, 'faces': faces}
    if all(t.startswith('tools/') for t in tools) or any(t.startswith(INVISIBLE_SOLID) for t in tools):
        b['group'] = 'clip'
    if not solid_flag:
        b['solid'] = False
    return b


def tex_size(name: str):
    """A converted material's size in texels (textures/p2/index.json), for overlay texture axes."""
    global _SIZES
    if '_SIZES' not in globals():
        f = os.path.join(HERE, '../../textures/p2/index.json')
        _SIZES = {t['name']: t['size'] for t in json.load(open(f))['textures']} if os.path.exists(f) else {}
    return _SIZES.get(name, [512, 512])


def overlay_brush(keys: dict, oid: int, prefix: str):
    """
    An info_overlay as a paper-thin, non-solid brush lying on its surface: the
    top face carries the overlay material with texture axes that reproduce the
    overlay's own mapping (corner 0 = StartU,StartV ... corner 2 = EndU,EndV),
    so it is lit and drawn like any face. The other sides are nodraw.
    """
    O, U, V, N = (vec(keys.get(k)) for k in ('basisorigin', 'basisu', 'basisv', 'basisnormal'))
    corners = [vec(keys.get(f'uv{i}')) for i in range(4)]
    su, eu, sv, ev = (float(keys.get(k, d)) for k, d in (('startu', 0), ('endu', 1), ('startv', 0), ('endv', 1)))
    tex = prefix + keys.get('material', '').lower().replace('\\', '/')
    W, H = tex_size(tex)
    us, vs = [c[0] for c in corners], [c[1] for c in corners]
    umin, umax, vmin, vmax = min(us), max(us), min(vs), max(vs)
    if umax - umin < 1e-3 or vmax - vmin < 1e-3:
        return None
    # Texture axes as Source writes them: texel = p·axis/scale + shift.
    sc_u = (umax - umin) / ((eu - su) * W) if eu != su else 1
    sc_v = (vmax - vmin) / ((ev - sv) * H) if ev != sv else 1
    dot = lambda a, b: sum(a[i] * b[i] for i in range(3))
    sh_u = su * W - (dot(U, O) + umin) / sc_u
    sh_v = sv * H - (dot(V, O) + vmin) / sc_v
    pts = [[O[i] + c[0] * U[i] + c[1] * V[i] for i in range(3)] for c in corners]
    cen = [sum(p[i] for p in pts) / 4 for i in range(3)]
    planes = [N + [dot(N, O) + 0.15], [-N[0], -N[1], -N[2], -dot(N, O) - 0.05]]
    faces = {'0': {'tex': tex, 'uaxis': U + [sh_u], 'vaxis': V + [sh_v], 'scale': [sc_u, sc_v]}, '1': {'tex': 'tools/toolsnodraw'}}
    for k in range(4):
        a, b = pts[k], pts[(k + 1) % 4]
        e = [b[i] - a[i] for i in range(3)]
        n = [e[1] * N[2] - e[2] * N[1], e[2] * N[0] - e[0] * N[2], e[0] * N[1] - e[1] * N[0]]
        l = math.sqrt(dot(n, n)) or 1
        n = [c / l for c in n]
        if dot(n, [cen[i] - a[i] for i in range(3)]) > 0:
            n = [-c for c in n]
        planes.append(n + [dot(n, a)])
        faces[str(len(planes) - 1)] = {'tex': 'tools/toolsnodraw'}
    return {'id': oid, 'type': 'convex', 'planes': [[round(c, 6) for c in p] for p in planes], 'faces': faces, 'group': 'overlay', 'solid': False}


def bounds_of(planes):
    """Rough bounds from the plane set (for region filtering): vertices = triple intersections inside all planes."""
    import itertools
    pts = []
    for a, b, c in itertools.combinations(planes, 3):
        m = [a[:3], b[:3], c[:3]]
        det = (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
        if abs(det) < 1e-9:
            continue
        d = [a[3], b[3], c[3]]
        def rep(col):
            mm = [row[:] for row in m]
            for r in range(3):
                mm[r][col] = d[r]
            return (mm[0][0] * (mm[1][1] * mm[2][2] - mm[1][2] * mm[2][1]) - mm[0][1] * (mm[1][0] * mm[2][2] - mm[1][2] * mm[2][0]) + mm[0][2] * (mm[1][0] * mm[2][1] - mm[1][1] * mm[2][0]))
        p = [rep(0) / det, rep(1) / det, rep(2) / det]
        if all(sum(q[i] * p[i] for i in range(3)) <= q[3] + 0.01 for q in planes):
            pts.append(p)
    if not pts:
        return None
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('vmf'); ap.add_argument('out')
    ap.add_argument('--name', default=None)
    ap.add_argument('--region', default=None)
    ap.add_argument('--tex-prefix', default='p2/')
    a = ap.parse_args()
    blocks = kv.parse(open(a.vmf, encoding='latin-1').read())
    region = [float(x) for x in a.region.split(',')] if a.region else None
    inside = lambda lo, hi: region is None or (lo[0] <= region[3] and hi[0] >= region[0] and lo[1] <= region[4] and hi[1] >= region[1] and lo[2] <= region[5] and hi[2] >= region[2])
    brushes, entities = [], []
    groups = [('world', kv.children(blocks, 'world')[0], True)]
    for e in kv.children(blocks, 'entity'):
        cls = kv.get(e, 'classname', '')
        if cls in BRUSH_ENTS:
            groups.append((cls, e, cls not in NONSOLID_ENTS))
    for cls, holder, solid_flag in groups:
        for so in kv.children(holder, 'solid'):
            b = convert_solid(so, int(kv.get(so, 'id', len(brushes) + 1)), a.tex_prefix, solid_flag)
            if not b:
                continue
            bb = bounds_of(b['planes'])
            if not bb or not inside(*bb):
                continue
            if cls != 'world':
                b.setdefault('group', cls)
            brushes.append(b)
    eid = 1
    for e in kv.children(blocks, 'entity'):
        if kv.get(e, 'classname') == 'info_overlay':
            keys = {k: v for k, v in e if not isinstance(v, list)}
            o = vec(keys.get('origin'))
            b = overlay_brush(keys, 900000 + eid, a.tex_prefix) if inside(o, o) else None
            if b:
                brushes.append(b)
            eid += 1
    for e in kv.children(blocks, 'entity'):
        cls = kv.get(e, 'classname', '')
        keys = {k: v for k, v in e if not isinstance(v, list)}
        o = vec(keys.get('origin'))
        if not inside(o, o):
            continue
        ang = vec(keys.get('angles', '0 0 0'))
        if cls == 'info_player_start':
            entities.insert(0, {'id': eid, 'class': 'player_start', 'origin': o, 'angles': ang})
        elif cls in LIGHT_ENTS:
            entities.append({'id': 1000 + eid, 'class': 'light', 'origin': o, 'props': {'type': 'source', 'source': keys}})
        elif cls in PROP_ENTS or cls in MODEL_ENTS:
            props = {'model': (keys.get('model') or MODEL_ENTS.get(cls, '')).lower(), 'skin': int(float(keys.get('skin', '0'))), 'source_class': cls}
            if keys.get('modelscale') and float(keys['modelscale']) != 1:
                props['scale'] = float(keys['modelscale'])
            if keys.get('solid', '6') == '0':
                props['solid'] = False
            if keys.get('rendercolor') and keys['rendercolor'] != '255 255 255':
                props['color'] = vec(keys['rendercolor'])
            entities.append({'id': 1000 + eid, 'class': 'prop', 'origin': o, 'angles': ang, 'props': props})
        elif cls in ('env_cubemap', 'env_tonemap_controller', 'color_correction', 'env_fog_controller', 'light_environment', 'info_lighting'):
            entities.append({'id': 1000 + eid, 'class': 'source_' + cls, 'origin': o, 'props': {'source': keys}})
        eid += 1
    if not any(e['class'] == 'player_start' for e in entities):
        c = [(region[i] + region[i + 3]) / 2 for i in range(3)] if region else [0, 0, 64]
        entities.insert(0, {'id': 1, 'class': 'player_start', 'origin': c, 'angles': [0, 0, 0]})
    name = a.name or os.path.splitext(os.path.basename(a.out))[0]
    # Seen through Source's camera; an env_tonemap_controller's exposure range and bloom carry over.
    settings = {'camera': {'model': 'source'}}
    for e in kv.children(blocks, 'entity'):
        if kv.get(e, 'classname') == 'env_tonemap_controller':
            for key, field in (('minexposure', 'sourceExposureMin'), ('maxexposure', 'sourceExposureMax'), ('bloomscale', 'sourceBloom')):
                v = kv.get(e, key)
                if v not in (None, '', '-1'):
                    settings['camera'][field] = float(v)
    out = {'format': 'liminal-map', 'version': 1, 'name': name, 'brushes': brushes, 'entities': entities}
    with open(a.out, 'w') as f:
        f.write('{\n  "format": "liminal-map",\n  "version": 1,\n  "name": ' + json.dumps(name) + ',\n  "settings": ' + json.dumps(settings) + ',\n  "brushes": [\n')
        f.write(',\n'.join('    ' + json.dumps(b, separators=(',', ':')) for b in brushes))
        f.write('\n  ],\n  "entities": [\n')
        f.write(',\n'.join('    ' + json.dumps(e, separators=(',', ':')) for e in entities))
        f.write('\n  ]\n}\n')
    kinds = {}
    for e in entities:
        kinds[e['class']] = kinds.get(e['class'], 0) + 1
    print(f'{a.out}: {len(brushes)} brushes, entities {kinds}')


if __name__ == '__main__':
    main()
