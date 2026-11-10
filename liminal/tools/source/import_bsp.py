"""
Import a compiled Source map (BSP v21, Portal 2) into our map format, to
study how Valve built it: walk it in the engine, measure it, light it.

    python3 tools/source/import_bsp.py in.bsp out.json [--name N] [--tex-prefix p2lib/] [--model-prefix p2lib/]

- Brushes come from the BSP's brush lump (the original solids, as Hammer had
  them): one plane per side, the side's material and texture axes from its
  texinfo, the lightmap scale from the lightmap vectors. Brush models
  (func_brush, doors...) keep their entity's name and class; brushes of an
  entity with an origin are moved back to where the map placed them.
- Static props come from the game lump; prop_dynamic & co. and lights from
  the entity lump, as in import_vmf.py. Sprites, beams, fog and tone-map
  controllers are kept as 'source_<class>' entities with all their keys.
- Not imported: displacements (drawn as their flat base face), water
  surfaces' animation, areaportals, triggers.
"""
import argparse, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from bsp import Bsp, clean_material, SURF_SKY, SURF_NODRAW, SURF_TRIGGER, SURF_HINT, SURF_SKIP  # noqa: E402
from import_vmf import DROP_TOOLS, INVISIBLE_SOLID, LIGHT_ENTS, MODEL_ENTS, PROP_ENTS, NONSOLID_ENTS, vec  # noqa: E402

KEEP_ENTS = ('env_cubemap', 'env_tonemap_controller', 'color_correction', 'env_fog_controller', 'light_environment', 'info_lighting',
             'env_lightglow', 'env_projectedtexture', 'move_rope', 'keyframe_rope',
             'env_soundscape', 'ambient_generic', 'func_instance_io_proxy', 'info_particle_system', 'env_smokestack', 'env_steam', 'postprocess_controller')
CONTENTS_SOLID, CONTENTS_WINDOW, CONTENTS_GRATE, CONTENTS_WATER = 0x1, 0x2, 0x8, 0x20
CONTENTS_PLAYERCLIP, CONTENTS_MONSTERCLIP, CONTENTS_AREAPORTAL, CONTENTS_ORIGIN, CONTENTS_LADDER = 0x10000, 0x20000, 0x8000, 0x1000000, 0x20000000


def norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1
    return [c / l for c in v], l


def start_fog(pairs):
    """
    The fog controller a map starts with: follow what fires at map spawn
    (logic_auto OnMapSpawn, through relays and instance proxies) to a
    SetFogController, else the controller flagged as master.
    """
    by_name = {}
    for e in pairs:
        d = dict(e)
        if d.get('targetname'):
            by_name.setdefault(d['targetname'].lower(), []).append(e)
    seen, queue = set(), []
    for e in pairs:
        if dict(e).get('classname') == 'logic_auto':
            queue += [(v, 0) for k, v in e if k.lower() == 'onmapspawn']
    while queue:
        out, depth = queue.pop(0)
        f = out.replace('\x1b', ',').split(',')
        if len(f) < 2 or depth > 6:
            continue
        target, inp, param = f[0].lower(), f[1].lower(), f[2] if len(f) > 2 else ''
        if inp == 'setfogcontroller':
            return param.lower()
        for t in by_name.get(target, []):
            # An instance proxy relays "OnProxyRelayN"; a relay fires OnTrigger; a script or branch is not followed.
            keys = [inp] if inp.startswith('onproxyrelay') else ['ontrigger', 'onspawn'] if inp == 'trigger' else []
            for k, v in t:
                if k.lower() in keys and (id(t), v) not in seen:
                    seen.add((id(t), v)); queue.append((v, depth + 1))
    for e in pairs:
        d = dict(e)
        if d.get('classname') == 'env_fog_controller' and int(d.get('spawnflags', '0') or 0) & 1:
            return d.get('targetname', '').lower()
    return None


def fog_settings(keys):
    hexc = lambda s: '#' + ''.join(f'{max(0, min(255, int(float(c)))):02x}' for c in (s.split() + ['0', '0', '0'])[:3])
    ang = vec(keys.get('angles', '0 0 0'))
    return {'enabled': keys.get('fogenable', '1') != '0', 'source': True, 'color': hexc(keys.get('fogcolor', '255 255 255')), 'near': float(keys.get('fogstart', 0)), 'far': float(keys.get('fogend', 5000)),
            'maxDensity': float(keys.get('fogmaxdensity', 1)), 'hdrScale': float(keys.get('HDRColorScale', 1)), 'blend': keys.get('fogblend', '0') == '1',
            'color2': hexc(keys.get('fogcolor2', '255 255 255')), 'dirPitch': ang[0], 'dirYaw': ang[1]}


def sprite_size(tex: str) -> float:
    """A sprite's width in units: its texture's width in texels (textures/<set>/index.json)."""
    global _SPRITES
    if '_SPRITES' not in globals():
        _SPRITES = {}
        for f in ('textures/p2/index.json', 'textures/p2lib/index.json'):
            f = os.path.join(HERE, '../..', f)
            if os.path.exists(f):
                _SPRITES.update({t['name']: t['size'][0] for t in json.load(open(f))['textures'] if '/sprites/' in t['name']})
    return _SPRITES.get(tex, 64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('bsp'); ap.add_argument('out')
    ap.add_argument('--name', default=None)
    ap.add_argument('--tex-prefix', default='p2lib/')
    ap.add_argument('--model-prefix', default='p2lib/')
    a = ap.parse_args()
    bsp = Bsp(a.bsp)
    planes, texinfo, texdata = bsp.planes(), bsp.texinfo(), bsp.texdata()
    ents = bsp.entities()
    owner = bsp.brush_models()
    # Brush model -> its entity (class, name, origin).
    model_ent = {}
    for e in ents:
        m = e.get('model', '')
        if m.startswith('*'):
            model_ent[int(m[1:])] = e
    mat_of = lambda ti: clean_material(texdata[texinfo[ti][5]][0]) if 0 <= ti < len(texinfo) else 'tools/toolsnodraw'

    brushes = []
    dropped = {}
    for bi, (contents, sides) in enumerate(bsp.brushes()):
        mi = owner.get(bi)
        if mi is None:
            dropped['unreferenced'] = dropped.get('unreferenced', 0) + 1
            continue
        ent = model_ent.get(mi) if mi else None
        cls = ent.get('classname', '') if ent else 'world'
        if contents & (CONTENTS_AREAPORTAL | CONTENTS_ORIGIN) or cls.startswith(('trigger_', 'func_areaportal', 'func_occluder', 'func_noportal', 'func_portal', 'func_clip_vphysics', 'func_viscluster', 'func_instance', 'info_', 'func_placement', 'func_nav', 'func_precipitation', 'env_', 'func_weight_button', 'func_vehicleclip', 'func_proprrespawnzone', 'func_dustmotes', 'func_dustcloud', 'func_fish_pool', 'func_smokevolume', 'fog_volume', 'func_water_analog')):
            dropped[cls] = dropped.get(cls, 0) + 1
            continue
        o = vec(ent.get('origin')) if ent and ent.get('origin') else [0, 0, 0]
        pl, faces, mats = [], {}, []
        for pn, ti, disp, bevel in sides:
            if bevel:
                continue
            n = list(planes[pn][:3]); d = planes[pn][3] + sum(n[i] * o[i] for i in range(3))
            mat = mat_of(ti)
            flags = texinfo[ti][4] if 0 <= ti < len(texinfo) else SURF_NODRAW
            if flags & (SURF_NODRAW | SURF_SKIP | SURF_HINT | SURF_TRIGGER) and not mat.startswith('tools/'):
                mat = 'tools/toolsnodraw'
            mats.append(mat)
            pl.append([round(c, 6) for c in n] + [round(d, 4)])
            f = {'tex': mat if mat.startswith('tools/') else a.tex_prefix + mat}
            if 0 <= ti < len(texinfo):
                s, t, ls, _lt = texinfo[ti][0], texinfo[ti][1], texinfo[ti][2], texinfo[ti][3]
                (ua, ul), (va, vl) = norm(s[:3]), norm(t[:3])
                # texel = p·vec + shift, with p in world space: an entity origin moves the shift.
                f['uaxis'] = [round(c, 6) for c in ua] + [round(s[3] - sum(s[i] * o[i] for i in range(3)), 4)]
                f['vaxis'] = [round(c, 6) for c in va] + [round(t[3] - sum(t[i] * o[i] for i in range(3)), 4)]
                f['scale'] = [round(1 / ul, 6), round(1 / vl, 6)]
                lms = 1 / (math.sqrt(sum(c * c for c in ls[:3])) or 1 / 16)
                if abs(lms - 16) > 0.01:
                    f['lightmapscale'] = round(lms, 3)
            if disp > 0:
                f['displacement'] = True
            faces[str(len(pl) - 1)] = f
        if len(pl) < 4:
            continue
        if any(m.startswith(DROP_TOOLS) for m in mats):
            dropped['tools'] = dropped.get('tools', 0) + 1
            continue
        b = {'id': bi + 1, 'type': 'convex', 'planes': pl, 'faces': faces}
        if all(m.startswith('tools/') for m in mats) or any(m.startswith(INVISIBLE_SOLID) for m in mats) or contents & (CONTENTS_PLAYERCLIP | CONTENTS_MONSTERCLIP) and not contents & CONTENTS_SOLID:
            b['group'] = 'clip'
        if cls in NONSOLID_ENTS or contents & CONTENTS_WATER or not contents & (CONTENTS_SOLID | CONTENTS_WINDOW | CONTENTS_GRATE | CONTENTS_PLAYERCLIP | CONTENTS_LADDER):
            b['solid'] = False
        if cls != 'world':
            b.setdefault('group', cls)
            if ent.get('targetname'):
                b['entity'] = ent['targetname'].lower()
        elif contents & 0x8000000 and 'group' not in b:   # CONTENTS_DETAIL
            b['group'] = 'func_detail'
        brushes.append(b)

    entities = []
    eid = 1
    for p in bsp.static_props():
        props = {'model': a.model_prefix + p['model'], 'skin': p['skin'], 'source_class': 'prop_static'}
        if p['solid'] == 0:
            props['solid'] = False
        if p['flags'] & 0x10:
            props['noshadow'] = True
        if p.get('scale', 1) != 1:
            props['scale'] = round(p['scale'], 4)
        entities.append({'id': 100000 + eid, 'class': 'prop', 'origin': [round(c, 3) for c in p['origin']], 'angles': [round(c, 3) for c in p['angles']], 'props': props})
        eid += 1
    for e in ents:
        cls = e.get('classname', '')
        keys = {k: v for k, v in e.items()}
        o = vec(keys.get('origin'))
        ang = vec(keys.get('angles', '0 0 0'))
        if cls == 'info_player_start':
            entities.insert(0, {'id': eid, 'class': 'player_start', 'origin': o, 'angles': ang})
        elif cls in LIGHT_ENTS and cls != 'env_lightglow':
            entities.append({'id': 1000 + eid, 'class': 'light', 'origin': o, 'props': {'type': 'source', 'source': keys}})
        elif (cls in PROP_ENTS or cls in MODEL_ENTS or cls in ('prop_testchamber_door', 'prop_button', 'prop_floor_button', 'prop_weighted_cube', 'prop_tractor_beam', 'prop_laser_catcher', 'prop_laser_emitter', 'prop_wall_projector', 'prop_tic_tac_toe_panel', 'prop_linked_portal_door', 'generic_actor')) and (keys.get('model', '').endswith('.mdl') or cls in MODEL_ENTS):
            props = {'model': a.model_prefix + (keys.get('model') or MODEL_ENTS.get(cls, '')).lower().replace('\\', '/'), 'skin': int(float(keys.get('skin', '0') or 0)), 'source_class': cls}
            if keys.get('modelscale') and float(keys['modelscale']) != 1:
                props['scale'] = float(keys['modelscale'])
            if keys.get('solid', '6') == '0':
                props['solid'] = False
            if keys.get('disableshadows', '0') not in ('0', ''):
                props['noshadow'] = True
            if keys.get('parentname'):
                props['parent'] = keys['parentname'].lower()
            if keys.get('targetname'):
                props['name'] = keys['targetname'].lower()
            entities.append({'id': 1000 + eid, 'class': 'prop', 'origin': o, 'angles': ang, 'props': props})
        elif cls in ('env_sprite', 'env_sprite_clientside') and keys.get('model', '').endswith('.vmt'):
            # The glow on a lamp: an additive sprite facing the view (render modes 3/5/9; others are rare).
            tex = a.tex_prefix + keys['model'].lower().replace('\\', '/')[:-4].removeprefix('materials/')
            px = sprite_size(tex)
            entities.append({'id': 1000 + eid, 'class': 'glow', 'origin': o, 'props': {
                'tex': tex, 'size': round(px * float(keys.get('scale', 1) or 1), 2), 'color': vec(keys.get('rendercolor', '255 255 255')),
                'brightness': round(float(keys.get('renderamt', 255) or 255) / 255 * float(keys.get('HDRColorScale', 1) or 1), 4), 'source': keys}})
        elif cls in ('beam_spotlight', 'point_spotlight'):
            # A spotlight's visible shaft and halo. Angles: pitch down is positive (Source).
            p, y = math.radians(ang[0]), math.radians(ang[1])
            d = [math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), -math.sin(p)]
            entities.append({'id': 1000 + eid, 'class': 'beam', 'origin': o, 'props': {
                'dir': [round(c, 5) for c in d], 'length': float(keys.get('spotlightlength', 500) or 500), 'width': float(keys.get('spotlightwidth', 50) or 50),
                'color': vec(keys.get('rendercolor', '255 255 255')), 'brightness': round(float(keys.get('renderamt', 255) or 255) / 255 * float(keys.get('HDRColorScale', 1) or 1), 4),
                'tex': a.tex_prefix + 'sprites/glow_test02', 'halo': a.tex_prefix + 'sprites/light_glow03', 'source': keys}})
        elif cls in KEEP_ENTS:
            entities.append({'id': 1000 + eid, 'class': 'source_' + cls, 'origin': o, 'angles': ang, 'props': {'source': keys}})
        eid += 1
    if not any(e['class'] == 'player_start' for e in entities):
        entities.insert(0, {'id': 1, 'class': 'player_start', 'origin': [0, 0, 64], 'angles': [0, 0, 0]})

    name = a.name or os.path.splitext(os.path.basename(a.out))[0]
    settings = {'camera': {'model': 'source'}, 'render': {'internalHeight': 0, 'textureFilter': 'linear'}, 'fog': {'enabled': False}}
    fog = start_fog(bsp.entity_pairs())
    for e in ents:
        if e.get('classname') == 'env_fog_controller' and e.get('targetname', '').lower() == fog:
            settings['fog'] = fog_settings(e)
    for e in ents:
        if e.get('classname') == 'env_tonemap_controller':
            for key, field in (('minexposure', 'sourceExposureMin'), ('maxexposure', 'sourceExposureMax'), ('bloomscale', 'sourceBloom')):
                v = e.get(key)
                if v not in (None, '', '-1'):
                    settings['camera'][field] = float(v)
    with open(a.out, 'w') as f:
        f.write('{\n  "format": "liminal-map",\n  "version": 1,\n  "name": ' + json.dumps(name) + ',\n  "settings": ' + json.dumps(settings) + ',\n  "brushes": [\n')
        f.write(',\n'.join('    ' + json.dumps(b, separators=(',', ':')) for b in brushes))
        f.write('\n  ],\n  "entities": [\n')
        f.write(',\n'.join('    ' + json.dumps(e, separators=(',', ':')) for e in entities))
        f.write('\n  ]\n}\n')
    kinds = {}
    for e in entities:
        kinds[e['class']] = kinds.get(e['class'], 0) + 1
    print(f'{a.out}: {len(brushes)} brushes, entities {kinds}; dropped {dropped}; fog {fog} {settings["fog"]}')


if __name__ == '__main__':
    main()
