"""Compile a project's Blender compositor graph to WebGL2 passes, from compeval's evaluation of it.

    bpyenv/bin/python -I tools/blender/comp2glsl.py DUMP.json CURVES.json OUT_DIR [--size 854x480] [--fast]

Writes OUT_DIR/blenderPost.json (or, with --fast, blenderPost.fast.json: the light program the game plays with): textures (sizes), passes (GLSL fragment source, inputs, output), constants
(static ones baked; the few that change with the frame as small expression lists the runtime evaluates in
float32), curve tables and the image-coordinate tables; and the 3D colour tables (ocioport's measured tables,
raw float32 RGB, red fastest) as OUT_DIR/<name>.f32, or in parts <name>.f32.0, .1, ... when large. The program's
"data" lists each table's files in order. The game's copy lives in data/blender/ (see its README).

How the graph maps to passes: compeval already decided, as Blender does, every node's domain (size, transform,
realization options). Pixel nodes whose inputs share their domain are fused into one shader; a value becomes a
texture when an operation node (scale aside: it only changes the domain), the output, or a node on another domain
needs it. Crossing domains is a realization: the shader samples the input texture through the same 3x3 matrix
compeval computes, with the input's interpolation and extension modes. Hash inputs (image coordinates, the
rotated coordinates) are built from per-column and per-row tables so that the GPU computes them with exactly the
float operations Blender does, and the noise patterns come out bit for bit.
"""
import hashlib, json, math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compeval as C  # noqa: E402
import ocioport  # noqa: E402
from glsl_harden import harden  # noqa: E402

F = np.float32
_GL = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'glsl')
LIB = open(os.path.join(_GL, 'exactmath.glsl')).read() + open(os.path.join(_GL, 'lib.glsl')).read()
# --fast: the GPU's own sqrt/log/exp/pow/sin/cos under the same names (the program the game plays with)
FASTLIB = open(os.path.join(_GL, 'fastmath.glsl')).read() + open(os.path.join(_GL, 'lib.glsl')).read()
# functions that hash a float's bits: a pass that reaches one keeps every float op exact (rn) even in --fast,
# so its noise pattern stays Blender's
FLOAT_HASHES = ('hashf1', 'hashf2', 'hashf3')


def reaches(src, names):
    """True if main() in GLSL `src` calls any of `names`, directly or through other functions."""
    import re as _re
    body = {}
    for m in _re.finditer(r'^[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\([^;{]*\)\s*\{', src, _re.M):
        d, i = 1, m.end()
        while d:
            d += (src[i] == '{') - (src[i] == '}'); i += 1
        body[m.group(1)] = body.get(m.group(1), '') + src[m.end():i]
    seen, todo = set(), ['main']
    while todo:
        f = todo.pop()
        if f in seen or f not in body:
            continue
        seen.add(f)
        todo += _re.findall(r'([A-Za-z_]\w*)\s*\(', body[f])
    return any(n in seen for n in names)

PIXEL = {'ShaderNodeMath', 'ShaderNodeMix', 'ShaderNodeMapRange', 'ShaderNodeClamp', 'ShaderNodeGamma',
         'ShaderNodeFloatCurve', 'ShaderNodeSeparateXYZ', 'ShaderNodeCombineXYZ', 'ShaderNodeVectorMath',
         'ShaderNodeVectorRotate', 'ShaderNodeTexWhiteNoise', 'ShaderNodeTexVoronoi', 'ShaderNodeTexNoise',
         'CompositorNodeSeparateColor', 'CompositorNodeCombineColor', 'CompositorNodeHueCorrect',
         'CompositorNodeCurveRGB', 'CompositorNodeBrightContrast', 'CompositorNodeHueSat', 'CompositorNodeSetAlpha'}
SIZE_ONLY = {('CompositorNodeRelativeToPixel', 'Image'), ('CompositorNodeImageInfo', 'Image'),
             ('CompositorNodeImageCoordinates', 'Image')}
ALIAS = {'GeometryNodeSwitch', 'GeometryNodeMenuSwitch', 'GeometryNodeIndexSwitch', 'CompositorNodeScale'}
GT = {'float': 'float', 'float2': 'vec2', 'float3': 'vec3', 'float4': 'vec4', 'color': 'vec4', 'int': 'int',
      'int2': 'ivec2', 'bool': 'bool'}
INTERP = {'nearest': 0, 'bilinear': 1, 'bicubic': 2}
EXT = {'clip': 0, 'extend': 1, 'repeat': 2}


def glf(x):
    """A float32 as an exact GLSL literal."""
    x = float(F(np.asarray(x).reshape(-1)[0]))
    if math.isinf(x):
        return '3.4028234663852886e38' if x > 0 else '-3.4028234663852886e38'
    r = repr(x)
    if 'e' in r or 'E' in r:
        m, e = r.split('e') if 'e' in r else r.split('E')
        if '.' not in m: m += '.0'
        return m + 'e' + e
    return r if '.' in r else r + '.0'


def conv(expr, fr, to):
    """GLSL of compeval.convert."""
    if fr == to or to is None:
        return expr
    if fr in ('float',):
        return {'float2': f'vec2({expr})', 'float3': f'vec3({expr})', 'float4': f'vec4({expr})',
                'color': f'vec4(vec3({expr}), 1.0)', 'int': f'int({expr})', 'bool': f'({expr} > 0.0)'}[to]
    if fr == 'int':
        e = f'float({expr})'
        return conv(e, 'float', to) if to != 'int2' else f'ivec2({expr})'
    if fr == 'bool':
        return conv(f'({expr} ? 1.0 : 0.0)', 'float', to)
    if fr == 'int2':
        v = f'vec2({expr})'
        return {'float': f'(({v}).x + ({v}).y) / 2.0', 'float2': v, 'float3': f'vec3({v}, 0.0)',
                'color': f'vec4({v}, 0.0, 1.0)'}[to]
    if fr == 'float2':
        return {'float': f'(({expr}).x + ({expr}).y) / 2.0', 'float3': f'vec3({expr}, 0.0)',
                'color': f'vec4({expr}, 0.0, 1.0)', 'float4': f'vec4({expr}, 0.0, 1.0)'}[to]
    if fr == 'float3':
        return {'float': f'((({expr}).x + ({expr}).y) + ({expr}).z) / 3.0', 'float2': f'({expr}).xy',
                'color': f'vec4({expr}, 1.0)', 'float4': f'vec4({expr}, 1.0)'}[to]
    if fr in ('color', 'float4'):
        return {'float': f'lum({expr})' if fr == 'color' else f'(((({expr}).x + ({expr}).y) + ({expr}).z) + ({expr}).w) / 4.0',
                'float3': f'({expr}).rgb', 'float2': f'({expr}).rg', 'color': expr, 'float4': expr,
                'bool': f'(lum({expr}) > 0.0)'}[to]
    raise NotImplementedError(f'conv {fr}->{to}')


class Compiler:
    def __init__(self, dump, curves, size, frame=0):
        self.d = dump
        W, H = size
        img = C.Res('color', np.zeros((H, W, 4), F), C.Domain((W, H)))
        self.ev = C.Evaluator(dump, img, frame=frame, curves=curves)
        self.ev.trace = []
        self.final = self.ev.final()
        self.size = size
        self.textures = {}        # tex id -> {'w', 'h', 'domain', 'type'}
        self.passes = []
        self.mat = {}             # (nid, out) -> tex id (materialized image values)
        self.consts = {}          # name -> value (static)
        self.dyn = {}             # name -> JS-evaluable recipe
        self.curves_used = []     # list of (key, curve index, table data) -> row in the curve texture
        self.coord_tables = {}    # domain key -> (texture name)
        self.data_files = {}      # table name -> file name (3D colour tables, measured by ocioport)
        self.tables = {}          # table name -> float32 [N, N, N, 3]
        self._ocio = {}           # conversion key -> (GLSL, samplers)
        self.harden = True        # rewrite shaders so every float op rounds once (glsl_harden); 'hash': only
                                  # the passes that hash float bits
        self.lib = LIB            # FASTLIB for --fast
        self.dyn_nodes = self._dynamic_nodes()

    # ---- graph helpers
    def node(self, nid):
        return self.ev.G.nodes[nid]

    def res(self, nid, out):
        return self.ev.memo[nid][out]

    def src(self, nid, in_id):
        return self.ev.source(nid, in_id)

    def _dynamic_nodes(self):
        dyn = set()
        for nid in self.ev.trace:
            n = self.node(nid)
            if n['type'] == 'CompositorNodeSceneTime':
                dyn.add(nid); continue
            for s in n['inputs']:
                if not s.get('enabled', True):
                    continue
                if (n['type'], s['name']) in SIZE_ONLY:
                    continue      # only the image's size is read
                so = self.src(nid, s['id'])
                if so[0] == 'ref' and so[1] in dyn:
                    dyn.add(nid); break
        return dyn

    def resolve_alias(self, nid, out):
        """Follow switches (shared data) to the producing node; returns (nid, out, [conversion types], domain)."""
        n = self.node(nid)
        convs = []
        while n['type'] in ('GeometryNodeSwitch', 'GeometryNodeMenuSwitch', 'GeometryNodeIndexSwitch'):
            r = self.res(nid, out)
            # find which input was selected by re-running the node's choice: the selected input is the one whose
            # value object the interpreter shared (same data)
            picked = None
            for s in n['inputs']:
                if not s.get('enabled', True):
                    continue
                so = self.src(nid, s['id'])
                if so[0] == 'ref':
                    rr = self.res(so[1], so[2])
                    if rr.data is r.data or (not rr.single and not r.single and rr.data.shape == r.data.shape and np.shares_memory(rr.data, r.data)):
                        picked = so; break
            if picked is None:
                return nid, out, convs
            convs = list(picked[3]) + convs
            nid, out = picked[1], picked[2]
            n = self.node(nid)
        return nid, out, convs


# =============================================================================================== compiler body

class Ctx:
    """One pixel pass being generated: GLSL statements, memo of inlined node outputs, sampler helpers."""

    def __init__(self, comp, domain):
        self.c = comp
        self.dom = domain
        self.lines = []
        self.memo = {}
        self.helpers = []
        self.uniforms = {}     # name -> ('float'|'vec2'|..., recipe)
        self.samplers = {}     # tex id -> uniform name
        self.k = 0

    def var(self, ty, expr):
        self.k += 1
        v = f'v{self.k}'
        self.lines.append(f'  {ty} {v} = {expr};')
        return v

    def tex(self, tid):
        if tid not in self.samplers:
            self.samplers[tid] = f't_{tid}'
        return self.samplers[tid]


def lit(ty, v):
    """GLSL literal of a single value of compeval type ty."""
    a = np.asarray(v).reshape(-1)
    if ty == 'float': return glf(a[0])
    if ty == 'int': return str(int(a[0]))
    if ty == 'bool': return 'true' if bool(a[0]) else 'false'
    if ty == 'float2': return f'vec2({glf(a[0])}, {glf(a[1])})'
    if ty == 'int2': return f'ivec2({int(a[0])}, {int(a[1])})'
    if ty == 'float3': return f'vec3({glf(a[0])}, {glf(a[1])}, {glf(a[2])})'
    if ty in ('color', 'float4'): return f'vec4({glf(a[0])}, {glf(a[1])}, {glf(a[2])}, {glf(a[3])})'
    raise NotImplementedError(ty)


def comp_methods():
    """Methods attached to Compiler below (kept in one place for reading)."""


def _value_expr(self, ctx, nid, sid, want=None):
    """GLSL expression of input socket `sid` of node `nid`, at the current texel of ctx's domain, converted to
    `want` (the socket type unless given). Pixel-operation order: realize in the value's own type, convert after."""
    G = self.ev.G
    s = G.input_socket(nid, sid)
    want = want or C.sock_type(s)
    so = self.src(nid, sid)
    if so[0] == 'const':
        _, v, ty, convs = so
        r = C.Res.value(ty, v)
        for t in reversed(convs):
            if t is not None:
                r = C.convert(r, t)
        r = C.convert(r, want) if want != 'menu' else r
        return lit(want, r.data), want
    _, src, out, convs = so
    r = self.res(src, out)
    if r.single:
        # group-interface conversions then the socket's
        rr = r
        for t in reversed(convs):
            if t is not None:
                rr = C.convert(rr, t)
        rr = C.convert(rr, want)
        if src in self.dyn_nodes:
            name = self.dyn_uniform(src, out, convs, want)
            ctx.uniforms[name] = GT[want]
            return name, want
        return lit(want, rr.data), want
    e, ty = self.image_at(ctx, src, out, convs, consumer=nid)
    return conv(e, ty, want), want


def effective(ty, convs):
    """The interface conversions that change the type, in the order they apply."""
    out = []
    for t in reversed(convs):
        if t is not None and t != ty:
            out.append(t); ty = t
    return out


def group_of(nid):
    return nid.rsplit('/', 1)[0] if '/' in nid else ''


def _image_at(self, ctx, src, out, convs, consumer=None):
    """An image value (src, out) seen through group-interface conversions `convs`, at ctx's texel. A value that
    leaves its node group is stored (as Blender's group operations store their results) and read back."""
    r = self.res(src, out)
    target = ctx.dom.realize_transformation(False)
    ty = r.type
    pre = effective(ty, convs)
    crosses = consumer is not None and group_of(src) != group_of(consumer) and self.node(src)['type'] in PIXEL
    if r.domain.is_equal(target) and not crosses:
        e, ty0 = self.inline_or_fetch(ctx, src, out)
        for t in pre:
            e = conv(e, ty0, t); ty0 = t
        return e, ty0
    if r.domain.is_equal(target):
        tid, ty1 = self.texture_conv(src, out, pre)
        v = ctx.var('vec4', f'texelFetch({ctx.tex(tid)}, ivec2(px, py), 0)')
        return unpack(v, ty1), ty1
    # realization: sample the producer's texture through the matrix with the value's own modes
    tid = self.texture_of(src, out)
    M = C.realize_matrix(r.domain, target)
    ro = r.ro
    tw, th = r.domain.size
    four = (pre[-1] if pre else ty) in ('color', 'float4')
    tname = ctx.tex(tid)
    cx = f'({glf(M[0, 0])} * x + {glf(M[0, 1])} * y) + {glf(M[0, 2])}'
    cy = f'({glf(M[1, 0])} * x + {glf(M[1, 1])} * y) + {glf(M[1, 2])}'
    fn = f'rz{len(ctx.helpers)}'
    if pre:
        # converted on its own domain first (a group interface converts before anything realizes), then sampled
        tid, ty = self.texture_conv(src, out, pre); tname = ctx.tex(tid)
    ctx.helpers.append(
        f'vec4 {fn}(float x, float y) {{\n  float cx = {cx}, cy = {cy};\n'
        f'  return sample_t({tname}, ivec2({tw}, {th}), vec2(cx * {glf(tw)}, cy * {glf(th)}), {INTERP[ro[0]]}, {EXT[ro[1]]}, {EXT[ro[2]]}, {"true" if four else "false"});\n}}')
    v = ctx.var('vec4', f'{fn}(fx, fy)')
    return unpack(v, ty), ty


def unpack(v, ty):
    return {'float': f'{v}.r', 'int': f'int({v}.r)', 'bool': f'({v}.r > 0.5)', 'float2': f'{v}.rg', 'int2': f'ivec2({v}.rg)',
            'float3': f'{v}.rgb', 'color': v, 'float4': v}[ty]


def pack(e, ty):
    return {'float': f'vec4({e}, 0.0, 0.0, 1.0)', 'int': f'vec4(float({e}), 0.0, 0.0, 1.0)', 'bool': f'vec4({e} ? 1.0 : 0.0, 0.0, 0.0, 1.0)',
            'float2': f'vec4({e}, 0.0, 1.0)', 'int2': f'vec4(vec2({e}), 0.0, 1.0)', 'float3': f'vec4({e}, 1.0)',
            'color': e, 'float4': e}[ty]


Compiler.value_expr = _value_expr
Compiler.image_at = _image_at


MATH_GLSL = {
    'ADD': '{a} + {b}', 'SUBTRACT': '{a} - {b}', 'MULTIPLY': '{a} * {b}', 'DIVIDE': 'sdiv({a}, {b})',
    'MULTIPLY_ADD': '({a} * {b}) + {c}', 'POWER': 'spow({a}, {b})', 'LOGARITHM': 'slog({a}, {b})', 'SQRT': 'ssqrt({a})',
    'SINE': 'sin_cr({a})', 'COSINE': 'cos_cr({a})', 'MAXIMUM': 'max({a}, {b})', 'MINIMUM': 'min({a}, {b})',
    'GREATER_THAN': '({a} > {b} ? 1.0 : 0.0)', 'LESS_THAN': '({a} < {b} ? 1.0 : 0.0)', 'FLOORED_MODULO': 'sflmod({a}, {b})',
    'ABSOLUTE': 'abs({a})', 'EXPONENT': 'exp_cr({a})', 'FLOOR': 'floor({a})', 'CEIL': 'ceil({a})', 'ROUND': 'floor({a} + 0.5)',
    'TRUNC': 'trunc({a})', 'FRACT': '{a} - floor({a})', 'FRACTION': '{a} - floor({a})', 'MODULO': 'sfmod({a}, {b})',
    'SNAP': 'floor(sdiv({a}, {b})) * {b}', 'SIGN': 'sign({a})', 'TANGENT': 'tan({a})', 'ARCTANGENT': 'atan({a})',
    'ARCTAN2': 'atan({a}, {b})', 'TANH': 'tanh({a})', 'RADIANS': '{a} * ' + glf(math.pi / 180.0), 'DEGREES': '{a} * ' + glf(180.0 / math.pi),
    'INVERSE_SQRT': '({a} > 0.0 ? 1.0 / sqrt_cr({a}) : 0.0)', 'ARCSINE': 'asin(clamp({a}, -1.0, 1.0))', 'ARCCOSINE': 'acos(clamp({a}, -1.0, 1.0))',
    'COMPARE': '(abs({a} - {b}) <= max({c}, 1.1920928955078125e-07) ? 1.0 : 0.0)',
}


def _emit_node(self, ctx, nid):
    """GLSL for a pixel node at ctx's texel; returns {output id: (expr, type)}."""
    if nid in ctx.memo:
        return ctx.memo[nid]
    n = self.node(nid); t = n['type']; P = n['props']
    ins = [s for s in n['inputs'] if s.get('enabled', True)]
    V = lambda sid, want=None: self.value_expr(ctx, nid, sid, want)[0]
    byname = {s['name']: s['id'] for s in ins}
    out = {}
    if t == 'ShaderNodeMath':
        a = [V(s['id'], 'float') for s in ins]
        e = MATH_GLSL[P['operation']].format(a=a[0], b=a[1] if len(a) > 1 else '0.0', c=a[2] if len(a) > 2 else '0.0')
        if P.get('use_clamp'): e = f'clamp({e}, 0.0, 1.0)'
        out['Value'] = (ctx.var('float', e), 'float')
    elif t == 'ShaderNodeMix':
        dt = P.get('data_type', 'FLOAT')
        tt = V('Factor_Float', 'float')
        if P.get('clamp_factor', True): tt = f'clamp({tt}, 0.0, 1.0)'
        tv = ctx.var('float', tt)
        if dt == 'FLOAT':
            a, b = V('A_Float', 'float'), V('B_Float', 'float')
            out['Result_Float'] = (ctx.var('float', f'{a} * (1.0 - {tv}) + {b} * {tv}'), 'float')
        else:
            A = ctx.var('vec4', V('A_Color', 'color')); B = ctx.var('vec4', V('B_Color', 'color'))
            fm = ctx.var('float', f'1.0 - {tv}')
            bt = P.get('blend_type', 'MIX')
            if bt == 'MIX': e = f'{fm} * {A} + {tv} * {B}'
            elif bt == 'ADD': e = f'vec4({A}.rgb + {tv} * {B}.rgb, {A}.a)'
            elif bt == 'SUBTRACT': e = f'vec4({A}.rgb - {tv} * {B}.rgb, {A}.a)'
            elif bt == 'MULTIPLY': e = f'vec4({A}.rgb * ({fm} + {tv} * {B}.rgb), {A}.a)'
            elif bt == 'OVERLAY':
                lo = f'{A}.rgb * ({fm} + (2.0 * {tv}) * {B}.rgb)'
                hi = f'1.0 - ({fm} + (2.0 * {tv}) * (1.0 - {B}.rgb)) * (1.0 - {A}.rgb)'
                e = f'vec4(mix({hi}, {lo}, lessThan({A}.rgb, vec3(0.5))), {A}.a)'
            elif bt == 'SCREEN': e = f'vec4(1.0 - ({fm} + {tv} * (1.0 - {B}.rgb)) * (1.0 - {A}.rgb), {A}.a)'
            else: raise NotImplementedError('mix ' + bt)
            if P.get('clamp_result'): e = f'vec4(clamp(({e}).rgb, 0.0, 1.0), ({e}).a)'
            out['Result_Color'] = (ctx.var('vec4', e), 'color')
    elif t == 'ShaderNodeMapRange':
        v, a, b, c, d = (V(byname[k], 'float') for k in ('Value', 'From Min', 'From Max', 'To Min', 'To Max'))
        f_ = ctx.var('float', f'sdiv({v} - {a}, {b} - {a})')
        it = P.get('interpolation_type', 'LINEAR')
        if it == 'LINEAR':
            r = ctx.var('float', f'{c} + {f_} * ({d} - {c})')
            if P.get('clamp', True):
                r = ctx.var('float', f'({c} > {d}) ? clamp({r}, {d}, {c}) : clamp({r}, {c}, {d})')
        elif it == 'SMOOTHSTEP':
            g = ctx.var('float', f'clamp({f_}, 0.0, 1.0)')
            g = ctx.var('float', f'(3.0 - 2.0 * {g}) * ({g} * {g})')
            r = ctx.var('float', f'{c} + {g} * ({d} - {c})')
        else: raise NotImplementedError(it)
        out['Result'] = (r, 'float')
    elif t == 'ShaderNodeClamp':
        v, lo, hi = (V(byname[k], 'float') for k in ('Value', 'Min', 'Max'))
        if P.get('clamp_type', 'MINMAX') == 'RANGE':
            out['Result'] = (ctx.var('float', f'({lo} > {hi}) ? clamp({v}, {hi}, {lo}) : clamp({v}, {lo}, {hi})'), 'float')
        else:
            out['Result'] = (ctx.var('float', f'min(max({v}, {lo}), {hi})'), 'float')
    elif t == 'ShaderNodeGamma':
        c = ctx.var('vec4', V('Color', 'color')); g = V('Gamma', 'float')
        out['Color'] = (ctx.var('vec4', f'vec4(spow({c}.r, {g}), spow({c}.g, {g}), spow({c}.b, {g}), {c}.a)'), 'color')
    elif t == 'CompositorNodeSeparateColor':
        c = ctx.var('vec4', V('Image', 'color'))
        if P.get('mode', 'RGB') == 'HSV':
            h = ctx.var('vec3', f'rgb2hsv({c}.rgb)')
            comps = (f'{h}.x', f'{h}.y', f'{h}.z', f'{c}.a')
        else:
            comps = (f'{c}.r', f'{c}.g', f'{c}.b', f'{c}.a')
        for k, e in zip(('Red', 'Green', 'Blue', 'Alpha'), comps):
            out[k] = (e, 'float')
    elif t == 'CompositorNodeCombineColor':
        r, g, b, a = (V(k, 'float') for k in ('Red', 'Green', 'Blue', 'Alpha'))
        if P.get('mode', 'RGB') == 'HSV':
            out['Image'] = (ctx.var('vec4', f'vec4(hsv2rgb(vec3({r}, {g}, {b})), {a})'), 'color')
        else:
            out['Image'] = (ctx.var('vec4', f'vec4({r}, {g}, {b}, {a})'), 'color')
    elif t == 'ShaderNodeCombineXYZ':
        out['Vector'] = (ctx.var('vec3', f'vec3({V("X", "float")}, {V("Y", "float")}, {V("Z", "float")})'), 'float3')
    elif t == 'ShaderNodeSeparateXYZ':
        v = ctx.var('vec3', V('Vector', 'float3'))
        for i, k in enumerate('XYZ'):
            out[k] = (f'{v}.{"xyz"[i]}', 'float')
    elif t == 'ShaderNodeVectorMath':
        op = P['operation']
        a = ctx.var('vec3', V(ins[0]['id'], 'float3'))
        if op == 'SCALE':
            out['Vector'] = (ctx.var('vec3', f'{a} * {V("Scale", "float")}'), 'float3')
        elif op == 'LENGTH':
            out['Value'] = (ctx.var('float', f'sqrt_cr(({a}.x * {a}.x + {a}.y * {a}.y) + {a}.z * {a}.z)'), 'float')
        else:
            b = ctx.var('vec3', V(ins[1]['id'], 'float3'))
            out['Vector'] = (ctx.var('vec3', {'ADD': f'{a} + {b}', 'SUBTRACT': f'{a} - {b}', 'MULTIPLY': f'{a} * {b}'}[op]), 'float3')
    elif t == 'ShaderNodeVectorRotate':
        out['Vector'] = (self.emit_rotate(ctx, nid), 'float3')
    elif t == 'ShaderNodeTexWhiteNoise':
        dims = P.get('noise_dimensions', '3D')
        if dims == '1D':
            w = ctx.var('float', V('W', 'float'))
            val = ctx.var('float', f'hashf1({w})')
            col = ctx.var('vec4', f'vec4({val}, hashf2({w}, 1.0), hashf2({w}, 2.0), 1.0)')
        else:
            v = ctx.var('vec3', V('Vector', 'float3'))
            val = ctx.var('float', f'hashf2({v}.x, {v}.y)')
            col = ctx.var('vec4', f'vec4({val}, hashf3({v}.x, {v}.y, 1.0), hashf3({v}.x, {v}.y, 2.0), 1.0)')
        out['Value'] = (val, 'float'); out['Color'] = (col, 'color')
    elif t == 'ShaderNodeTexVoronoi':
        v = ctx.var('vec3', V('Vector', 'float3')); sc = V('Scale', 'float')
        rnd = f'min(max({V("Randomness", "float")}, 0.0), 1.0)'
        ctx.k += 1; pv = f'vp{ctx.k}'
        ctx.lines.append(f'  vec2 {pv};')
        r = ctx.var('vec4', f'voronoi_f1(vec2({v}.x * {sc}, {v}.y * {sc}), {rnd}, {pv})')
        out['Distance'] = (f'{r}.x', 'float'); out['Color'] = (f'vec4({r}.yzw, 1.0)', 'color')
        out['Position'] = (f'vec3({pv}, 0.0)', 'float3')
    elif t == 'ShaderNodeTexNoise':
        out.update(self.emit_noise(ctx, nid, V))
    elif t == 'ShaderNodeFloatCurve':
        v = ctx.var('float', V('Value', 'float')); fac = ctx.var('float', V('Factor', 'float'))
        cm = C.curve_mapping(self.ev, nid)
        r = ctx.var('float', self.curve_call(cm['curves'][0], v))
        if cm['use_clip']:
            r = ctx.var('float', f'clamp({r}, {glf(cm["clip"][1])}, {glf(cm["clip"][3])})')
        out['Value'] = (ctx.var('float', f'{fac} != 1.0 ? (1.0 - {fac}) * {v} + {fac} * {r} : {r}'), 'float')
    elif t == 'CompositorNodeHueCorrect':
        c = ctx.var('vec4', V('Image', 'color')); fac = ctx.var('float', V('Fac', 'float'))
        cm = C.curve_mapping(self.ev, nid)
        h = ctx.var('vec3', f'rgb2hsv({c}.rgb)')
        def cl(e): return f'clamp({e}, {glf(cm["clip"][1])}, {glf(cm["clip"][3])})' if cm['use_clip'] else e
        k0 = ctx.var('float', cl(self.curve_call(cm['curves'][0], f'{h}.x')))
        k1 = ctx.var('float', cl(self.curve_call(cm['curves'][1], f'{h}.x')))
        k2 = ctx.var('float', cl(self.curve_call(cm['curves'][2], f'{h}.x')))
        hh = ctx.var('float', f'{h}.x + ({k0} - 0.5)')
        hh = ctx.var('float', f'{hh} - floor({hh})')
        ss = ctx.var('float', f'clamp({h}.y * ({k1} * 2.0), 0.0, 1.0)')
        vv = ctx.var('float', f'{h}.z * ({k2} * 2.0)')
        res = ctx.var('vec4', f'vec4(max(hsv2rgb(vec3({hh}, {ss}, {vv})), vec3(0.0)), {c}.a)')
        out['Image'] = (ctx.var('vec4', f'{c} * (1.0 - {fac}) + {res} * {fac}'), 'color')
    elif t == 'CompositorNodeCurveRGB':
        c = ctx.var('vec4', V('Image', 'color')); fac = ctx.var('float', f'clamp({V("Fac", "float")}, 0.0, 1.0)')
        blk = ctx.var('vec4', V('Black Level', 'color')); wht = ctx.var('vec4', V('White Level', 'color'))
        cm = C.curve_mapping(self.ev, nid)
        Cc = C.CurveTable(cm['curves'][3])
        chans = []
        for k in range(3):
            base = cm['curves'][k]
            prem = Cc.eval(np.array(base['y'], F))
            tab = dict(base, y=[float(v) for v in prem], slope_in=float(F(base['slope_in']) * Cc.s_in), slope_out=float(F(base['slope_out']) * Cc.s_out))
            ch_ = 'rgb'[k]
            bw = ctx.var('float', f'1.0 / max({wht}.{ch_} - {blk}.{ch_}, 1e-5)')
            x = ctx.var('float', f'({c}.{ch_} - {blk}.{ch_}) * {bw}')
            r = ctx.var('float', self.curve_call(tab, x))
            chans.append(ctx.var('float', f'{c}.{ch_} * (1.0 - {fac}) + {r} * {fac}'))
        out['Image'] = (ctx.var('vec4', f'vec4({chans[0]}, {chans[1]}, {chans[2]}, {c}.a)'), 'color')
    elif t == 'CompositorNodeBrightContrast':
        c = ctx.var('vec4', V('Image', 'color')); b = V('Bright', 'float'); k = V('Contrast', 'float')
        sb = ctx.var('float', f'{b} / 100.0'); dl = ctx.var('float', f'{k} / 200.0')
        mp = ctx.var('float', f'1.0 / max(1.0 - {dl} * 2.0, 1.1920928955078125e-07)')
        mn = ctx.var('float', f'max(1.0 - (-{dl}) * 2.0, 0.0)')
        mul = ctx.var('float', f'{k} > 0.0 ? {mp} : {mn}')
        off = ctx.var('float', f'{k} > 0.0 ? {mp} * ({sb} - {dl}) : {mn} * {sb} + (-{dl})')
        out['Image'] = (ctx.var('vec4', f'vec4({c}.rgb * {mul} + {off}, {c}.a)'), 'color')
    elif t == 'CompositorNodeHueSat':
        c = ctx.var('vec4', V('Image', 'color'))
        hue, sat, val, fac = (V(k, 'float') for k in ('Hue', 'Saturation', 'Value', 'Fac'))
        h = ctx.var('vec3', f'rgb2hsv({c}.rgb)')
        hh = ctx.var('float', f'({h}.x + {hue}) + 0.5'); hh = ctx.var('float', f'{hh} - floor({hh})')
        rgb = ctx.var('vec3', f'max(hsv2rgb(vec3({hh}, {h}.y * {sat}, {h}.z * {val})), vec3(0.0))')
        out['Image'] = (ctx.var('vec4', f'vec4({c}.rgb * (1.0 - {fac}) + {rgb} * {fac}, {c}.a)'), 'color')
    elif t == 'CompositorNodeSetAlpha':
        c = ctx.var('vec4', V('Image', 'color')); a = V('Alpha', 'float')
        typ = self.res(nid, 'Image')  # result only tells the data; the menu decides
        mode = C.menu_value(self.ev, nid, 'Type')
        out['Image'] = (ctx.var('vec4', f'vec4({c}.rgb, {a})' if mode in ('Replace Alpha', 'REPLACE_ALPHA') else f'{c} * {a}'), 'color')
    else:
        raise NotImplementedError('pixel node ' + t)
    ctx.memo[nid] = out
    return out


def _curve_call(self, c, x):
    row = len(self.curves_used)
    self.curves_used.append([float(F(v)) for v in c['y']])
    return (f'curve_eval({row}, {x}, {glf(c["mintable"])}, {glf(c["range"])}, {glf(c["x"][0])}, {glf(c["x"][256])}, '
            f'{glf(c["slope_in"])}, {glf(c["slope_out"])})')


def _emit_noise(self, ctx, nid, V):
    n = self.node(nid); P = n['props']
    if (P.get('noise_dimensions'), P.get('noise_type', 'FBM')) != ('2D', 'FBM'):
        raise NotImplementedError('noise ' + str(P))
    v = ctx.var('vec3', V('Vector', 'float3')); sc = V('Scale', 'float')
    stat = {}
    for k in ('Detail', 'Roughness', 'Lacunarity', 'Distortion'):
        so = self.src(nid, next(s['id'] for s in n['inputs'] if s['name'] == k))
        if so[0] == 'const':
            stat[k] = float(F(so[1]))
        else:
            r = self.res(so[1], so[2])
            if not r.single or so[1] in self.dyn_nodes:
                raise NotImplementedError('noise ' + k + ' not constant')
            stat[k] = float(F(C.convert(r, 'float').data[0]))
    detail = float(F(min(max(stat['Detail'], 0.0), 15.0))); rough = float(F(max(stat['Roughness'], 0.0)))
    lac = F(stat['Lacunarity']); dist = F(stat['Distortion'])
    p = ctx.var('vec2', f'vec2({v}.x * {sc}, {v}.y * {sc})')
    if dist != 0:
        o = [F(F(100) + F(C.hash_float_to_float(F(sd), F(k)) * F(100))) for sd, k in ((0, 0), (0, 1), (1, 0), (1, 1))]
        dx = ctx.var('float', f'perlin_signed2({p} + vec2({glf(o[0])}, {glf(o[1])})) * {glf(dist)}')
        dy = ctx.var('float', f'perlin_signed2({p} + vec2({glf(o[2])}, {glf(o[3])})) * {glf(dist)}')
        p = ctx.var('vec2', f'{p} + vec2({dx}, {dy})')
    fs, amp, maxamp = F(1), F(1), F(0)
    s = ctx.var('float', '0.0')
    for i in range(int(detail) + 1):
        ctx.lines.append(f'  {s} = {s} + perlin_signed2({glf(fs)} * {p}) * {glf(amp)};')
        maxamp = F(maxamp + amp); amp = F(amp * F(rough)); fs = F(fs * lac)
    if F(detail - F(math.floor(detail))) != 0:
        raise NotImplementedError('fractional noise detail')
    fac = ctx.var('float', f'((0.5 * {s}) / {glf(maxamp)}) + 0.5' if P.get('normalize', True) else s)
    return {'Fac': (fac, 'float'), 'Color': (f'vec4(vec3({fac}), 1.0)', 'color')}


Compiler.emit_node = _emit_node
Compiler.curve_call = _curve_call
Compiler.emit_noise = _emit_noise


# ----------------------------------------------------------------------------------------------- coordinates, rotate

def _coord_row(self, dom, kind):
    """Row of the exact image-coordinate table for a domain (kind: ux, uy, nx, ny)."""
    key = (dom.size, dom.display, dom.offset, kind)
    if key in self.coord_rows:
        return self.coord_rows[key]
    W, H = dom.size
    m = F(max(dom.display))
    if kind in ('ux', 'nx'):
        t = (np.arange(W, dtype=F) + F(dom.offset[0])).astype(F) + F(0.5)
        D = F(dom.display[0])
    else:
        t = (np.arange(H, dtype=F) + F(dom.offset[1])).astype(F) + F(0.5)
        D = F(dom.display[1])
    t = t.astype(F)
    vals = ((((t - D / F(2)).astype(F) / m).astype(F) * F(2)).astype(F)) if kind[0] == 'u' else (t / D).astype(F)
    row = len(self.coord_table)
    self.coord_table.append([float(v) for v in vals])
    self.coord_rows[key] = row
    return row


def _coords_expr(self, ctx, nid, out):
    """Image Coordinates output at ctx's texel, from the exact tables (no division on the GPU)."""
    r = self.res(nid, out)
    dom = r.domain
    if out == 'Pixel':
        return f'ivec2(px + {dom.offset[0]}, py + {dom.offset[1]})', 'int2'
    k = 'u' if out == 'Uniform' else 'n'
    rx, ry = self.coord_row(dom, k + 'x'), self.coord_row(dom, k + 'y')
    ctx.tex('coords')
    return f'vec2(texelFetch(t_coords, ivec2(px, {rx}), 0).r, texelFetch(t_coords, ivec2(py, {ry}), 0).r)', 'float2'


def _emit_rotate(self, ctx, nid):
    n = self.node(nid); P = n['props']
    if P.get('rotation_type') != 'Z_AXIS':
        raise NotImplementedError('vector rotate ' + str(P.get('rotation_type')))
    vin = self.src(nid, 'Vector'); cin = self.src(nid, 'Center'); ain = self.src(nid, 'Angle')
    # the separable, exact form: vector = image coordinates on this domain, centre and angle single values
    base = vin
    while base[0] == 'ref' and self.node(base[1])['type'] in ALIAS:
        bn = self.node(base[1])
        pick = self.ev.picked.get(base[1]) if bn['type'] != 'CompositorNodeScale' else 'Image'
        base = self.src(base[1], pick)
    single = lambda so: so[0] == 'const' or self.res(so[1], so[2]).single
    if base[0] == 'ref' and self.node(base[1])['type'] == 'CompositorNodeImageCoordinates' and single(cin) and single(ain) \
            and self.res(base[1], base[2]).domain.is_equal(ctx.dom.realize_transformation(False)):
        dom = self.res(base[1], base[2]).domain
        k = 'u' if base[2] == 'Uniform' else 'n'
        rx, ry = self.coord_row(dom, k + 'x'), self.coord_row(dom, k + 'y')
        cen = self.value_expr(ctx, nid, 'Center', 'float3')[0]
        ang = self.value_expr(ctx, nid, 'Angle', 'float')[0]
        inv = bool(P.get('invert'))
        if nid not in self.rot_ids:
            self.rot_ids[nid] = len(self.rotations)
            self.rotations.append({'rx': rx, 'ry': ry, 'center': self.dyn_ref(cin, 'float3'), 'angle': self.dyn_ref(ain, 'float'), 'invert': inv, 'node': nid})
        rid = self.rot_ids[nid]
        ctx.tex('rot')
        # rows of t_rot: 4*rid+0: c*tx[x], +1: s*tx[x], +2: (-s)*ty[y], +3: c*ty[y]
        a = f'texelFetch(t_rot, ivec2(px, {4 * rid}), 0).r'; b = f'texelFetch(t_rot, ivec2(py, {4 * rid + 2}), 0).r'
        c_ = f'texelFetch(t_rot, ivec2(px, {4 * rid + 1}), 0).r'; d = f'texelFetch(t_rot, ivec2(py, {4 * rid + 3}), 0).r'
        cv = ctx.var('vec3', cen)
        rxv = ctx.var('float', f'{a} + {b}'); rxv = ctx.var('float', f'{rxv} + {cv}.x')
        ryv = ctx.var('float', f'{c_} + {d}'); ryv = ctx.var('float', f'{ryv} + {cv}.y')
        return ctx.var('vec3', f'vec3({rxv}, {ryv}, 0.0)')
    # general form
    v = ctx.var('vec3', self.value_expr(ctx, nid, 'Vector', 'float3')[0])
    cen = ctx.var('vec3', self.value_expr(ctx, nid, 'Center', 'float3')[0])
    ang = ctx.var('float', self.value_expr(ctx, nid, 'Angle', 'float')[0])
    if P.get('invert'):
        ang = ctx.var('float', f'-{ang}')
    t = ctx.var('vec3', f'{v} - {cen}')
    sn, cs = ctx.var('float', f'sin_cr({ang})'), ctx.var('float', f'cos_cr({ang})')
    return ctx.var('vec3', f'vec3(({cs} * {t}.x + (-{sn}) * {t}.y), ({sn} * {t}.x + {cs} * {t}.y), 0.0) + {cen}')


Compiler.coord_row = _coord_row
Compiler.coords_expr = _coords_expr
Compiler.emit_rotate = _emit_rotate


# ----------------------------------------------------------------------------------------------- dynamic values

def _dyn_ref(self, so, want):
    """A single value that changes per frame: the runtime evaluates node `so[1]` output `so[2]`, applies the
    interface conversions and converts to `want`."""
    if so[0] == 'const':
        r = C.Res.value(so[2], so[1])
        for t in reversed(so[3]):
            if t is not None: r = C.convert(r, t)
        return {'const': [float(v) for v in C.convert(r, want).data]}
    return {'node': so[1], 'out': so[2], 'convs': [t for t in reversed(so[3]) if t is not None], 'want': want}


def _dyn_uniform(self, src, out, convs, want):
    key = (src, out, tuple(convs), want)
    if key not in self.dyn_uniforms:
        name = f'u_d{len(self.dyn_uniforms)}'
        self.dyn_uniforms[key] = (name, {'node': src, 'out': out, 'convs': [t for t in reversed(convs) if t is not None],
                                         'want': want, 'type': GT[want]})
    return self.dyn_uniforms[key][0]


def _dyn_program(self):
    """The dynamic single-value nodes, in evaluation order, with their inputs: what the runtime evaluates."""
    prog = []
    for nid in self.ev.trace:
        if nid not in self.dyn_nodes:
            continue
        n = self.node(nid)
        outs = self.ev.memo[nid]
        if not all(r.single for r in outs.values()):
            continue
        ins = []
        for s in n['inputs']:
            if not s.get('enabled', True):
                continue
            if n['type'] in ALIAS and n['type'] != 'CompositorNodeScale' and s['id'] != self.ev.picked.get(nid):
                continue      # a switch passes one input on; the others are never evaluated
            so = self.src(nid, s['id'])
            if so[0] == 'const':
                r = C.Res.value(so[2], so[1])
                for t in reversed(so[3]):
                    if t is not None: r = C.convert(r, t)
                ins.append({'id': s['id'], 'name': s['name'], 'type': C.sock_type(s), 'const': r.data.tolist() if r.type != 'menu' else r.data, 'ctype': r.type})
            else:
                rr = self.res(so[1], so[2])
                if so[1] in self.dyn_nodes:
                    ins.append({'id': s['id'], 'name': s['name'], 'type': C.sock_type(s), 'node': so[1], 'out': so[2],
                                'convs': [t for t in reversed(so[3]) if t is not None], 'vtype': rr.type})
                else:
                    r = rr
                    for t in reversed(so[3]):
                        if t is not None: r = C.convert(r, t)
                    ins.append({'id': s['id'], 'name': s['name'], 'type': C.sock_type(s), 'const': r.data.tolist() if r.type != 'menu' else r.data, 'ctype': r.type})
        prog.append({'id': nid, 'type': n['type'], 'picked': self.ev.picked.get(nid), 'props': {k: v for k, v in n['props'].items() if k in ('operation', 'noise_dimensions', 'data_type', 'interpolation_type', 'clamp', 'use_clamp', 'clamp_factor', 'blend_type')},
                     'inputs': ins, 'outputs': {k: r.type for k, r in outs.items()}})
    return prog


def _needed_dynamic(self):
    """The dynamic program cut to what the passes and rotations read (directly or through other dynamic
    nodes): Blender schedules switch branches it cannot rule out, so more frame-dependent nodes get evaluated
    than the picture uses."""
    prog = self.dyn_program()
    by_id = {d['id']: d for d in prog}
    stack = [rec['node'] for p in self.passes for rec in p['uniforms'].values() if 'node' in rec]
    for rt in self.rotations:
        stack += [rt[k]['node'] for k in ('center', 'angle') if isinstance(rt[k], dict) and 'node' in rt[k]]
    need = set()
    while stack:
        nid = stack.pop()
        if nid in need or nid not in by_id:
            continue
        need.add(nid)
        stack += [i['node'] for i in by_id[nid]['inputs'] if 'node' in i]
    return [d for d in prog if d['id'] in need]


Compiler.needed_dynamic = _needed_dynamic
Compiler.dyn_ref = _dyn_ref
Compiler.dyn_uniform = _dyn_uniform
Compiler.dyn_program = _dyn_program


# ----------------------------------------------------------------------------------------------- textures and passes

def _alias_inner(self, nid, out):
    """For an alias node (switch or scale), the input it passes on: (socket id, want type) or None."""
    n = self.node(nid)
    if n['type'] == 'CompositorNodeScale':
        return 'Image', 'color'
    if n['type'] in ('GeometryNodeSwitch', 'GeometryNodeMenuSwitch', 'GeometryNodeIndexSwitch'):
        o = next(o for o in n['outputs'] if o['id'] == out)
        return self.ev.picked[nid], C.sock_type(o)
    return None


def _inline_or_fetch(self, ctx, src, out):
    """Value (src, out) at ctx's texel when its domain equals ctx's (no realization)."""
    n = self.node(src); t = n['type']
    r = self.res(src, out)
    if t in PIXEL:
        if self.is_pruned(src):
            return self.pruned_expr(ctx, src, out)
        o = self.emit_node(ctx, src)
        return o[out]
    if t == 'CompositorNodeImageCoordinates':
        return self.coords_expr(ctx, src, out)
    if t in ALIAS:
        sid, want = self.alias_inner(src, out)
        e, ty = self.value_expr(ctx, src, sid, want)
        return e, ty
    tid = self.texture_of(src, out)
    v = ctx.var('vec4', f'texelFetch({ctx.tex(tid)}, ivec2(px, py), 0)')
    return unpack(v, r.type), r.type


def _texture_conv(self, src, out, pre):
    """Texture of value (src, out) after the conversions `pre`, on its own domain; returns (tex id, type)."""
    if not pre:
        return self.texture_of(src, out), self.res(src, out).type
    key = (src, out, tuple(pre))
    if key not in self.mat:
        def root(c2, src=src, out=out, pre=pre):
            e, t0 = self.inline_or_fetch(c2, src, out)
            for tt in pre:
                e = conv(e, t0, tt); t0 = tt
            return e, t0
        self.mat[key] = self.pixel_pass(self.res(src, out).domain, root, f'{src}:{out} as {pre[-1]}')
    return self.mat[key], pre[-1]


def _new_tex(self, dom, label):
    tid = f'x{len(self.textures)}'
    self.textures[tid] = {'w': dom.size[0], 'h': dom.size[1], 'label': label}
    return tid


def _texture_of(self, src, out):
    """A texture holding value (src, out) on its own data domain."""
    key = (src, out)
    if key in self.mat:
        return self.mat[key]
    n = self.node(src); t = n['type']
    r = self.res(src, out)
    if t in ('CompositorNodeRLayers', 'CompositorNodeImage'):
        self.mat[key] = 'input'
        return 'input'
    if t in ALIAS:
        # an alias shares its input's data: the texture is that input's, converted on the input's own domain
        # (a scale only changes the domain's transform; its data stays on the untransformed grid)
        sid, want = self.alias_inner(src, out)
        so = self.src(src, sid)
        if so[0] == 'ref' and not self.res(so[1], so[2]).single:
            inner = self.res(so[1], so[2])
            pre = effective(inner.type, so[3])
            last = pre[-1] if pre else inner.type
            if last != r.type:
                pre = pre + [r.type]
            tid, _ = self.texture_conv(so[1], so[2], pre)
            self.mat[key] = tid
            return tid
    if t in PIXEL or t in ALIAS or t == 'CompositorNodeImageCoordinates':
        tid = self.pixel_pass(r.domain, lambda ctx: self.inline_or_fetch(ctx, src, out), f'{src}:{out}')
        self.mat[key] = tid
        return tid
    tid = self.emit_op(src, out)
    self.mat[key] = tid
    return tid


def _pixel_pass(self, dom, root_fn, label, extra=None):
    """A pass computing root_fn(ctx) at every texel of `dom`; returns its texture."""
    ctx = Ctx(self, dom)
    e, ty = root_fn(ctx)
    tid = self.new_tex(dom, label)
    # storage: one or two channels for single values and pairs (texelFetch reads them back as pack() wrote them)
    self.textures[tid]['fmt'] = {'float': 'r', 'int': 'r', 'bool': 'r', 'float2': 'rg', 'int2': 'rg'}.get(ty, 'rgba')
    self.add_pass(ctx, pack(e, ty), tid, label)
    return tid


def _add_pass(self, ctx, final_expr, tid, label, body_extra=''):
    uni = ''.join(f'uniform {ty} {nm};\n' for nm, ty in sorted(ctx.uniforms.items()))
    smp = ''.join(f'uniform sampler2D {nm};\n' for nm in sorted(set(ctx.samplers.values())))
    helpers = '\n'.join(ctx.helpers)
    curves = 'uniform sampler2D t_curves;\n' + CURVE_FN if 'curve_eval(' in '\n'.join(ctx.lines) else ''
    if curves and 't_curves' not in ctx.samplers.values():
        pass
    src = ('#version 300 es\n' + self.lib + '\n' + smp + uni + curves + helpers + '\nout vec4 o_color;\nvoid main() {\n'
           '  int px = int(gl_FragCoord.x), py = int(gl_FragCoord.y);\n  float fx = float(px), fy = float(py);\n'
           + '\n'.join(ctx.lines) + '\n' + body_extra + f'  o_color = {final_expr};\n}}\n')
    ins = {nm: tid_ for tid_, nm in ctx.samplers.items()}
    if curves:
        ins['t_curves'] = 'curves'
    self.passes.append({'label': label, 'frag': src, 'out': tid, 'inputs': ins,
                        'uniforms': {nm: self.dyn_by_name(nm) for nm in ctx.uniforms}})


CURVE_FN = '''
float curve_eval(int row, float v, float mn, float rng, float x0, float x1, float s_in, float s_out) {
  float fi = (v - mn) * rng;
  if (fi < 0.0 || fi > 256.0) {
    if (v <= x0) return texelFetch(t_curves, ivec2(0, row), 0).r + s_in * (v - x0);
    if (v >= x1) return texelFetch(t_curves, ivec2(256, row), 0).r + s_out * (v - x1);
    return 0.0;
  }
  int i = clamp(int(fi), 0, 256);
  float fr = fi - float(i);
  float y0 = texelFetch(t_curves, ivec2(i, row), 0).r, y1 = texelFetch(t_curves, ivec2(min(i + 1, 256), row), 0).r;
  return i >= 256 ? y0 : (1.0 - fr) * y0 + fr * y1;
}
'''


def _dyn_by_name(self, nm):
    for key, (name, rec) in self.dyn_uniforms.items():
        if name == nm:
            return rec
    raise KeyError(nm)


Compiler.alias_inner = _alias_inner
Compiler.inline_or_fetch = _inline_or_fetch
Compiler.new_tex = _new_tex
Compiler.texture_conv = _texture_conv
Compiler.texture_of = _texture_of
Compiler.pixel_pass = _pixel_pass
Compiler.add_pass = _add_pass
Compiler.dyn_by_name = _dyn_by_name


# ----------------------------------------------------------------------------------------------- pruning

def _static_single(self, nid, sid, want='float'):
    """The value of an input if it is a single value that does not change per frame, else None."""
    so = self.src(nid, sid)
    if so[0] == 'const':
        r = C.Res.value(so[2], so[1])
    else:
        if so[1] in self.dyn_nodes:
            return None
        r = self.res(so[1], so[2])
        if not r.single:
            return None
    for t in reversed(so[3]):
        if t is not None: r = C.convert(r, t)
    return C.convert(r, want).data if want != 'menu' else r.data


def _is_pruned(self, nid):
    """A mix whose constant factor leaves A exactly (MIX/ADD/SUBTRACT/MULTIPLY at 0): the B branch is never needed."""
    n = self.node(nid)
    if n['type'] != 'ShaderNodeMix' or n['props'].get('clamp_result'):
        return False
    t = self.static_single(nid, 'Factor_Float')
    if t is None:
        return False
    t = float(np.clip(t[0], 0, 1)) if n['props'].get('clamp_factor', True) else float(t[0])
    return t == 0.0 and n['props'].get('blend_type', 'MIX') in ('MIX', 'ADD', 'SUBTRACT', 'MULTIPLY')


def _pruned_expr(self, ctx, nid, out):
    n = self.node(nid)
    dt = n['props'].get('data_type', 'FLOAT')
    if dt == 'FLOAT':
        return self.value_expr(ctx, nid, 'A_Float', 'float')
    return self.value_expr(ctx, nid, 'A_Color', 'color')


Compiler.static_single = _static_single
Compiler.is_pruned = _is_pruned
Compiler.pruned_expr = _pruned_expr


# ----------------------------------------------------------------------------------------------- operation nodes

def _op_input_tex(self, nid, sid, dom, want):
    """Input `sid` of operation `nid` converted to `want` and realized on `dom` (an op's input processors)."""
    so = self.src(nid, sid)
    if so[0] == 'ref':
        r = self.res(so[1], so[2])
        convs = effective(r.type, so[3])
        if not r.single and not convs and r.type == want and r.domain.is_equal(dom.realize_transformation(False)) \
                and r.domain.size == dom.size:
            return self.texture_of(so[1], so[2])
    return self.pixel_pass(dom, lambda ctx: self.value_expr(ctx, nid, sid, want), f'{nid}:{sid} realized')


def _simple_pass(self, dom, label, body, inputs, uniforms=None, lib_extra=''):
    """A pass with hand-written GLSL `body` (ends by setting o_color); `inputs` maps uniform name -> texture id."""
    tid = self.new_tex(dom, label)
    smp = ''.join(f'uniform sampler2D {nm};\n' for nm in inputs if f' {nm};' not in lib_extra)
    uni = ''.join(f'uniform {ty} {nm};\n' for nm, (ty, _) in (uniforms or {}).items())
    src = ('#version 300 es\n' + self.lib + '\n' + smp + uni + lib_extra + '\nout vec4 o_color;\nvoid main() {\n'
           '  int px = int(gl_FragCoord.x), py = int(gl_FragCoord.y);\n  float fx = float(px), fy = float(py);\n'
           + body + '\n}\n')
    self.passes.append({'label': label, 'frag': src, 'out': tid, 'inputs': dict(inputs),
                        'uniforms': {nm: rec for nm, (ty, rec) in (uniforms or {}).items()}})
    return tid


def _emit_op(self, nid, out):
    n = self.node(nid); t = n['type']
    r = self.res(nid, out)
    dom = r.domain
    if t == 'CompositorNodeConvertColorSpace':
        P = n['props']
        src = self.op_input_tex(nid, 'Image', dom, 'color')
        fr, to = P['from_color_space'], P['to_color_space']
        if fr == to:
            return self.simple_pass(dom, f'{nid} copy', '  o_color = texelFetch(t_in, ivec2(px, py), 0);', {'t_in': src})
        lib, samplers = self.ocio_fn((fr, to), 'cs_fn', alpha_safe=True)
        body = ('  vec4 c = texelFetch(t_in, ivec2(px, py), 0);\n'
                '  o_color = vec4(cs_fn(c.rgb), c.a);')
        return self.simple_pass(dom, f'{nid} {fr}->{to}', body, {'t_in': src, **samplers}, lib_extra=lib)
    if t == 'CompositorNodeFilter':
        src = self.op_input_tex(nid, 'Image', dom, 'color')
        typ = C.menu_value(self.ev, nid, 'Type')
        K = {'Soften': [[1 / 16, 2 / 16, 1 / 16], [2 / 16, 4 / 16, 2 / 16], [1 / 16, 2 / 16, 1 / 16]],
             'Box Sharpen': [[-1, -1, -1], [-1, 9, -1], [-1, -1, -1]],
             'Diamond Sharpen': [[0, -1, 0], [-1, 5, -1], [0, -1, 0]], 'Shadow': [[1, 2, 1], [0, 1, 0], [-1, -2, -1]]}[typ]
        fac = self.static_single(nid, 'Fac')
        W, H = dom.size
        if fac is not None and float(fac[0]) == 0.0:
            body = '  vec4 c = texelFetch(t_in, ivec2(px, py), 0);\n  o_color = max(c * (1.0 - 0.0), vec4(0.0));'
            return self.simple_pass(dom, f'{nid} (factor 0)', body, {'t_in': src})
        fe = glf(fac[0]) if fac is not None else 'texelFetch(t_fac, ivec2(px, py), 0).r'
        ins = {'t_in': src}
        if fac is None:
            ins['t_fac'] = self.op_input_tex(nid, 'Fac', dom, 'float')
        acc = ['  vec4 acc = vec4(0.0);']
        for j in range(3):
            for i in range(3):
                acc.append(f'  acc = acc + fetchx(t_in, ivec2({W}, {H}), ivec2(px + {i - 1}, py + {j - 1})) * {glf(K[i][j])};')
        body = '\n'.join(acc) + f'\n  float f = {fe};\n  vec4 c = texelFetch(t_in, ivec2(px, py), 0);\n  o_color = max(c * (1.0 - f) + acc * f, vec4(0.0));'
        return self.simple_pass(dom, f'{nid} {typ}', body, ins)
    if t == 'CompositorNodeBlur':
        src = self.op_input_tex(nid, 'Image', dom, 'color')
        size = self.static_single(nid, 'Size', 'float2')
        if size is None:
            raise NotImplementedError('variable blur size')
        rad = np.maximum(size, F(0))
        if rad[0] == 0 and rad[1] == 0:
            return src
        W, H = dom.size
        cur = src
        for axis, rr in ((0, rad[0]), (1, rad[1])):
            w = C.gauss_weights(F(rr))
            off = 'ivec2({k}, 0)' if axis == 0 else 'ivec2(0, {k})'
            lines = [f'  vec4 acc = texelFetch(t_in, ivec2(px, py), 0) * {glf(w[0])};']
            for k in range(1, len(w)):
                lines.append(f'  acc = acc + fetchx(t_in, ivec2({W}, {H}), ivec2(px, py) + {off.format(k=k)}) * {glf(w[k])};')
                lines.append(f'  acc = acc + fetchx(t_in, ivec2({W}, {H}), ivec2(px, py) + {off.format(k=-k)}) * {glf(w[k])};')
            cur = self.simple_pass(dom, f'{nid} blur {"xy"[axis]}', '\n'.join(lines) + '\n  o_color = acc;', {'t_in': cur})
        return cur
    if t == 'CompositorNodeDilateErode':
        src = self.op_input_tex(nid, 'Mask', dom, 'float')
        size = int(self.static_single(nid, 'Size', 'int')[0])
        typ = C.menu_value(self.ev, nid, 'Type'); falloff = C.menu_value(self.ev, nid, 'Falloff')
        if size == 0:
            return src
        if typ != 'Feather':
            raise NotImplementedError('dilate/erode ' + typ)
        ws, fs = feather_tables(abs(size), falloff)
        erode = size < 0
        W, H = dom.size
        cur = src
        for axis in (0, 1):
            off = 'ivec2({k}, 0)' if axis == 0 else 'ivec2(0, {k})'
            inv = (lambda e: f'(1.0 - {e})') if erode else (lambda e: e)
            lines = [f'  float c = {inv("texelFetch(t_in, ivec2(px, py), 0).r")};',
                     f'  float acc = c * {glf(ws[0])}; float lim = c; float limf = 1.0;']
            for k in range(1, len(ws)):
                for sg in (-1, 1):
                    lines.append(f'  {{ float v = {inv("fetchx(t_in, ivec2(%d, %d), ivec2(px, py) + %s).r" % (W, H, off.format(k=sg * k)))};'
                                 f' acc = acc + v * {glf(ws[k])}; float fd = v * {glf(fs[k])}; if (fd > lim) {{ lim = fd; limf = {glf(fs[k])}; }} }}')
            lines.append('  float val = acc * (1.0 - limf) + lim * limf;')
            lines.append(f'  o_color = vec4({inv("val")}, 0.0, 0.0, 1.0);')
            cur = self.simple_pass(dom, f'{nid} feather {"xy"[axis]}', '\n'.join(lines), {'t_in': cur})
        return cur
    if t == 'CompositorNodeDisplace':
        imgso = self.src(nid, 'Image')
        img = self.res(imgso[1], imgso[2])
        idom = img.domain.realize_transformation(False)
        itex = self.op_input_tex(nid, 'Image', idom, 'color')
        dtex = self.op_input_tex(nid, 'Displacement', dom, 'float2')
        ro = (C.INTM[C.menu_value(self.ev, nid, 'Interpolation')], C.EXTM[C.menu_value(self.ev, nid, 'Extension X')],
              C.EXTM[C.menu_value(self.ev, nid, 'Extension Y')])
        W, H = dom.size; iw, ih = idom.size
        body = (f'  vec2 d = texelFetch(t_d, ivec2(px, py), 0).rg;\n'
                f'  vec2 c = (vec2(fx, fy) + 0.5) / vec2({glf(W)}, {glf(H)}) - d / vec2({glf(W)}, {glf(H)});\n'
                f'  o_color = sample_t(t_img, ivec2({iw}, {ih}), c * vec2({glf(iw)}, {glf(ih)}), {INTERP[ro[0]]}, {EXT[ro[1]]}, {EXT[ro[2]]}, true);')
        return self.simple_pass(dom, f'{nid} displace', body, {'t_img': itex, 't_d': dtex})
    if t == 'CompositorNodeGlare':
        return self.emit_glare(nid, dom)
    raise NotImplementedError('op ' + t)


def feather_tables(r, falloff):
    scale = F(1.6); two = F(F(F(2) * scale) * scale); k = F(F(3) * scale)
    c = F(F(1) / F(math.sqrt(float(F(F(math.pi) * two)))))

    def gv(x):
        x = F(abs(x)); x = F(x * k)
        return F(c * F(math.exp(float(F(F(-x * x) / two)))))
    sc = F(F(1) / F(r)) if r > 0 else F(0)
    ws = [gv(F(0))]; s = F(ws[0])
    for i in range(1, r + 1):
        wi = gv(F(F(i) * sc)); ws.append(wi); s = F(s + F(wi * F(2)))
    ws = [F(x / s) for x in ws]

    def fo(x):
        x = F(F(1) - x)
        if falloff == 'Smooth': return F(F(F(F(3) * x) * x) - F(F(F(F(2) * x) * x) * x))
        if falloff == 'Linear': return x
        if falloff == 'Sharp': return F(x * x)
        raise NotImplementedError(falloff)
    fs = [fo(F(F(i) * sc)) for i in range(r + 1)]
    return ws, fs


Compiler.op_input_tex = _op_input_tex
Compiler.simple_pass = _simple_pass
Compiler.emit_op = _emit_op


def _emit_glare(self, nid, dom):
    ev = self.ev
    src = self.op_input_tex(nid, 'Image', dom, 'color')
    val = lambda k, t='float': self.static_single(nid, k, t)
    typ = C.menu_value(ev, nid, 'Type'); quality = {'High': 0, 'Medium': 1, 'Low': 2}[C.menu_value(ev, nid, 'Quality')]
    thr = F(max(F(0), val('Highlights Threshold')[0])); smooth = F(max(F(0), val('Highlights Smoothness')[0]))
    clamp_ = bool(val('Clamp Highlights', 'bool')[0])
    maxb = F(thr + F(max(F(0), val('Maximum Highlights')[0]))) if clamp_ else np.finfo(F).max
    strength = F(max(F(0), val('Strength')[0])); sat = F(max(F(0), val('Saturation')[0]))
    tint = val('Tint', 'color')[:3].astype(F)
    W, H = dom.size
    q = 1 << quality
    hw, hh = -(-W // q), -(-H // q)
    hdom = C.Domain((hw, hh))
    if quality != 1:
        raise NotImplementedError('glare quality ' + str(quality))
    rd = F(abs(F(thr - maxb))) if math.isfinite(float(maxb)) else np.finfo(F).max
    smin = F(min(smooth, min(F(abs(thr)), rd))); smax = F(min(smooth, min(F(abs(maxb)), rd)))
    sm = '''
float gsmin(float a, float b, float k) {
  if (k == 0.0) return min(a, b);
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - ((h * h) * k) * 0.25;
}
'''
    body = (f'  vec2 c = (vec2(fx, fy) * 2.0 + 1.0) / vec2({glf(W)}, {glf(H)});\n'
            f'  vec4 col = sample_t(t_in, ivec2({W}, {H}), c * vec2({glf(W)}, {glf(H)}), 1, 1, 1, true);\n'
            f'  vec3 hsv = rgb2hsv(col.rgb);\n'
            f'  float smx = -gsmin({glf(-thr)}, -hsv.z, {glf(smin)});\n'
            f'  float cl = gsmin({glf(maxb)}, smx, {glf(smax)});\n'
            f'  hsv.z = cl - {glf(thr)};\n'
            f'  o_color = vec4(hsv2rgb(hsv), 1.0);')
    hl = self.simple_pass(hdom, f'{nid} highlights', body, {'t_in': src}, lib_extra=sm)
    if typ == 'Streaks':
        streaks = int(np.clip(int(val('Streaks', 'int')[0]), 1, 16)); angle0 = F(val('Streaks Angle')[0])
        iters = int(np.clip(int(val('Iterations', 'int')[0]), 2, 5))
        fade = F(np.clip(val('Fade')[0], F(0.75), F(1))); cmod = F(np.clip(val('Color Modulation')[0], F(0), F(1)))
        att = F(F(1) / F(5 + 1 - iters))
        acc = None
        for si in range(streaks):
            ang = F(float(angle0) + float(F(F(si) / F(streaks))) * (math.pi * float(F(2))))
            d = (F(math.cos(float(ang))), F(math.sin(float(ang))))
            inp = hl
            for it in range(iters):
                cm = F(1.0 - float(cmod) ** (it + 1)); mag = F(4.0 ** it)
                f1 = F(float(fade) ** float(mag)); ff = (f1, F(float(f1) ** 2.0), F(float(f1) ** 3.0))
                sv = (F(d[0] * mag), F(d[1] * mag)); vx, vy = F(sv[0] / F(hw)), F(sv[1] / F(hh))
                S = lambda k: (f'sample_t(t_in, ivec2({hw}, {hh}), (c + vec2({glf(F(vx * F(k)))}, {glf(F(vy * F(k)))})) * '
                               f'vec2({glf(hw)}, {glf(hh)}), 1, 0, 0, true)')
                body = (f'  vec2 c = (vec2(fx, fy) + 0.5) / vec2({glf(hw)}, {glf(hh)});\n'
                        f'  vec4 n0 = {S(1)} * vec4(1.0, {glf(cm)}, {glf(cm)}, 1.0);\n'
                        f'  vec4 n1 = {S(2)} * vec4({glf(cm)}, {glf(cm)}, 1.0, 1.0);\n'
                        f'  vec4 n2 = {S(3)} * vec4({glf(cm)}, 1.0, {glf(cm)}, 1.0);\n'
                        f'  vec4 ws = ({glf(ff[0])} * n0 + {glf(ff[1])} * n1) + {glf(ff[2])} * n2;\n'
                        f'  vec4 ce = sample_t(t_in, ivec2({hw}, {hh}), c * vec2({glf(hw)}, {glf(hh)}), 1, 0, 0, true);\n'
                        f'  o_color = (ce + ws) / 2.0;')
                inp = self.simple_pass(hdom, f'{nid} streak {si} it {it}', body, {'t_in': inp})
            ins = {'t_s': inp}
            if acc is not None:
                ins['t_acc'] = acc
            body = (f'  vec4 s = texelFetch(t_s, ivec2(px, py), 0) * {glf(att)};\n' +
                    (f'  vec4 a = texelFetch(t_acc, ivec2(px, py), 0);\n' if acc is not None else '  vec4 a = vec4(0.0);\n') +
                    '  o_color = vec4((a + s).rgb, 1.0);')
            acc = self.simple_pass(hdom, f'{nid} streak {si} accumulate', body, ins)
        glr, norm, gdom = acc, 1, hdom
    elif typ == 'Bloom':
        size = F(np.clip(val('Size')[0], F(0), F(1)))
        n = int(math.log2(max(1.0, float(F(F(min(hw, hh)) * size)))))
        if n < 2:
            glr, norm, gdom = hl, max(1, n), hdom
        else:
            chain = [(hl, hw, hh)]
            for i in range(n - 1):
                s_, sw, sh = chain[-1]; ow, oh = sw // 2, sh // 2
                px_, py_ = F(F(1) / F(sw)), F(F(1) / F(sh))
                S = lambda dx, dy: (f'sample_t(t_in, ivec2({sw}, {sh}), (uvc + vec2({glf(F(px_ * F(dx)))}, {glf(F(py_ * F(dy)))})) * '
                                    f'vec2({glf(sw)}, {glf(sh)}), 1, 1, 1, true)')
                pre = f'  vec2 uvc = (vec2(fx, fy) + 0.5) / vec2({glf(ow)}, {glf(oh)});\n'
                taps = {'c': (0, 0), 'uln': (-1, 1), 'urn': (1, 1), 'lln': (-1, -1), 'lrn': (1, -1), 'lf': (-2, 0), 'rf': (2, 0),
                        'uf': (0, 2), 'lof': (0, -2), 'ulf': (-2, 2), 'urf': (2, 2), 'llf': (-2, -2), 'lrf': (2, -2)}
                pre += ''.join(f'  vec4 {k} = {S(*v)};\n' for k, v in taps.items())
                if i == 0:
                    kw = '''
vec4 kw(vec4 c1, vec4 c2, vec4 c3, vec4 c4) {
  vec4 b = vec4(max(max(c1.r, c1.g), c1.b), max(max(c2.r, c2.g), c2.b), max(max(c3.r, c3.g), c3.b), max(max(c4.r, c4.g), c4.b));
  vec4 w = 1.0 / (b + 1.0);
  float tot = ((w.x + w.y) + w.z) + w.w;
  float rc = tot != 0.0 ? 1.0 / tot : 0.0;
  return (((c1 * w.x + c2 * w.y) + c3 * w.z) + c4 * w.w) * rc;
}
'''
                    body = pre + ('  vec4 cw = kw(uln, urn, lrn, lln);\n'
                                  '  vec4 a1 = kw(ulf, uf, c, lf), a2 = kw(uf, urf, rf, c), a3 = kw(c, rf, lrf, lof), a4 = kw(lf, c, lof, llf);\n'
                                  '  o_color = 0.5 * cw + 0.125 * (((a1 + a2) + a4) + a3);')
                    t_ = self.simple_pass(C.Domain((ow, oh)), f'{nid} bloom down {i}', body, {'t_in': s_}, lib_extra=kw)
                else:
                    body = pre + ('  vec4 near = ((uln + urn) + lln) + lrn, far = ((lf + rf) + uf) + lof, corner = ((ulf + urf) + llf) + lrf;\n'
                                  '  o_color = ((0.125 * c + 0.125 * near) + 0.0625 * far) + 0.03125 * corner;')
                    t_ = self.simple_pass(C.Domain((ow, oh)), f'{nid} bloom down {i}', body, {'t_in': s_})
                chain.append((t_, ow, oh))
            for i in range(n - 1):
                s_, sw, sh = chain[n - 1 - i]; d_, dw, dh = chain[n - 2 - i]
                px_, py_ = F(F(1) / F(dw)), F(F(1) / F(dh))
                lines = [f'  vec2 c = (vec2(fx, fy) + 0.5) / vec2({glf(dw)}, {glf(dh)});', '  vec4 up = vec4(0.0);']
                for wt, (dx, dy) in ((4, (0, 0)), (2, (-1, 0)), (2, (0, 1)), (2, (1, 0)), (2, (0, -1)),
                                     (1, (-1, -1)), (1, (-1, 1)), (1, (1, -1)), (1, (1, 1))):
                    lines.append(f'  up = up + {glf(F(wt / 16.0))} * sample_t(t_in, ivec2({sw}, {sh}), (c + vec2({glf(F(px_ * F(dx)))}, {glf(F(py_ * F(dy)))})) * vec2({glf(sw)}, {glf(sh)}), 1, 1, 1, true);')
                lines.append('  o_color = vec4((texelFetch(t_dst, ivec2(px, py), 0) + up).rgb, 1.0);')
                t_ = self.simple_pass(C.Domain((dw, dh)), f'{nid} bloom up {i}', '\n'.join(lines), {'t_in': s_, 't_dst': d_})
                chain[n - 2 - i] = (t_, dw, dh)
            glr, norm, gdom = chain[0][0], max(1, n), hdom
    else:
        raise NotImplementedError('glare ' + str(typ))
    ct = ((tint * strength).astype(F) / F(norm)).astype(F)
    gw, gh = gdom.size
    body = (f'  vec2 c = (vec2(fx, fy) + 0.5) / vec2({glf(W)}, {glf(H)});\n'
            f'  vec4 g = sample_t(t_g, ivec2({gw}, {gh}), c * vec2({glf(gw)}, {glf(gh)}), 1, 1, 1, true);\n'
            f'  vec3 hsv = rgb2hsv(g.rgb); hsv.y = clamp(hsv.y * {glf(sat)}, 0.0, 1.0);\n'
            f'  vec3 grgb = hsv2rgb(hsv);\n'
            f'  vec4 inc = max(vec4(0.0), texelFetch(t_in, ivec2(px, py), 0));\n'
            f'  o_color = vec4(inc.rgb + grgb * vec3({glf(ct[0])}, {glf(ct[1])}, {glf(ct[2])}), inc.a);')
    return self.simple_pass(dom, f'{nid} mix', body, {'t_in': src, 't_g': glr})


Compiler.emit_glare = _emit_glare


# ----------------------------------------------------------------------------------------------- whole graph

def _ocio_fn(self, what, fname, alpha_safe=False, key=None):
    """GLSL for one of Blender's colour conversions (ocioport): OCIO's op list with its own float32 arithmetic,
    3D tables replaced by our measured nested tables. Returns (GLSL incl. OCIO's fast maths, {sampler: table})."""
    key = key or what
    if key in self._ocio:
        return self._ocio[key]
    oc = C.ocio()
    if oc is None:
        raise RuntimeError('colour conversions need the PyOpenColorIO bundled with bpy (run under bpy\'s Python)')
    O, cfg = oc
    ops = ocioport.ops_of(O, cfg, what)
    if alpha_safe and any(op['op'] in ('pow', 'moncurve_fwd', 'moncurve_rev') for op in ops):
        raise NotImplementedError('OCIO gamma ops change alpha; the GPU path keeps alpha')
    for op in ops:
        if op['op'] == 'lut3d':
            tab = ocioport.measure_table(O, cfg, op)
            name = 'ocio%d_%s' % (2 * op['n'] - 1, hashlib.sha1(tab.tobytes()).hexdigest()[:10])
            op['name'] = name
            self.tables[name] = tab
            self.data_files[name] = name + '.f32'
    src, samplers = ocioport.glsl(ops, fname)
    self._ocio[key] = (ocioport.GLSL_LIB + src, samplers)
    return self._ocio[key]


DISPLAY_BODY = '''
  // Blender's display step: OCIO view (white balance, AgX, sRGB), then IMB's float -> byte with dither
  // (the dither noise is per pixel and fixed; the runtime computes it in float32 as Blender does).
  vec4 c = texelFetch(t_in, ivec2(px, py), 0);
  vec3 v = view_fn(c.rgb);
  float one = ocio_one();
  vec3 x = texelFetch(t_dither, ivec2(px, py), 0).r + v;
  vec3 b = floor(255.0 * x * one + 0.5);
  b = mix(b, vec3(0.0), lessThanEqual(x, vec3(0.0)));
  b = mix(b, vec3(255.0), greaterThan(x, vec3(%s)));
  o_color = vec4(b * (1.0 / 255.0), 1.0);'''


def _compile(self):
    self.coord_rows, self.coord_table, self.rotations, self.dyn_uniforms, self.rot_ids = {}, [], [], {}, {}
    go = next(n['name'] for n in self.d['compositor']['nodes'] if n['type'] == 'NodeGroupOutput')
    sock = self.ev.G.nodes[go]['inputs'][0]
    rdom = C.Domain(self.ev.render_size)
    # the output: converted to colour, realized on the render size (non-pixel order is convert then realize; the
    # root is already a colour here)
    root = self.src(go, sock['id'])
    tid = self.pixel_pass(rdom, lambda ctx: self.value_expr(ctx, go, sock['id'], 'color'), 'output')
    self.output_tex = tid
    # the display step: the scene's view settings, Blender's dither (bytes / 255 out)
    col = self.d['color']
    view = dict(col['view'], display_device=col['display']['display_device'])
    O, cfg = C.ocio()
    lib, samplers = self.ocio_fn(C.ocio_view_group(O, cfg, view), 'view_fn', key=('view', json.dumps(view, sort_keys=True)))
    dither = float(self.d['scene']['render'].get('dither_intensity', 0.0))
    body = DISPLAY_BODY % ocioport._f(F(1.0 - 0.5 / 255.0))
    disp = self.simple_pass(rdom, 'display', body, {'t_in': tid, 't_dither': 'dither', **samplers}, lib_extra=lib)
    if self.harden:
        for p in self.passes:
            if self.harden != 'hash' or reaches(p['frag'], FLOAT_HASHES):
                p['frag'] = harden(p['frag'])
    rs = self.d['scene']['render']
    return {
        'fps': float(rs.get('fps', 24)) / float(rs.get('fps_base', 1.0) or 1.0),
        'display': disp, 'dither': dither, 'view': view,
        'size': list(self.ev.render_size),
        'textures': self.textures, 'passes': self.passes, 'output': tid,
        'curves': self.curves_used, 'coords': self.coord_table, 'rotations': self.rotations,
        'dynamic': self.needed_dynamic(), 'data': self.data_files,
    }


Compiler.compile = _compile
Compiler.ocio_fn = _ocio_fn


def main2():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('dump'); ap.add_argument('curves'); ap.add_argument('out')
    ap.add_argument('--size', default='854x480')
    ap.add_argument('--no-harden', action='store_true', help='leave the GPU compiler free to fuse and regroup float ops')
    ap.add_argument('--fast', action='store_true', help='the light program for play (blenderPost.fast.json): GPU '
                    'maths, exact float ops only in the passes that hash float bits; the tables are the same')
    ap.add_argument('--part-mb', type=float, default=8.0, help='tables larger than this are written in parts (artifact files must stay under 15 MB)')
    ap.add_argument('--source', default='', help='where the compositor graph comes from (kept in the program)')
    a = ap.parse_args()
    W, H = (int(v) for v in a.size.split('x'))
    comp = Compiler(json.load(open(a.dump)), json.load(open(a.curves)), (W, H))
    comp.harden = False if a.no_harden else 'hash' if a.fast else True
    if a.fast:
        comp.lib = FASTLIB
    prog = comp.compile()
    if a.source:
        prog['source'] = a.source
    os.makedirs(a.out, exist_ok=True)
    # tables: raw float32 RGB, red fastest; split in parts (name.f32.0, .1, ...) when big
    part = int(a.part_mb * 1024 * 1024) // 12 * 12
    for name, tab in comp.tables.items():
        raw = tab.astype('<f4').tobytes()
        if len(raw) <= part:
            open(os.path.join(a.out, name + '.f32'), 'wb').write(raw)
            prog['data'][name] = [name + '.f32']
        else:
            files = []
            for k in range(0, len(raw), part):
                fn = f'{name}.f32.{k // part}'
                open(os.path.join(a.out, fn), 'wb').write(raw[k:k + part]); files.append(fn)
            prog['data'][name] = files
    name = 'blenderPost.fast.json' if a.fast else 'blenderPost.json'
    json.dump(prog, open(os.path.join(a.out, name), 'w'))
    # the published page's files (globs.page.ts, tools/make-page.mjs): the program it plays (the fast one, once
    # built) and the tables, which both programs share
    page = 'blenderPost.fast.json' if os.path.exists(os.path.join(a.out, 'blenderPost.fast.json')) else 'blenderPost.json'
    json.dump([page] + [f for fs in prog['data'].values() for f in fs], open(os.path.join(a.out, 'files.json'), 'w'))
    print('passes', len(prog['passes']), 'textures', len(prog['textures']), 'curves', len(prog['curves']),
          'coord rows', len(prog['coords']), 'rotations', len(prog['rotations']), 'dynamic nodes', len(prog['dynamic']),
          'tables', {k: v.shape[0] for k, v in comp.tables.items()})


if __name__ == '__main__':
    main2()
