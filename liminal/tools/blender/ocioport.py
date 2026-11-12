# Run with Blender's Python (bpy) and -I.
"""Blender's colour conversions as a short list of simple ops, run the same way on the GPU.

OpenColorIO (BSD-3-Clause, Contributors to the OpenColorIO Project) does Blender's colour work. Its optimized
processor reduces a conversion to a few ops: base-2 log or exp, a scale or 3x3 matrix, a 3D table, gamma
curves. This module reads that op list from OCIO itself and copies each op's float32 arithmetic as OCIO's CPU
code does it (its fast log2/exp2/pow polynomials from SSE.h, its matrix order). The maths is ported from OCIO
2.5.0 (src/OpenColorIO/SSE.h, ops/log, ops/matrix, ops/gamma, ops/lut3d), with credit.

A 3D table op is not copied. We measure our own table from that op, on a grid twice as fine (2n-1 per side). Its
tetrahedra nest inside the original's, so tetrahedral lookup in our table is OCIO's lookup, up to float rounding.

    ops = ops_of(O, cfg, ('Linear Rec.709', 'Filmic Log'))     # or any OCIO transform
    tables = measure_tables(O, cfg, ops)                      # {name: float32 [N, N, N, 3], red fastest}
    y = emulate(ops, x, tables)                               # what the GPU computes (numpy, float32)
    src = glsl(ops, 'filmic_fwd', tables)                     # GLSL function + sampler declarations

Self-test (compares the emulation with OCIO on random colours):
    bpyenv/bin/python -I tools/blender/ocioport.py
"""
import sys
import numpy as np

F = np.float32
FLT_MIN = F(np.finfo(np.float32).tiny)

# SSE.h (OCIO 2.5.0): polynomial coefficients for log2 on [1, 2) and exp2 on [0, 1), as float32.
PNLOG = [F(v) for v in (-2.800364054395965731506, 5.091710879305474367557, -3.550793018041176193407,
                        1.631148826119436277100, -4.165637071209677112635e-1, 4.487361286440374006195e-2)]
PNEXP = [F(v) for v in (1.000002593370603213644, 6.930038344665415134202e-1, 2.414427569091865207710e-1,
                        5.201146058412685018921e-2, 1.353416792833547468620e-2)]


# ---------------------------------------------------------------- OCIO's fast maths, float32 in numpy

def fast_log2(x):
    """sseLog2: exponent + polynomial of the mantissa. No clamp here (the log op clamps to FLT_MIN first)."""
    x = np.asarray(x, F)
    b = x.view(np.uint32)
    m = ((b & np.uint32(0x807FFFFF)) | np.uint32(0x3F800000)).view(F)
    l = PNLOG[5]
    for c in (PNLOG[4], PNLOG[3], PNLOG[2], PNLOG[1], PNLOG[0]):
        l = (l * m).astype(F)
        l = (l + c).astype(F)
    e = ((b & np.uint32(0x7F800000)) >> np.uint32(23)).astype(np.int32) - np.int32(127)
    return (l + e.astype(F)).astype(F)


def fast_exp2(x):
    """sseExp2: 2^floor(x) from the exponent bits, times a polynomial of the fraction; < -126 -> 0, >= 128 -> inf."""
    x = np.asarray(x, F)
    with np.errstate(invalid='ignore', over='ignore'):
        fl = np.trunc(x).astype(np.int64).clip(-2 ** 31, 2 ** 31 - 1).astype(np.int32)
    fl = fl + np.where(~(F(0) <= x), np.int32(-1), np.int32(0))
    zf = ((fl.astype(np.int64) + 127) & 0x1FF).astype(np.uint32) << np.uint32(23)
    zf = zf.view(F)
    fr = (x - fl.astype(F)).astype(F)
    m = PNEXP[4]
    for c in (PNEXP[3], PNEXP[2], PNEXP[1], PNEXP[0]):
        m = (m * fr).astype(F)
        m = (m + c).astype(F)
    r = (zf * m).astype(F)
    r = np.where(x < F(-126), F(0), r)
    r = np.where(x >= F(128), F(np.inf), r)
    return r.astype(F)


def fast_pow(x, g):
    """ssePower: exp2(g * log2(x)), and 0 where x <= 0."""
    x = np.asarray(x, F)
    v = fast_exp2((F(g) * fast_log2(x)).astype(F) if np.ndim(g) == 0 else (g * fast_log2(x)).astype(F))
    return np.where(x > F(0), v, F(0)).astype(F)


# ---------------------------------------------------------------- the op list

EPS = 1e-6


def _mon_fwd(g, o):
    """GammaOpUtils.cpp ComputeParamsFwd (moncurve: sRGB-like decode)."""
    gamma = max(g, 1.0 + EPS); off = max(o, EPS)
    a = (gamma - 1.0) / off
    b = off * gamma / ((gamma - 1.0) * (1.0 + off))
    return dict(gamma=F(gamma), offset=F(off / (1.0 + off)), brk=F(off / (gamma - 1.0)), slope=F(a * b ** gamma),
                scale=F(1.0 / (1.0 + off)))


def _mon_rev(g, o):
    """GammaOpUtils.cpp ComputeParamsRev (moncurve: sRGB-like encode)."""
    gamma = max(g, 1.0 + EPS); off = max(o, EPS)
    brk = (off * gamma / ((gamma - 1.0) * (1.0 + off))) ** gamma
    slope = ((gamma - 1.0) / off) ** (gamma - 1.0) * ((1.0 + off) / gamma) ** gamma
    return dict(gamma=F(1.0 / gamma), offset=F(off), brk=F(brk), slope=F(slope), scale=F(1.0 + off))


def ops_of(O, cfg, what):
    """The optimized op list of a conversion: what = (src, dst) colour space names, or an OCIO transform."""
    proc = cfg.getProcessor(*what) if isinstance(what, tuple) else cfg.getProcessor(what)
    g = proc.getOptimizedProcessor(O.OPTIMIZATION_DEFAULT).createGroupTransform()
    FWD = O.TransformDirection.TRANSFORM_DIR_FORWARD
    out = []
    for t in g:
        tn = type(t).__name__
        if tn == 'MatrixTransform':
            if t.getDirection() != FWD:
                raise NotImplementedError('inverse matrix op')
            m = np.array(t.getMatrix(), np.float64).reshape(4, 4)
            o = np.array(t.getOffset(), np.float64)
            if np.any(m[3, :3] != 0) or np.any(m[:3, 3] != 0) or m[3, 3] != 1 or o[3] != 0:
                raise NotImplementedError('matrix op touches alpha')
            off = F(o[:3]) if np.any(o[:3] != 0) else None
            if np.all(m[:3, :3][~np.eye(3, dtype=bool)] == 0):
                out.append({'op': 'scale', 's': F(np.diag(m)[:3]), 'o': off})
            else:
                out.append({'op': 'matrix', 'm': F(m[:3, :3]), 'o': off})
        elif tn == 'LogTransform':
            if t.getBase() != 2.0:
                raise NotImplementedError('log base %r' % t.getBase())
            out.append({'op': 'log2' if t.getDirection() == FWD else 'exp2'})
        elif tn == 'Lut3DTransform':
            if t.getDirection() != FWD or t.getInterpolation() != O.Interpolation.INTERP_TETRAHEDRAL:
                raise NotImplementedError('3D table: only forward, tetrahedral')
            out.append({'op': 'lut3d', 'n': t.getGridSize(), 'tf': t, 'name': 'lut%d_%d' % (len(out), t.getGridSize())})
        elif tn == 'ExponentTransform':
            if t.getNegativeStyle() != O.NegativeStyle.NEGATIVE_CLAMP:
                raise NotImplementedError('exponent negative style')
            v = np.array(t.getValue(), np.float64)[:3]
            g3 = F(v) if t.getDirection() == FWD else F(1.0 / v)
            out.append({'op': 'pow', 'g': g3})
        elif tn == 'ExponentWithLinearTransform':
            if t.getNegativeStyle() != O.NegativeStyle.NEGATIVE_LINEAR:
                raise NotImplementedError('moncurve negative style')
            gm, of = t.getGamma()[:3], t.getOffset()[:3]
            fn = _mon_fwd if t.getDirection() == FWD else _mon_rev
            ps = [fn(gm[i], of[i]) for i in range(3)]
            out.append({'op': 'moncurve_fwd' if t.getDirection() == FWD else 'moncurve_rev',
                        **{k: F([p[k] for p in ps]) for k in ps[0]}})
        else:
            raise NotImplementedError('OCIO op ' + tn)
    return out


# ---------------------------------------------------------------- our own 3D tables

def _lattice_inputs(n):
    """Inputs t (float32) for which OCIO's index t*(n-1) lands on the half lattice j/2, j = 0 .. 2(n-1).
    Where no float t lands exactly, the closest one is used."""
    s = F(n - 1)
    ts = np.empty(2 * n - 1, F)
    for j in range(2 * n - 1):
        want = F(j / 2)
        t0 = F(j / (2.0 * (n - 1)))
        best, err = t0, None
        cand = [t0]
        lo = hi = t0
        for _ in range(8):
            lo = np.nextafter(lo, F(-1)); hi = np.nextafter(hi, F(2)); cand += [lo, hi]
        for c in cand:
            e = abs(float(F(c * s)) - float(want))
            if err is None or e < err:
                best, err = c, e
        ts[j] = best
    return ts


def measure_table(O, cfg, op):
    """Our own (2n-1)^3 table, measured from OCIO's 3D table op alone. float32 [b][g][r][3]."""
    n = op['n']; N = 2 * n - 1
    ts = _lattice_inputs(n)
    b, g, r = np.meshgrid(ts, ts, ts, indexing='ij')
    x = np.ascontiguousarray(np.stack([r, g, b], -1).reshape(-1, 3).astype(F))
    cfg.getProcessor(op['tf']).getDefaultCPUProcessor().applyRGB(x)
    return x.reshape(N, N, N, 3)


def measure_tables(O, cfg, ops):
    return {op['name']: measure_table(O, cfg, op) for op in ops if op['op'] == 'lut3d'}


# ---------------------------------------------------------------- the GPU's arithmetic, in numpy

def lut3d_nested(L, t, n):
    """Tetrahedral lookup in our nested table, in the GPU's order (OCIO's AVX512 vertex choice and weights,
    rounded after every multiply and add)."""
    N = L.shape[0]
    idx = (t * F(n - 1)).astype(F)
    idx = np.minimum(np.maximum(idx, F(0)), F(n - 1))
    i2 = (idx * F(2)).astype(F)
    p = np.floor(i2).astype(F)
    d = (i2 - p).astype(F)
    i0 = p.astype(np.int64); i1 = np.minimum(i0 + 1, N - 1)
    dr, dg, db = d[..., 0], d[..., 1], d[..., 2]
    gr, gg, gb = dr > dg, dg > db, db > dr
    ca = np.stack([np.where(gr & ~gb, i1[..., 0], i0[..., 0]), np.where(gg & ~gr, i1[..., 1], i0[..., 1]),
                   np.where(gb & ~gg, i1[..., 2], i0[..., 2])], -1)
    cb = np.stack([np.where(~gr & gb, i0[..., 0], i1[..., 0]), np.where(~gg & gr, i0[..., 1], i1[..., 1]),
                   np.where(~gb & gg, i0[..., 2], i1[..., 2])], -1)
    rgmin, rgmax = np.minimum(dr, dg), np.maximum(dr, dg)
    x2 = np.minimum(rgmin, db); mid = np.maximum(rgmin, db)
    x0 = np.maximum(rgmax, db); x1 = np.minimum(rgmax, mid)

    def at(i):
        return L[i[..., 2], i[..., 1], i[..., 0]].astype(F)
    w0 = (F(1) - x0).astype(F)[..., None]; wa = (x0 - x1).astype(F)[..., None]
    wb = (x1 - x2).astype(F)[..., None]; w1 = x2[..., None]
    o = (at(i0) * w0).astype(F)
    o = (o + (wa * at(ca)).astype(F)).astype(F)
    o = (o + (wb * at(cb)).astype(F)).astype(F)
    o = (o + (w1 * at(i1)).astype(F)).astype(F)
    return o


def emulate(ops, x, tables):
    """Run the op list on RGB float32 [..., 3], the way the generated GLSL does."""
    c = np.asarray(x, F).copy()
    for op in ops:
        k = op['op']
        if k == 'scale':
            c = (c * op['s']).astype(F)
            if op['o'] is not None:
                c = (c + op['o']).astype(F)
        elif k == 'matrix':
            m = op['m']
            r, g, b = c[..., 0:1], c[..., 1:2], c[..., 2:3]
            c = (((r * m[:, 0]).astype(F) + (g * m[:, 1]).astype(F)).astype(F) + (b * m[:, 2]).astype(F)).astype(F)
            if op['o'] is not None:
                c = (c + op['o']).astype(F)
        elif k == 'log2':
            c = fast_log2(np.maximum(c, FLT_MIN))
        elif k == 'exp2':
            c = fast_exp2(c)
        elif k == 'lut3d':
            c = lut3d_nested(tables[op['name']], c, op['n'])
        elif k == 'pow':
            c = fast_pow(c, op['g'])
        elif k == 'moncurve_rev':
            a = np.abs(c)
            d = (fast_pow(a, op['gamma']) * op['scale']).astype(F)
            d = (d - op['offset']).astype(F)
            d = np.where(a > op['brk'], d, (a * op['slope']).astype(F))
            c = np.copysign(d, c).astype(F)
        elif k == 'moncurve_fwd':
            a = np.abs(c)
            d = ((a * op['scale']).astype(F) + op['offset']).astype(F)
            d = fast_pow(d, op['gamma'])
            d = np.where(a > op['brk'], d, (a * op['slope']).astype(F))
            c = np.copysign(d, c).astype(F)
        else:
            raise NotImplementedError(k)
    return c


# ---------------------------------------------------------------- GLSL

def _f(v):
    v = F(v)
    if not np.isfinite(v):
        raise ValueError(v)
    s = repr(float(v))
    if F(float(s)) != v:
        raise ValueError(s)
    return s if ('.' in s or 'e' in s) else s + '.0'


def _v3(a):
    return 'vec3(%s, %s, %s)' % tuple(_f(x) for x in a)


GLSL_LIB = '''
// ---- OpenColorIO's fast maths (SSE.h, OCIO 2.5.0, BSD-3-Clause; ported). ocio_one() is a 1.0 the compiler
// cannot see: "a * b * one + c" keeps two roundings, as OCIO's SSE code has, even where the GPU fuses mul-add.
float ocio_one() { return uintBitsToFloat(0x3F800000u + uint(gl_FragCoord.x < 0.0)); }
vec3 ocio_log2(vec3 x) {
  float one = ocio_one();
  uvec3 b = floatBitsToUint(x);
  vec3 m = uintBitsToFloat((b & 0x807FFFFFu) | 0x3F800000u);
  vec3 l = %(L5)s * m * one + %(L4)s;
  l = l * m * one + %(L3)s;
  l = l * m * one + %(L2)s;
  l = l * m * one + %(L1)s;
  l = l * m * one + %(L0)s;
  return l + vec3(ivec3((b & 0x7F800000u) >> 23u) - 127);
}
vec3 ocio_exp2(vec3 x) {
  float one = ocio_one();
  ivec3 fl = ivec3(x) - ivec3(not(lessThanEqual(vec3(0.0), x)));
  vec3 zf = intBitsToFloat(((fl + 127) & 0x1FF) << 23);
  vec3 fr = x - vec3(fl);
  vec3 m = %(E4)s * fr * one + %(E3)s;
  m = m * fr * one + %(E2)s;
  m = m * fr * one + %(E1)s;
  m = m * fr * one + %(E0)s;
  vec3 r = zf * m;
  r = mix(r, vec3(0.0), lessThan(x, vec3(-126.0)));
  r = mix(r, vec3(uintBitsToFloat(0x7F800000u)), greaterThanEqual(x, vec3(128.0)));
  return r;
}
vec3 ocio_pow(vec3 x, vec3 g) { return mix(vec3(0.0), ocio_exp2(g * ocio_log2(x)), greaterThan(x, vec3(0.0))); }
vec3 ocio_lut3d(highp sampler3D t, vec3 c, float nm1, int N) {
  // OCIO's index (t * (n-1), clamped), doubled into our nested table; OCIO's AVX512 vertex choice and weights.
  vec3 idx = min(max(c * nm1, vec3(0.0)), vec3(nm1));
  vec3 i2 = idx * 2.0;
  vec3 p = floor(i2), d = i2 - p;
  ivec3 i0 = ivec3(p), i1 = min(i0 + 1, ivec3(N - 1));
  bool gr = d.r > d.g, gg = d.g > d.b, gb = d.b > d.r;
  ivec3 ca = ivec3((gr && !gb) ? i1.x : i0.x, (gg && !gr) ? i1.y : i0.y, (gb && !gg) ? i1.z : i0.z);
  ivec3 cb = ivec3((!gr && gb) ? i0.x : i1.x, (!gg && gr) ? i0.y : i1.y, (!gb && gg) ? i0.z : i1.z);
  float rgmin = min(d.r, d.g), rgmax = max(d.r, d.g);
  float x2 = min(rgmin, d.b), mid = max(rgmin, d.b);
  float x0 = max(rgmax, d.b), x1 = min(rgmax, mid);
  float one = ocio_one();
  vec3 o = texelFetch(t, i0, 0).rgb * (1.0 - x0);
  o = o + (x0 - x1) * texelFetch(t, ca, 0).rgb * one;
  o = o + (x1 - x2) * texelFetch(t, cb, 0).rgb * one;
  o = o + x2 * texelFetch(t, i1, 0).rgb * one;
  return o;
}
''' % ({'L%d' % i: _f(PNLOG[i]) for i in range(6)} | {'E%d' % i: _f(PNEXP[i]) for i in range(5)})


def glsl(ops, fname, prefix='t_'):
    """GLSL for the op list: (source with 'vec3 fname(vec3 c)', {sampler name: table name}). Needs GLSL_LIB."""
    lines, samplers = [], {}
    for op in ops:
        k = op['op']
        if k == 'scale':
            lines.append('c = c * %s * one%s;' % (_v3(op['s']), ' + ' + _v3(op['o']) if op['o'] is not None else ''))
        elif k == 'matrix':
            m = op['m']
            cols = [_v3(m[:, j]) for j in range(3)]
            lines.append('c = (c.r * %s * one + c.g * %s) * one + c.b * %s * one%s;' % (
                cols[0], cols[1], cols[2], ' + ' + _v3(op['o']) if op['o'] is not None else ''))
            if op['o'] is not None:
                # keep the offset add separate from the last product's rounding
                lines[-1] = ('c = (c.r * %s * one + c.g * %s) * one + c.b * %s * one; c = c * one + %s;'
                             % (cols[0], cols[1], cols[2], _v3(op['o'])))
        elif k == 'log2':
            lines.append('c = ocio_log2(max(c, vec3(%s)));' % _f(FLT_MIN))
        elif k == 'exp2':
            lines.append('c = ocio_exp2(c);')
        elif k == 'lut3d':
            s = prefix + op['name']
            samplers[s] = op['name']
            lines.append('c = ocio_lut3d(%s, c, %s, %d);' % (s, _f(op['n'] - 1), 2 * op['n'] - 1))
        elif k == 'pow':
            lines.append('c = ocio_pow(c, %s);' % _v3(op['g']))
        elif k == 'moncurve_rev':
            lines.append('{ vec3 a = abs(c); vec3 d = ocio_pow(a, %s) * %s * one - %s; '
                         'c = sign_copy(mix(a * %s, d, greaterThan(a, %s)), c); }'
                         % (_v3(op['gamma']), _v3(op['scale']), _v3(op['offset']), _v3(op['slope']), _v3(op['brk'])))
        elif k == 'moncurve_fwd':
            lines.append('{ vec3 a = abs(c); vec3 d = ocio_pow(a * %s * one + %s, %s); '
                         'c = sign_copy(mix(a * %s, d, greaterThan(a, %s)), c); }'
                         % (_v3(op['scale']), _v3(op['offset']), _v3(op['gamma']), _v3(op['slope']), _v3(op['brk'])))
        else:
            raise NotImplementedError(k)
    decl = ''.join('uniform highp sampler3D %s;\n' % s for s in samplers)
    src = (decl + 'vec3 sign_copy(vec3 v, vec3 s) { return uintBitsToFloat((floatBitsToUint(v) & 0x7FFFFFFFu) | '
           '(floatBitsToUint(s) & 0x80000000u)); }\n' if 'moncurve' in ''.join(o['op'] for o in ops) else decl)
    src += 'vec3 %s(vec3 c) {\n  float one = ocio_one();\n  %s\n  return c;\n}\n' % (fname, '\n  '.join(lines))
    return src, samplers


# ---------------------------------------------------------------- self-test

def _compare(name, ref, got):
    ref = ref.astype(F); got = got.astype(F)
    ex = np.all(ref == got, -1).mean()
    ab = np.abs(ref.astype(np.float64) - got.astype(np.float64))
    rel = ab / np.maximum(np.abs(ref.astype(np.float64)), 1e-30)
    ulp = ab / np.spacing(np.maximum(np.abs(ref), FLT_MIN)).astype(np.float64)
    print('%-22s exact %.5f  max abs %.3g  max rel %.3g  ulps p50 %.0f p99 %.0f max %.0f'
          % (name, ex, ab.max(), rel.max(), np.percentile(ulp, 50), np.percentile(ulp, 99), ulp.max()))


def _main():
    sys.path.insert(0, __file__.rsplit('/', 1)[0])
    import compeval as C
    O, cfg = C.ocio()
    rng = np.random.default_rng(7)
    x = (2.0 ** rng.uniform(-14, 10, (300000, 3))).astype(F)
    x[:1000] = rng.uniform(-0.01, 0.01, (1000, 3))
    cases = [('lin->filmic', ('Linear Rec.709', 'Filmic Log'), x),
             ('filmic->lin', ('Filmic Log', 'Linear Rec.709'), rng.uniform(-0.05, 1.05, (300000, 3)).astype(F))]
    view = C.ocio_view_group(O, cfg, dict(display_device='sRGB', view_transform='AgX', look='None', exposure=0.0,
                                          gamma=1.0, use_white_balance=True, white_balance_temperature=9000.0,
                                          white_balance_tint=20.0)) if hasattr(C, 'ocio_view_group') else None
    if view is not None:
        cases.append(('display AgX', view, x))
    for name, what, inp in cases:
        ops = ops_of(O, cfg, what)
        print(name, [o['op'] for o in ops])
        tables = measure_tables(O, cfg, ops)
        ref = np.ascontiguousarray(inp.copy())
        (cfg.getProcessor(*what) if isinstance(what, tuple) else cfg.getProcessor(what)).getDefaultCPUProcessor().applyRGB(ref)
        _compare(name, ref, emulate(ops, inp, tables))
        # the same chain with every op but the table: exact?
        if any(o['op'] == 'lut3d' for o in ops):
            k = next(i for i, o in enumerate(ops) if o['op'] == 'lut3d')
            pre = emulate(ops[:k], inp, tables)
            g = O.GroupTransform()
            for t in (cfg.getProcessor(*what) if isinstance(what, tuple) else cfg.getProcessor(what)).getOptimizedProcessor(O.OPTIMIZATION_DEFAULT).createGroupTransform():
                g.appendTransform(t)
            pre_ref = np.ascontiguousarray(inp.copy())
            gp = O.GroupTransform()
            for i, t in enumerate(g):
                if i < k:
                    gp.appendTransform(t)
            cfg.getProcessor(gp).getDefaultCPUProcessor().applyRGB(pre_ref)
            _compare(name + ' (before table)', pre_ref, pre)


if __name__ == '__main__':
    _main()
