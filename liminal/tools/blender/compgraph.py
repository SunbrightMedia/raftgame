"""Blender compositor node graphs (from tools/blender/blend_dump.py's JSON) flattened and constant-folded.

    python3 tools/blender/compgraph.py DUMP.json [--width 854 --height 480] [--show]

Group nodes are inlined (recursively), reroutes and group inputs/outputs resolved, and every node whose inputs are all
constant is evaluated (menu, index and boolean switches, math, map range, mix, ...). What is left is the part of the
graph that depends on the rendered image or on time: the work a real-time copy has to do.
"""
import json, math, sys, argparse

class Const:
    __slots__ = ('v',)
    def __init__(self, v): self.v = v
    def __repr__(self): return f'Const({self.v!r})'

class Ref:
    """An output of a node that is not constant: (node id, output identifier)."""
    __slots__ = ('node', 'out')
    def __init__(self, node, out): self.node, self.out = node, out
    def __repr__(self): return f'Ref({self.node}.{self.out})'
    def __eq__(self, o): return isinstance(o, Ref) and o.node == self.node and o.out == self.out
    def __hash__(self): return hash((self.node, self.out))

class Graph:
    def __init__(self, dump, width, height):
        self.d, self.W, self.H = dump, width, height
        self.nodes = {}      # id -> node dict (+ 'gid' group instance id, 'parent_group' id of the outer group node)
        self.links = {}      # (node id, input id) -> (src node id, src output id)
        self.group_out = {}  # group node id -> inner active Group Output node id
        self.group_in_parent = {}  # inner Group Input node id -> outer group node id
        self.memo = {}

    def add_tree(self, tree, prefix, outer=None):
        names = {}
        for n in tree['nodes']:
            nid = prefix + n['name']
            names[n['name']] = nid
            self.nodes[nid] = dict(n, id=nid)
            if n['type'] == 'NodeGroupInput': self.group_in_parent[nid] = outer
            if n['type'] == 'NodeGroupOutput' and outer is not None and n.get('active_output', True) is not False:
                self.group_out.setdefault(outer, nid)
        for l in tree['links']:
            if l.get('muted') or not l.get('valid', True): continue
            self.links[(names[l['to']], l['to_socket'])] = (names[l['from']], l['from_socket'])
        for n in tree['nodes']:
            if n['type'] in ('CompositorNodeGroup', 'ShaderNodeGroup', 'GeometryNodeGroup') and n.get('group'):
                self.add_tree(self.d['node_groups'][n['group']], names[n['name']] + '/', names[n['name']])

    # ---- sources
    def input_socket(self, nid, in_id):
        for s in self.nodes[nid]['inputs']:
            if s['id'] == in_id: return s
        raise KeyError((nid, in_id))

    def source(self, nid, in_id):
        """What feeds input `in_id` of node `nid`: a Const or a Ref to a real (non pass-through) node output."""
        key = (nid, in_id)
        if key in self.links:
            src, out = self.links[key]
            return self.resolve(src, out)
        s = self.input_socket(nid, in_id)
        return Const(s.get('value'))

    def resolve(self, nid, out_id):
        n = self.nodes[nid]
        t = n['type']
        if t == 'NodeReroute': return self.source(nid, n['inputs'][0]['id'])
        if t == 'NodeGroupInput':
            outer = self.group_in_parent.get(nid)
            if outer is None: return Ref(nid, out_id)
            return self.source(outer, out_id)
        if t in ('CompositorNodeGroup', 'ShaderNodeGroup', 'GeometryNodeGroup'):
            go = self.group_out.get(nid)
            if go is None: return Const(None)
            return self.source(go, out_id)
        if n.get('mute'):
            # muted: the first input of the same type passes through (Blender's internal links)
            ot = next(o['type'] for o in n['outputs'] if o['id'] == out_id)
            for s in n['inputs']:
                if s['type'] == ot: return self.source(nid, s['id'])
            return Const(None)
        v = self.fold(nid, out_id)
        return v if v is not None else Ref(nid, out_id)

    # ---- constant folding
    def ins(self, nid):
        """Enabled inputs of a node as (socket, source)."""
        return [(s, self.source(nid, s['id'])) for s in self.nodes[nid]['inputs'] if s.get('enabled', True)]

    def fold(self, nid, out_id):
        key = (nid, out_id)
        if key in self.memo: return self.memo[key]
        self.memo[key] = None   # guard cycles
        try: r = self._fold(nid, out_id)
        except NotConst: r = None
        self.memo[key] = r
        return r

    def cv(self, nid, in_id):
        s = self.source(nid, in_id)
        if isinstance(s, Const): return s.v
        raise NotConst()

    def _fold(self, nid, out_id):
        n = self.nodes[nid]; t = n['type']; P = n['props']
        if t == 'ShaderNodeValue':
            return Const(n['outputs'][0].get('value'))
        if t == 'CompositorNodeImageInfo':
            if out_id == 'Dimensions': return Const([float(self.W), float(self.H)])
            return None
        if t == 'CompositorNodeRelativeToPixel':
            # a size relative to the reference image's dimension, in pixels (the reference here: the render size)
            ref = str(P.get('reference_dimension', 'X')).upper()
            W, H = self.W, self.H
            dim = {'X': W, 'Y': H, 'GREATER': max(W, H), 'SMALLER': min(W, H), 'DIAGONAL': math.hypot(W, H)}.get(ref, W)
            if P.get('data_type', 'FLOAT') == 'FLOAT':
                return Const(float(self.cv(nid, 'Float Value')) * dim)
            vec = self.cv(nid, 'Vector Value')
            if ref in ('PER_DIMENSION', 'PER DIMENSION'): return Const([vec[0] * W, vec[1] * H])
            return Const([vec[0] * dim, vec[1] * dim])
        if t == 'GeometryNodeSwitch':
            sw = self.cv(nid, 'Switch')
            ins = {s['name']: s['id'] for s in n['inputs']}
            src = self.source(nid, ins['True'] if sw else ins['False'])
            if isinstance(src, Const): return src
            return Alias(src)
        if t == 'GeometryNodeIndexSwitch':
            i = int(self.cv(nid, 'Index'))
            items = [s for s in n['inputs'] if s['name'] != 'Index']
            if not (0 <= i < len(items)): return Const(0)
            src = self.source(nid, items[i]['id'])
            return src if isinstance(src, Const) else Alias(src)
        if t == 'GeometryNodeMenuSwitch':
            menu = self.cv(nid, n['inputs'][0]['id'])
            items = [s for s in n['inputs'][1:]]
            names = [e['name'] for e in (n.get('enum_items') or [])]
            if out_id != 'Output':   # per-item boolean outputs
                return Const(any(o['id'] == out_id and o['name'] == menu for o in n['outputs']))
            idx = names.index(menu) if menu in names else next((k for k, s in enumerate(items) if s['name'] == menu), None)
            if idx is None: return Const(None)
            src = self.source(nid, items[idx]['id'])
            return src if isinstance(src, Const) else Alias(src)
        if t == 'ShaderNodeMath':
            op = P['operation']; a = [self.cv(nid, s['id']) for s in n['inputs'] if s.get('enabled', True)]
            r = math_op(op, *[float(x) if not isinstance(x, list) else float(lum(x)) for x in a])
            if P.get('use_clamp'): r = min(1.0, max(0.0, r))
            return Const(r)
        if t == 'ShaderNodeMapRange' and P.get('data_type', 'FLOAT') == 'FLOAT':
            g = {s['name']: s['id'] for s in n['inputs'] if s.get('enabled', True)}
            v, a, b, c, d = (float(self.cv(nid, g[k])) for k in ('Value', 'From Min', 'From Max', 'To Min', 'To Max'))
            steps = float(self.cv(nid, g['Steps'])) if 'Steps' in g else 4.0
            return Const(map_range(v, a, b, c, d, P.get('interpolation_type', 'LINEAR'), P.get('clamp', True), steps))
        if t == 'ShaderNodeClamp':
            g = {s['name']: s['id'] for s in n['inputs']}
            v, lo, hi = (float(self.cv(nid, g[k])) for k in ('Value', 'Min', 'Max'))
            if P.get('clamp_type', 'MINMAX') == 'RANGE' and lo > hi: lo, hi = hi, lo
            return Const(min(max(v, lo), hi))
        if t == 'ShaderNodeCombineXYZ':
            return Const([float(self.cv(nid, k)) for k in ('X', 'Y', 'Z')])
        if t == 'ShaderNodeSeparateXYZ':
            v = self.cv(nid, 'Vector'); return Const(float(v['XYZ'.index(out_id)]))
        if t == 'ShaderNodeMix' and P.get('data_type') == 'FLOAT':
            g = {s['id']: s for s in n['inputs'] if s.get('enabled', True)}
            f = float(self.cv(nid, 'Factor_Float')); a = float(self.cv(nid, 'A_Float')); b = float(self.cv(nid, 'B_Float'))
            if P.get('clamp_factor', True): f = min(1, max(0, f))
            return Const(a + (b - a) * f)
        if t == 'ShaderNodeMix' and P.get('data_type') in ('RGBA', 'VECTOR'):
            # a constant factor of 0 (or 1 for a plain mix) makes the node transparent
            fid = 'Factor_Float' if P.get('factor_mode', 'UNIFORM') == 'UNIFORM' else 'Factor_Vector'
            fs = self.source(nid, fid)
            if isinstance(fs, Const) and not isinstance(fs.v, list):
                f = float(fs.v)
                if P.get('clamp_factor', True): f = min(1.0, max(0.0, f))
                suf = '_Color' if P['data_type'] == 'RGBA' else '_Vector'
                if f == 0.0 and not P.get('clamp_result'):
                    a = self.source(nid, 'A' + suf); return a if isinstance(a, Const) else Alias(a)
                if f == 1.0 and P.get('blend_type') == 'MIX' and not P.get('clamp_result'):
                    b = self.source(nid, 'B' + suf); return b if isinstance(b, Const) else Alias(b)
            return None
        if t == 'CompositorNodeFilter':
            fs = self.source(nid, 'Fac')
            if isinstance(fs, Const) and float(fs.v) == 0.0:
                a = self.source(nid, 'Image'); return a if isinstance(a, Const) else Alias(a)
            return None
        if t == 'ShaderNodeVectorMath':
            return None   # rarely constant here
        if t == 'ShaderNodeGamma':
            return None
        if t == 'ShaderNodeFloatCurve':
            return None
        if t == 'CompositorNodeSceneTime':
            return None   # per frame: a uniform
        return None

class NotConst(Exception): pass

class Alias:
    """A switch that resolved to a non-constant source: the switch is transparent."""
    __slots__ = ('src',)
    def __init__(self, src): self.src = src

def lum(c): return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] if len(c) >= 3 else c[0]

def math_op(op, a=0.0, b=0.0, c=0.0):
    f = {
        'ADD': lambda: a + b, 'SUBTRACT': lambda: a - b, 'MULTIPLY': lambda: a * b, 'DIVIDE': lambda: a / b if b != 0 else 0.0,
        'MULTIPLY_ADD': lambda: a * b + c, 'POWER': lambda: (a ** b) if (a >= 0 or float(b).is_integer()) and not (a == 0 and b < 0) else 0.0,
        'LOGARITHM': lambda: math.log(a) / math.log(b) if a > 0 and b > 0 and b != 1 else 0.0, 'SQRT': lambda: math.sqrt(a) if a > 0 else 0.0,
        'INVERSE_SQRT': lambda: 1 / math.sqrt(a) if a > 0 else 0.0, 'ABSOLUTE': lambda: abs(a), 'EXPONENT': lambda: math.exp(a),
        'MINIMUM': lambda: min(a, b), 'MAXIMUM': lambda: max(a, b), 'LESS_THAN': lambda: 1.0 if a < b else 0.0,
        'GREATER_THAN': lambda: 1.0 if a > b else 0.0, 'SIGN': lambda: (a > 0) - (a < 0), 'COMPARE': lambda: 1.0 if abs(a - b) <= max(c, 1e-5) else 0.0,
        'SMOOTH_MIN': None, 'SMOOTH_MAX': None, 'ROUND': lambda: math.floor(a + 0.5), 'FLOOR': lambda: math.floor(a), 'CEIL': lambda: math.ceil(a),
        'TRUNC': lambda: float(math.trunc(a)), 'FRACT': lambda: a - math.floor(a), 'MODULO': lambda: math.fmod(a, b) if b != 0 else 0.0,
        'FLOORED_MODULO': lambda: a - math.floor(a / b) * b if b != 0 else 0.0, 'WRAP': None, 'SNAP': lambda: math.floor(a / b) * b if b != 0 else 0.0,
        'PINGPONG': None, 'SINE': lambda: math.sin(a), 'COSINE': lambda: math.cos(a), 'TANGENT': lambda: math.tan(a),
        'ARCSINE': lambda: math.asin(a) if -1 <= a <= 1 else 0.0, 'ARCCOSINE': lambda: math.acos(a) if -1 <= a <= 1 else 0.0,
        'ARCTANGENT': lambda: math.atan(a), 'ARCTAN2': lambda: math.atan2(a, b), 'SINH': lambda: math.sinh(a), 'COSH': lambda: math.cosh(a),
        'TANH': lambda: math.tanh(a), 'RADIANS': lambda: math.radians(a), 'DEGREES': lambda: math.degrees(a),
    }[op]
    if f is None: raise NotConst()
    return float(f())

def map_range(v, a, b, c, d, interp, clamp, steps):
    if a == b: return c
    t = (v - a) / (b - a)
    if interp == 'STEPPED': t = math.floor(t * (steps + 1)) / steps if steps > 0 else t
    elif interp == 'SMOOTHSTEP': t = min(1, max(0, t)); t = t * t * (3 - 2 * t)
    elif interp == 'SMOOTHERSTEP': t = min(1, max(0, t)); t = t * t * t * (t * (t * 6 - 15) + 10)
    r = c + t * (d - c)
    if clamp and interp in ('LINEAR', 'STEPPED'): r = min(max(r, min(c, d)), max(c, d))
    return r

def unalias(x):
    while isinstance(x, Alias): x = x.src
    return x

def live(G, roots):
    """Non-constant nodes the roots depend on, in dependency order."""
    order, seen = [], set()
    def visit(ref):
        ref = unalias(ref)
        if not isinstance(ref, Ref) or ref.node in seen: return
        seen.add(ref.node)
        n = G.nodes[ref.node]
        for s in n['inputs']:
            if not s.get('enabled', True): continue
            src = unalias(G.source(ref.node, s['id']))
            # a switch-like node that folded to an alias is never a real dependency
            visit(src)
        order.append(ref.node)
    for r in roots: visit(r)
    return order

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dump'); ap.add_argument('--width', type=int, default=854); ap.add_argument('--height', type=int, default=480)
    ap.add_argument('--show', action='store_true')
    a = ap.parse_args()
    d = json.load(open(a.dump))
    G = Graph(d, a.width, a.height)
    G.add_tree(d['compositor'], '')
    out = next(n['name'] for n in d['compositor']['nodes'] if n['type'] == 'NodeGroupOutput')
    root = unalias(G.source(out, d['compositor']['nodes'][[n['name'] for n in d['compositor']['nodes']].index(out)]['inputs'][0]['id']))
    order = live(G, [root])
    import collections
    by_stage = collections.Counter(nid.split('/')[0] for nid in order)
    print('live nodes', len(order), dict(by_stage))
    print('types', dict(collections.Counter(G.nodes[nid]['type'] for nid in order).most_common()))
    if a.show:
        for nid in order:
            n = G.nodes[nid]
            ins = []
            for s in n['inputs']:
                if not s.get('enabled', True): continue
                src = unalias(G.source(nid, s['id']))
                ins.append(f"{s['name']}={src.v if isinstance(src, Const) else src}")
            P = {k: v for k, v in n['props'].items() if k in ('operation', 'blend_type', 'data_type', 'interpolation_type', 'clamp', 'use_clamp', 'mode', 'ycc_mode', 'filter_type', 'space', 'frame_method', 'type', 'from_color_space', 'to_color_space', 'reference_dimension', 'interpolation', 'clamp_factor', 'clamp_result', 'factor_mode', 'noise_dimensions', 'normalize', 'feature', 'distance', 'voronoi_dimensions')}
            print(f"{nid}  [{n['type']}] {P}")
            print('      ' + '; '.join(ins))
    return G, order

if __name__ == '__main__':
    main()
