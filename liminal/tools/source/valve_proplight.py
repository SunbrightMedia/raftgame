"""
Copy Valve's per-vertex static prop lighting (the sp_N.vhv files VRAD puts in
a BSP's pak lump) onto our props, in our vertex order, and add it to the Valve
lightmap file the game reads (maps/p2/<map>.valve.lightmap.json, "props").
Props Valve didn't light per vertex (dynamic, physics) keep ours.

    python3 tools/source/valve_proplight.py maps/p2/shipyard_atrium.json reference/portal2/shipyard_v13p.bsp

VHV (LDR): per vertex BGRA8 = round(255 · min(1, 0.5 · light^(1/2.2))), hue kept
when clamped (lightmap.cpp ConvertLinearToRGBA8888; MathLib_Init(2.2, 2.2, 0, 2)).
Entries run body part → model → LOD → mesh → strip group (ApplyLightingToStaticProp);
ours are body part → model 0 → mesh → strip group of LOD 0 (convert_models.py).
"""
import io, json, os, struct, sys, zipfile, base64, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
REF = os.path.join(ROOT, 'reference/portal2/files')

mapPath, bspPath = sys.argv[1], sys.argv[2]
m = json.load(open(mapPath))
b = open(bspPath, 'rb').read()
lump = lambda i: struct.unpack_from('<2i', b, 8 + i * 16)

# Static props: dictionary, then 72-byte records (origin, angles, model index...).
go, gl = lump(35)
sprp = None
for k in range(struct.unpack_from('<i', b, go)[0]):
    gid, flags, ver, off, ln = struct.unpack_from('<4sHHii', b, go + 4 + k * 16)
    if gid[::-1] == b'sprp':
        p = off; nd = struct.unpack_from('<i', b, p)[0]; p += 4
        names = [b[p + i * 128:p + i * 128 + 128].split(b'\0')[0].decode('latin-1').lower() for i in range(nd)]; p += nd * 128
        nl = struct.unpack_from('<i', b, p)[0]; p += 4 + nl * 2
        npr = struct.unpack_from('<i', b, p)[0]; p += 4
        size = (off + ln - p) // npr
        sprp = [(struct.unpack_from('<3f', b, p + i * size), names[struct.unpack_from('<H', b, p + i * size + 24)[0]]) for i in range(npr)]
po, pl = lump(40)
pak = zipfile.ZipFile(io.BytesIO(b[po:po + pl]))
paknames = set(pak.namelist())


def vtx_groups(model):
    """Strip-group vertex counts of every (bodypart, model, lod, mesh, group), in file order."""
    v = open(os.path.join(REF, model[:-4] + '.dx90.vtx'), 'rb').read()
    _, _, nbp, bpo = struct.unpack_from('<4i', v, 20)
    out = []
    for p in range(nbp):
        po_ = bpo + p * 8
        nmodels, mo_rel = struct.unpack_from('<2i', v, po_)
        for mi in range(nmodels):
            mo = po_ + mo_rel + mi * 8
            nlods, lodo_rel = struct.unpack_from('<2i', v, mo)
            for lod in range(nlods):
                lo = mo + lodo_rel + lod * 12
                nmeshes, meo_rel, _ = struct.unpack_from('<2if', v, lo)
                for k in range(nmeshes):
                    meo = lo + meo_rel + k * 9
                    nsg, sgo_rel = struct.unpack_from('<2i', v, meo)
                    for g in range(nsg):
                        for size in (33, 25):
                            so = meo + sgo_rel + g * size
                            nv, vo, ni, io_, nst, sto = struct.unpack_from('<6i', v, so)
                            if 0 <= nv < 65536 and 0 <= ni < 1 << 22 and so + vo + nv * 9 <= len(v):
                                break
                        out.append((p, mi, lod, k, g, nv))
    return out


def decode_vhv(data):
    ver, chk, flags, vsize, nverts, nmeshes = struct.unpack_from('<6i', data, 0)
    meshes = [struct.unpack_from('<3i', data, 40 + i * 28) for i in range(nmeshes)]  # lod, nverts, offset
    out = []
    for lod, nv, off in meshes:
        raw = np.frombuffer(data, dtype=np.uint8, count=nv * 4, offset=off).reshape(nv, 4).astype(np.float64)
        rgb = raw[:, [2, 1, 0]] / 255.0                        # stored B, G, R, A
        out.append((lod, (rgb * 2.0) ** 2.2))                   # undo 0.5 · light^(1/2.2)
    return out


# Our instance order (propBakeData): map props whose model we converted.
headers = {}
for dp, _, fs in os.walk(os.path.join(ROOT, 'models')):
    for f in fs:
        if f.endswith('.json'):
            h = json.load(open(os.path.join(dp, f)))
            if h.get('format') == 'liminal-mesh':
                headers[h['source'].lower()] = h
inst = [e for e in m['entities'] if e['class'] == 'prop' and e['props'].get('model', '').lower() in headers]
counts = [headers[e['props']['model'].lower()]['vertexCount'] for e in inst]
offsets = np.concatenate([[0], np.cumsum(counts)]).astype(int)

valvePath = mapPath.replace('.json', '.valve.lightmap.json')
oursPath = mapPath.replace('.json', '.lightmap.json')
ours = None
oc = json.load(open(oursPath)) if os.path.exists(oursPath) else None
if oc and oc.get('props'):
    raw = np.frombuffer(zlib.decompress(base64.b64decode(oc['props']), -15), dtype=np.uint8).reshape(-1, 5).astype(np.float64)
    e = raw[:, 3]
    sc = np.where(e > 0, np.power(2.0, e - 128) / 255, 0)
    ours = raw[:, :3] * sc[:, None]
colors = ours.copy() if ours is not None and len(ours) == offsets[-1] else np.zeros((offsets[-1], 3))

used = matched = 0
for ii, e in enumerate(inst):
    if e['props'].get('source_class') != 'prop_static':
        continue
    model = e['props']['model'].lower()
    best = None
    for si, (org, name) in enumerate(sprp):
        if name == model and max(abs(org[k] - e['origin'][k]) for k in range(3)) < 0.1:
            best = si; break
    if best is None or f'sp_{best}.vhv' not in paknames:
        continue
    matched += 1
    vhv = decode_vhv(pak.read(f'sp_{best}.vhv'))
    groups = vtx_groups(model)
    if len(groups) != len(vhv):
        continue
    vals = [c for (p, mi, lod, k, g, nv), (vl, c) in zip(groups, vhv) if mi == 0 and lod == 0]
    arr = np.concatenate(vals) if vals else np.zeros((0, 3))
    if len(arr) != counts[ii]:
        continue
    colors[offsets[ii]:offsets[ii + 1]] = arr
    used += 1
print(f'{len(inst)} props; {matched} static props found in the BSP, {used} with Valve vertex light applied')

# RGBE + alpha, deflated (the game's cache encoding), into the Valve lightmap file.
n = len(colors)
enc = np.zeros((n, 5), np.uint8)
mx = colors.max(1)
ok = mx > 1e-6
ex = np.ceil(np.log2(np.where(ok, mx, 1)) + 1e-9)
sc = 255 / np.power(2.0, ex)
enc[ok, 0:3] = np.minimum(255, np.round(colors[ok] * sc[ok, None]))
enc[ok, 3] = (ex[ok] + 128).astype(np.uint8)
enc[:, 4] = 255
c = zlib.compressobj(9, zlib.DEFLATED, -15)
z = c.compress(enc.tobytes()) + c.flush()
v = json.load(open(valvePath))
v['props'] = base64.b64encode(z).decode()
json.dump(v, open(valvePath, 'w'))
print('added props to', valvePath)
