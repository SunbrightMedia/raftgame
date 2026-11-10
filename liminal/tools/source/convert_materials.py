"""
Convert the Source materials a map uses into our texture library, for
reference/calibration scenes (Portal 2's are Valve's: dev-only, never in a
published build).

    .venv-look/bin/python tools/source/convert_materials.py reference/portal2/shipyard_v13p.vmf

Reads each material's VMT (from the VPK index, which holds them, or from
reference/portal2/files), follows `patch` includes, decodes its base texture
and normal map (VTF) and writes:
  textures/p2/<material>.jpg|png   (base texture; PNG when alpha is used)
  textures/p2/<material>_n.png     (normal map, if any)
  textures/p2/index.json           (one entry per material: size in Source
                                    units, our material class, and a `source`
                                    block: shader, flags, reflectivity, lights.rad emission)
"""
import json, os, re, struct, sys, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
sys.path.insert(0, HERE)
import vpk, vtf, kv  # noqa: E402

REF = os.path.join(ROOT, 'reference/portal2')
OUT = os.path.join(ROOT, 'textures/p2')
E, _ = vpk.read_dir(os.path.join(REF, 'pak01_dir.vpk'))

TOOL = re.compile(r'^tools/')


def read(path: str) -> bytes | None:
    """A file from the reference files folder, or a VMT/preloaded file from the index."""
    p = os.path.join(REF, 'files', path)
    if os.path.exists(p):
        return open(p, 'rb').read()
    e = E.get(path)
    if e and e[2] == 0:
        return e[3]
    return None


def vmt(name: str, depth=0) -> tuple[str, dict]:
    data = read(f'materials/{name}.vmt')
    if data is None:
        return '', {}
    shader, params = kv.first_block(kv.parse(data.decode('latin-1')))
    out = {k: v for k, v in params if not isinstance(v, list)}
    if shader == 'patch' and depth < 4:
        inc = out.get('include', '').lower().replace('\\', '/')
        inc = re.sub(r'^materials/', '', inc).removesuffix('.vmt')
        shader, base = vmt(inc, depth + 1)
        for k, v in params:
            if k in ('insert', 'replace') and isinstance(v, list):
                base.update({kk: vv for kk, vv in v if not isinstance(vv, list)})
        out = base
    return shader, out


def flag(p: dict, k: str) -> bool:
    try:
        return float(p.get(k, '0')) != 0
    except ValueError:
        return False


def category(surfaceprop: str) -> str:
    s = surfaceprop.lower()
    for key, cat in [('metal', 'metal'), ('grate', 'metal'), ('vent', 'metal'), ('concrete', 'concrete'), ('brick', 'concrete'), ('rock', 'concrete'),
                     ('dirt', 'concrete'), ('gravel', 'concrete'), ('tile', 'tile'), ('ceramic', 'tile'), ('wood', 'wood'), ('glass', 'glass'),
                     ('plastic', 'plastic'), ('carpet', 'carpet'), ('rubber', 'rubber'), ('cloth', 'fabric'), ('paper', 'plaster'), ('cardboard', 'plaster')]:
        if key in s:
            return cat
    return 'default'


def lights_rad() -> dict:
    out = {}
    for line in open(os.path.join(REF, 'lights.rad'), encoding='latin-1'):
        line = line.split('//')[0].split()
        if len(line) >= 5:
            try:
                out[line[0].lower().replace('\\', '/')] = [float(x) for x in line[1:5]]
            except ValueError:
                pass
    return out


def materials_of_vmf(path: str) -> set[str]:
    t = open(path, encoding='latin-1').read()
    return {m.lower().replace('\\', '/') for m in re.findall(r'"material" "([^"]+)"', t)}


def materials_of_models() -> set[str]:
    out = set()
    for f in glob.glob(os.path.join(REF, 'files/models/**/*.mdl'), recursive=True):
        b = open(f, 'rb').read()
        ntex, texi, ncd, cdi = struct.unpack_from('<iiii', b, 204)
        cstr = lambda o: b[o:b.index(b'\0', o)].decode('latin-1')
        names = [cstr(texi + i * 64 + struct.unpack_from('<i', b, texi + i * 64)[0]) for i in range(ntex)]
        cds = [cstr(struct.unpack_from('<i', b, cdi + i * 4)[0]) for i in range(ncd)]
        for n in names:
            for cd in cds:
                k = (cd.replace('\\', '/') + n).lower().replace('//', '/')
                if f'materials/{k}.vmt' in E:
                    out.add(k)
                    break
    return out


def decode_tex(name: str) -> Image.Image | None:
    if not name:
        return None
    d = read(f'materials/{name.lower().replace(chr(92), "/")}.vtf')
    return vtf.decode(d) if d else None


def main():
    mats = set()
    for vmf in sys.argv[1:]:
        mats |= materials_of_vmf(vmf)
    mats |= materials_of_models()
    rad = lights_rad()
    os.makedirs(OUT, exist_ok=True)
    index, missing = [], []
    for m in sorted(mats):
        if TOOL.match(m):
            continue
        shader, p = vmt(m)
        if not shader:
            missing.append(m); continue
        base = p.get('$basetexture', '')
        im = decode_tex(base)
        if im is None:
            missing.append(m); continue
        info = vtf.info(read(f'materials/{base.lower().replace(chr(92), "/")}.vtf'))
        translucent, alphatest, selfillum = flag(p, '$translucent'), flag(p, '$alphatest'), flag(p, '$selfillum')
        # Self-illumination is masked by the base texture's alpha, or by a separate mask texture.
        if selfillum and p.get('$selfillummask'):
            mask = decode_tex(p['$selfillummask'])
            if mask is not None:
                im = im.convert('RGBA'); im.putalpha(mask.convert('L').resize(im.size))
        uses_alpha = translucent or alphatest or selfillum
        rel = m
        os.makedirs(os.path.dirname(os.path.join(OUT, rel)), exist_ok=True)
        if uses_alpha:
            file = f'p2/{rel}.png'; im.save(os.path.join(ROOT, 'textures', file), optimize=True)
        else:
            file = f'p2/{rel}.jpg'; im.convert('RGB').save(os.path.join(ROOT, 'textures', file), quality=90)
        src = {'shader': shader.lower(), 'basetexture': base.lower()}
        nm = decode_tex(p.get('$bumpmap') or p.get('$normalmap', ''))
        if nm is not None:
            if max(nm.size) > 1024:
                nm.thumbnail((1024, 1024), Image.LANCZOS)
            src['normal'] = f'p2/{rel}_n.png'; nm.convert('RGB').save(os.path.join(ROOT, 'textures', src['normal']), optimize=True)
        for k, key in [('translucent', '$translucent'), ('alphatest', '$alphatest'), ('additive', '$additive'), ('selfillum', '$selfillum'), ('nocull', '$nocull')]:
            if flag(p, key):
                src[k] = True
        if p.get('$envmap'):
            src['envmap'] = True
        for k, key in [('selfillumtint', '$selfillumtint'), ('alpha', '$alpha'), ('alphatestreference', '$alphatestreference')]:
            if p.get(key):
                v = [float(x) for x in re.findall(r'-?\d*\.?\d+', p[key])]
                if v:
                    src[k] = v if len(v) > 1 else v[0]
        src['reflectivity'] = [round(x, 4) for x in info['reflectivity']]
        r = rad.get(m)
        if r:
            src['rad'] = r
        index.append({'name': f'p2/{m}', 'file': file, 'size': [im.width, im.height], 'material': category(p.get('$surfaceprop', '')), 'raw': True,
                      'credit': 'Portal 2 (Valve): reference only, never published', 'license': 'reference-only', 'source': src})
    json.dump({'format': 'liminal-textures', 'version': 1, 'textures': index}, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    print(f'{len(index)} materials converted, {len(missing)} missing: {missing[:12]}')


if __name__ == '__main__':
    main()
