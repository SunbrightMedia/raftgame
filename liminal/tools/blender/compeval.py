"""Blender 5.3 compositor, re-implemented in numpy float32, for one project's dumped node graph.

    python3 -I tools/blender/compeval.py DUMP.json INPUT.f32 W H OUT.f32 [--frame 1] [--socket PATH:OUT]

Why: an exact copy of a project's post-processing needs Blender's semantics, not only its formulas: every image
carries a domain (data size, display size, offset, a 3x3 transformation); Scale and Displace change it; each node
picks its operation domain from its inputs by priority and resamples ("realizes") the others onto it with their
interpolation and extension modes; types convert implicitly (colour to float is luminance, vector to float the
mean). These rules decide, for example, that the project's film grain ends on an 856 x 482 image.

Everything here is our own code, written from reading Blender's source (GPL; not copied) and checked against
Blender's own output with tools/blender/bl_probe.py, socket by socket. Values are float32, computed in Blender's
operation order. Images are numpy arrays [H, W, C] with row 0 at the BOTTOM (Blender's layout).
"""
import json, math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compgraph import Graph  # noqa: E402  (flattening of groups and reroutes)

F = np.float32
f = F


# ----------------------------------------------------------------------------------------------- domains

def mat_mul(A, B):
    """3x3 float32 product, summed in index order."""
    C = np.zeros((3, 3), F)
    for i in range(3):
        for j in range(3):
            s = F(A[i, 0] * B[0, j])
            s = F(s + F(A[i, 1] * B[1, j]))
            C[i, j] = F(s + F(A[i, 2] * B[2, j]))
    return C


def mat_inv(M):
    """Eigen's computeInverseWithCheck for 3x3 (what BLI math::invert calls), in float32 and in its order."""
    m = np.array(M, F)

    def cof(i, j):
        i1, i2, j1, j2 = (i + 1) % 3, (i + 2) % 3, (j + 1) % 3, (j + 2) % 3
        return F(F(m[i1, j1] * m[i2, j2]) - F(m[i1, j2] * m[i2, j1]))
    c0 = [cof(0, 0), cof(1, 0), cof(2, 0)]
    det = F(F(F(c0[0] * m[0, 0]) + F(c0[1] * m[1, 0])) + F(c0[2] * m[2, 0]))
    inv = F(F(1) / det)
    R = np.zeros((3, 3), F)
    R[1, 0] = F(cof(0, 1) * inv); R[1, 1] = F(cof(1, 1) * inv); R[2, 0] = F(cof(0, 2) * inv)
    R[1, 2] = F(cof(2, 1) * inv); R[2, 1] = F(cof(1, 2) * inv); R[2, 2] = F(cof(2, 2) * inv)
    R[0, :] = [F(c * inv) for c in c0]
    return R


def from_location(t):
    M = np.eye(3, dtype=F); M[0, 2], M[1, 2] = F(t[0]), F(t[1]); return M


def from_scale(s):
    M = np.eye(3, dtype=F); M[0, 0], M[1, 1] = F(s[0]), F(s[1]); return M


def translate(M, t):
    """Blender's math::translate(mat, t) = mat * from_location(t), in its order: location += t[c] * column c."""
    R = np.array(M, F)
    for c in range(2):
        for r in range(2):
            R[r, 2] = F(R[r, 2] + F(F(t[c]) * R[r, c]))
    return R


class Domain:
    __slots__ = ('size', 'display', 'offset', 'T')

    def __init__(self, size, T=None, display=None, offset=(0, 0)):
        self.size = (int(size[0]), int(size[1]))
        self.display = self.size if display is None else (int(display[0]), int(display[1]))
        self.offset = (int(offset[0]), int(offset[1]))
        self.T = np.eye(3, dtype=F) if T is None else np.array(T, F)

    @staticmethod
    def identity():
        return Domain((1, 1))

    def copy(self):
        return Domain(self.size, self.T.copy(), self.display, self.offset)

    def transformed(self, M):
        d = self.copy(); d.T = mat_mul(np.array(M, F), self.T); return d

    def same_frame(self, o):
        return self.size == o.size and self.display == o.display and self.offset == o.offset

    def __eq__(self, o):
        return self.same_frame(o) and np.array_equal(self.T, o.T)

    def is_equal(self, o, eps=F(10e-6)):
        return self.same_frame(o) and bool(np.all(np.abs(self.T - o.T) <= eps))

    def realize_transformation(self, realize_translation=False):
        loc = from_location((self.T[0, 2], self.T[1, 2]))
        if np.all(np.abs(self.T[:2, :2] - np.eye(2, dtype=F)) <= F(10e-6)):
            d = self.copy(); d.T = np.eye(3, dtype=F) if realize_translation else loc; return d
        R = np.eye(3, dtype=F); R[:2, :2] = self.T[:2, :2]
        centred = translate(R, (-F(self.display[0]) / F(2), -F(self.display[1]) / F(2)))

        def bounds(lo, hi):
            pts = [(lo[0], lo[1]), (hi[0], lo[1]), (lo[0], hi[1]), (hi[0], hi[1])]
            xs, ys = [], []
            for x, y in pts:
                x, y = F(x), F(y)
                xs.append(F(F(F(centred[0, 0] * x) + F(centred[0, 1] * y)) + centred[0, 2]))
                ys.append(F(F(F(centred[1, 0] * x) + F(centred[1, 1] * y)) + centred[1, 2]))
            mn = (int(math.floor(min(xs))), int(math.floor(min(ys))))
            mx = (int(math.ceil(max(xs))), int(math.ceil(max(ys))))
            return mn, mx
        dmn, dmx = bounds((0, 0), self.display)
        amn, amx = bounds(self.offset, (self.offset[0] + self.size[0], self.offset[1] + self.size[1]))
        d = self.copy()
        d.display = (max(1, dmx[0] - dmn[0]), max(1, dmx[1] - dmn[1]))
        d.size = (max(1, amx[0] - amn[0]), max(1, amx[1] - amn[1]))
        d.offset = (amn[0] - dmn[0], amn[1] - dmn[1])
        d.T = np.eye(3, dtype=F) if realize_translation else loc
        return d

    def __repr__(self):
        s = '' if np.array_equal(self.T, np.eye(3, dtype=F)) else ' T=' + str(self.T[:2].tolist())
        return f'Domain({self.size[0]}x{self.size[1]}{s})'


# ----------------------------------------------------------------------------------------------- results

NCH = {'float': 1, 'float2': 2, 'float3': 3, 'float4': 4, 'color': 4, 'int': 1, 'int2': 2, 'bool': 1, 'menu': 1}


class Res:
    """A compositor result: a single value (data shape [C]) or an image (data [H, W, C], row 0 at the bottom)."""
    __slots__ = ('type', 'data', 'domain', 'ro')

    def __init__(self, type_, data, domain=None, ro=None):
        self.type = type_
        self.data = data
        self.domain = domain
        self.ro = ro or ('bilinear', 'clip', 'clip')

    @property
    def single(self):
        return self.domain is None

    @staticmethod
    def value(type_, v):
        if type_ == 'menu':
            return Res('menu', v)
        a = np.array(v if isinstance(v, (list, tuple)) else [v], F).reshape(-1)
        n = NCH[type_]
        if a.size < n:
            a = np.concatenate([a, np.zeros(n - a.size, F)]) if type_ != 'color' else np.array(list(a) + [1.0] * (n - a.size), F)
        return Res(type_, a[:n].copy())

    def share(self):
        r = Res(self.type, self.data, self.domain.copy() if self.domain else None, self.ro); return r

    def __repr__(self):
        return f'Res({self.type}, {"single " + str(self.data) if self.single else self.domain})'


def luminance(rgb):
    # IMB_colormanagement_get_luminance: the OCIO config's luma (0.2126, 0.7152, 0.0722), float32 dot in order
    c = (F(0.2126), F(0.7152), F(0.0722))
    return F(1) * (rgb[..., 0] * c[0] + rgb[..., 1] * c[1] + rgb[..., 2] * c[2]).astype(F)


def convert(r, to):
    """Blender's implicit conversion (BKE type_conversions), on a single value or an image."""
    fr = r.type
    if fr == to or to is None:
        return r
    a = r.data
    shp = a.shape[:-1]

    def out(d):
        return Res(to, d.astype(F), r.domain.copy() if r.domain else None, r.ro)
    if fr in ('float', 'int', 'bool'):
        x = a[..., 0].astype(F)
        if to == 'float': return out(x[..., None])
        if to == 'float2': return out(np.stack([x, x], -1))
        if to == 'float3': return out(np.stack([x, x, x], -1))
        if to == 'float4': return out(np.stack([x, x, x, x], -1))
        if to == 'color': return out(np.stack([x, x, x, np.ones(shp, F)], -1))
        if to == 'int': return Res('int', np.trunc(x)[..., None].astype(np.int32), r.domain, r.ro)
        if to == 'bool': return Res('bool', (x > 0)[..., None], r.domain, r.ro)
    if fr == 'float2':
        if to == 'float': return out(((a[..., 0] + a[..., 1]) / F(2))[..., None])
        if to == 'float3': return out(np.concatenate([a, np.zeros(shp + (1,), F)], -1))
        if to == 'color': return out(np.concatenate([a, np.zeros(shp + (1,), F), np.ones(shp + (1,), F)], -1))
    if fr == 'float3':
        if to == 'float': return out((((a[..., 0] + a[..., 1]) + a[..., 2]) / F(3))[..., None])
        if to == 'float2': return out(a[..., :2])
        if to == 'color': return out(np.concatenate([a, np.ones(shp + (1,), F)], -1))
        if to == 'bool': return Res('bool', np.any(a != 0, -1)[..., None], r.domain, r.ro)
    if fr in ('color', 'float4'):
        if to == 'float': return out(luminance(a)[..., None]) if fr == 'color' else out(((a[..., 0] + a[..., 1] + a[..., 2] + a[..., 3]) / F(4))[..., None])
        if to == 'float3': return out(a[..., :3])
        if to == 'float2': return out(a[..., :2])
        if to in ('color', 'float4'): return out(a)
        if to == 'bool': return Res('bool', (luminance(a) > 0)[..., None], r.domain, r.ro)
    raise NotImplementedError(f'conversion {fr} -> {to}')


# ----------------------------------------------------------------------------------------------- sampling

def wrap(u, size, mode):
    """BLI wrap_coord: integer texel for float u, -1 for 'zero' (clip)."""
    u = u.astype(F)
    res = np.empty(u.shape, np.int64)
    pos = u >= 0
    inside = pos & (u < F(size))
    res[inside] = u[inside].astype(np.int64)
    if mode == 'extend':
        res[pos & ~inside] = size - 1; res[~pos] = 0
    elif mode == 'repeat':
        m = pos & ~inside
        res[m] = u[m].astype(np.uint32) % np.uint32(size)
        neg = ~pos
        x = (-np.floor(u[neg])).astype(np.uint32) % np.uint32(size)
        res[neg] = np.where(x != 0, size - x.astype(np.int64), 0)
    else:
        res[~inside] = -1
    return res


def fetch(data, x, y):
    """data[y, x] with -1 meaning zero."""
    H, W, C = data.shape
    ok = (x >= 0) & (y >= 0)
    v = data[np.clip(y, 0, H - 1), np.clip(x, 0, W - 1)]
    return np.where(ok[..., None], v, F(0)).astype(data.dtype)


def sample(data, tu, tv, interp, ex, ey):
    """Result.sample at texel-space coordinates (normalized coordinates times size), float32."""
    H, W, C = data.shape
    tu = tu.astype(F); tv = tv.astype(F)
    if interp == 'nearest':
        return fetch(data, wrap(tu, W, ex), wrap(tv, H, ey))
    u = (tu - F(0.5)).astype(F); v = (tv - F(0.5)).astype(F)
    if interp == 'bilinear':
        x1, x2 = wrap(u, W, ex), wrap((u + F(1)).astype(F), W, ex)
        y1, y2 = wrap(v, H, ey), wrap((v + F(1)).astype(F), H, ey)
        a = (u - np.floor(u)).astype(F)[..., None]; b = (v - np.floor(v)).astype(F)[..., None]
        a_b = a * b; ma_b = (F(1) - a) * b; a_mb = a * (F(1) - b); ma_mb = (F(1) - a) * (F(1) - b)
        r1, r2, r3, r4 = fetch(data, x1, y1), fetch(data, x1, y2), fetch(data, x2, y1), fetch(data, x2, y2)
        if C == 4:   # the SSE path: (r1 + r3) + (r2 + r4)
            return ((ma_mb * r1 + a_mb * r3).astype(F) + (ma_b * r2 + a_b * r4).astype(F)).astype(F)
        return (((ma_mb * r1 + a_mb * r3) + ma_b * r2) + a_b * r4).astype(F)
    if interp == 'bicubic':
        def coef(t):
            t2 = t * t; t3 = t2 * t
            w3 = t3 * F(1.0 / 6.0)
            w0 = ((-w3 + t2 * F(0.5)) - t * F(0.5)) + F(1.0 / 6.0)
            w1 = (t3 * F(0.5) - t2 * F(1.0)) + F(2.0 / 3.0)
            w2 = ((F(1) - w0) - w1) - w3
            return [w.astype(F) for w in (w0, w1, w2, w3)]
        wx = coef((u - np.floor(u)).astype(F)); wy = coef((v - np.floor(v)).astype(F))
        out = np.zeros(u.shape + (C,), F)
        for n in range(4):
            y1 = wrap((v - F(1) + F(n)).astype(F), H, ey)
            for m in range(4):
                x1 = wrap((u - F(1) + F(m)).astype(F), W, ex)
                w = (wx[m] * wy[n]).astype(F)
                ok = ((x1 >= 0) & (y1 >= 0))[..., None]
                out = np.where(ok, out + fetch(data, x1, y1) * w[..., None], out).astype(F)
        return out
    raise NotImplementedError(interp)


def realize(r, target, mode_translation=False):
    """RealizeOnDomainOperation: resample r onto `target` (an already realized domain)."""
    ind = r.domain
    corrective = (F(0), F(0))
    if r.ro[0] == 'nearest':
        e = F(np.finfo(F).eps * F(10e3)); corrective = (e, e)
    else:
        corrective = (F(-0.5) if (ind.size[0] ^ target.size[0]) & 1 else F(0),
                      F(-0.5) if (ind.size[1] ^ target.size[1]) & 1 else F(0))
    ic = (F(ind.display[0]) / F(2), F(ind.display[1]) / F(2))
    it = (F(F(ind.offset[0]) - ic[0]) + corrective[0], F(F(ind.offset[1]) - ic[1]) + corrective[1])
    in_d2v = translate(ind.T, it)
    oc = (F(target.display[0]) / F(2), F(target.display[1]) / F(2))
    ot = (F(F(target.offset[0]) - oc[0]), F(F(target.offset[1]) - oc[1]))
    out_d2v = translate(target.T, ot)
    o2i = mat_mul(mat_inv(in_d2v), out_d2v)
    M = mat_mul(mat_mul(from_scale((F(1) / F(ind.size[0]), F(1) / F(ind.size[1]))), o2i), from_location((0.5, 0.5)))
    W, H = target.size
    xs, ys = np.meshgrid(np.arange(W, dtype=F), np.arange(H, dtype=F))
    cx = (F(1) * (M[0, 0] * xs + M[0, 1] * ys) + M[0, 2]).astype(F)
    cy = (F(1) * (M[1, 0] * xs + M[1, 1] * ys) + M[1, 2]).astype(F)
    tu = (cx * F(ind.size[0])).astype(F); tv = (cy * F(ind.size[1])).astype(F)
    data = sample(r.data.astype(F) if r.data.dtype != np.bool_ else r.data.astype(F), tu, tv, *r.ro)
    out = Res(r.type, data, Domain(target.size, target.T, target.display, target.offset))
    return out


def realize_onto(r, op_domain, realization_mode='domain'):
    if r.single or realization_mode == 'none':
        return r
    target = op_domain if realization_mode == 'domain' else r.domain
    rt = target.realize_transformation(realization_mode == 'transforms')
    if r.domain.is_equal(rt):
        return r
    return realize(r, rt)


def pick_domain(inputs):
    """Operation domain: the non-single input of lowest priority (inputs: list of (priority, Res, mode))."""
    best, bp = Domain.identity(), 1 << 30
    for p, r, mode in inputs:
        if r is None or r.single or mode != 'domain':
            continue
        if p < bp:
            best, bp = r.domain, p
    return best


# ----------------------------------------------------------------------------------------------- hash (BLI noise)

def _rot(x, k):
    return ((x << np.uint32(k)) | (x >> np.uint32(32 - k))).astype(np.uint32)


def _final(a, b, c):
    c ^= b; c -= _rot(b, 14); a ^= c; a -= _rot(c, 11); b ^= a; b -= _rot(a, 25)
    c ^= b; c -= _rot(b, 16); a ^= c; a -= _rot(c, 4); b ^= a; b -= _rot(a, 14)
    c ^= b; c -= _rot(b, 24)
    return a, b, c


def hash_uint(*ks):
    """Jenkins lookup3 hash of 1..4 uint32 (BLI hash_uint / hash_uint2..4)."""
    n = len(ks)
    with np.errstate(over='ignore'):
        init = np.uint32((0xdeadbeef + (n << 2) + 13) & 0xFFFFFFFF)
        shape = np.broadcast(*ks).shape
        a = np.full(shape, init, np.uint32); b = a.copy(); c = a.copy()
        if n == 1:
            a += ks[0]; a, b, c = _final(a, b, c)
        elif n == 2:
            b += ks[1]; a += ks[0]; a, b, c = _final(a, b, c)
        elif n == 3:
            c += ks[2]; b += ks[1]; a += ks[0]; a, b, c = _final(a, b, c)
        else:
            a += ks[0]; b += ks[1]; c += ks[2]
            # lookup3 "mix" then add the fourth word and finalize
            a -= c; a ^= _rot(c, 4); c += b
            b -= a; b ^= _rot(a, 6); a += c
            c -= b; c ^= _rot(b, 8); b += a
            a -= c; a ^= _rot(c, 16); c += b
            b -= a; b ^= _rot(a, 19); a += c
            c -= b; c ^= _rot(b, 4); b += a
            a += ks[3]; a, b, c = _final(a, b, c)
    return c


def fbits(x):
    return np.ascontiguousarray(np.asarray(x, F)).view(np.uint32)


def hash_float_to_float(*fs):
    h = hash_uint(*[fbits(v) for v in fs])
    return (h.astype(F) / F(4294967295.0)).astype(F)


# ----------------------------------------------------------------------------------------------- graph

STYPE = {'RGBA': 'color', 'VALUE': 'float', 'INT': 'int', 'BOOLEAN': 'bool', 'MENU': 'menu', 'STRING': 'menu'}
ITYPE = {'NodeSocketColor': 'color', 'NodeSocketFloat': 'float', 'NodeSocketInt': 'int', 'NodeSocketBool': 'bool',
         'NodeSocketMenu': 'menu', 'NodeSocketVector': 'vector'}


def sock_type(s):
    t = s.get('type')
    if t == 'VECTOR':
        v = s.get('value')
        return 'float2' if isinstance(v, list) and len(v) == 2 else 'float3'
    return STYPE.get(t, t)


def iface_type(item):
    t = ITYPE.get(item.get('socket_type'), 'float')
    if t == 'vector':
        v = item.get('default_value')
        return 'float2' if isinstance(v, list) and len(v) == 2 else 'float3'
    return t


class Evaluator:
    def __init__(self, dump, image, frame=1.0, render_size=None, luts=None, curves=None):
        self.d = dump
        self.G = Graph(dump, 0, 0)
        self.G.fold = lambda nid, out: None          # no constant folding: every value in float32 here
        self.G.add_tree(dump['compositor'], '')
        self.trees = {}                              # group node id -> its tree dict (for interface types)
        self._index_groups(dump['compositor'], '')
        self.image = image                           # Res: the render (colour, bottom row first)
        self.frame = F(frame)
        self.render_size = render_size or image.domain.size
        self.memo = {}
        self.overrides = {}                          # (node id, output id) -> Res, e.g. a stage's output from Blender
        self.luts = luts or {}
        self.curves = curves or {}
        self.trace = None

    def _index_groups(self, tree, prefix):
        for n in tree['nodes']:
            if n['type'] in ('CompositorNodeGroup',) and n.get('group'):
                gid = prefix + n['name']
                self.trees[gid] = self.d['node_groups'][n['group']]
                self._index_groups(self.trees[gid], gid + '/')

    def iface(self, gid, ident, in_out):
        for it in self.trees[gid].get('interface', []):
            if it.get('identifier') == ident and it.get('in_out') == in_out:
                return iface_type(it)
        return None

    # where an input socket's value comes from: ('const', value, type) or ('ref', node id, output id, [types])
    def source(self, nid, in_id, conv=()):
        G = self.G
        key = (nid, in_id)
        if key not in G.links:
            s = G.input_socket(nid, in_id)
            return ('const', s.get('value'), sock_type(s), list(conv))
        src, out = G.links[key]
        if (src, out) in self.overrides:
            return ('override', src, out, list(conv))
        n = G.nodes[src]
        t = n['type']
        if t == 'NodeReroute':
            return self.source(src, n['inputs'][0]['id'], conv)
        if t == 'NodeGroupInput':
            outer = G.group_in_parent.get(src)
            if outer is None:
                raise KeyError('top-level group input')
            ty = self.iface(outer, out, 'INPUT')
            return self.source(outer, out, (ty,) + tuple(conv))
        if t == 'CompositorNodeGroup':
            go = G.group_out.get(src)
            ty = self.iface(src, out, 'OUTPUT')
            return self.source(go, out, (ty,) + tuple(conv))
        if n.get('mute'):
            raise NotImplementedError('muted node ' + src)
        return ('ref', src, out, list(conv))

    def input(self, nid, in_id):
        """The value at an input socket after the group-interface conversions on its way (not yet converted to the
        socket's own type, nor realized)."""
        s = self.source(nid, in_id)
        if s[0] == 'const':
            _, v, ty, conv = s
            r = Res.value(ty, v)
        elif s[0] == 'override':
            _, src, out, conv = s
            r = self.overrides[(src, out)]
        else:
            _, src, out, conv = s
            r = self.output(src, out)
        for ty in reversed(conv):         # innermost conversion last: the list runs from consumer to source
            if ty is not None:
                r = convert(r, ty)
        return r

    def output(self, nid, out_id):
        if nid not in self.memo:
            n = self.G.nodes[nid]
            fn = NODES.get(n['type'])
            if fn is None:
                raise NotImplementedError(n['type'] + ' (' + nid + ')')
            self.memo[nid] = fn(self, nid, n)
            if self.trace is not None:
                self.trace.append(nid)
        outs = self.memo[nid]
        if out_id not in outs:
            raise KeyError(f'{nid}: no output {out_id} (has {list(outs)})')
        return outs[out_id]

    # helpers for node implementations
    def ins(self, nid, n, names=None, conv=True):
        """Enabled inputs as {id: (index, socket, Res)}, converted to the socket type unless conv is False (pixel
        operations realize an input in its own type and convert it per pixel afterwards)."""
        out = {}
        for k, s in enumerate(n['inputs']):
            if not s.get('enabled', True):
                continue
            if names is not None and s['id'] not in names and s['name'] not in names:
                continue
            ty = sock_type(s)
            r = self.input(nid, s['id'])
            if conv and ty != 'menu' and r.type != 'menu':
                r = convert(r, ty)
            out[s['id']] = (k, s, r)
        return out

    def socket(self, path, out=None):
        """The value at a node output: path like 'Group.001/Group.002/Mix.001' (output: first one if None)."""
        n = self.G.nodes[path]
        out = out or n['outputs'][0]['id']
        if n['type'] == 'CompositorNodeGroup':
            go = self.G.group_out.get(path)
            r = self.input(go, out)
            ty = self.iface(path, out, 'OUTPUT')
            return convert(r, ty) if ty else r
        return self.output(path, out)

    def final(self):
        """The compositor's output: the Group Output's first input, realized on the render size."""
        go = next(n['name'] for n in self.d['compositor']['nodes'] if n['type'] == 'NodeGroupOutput')
        sock = self.G.nodes[go]['inputs'][0]
        r = convert(self.input(go, sock['id']), 'color')
        return self.to_render(r)

    def to_render(self, r):
        dom = Domain(self.render_size)
        if r.single:
            return Res('color', np.broadcast_to(r.data, (dom.size[1], dom.size[0], r.data.size)).astype(F).copy(), dom)
        return realize_onto(r, dom)


def menu(r):
    return r.data if r.type == 'menu' else r.data


# ----------------------------------------------------------------------------------------------- pixel nodes

PRIORITY = {('ShaderNodeMix', 'Factor_Float'): 2, ('ShaderNodeMix', 'Factor_Vector'): 2}


def mix_priority(sid):
    if sid.startswith('Factor'): return 2
    if sid.startswith('A'): return 0
    if sid.startswith('B'): return 1
    return None


def pixel_inputs(ev, nid, n):
    """Inputs of a pixel node converted and realized on its domain: (dict id -> Res, domain or None if single)."""
    ins = ev.ins(nid, n, conv=False)
    items = []
    for sid, (k, s, r) in ins.items():
        p = mix_priority(sid) if n['type'] == 'ShaderNodeMix' else k
        items.append((p if p is not None else k, r, 'domain'))

    def conv(s, r):
        ty = sock_type(s)
        return r if (ty == 'menu' or r.type == 'menu') else convert(r, ty)
    if all(r.single for _, (k, s, r) in ins.items() if r.type != 'menu'):
        return {sid: conv(s, r) for sid, (k, s, r) in ins.items()}, None
    dom = pick_domain(items).realize_transformation(False)
    out = {}
    for sid, (k, s, r) in ins.items():
        out[sid] = r if r.type == 'menu' else conv(s, realize_onto(r, dom))
    return out, dom


def px(a):
    """Data of a Res as float32 array, channel last."""
    return a.data


def mkres(type_, data, dom):
    if dom is None:
        return Res(type_, np.asarray(data, F).reshape(-1))
    return Res(type_, np.asarray(data, F), dom.copy())


def ch(r, c=0):
    return r.data[..., c]


def node_math(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    op = n['props']['operation']
    vals = [ch(I[s['id']]) for s in n['inputs'] if s.get('enabled', True)]
    a = vals[0].astype(F)
    b = vals[1].astype(F) if len(vals) > 1 else None
    c = vals[2].astype(F) if len(vals) > 2 else None
    with np.errstate(all='ignore'):
        if op == 'ADD': r = a + b
        elif op == 'SUBTRACT': r = a - b
        elif op == 'MULTIPLY': r = a * b
        elif op == 'DIVIDE': r = np.where(b != 0, a / np.where(b != 0, b, F(1)), F(0))
        elif op == 'MULTIPLY_ADD': r = (a * b).astype(F) + c
        elif op == 'POWER':
            bad = (a < 0) & (b != np.trunc(b))
            r = np.where(bad, F(0), np.power(a.astype(np.float64), b.astype(np.float64)).astype(F))
        elif op == 'LOGARITHM':
            la = np.log(np.where(a > 0, a, F(1)).astype(np.float64)).astype(F)
            lb = np.log(np.where(b > 0, b, F(1)).astype(np.float64)).astype(F)
            r = np.where((a <= 0) | (b <= 0), F(0), np.where(lb != 0, la / np.where(lb != 0, lb, F(1)), F(0)))
        elif op == 'SQRT': r = np.sqrt(np.maximum(a, F(0)).astype(np.float64)).astype(F)
        elif op == 'SINE': r = np.sin(a.astype(np.float64)).astype(F)
        elif op == 'COSINE': r = np.cos(a.astype(np.float64)).astype(F)
        elif op == 'MAXIMUM': r = np.maximum(a, b)
        elif op == 'MINIMUM': r = np.minimum(a, b)
        elif op == 'GREATER_THAN': r = (a > b).astype(F)
        elif op == 'LESS_THAN': r = (a < b).astype(F)
        elif op == 'FLOORED_MODULO':
            r = np.where(b != 0, a - (np.floor((a / np.where(b != 0, b, F(1))).astype(F)) * b).astype(F), F(0))
        elif op == 'ABSOLUTE': r = np.abs(a)
        elif op == 'EXPONENT': r = np.exp(a.astype(np.float64)).astype(F)
        elif op == 'FLOOR': r = np.floor(a)
        elif op == 'FRACT': r = a - np.floor(a)
        else: raise NotImplementedError('math ' + op)
    r = np.asarray(r, F)
    if n['props'].get('use_clamp'):
        r = np.clip(r, F(0), F(1))
    return {'Value': mkres('float', r[..., None] if dom is not None else r, dom)}


def node_mix(ev, nid, n):
    P = n['props']
    I, dom = pixel_inputs(ev, nid, n)
    dt = P.get('data_type', 'FLOAT')
    if P.get('factor_mode', 'UNIFORM') != 'UNIFORM':
        raise NotImplementedError('non-uniform mix factor')
    t = ch(I['Factor_Float']).astype(F)
    if P.get('clamp_factor', True):
        t = np.clip(t, F(0), F(1))
    if dt == 'FLOAT':
        a, b = ch(I['A_Float']), ch(I['B_Float'])
        r = (a * (F(1) - t)).astype(F) + (b * t).astype(F)
        return {'Result_Float': mkres('float', np.asarray(r, F)[..., None] if dom is not None else r, dom)}
    if dt == 'RGBA':
        A, B = I['A_Color'].data.astype(F), I['B_Color'].data.astype(F)
        tt = t[..., None] if dom is not None else t
        facm = (F(1) - tt).astype(F)
        bt = P.get('blend_type', 'MIX')
        r = A.copy()
        if bt == 'MIX':
            r = (facm * A).astype(F) + (tt * B).astype(F)
        elif bt == 'ADD':
            r[..., :3] = A[..., :3] + (tt * B[..., :3]).astype(F)
        elif bt == 'OVERLAY':
            a3, b3 = A[..., :3], B[..., :3]
            lo = a3 * (facm + ((F(2) * tt).astype(F) * b3).astype(F)).astype(F)
            hi = F(1) - ((facm + ((F(2) * tt).astype(F) * (F(1) - b3)).astype(F)).astype(F) * (F(1) - a3)).astype(F)
            r[..., :3] = np.where(a3 < F(0.5), lo, hi)
        else:
            raise NotImplementedError('mix blend ' + bt)
        r = np.asarray(r, F)
        if P.get('clamp_result'):
            r[..., :3] = np.clip(r[..., :3], 0, 1)
        return {'Result_Color': mkres('color', r, dom)}
    raise NotImplementedError('mix data type ' + dt)


def node_map_range(ev, nid, n):
    P = n['props']
    if P.get('data_type', 'FLOAT') != 'FLOAT':
        raise NotImplementedError('vector map range')
    I, dom = pixel_inputs(ev, nid, n)
    g = {s['name']: s['id'] for s in n['inputs'] if s.get('enabled', True)}
    v, fmin, fmax, tmin, tmax = (ch(I[g[k]]).astype(F) for k in ('Value', 'From Min', 'From Max', 'To Min', 'To Max'))
    den = (fmax - fmin).astype(F)
    with np.errstate(all='ignore'):
        fac = np.where(den != 0, ((v - fmin).astype(F) / np.where(den != 0, den, F(1))).astype(F), F(0)).astype(F)
    it = P.get('interpolation_type', 'LINEAR')
    if it == 'LINEAR':
        r = (tmin + (fac * (tmax - tmin).astype(F)).astype(F)).astype(F)
        if P.get('clamp', True):
            r = np.where(tmin > tmax, np.clip(r, tmax, tmin), np.clip(r, tmin, tmax))
    elif it == 'SMOOTHSTEP':
        fac = np.clip(fac, F(0), F(1))
        fac = ((F(3) - (F(2) * fac).astype(F)).astype(F) * (fac * fac).astype(F)).astype(F)
        r = (tmin + (fac * (tmax - tmin).astype(F)).astype(F)).astype(F)
    else:
        raise NotImplementedError('map range ' + it)
    r = np.asarray(r, F)
    return {'Result': mkres('float', r[..., None] if dom is not None else r, dom)}


def node_clamp(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    g = {s['name']: s['id'] for s in n['inputs']}
    v, lo, hi = ch(I[g['Value']]), ch(I[g['Min']]), ch(I[g['Max']])
    if n['props'].get('clamp_type', 'MINMAX') == 'RANGE':
        r = np.where(lo > hi, np.clip(v, hi, lo), np.clip(v, lo, hi))
    else:
        r = np.minimum(np.maximum(v, lo), hi)
    r = np.asarray(r, F)
    return {'Result': mkres('float', r[..., None] if dom is not None else r, dom)}


def node_gamma(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    c = I['Color'].data.astype(F); g = ch(I['Gamma']).astype(F)
    gg = g[..., None] if dom is not None else g
    rgb = c[..., :3]
    with np.errstate(all='ignore'):
        p = np.power(rgb.astype(np.float64), np.broadcast_to(gg, rgb.shape).astype(np.float64)).astype(F)
    bad = (rgb < 0) & (np.broadcast_to(gg, rgb.shape) != np.trunc(np.broadcast_to(gg, rgb.shape)))
    out = c.copy(); out[..., :3] = np.where(bad, F(0), p)
    return {'Color': mkres('color', out, dom)}


def node_separate_color(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    c = I['Image'].data.astype(F)
    mode = n['props'].get('mode', 'RGB')
    if mode == 'RGB':
        o = [c[..., 0], c[..., 1], c[..., 2], c[..., 3]]
    elif mode == 'HSV':
        hsv = rgb_to_hsv(c[..., :3]); o = [hsv[..., 0], hsv[..., 1], hsv[..., 2], c[..., 3]]
    else:
        raise NotImplementedError('separate ' + mode)
    names = ['Red', 'Green', 'Blue', 'Alpha']
    return {k: mkres('float', np.asarray(v, F)[..., None] if dom is not None else v, dom) for k, v in zip(names, o)}


def node_combine_color(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    r, g, b, a = (ch(I[k]).astype(F) for k in ('Red', 'Green', 'Blue', 'Alpha'))
    mode = n['props'].get('mode', 'RGB')
    if mode == 'RGB':
        out = np.stack(np.broadcast_arrays(r, g, b, a), -1)
    elif mode == 'HSV':
        rgb = hsv_to_rgb(np.stack(np.broadcast_arrays(r, g, b), -1))
        out = np.concatenate([rgb, np.broadcast_to(a, r.shape)[..., None]], -1)
    else:
        raise NotImplementedError('combine ' + mode)
    return {'Image': mkres('color', out.astype(F), dom)}


def rgb_to_hsv(c):
    """BLI rgb_to_hsv, float32, vectorized."""
    r, g, b = (c[..., i].astype(F) for i in range(3))
    k = np.zeros(r.shape, F)
    sw = g < b
    g2 = np.where(sw, b, g); b2 = np.where(sw, g, b); k = np.where(sw, F(-1), k)
    min_gb = b2
    sw2 = r < g2
    r3 = np.where(sw2, g2, r); g3 = np.where(sw2, r, g2)
    k = np.where(sw2, (F(-2.0 / 6.0) - k).astype(F), k)
    min_gb = np.where(sw2, np.minimum(g3, b2), min_gb)
    chroma = (r3 - min_gb).astype(F)
    with np.errstate(all='ignore'):
        h = np.abs((k + ((g3 - b2).astype(F) / ((F(6) * chroma).astype(F) + F(1e-20)).astype(F)).astype(F)).astype(F))
        s = (chroma / (r3 + F(1e-20)).astype(F)).astype(F)
    return np.stack([h, s, r3], -1).astype(F)


def hsv_to_rgb(hsv):
    h, s, v = (hsv[..., i].astype(F) for i in range(3))
    h6 = (h * F(6)).astype(F)
    nr = (np.abs((h6 - F(3)).astype(F)) - F(1)).astype(F)
    ng = (F(2) - np.abs((h6 - F(2)).astype(F))).astype(F)
    nb = (F(2) - np.abs((h6 - F(4)).astype(F))).astype(F)
    nr, nb, ng = np.clip(nr, 0, 1), np.clip(nb, 0, 1), np.clip(ng, 0, 1)
    out = [((((x - F(1)).astype(F) * s).astype(F) + F(1)).astype(F) * v).astype(F) for x in (nr, ng, nb)]
    return np.stack(out, -1).astype(F)


def node_combine_xyz(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    x, y, z = (ch(I[k]).astype(F) for k in ('X', 'Y', 'Z'))
    return {'Vector': mkres('float3', np.stack(np.broadcast_arrays(x, y, z), -1), dom)}


def node_separate_xyz(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    v = convert(I['Vector'], 'float3').data
    return {k: mkres('float', v[..., i:i + 1] if dom is not None else v[..., i], dom) for i, k in enumerate('XYZ')}


def node_vector_math(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    op = n['props']['operation']
    vs = [I[s['id']] for s in n['inputs'] if s.get('enabled', True)]
    a = convert(vs[0], 'float3').data.astype(F)
    if op == 'SCALE':
        s = ch(I['Scale']).astype(F)
        r = (a * (s[..., None] if dom is not None else s)).astype(F)
        return {'Vector': mkres('float3', r, dom), 'Value': mkres('float', np.zeros(r.shape[:-1] + (1,), F) if dom is not None else F(0), dom)}
    if op == 'LENGTH':
        d = ((a[..., 0] * a[..., 0]).astype(F) + (a[..., 1] * a[..., 1]).astype(F)).astype(F)
        d = (d + (a[..., 2] * a[..., 2]).astype(F)).astype(F)
        l = np.sqrt(d.astype(np.float64)).astype(F)
        return {'Value': mkres('float', l[..., None] if dom is not None else l, dom), 'Vector': mkres('float3', np.zeros_like(a), dom)}
    b = convert(vs[1], 'float3').data.astype(F)
    if op == 'ADD': r = a + b
    elif op == 'SUBTRACT': r = a - b
    elif op == 'MULTIPLY': r = a * b
    else: raise NotImplementedError('vector math ' + op)
    return {'Vector': mkres('float3', r.astype(F), dom), 'Value': mkres('float', np.zeros(r.shape[:-1] + (1,), F) if dom is not None else F(0), dom)}


def node_white_noise(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    dims = n['props'].get('noise_dimensions', '3D')
    if dims == '1D':
        w = ch(I['W']).astype(F)
        val = hash_float_to_float(w)
        col = np.stack([val, hash_float_to_float(w, F(1)), hash_float_to_float(w, F(2))], -1)
    elif dims == '2D':
        v = convert(I['Vector'], 'float3').data.astype(F)
        x, y = v[..., 0], v[..., 1]
        val = hash_float_to_float(x, y)
        col = np.stack([val, hash_float_to_float(x, y, F(1)), hash_float_to_float(x, y, F(2))], -1)
    else:
        raise NotImplementedError('white noise ' + dims)
    col = np.concatenate([col, np.ones(col.shape[:-1] + (1,), F)], -1)
    return {'Value': mkres('float', val[..., None] if dom is not None else val, dom), 'Color': mkres('color', col, dom)}


# ----------------------------------------------------------------------------------------------- other nodes

def node_image(ev, nid, n):
    r = ev.image
    return {'Image': r, 'Alpha': Res('float', r.data[..., 3:4].copy(), r.domain.copy())}


def node_scene_time(ev, nid, n):
    fps = F(ev.d['scene'].get('fps', 24)) / F(ev.d['scene'].get('fps_base', 1.0))
    return {'Frame': Res.value('float', ev.frame), 'Seconds': Res.value('float', F(ev.frame / fps))}


def node_image_coordinates(ev, nid, n):
    r = ev.input(nid, 'Image')
    if r.single:
        return {k: Res.value('float2', [0, 0]) for k in ('Uniform', 'Normalized')} | {'Pixel': Res.value('int2', [0, 0])}
    dm = r.domain
    W, H = dm.size
    xs = (F(1) * (np.arange(W, dtype=F) + F(dm.offset[0])) + F(0.5)).astype(F)
    ys = (F(1) * (np.arange(H, dtype=F) + F(dm.offset[1])) + F(0.5)).astype(F)
    X, Y = np.meshgrid(xs, ys)
    m = F(max(dm.display))
    ux = (((X - F(dm.display[0]) / F(2)).astype(F) / m).astype(F) * F(2)).astype(F)
    uy = (((Y - F(dm.display[1]) / F(2)).astype(F) / m).astype(F) * F(2)).astype(F)
    nx = (X / F(dm.display[0])).astype(F); ny = (Y / F(dm.display[1])).astype(F)
    d = Domain(dm.size, dm.T, dm.display, dm.offset)
    return {'Uniform': Res('float2', np.stack([ux, uy], -1), d.copy()),
            'Normalized': Res('float2', np.stack([nx, ny], -1), d.copy()),
            'Pixel': Res('int2', np.stack(np.meshgrid(np.arange(W) + dm.offset[0], np.arange(H) + dm.offset[1]), -1).astype(np.int32), d.copy())}


def node_relative_to_pixel(ev, nid, n):
    P = n['props']
    img = ev.input(nid, 'Image')
    if img.single:
        size = (F(1), F(1))
    else:
        dd = img.domain.realize_transformation(False).display
        size = (F(dd[0]), F(dd[1]))
    ref = P.get('reference_dimension', 'X')
    refv = {'X': size[0], 'Y': size[1], 'Greater': max(size), 'Smaller': min(size),
            'Diagonal': F(math.sqrt(float(F(size[0] * size[0]) + F(size[1] * size[1]))))}
    if P.get('data_type', 'FLOAT') == 'FLOAT':
        v = convert(ev.input(nid, 'Float Value'), 'float')
        if ref in ('Per Dimension', 'PER_DIMENSION'):
            raise NotImplementedError('per-dimension float')
        k = refv[ref.title() if ref.upper() == ref else ref]
        return {'Float Value': Res('float', (v.data * k).astype(F), v.domain.copy() if v.domain else None)}
    raise NotImplementedError('relative to pixel vector')


def node_switch(ev, nid, n):
    g = {s['name']: s['id'] for s in n['inputs']}
    sw = convert(ev.input(nid, g['Switch']), 'bool')
    if not sw.single:
        raise NotImplementedError('per-pixel switch')
    pick = g['True'] if bool(sw.data[0]) else g['False']
    s = next(x for x in n['inputs'] if x['id'] == pick)
    return {'Output': convert(ev.input(nid, pick), sock_type(s)).share()}


def node_menu_switch(ev, nid, n):
    m = ev.input(nid, n['inputs'][0]['id'])
    if m.type != 'menu':
        raise NotImplementedError('menu switch on a non-menu value')
    names = [e['name'] for e in (n.get('enum_items') or [])]
    items = n['inputs'][1:]
    idx = names.index(m.data) if m.data in names else next((k for k, s in enumerate(items) if s['name'] == m.data), None)
    outs = {}
    for o in n['outputs']:
        if o['id'] == 'Output' or o['name'] == 'Output':
            if idx is None:
                outs[o['id']] = Res.value(sock_type(o), o.get('value', 0))
            else:
                s = items[idx]
                outs[o['id']] = convert(ev.input(nid, s['id']), sock_type(o)).share()
        else:
            outs[o['id']] = Res.value('bool', [1.0 if o['name'] == m.data else 0.0])
    return outs


def node_index_switch(ev, nid, n):
    i = convert(ev.input(nid, n['inputs'][0]['id']), 'int')
    if not i.single:
        raise NotImplementedError('per-pixel index switch')
    items = n['inputs'][1:]
    k = int(i.data[0])
    o = n['outputs'][0]
    if not (0 <= k < len(items)):
        return {o['id']: Res.value(sock_type(o), 0)}
    return {o['id']: convert(ev.input(nid, items[k]['id']), sock_type(o)).share()}


EXTM = {'Clip': 'clip', 'Extend': 'extend', 'Repeat': 'repeat'}
INTM = {'Nearest': 'nearest', 'Bilinear': 'bilinear', 'Bicubic': 'bicubic', 'Anisotropic': 'anisotropic'}


def menu_value(ev, nid, name):
    r = ev.input(nid, name)
    return r.data if r.type == 'menu' else r.data


def node_scale(ev, nid, n):
    typ = menu_value(ev, nid, 'Type')
    img = convert(ev.input(nid, 'Image'), 'color')
    x = convert(ev.input(nid, 'X'), 'float'); y = convert(ev.input(nid, 'Y'), 'float')
    ro = (INTM[menu_value(ev, nid, 'Interpolation')], EXTM[menu_value(ev, nid, 'Extension X')], EXTM[menu_value(ev, nid, 'Extension Y')])
    if typ != 'Relative':
        raise NotImplementedError('scale type ' + str(typ))
    if not (x.single and y.single):
        raise NotImplementedError('variable scale')
    if img.single:
        return {'Image': img}
    out = img.share()
    out.domain = img.domain.transformed(from_scale((x.data[0], y.data[0])))
    out.ro = ro
    return {'Image': out}


def node_displace(ev, nid, n):
    img = convert(ev.input(nid, 'Image'), 'color')
    disp = convert(ev.input(nid, 'Displacement'), 'float2')
    ro = (INTM[menu_value(ev, nid, 'Interpolation')], EXTM[menu_value(ev, nid, 'Extension X')], EXTM[menu_value(ev, nid, 'Extension Y')])
    if img.single:
        return {'Image': img}
    if disp.single:
        out = img.share(); out.domain = img.domain.transformed(from_location(disp.data)); out.ro = ro
        return {'Image': out}
    dom = pick_domain([(0, img, 'domain'), (1, disp, 'domain')]).realize_transformation(False)
    img = realize_onto(img, dom); disp = realize_onto(disp, dom)
    W, H = dom.size
    X, Y = np.meshgrid(np.arange(W, dtype=F), np.arange(H, dtype=F))
    cx = (((X + F(0.5)) / F(W)).astype(F) - (disp.data[..., 0] / F(W)).astype(F)).astype(F)
    cy = (((Y + F(0.5)) / F(H)).astype(F) - (disp.data[..., 1] / F(H)).astype(F)).astype(F)
    S = img.domain.size
    data = sample(img.data, (cx * F(S[0])).astype(F), (cy * F(S[1])).astype(F), *ro)
    return {'Image': Res('color', data, dom.copy())}


def node_set_alpha(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    c = I['Image'].data.astype(F).copy(); a = ch(I['Alpha']).astype(F)
    typ = menu_value(ev, nid, 'Type')
    if typ in ('Replace Alpha', 'REPLACE_ALPHA'):
        c[..., 3] = a
    else:
        c = (c * (a[..., None] if dom is not None else a)).astype(F)
    return {'Image': mkres('color', c, dom)}


NODES = {
    'CompositorNodeRLayers': node_image, 'CompositorNodeImage': node_image,
    'ShaderNodeMath': node_math, 'ShaderNodeMix': node_mix, 'ShaderNodeMapRange': node_map_range,
    'ShaderNodeClamp': node_clamp, 'ShaderNodeGamma': node_gamma,
    'CompositorNodeSeparateColor': node_separate_color, 'CompositorNodeCombineColor': node_combine_color,
    'ShaderNodeCombineXYZ': node_combine_xyz, 'ShaderNodeSeparateXYZ': node_separate_xyz,
    'ShaderNodeVectorMath': node_vector_math, 'ShaderNodeTexWhiteNoise': node_white_noise,
    'CompositorNodeSceneTime': node_scene_time, 'CompositorNodeImageCoordinates': node_image_coordinates,
    'CompositorNodeRelativeToPixel': node_relative_to_pixel, 'GeometryNodeSwitch': node_switch,
    'GeometryNodeMenuSwitch': node_menu_switch, 'GeometryNodeIndexSwitch': node_index_switch,
    'CompositorNodeScale': node_scale, 'CompositorNodeDisplace': node_displace, 'CompositorNodeSetAlpha': node_set_alpha,
}


def load_f32(path, W, H):
    """Our raw float32 RGBA files (top row first) -> Res with row 0 at the bottom."""
    a = np.fromfile(path, '<f4').reshape(H, W, 4)[::-1].copy()
    return Res('color', a, Domain((W, H)))
