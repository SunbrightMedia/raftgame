"""Blender 5.3's pixel compile units, for compeval: which pixel nodes run together, and on which domain.

Blender's compositor (source/blender/compositor/intern/scheduler.cc, node_tree_evaluator.cc,
multi_function_procedure_operation.cc, operation.cc) evaluates each node tree in a fixed order (a post-order
DFS that visits the input needing the most intermediate buffers first). Consecutive pixel nodes of equal domain
size and transformation form one compile unit. The whole unit runs on one domain: that of its external input
with the lowest domain priority, ties going to the first in blender::Map iteration order of the unit's inputs
("input0", "input1", ... by first use). The domain carries the realization options (interpolation, extension),
so a unit can realize its values differently from what each node alone would pick. That only shows at the
image borders. Our own code, written from reading Blender's GPL source (no code copied).
"""
import numpy as np

PIXEL_TYPES = {
    'ShaderNodeMath', 'ShaderNodeMix', 'ShaderNodeMapRange', 'ShaderNodeClamp', 'ShaderNodeGamma',
    'ShaderNodeFloatCurve', 'ShaderNodeSeparateXYZ', 'ShaderNodeCombineXYZ', 'ShaderNodeVectorMath',
    'ShaderNodeVectorRotate', 'ShaderNodeTexWhiteNoise', 'ShaderNodeTexVoronoi', 'ShaderNodeTexNoise',
    'ShaderNodeValue', 'CompositorNodeSeparateColor', 'CompositorNodeCombineColor', 'CompositorNodeHueCorrect',
    'CompositorNodeCurveRGB', 'CompositorNodeBrightContrast', 'CompositorNodeHueSat', 'CompositorNodeSetAlpha',
    'FunctionNodeCompare', 'FunctionNodeBooleanMath', 'FunctionNodeIntegerMath', 'FunctionNodeRandomValue',
    'FunctionNodeHashValue', 'FunctionNodeInputInt',
}
SWITCHES = {'GeometryNodeSwitch', 'GeometryNodeMenuSwitch', 'GeometryNodeIndexSwitch'}
M64 = (1 << 64) - 1


def is_pixel(n):
    return n['type'] in PIXEL_TYPES


def domain_priority(n, k, s):
    """input_descriptor_from_input_socket: the declared compositor_domain_priority, else the socket index."""
    t, sid = n['type'], s['id']
    if t == 'ShaderNodeMix':
        if sid.startswith('Factor'): return 2
        if sid.startswith('A'): return 0
        if sid.startswith('B'): return 1
    if t == 'ShaderNodeFloatCurve':
        return {'Factor': 1, 'Value': 0}.get(s['name'], k)
    return k


# ---------------------------------------------------------------- blender::Map iteration order

def _hash_string(s):
    h = 5381
    for c in s.encode():
        h = (h * 33 + c) & M64
    return h


def _probe(h, mask, slots):
    cur, perturb = h, h
    while True:
        i = cur & mask
        if slots[i] is None:
            return i
        perturb >>= 5
        cur = (5 * cur + 1 + perturb) & M64


def map_order(keys, inline_slots=8):
    """Iteration order of a blender::Map<std::string, ...> after add_new of `keys` in order (load factor 1/2,
    PythonProbingStrategy, inline buffer of 4 elements = 8 slots, growth by realloc_and_reinsert)."""
    slots, usable, size = [None], 0, 0
    for k in keys:
        if size >= usable:
            min_usable = max(size + 1, size * 2)
            total = 1
            while total < -(-min_usable * 2 // 1):
                total *= 2
            total = max(total, inline_slots)
            new = [None] * total
            for s in slots:
                if s is not None:
                    new[_probe(_hash_string(s), total - 1, new)] = s
            slots, usable = new, total // 2
        slots[_probe(_hash_string(k), len(slots) - 1, slots)] = k
        size += 1
    return [s for s in slots if s is not None]


# ---------------------------------------------------------------- one node tree instance

class TreeView:
    """A node tree as one NodeTreeEvaluator sees it: its own nodes (group nodes are single nodes; reroutes are
    followed), Blender's schedule of them, and its pixel compile units."""

    def __init__(self, ev, prefix):
        self.ev, self.G, self.prefix = ev, ev.G, prefix
        self.group_node = prefix[:-1] if prefix else None
        own = lambda nid: nid.startswith(prefix) and '/' not in nid[len(prefix):]
        self.nodes = [nid for nid in self.G.nodes if own(nid) and self.G.nodes[nid]['type'] not in ('NodeFrame', 'NodeReroute')]
        self.node_set = set(self.nodes)
        # consumers of each output, through reroutes: (node, out) -> [(node, in)]
        self.consumers = {}
        for (to, ts), _ in self.G.links.items():
            if to in self.node_set:
                src = self.linked_output(to, ts)
                if src is not None:
                    self.consumers.setdefault(src, []).append((to, ts))
        self.unneeded = set()
        self.units = {}      # node id -> unit record
        self.done = False

    # -- topology
    def linked_output(self, nid, sid):
        key = (nid, sid)
        seen = 0
        while key in self.G.links:
            src, out = self.G.links[key]
            n = self.G.nodes[src]
            if n['type'] == 'NodeReroute':
                key = (src, n['inputs'][0]['id']); seen += 1
                if seen > 10000: raise RuntimeError('reroute loop')
                continue
            if n.get('mute'):
                raise NotImplementedError('muted node ' + src)
            return src, out
        return None

    def inputs(self, nid):
        return [(k, s) for k, s in enumerate(self.G.nodes[nid]['inputs']) if s.get('enabled', True)]

    def outputs(self, nid):
        return [o for o in self.G.nodes[nid]['outputs'] if o.get('enabled', True)]

    # -- is_input_needed (switches with a condition known before evaluation; the group output's used outputs)
    def _static_value(self, nid, sid):
        """get_input_socket_value: the condition's value if Blender knows it when scheduling, else None."""
        s = self.G.input_socket(nid, sid)
        src = self.linked_output(nid, sid)
        if src is None:
            return ('const', s.get('value'))
        sn = self.G.nodes[src[0]]
        if sn['type'] == 'GeometryNodeIsViewport':
            return ('const', False)
        if sn['type'] == 'NodeGroupInput' and self.group_node is not None:
            out = next(o for o in sn['outputs'] if o['id'] == src[1])
            if out.get('type') != s.get('type'):
                return None
            r = self.ev.input(self.group_node, src[1])
            return ('result', r)
        return None

    def is_input_needed(self, nid, k, s):
        n = self.G.nodes[nid]
        t = n['type']
        if t == 'NodeGroupOutput':
            if self.group_node is None:
                return True
            # the group node's output is used in the parent tree
            parent = self.ev.tree_views[self.group_node.rsplit('/', 1)[0] + '/' if '/' in self.group_node else '']
            return bool(parent.consumers.get((self.group_node, s['id'])))
        if t in SWITCHES:
            cond_id = {'GeometryNodeSwitch': 'Switch', 'GeometryNodeMenuSwitch': 'Menu', 'GeometryNodeIndexSwitch': 'Index'}[t]
            cond = next((x for x in n['inputs'] if x['name'] == cond_id or x['id'] == cond_id), None)
            if cond is None or s['id'] == cond['id']:
                return True
            v = self._static_value(nid, cond['id'])
            if v is None:
                return True
            return self._pick(n, cond, v) == s['id']
        return True

    def _pick(self, n, cond, v):
        """The input a switch passes on, for a condition value known before evaluation."""
        import compeval as C
        r = v[1] if v[0] == 'result' else C.Res.value(C.sock_type(cond), v[1])
        t, items = n['type'], [x for x in n['inputs'] if x['id'] != cond['id']]
        if t == 'GeometryNodeSwitch':
            b = C.convert(r, 'bool')
            on = bool(b.data[0]) if b.single else False      # an image condition: Blender reads its default
            g = {x['name']: x['id'] for x in n['inputs']}
            return g['True'] if on else g['False']
        if t == 'GeometryNodeIndexSwitch':
            i = C.convert(r, 'int')
            k = int(i.data[0]) if i.single else 0
            return items[k]['id'] if 0 <= k < len(items) else None
        names = [e['name'] for e in (n.get('enum_items') or [])]
        m = r.data if r.type == 'menu' else None
        idx = names.index(m) if m in names else next((k for k, x in enumerate(items) if x['name'] == m), None)
        return items[idx]['id'] if idx is not None else None

    def needed_inputs(self, nid):
        out = []
        for k, s in self.inputs(nid):
            if self.is_input_needed(nid, k, s):
                out.append((k, s))
            else:
                self.unneeded.add((nid, s['id']))
        return out

    # -- the schedule
    def output_nodes(self):
        gos = [nid for nid in self.nodes if self.G.nodes[nid]['type'] == 'NodeGroupOutput']
        if self.group_node is not None:
            go = self.G.group_out.get(self.group_node)
            gos = [go] if go else []
        else:
            gos = [g for g in gos if self.G.nodes[g].get('active_output', True) is not False][:1]
        out = []
        for g in gos:
            if any(self.is_input_needed(g, k, s) for k, s in self.inputs(g)):
                out.append(g)
        return out

    def _deps(self, nid):
        out = []
        for k, s in self.needed_inputs(nid):
            src = self.linked_output(nid, s['id'])
            if src is not None and src[0] in self.node_set and src[0] not in out:
                out.append(src[0])
        return out

    def needed_buffers(self, roots):
        need, stack = {}, list(roots)
        while stack:
            nid = stack[-1]
            pushed = []
            for src in self._deps(nid):
                if src in need or src in pushed:
                    continue
                stack.append(src); pushed.append(src)
            if pushed:
                continue
            stack.pop()
            n_in, d = 0, 0
            for k, s in self.needed_inputs(nid):
                src = self.linked_output(nid, s['id'])
                if src is None or src[0] not in self.node_set:
                    continue
                if not is_pixel(self.G.nodes[nid]) or not is_pixel(self.G.nodes[src[0]]):
                    n_in += 1
                d = max(d, need[src[0]])
            n_out = 0
            for o in self.outputs(nid):
                cons = self.consumers.get((nid, o['id']), [])
                if not cons:
                    continue
                if not is_pixel(self.G.nodes[nid]) or any(not is_pixel(self.G.nodes[c]) for c, _ in cons):
                    n_out += 1
            need.setdefault(nid, max(n_in + n_out, d))
        return need

    def schedule(self):
        roots = self.output_nodes()
        need = self.needed_buffers(roots)
        stack, sched, done = list(roots), [], set()
        while stack:
            nid = stack[-1]
            deps = [x for x in self._deps(nid) if x not in done]
            deps.sort(key=lambda x: need[x])          # stable: ascending, so the largest is popped first
            stack.extend(deps)
            if not deps:
                x = stack.pop()
                if x not in done:
                    done.add(x); sched.append(x)
        return sched

    # -- compile units
    def _source_result(self, nid, sid):
        return self.ev.input(nid, sid)

    def _node_single(self, nid, unit, unit_single):
        for k, s in self.inputs(nid):
            src = self.linked_output(nid, s['id'])
            if src is None:
                continue
            if src[0] in unit:
                if unit_single:
                    continue
                return False
            if not self._source_result(nid, s['id']).single:
                return False
        return True

    def _node_domain(self, nid, unit, unit_domain):
        """compute_pixel_node_domain: (Domain or None, from inputs outside the unit or the unit's own)."""
        best, bp = None, 1 << 30
        n = self.G.nodes[nid]
        for k, s in self.inputs(nid):
            src = self.linked_output(nid, s['id'])
            if src is None:
                continue
            p = domain_priority(n, k, s)
            if src[0] in unit:
                if p < bp:
                    best, bp = unit_domain, p
                continue
            r = self._source_result(nid, s['id'])
            if r.single or s.get('type') == 'MENU' or r.type == 'menu':
                continue
            if p < bp:
                best, bp = r.domain, p
        return best

    def drive(self):
        """NodeTreeEvaluator::evaluate: nodes in schedule order; pixel nodes gather into units, any other node
        closes the unit and is evaluated (a group node runs its own tree)."""
        sched = self.schedule()
        self.schedule_list = sched
        unit, single, udom = [], None, None

        def flush():
            nonlocal unit, single, udom
            if unit:
                self._close(unit, single)
            unit, single, udom = [], None, None
        for nid in sched:
            n = self.G.nodes[nid]
            if unit:
                if not is_pixel(n):
                    flush()
                else:
                    s1 = self._node_single(nid, unit, single)
                    if s1 != single:
                        flush()
                    elif not single and not _same_geometry(self._node_domain(nid, unit, udom), udom):
                        flush()
            if is_pixel(n):
                unit.append(nid)
                if len(unit) == 1:
                    single = self._node_single(nid, [], None)
                    udom = None if single else self._node_domain(nid, [], None)
                continue
            t = n['type']
            if t == 'CompositorNodeGroup':
                self.ev.run_tree(nid + '/')
            elif t not in ('NodeGroupInput', 'NodeGroupOutput') and n['outputs']:
                self.ev.output(nid, n['outputs'][0]['id'])
        flush()

    def _close(self, unit, single):
        rec = {'nodes': list(unit), 'single': single, 'domain': None, 'inputs': []}
        if not single:
            decl, prio, members = {}, {}, set(unit)
            for nid in unit:
                n = self.G.nodes[nid]
                for k, s in self.inputs(nid):
                    if (nid, s['id']) in self.unneeded:
                        continue
                    src = self.linked_output(nid, s['id'])
                    if src is None or src[0] in members:
                        continue
                    r = self._source_result(nid, s['id'])
                    if r.single:
                        continue
                    p = domain_priority(n, k, s)
                    if src not in decl:
                        ident = 'input%d' % len(decl)
                        decl[src] = (ident, nid, s['id'])
                        prio[ident] = p
                    else:
                        ident = decl[src][0]
                        prio[ident] = min(prio[ident], p)
            by_ident = {v[0]: v for v in decl.values()}
            best, bp = None, 1 << 30
            for ident in map_order(list(by_ident)):
                _, nid, sid = by_ident[ident]
                s = self.G.input_socket(nid, sid)
                r = self._source_result(nid, sid)
                if r.single or r.type == 'menu' or s.get('type') == 'MENU':
                    continue
                if prio[ident] < bp:
                    best, bp = r.domain, prio[ident]
            rec['domain'] = best
            rec['inputs'] = [(v[0], v[1], v[2], prio[v[0]]) for v in decl.values()]
        for nid in unit:
            self.units[nid] = rec
            self.ev.unit_of[nid] = rec


def _same_geometry(a, b):
    """Domain operator== (realization options not compared)."""
    if a is None or b is None:
        return a is b
    return a.size == b.size and a.display == b.display and a.offset == b.offset and np.array_equal(a.T, b.T)
