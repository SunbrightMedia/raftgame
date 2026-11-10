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
# P2_FILES: a folder of loose game files (default reference/portal2/files; the full export
# made by reference/portal2/export_all.ps1 has every material). P2_PREFIX: texture name prefix and
# output folder (default p2).
FILES = os.environ.get('P2_FILES') or os.path.join(REF, 'files')
PREFIX = os.environ.get('P2_PREFIX') or 'p2'
OUT = os.path.join(ROOT, 'textures', PREFIX)
E, _ = vpk.read_dir(os.path.join(REF, 'pak01_dir.vpk'))

TOOL = re.compile(r'^tools/')


def read(path: str) -> bytes | None:
    """A file from the reference files folder, or a VMT/preloaded file from the index."""
    p = os.path.join(FILES, path)
    if os.path.exists(p):
        return open(p, 'rb').read()
    e = E.get(path)
    if e and e[2] == 0:
        return e[3]
    return None


def resolve(shader: str, params: list) -> dict:
    """
    A material's effective parameters on Portal 2's PC path (DX9, HDR on), as
    the material system resolves them: the top level, then conditional blocks
    that hold ("hdr", ">=dx90", "gpu>=1"...), then the shader's fallback block
    for this hardware (<shader>_hdr_dx9, else <shader>_dx9), whose keys win.
    """
    def cond(name: str) -> bool:
        n = name.replace(' ', '')
        if n in ('hdr', '>=dx90', '>dx90', 'gpu>=1', 'gpu>=2', 'srgb'):
            return True
        return False   # ldr, <dx90, <dx90_20b, gpu<1, ...
    def merge(dst: dict, block: list):
        for k, v in block:
            if not isinstance(v, list):
                dst[k] = v
        for k, v in block:
            if isinstance(v, list) and cond(k):
                merge(dst, v)
    out: dict = {}
    merge(out, params)
    blocks = {k: v for k, v in params if isinstance(v, list)}
    for fb in (f'{shader}_hdr_dx9', f'{shader}_dx9'):
        if fb in blocks:
            merge(out, blocks[fb])
            break
    return out


def vmt(name: str, depth=0) -> tuple[str, dict]:
    data = read(f'materials/{name}.vmt')
    if data is None:
        return '', {}
    shader, params = kv.first_block(kv.parse(data.decode('latin-1')))
    if shader == 'patch' and depth < 4:
        top = {k: v for k, v in params if not isinstance(v, list)}
        inc = top.get('include', '').lower().replace('\\', '/')
        inc = re.sub(r'^materials/', '', inc).removesuffix('.vmt')
        shader, base = vmt(inc, depth + 1)
        for k, v in params:
            if k in ('insert', 'replace') and isinstance(v, list):
                base.update({kk: vv for kk, vv in v if not isinstance(vv, list)})
        return shader, base
    return shader, resolve(shader, params)


def vec3(s: str):
    v = [float(x) for x in re.findall(r'-?\d*\.?\d+(?:[eE][-+]?\d+)?', s or '')]
    return v[:3] if len(v) >= 3 else (v * 3)[:3] if v else None


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
    """Materials of the models already converted for this prefix (models/<prefix>/**/*.json)."""
    out = set()
    for f in glob.glob(os.path.join(ROOT, 'models', PREFIX, '**/*.json'), recursive=True):
        h = json.load(open(f))
        if h.get('format') == 'liminal-mesh':
            out |= {m.split('/', 1)[1] for m in h.get('materials', []) if '/' in m}
    return out


_trimmed: dict | None = None


def vtf_size(name: str) -> tuple[int, int]:
    """The texture's full size in texels (it sets the size in the world), also for textures the export
    trimmed to their 1024 mip (export_all.ps1 notes "trimmed WxH -> wxh" in manifest.tsv)."""
    global _trimmed
    path = f'materials/{tex_path(name)}.vtf'
    if _trimmed is None:
        _trimmed = {}
        mf = os.path.join(FILES, 'manifest.tsv')
        if os.path.exists(mf):
            for line in open(mf, encoding='utf-8'):
                m = re.match(r'([^\t]+)\t[^\t]*\t\d+\ttrimmed (\d+)x(\d+) ->', line)
                if m:
                    _trimmed[m.group(1)] = (int(m.group(2)), int(m.group(3)))
    if path in _trimmed:
        return _trimmed[path]
    i = vtf.info(read(path))
    return i['w'], i['h']


def tex_path(name: str) -> str:
    n = name.lower().replace(chr(92), "/")
    return n[:-4] if n.endswith('.vtf') else n


def decode_tex(name: str) -> Image.Image | None:
    if not name:
        return None
    name = tex_path(name)
    d = read(f'materials/{name.lower().replace(chr(92), "/")}.vtf')
    return vtf.decode(d) if d else None


def all_materials() -> list[str]:
    root = os.path.join(FILES, 'materials')
    return sorted(os.path.relpath(f, root)[:-4].replace(os.sep, '/').lower() for f in glob.glob(os.path.join(root, '**/*.vmt'), recursive=True))


def main():
    # --all: every material in P2_FILES (catalogue); --max N: base textures at most N px; --flat: base texture only, JPG.
    args = sys.argv[1:]
    every = '--all' in args
    flat = '--flat' in args
    maxpx = int(args[args.index('--max') + 1]) if '--max' in args else 0
    vmfs = [a for i, a in enumerate(args) if not a.startswith('--') and not (i and args[i - 1] == '--max')]
    mats = set()
    for vmf in vmfs:
        mats |= materials_of_vmf(vmf)
    mats |= set(all_materials()) if every else materials_of_models()
    rad = lights_rad()
    os.makedirs(OUT, exist_ok=True)
    index, missing = [], []
    for m in sorted(mats):
        if TOOL.match(m) and not every:
            continue
        shader, p = vmt(m)
        if not shader:
            missing.append(m); continue
        base = tex_path(p.get('$basetexture', ''))
        try:
            im = decode_tex(base)
        except Exception:
            im = None
        water = None
        if im is None and shader.lower() == 'water':
            # Water has no base texture: Source shows its fog colour (and its normal map's ripples).
            fc = [int(float(x)) for x in re.findall(r'-?\d*\.?\d+', p.get('$fogcolor', '{ 64 64 64 }'))[:3]] or [64, 64, 64]
            im = Image.new('RGB', (64, 64), tuple(fc)); water = fc
        if im is None:
            missing.append(m); continue
        if maxpx and max(im.size) > maxpx:
            im.thumbnail((maxpx, maxpx), Image.LANCZOS)
        if water:
            info = {'w': 512, 'h': 512, 'reflectivity': [((c / 255) ** 2.2) for c in water]}
        else:
            info = vtf.info(read(f'materials/{base}.vtf'))
            info = {**info, 'w': vtf_size(base)[0], 'h': vtf_size(base)[1]}
        translucent, alphatest, selfillum = flag(p, '$translucent'), flag(p, '$alphatest'), flag(p, '$selfillum')
        # Self-illumination is masked by the base texture's alpha, or by a separate mask texture.
        if selfillum and p.get('$selfillummask'):
            mask = decode_tex(p['$selfillummask'])
            if mask is not None:
                im = im.convert('RGBA'); im.putalpha(mask.convert('L').resize(im.size))
        # Detail mode 7 picks between two detail patterns by the base texture's alpha.
        uses_alpha = translucent or alphatest or selfillum or (p.get('$detail') and p.get('$detailblendmode', '0').strip() == '7')
        rel = m
        os.makedirs(os.path.dirname(os.path.join(OUT, rel)), exist_ok=True)
        if uses_alpha and not flat:
            file = f'{PREFIX}/{rel}.png'; im.save(os.path.join(ROOT, 'textures', file), optimize=True)
        else:
            file = f'{PREFIX}/{rel}.jpg'; im.convert('RGB').save(os.path.join(ROOT, 'textures', file), quality=88)
        src = {'shader': shader.lower(), 'basetexture': base.lower()}
        try:
            nm = None if flat else decode_tex(p.get('$bumpmap') or p.get('$normalmap', ''))
        except Exception:
            nm = None
        if nm is not None:
            if max(nm.size) > 1024:
                nm.thumbnail((1024, 1024), Image.LANCZOS)
            src['normal'] = f'{PREFIX}/{rel}_n.png'; nm.convert('RGB').save(os.path.join(ROOT, 'textures', src['normal']), optimize=True)
            # Self-shadowing bump: the texture holds the three basis weights directly (not a normal).
            if flag(p, '$ssbump'):
                src['ssbump'] = True
        det = '' if flat else (p.get('$detail') or '').lower().replace('\\', '/')
        if det:
            dim = decode_tex(det)
            if dim is not None:
                dfile = f'{PREFIX}/{det}.png'
                os.makedirs(os.path.dirname(os.path.join(ROOT, 'textures', dfile)), exist_ok=True)
                dim.convert('RGBA').save(os.path.join(ROOT, 'textures', dfile), optimize=True)   # alpha: a second pattern (mode 7)
                src['detail'] = {'file': dfile, 'scale': (vec3(p.get('$detailscale', '4')) or [4])[0], 'factor': float(p.get('$detailblendfactor', '1') or 1), 'mode': int(float(p.get('$detailblendmode', '0') or 0))}
        for k, key in [('translucent', '$translucent'), ('alphatest', '$alphatest'), ('additive', '$additive'), ('selfillum', '$selfillum'), ('nocull', '$nocull'), ('nosrgb', '$nosrgb')]:
            if flag(p, key):
                src[k] = True
        if p.get('$envmap'):
            src['envmap'] = True
        for k, key in [('selfillumtint', '$selfillumtint'), ('alpha', '$alpha'), ('alphatestreference', '$alphatestreference')]:
            if p.get(key):
                v = [float(x) for x in re.findall(r'-?\d*\.?\d+', p[key])]
                if v:
                    src[k] = v if len(v) > 1 else v[0]
        # VBSP bounces with $reflectivity when the material sets it, else the base texture's (VTF header).
        rv = vec3(p.get('$reflectivity', ''))
        src['reflectivity'] = [round(x, 4) for x in (rv or info['reflectivity'])]
        r = rad.get(m)
        if r:
            src['rad'] = r
        index.append({'name': f'{PREFIX}/{m}', 'file': file, 'size': [info['w'], info['h']], 'material': category(p.get('$surfaceprop', '')), 'raw': True,
                      'credit': 'Portal 2 (Valve): reference only, never published', 'license': 'reference-only', 'source': src})
    json.dump({'format': 'liminal-textures', 'version': 1, 'textures': index}, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    print(f'{len(index)} materials converted, {len(missing)} missing: {missing[:12]}')


if __name__ == '__main__':
    main()
