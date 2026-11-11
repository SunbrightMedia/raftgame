"""Import a CC0 glTF model (Poly Haven's, say) as one of our meshes (src/engine/render/models.ts: a JSON
header and a .bin of float32 positions, normals, uvs, then uint32 indices), its colour map as a texture.

  python3 -I tools/models/import_gltf.py SPEC.json

SPEC: {"polyhaven": "SchoolChair_01", "res": "1k" (downloaded into .cache/polyhaven/, gitignored) or "gltf": path,
       "name": "cc0/schoolchair_01" (what maps put in a prop's `model`),
       "textures": [{"material": glTF material name or index, "name": texture name,
                     "from": colour map path (relative: next to the .gltf),
                     "material_type": "plastic", "recolour": {...} (optional), "credit", "url"}],
       "shadowBoxes": [[[x0, y0, z0], [x1, y1, z1]], ...] (model space, inches, after the import),
       "scale": 1 (on top of metres to inches)}
glTF is metres, +Y up, its front towards +Z; ours is inches, +Z up: (x, y, z) -> (x, -z, y), so the front
faces -Y. UVs flip in v (our textures load the image upright).
recolour: {"hue": [lo, hi] degrees, "minSat": 0.25, "to": "#rrggbb"}: pixels of that hue become that colour,
keeping their brightness relative to the hue's median (scratches and dirt stay).
Changing the model to fit (all optional):
  "dropParts": {"above": z}: connected parts of the mesh (vertices welded by position) whose lowest point is
    above z (model inches) are removed (a chair's shell and its rivets, keeping the frame that stands on the floor);
  per texture "mul": 0.35: the colour map darkened (or lightened) by that factor, after any recolour;
  "pads": [{"material": texture name, "centre": [x, y, z], "size": [w, h, t], "face": "front" | "up",
            "radius": face corner radius, "edge": edge radius (<= t/2), "bulge": dome of the front face,
            "tilt": degrees about x (+ leans the top back, towards +y), "uv": inches per texture repeat}]:
    soft-edged slabs added to the mesh (cushions, struts), smooth shading all round. "front" = the slab's
    face looks along -y (w across x, h up z); "up" = it looks up (w across x, h along y); "side" = it looks
    along +x (w along y, h up z). Each texture
    name gets its own material slot after the glTF's.
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IN = 39.37007874
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def accessor(g, bufs, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    dt = np.dtype(COMP[a['componentType']])
    n, k = a['count'], NCOMP[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * k
    return np.ndarray((n, k), dt, buffer=bufs[bv['buffer']], offset=start, strides=(stride, dt.itemsize)).copy()


def node_matrix(nd):
    if 'matrix' in nd:
        return np.array(nd['matrix'], float).reshape(4, 4).T
    t = np.array(nd.get('translation', [0, 0, 0]), float)
    x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    S = np.diag(nd.get('scale', [1, 1, 1]))
    M = np.eye(4); M[:3, :3] = R @ S; M[:3, 3] = t
    return M


def recolour(img, rc):
    a = np.asarray(img.convert('RGB'), float) / 255
    mx, mn = a.max(2), a.min(2)
    d = np.maximum(mx - mn, 1e-9)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s, v = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-9), 0), mx
    lo, hi = rc['hue']
    m = (h >= lo) & (h <= hi) & (s >= rc.get('minSat', 0.25))
    to = np.array([int(rc['to'][i:i + 2], 16) / 255 for i in (1, 3, 5)])
    ref = np.median(v[m]) if m.any() else 1
    out = a.copy()
    out[m] = np.clip(to[None, :] * (v[m] / ref)[:, None], 0, 1)
    return Image.fromarray((out * 255).astype(np.uint8)), int(m.sum())


def pad(spec):
    """A soft-edged slab: a rounded rectangle (corner radius R) of thickness t whose edges are rounded by r,
    its front face domed by `bulge`. Returns positions, normals (smooth, from the faces) and uvs, indices."""
    W, H, T = spec['size']
    R, r = spec.get('radius', 1.0), min(spec.get('edge', 0.5), T / 2)
    bulge, tilt, uvs = spec.get('bulge', 0.0), np.radians(spec.get('tilt', 0.0)), spec.get('uv', 12.0)
    ax, ay, Rc = W / 2 - r, H / 2 - r, max(min(R - r, W / 2 - r, H / 2 - r), 0.0)
    # outline of the core (inset by r), counter-clockwise, with outward normals
    pts, nrm = [], []
    for cx, cy, a0 in ((ax - Rc, ay - Rc, 0), (-(ax - Rc), ay - Rc, 90), (-(ax - Rc), -(ay - Rc), 180), (ax - Rc, -(ay - Rc), 270)):
        for k in range(9):
            a = np.radians(a0 + 90 * k / 8)
            pts.append((cx + Rc * np.cos(a), cy + Rc * np.sin(a))); nrm.append((np.cos(a), np.sin(a)))
    pts, nrm = np.array(pts), np.array(nrm)
    n = len(pts)
    c0, c1 = -(T / 2 - r), T / 2 - r
    V, F = [], []
    # the rounded edge: rings from the back face (phi -90) round to the front face (phi +90)
    prof = [(-90 + 90 * k / 6, c0) for k in range(7)] + [(90 * k / 6, c1) for k in range(7)]
    for phi, cl in prof:
        ph = np.radians(phi)
        for i in range(n):
            V.append((pts[i, 0] + r * np.cos(ph) * nrm[i, 0], pts[i, 1] + r * np.cos(ph) * nrm[i, 1], cl + r * np.sin(ph)))
    rings = len(prof)
    for j in range(rings - 1):
        for i in range(n):
            a, b, c, d = j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i
            F += [(a, b, c), (a, c, d)]
    # caps: concentric rings shrinking to the middle (front one domed)
    def cap(first, z, sign, dome):
        prev = first
        steps = 6
        for s_ in range(1, steps):
            k = 1 - s_ / steps
            base = len(V)
            for i in range(n):
                V.append((pts[i, 0] * k, pts[i, 1] * k, z + dome * (1 - k * k)))
            for i in range(n):
                a, b, c, d = prev + i, prev + (i + 1) % n, base + (i + 1) % n, base + i
                F.extend([(a, b, c), (a, c, d)] if sign > 0 else [(a, c, b), (a, d, c)])
            prev = base
        mid = len(V); V.append((0.0, 0.0, z + dome))
        for i in range(n):
            a, b = prev + i, prev + (i + 1) % n
            F.append((a, b, mid) if sign > 0 else (a, mid, b))
    cap((rings - 1) * n, T / 2, 1, bulge)
    cap(0, -T / 2, -1, 0.0)
    V, F = np.array(V, float), np.array(F, np.int64)
    # local (a across, b up the face, c out of the face) -> model axes, tilted about x, moved to the centre
    face = spec.get('face', 'front')
    if face == 'front':
        M = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)   # a -> x, b -> z, c -> -y
    elif face == 'side':
        M = np.array([[0, 0, 1], [1, 0, 0], [0, 1, 0]], float)    # a -> y, b -> z, c -> x
    else:
        M = np.eye(3)                                              # a -> x, b -> y, c -> z (no mirror: the winding stays)
    ct, st = np.cos(tilt), np.sin(tilt)
    Rx = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]])
    P = (Rx @ M @ V.T).T + np.array(spec['centre'], float)
    # smooth normals: area-weighted face normals at each vertex
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    N = np.zeros_like(P)
    for k in range(3): np.add.at(N, F[:, k], fn)
    N /= np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    U = np.stack([V[:, 0] / uvs + 0.5, 1 - (V[:, 1] / uvs + 0.5)], 1)
    return P, N, U, F.reshape(-1)


def fetch_polyhaven(pid, res):
    """Poly Haven's glTF of a model (CC0), with its .bin and textures, in .cache/polyhaven/<id>/ (fetched once)."""
    import subprocess
    dest = os.path.join(ROOT, '.cache', 'polyhaven', pid)
    files = json.loads(subprocess.run(['curl', '-sfL', '-m', '120', f'https://api.polyhaven.com/files/{pid}'], capture_output=True, check=True).stdout)
    g = files['gltf'][res]['gltf']

    def get(url, rel):
        path = os.path.normpath(os.path.join(dest, rel))
        if not path.startswith(dest + os.sep):
            raise ValueError(f'unexpected path in the listing: {rel}')
        if not os.path.exists(path):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            subprocess.run(['curl', '-sfL', '-m', '300', '-o', path, url], check=True)
        return path
    main = get(g['url'], os.path.basename(g['url']))
    for rel, v in g['include'].items():
        get(v['url'], rel)
    return main


def main():
    spec = json.load(open(sys.argv[1]))
    if not spec.get('gltf') and not spec.get('polyhaven'):
        return build(spec, None)
    gpath = spec['gltf'] if spec.get('gltf') else fetch_polyhaven(spec['polyhaven'], spec.get('res', '1k'))
    return build(spec, gpath)


def build(spec, gpath):
    if gpath is None:
        g, gdir, bufs, mats = {'scenes': [{'nodes': []}], 'nodes': []}, '', [], []
    else:
        g = json.load(open(gpath))
        gdir = os.path.dirname(gpath)
        bufs = [open(os.path.join(gdir, b['uri']), 'rb').read() for b in g['buffers']]
        mats = g.get('materials', [])
    conv = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float) * IN * spec.get('scale', 1)
    P, N, U, I, groups = [], [], [], [], []
    vbase = 0

    def walk(ni, parent):
        nonlocal vbase
        nd = g['nodes'][ni]
        M = parent @ node_matrix(nd)
        if 'mesh' in nd:
            for prim in g['meshes'][nd['mesh']]['primitives']:
                at = prim['attributes']
                pos = accessor(g, bufs, at['POSITION']).astype(float)
                nrm = accessor(g, bufs, at['NORMAL']).astype(float) if 'NORMAL' in at else np.zeros_like(pos)
                uv = accessor(g, bufs, at['TEXCOORD_0']).astype(float) if 'TEXCOORD_0' in at else np.zeros((len(pos), 2))
                idx = accessor(g, bufs, prim['indices']).reshape(-1).astype(np.uint32) if 'indices' in prim else np.arange(len(pos), dtype=np.uint32)
                pw = (M[:3, :3] @ pos.T).T + M[:3, 3]
                nm = np.linalg.inv(M[:3, :3]).T
                nw = (nm @ nrm.T).T
                P.append((conv @ pw.T).T)
                nn = (conv @ nw.T).T
                N.append(nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9))
                U.append(np.stack([uv[:, 0], 1 - uv[:, 1]], 1))
                groups.append((prim.get('material', 0), sum(len(x) for x in I), len(idx)))
                I.append(idx + vbase)
                vbase += len(pos)
        for c in nd.get('children', []):
            walk(c, M)

    scene = g['scenes'][g.get('scene', 0)]
    for r in scene['nodes']:
        walk(r, np.eye(4))
    P = np.concatenate(P) if P else np.zeros((0, 3)); N = np.concatenate(N) if N else np.zeros((0, 3))
    U = np.concatenate(U) if U else np.zeros((0, 2))
    I = np.concatenate(I).astype(np.int64) if I else np.zeros(0, np.int64)
    # material slots: the glTF materials in order, each to its texture name from the spec
    names = []
    slot_of = {}
    for t in spec.get('textures', []):
        mi = t['material'] if isinstance(t['material'], int) else next(i for i, m in enumerate(mats) if m.get('name') == t['material'])
        while len(names) <= mi: names.append('missing')
        names[mi] = t['name']
        slot_of[id(t)] = mi
    # changing the model: drop whole parts (welded by position, so UV seams don't split them)
    tri_slot = np.zeros(len(I) // 3, np.int64)
    for m, o, c in groups: tri_slot[o // 3:(o + c) // 3] = m
    keep = np.ones(len(I) // 3, bool)
    if spec.get('dropParts'):
        _, weld = np.unique(np.round(P * 100).astype(np.int64), axis=0, return_inverse=True)
        weld = weld.reshape(-1)
        par = np.arange(weld.max() + 1)

        def find(a):
            while par[a] != a:
                par[a] = par[par[a]]; a = par[a]
            return a
        tw = weld[I.reshape(-1, 3)]
        for a, b, c in tw:
            ra = find(a); par[find(b)] = ra; par[find(c)] = ra
        part = np.array([find(t[0]) for t in tw])
        low = {}
        for k, pid in enumerate(part):
            low[pid] = min(low.get(pid, 1e9), P[I[k * 3:k * 3 + 3], 2].min())
        above = spec['dropParts']['above']
        gone = {pid for pid, z in low.items() if z > above}
        keep = np.array([pid not in gone for pid in part])
        print(f"  dropped {len(gone)} of {len(low)} parts ({int((~keep).sum())} triangles)")
    tri = I.reshape(-1, 3)[keep]; tri_slot = tri_slot[keep]
    used = np.unique(tri)
    remap = -np.ones(len(P), np.int64); remap[used] = np.arange(len(used))
    P, N, U = P[used], N[used], U[used]
    tri = remap[tri]
    # regroup by slot (each slot one run of indices)
    order = np.argsort(tri_slot, kind='stable')
    tri, tri_slot = tri[order], tri_slot[order]
    groups = []
    for m in np.unique(tri_slot):
        sel = np.nonzero(tri_slot == m)[0]
        groups.append((int(m), int(sel[0] * 3), int(len(sel) * 3)))
    I = tri.reshape(-1)
    # ... and add the pads, each texture its own slot after the glTF's
    for pd in spec.get('pads', []):
        if pd['material'] not in names: names.append(pd['material'])
        m = names.index(pd['material'])
        pp, pn, pu, pi = pad(pd)
        base = len(P)
        P = np.concatenate([P, pp]); N = np.concatenate([N, pn]); U = np.concatenate([U, pu])
        groups.append((m, len(I), len(pi)))
        I = np.concatenate([I, pi + base])
    if spec.get('pads'): print(f"  added {len(spec['pads'])} pads")
    P, N, U, I = P.astype(np.float32), N.astype(np.float32), U.astype(np.float32), I.astype(np.uint32)
    # textures: the colour map, recoloured if asked, into textures/src; an index entry with the credit
    idx_path = os.path.join(ROOT, 'textures', 'index.json')
    index = json.load(open(idx_path))
    for t in spec.get('textures', []):
        img = Image.open(os.path.join(gdir, t['from'])).convert('RGB')
        if t.get('recolour'):
            img, n = recolour(img, t['recolour']); print(f"  {t['name']}: recoloured {n} px")
        if t.get('mul'):
            img = Image.fromarray(np.clip(np.asarray(img, float) * t['mul'], 0, 255).astype(np.uint8))
        fn = 'src/' + t['name'].replace('/', '__') + '.jpg'
        img.save(os.path.join(ROOT, 'textures', fn), quality=92)
        # The crusher sizes a texture by world size × texel density (4/inch): a model's atlas isn't tiled over a
        # wall, so give it a size that keeps the whole atlas at the crusher's largest size (512 px).
        entry = {'name': t['name'], 'file': fn, 'size': [128, 128], 'material': t.get('material_type', 'plastic'), 'credit': t['credit'], 'url': t['url'], 'license': 'CC0 1.0'}
        index['textures'] = [e for e in index['textures'] if e['name'] != t['name']] + [entry]
    json.dump(index, open(idx_path, 'w'), indent=1)
    open(idx_path, 'a').write('\n')
    # the mesh
    out_dir = os.path.join(ROOT, 'models', os.path.dirname(spec['name']))
    os.makedirs(out_dir, exist_ok=True)
    stem = os.path.basename(spec['name'])
    with open(os.path.join(out_dir, stem + '.bin'), 'wb') as f:
        f.write(P.tobytes()); f.write(N.tobytes()); f.write(U.tobytes()); f.write(I.tobytes())
    lo, hi = P.min(0).tolist(), P.max(0).tolist()
    header = {
        'format': 'liminal-mesh', 'version': 1, 'source': spec['name'], 'bin': stem + '.bin',
        'vertexCount': int(len(P)), 'indexCount': int(len(I)), 'materials': names, 'skins': [list(range(len(names)))],
        'bounds': [lo, hi], 'hull': [lo, hi],
        'meshes': [{'slot': int(m), 'vertexOffset': 0, 'vertexCount': int(len(P)), 'indexOffset': int(o), 'indexCount': int(n)} for m, o, n in groups],
        **({'shadowBoxes': spec['shadowBoxes']} if spec.get('shadowBoxes') else {}),
        'credit': spec.get('credit', ''), 'license': spec.get('license', 'CC0 1.0'),
    }
    json.dump(header, open(os.path.join(out_dir, stem + '.json'), 'w'))
    print(f"wrote models/{spec['name']}.json: {len(P)} vertices, {len(I) // 3} triangles, bounds {[round(v, 1) for v in lo]} .. {[round(v, 1) for v in hi]}")
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from credits import write_credits
    write_credits()


if __name__ == '__main__':
    main()
