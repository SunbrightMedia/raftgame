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


DEFAULT_RO = ('bilinear', 'clip', 'clip')


class Domain:
    """A result's domain. As in Blender 5.3, the realization options (interpolation, extension x/y) live in the
    domain, so every operation whose output takes an input's domain also takes its realization options."""
    __slots__ = ('size', 'display', 'offset', 'T', 'ro')

    def __init__(self, size, T=None, display=None, offset=(0, 0), ro=DEFAULT_RO):
        self.size = (int(size[0]), int(size[1]))
        self.display = self.size if display is None else (int(display[0]), int(display[1]))
        self.offset = (int(offset[0]), int(offset[1]))
        self.T = np.eye(3, dtype=F) if T is None else np.array(T, F)
        self.ro = ro

    @staticmethod
    def identity():
        return Domain((1, 1))

    def copy(self):
        return Domain(self.size, self.T.copy(), self.display, self.offset, self.ro)

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
    __slots__ = ('type', 'data', 'domain')

    def __init__(self, type_, data, domain=None, ro=None):
        self.type = type_
        self.data = data
        self.domain = domain
        if ro is not None and domain is not None:
            domain.ro = ro

    @property
    def ro(self):
        return self.domain.ro if self.domain is not None else DEFAULT_RO

    @ro.setter
    def ro(self, v):
        if self.domain is not None:
            self.domain.ro = v

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
        return Res(self.type, self.data, self.domain.copy() if self.domain else None)

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
        return Res(to, d.astype(F), r.domain.copy() if r.domain else None)
    if fr in ('float', 'int', 'bool'):
        x = a[..., 0].astype(F)
        if to == 'float': return out(x[..., None])
        if to == 'float2': return out(np.stack([x, x], -1))
        if to == 'float3': return out(np.stack([x, x, x], -1))
        if to == 'float4': return out(np.stack([x, x, x, x], -1))
        if to == 'color': return out(np.stack([x, x, x, np.ones(shp, F)], -1))
        if to == 'int': return Res('int', np.trunc(x)[..., None].astype(np.int32), r.domain.copy() if r.domain else None)
        if to == 'bool': return Res('bool', (x > 0)[..., None], r.domain.copy() if r.domain else None)
    if fr == 'int2':
        x = a.astype(F)
        if to == 'float': return out(((x[..., 0] + x[..., 1]) / F(2))[..., None])
        if to == 'float2': return out(x)
        if to == 'float3': return out(np.concatenate([x, np.zeros(shp + (1,), F)], -1))
        if to == 'color': return out(np.concatenate([x, np.zeros(shp + (1,), F), np.ones(shp + (1,), F)], -1))
        if to == 'int': return Res('int', ((a[..., 0].astype(np.int64) + a[..., 1]) // 2)[..., None].astype(np.int32), r.domain.copy() if r.domain else None)
        if to == 'bool': return Res('bool', np.any(a != 0, -1)[..., None], r.domain.copy() if r.domain else None)
    if fr == 'int' and to == 'int2':
        return Res('int2', np.concatenate([a, a], -1).astype(np.int32), r.domain.copy() if r.domain else None)
    if fr == 'float2':
        if to == 'float': return out(((a[..., 0] + a[..., 1]) / F(2))[..., None])
        if to == 'float3': return out(np.concatenate([a, np.zeros(shp + (1,), F)], -1))
        if to == 'color': return out(np.concatenate([a, np.zeros(shp + (1,), F), np.ones(shp + (1,), F)], -1))
    if fr == 'float3':
        if to == 'float': return out((((a[..., 0] + a[..., 1]) + a[..., 2]) / F(3))[..., None])
        if to == 'float2': return out(a[..., :2])
        if to == 'color': return out(np.concatenate([a, np.ones(shp + (1,), F)], -1))
        if to == 'bool': return Res('bool', np.any(a != 0, -1)[..., None], r.domain.copy() if r.domain else None)
    if fr in ('color', 'float4'):
        if to == 'float': return out(luminance(a)[..., None]) if fr == 'color' else out(((a[..., 0] + a[..., 1] + a[..., 2] + a[..., 3]) / F(4))[..., None])
        if to == 'float3': return out(a[..., :3])
        if to == 'float2': return out(a[..., :2])
        if to in ('color', 'float4'): return out(a)
        if to == 'bool': return Res('bool', (luminance(a) > 0)[..., None], r.domain.copy() if r.domain else None)
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
    return Res(r.type, data, target.copy())


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

    def tree_name(self, nid):
        g = nid.rsplit('/', 1)[0] if '/' in nid else None
        if g is None:
            return 'Compositor Nodes'
        tr = self.trees[g]
        return next(k for k, v in self.d['node_groups'].items() if v is tr)

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
        elif op == 'CEIL': r = np.ceil(a)
        elif op == 'ROUND': r = np.floor((a + F(0.5)).astype(F))
        elif op == 'TRUNC': r = np.where(a >= 0, np.floor(a), np.ceil(a))
        elif op in ('FRACT', 'FRACTION'): r = a - np.floor(a)
        elif op == 'MODULO': r = np.where(b != 0, np.fmod(a, np.where(b != 0, b, F(1))), F(0))
        elif op == 'WRAP':
            rng = (b - c).astype(F)
            r = np.where(rng != 0, (a - (rng * np.floor(((a - c).astype(F) / np.where(rng != 0, rng, F(1))).astype(F))).astype(F)).astype(F), c)
        elif op == 'SNAP': r = (np.floor(np.where(b != 0, (a / np.where(b != 0, b, F(1))).astype(F), F(0))) * b).astype(F)
        elif op == 'PINGPONG':
            q = ((a - b).astype(F) / np.where(b != 0, (b * F(2)).astype(F), F(1))).astype(F)
            r = np.where(b != 0, np.abs((((q - np.floor(q)).astype(F) * b).astype(F) * F(2)).astype(F) - b), F(0))
        elif op == 'COMPARE': r = (np.abs((a - b).astype(F)) <= np.maximum(c, np.finfo(F).eps)).astype(F)
        elif op in ('SMOOTH_MIN', 'SMOOTH_MAX'):
            sg = F(-1) if op == 'SMOOTH_MAX' else F(1)
            aa, bb = (a * sg).astype(F), (b * sg).astype(F)
            h = (np.maximum((c - np.abs((aa - bb).astype(F))).astype(F), F(0)) / np.where(c != 0, c, F(1))).astype(F)
            sm = np.where(c != 0, (np.minimum(aa, bb) - ((((h * h).astype(F) * h).astype(F) * c).astype(F) * F(1.0 / 6.0)).astype(F)).astype(F), np.minimum(aa, bb))
            r = (sm * sg).astype(F)
        elif op == 'SIGN': r = np.sign(a).astype(F)
        elif op == 'INVERSE_SQRT': r = np.where(a > 0, (F(1) / np.sqrt(np.where(a > 0, a, F(1)).astype(np.float64)).astype(F)).astype(F), F(0))
        elif op == 'TANGENT': r = np.tan(a.astype(np.float64)).astype(F)
        elif op == 'ARCSINE': r = np.arcsin(np.clip(a, -1, 1).astype(np.float64)).astype(F)
        elif op == 'ARCCOSINE': r = np.arccos(np.clip(a, -1, 1).astype(np.float64)).astype(F)
        elif op == 'ARCTANGENT': r = np.arctan(a.astype(np.float64)).astype(F)
        elif op == 'ARCTAN2': r = np.arctan2(a.astype(np.float64), b.astype(np.float64)).astype(F)
        elif op == 'SINH': r = np.sinh(a.astype(np.float64)).astype(F)
        elif op == 'COSH': r = np.cosh(a.astype(np.float64)).astype(F)
        elif op == 'TANH': r = np.tanh(a.astype(np.float64)).astype(F)
        elif op == 'RADIANS': r = (a * F(math.pi / 180.0)).astype(F)
        elif op == 'DEGREES': r = (a * F(180.0 / math.pi)).astype(F)
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
        elif bt == 'SUBTRACT':
            r[..., :3] = A[..., :3] - (tt * B[..., :3]).astype(F)
        elif bt == 'MULTIPLY':
            r[..., :3] = A[..., :3] * (facm + (tt * B[..., :3]).astype(F)).astype(F)
        elif bt == 'SCREEN':
            r[..., :3] = F(1) - ((facm + (tt * (F(1) - B[..., :3])).astype(F)).astype(F) * (F(1) - A[..., :3])).astype(F)
        elif bt == 'DIFFERENCE':
            r[..., :3] = ((facm * A[..., :3]).astype(F) + (tt * np.abs((A[..., :3] - B[..., :3]).astype(F))).astype(F))
        elif bt == 'DARKEN':
            r[..., :3] = ((facm * A[..., :3]).astype(F) + (tt * np.minimum(A[..., :3], B[..., :3])).astype(F))
        elif bt == 'LIGHTEN':
            r[..., :3] = ((facm * A[..., :3]).astype(F) + (tt * np.maximum(A[..., :3], B[..., :3])).astype(F))
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


def node_image_info(ev, nid, n):
    r = ev.input(nid, 'Image')
    if r.single:
        z2 = Res('int2', np.zeros(2, np.int32))
        return {'Dimensions': z2, 'Resolution': z2, 'Location': Res.value('float2', [0, 0]),
                'Rotation': Res.value('float', 0), 'Scale': Res.value('float2', [0, 0])}
    dm = r.domain
    T = dm.T
    sx = F(math.sqrt(float(F(F(T[0, 0] * T[0, 0]) + F(T[1, 0] * T[1, 0])))))
    sy = F(math.sqrt(float(F(F(T[0, 1] * T[0, 1]) + F(T[1, 1] * T[1, 1])))))
    rot = F(math.atan2(float(T[1, 0]), float(T[0, 0])))
    return {'Dimensions': Res('int2', np.array(dm.realize_transformation().size, np.int32)),
            'Resolution': Res('int2', np.array(dm.size, np.int32)),
            'Location': Res.value('float2', [T[0, 2], T[1, 2]]), 'Rotation': Res.value('float', rot),
            'Scale': Res.value('float2', [sx, sy])}


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
    'CompositorNodeImageInfo': node_image_info, 'GeometryNodeMenuSwitch': node_menu_switch, 'GeometryNodeIndexSwitch': node_index_switch,
    'CompositorNodeScale': node_scale, 'CompositorNodeDisplace': node_displace, 'CompositorNodeSetAlpha': node_set_alpha,
}


def load_f32(path, W, H):
    """Our raw float32 RGBA files (top row first) -> Res with row 0 at the bottom."""
    a = np.fromfile(path, '<f4').reshape(H, W, 4)[::-1].copy()
    return Res('color', a, Domain((W, H)))


# ----------------------------------------------------------------------------------------------- curves

class CurveTable:
    """One curve of a curve mapping, evaluated like BKE_curvemap_evaluateF from its 257-entry table
    (tables from tools/blender/bl_curve_tables.py)."""

    def __init__(self, c, y=None, s_in=None, s_out=None):
        self.mn = F(c['mintable']); self.rng = F(c['range'])
        self.x0, self.x1 = F(c['x'][0]), F(c['x'][256])
        self.y = np.array(c['y'] if y is None else y, F)
        self.s_in = F(c['slope_in'] if s_in is None else s_in)
        self.s_out = F(c['slope_out'] if s_out is None else s_out)

    def eval(self, v):
        v = np.asarray(v, F)
        fi = ((v - self.mn) * self.rng).astype(F)
        out = np.empty(v.shape, F)
        ext = (fi < 0) | (fi > F(256))
        ins = ~ext
        i = np.clip(fi[ins].astype(np.int64), 0, 256)
        fr = (fi[ins] - i.astype(F)).astype(F)
        y0 = self.y[i]; y1 = self.y[np.minimum(i + 1, 256)]
        r = ((F(1) - fr) * y0 + fr * y1).astype(F)
        r = np.where(i >= 256, self.y[256], r)
        out[ins] = r
        ve = v[ext]
        lo = ve <= self.x0
        e = np.where(lo, self.y[0] + (self.s_in * (ve - self.x0).astype(F)).astype(F),
                     np.where(ve >= self.x1, self.y[256] + (self.s_out * (ve - self.x1).astype(F)).astype(F), F(0)))
        out[ext] = e.astype(F)
        return out


def curve_mapping(ev, nid):
    key = ev.tree_name(nid) + '/' + nid.split('/')[-1]
    if key not in ev.curves:
        raise KeyError('no curve table for ' + key + ' (run bl_curve_tables.py)')
    return ev.curves[key]


def node_float_curve(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    cm = curve_mapping(ev, nid)
    v = ch(I['Value']).astype(F); fac = ch(I['Factor']).astype(F)
    r = CurveTable(cm['curves'][0]).eval(v)
    if cm['use_clip']:
        r = np.clip(r, F(cm['clip'][1]), F(cm['clip'][3]))
    r = np.where(fac != F(1), ((F(1) - fac) * v).astype(F) + (fac * r).astype(F), r).astype(F)
    return {'Value': mkres('float', r[..., None] if dom is not None else r, dom)}


def node_hue_correct(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    cm = curve_mapping(ev, nid)
    c = I['Image'].data.astype(F); fac = ch(I['Fac']).astype(F)
    hsv = rgb_to_hsv(c[..., :3])
    p = hsv[..., 0]
    tabs = [CurveTable(cm['curves'][k]) for k in range(3)]

    def ev_clip(k):
        r = tabs[k].eval(p)
        return np.clip(r, F(cm['clip'][1]), F(cm['clip'][3])) if cm['use_clip'] else r
    h = (hsv[..., 0] + (ev_clip(0) - F(0.5)).astype(F)).astype(F)
    s = (hsv[..., 1] * (ev_clip(1) * F(2)).astype(F)).astype(F)
    v = (hsv[..., 2] * (ev_clip(2) * F(2)).astype(F)).astype(F)
    h = (h - np.floor(h)).astype(F)
    s = np.clip(s, F(0), F(1))
    rgb = np.maximum(hsv_to_rgb(np.stack([h, s, v], -1)), F(0))
    res = np.concatenate([rgb, c[..., 3:4]], -1).astype(F)
    ff = fac[..., None] if dom is not None else fac
    out = ((c * (F(1) - ff)).astype(F) + (res * ff).astype(F)).astype(F)
    return {'Image': mkres('color', out, dom)}


def node_curve_rgb(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    cm = curve_mapping(ev, nid)
    c = I['Image'].data.astype(F); fac = np.clip(ch(I['Fac']).astype(F), F(0), F(1))
    black = I['Black Level'].data.astype(F); white = I['White Level'].data.astype(F)
    C = CurveTable(cm['curves'][3])
    out = c.copy()
    for k in range(3):
        base = cm['curves'][k]
        prem = C.eval(np.array(base['y'], F))
        t = CurveTable(base, y=prem, s_in=F(base['slope_in']) * C.s_in, s_out=F(base['slope_out']) * C.s_out)
        bk = black[..., k]; wk = white[..., k]
        bw = (F(1) / np.maximum((wk - bk).astype(F), F(1e-5))).astype(F)
        x = ((c[..., k] - bk).astype(F) * bw).astype(F)
        r = t.eval(x)
        out[..., k] = ((c[..., k] * (F(1) - fac)).astype(F) + (r * fac).astype(F)).astype(F)
    return {'Image': mkres('color', out, dom)}


# ----------------------------------------------------------------------------------------------- textures

def node_vector_rotate(ev, nid, n):
    P = n['props']
    I, dom = pixel_inputs(ev, nid, n)
    if P.get('rotation_type') != 'Z_AXIS':
        raise NotImplementedError('vector rotate ' + str(P.get('rotation_type')))
    v = convert(I['Vector'], 'float3').data.astype(F)
    cen = convert(I['Center'], 'float3').data.astype(F)
    ang = ch(I['Angle']).astype(F)
    if P.get('invert'):
        ang = -ang
    sn = np.sin(ang.astype(np.float64)).astype(F); cs = np.cos(ang.astype(np.float64)).astype(F)
    ico = (F(1) - cs).astype(F)
    m22 = (ico + cs).astype(F)
    t = (v - cen).astype(F)
    if dom is not None:
        sn, cs, m22 = sn[..., None] if np.ndim(sn) else sn, cs[..., None] if np.ndim(cs) else cs, m22
    tx, ty, tz = t[..., 0], t[..., 1], t[..., 2]
    s_ = np.squeeze(sn); c_ = np.squeeze(cs)
    rx = (((c_ * tx).astype(F) + (-s_ * ty).astype(F)).astype(F) + (F(0) * tz).astype(F)).astype(F)
    ry = (((s_ * tx).astype(F) + (c_ * ty).astype(F)).astype(F) + (F(0) * tz).astype(F)).astype(F)
    rz = (((F(0) * tx).astype(F) + (F(0) * ty).astype(F)).astype(F) + (np.squeeze(m22) * tz).astype(F)).astype(F)
    r = (np.stack([rx, ry, rz], -1) + cen).astype(F)
    return {'Vector': mkres('float3', r, dom)}


def pcg2d(x, y):
    with np.errstate(over='ignore'):
        x = (x.astype(np.int32) * np.int32(1664525) + np.int32(1013904223)).astype(np.int32)
        y = (y.astype(np.int32) * np.int32(1664525) + np.int32(1013904223)).astype(np.int32)
        x = (x + y * np.int32(1664525)).astype(np.int32)
        y = (y + x * np.int32(1664525)).astype(np.int32)
        x = x ^ (x >> 16); y = y ^ (y >> 16)
        x = (x + y * np.int32(1664525)).astype(np.int32)
        y = (y + x * np.int32(1664525)).astype(np.int32)
    return x, y


def pcg3d(x, y, z):
    with np.errstate(over='ignore'):
        m, a = np.int32(1664525), np.int32(1013904223)
        x = (x.astype(np.int32) * m + a).astype(np.int32); y = (y.astype(np.int32) * m + a).astype(np.int32)
        z = (z.astype(np.int32) * m + a).astype(np.int32)
        x = (x + y * z).astype(np.int32); y = (y + z * x).astype(np.int32); z = (z + x * y).astype(np.int32)
        x = x ^ (x >> 16); y = y ^ (y >> 16); z = z ^ (z >> 16)
        x = (x + y * z).astype(np.int32); y = (y + z * x).astype(np.int32); z = (z + x * y).astype(np.int32)
    return x, y, z


def int_to_f01(k):
    return ((k & np.int32(0x7fffffff)).astype(F) * F(1.0 / 2147483648.0)).astype(F)


def node_voronoi(ev, nid, n):
    P = n['props']
    if (P.get('voronoi_dimensions'), P.get('feature'), P.get('distance')) != ('2D', 'F1', 'EUCLIDEAN'):
        raise NotImplementedError('voronoi ' + str(P))
    I, dom = pixel_inputs(ev, nid, n)
    v = convert(I['Vector'], 'float3').data.astype(F)
    scale = ch(I['Scale']).astype(F)
    detail = ch(I['Detail']).astype(F); rough = ch(I['Roughness']).astype(F)
    rnd = np.minimum(np.maximum(ch(I['Randomness']).astype(F), F(0)), F(1))
    if not (np.all(detail == 0) or np.all(rough == 0)):
        raise NotImplementedError('fractal voronoi')
    cx = (v[..., 0] * scale).astype(F); cy = (v[..., 1] * scale).astype(F)
    fx, fy = np.floor(cx), np.floor(cy)
    lx, ly = (cx - fx).astype(F), (cy - fy).astype(F)
    ix, iy = fx.astype(np.int32), fy.astype(np.int32)
    best = np.full(cx.shape, np.finfo(F).max, F)
    tox = np.zeros(cx.shape, np.int32); toy = np.zeros(cx.shape, np.int32)
    tpx = np.zeros(cx.shape, F); tpy = np.zeros(cx.shape, F)
    for j in (-1, 0, 1):
        for i in (-1, 0, 1):
            hx, hy = pcg2d((ix + i).astype(np.int32), (iy + j).astype(np.int32))
            px_ = (F(i) + (int_to_f01(hx) * rnd).astype(F)).astype(F)
            py_ = (F(j) + (int_to_f01(hy) * rnd).astype(F)).astype(F)
            dx, dy = (px_ - lx).astype(F), (py_ - ly).astype(F)
            d = ((dx * dx).astype(F) + (dy * dy).astype(F)).astype(F)
            m = d < best
            best = np.where(m, d, best); tox = np.where(m, i, tox); toy = np.where(m, j, toy)
            tpx = np.where(m, px_, tpx); tpy = np.where(m, py_, tpy)
    dx, dy = (tpx - lx).astype(F), (tpy - ly).astype(F)
    dist = np.sqrt((((dx * dx).astype(F) + (dy * dy).astype(F)).astype(F)).astype(np.float64)).astype(F)
    hx, hy, hz = pcg3d((ix + tox).astype(np.int32), (iy + toy).astype(np.int32), np.zeros_like(ix))
    col = np.stack([int_to_f01(hx), int_to_f01(hy), int_to_f01(hz), np.ones(cx.shape, F)], -1)
    pos = np.stack([(tpx + fx).astype(F), (tpy + fy).astype(F), np.zeros(cx.shape, F)], -1)
    out = {'Distance': mkres('float', dist[..., None] if dom is not None else dist, dom),
           'Color': mkres('color', col, dom), 'Position': mkres('float3', pos, dom)}
    return out


def _fade(t):
    t = t.astype(F); D = np.float64
    left = ((t * t).astype(F) * t).astype(F)
    right = t.astype(D) * (t.astype(D) * 6.0 - 15.0) + 10.0
    return (left.astype(D) * right).astype(F)


def _grad2(h, x, y):
    h = h & np.uint32(7)
    u = np.where(h < 4, x, y).astype(F)
    v = (F(2) * np.where(h < 4, y, x)).astype(F)
    u = np.where((h & 1) != 0, -u, u); v = np.where((h & 2) != 0, -v, v)
    return (u + v).astype(F)


def _perlin2(px, py):
    D = np.float64
    X, Y = np.floor(px), np.floor(py)
    fx, fy = (px - X).astype(F), (py - Y).astype(F)
    Xi, Yi = X.astype(np.int32).view(np.uint32), Y.astype(np.int32).view(np.uint32)
    one = np.uint32(1)
    with np.errstate(over='ignore'):
        Xi1, Yi1 = (Xi + one).astype(np.uint32), (Yi + one).astype(np.uint32)
    u, v = _fade(fx), _fade(fy)
    fx1 = (fx.astype(D) - 1.0).astype(F); fy1 = (fy.astype(D) - 1.0).astype(F)
    v0 = _grad2(hash_uint(Xi, Yi), fx, fy)
    v1 = _grad2(hash_uint(Xi1, Yi), fx1, fy)
    v2 = _grad2(hash_uint(Xi, Yi1), fx, fy1)
    v3 = _grad2(hash_uint(Xi1, Yi1), fx1, fy1)
    x1 = (1.0 - u.astype(D)).astype(F)
    a = ((v0 * x1).astype(F) + (v1 * u).astype(F)).astype(F)
    b = ((v2 * x1).astype(F) + (v3 * u).astype(F)).astype(F)
    r = (1.0 - v.astype(D)) * a.astype(D) + (v * b).astype(F).astype(D)
    return r.astype(F)


def _perlin_signed2(px, py):
    corr_x = (F(0.5) * (np.abs(px) >= F(1000000)).astype(F)).astype(F)
    corr_y = (F(0.5) * (np.abs(py) >= F(1000000)).astype(F)).astype(F)
    px = (np.fmod(px, F(100000)) + corr_x).astype(F); py = (np.fmod(py, F(100000)) + corr_y).astype(F)
    return (_perlin2(px, py) * F(0.6616)).astype(F)


def node_noise(ev, nid, n):
    P = n['props']
    if (P.get('noise_dimensions'), P.get('noise_type', 'FBM')) != ('2D', 'FBM'):
        raise NotImplementedError('noise ' + str(P))
    I, dom = pixel_inputs(ev, nid, n)
    v = convert(I['Vector'], 'float3').data.astype(F)
    scale = ch(I['Scale']).astype(F)
    detail = np.clip(ch(I['Detail']).astype(F), F(0), F(15))
    rough = np.maximum(ch(I['Roughness']).astype(F), F(0))
    lac = ch(I['Lacunarity']).astype(F); dist = ch(I['Distortion']).astype(F)
    if not (np.ndim(detail) == 0 or detail.size == 1):
        raise NotImplementedError('per-pixel noise detail')
    detail, rough, lac, dist = (F(np.ravel(a)[0]) for a in (detail, rough, lac, dist))
    px = (v[..., 0] * scale).astype(F); py = (v[..., 1] * scale).astype(F)
    if dist != 0:
        o0 = (F(100) + (hash_float_to_float(F(0), F(0)) * F(100)).astype(F)).astype(F)
        o1 = (F(100) + (hash_float_to_float(F(0), F(1)) * F(100)).astype(F)).astype(F)
        q0 = (F(100) + (hash_float_to_float(F(1), F(0)) * F(100)).astype(F)).astype(F)
        q1 = (F(100) + (hash_float_to_float(F(1), F(1)) * F(100)).astype(F)).astype(F)
        dx = (_perlin_signed2((px + o0).astype(F), (py + o1).astype(F)) * dist).astype(F)
        dy = (_perlin_signed2((px + q0).astype(F), (py + q1).astype(F)) * dist).astype(F)
        px, py = (px + dx).astype(F), (py + dy).astype(F)
    fscale, amp, maxamp = F(1), F(1), F(0)
    s = np.zeros(px.shape, F)
    for i in range(int(detail) + 1):
        t = _perlin_signed2((fscale * px).astype(F), (fscale * py).astype(F))
        s = (s + (t * amp).astype(F)).astype(F)
        maxamp = F(maxamp + amp); amp = F(amp * rough); fscale = F(fscale * lac)
    rmd = F(detail - F(math.floor(detail)))
    norm = P.get('normalize', True)
    if rmd != 0:
        t = _perlin_signed2((fscale * px).astype(F), (fscale * py).astype(F))
        s2 = (s + (t * amp).astype(F)).astype(F)
        if norm:
            a = (((F(0.5) * s).astype(F) / maxamp).astype(F) + F(0.5)).astype(F)
            b = (((F(0.5) * s2).astype(F) / F(maxamp + amp)).astype(F) + F(0.5)).astype(F)
        else:
            a, b = s, s2
        fac = ((F(1) - rmd) * a + rmd * b).astype(F)
    else:
        fac = ((((F(0.5) * s).astype(F) / maxamp).astype(F) + F(0.5)).astype(F)) if norm else s
    return {'Fac': mkres('float', fac[..., None] if dom is not None else fac, dom),
            'Color': mkres('color', np.stack([fac, fac, fac, np.ones_like(fac)], -1), dom)}


# ----------------------------------------------------------------------------------------------- filters

def node_op_inputs(ev, nid, n, names):
    """Non-pixel operation: convert first, then realize on the operation domain (Operation input processors)."""
    ins = ev.ins(nid, n)
    items = [(k, r, 'domain') for sid, (k, s, r) in ins.items() if sid in names or s['name'] in names]
    dom = pick_domain(items).realize_transformation(False)
    out = {}
    for sid, (k, s, r) in ins.items():
        out[sid] = r if r.type == 'menu' else realize_onto(r, dom)
        out[s['name']] = out[sid]
    return out, dom


def extended(data, x, y):
    H, W = data.shape[:2]
    return data[np.clip(y, 0, H - 1), np.clip(x, 0, W - 1)]


def node_filter(ev, nid, n):
    typ = menu_value(ev, nid, 'Type')
    I, dom = node_op_inputs(ev, nid, n, ('Image', 'Fac'))
    img = I['Image']
    if img.single:
        return {'Image': img}
    K = {'Soften': [[1 / 16, 2 / 16, 1 / 16], [2 / 16, 4 / 16, 2 / 16], [1 / 16, 2 / 16, 1 / 16]],
         'Box Sharpen': [[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]],
         'Diamond Sharpen': [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
         'Shadow': [[1, 2, 1], [0, 1, 0], [-1, -2, -1]]}[typ]
    K = np.array(K, F)
    d = img.data.astype(F)
    H, W = d.shape[:2]
    X, Y = np.meshgrid(np.arange(W), np.arange(H))
    acc = np.zeros_like(d)
    for j in range(3):
        for i in range(3):
            acc = (acc + (extended(d, X + i - 1, Y + j - 1) * K[i, j]).astype(F)).astype(F)
    fac = I['Fac']
    f_ = fac.data[..., 0] if not fac.single else F(fac.data[0])
    f_ = f_[..., None] if np.ndim(f_) else f_
    out = ((d * (F(1) - f_)).astype(F) + (acc * f_).astype(F)).astype(F)
    out = np.maximum(out, F(0))
    return {'Image': Res('color', out, img.domain.copy())}


def gauss_weights(radius):
    scale = F(1.6); two = F(F(F(2) * scale) * scale); k = F(F(3) * scale)
    c = F(F(1) / F(math.sqrt(float(F(F(math.pi) * two)))))

    def val(x):
        x = F(abs(x)); x = F(x * k)
        return F(c * F(math.exp(float(F(F(-x * x) / two)))))
    n = int(math.ceil(float(radius))) + 1
    w = [val(F(0))]
    s = F(w[0])
    sc = F(F(1) / F(radius)) if radius > 0 else F(0)
    for i in range(1, n):
        wi = val(F(F(i) * sc)); w.append(wi); s = F(s + F(wi * F(2)))
    return np.array([F(x / s) for x in w], F)


def blur_pass(d, w):
    """Horizontal pass, result transposed."""
    H, W = d.shape[:2]
    X = np.arange(W)
    acc = (d * w[0]).astype(F)
    for i in range(1, len(w)):
        acc = (acc + (d[:, np.clip(X + i, 0, W - 1)] * w[i]).astype(F)).astype(F)
        acc = (acc + (d[:, np.clip(X - i, 0, W - 1)] * w[i]).astype(F)).astype(F)
    return np.ascontiguousarray(np.swapaxes(acc, 0, 1))


def node_blur(ev, nid, n):
    typ = menu_value(ev, nid, 'Type')
    I, dom = node_op_inputs(ev, nid, n, ('Image',))
    img = I['Image']
    size = convert(I['Size'], 'float2')
    if img.single:
        return {'Image': img}
    if not size.single:
        raise NotImplementedError('variable size blur')
    rad = np.maximum(size.data, F(0))
    if rad[0] == 0 and rad[1] == 0:
        return {'Image': img.share()}
    ext = convert(I['Extend Bounds'], 'bool'); sep = convert(I['Separable'], 'bool')
    if bool(ext.data[0]):
        raise NotImplementedError('extend bounds')
    if typ != 'Gaussian' or not bool(sep.data[0]):
        raise NotImplementedError('blur type ' + str(typ))
    d = img.data.astype(F)
    h = blur_pass(d, gauss_weights(rad[0]))
    v = blur_pass(h, gauss_weights(rad[1]))
    return {'Image': Res(img.type, v, img.domain.copy())}


def node_dilate_erode(ev, nid, n):
    typ = menu_value(ev, nid, 'Type')
    I, dom = node_op_inputs(ev, nid, n, ('Mask',))
    m = I['Mask']
    size = int(convert(I['Size'], 'int').data[0])
    if m.single or (typ != 'Threshold' and size == 0):
        return {'Mask': m}
    if typ != 'Feather':
        raise NotImplementedError('dilate/erode ' + str(typ))
    falloff = menu_value(ev, nid, 'Falloff')
    r = abs(size)
    w = gauss_weights(F(r)) if False else None
    # weights: Gaussian over the radius (an int), normalized; falloffs per distance
    scale = F(1.6); two = F(F(F(2) * scale) * scale); k = F(F(3) * scale)
    c = F(F(1) / F(math.sqrt(float(F(F(math.pi) * two)))))

    def gv(x):
        x = F(abs(x)); x = F(x * k)
        return F(c * F(math.exp(float(F(F(-x * x) / two)))))
    sc = F(F(1) / F(r)) if r > 0 else F(0)
    ws = [gv(F(0))]; s = F(ws[0])
    for i in range(1, r + 1):
        wi = gv(F(F(i) * sc)); ws.append(wi); s = F(s + F(wi * F(2)))
    ws = np.array([F(x / s) for x in ws], F)

    def fo(x):
        x = F(F(1) - x)
        if falloff == 'Smooth':
            return F(F(F(F(3) * x) * x) - F(F(F(F(2) * x) * x) * x))
        if falloff == 'Linear':
            return x
        if falloff == 'Sharp':
            return F(x * x)
        if falloff == 'Root':
            return F(math.sqrt(float(x)))
        if falloff == 'Sphere':
            return F(math.sqrt(float(F(F(F(2) * x) - F(x * x)))))
        if falloff == 'Inverse Square':
            return F(x * F(F(2) - x))
        raise NotImplementedError('falloff ' + str(falloff))
    fs = np.array([fo(F(F(i) * sc)) for i in range(r + 1)], F)
    erode = size < 0

    def fpass(d):
        H, W = d.shape
        X = np.arange(W)
        cval = (F(1) - d).astype(F) if erode else d
        acc = (cval * ws[0]).astype(F)
        lim = cval.copy(); limf = np.ones_like(d)
        for i in range(1, r + 1):
            for sgn in (-1, 1):
                val = d[:, np.clip(X + sgn * i, 0, W - 1)]
                if erode:
                    val = (F(1) - val).astype(F)
                acc = (acc + (val * ws[i]).astype(F)).astype(F)
                fd = (val * fs[i]).astype(F)
                mm = fd > lim
                lim = np.where(mm, fd, lim); limf = np.where(mm, fs[i], limf)
        val = ((acc * (F(1) - limf)).astype(F) + (lim * limf).astype(F)).astype(F)
        if erode:
            val = (F(1) - val).astype(F)
        return np.ascontiguousarray(val.T)
    d = m.data[..., 0].astype(F)
    out = fpass(fpass(d))
    return {'Mask': Res('float', out[..., None], m.domain.copy())}


NODES.update({
    'ShaderNodeFloatCurve': node_float_curve, 'CompositorNodeHueCorrect': node_hue_correct,
    'CompositorNodeCurveRGB': node_curve_rgb, 'ShaderNodeVectorRotate': node_vector_rotate,
    'ShaderNodeTexVoronoi': node_voronoi, 'ShaderNodeTexNoise': node_noise,
    'CompositorNodeFilter': node_filter, 'CompositorNodeBlur': node_blur, 'CompositorNodeDilateErode': node_dilate_erode,
})


# ----------------------------------------------------------------------------------------------- glare

def sample_n(data, cx, cy, mode):
    """Result.sample_bilinear_zero / _extended at normalized coordinates (cx, cy) of `data`."""
    H, W = data.shape[:2]
    return sample(data, (cx * F(W)).astype(F), (cy * F(H)).astype(F), 'bilinear', mode, mode)


def glare_highlights(img, threshold, smooth, maxb, quality):
    H, W = img.shape[:2]
    q = 1 << quality
    h, w = -(-H // q), -(-W // q)
    if quality == 0:
        c = img.astype(F)
    elif quality == 1:
        X, Y = np.meshgrid(np.arange(w, dtype=F), np.arange(h, dtype=F))
        cx = (((X * F(2)) + F(1)) / F(W)).astype(F); cy = (((Y * F(2)) + F(1)) / F(H)).astype(F)
        c = sample_n(img, cx, cy, 'extend')
    else:
        raise NotImplementedError('low quality glare')
    hsv = rgb_to_hsv(c[..., :3])
    # adaptive smooth clamp
    rd = F(abs(F(threshold - maxb))) if math.isfinite(float(maxb)) else F(np.finfo(F).max)
    dmin = F(abs(threshold)); dmax = F(abs(maxb))
    smin = F(min(smooth, min(dmin, rd))); smax = F(min(smooth, min(dmax, rd)))

    def smooth_min(a, b, k):
        if k == 0:
            return np.minimum(a, b)
        hh = (np.maximum((k - np.abs((a - b).astype(F))).astype(F), F(0)) / k).astype(F)
        return (np.minimum(a, b) - ((((hh * hh).astype(F) * k).astype(F)) * F(0.25)).astype(F)).astype(F)
    v = hsv[..., 2]
    smx = -smooth_min(np.full_like(v, -threshold), -v, smin)
    cl = smooth_min(np.full_like(v, maxb), smx.astype(F), smax)
    hsv[..., 2] = (cl - F(threshold)).astype(F)
    rgb = hsv_to_rgb(hsv)
    return np.concatenate([rgb, np.ones(rgb.shape[:-1] + (1,), F)], -1).astype(F)


def glare_streaks(hl, streaks, angle0, iterations, fade, cmod):
    H, W = hl.shape[:2]
    acc = np.zeros_like(hl)
    att = F(F(1) / F(5 + 1 - iterations))
    X, Y = np.meshgrid(np.arange(W, dtype=F), np.arange(H, dtype=F))
    cx = ((X + F(0.5)) / F(W)).astype(F); cy = ((Y + F(0.5)) / F(H)).astype(F)
    for si in range(streaks):
        ang = F(float(angle0) + float(F(F(si) / F(streaks))) * (math.pi * float(F(2))))
        d = (F(math.cos(float(ang))), F(math.sin(float(ang))))
        inp = hl.copy()
        for it in range(iterations):
            cm = F(1.0 - float(cmod) ** (it + 1))
            mag = F(4.0 ** it)
            f1 = F(float(fade) ** float(mag))
            ff = (f1, F(float(f1) ** 2.0), F(float(f1) ** 3.0))
            sv = (F(d[0] * mag), F(d[1] * mag))
            vx, vy = F(sv[0] / F(W)), F(sv[1] / F(H))
            n0 = sample_n(inp, (cx + vx).astype(F), (cy + vy).astype(F), 'clip') * np.array([1, cm, cm, 1], F)
            n1 = sample_n(inp, (cx + F(vx * F(2))).astype(F), (cy + F(vy * F(2))).astype(F), 'clip') * np.array([cm, cm, 1, 1], F)
            n2 = sample_n(inp, (cx + F(vx * F(3))).astype(F), (cy + F(vy * F(3))).astype(F), 'clip') * np.array([cm, 1, cm, 1], F)
            ws = ((ff[0] * n0.astype(F)).astype(F) + (ff[1] * n1.astype(F)).astype(F)).astype(F)
            ws = (ws + (ff[2] * n2.astype(F)).astype(F)).astype(F)
            centre = sample_n(inp, cx, cy, 'clip')
            inp = ((centre + ws).astype(F) / F(2)).astype(F)
        acc = (acc + (inp * att).astype(F)).astype(F)
        acc[..., 3] = F(1)
    return acc


def glare_bloom(hl, size):
    h, w = hl.shape[:2]
    n = int(math.log2(max(1.0, float(F(F(min(h, w)) * size)))))
    if n < 2:
        return hl.copy(), max(1, n)
    chain = [hl.astype(F)]
    for i in range(n - 1):
        src = chain[-1]; sh, sw = src.shape[:2]; oh, ow = sh // 2, sw // 2
        X, Y = np.meshgrid(np.arange(ow, dtype=F), np.arange(oh, dtype=F))
        cx = ((X + F(0.5)) / F(ow)).astype(F); cy = ((Y + F(0.5)) / F(oh)).astype(F)
        px, py = F(F(1) / F(sw)), F(F(1) / F(sh))

        def S(dx, dy):
            return sample_n(src, (cx + F(px * F(dx))).astype(F), (cy + F(py * F(dy))).astype(F), 'extend')
        c = S(0, 0); uln, urn, lln, lrn = S(-1, 1), S(1, 1), S(-1, -1), S(1, -1)
        lf, rf, uf, lof = S(-2, 0), S(2, 0), S(0, 2), S(0, -2)
        ulf, urf, llf, lrf = S(-2, 2), S(2, 2), S(-2, -2), S(2, -2)
        if i == 0:
            def kw(c1, c2, c3, c4):
                b = [np.max(x[..., :3], -1) for x in (c1, c2, c3, c4)]
                wts = [(F(1) / (bb + F(1)).astype(F)).astype(F) for bb in b]
                s_ = ((((c1 * wts[0][..., None]).astype(F) + (c2 * wts[1][..., None]).astype(F)).astype(F)
                       + (c3 * wts[2][..., None]).astype(F)).astype(F) + (c4 * wts[3][..., None]).astype(F)).astype(F)
                tot = (((wts[0] + wts[1]).astype(F) + wts[2]).astype(F) + wts[3]).astype(F)
                rc = np.where(tot != 0, (F(1) / np.where(tot != 0, tot, F(1))).astype(F), F(0))
                return (s_ * rc[..., None]).astype(F)
            cw = kw(uln, urn, lrn, lln)
            a1 = kw(ulf, uf, c, lf); a2 = kw(uf, urf, rf, c); a3 = kw(c, rf, lrf, lof); a4 = kw(lf, c, lof, llf)
            out = ((F(4.0 / 8.0) * cw).astype(F) + (F(1.0 / 8.0) * (((a1 + a2).astype(F) + a4).astype(F) + a3).astype(F)).astype(F)).astype(F)
        else:
            near = (((uln + urn).astype(F) + lln).astype(F) + lrn).astype(F)
            far = (((lf + rf).astype(F) + uf).astype(F) + lof).astype(F)
            corner = (((ulf + urf).astype(F) + llf).astype(F) + lrf).astype(F)
            out = ((((F(4.0 / 32.0) * c).astype(F) + (F(4.0 / 32.0) * near).astype(F)).astype(F)
                    + (F(2.0 / 32.0) * far).astype(F)).astype(F) + (F(1.0 / 32.0) * corner).astype(F)).astype(F)
        chain.append(out)
    for i in range(n - 1):
        src = chain[n - 1 - i]; dst = chain[n - 2 - i]
        oh, ow = dst.shape[:2]
        X, Y = np.meshgrid(np.arange(ow, dtype=F), np.arange(oh, dtype=F))
        cx = ((X + F(0.5)) / F(ow)).astype(F); cy = ((Y + F(0.5)) / F(oh)).astype(F)
        px, py = F(F(1) / F(ow)), F(F(1) / F(oh))

        def S(dx, dy):
            return sample_n(src, (cx + F(px * F(dx))).astype(F), (cy + F(py * F(dy))).astype(F), 'extend')
        up = np.zeros_like(dst)
        for wt, (dx, dy) in ((4, (0, 0)), (2, (-1, 0)), (2, (0, 1)), (2, (1, 0)), (2, (0, -1)),
                             (1, (-1, -1)), (1, (-1, 1)), (1, (1, -1)), (1, (1, 1))):
            up = (up + (F(wt / 16.0) * S(dx, dy)).astype(F)).astype(F)
        comb = (dst + up).astype(F); comb[..., 3] = F(1)
        chain[n - 2 - i] = comb
    return chain[0], max(1, n)


def node_glare(ev, nid, n):
    I, dom = node_op_inputs(ev, nid, n, ('Image',))
    img = I['Image']
    if img.single:
        return {'Image': img}
    g = lambda k: I[k]

    def val(k, t='float'):
        return convert(g(k), t).data[0]
    typ = menu_value(ev, nid, 'Type'); quality = {'High': 0, 'Medium': 1, 'Low': 2}[menu_value(ev, nid, 'Quality')]
    thr = F(max(F(0), val('Highlights Threshold'))); smooth = F(max(F(0), val('Highlights Smoothness')))
    clamp = bool(convert(g('Clamp Highlights'), 'bool').data[0])
    maxb = F(thr + F(max(F(0), val('Maximum Highlights')))) if clamp else np.finfo(F).max
    strength = F(max(F(0), val('Strength'))); sat = F(max(F(0), val('Saturation')))
    tint = convert(g('Tint'), 'color').data[:3].astype(F)
    d = img.data.astype(F)
    hl = glare_highlights(d, thr, smooth, maxb, quality)
    if typ == 'Streaks':
        glr = glare_streaks(hl, int(np.clip(int(convert(g('Streaks'), 'int').data[0]), 1, 16)), F(val('Streaks Angle')),
                            int(np.clip(int(convert(g('Iterations'), 'int').data[0]), 2, 5)),
                            F(np.clip(val('Fade'), F(0.75), F(1))), F(np.clip(val('Color Modulation'), F(0), F(1))))
        norm = 1
    elif typ == 'Bloom':
        glr, norm = glare_bloom(hl, F(np.clip(val('Size'), F(0), F(1))))
    else:
        raise NotImplementedError('glare ' + str(typ))
    ct = ((tint * strength).astype(F) / F(norm)).astype(F)
    H, W = d.shape[:2]
    X, Y = np.meshgrid(np.arange(W, dtype=F), np.arange(H, dtype=F))
    cx = ((X + F(0.5)) / F(W)).astype(F); cy = ((Y + F(0.5)) / F(H)).astype(F)
    gc = sample_n(glr, cx, cy, 'extend')
    hsv = rgb_to_hsv(gc[..., :3]); hsv[..., 1] = np.clip((hsv[..., 1] * sat).astype(F), F(0), F(1))
    grgb = hsv_to_rgb(hsv)
    inc = np.maximum(F(0), d)
    out = inc.copy(); out[..., :3] = (inc[..., :3] + (grgb * ct).astype(F)).astype(F)
    return {'Image': Res('color', out.astype(F), img.domain.copy())}


# ----------------------------------------------------------------------------------------------- colour

def node_bright_contrast(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    c = I['Image'].data.astype(F)
    b = ch(I['Bright']).astype(F); k = ch(I['Contrast']).astype(F)
    sb = (b / F(100)).astype(F); delta = (k / F(200)).astype(F)
    m_pos = (F(1) / np.maximum((F(1) - (delta * F(2)).astype(F)).astype(F), np.finfo(F).eps)).astype(F)
    o_pos = (m_pos * (sb - delta).astype(F)).astype(F)
    dn = (delta * F(-1)).astype(F)
    m_neg = np.maximum((F(1) - (dn * F(2)).astype(F)).astype(F), F(0))
    o_neg = ((m_neg * sb).astype(F) + dn).astype(F)
    mul = np.where(k > 0, m_pos, m_neg); off = np.where(k > 0, o_pos, o_neg)
    mm = mul[..., None] if dom is not None else mul; oo = off[..., None] if dom is not None else off
    out = c.copy(); out[..., :3] = ((c[..., :3] * mm).astype(F) + oo).astype(F)
    return {'Image': mkres('color', out, dom)}


def node_hue_sat(ev, nid, n):
    I, dom = pixel_inputs(ev, nid, n)
    c = I['Image'].data.astype(F)
    hue, sat, val, fac = (ch(I[k]).astype(F) for k in ('Hue', 'Saturation', 'Value', 'Fac'))
    hsv = rgb_to_hsv(c[..., :3])
    h = ((hsv[..., 0] + hue).astype(F) + F(0.5)).astype(F)
    h = (h - np.floor(h)).astype(F)
    s = (hsv[..., 1] * sat).astype(F); v = (hsv[..., 2] * val).astype(F)
    rgb = np.maximum(hsv_to_rgb(np.stack([h, s, v], -1)), F(0))
    ff = fac[..., None] if dom is not None else fac
    out = c.copy(); out[..., :3] = ((c[..., :3] * (F(1) - ff)).astype(F) + (rgb * ff).astype(F)).astype(F)
    return {'Image': mkres('color', out, dom)}


def lut3d_log(L, x, lo, hi):
    """Trilinear lookup in a table sampled on a log2 grid from lo to hi (L[b][g][r][3])."""
    N = L.shape[0]
    t = (np.log2(np.maximum(x.astype(np.float64), 2.0 ** lo)) - lo) / (hi - lo) * (N - 1)
    t = np.clip(t, 0, N - 1)
    i0 = np.minimum(np.floor(t).astype(np.int64), N - 2); f_ = t - i0
    r, gch, b = i0[..., 0], i0[..., 1], i0[..., 2]; fr, fg, fb = f_[..., 0:1], f_[..., 1:2], f_[..., 2:3]
    def at(db, dg, dr): return L[b + db, gch + dg, r + dr]
    c00 = at(0, 0, 0) * (1 - fr) + at(0, 0, 1) * fr; c01 = at(0, 1, 0) * (1 - fr) + at(0, 1, 1) * fr
    c10 = at(1, 0, 0) * (1 - fr) + at(1, 0, 1) * fr; c11 = at(1, 1, 0) * (1 - fr) + at(1, 1, 1) * fr
    c0 = c00 * (1 - fg) + c01 * fg; c1 = c10 * (1 - fg) + c11 * fg
    return (c0 * (1 - fb) + c1 * fb).astype(F)


FILMIC_LO, FILMIC_HI, FILMIC_INV_HI = -12.473931188, 12.526068812, 4.026068812


def lut3d_tetra_log(L, x, lo, hi):
    """OCIO-style tetrahedral lookup in a table sampled on a log2 grid from lo to hi (L[b][g][r][3]). Our table
    is measured from Blender on a grid twice as fine as the config's cube, so its tetrahedra nest inside the
    cube's and the lookup reproduces the config's own interpolation."""
    N = L.shape[0]
    t = ((np.log2(np.maximum(x.astype(np.float64), 2.0 ** -126)) - lo) / (hi - lo)).astype(F)
    t = np.clip((t * F(N - 1)).astype(F), F(0), F(N - 1))
    i0 = np.minimum(np.floor(t).astype(np.int64), N - 2)
    fx, fy, fz = [(t[..., k] - i0[..., k].astype(F)).astype(F)[..., None] for k in range(3)]
    r, g, b = i0[..., 0], i0[..., 1], i0[..., 2]

    def c(dr, dg, db):
        return L[b + db, g + dg, r + dr].astype(F)
    c000, c111 = c(0, 0, 0), c(1, 1, 1)
    out = np.empty(x.shape, F)
    cases = [
        ((fx > fy) & (fy > fz), lambda: (F(1) - fx) * c000 + (fx - fy) * c(1, 0, 0) + (fy - fz) * c(1, 1, 0) + fz * c111),
        ((fx > fy) & ~(fy > fz) & (fx > fz), lambda: (F(1) - fx) * c000 + (fx - fz) * c(1, 0, 0) + (fz - fy) * c(1, 0, 1) + fy * c111),
        ((fx > fy) & ~(fy > fz) & ~(fx > fz), lambda: (F(1) - fz) * c000 + (fz - fx) * c(0, 0, 1) + (fx - fy) * c(1, 0, 1) + fy * c111),
        (~(fx > fy) & (fz > fy), lambda: (F(1) - fz) * c000 + (fz - fy) * c(0, 0, 1) + (fy - fx) * c(0, 1, 1) + fx * c111),
        (~(fx > fy) & ~(fz > fy) & (fz > fx), lambda: (F(1) - fy) * c000 + (fy - fz) * c(0, 1, 0) + (fz - fx) * c(0, 1, 1) + fx * c111),
        (~(fx > fy) & ~(fz > fy) & ~(fz > fx), lambda: (F(1) - fy) * c000 + (fy - fx) * c(0, 1, 0) + (fx - fz) * c(1, 1, 0) + fz * c111),
    ]
    for m, fn in cases:
        v = fn().astype(F)
        mm = m[..., 0]
        out[mm] = v[mm]
    return out


_OCIO = None


def ocio():
    """Blender's own OpenColorIO (bundled with the bpy module) and its config, when this runs under bpy's Python:
    the conversions are then Blender's, bit for bit. None otherwise (tables measured from Blender are used)."""
    global _OCIO
    if _OCIO is None:
        _OCIO = False
        import glob
        for root in glob.glob(sys.prefix + '/lib/python3*/site-packages/bpy/*/'):
            sp = glob.glob(root + 'python/lib/python3*/site-packages')
            cfgp = glob.glob(root + 'datafiles/colormanagement/config.ocio')
            if sp and cfgp:
                sys.path.insert(0, sp[0])
                try:
                    import PyOpenColorIO as O
                    _OCIO = (O, O.Config.CreateFromFile(cfgp[0]))
                except Exception:
                    _OCIO = False
                break
    return _OCIO or None


def node_convert_colorspace(ev, nid, n):
    P = n['props']
    I, dom = node_op_inputs(ev, nid, n, ('Image',))
    img = I['Image']
    if img.single:
        return {'Image': img}
    fr, to = P.get('from_color_space'), P.get('to_color_space')
    d = img.data.astype(F)
    out = d.copy()
    oc = ocio()
    if oc is not None and fr != to:
        O, cfg = oc
        x = np.ascontiguousarray(d.copy())
        cfg.getProcessor(fr, to).getDefaultCPUProcessor().applyRGBA(x)
        return {'Image': Res('color', x.astype(F), img.domain.copy())}
    if (fr, to) == ('Linear Rec.709', 'Filmic Log'):
        out[..., :3] = lut3d_tetra_log(ev.luts['filmiclog'], d[..., :3], FILMIC_LO, FILMIC_HI)
    elif (fr, to) == ('Filmic Log', 'Linear Rec.709'):
        out[..., :3] = (2.0 ** (d[..., :3].astype(np.float64) * (FILMIC_INV_HI - FILMIC_LO) + FILMIC_LO)).astype(F)
    elif fr == to:
        pass
    else:
        raise NotImplementedError(f'colour space {fr} -> {to}')
    return {'Image': Res('color', out, img.domain.copy())}


NODES.update({'CompositorNodeGlare': node_glare, 'CompositorNodeBrightContrast': node_bright_contrast,
              'CompositorNodeHueSat': node_hue_sat, 'CompositorNodeConvertColorSpace': node_convert_colorspace})


# ----------------------------------------------------------------------------------------------- display

PLANCK_LOCUS = [  # Robertson's isotherms: mired, CIE 1960 (u, v), isotherm slope (as in Blender's math_color)
    (0.0, 0.18006, 0.26352, -0.24341), (10.0, 0.18066, 0.26589, -0.25479), (20.0, 0.18133, 0.26846, -0.26876),
    (30.0, 0.18208, 0.27119, -0.28539), (40.0, 0.18293, 0.27407, -0.30470), (50.0, 0.18388, 0.27709, -0.32675),
    (60.0, 0.18494, 0.28021, -0.35156), (70.0, 0.18611, 0.28342, -0.37915), (80.0, 0.18740, 0.28668, -0.40955),
    (90.0, 0.18880, 0.28997, -0.44278), (100.0, 0.19032, 0.29326, -0.47888), (125.0, 0.19462, 0.30141, -0.58204),
    (150.0, 0.19962, 0.30921, -0.70471), (175.0, 0.20525, 0.31647, -0.84901), (200.0, 0.21142, 0.32312, -1.0182),
    (225.0, 0.21807, 0.32909, -1.2168), (250.0, 0.22511, 0.33439, -1.4512), (275.0, 0.23247, 0.33904, -1.7298),
    (300.0, 0.24010, 0.34308, -2.0637), (325.0, 0.24792, 0.34655, -2.4681), (350.0, 0.25591, 0.34951, -2.9641),
    (375.0, 0.26400, 0.35200, -3.5814), (400.0, 0.27218, 0.35407, -4.3633), (425.0, 0.28039, 0.35577, -5.3762),
    (450.0, 0.28863, 0.35714, -6.7262), (475.0, 0.29685, 0.35823, -8.5955), (500.0, 0.30505, 0.35907, -11.324),
    (525.0, 0.31320, 0.35968, -15.628), (550.0, 0.32129, 0.36011, -23.325), (575.0, 0.32931, 0.36038, -40.770),
    (600.0, 0.33724, 0.36051, -116.45)]


def whitepoint_from_temp_tint(temperature, tint):
    loc = [(F(m), F(u), F(v), F(t)) for m, u, v, t in PLANCK_LOCUS]
    mired = F(min(max(F(F(1e6) / F(temperature)), loc[0][0]), loc[-1][0]))
    i = next(k for k, e in enumerate(loc) if not (e[0] < mired))
    lo, hi = loc[i - 1], loc[i]
    f_ = F(F(mired - lo[0]) / F(hi[0] - lo[0]))
    u = F(F(lo[1] * F(1 - f_)) + F(hi[1] * f_)); v = F(F(lo[2] * F(1 - f_)) + F(hi[2] * f_))

    def norm(x, y):
        l = F(math.sqrt(float(F(F(x * x) + F(y * y)))))
        return F(x / l), F(y / l)
    i0 = norm(F(1), lo[3]); i1 = norm(F(1), hi[3])
    iso = norm(F(F(i0[0] * F(1 - f_)) + F(i1[0] * f_)), F(F(i0[1] * F(1 - f_)) + F(i1[1] * f_)))
    u = F(u - F(F(iso[0] * F(tint)) / F(3000))); v = F(v - F(F(iso[1] * F(tint)) / F(3000)))
    den = F(F(F(F(2) * u) - F(F(8) * v)) + F(4))
    x = F(F(F(3) * u) / den); y = F(F(F(2) * v) / den)
    return np.array([F(x / y), F(1), F(F(F(1) - x) - y) / y], F)


def mat3(a):
    return np.array(a, F)


def mat_vec(M, v):
    return np.array([F(F(F(M[i, 0] * v[0]) + F(M[i, 1] * v[1])) + F(M[i, 2] * v[2])) for i in range(3)], F)


def display_matrix(cfg, O, temperature, tint):
    """Blender's white balance matrix (calculate_white_point_matrix), float32."""
    cpu = cfg.getProcessor('aces_interchange', 'scene_linear').getDefaultCPUProcessor()
    cols = []
    for e in np.eye(3, dtype=F):
        v = np.ascontiguousarray(e.copy()); cpu.applyRGB(v); cols.append(v)
    aces_to_scene = np.stack(cols, 1).astype(F)
    ACES_TO_XYZ = mat3([[0.938280, -0.004451, 0.016628], [0.337369, 0.729522, -0.066890], [0.001174, -0.003711, 1.091595]])
    xyz_to_scene = mat_mul(aces_to_scene, mat_inv(ACES_TO_XYZ))
    scene_to_xyz = mat_inv(xyz_to_scene)
    target = mat_vec(scene_to_xyz, np.ones(3, F))
    frm = whitepoint_from_temp_tint(temperature, tint)
    BR = mat3([[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]])
    fl = (mat_vec(BR, frm) / frm[1]).astype(F); tl = (mat_vec(BR, target) / target[1]).astype(F)
    S_ = np.diag((tl / fl).astype(F)).astype(F)
    ca = mat_mul(mat_mul(mat_inv(BR), S_), BR)
    m = mat_mul(mat_mul(xyz_to_scene, ca), scene_to_xyz)
    return mat_mul(np.eye(3, dtype=F), m)


def view_transform(img, view):
    """Blender's display transform of a scene-linear image (bottom row first, RGBA), per the scene's view settings
    (dict: display_device, view_transform, look, exposure, gamma, use_white_balance, white_balance_temperature,
    white_balance_tint). Returns display-encoded float RGB. Needs Blender's OpenColorIO (run under bpy's Python)."""
    oc = ocio()
    if oc is None:
        raise RuntimeError('view_transform needs the PyOpenColorIO bundled with bpy')
    O, cfg = oc
    g = O.GroupTransform()
    src = 'Linear Rec.709'
    scale = F(2 ** float(view.get('exposure', 0.0)))
    if scale != 1 or view.get('use_white_balance'):
        g.appendTransform(O.ColorSpaceTransform(src=src, dst='scene_linear'))
        src = 'scene_linear'
        m = (np.eye(3, dtype=F) * scale).astype(F)
        if view.get('use_white_balance'):
            m = mat_mul(m, display_matrix(cfg, O, view['white_balance_temperature'], view['white_balance_tint']))
        m4 = np.eye(4); m4[:3, :3] = m.astype(np.float64)
        g.appendTransform(O.MatrixTransform(matrix=list(m4.ravel())))
    look = view.get('look', 'None')
    dvt = O.DisplayViewTransform(src=src, display=view['display_device'], view=view['view_transform'],
                                 looksBypass=False)
    if look and look != 'None':
        raise NotImplementedError('looks')
    g.appendTransform(dvt)
    gamma = float(view.get('gamma', 1.0))
    if gamma != 1.0:
        e = 1.0 / gamma
        g.appendTransform(O.ExponentTransform(value=[e, e, e, 1.0]))
    cpu = cfg.getProcessor(g).getDefaultCPUProcessor()
    x = np.ascontiguousarray(img.astype(F).copy())
    cpu.applyRGBA(x)
    return x


def dither_bytes(disp, dither):
    """IMB float -> byte with Blender's dither (hash_iqint3, triangle-shaped, 0.0033 * dither), rows from the bottom."""
    H, W = disp.shape[:2]
    X, Y = np.meshgrid(np.arange(W, dtype=np.uint32), np.arange(H, dtype=np.uint32))
    with np.errstate(over='ignore'):
        qx = (np.uint32(1103515245) * ((X >> np.uint32(1)) ^ Y)).astype(np.uint32)
        qy = (np.uint32(1103515245) * ((Y >> np.uint32(1)) ^ X)).astype(np.uint32)
        nn = (np.uint32(1103515245) * (qx ^ (qy >> np.uint32(3)))).astype(np.uint32)
    v = (nn.astype(F) * F(1.0 / 4294967296.0)).astype(F)
    v = ((v * F(2)).astype(F) - F(1)).astype(F)
    sg = np.where(v < 0, F(-1), F(1))
    v = (sg * (F(1) - np.sqrt((F(1) - np.abs(v)).astype(np.float64)).astype(F))).astype(F)
    d = ((v * F(0.0033)).astype(F) * F(dither)).astype(F)
    out = np.empty(disp.shape[:2] + (3,), np.uint8)
    for c in range(3):
        x = (d + disp[..., c]).astype(F)
        b = np.where(x <= 0, F(0), np.where(x > F(1.0 - 0.5 / 255.0), F(255), ((F(255) * x).astype(F) + F(0.5)).astype(F)))
        out[..., c] = b.astype(np.uint8)
    return out
