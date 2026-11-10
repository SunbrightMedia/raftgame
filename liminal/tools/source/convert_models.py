"""
Convert Source models (MDL v44-49 + VVD + VTX) used by a map into our mesh
format, for reference/calibration scenes.

    python3 tools/source/convert_models.py maps/p2/shipyard_atrium.json

Reads reference/portal2/files/<model>.mdl|.vvd|.dx90.vtx (LOD 0), writes
models/p2/<model>.json (header) + .bin (buffers):
  { "materials": ["p2/models/..."], "skins": [[material index per slot], ...],
    "bounds": [min, max], "hull": [min, max],
    "meshes": [{ "slot": i, "vertexOffset": o, "vertexCount": n, "indexOffset": o, "indexCount": n }],
    "bin": "<file>.bin" }
.bin holds float32 positions (xyz), normals (xyz), uvs (uv) for all vertices,
then uint32 indices. Source units = inches, Z up: no conversion.
Material names follow the map's texture naming ("p2/" + material path).
"""
import json, os, struct, sys
from array import array

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '../..'))
REF = os.path.join(ROOT, 'reference/portal2/files')
OUT = os.path.join(ROOT, 'models/p2')
sys.path.insert(0, HERE)
import vpk  # noqa: E402

E, _ = vpk.read_dir(os.path.join(ROOT, 'reference/portal2/pak01_dir.vpk'))


def cstr(b, o):
    return b[o:b.index(b'\0', o)].decode('latin-1')


def read_mdl(b):
    assert b[:4] == b'IDST'
    hull = struct.unpack_from('<6f', b, 104)
    ntex, texi, ncd, cdi, nskinref, nskinfam, skini, nbp, bpi = struct.unpack_from('<9i', b, 204)
    names = [cstr(b, texi + i * 64 + struct.unpack_from('<i', b, texi + i * 64)[0]) for i in range(ntex)]
    cds = [cstr(b, struct.unpack_from('<i', b, cdi + i * 4)[0]).replace('\\', '/') for i in range(ncd)]
    mats = []
    for n in names:
        found = None
        for cd in cds:
            k = (cd + n).lower().replace('\\', '/').replace('//', '/')
            if f'materials/{k}.vmt' in E:
                found = k; break
        mats.append('p2/' + (found or (cds[0] + n if cds else n).lower().replace('\\', '/')))
    skins = [list(struct.unpack_from(f'<{nskinref}h', b, skini + f * nskinref * 2)) for f in range(nskinfam)]
    bodyparts = []
    for p in range(nbp):
        o = bpi + p * 16
        _, nmodels, base, mi = struct.unpack_from('<4i', b, o)
        models = []
        for m in range(nmodels):
            mo = o + mi + m * 148
            nmeshes, meshi, nverts, verti = struct.unpack_from('<4i', b, mo + 72)
            meshes = []
            for k in range(nmeshes):
                ms = mo + meshi + k * 116
                mat, _mi, mnv, mvo = struct.unpack_from('<4i', b, ms)
                meshes.append({'material': mat, 'numvertices': mnv, 'vertexoffset': mvo})
            models.append({'vertexindex': verti, 'numvertices': nverts, 'meshes': meshes})
        bodyparts.append(models)
    return {'hull': hull, 'materials': mats, 'skins': skins, 'bodyparts': bodyparts}


def read_vvd(b):
    assert b[:4] == b'IDSV'
    numlods = struct.unpack_from('<i', b, 12)[0]
    nlodv = struct.unpack_from('<8i', b, 16)
    nfix, fixstart, vstart, _tan = struct.unpack_from('<4i', b, 48)
    def vert(i):
        o = vstart + i * 48
        return struct.unpack_from('<8f', b, o + 16)   # pos xyz, normal xyz, uv
    if nfix == 0:
        return [vert(i) for i in range(nlodv[0])]
    out = []
    for f in range(nfix):
        lod, src, n = struct.unpack_from('<3i', b, fixstart + f * 12)
        if lod >= 0:
            out.extend(vert(src + k) for k in range(n))
    return out


def read_vtx(b, mdl):
    """LOD 0: per bodypart → model → mesh: list of (origMeshVertID list, triangle indices into it)."""
    numlods, _mro, nbp, bpo = struct.unpack_from('<4i', b, 20)
    out = []
    for p in range(nbp):
        po = bpo + p * 8
        nmodels, mo_rel = struct.unpack_from('<2i', b, po)
        models = []
        for m in range(nmodels):
            mo = po + mo_rel + m * 8
            nlods, lodo_rel = struct.unpack_from('<2i', b, mo)
            lo = mo + lodo_rel                               # LOD 0
            nmeshes, meo_rel, _sw = struct.unpack_from('<2if', b, lo)
            meshes = []
            for k in range(nmeshes):
                meo = lo + meo_rel + k * 9
                nsg, sgo_rel = struct.unpack_from('<2i', b, meo)
                groups = []
                for g in range(nsg):
                    # Strip group header is 25 bytes in older games, 33 with topology fields (L4D2/Portal 2+).
                    for size in (33, 25):
                        so = meo + sgo_rel + g * size
                        nv, vo, ni, io, nst, sto = struct.unpack_from('<6i', b, so)
                        if 0 <= nv < 65536 and 0 <= ni < 1 << 22 and so + vo + nv * 9 <= len(b) and so + io + ni * 2 <= len(b):
                            break
                    ids = [struct.unpack_from('<H', b, so + vo + v * 9 + 4)[0] for v in range(nv)]
                    idx = list(struct.unpack_from(f'<{ni}H', b, so + io))
                    groups.append((ids, idx))
                meshes.append(groups)
            models.append(meshes)
        out.append(models)
    return out


def convert(model: str):
    base = os.path.join(REF, model[:-4])
    if not all(os.path.exists(base + e) for e in ('.mdl', '.vvd', '.dx90.vtx')):
        return False, 'missing files'
    mdl = read_mdl(open(base + '.mdl', 'rb').read())
    verts = read_vvd(open(base + '.vvd', 'rb').read())
    vtx = read_vtx(open(base + '.dx90.vtx', 'rb').read(), mdl)
    pos, nrm, uv, ind = array('f'), array('f'), array('f'), array('I')
    meshes = []
    for p, models in enumerate(mdl['bodyparts']):
        if p >= len(vtx):
            break
        m = models[0] if models else None                 # body group 0
        if not m or not vtx[p]:
            continue
        for k, mesh in enumerate(m['meshes']):
            if k >= len(vtx[p][0]):
                break
            vo, io = len(pos) // 3, len(ind)
            start = m['vertexindex'] // 48 + mesh['vertexoffset']
            for ids, idx in vtx[p][0][k]:
                g0 = len(pos) // 3
                for i in ids:
                    v = verts[start + i]
                    pos.extend(v[0:3]); nrm.extend(v[3:6]); uv.extend((v[6], 1 - v[7]))
                # VTX winding is clockwise seen from outside; ours is counter-clockwise.
                for t in range(0, len(idx) - 2, 3):
                    ind.extend((g0 + idx[t], g0 + idx[t + 2], g0 + idx[t + 1]))
            if len(ind) > io:
                meshes.append({'slot': mesh['material'], 'vertexOffset': vo, 'vertexCount': len(pos) // 3 - vo, 'indexOffset': io, 'indexCount': len(ind) - io})
    if not meshes:
        return False, 'no geometry'
    # Lightmap shadow shape, as VRAD uses it: the collision model's first solid (.phy), else a
    # convex hull per mesh (vradstaticprops.cpp CreateCollisionModel / ComputeConvexHull).
    shadow = None
    if os.path.exists(base + '.phy'):
        from phy import phy_triangles
        t = phy_triangles(open(base + '.phy', 'rb').read())
        if t is not None:
            shadow = t.reshape(-1)
    if shadow is None:
        try:
            import numpy as np
            from scipy.spatial import ConvexHull
            P = np.frombuffer(pos.tobytes(), dtype=np.float32).reshape(-1, 3)
            parts = []
            for m in meshes:
                pts = P[m['vertexOffset']:m['vertexOffset'] + m['vertexCount']]
                if len(pts) >= 4:
                    try:
                        h = ConvexHull(pts)
                        parts.append(pts[h.simplices])
                    except Exception:
                        pass
            if parts:
                shadow = np.concatenate(parts).reshape(-1)
        except ImportError:
            pass
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    out = os.path.join(OUT, model[len('models/'):-4])
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out + '.bin', 'wb') as f:
        pos.tofile(f); nrm.tofile(f); uv.tofile(f); ind.tofile(f)
    h = mdl['hull']
    json.dump({'format': 'liminal-mesh', 'version': 1, 'source': model, 'bin': os.path.basename(out) + '.bin',
               'vertexCount': len(pos) // 3, 'indexCount': len(ind),
               'materials': mdl['materials'], 'skins': mdl['skins'],
               'bounds': [[min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]], 'hull': [list(h[:3]), list(h[3:])],
               'meshes': meshes, **({'shadow': [round(float(x), 2) for x in shadow]} if shadow is not None else {})}, open(out + '.json', 'w'))
    return True, f'{len(pos) // 3} verts, {len(ind) // 3} tris'


def main():
    models = set()
    for mp in sys.argv[1:]:
        for e in json.load(open(mp))['entities']:
            if e['class'] == 'prop' and e['props'].get('model'):
                models.add(e['props']['model'])
    ok = bad = 0
    for m in sorted(models):
        try:
            good, msg = convert(m)
        except Exception as ex:  # report and continue
            good, msg = False, repr(ex)[:120]
        ok += good; bad += not good
        if not good:
            print('  skip', m, msg)
    print(f'{ok} models converted, {bad} skipped')


if __name__ == '__main__':
    main()
