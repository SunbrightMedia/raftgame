#!/usr/bin/env python3
"""
dxbc.py: runs DXBC shader code, as RenderDoc disassembles it, on numpy arrays.

It is the reference for our own re-written versions of The Complex's camera and lamp steps (tools/complex/): the
game's compiled step and ours run on the same inputs, and the numbers are compared. Study only: it reads the
user's own capture (branch complex-capture); nothing of the game goes into the game.

Model. Every invocation (a pixel, a compute thread) is a lane. All lanes run in lockstep, one instruction at a
time, with an execution mask for if/else, loops, switch, return and discard (DXBC flow is structured). Registers
hold 32-bit patterns (uint32); each opcode reads them as float, int or uint, as DXBC does. Float maths is float32:
add, mul, div round once each; mad and the dot products round once per fused multiply-add, as GPUs run them
(Machine(fused=False) rounds every product). Denormal floats flush to zero. Transcendentals (log, exp, rsq,
sincos) use numpy's accurate float32 functions, which can differ from a GPU's in the last bits.

Immediates: the disassembly prints float immediates with 6 decimals (1/256 reads 0.003906). Program(text,
exact=...) can take the exact 32-bit values from the shader's own bytes (dxbc_bytes.immediates); without them,
float immediates are snapped to a nearby simple value (a fraction p/q with q <= 1024, or a power of two) when one
prints the same, and otherwise kept as printed.
"""
import math
import re
from fractions import Fraction

import numpy as np

COMP = {'x': 0, 'y': 1, 'z': 2, 'w': 3}
TRUE = np.uint32(0xFFFFFFFF)


def f2u(a):
    return np.ascontiguousarray(a, dtype=np.float32).view(np.uint32)


def u2f(a):
    return np.ascontiguousarray(a, dtype=np.uint32).view(np.float32)


def u2i(a):
    return np.ascontiguousarray(a, dtype=np.uint32).view(np.int32)


def i2u(a):
    return np.ascontiguousarray(a, dtype=np.int32).view(np.uint32)


def ftz(f):
    """Flush float32 denormals to (signed) zero."""
    f = np.asarray(f, np.float32)
    u = f.view(np.uint32)
    den = (u & 0x7F800000) == 0
    if den.any():
        u = np.where(den, u & 0x80000000, u)
        f = u.view(np.float32)
    return f


# ---------------------------------------------------------------- immediates
def _snap(text):
    """A float immediate printed with 6 decimals ("%f"): the simple value it most likely is (p/q with q <= 64, or
    a power of two) when that prints the same, else the float32 nearest the printed text. Above about 8 the
    printed text already pins the float32; below, several float32s print alike."""
    v = float(text)
    if v == 0.0:
        return np.float32(0.0)
    lo, hi = abs(v) - 0.5e-6, abs(v) + 0.5e-6
    k = round(math.log2(abs(v)))
    if abs(v) >= 1e-3 and -40 < k < 40 and lo <= 2.0 ** k <= hi:      # below 0.001 the text has too few digits
        return np.float32(math.copysign(2.0 ** k, v))
    for q in range(1, 65):
        p = round(abs(v) * q)
        if p > 0 and lo <= p / q <= hi:
            return np.float32(math.copysign(p / q, v))
    return np.float32(v)


def parse_imm(text, snap=True):
    """l(...) contents -> uint32 array of 1 or 4 values."""
    out = []
    for t in [x.strip() for x in text.split(',')]:
        if re.fullmatch(r'-?0x[0-9a-fA-F]+', t):
            out.append(np.uint32(int(t, 16) & 0xFFFFFFFF))
        elif re.fullmatch(r'-?\d+', t):
            out.append(np.uint32(int(t) & 0xFFFFFFFF))
        else:
            f = _snap(t) if snap else np.float32(float(t))
            out.append(np.float32(f).view(np.uint32))
    return np.array(out, np.uint32)


# ---------------------------------------------------------------- parsing
class Operand:
    __slots__ = ('file', 'num', 'idx', 'swz', 'neg', 'abs', 'imm', 'text')

    def __repr__(self):
        return self.text


_REG = re.compile(r'^(?P<file>vThreadIDInGroupFlattened|vThreadIDInGroup|vThreadGroupID|vThreadID|vCoverage|vPrim|'
                  r'oDepth|oMask|null|icb|cb|r|o|v|x|t|u|s|g)(?P<num>\d*)(?P<rest>.*)$')


def _split_top(s, sep=','):
    out, d, cur = [], 0, ''
    for ch in s:
        if ch in '([{':
            d += 1
        elif ch in ')]}':
            d -= 1
        if ch == sep and d == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_operand(text, snap=True):
    op = Operand()
    op.text = text
    t = text.strip()
    op.neg = op.abs = False
    if t.startswith('-'):
        op.neg, t = True, t[1:]
    if t.startswith('abs(') and t.endswith(')'):
        op.abs, t = True, t[4:-1]
    elif t.startswith('|') and t.endswith('|'):
        op.abs, t = True, t[1:-1]
    op.imm, op.idx, op.swz, op.num = None, [], None, 0
    if t.startswith('l('):
        op.file = 'l'
        op.imm = parse_imm(t[2:-1], snap)
        if len(op.imm) == 1:
            op.imm = np.repeat(op.imm, 4)
        op.swz = (0, 1, 2, 3)
        return op
    m = _REG.match(t)
    if not m:
        raise ValueError('operand: ' + text)
    op.file = m.group('file')
    op.num = int(m.group('num')) if m.group('num') else 0
    rest = m.group('rest')
    # indices: [a][b + r0.x] ...
    while rest.startswith('['):
        d, i = 0, 0
        for i, ch in enumerate(rest):
            d += ch == '['
            d -= ch == ']'
            if d == 0:
                break
        inner, rest = rest[1:i], rest[i + 1:]
        terms = [x.strip() for x in inner.split('+')]
        const, reg = 0, None
        for term in terms:
            if re.fullmatch(r'-?\d+', term):
                const += int(term)
            else:
                reg = parse_operand(term, snap)
        op.idx.append((const, reg))
    if op.file in ('cb', 'icb', 'x') and op.idx:
        pass
    if rest.startswith('.'):
        letters = rest[1:]
        op.swz = tuple(COMP[c] for c in letters)
    return op


class Instr:
    __slots__ = ('op', 'base', 'sat', 'args', 'res', 'stride', 'line', 'text', 'ret_type', 'tgt')

    def __repr__(self):
        return self.text


_OPC = re.compile(r'^(?P<name>[a-z0-9_]+)(?P<paren>(\([^)]*\))*)(?P<suffix>_uint|_rcpfloat)?$')


def parse_instr(line, snap=True):
    m = re.match(r'^\s*(\d+):\s*(.*)$', line)
    num, body = int(m.group(1)), m.group(2).strip()
    body = re.sub(r'\s*\[precise(\([^)]*\))?\]\s*', ' ', body).strip()   # "precise" only bars reordering
    # opcode: up to the first space outside parentheses
    d, cut = 0, len(body)
    for i, ch in enumerate(body):
        if ch == '(':
            d += 1
        elif ch == ')':
            d -= 1
        elif ch == ' ' and d == 0:
            cut = i
            break
    opc, rest = body[:cut], body[cut:].strip()
    ins = Instr()
    ins.line, ins.text = num, body
    mm = _OPC.match(opc)
    if not mm:
        raise ValueError('opcode: ' + opc)
    name = mm.group('name')
    ins.ret_type = mm.group('suffix') or ''
    ins.sat = False
    if name.endswith('_sat'):
        ins.sat, name = True, name[:-4]
    paren = re.findall(r'\(([^)]*)\)', mm.group('paren') or '')
    ins.res, ins.stride = None, None
    for p in paren:
        if p.startswith(('texture', 'buffer', 'structured_buffer', 'raw_buffer')):
            ins.res = p.split(',')[0].strip()
            sm = re.search(r'stride=(\d+)', p)
            if sm:
                ins.stride = int(sm.group(1))
    base = name
    for suf in ('_indexable',):
        if base.endswith(suf):
            base = base[:-len(suf)]
    ins.op, ins.base = name, base
    ins.args = [parse_operand(a, snap) for a in _split_top(rest)] if rest else []
    ins.tgt = None
    return ins


class Program:
    """A parsed shader: declarations and instructions from RenderDoc's DXBC disassembly text."""

    def __init__(self, text, snap=True, exact=None):
        if 'disassembly: DXBC' in text:
            text = text[text.index('disassembly: DXBC'):]
            if 'disassembly: AMD' in text:
                text = text[:text.index('disassembly: AMD')]
        self.stage = None
        self.temps = 0
        self.indexable = {}      # x# -> (size, comps)
        self.tgsm = {}           # g# -> ('structured', stride, count) | ('raw', bytes)
        self.group = (1, 1, 1)
        self.inputs, self.outputs, self.cbs = [], [], {}
        self.resources, self.uavs, self.samplers = {}, {}, {}
        self.icb = None
        self.code = []
        lines = text.split('\n')
        i = 0
        while i < len(lines):
            ln = lines[i].rstrip()
            s = ln.strip()
            i += 1
            if not s:
                continue
            if re.match(r'^(ps|vs|cs|gs|hs|ds)_\d_\d$', s):
                self.stage = s[:2]
                continue
            if s.startswith('dcl_immediateConstantBuffer'):
                body = s
                while body.count('{') > body.count('}') and i < len(lines):
                    body += lines[i].strip()
                    i += 1
                rows = re.findall(r'\{([^{}]*)\}', body)
                self.icb = np.array([parse_imm(r, snap) for r in rows], np.uint32)
                continue
            if s.startswith('dcl_'):
                self._decl(s)
                continue
            if re.match(r'^\d+:', s):
                self.code.append(parse_instr(s, snap))
        if exact is not None:
            self.apply_exact(exact)
        self._link()

    def _decl(self, s):
        if s.startswith('dcl_temps'):
            self.temps = int(s.split()[1])
        elif s.startswith('dcl_indexableTemp'):
            m = re.search(r'x(\d+)\[(\d+)\],\s*(\d+)', s)
            self.indexable[int(m.group(1))] = (int(m.group(2)), int(m.group(3)))
        elif s.startswith('dcl_tgsm_structured'):
            m = re.search(r'g(\d+),\s*(\d+),\s*(\d+)', s)
            self.tgsm[int(m.group(1))] = ('structured', int(m.group(2)), int(m.group(3)))
        elif s.startswith('dcl_tgsm_raw'):
            m = re.search(r'g(\d+),\s*(\d+)', s)
            self.tgsm[int(m.group(1))] = ('raw', int(m.group(2)))
        elif s.startswith('dcl_thread_group'):
            self.group = tuple(int(x) for x in re.findall(r'\d+', s.split(None, 1)[1]))
        elif s.startswith('dcl_constantbuffer'):
            m = re.search(r'cb(\d+)\[(\d+)\]', s)
            self.cbs[int(m.group(1))] = int(m.group(2))
        elif s.startswith(('dcl_resource', 'dcl_uav')):
            m = re.search(r'\b([tu])(\d+)(?:,\s*(\d+))?(?:,\s*[A-Za-z]+)?\s*$', s)
            kind = s.split()[0]
            rec = {'kind': kind, 'stride': int(m.group(3)) if m.group(3) else None}
            (self.resources if m.group(1) == 't' else self.uavs)[int(m.group(2))] = rec
        elif s.startswith('dcl_sampler'):
            m = re.search(r's(\d+)', s)
            self.samplers[int(m.group(1))] = s
        elif s.startswith('dcl_input'):
            self.inputs.append(s)
        elif s.startswith('dcl_output'):
            self.outputs.append(s)

    def immediates(self):
        """(instruction index, operand index, component) of every immediate, in program order."""
        out = []
        for k, ins in enumerate(self.code):
            for j, a in enumerate(ins.args):
                if a.file == 'l':
                    out.append((k, j))
        return out

    def apply_exact(self, exact):
        """exact: {(instruction index, operand index): uint32[4]} from the shader's bytes."""
        for (k, j), vals in exact.items():
            a = self.code[k].args[j]
            v = np.asarray(vals, np.uint32)
            a.imm = np.repeat(v, 4) if len(v) == 1 else v

    def _link(self):
        """Match if/else/endif, loop/endloop, switch/case/endswitch."""
        stack = []
        for k, ins in enumerate(self.code):
            b = ins.base
            if b in ('if_nz', 'if_z', 'loop', 'switch'):
                stack.append((b, k, []))
            elif b == 'else':
                stack[-1][2].append(k)
            elif b in ('case', 'default'):
                stack[-1][2].append(k)
            elif b in ('endif', 'endloop', 'endswitch'):
                kind, start, mids = stack.pop()
                self.code[start].tgt = (mids, k)
                for mk in mids:
                    self.code[mk].tgt = (start, k)
                ins.tgt = (start, mids)


# ---------------------------------------------------------------- resources
def addr(i, n, mode):
    if mode == 'wrap':
        return np.mod(i, n), np.ones_like(i, bool)
    if mode == 'mirror':
        p = np.mod(i, 2 * n)
        return np.where(p < n, p, 2 * n - 1 - p), np.ones_like(i, bool)
    if mode == 'border':
        ok = (i >= 0) & (i < n)
        return np.clip(i, 0, n - 1), ok
    return np.clip(i, 0, n - 1), np.ones_like(i, bool)   # clamp


class Sampler:
    def __init__(self, filt='linear', address=('clamp', 'clamp', 'clamp'), border=(0, 0, 0, 0), mip='linear', weight_bits=None):
        self.filter, self.address, self.border, self.mip = filt, tuple(address), np.array(border, np.float32), mip
        self.weight_bits = weight_bits   # e.g. 8: hardware bilinear weights in steps of 1/256


class Texture:
    """A float texture: levels[0] has shape (H, W, 4) for 2D, (D, H, W, 4) for 3D. Values are float32 (or uint32
    patterns for integer textures, int=True). fmt: what stores to it round to (see quantize)."""

    def __init__(self, levels, dim=2, fmt=None, int_=False):
        if not isinstance(levels, (list, tuple)):
            levels = [levels]
        self.levels = [np.array(l, np.uint32 if int_ else np.float32) for l in levels]
        self.dim, self.fmt, self.int = dim, fmt, int_

    def size(self, lvl=0):
        sh = self.levels[min(lvl, len(self.levels) - 1)].shape
        return sh[:-1][::-1]   # (W, H) or (W, H, D)

    def fetch(self, lvl, ix, iy, iz=None):
        L = self.levels[lvl]
        if self.dim == 3:
            return L[iz, iy, ix]
        return L[iy, ix]


class Buffer:
    """Raw / structured / typed buffer: bytes as uint32 words. comps: words per element of a typed buffer."""

    def __init__(self, words, stride=None, comps=4):
        self.words = np.array(words, np.uint32).ravel()
        self.stride, self.comps = stride, comps


def quantize(v, fmt):
    """Round float32 RGBA to what a render target of this format stores."""
    if fmt is None:
        return v
    v = np.asarray(v, np.float32)
    if fmt in ('R16G16B16A16_FLOAT', 'R16G16_FLOAT', 'R16_FLOAT'):
        return v.astype(np.float16).astype(np.float32)
    if fmt == 'R11G11B10_FLOAT':
        out = v.copy()
        out[..., 0] = small_float(v[..., 0], 6)
        out[..., 1] = small_float(v[..., 1], 6)
        out[..., 2] = small_float(v[..., 2], 5)
        out[..., 3] = 1.0
        return out
    m = re.match(r'R(\d+)G(\d+)B(\d+)A(\d+)_UNORM', fmt)
    if m:
        bits = [int(x) for x in m.groups()]
        out = v.copy()
        for c, b in enumerate(bits):
            q = float(2 ** b - 1)
            out[..., c] = np.rint(np.clip(np.nan_to_num(v[..., c]), 0, 1) * q) / q
        return out
    if fmt == 'R32G32B32A32_FLOAT' or fmt.startswith('R32'):
        return v
    raise ValueError('format ' + fmt)


def small_float(x, mant):
    """Unsigned float with 5 exponent bits and `mant` mantissa bits (R11G11B10): round to nearest even,
    negatives to 0, overflow to the largest value (D3D's float-to-small-float conversion)."""
    x = np.nan_to_num(np.asarray(x, np.float64), nan=0.0, posinf=6.5e4, neginf=0.0)
    x = np.maximum(x, 0.0)
    e = np.floor(np.log2(np.maximum(x, 2.0 ** -40)))
    e = np.maximum(e, -14.0)                      # denormal range: fixed step 2^(-14-mant)
    step = 2.0 ** (e - mant)
    q = np.rint(x / step) * step                  # numpy rint: ties to even
    big = (2 - 2.0 ** -mant) * 2.0 ** 15
    return np.minimum(q, big).astype(np.float32)


# ---------------------------------------------------------------- the machine
class Machine:
    def __init__(self, prog, n, fused=True, flush=True, quads=None, exact_math=False):
        """exact_math: log, exp, rsq, rcp, sincos rounded once from a double-precision result (as our own
        re-written code computes them), instead of numpy's float32 routines (which, like GPUs, can be off in the
        last bit). Separates "same maths" from "same last bit of exp2/log2"."""
        self.p, self.n, self.fused, self.flush = prog, n, fused, flush
        self.exact_math = exact_math
        self.R = {}
        self.O = {}
        self.V = {}
        self.X = {k: np.zeros((n, size, 4), np.uint32) for k, (size, _) in prog.indexable.items()}
        self.cb = {}
        self.t, self.u, self.s = {}, {}, {}
        self.G = {}
        self.group_of = np.zeros(n, np.int64)
        self.sysvals = {}
        self.quads = quads          # (H, W) when lanes are a row-major image (for derivatives and implicit LOD)
        self.killed = np.zeros(n, bool)

    # -- registers
    def reg(self, file, num):
        d = {'r': self.R, 'o': self.O, 'v': self.V}[file]
        if num not in d:
            d[num] = np.zeros((self.n, 4), np.uint32)
        return d[num]

    def index_value(self, idx_terms):
        out = []
        for const, reg in idx_terms:
            if reg is None:
                out.append(np.full(self.n, const, np.int64))
            else:
                v = self.read(reg, 'u')[:, 0].astype(np.int64)
                out.append(v + const)
        return out

    def read_raw(self, a):
        """Operand -> (n, 4) uint32, swizzled, no modifiers."""
        f = a.file
        if f == 'l':
            v = np.broadcast_to(a.imm, (self.n, 4))
        elif f in ('r', 'o', 'v'):
            v = self.reg(f, a.num)
        elif f == 'x':
            (k,) = self.index_value(a.idx)
            k = np.clip(k, 0, self.X[a.num].shape[1] - 1)
            v = self.X[a.num][np.arange(self.n), k]
        elif f == 'cb':
            cb = self.cb[a.num]
            (k,) = self.index_value(a.idx)
            k = np.clip(k, 0, len(cb) - 1)
            v = cb[k]
        elif f == 'icb':
            (k,) = self.index_value(a.idx)
            v = self.p.icb[np.clip(k, 0, len(self.p.icb) - 1)]
        elif f in self.sysvals:
            v = self.sysvals[f]
        else:
            raise ValueError('read ' + a.text)
        sw = a.swz if a.swz else (0, 1, 2, 3)
        if len(sw) == 1:
            sw = sw * 4
        elif len(sw) < 4:
            sw = sw + (sw[-1],) * (4 - len(sw))
        return v[:, list(sw)]

    def read(self, a, ty):
        v = self.read_raw(a)
        if ty == 'f':
            if a.abs:
                v = v & np.uint32(0x7FFFFFFF)
            if a.neg:
                v = v ^ np.uint32(0x80000000)
            if self.flush:
                v = f2u(ftz(u2f(v)))
            return v
        if a.neg:
            v = i2u(-u2i(v))
        if a.abs:
            v = i2u(np.abs(u2i(v)))
        return v

    def readf(self, a):
        return u2f(self.read(a, 'f')).astype(np.float32)

    def write(self, a, val, mask, sat=False, is_float=False):
        """val: (n, 4) uint32 (or float32, converted). Writes the dst mask's components for lanes in mask."""
        if a.file == 'null':
            return
        if val.dtype != np.uint32:
            val = f2u(val.astype(np.float32))
        if is_float:
            fv = u2f(val)
            if self.flush:
                fv = ftz(fv)
            if sat:
                fv = np.where(np.isnan(fv), np.float32(0), np.clip(fv, 0, 1)).astype(np.float32)
            val = f2u(fv)
        comps = a.swz if a.swz else (0, 1, 2, 3)
        m = mask & ~self.killed
        if a.file == 'x':
            (k,) = self.index_value(a.idx)
            dst = self.X[a.num]
            lanes = np.nonzero(m)[0]
            for c in comps:
                dst[lanes, k[lanes], c] = val[lanes, c]
            return
        dst = self.reg(a.file, a.num)
        for c in comps:
            dst[m, c] = val[m, c]

    # -- float helpers
    def fma(self, a, b, c):
        if self.fused:
            r = (a.astype(np.float64) * b.astype(np.float64) + c.astype(np.float64)).astype(np.float32)
        else:
            r = (a * b).astype(np.float32) + c
        return r.astype(np.float32)

    # -- running
    def run(self, max_steps=50_000_000, trace=None):
        """trace: {instruction index: callback(machine)}, called after that instruction runs (debugging)."""
        code = self.p.code
        n = self.n
        exec_mask = ~self.killed.copy()
        returned = np.zeros(n, bool)
        ifs = []        # (mask_before, cond)
        loops = []      # dict(start, mask_before, broken, cont, ifdepth)
        switches = []   # dict(value, mask_before, matched, broken, ifdepth)
        pc, steps = 0, 0
        brk_stack = []  # 'loop' / 'switch', innermost last

        def alive():
            m = ~returned & ~self.killed
            for L in loops:
                m &= ~L['broken'] & ~L['cont']
            for S in switches:
                m &= ~S['broken']
            return m

        while pc < len(code):
            steps += 1
            if steps > max_steps:
                raise RuntimeError('too many steps')
            ins = code[pc]
            b = ins.base
            if b in ('if_nz', 'if_z'):
                c = self.read(ins.args[0], 'u')[:, 0] != 0
                if b == 'if_z':
                    c = ~c
                ifs.append((exec_mask.copy(), c))
                exec_mask = exec_mask & c
                if not exec_mask.any():
                    mids, end = ins.tgt
                    pc = mids[0] if mids else end
                    continue
            elif b == 'else':
                before, c = ifs[-1]
                exec_mask = before & ~c & alive()
                if not exec_mask.any():
                    pc = ins.tgt[1]
                    continue
            elif b == 'endif':
                before, c = ifs.pop()
                exec_mask = before & alive()
            elif b == 'loop':
                loops.append({'start': pc, 'before': exec_mask.copy(), 'broken': np.zeros(n, bool),
                              'cont': np.zeros(n, bool), 'ifdepth': len(ifs)})
                brk_stack.append('loop')
            elif b == 'endloop':
                L = loops[-1]
                L['cont'][:] = False
                nxt = L['before'] & ~L['broken'] & ~returned & ~self.killed
                if nxt.any():
                    exec_mask = nxt
                    pc = L['start'] + 1
                    continue
                loops.pop()
                brk_stack.pop()
                exec_mask = L['before'] & ~returned & ~self.killed
            elif b in ('break', 'breakc_nz', 'breakc_z'):
                m = exec_mask.copy()
                if b != 'break':
                    c = self.read(ins.args[0], 'u')[:, 0] != 0
                    m &= c if b == 'breakc_nz' else ~c
                if brk_stack[-1] == 'loop':
                    loops[-1]['broken'] |= m
                else:
                    switches[-1]['broken'] |= m
                exec_mask &= ~m
            elif b in ('continue', 'continuec_nz', 'continuec_z'):
                m = exec_mask.copy()
                if b != 'continue':
                    c = self.read(ins.args[0], 'u')[:, 0] != 0
                    m &= c if b == 'continuec_nz' else ~c
                loops[-1]['cont'] |= m
                exec_mask &= ~m
            elif b == 'switch':
                v = self.read(ins.args[0], 'u')[:, 0]
                switches.append({'value': v, 'before': exec_mask.copy(), 'matched': np.zeros(n, bool),
                                 'broken': np.zeros(n, bool), 'start': pc})
                brk_stack.append('switch')
                labels = []
                for mk in ins.tgt[0]:
                    ci = code[mk]
                    if ci.base == 'case':
                        labels.append(int(ci.args[0].imm[0]))
                switches[-1]['labels'] = labels
                exec_mask = np.zeros(n, bool)
            elif b in ('case', 'default'):
                S = switches[-1]
                if b == 'case':
                    hit = S['before'] & (S['value'] == np.uint32(ins.args[0].imm[0])) & ~S['matched']
                else:
                    known = np.zeros(n, bool)
                    for lab in S['labels']:
                        known |= S['value'] == np.uint32(lab)
                    hit = S['before'] & ~known & ~S['matched']
                S['matched'] |= hit
                exec_mask = (exec_mask | hit) & ~S['broken'] & ~returned & ~self.killed
            elif b == 'endswitch':
                S = switches.pop()
                brk_stack.pop()
                exec_mask = S['before'] & ~returned & ~self.killed
            elif b in ('ret', 'retc_nz', 'retc_z'):
                m = exec_mask.copy()
                if b != 'ret':
                    c = self.read(ins.args[0], 'u')[:, 0] != 0
                    m &= c if b == 'retc_nz' else ~c
                returned |= m
                exec_mask &= ~m
                if not loops and not ifs and not switches and b == 'ret':
                    break
            elif b in ('discard_nz', 'discard_z'):
                c = self.read(ins.args[0], 'u')[:, 0] != 0
                m = exec_mask & (c if b == 'discard_nz' else ~c)
                self.killed |= m
                exec_mask &= ~m
            else:
                if exec_mask.any():
                    self.exec(ins, exec_mask)
            if trace and pc in trace:
                trace[pc](self)
            pc += 1
        return self

    # -- instructions
    def exec(self, ins, m):
        b, A = ins.base, ins.args
        F = self.readf
        if b in FLOAT_BIN:
            x, y = F(A[1]), F(A[2])
            with np.errstate(all='ignore'):
                r = FLOAT_BIN[b](x, y)
            self.write(A[0], r.astype(np.float32), m, ins.sat, True)
        elif b in FLOAT_UN:
            x = F(A[1])
            with np.errstate(all='ignore'):
                if self.exact_math and b in EXACT_UN:
                    r = EXACT_UN[b](x.astype(np.float64)).astype(np.float32)
                else:
                    r = FLOAT_UN[b](x)
            self.write(A[0], np.asarray(r, np.float32), m, ins.sat, True)
        elif b == 'mad':
            with np.errstate(all='ignore'):
                r = self.fma(F(A[1]), F(A[2]), F(A[3]))
            self.write(A[0], r, m, ins.sat, True)
        elif b in ('dp2', 'dp3', 'dp4'):
            k = int(b[2])
            x, y = F(A[1]), F(A[2])
            with np.errstate(all='ignore'):
                r = (x[:, 0] * y[:, 0]).astype(np.float32)
                for c in range(1, k):
                    r = self.fma(x[:, c], y[:, c], r)
            self.write(A[0], np.repeat(r[:, None], 4, 1), m, ins.sat, True)
        elif b in ('mov',):
            # mov with float modifiers when it has any; else a raw copy
            v = self.read(A[1], 'f') if (A[1].neg or A[1].abs or ins.sat) else self.read_raw(A[1])
            self.write(A[0], v, m, ins.sat, ins.sat)
        elif b == 'movc':
            c = self.read(A[1], 'u') != 0
            x = self.read(A[2], 'f') if (A[2].neg or A[2].abs) else self.read_raw(A[2])
            y = self.read(A[3], 'f') if (A[3].neg or A[3].abs) else self.read_raw(A[3])
            self.write(A[0], np.where(c, x, y).astype(np.uint32), m, ins.sat, ins.sat)
        elif b == 'swapc':
            c = self.read(A[2], 'u') != 0
            x, y = self.read_raw(A[3]), self.read_raw(A[4])
            self.write(A[0], np.where(c, y, x).astype(np.uint32), m)
            self.write(A[1], np.where(c, x, y).astype(np.uint32), m)
        elif b in FLOAT_CMP:
            x, y = F(A[1]), F(A[2])
            with np.errstate(all='ignore'):
                r = np.where(FLOAT_CMP[b](x, y), TRUE, np.uint32(0))
            self.write(A[0], r.astype(np.uint32), m)
        elif b == 'sincos':
            x = F(A[2])
            if self.exact_math:
                x = x.astype(np.float64)
            with np.errstate(all='ignore'):
                self.write(A[0], np.sin(x).astype(np.float32), m, ins.sat, True)
                self.write(A[1], np.cos(x).astype(np.float32), m, ins.sat, True)
        elif b in INT_BIN:
            x = u2i(self.read(A[1], 'i')).astype(np.int64)
            y = u2i(self.read(A[2], 'i')).astype(np.int64)
            r = INT_BIN[b](x, y)
            self.write(A[0], (r & 0xFFFFFFFF).astype(np.uint32), m)
        elif b in UINT_BIN:
            x = self.read(A[1], 'u').astype(np.uint64)
            y = self.read(A[2], 'u').astype(np.uint64)
            r = UINT_BIN[b](x, y)
            self.write(A[0], (r & 0xFFFFFFFF).astype(np.uint32), m)
        elif b == 'imad' or b == 'umad':
            x = u2i(self.read(A[1], 'i')).astype(np.int64)
            y = u2i(self.read(A[2], 'i')).astype(np.int64)
            z = u2i(self.read(A[3], 'i')).astype(np.int64)
            self.write(A[0], ((x * y + z) & 0xFFFFFFFF).astype(np.uint32), m)
        elif b in ('imul', 'umul'):
            x = self.read(A[2], 'i').astype(np.uint64)
            y = self.read(A[3], 'i').astype(np.uint64)
            if b == 'imul':
                prod = u2i(self.read(A[2], 'i')).astype(np.int64) * u2i(self.read(A[3], 'i')).astype(np.int64)
                hi = ((prod >> 32) & 0xFFFFFFFF).astype(np.uint32)
                lo = (prod & 0xFFFFFFFF).astype(np.uint32)
            else:
                prod = x * y
                hi = ((prod >> np.uint64(32)) & np.uint64(0xFFFFFFFF)).astype(np.uint32)
                lo = (prod & np.uint64(0xFFFFFFFF)).astype(np.uint32)
            self.write(A[0], hi, m)
            self.write(A[1], lo, m)
        elif b == 'udiv':
            x = self.read(A[2], 'u').astype(np.uint64)
            y = self.read(A[3], 'u').astype(np.uint64)
            z = y == 0
            ys = np.where(z, 1, y)
            q = np.where(z, 0xFFFFFFFF, x // ys).astype(np.uint32)
            r = np.where(z, 0xFFFFFFFF, x % ys).astype(np.uint32)
            self.write(A[0], q, m)
            self.write(A[1], r, m)
        elif b == 'ineg':
            self.write(A[0], i2u(-u2i(self.read(A[1], 'i'))), m)
        elif b == 'not':
            self.write(A[0], ~self.read(A[1], 'u'), m)
        elif b == 'itof':
            self.write(A[0], u2i(self.read(A[1], 'i')).astype(np.float32), m, ins.sat, True)
        elif b == 'utof':
            self.write(A[0], self.read(A[1], 'u').astype(np.float32), m, ins.sat, True)
        elif b == 'ftoi':
            x = F(A[1]).astype(np.float64)
            r = np.where(np.isnan(x), 0, np.clip(np.trunc(x), -2147483648, 2147483647)).astype(np.int64)
            self.write(A[0], (r & 0xFFFFFFFF).astype(np.uint32), m)
        elif b == 'ftou':
            x = F(A[1]).astype(np.float64)
            r = np.where(np.isnan(x), 0, np.clip(np.trunc(x), 0, 4294967295)).astype(np.uint64)
            self.write(A[0], r.astype(np.uint32), m)
        elif b in ('ubfe', 'ibfe'):
            # bits [offset, offset + width) of src (D3D: width 0 gives 0; past bit 31, the rest of src)
            w = (self.read(A[1], 'u') & 31).astype(np.int64)
            o = (self.read(A[2], 'u') & 31).astype(np.int64)
            if b == 'ubfe':
                x = self.read(A[3], 'u').astype(np.int64)
                r = (x >> o) & ((np.int64(1) << w) - 1)
            else:
                x = u2i(self.read(A[3], 'u')).astype(np.int64)
                top = np.minimum(w + o, 32)
                r = (x << (64 - top)) >> (64 - top + o)        # sign from bit (offset + width - 1), or bit 31
                r = np.where(w + o > 32, x >> o, r)
            r = np.where(w == 0, 0, r)
            self.write(A[0], (r & 0xFFFFFFFF).astype(np.uint32), m)
        elif b == 'bfi':
            w = (self.read(A[1], 'u') & 31).astype(np.uint64)
            o = (self.read(A[2], 'u') & 31).astype(np.uint64)
            src = self.read(A[3], 'u').astype(np.uint64)
            base = self.read(A[4], 'u').astype(np.uint64)
            bm = (((np.uint64(1) << w) - np.uint64(1)) << o) & np.uint64(0xFFFFFFFF)
            r = ((src << o) & bm) | (base & ~bm & np.uint64(0xFFFFFFFF))
            self.write(A[0], r.astype(np.uint32), m)
        elif b == 'bfrev':
            x = self.read(A[1], 'u')
            r = np.zeros_like(x)
            for k in range(32):
                r |= ((x >> np.uint32(k)) & np.uint32(1)) << np.uint32(31 - k)
            self.write(A[0], r, m)
        elif b == 'countbits':
            x = self.read(A[1], 'u')
            r = np.zeros_like(x)
            for k in range(32):
                r += (x >> np.uint32(k)) & np.uint32(1)
            self.write(A[0], r, m)
        elif b in ('firstbit_lo', 'firstbit_hi', 'firstbit_shi'):
            x = self.read(A[1], 'u')
            if b == 'firstbit_shi':
                xi = u2i(x)
                x = np.where(xi < 0, ~x, x)
            r = np.full(x.shape, 0xFFFFFFFF, np.uint32)
            rng = range(32) if b == 'firstbit_lo' else range(31, -1, -1)
            found = np.zeros(x.shape, bool)
            for k in rng:
                hit = ~found & (((x >> np.uint32(k)) & np.uint32(1)) != 0)
                r = np.where(hit, np.uint32(k if b == 'firstbit_lo' else 31 - k), r)
                found |= hit
            self.write(A[0], r, m)
        elif b == 'f32tof16':
            x = F(A[1])
            self.write(A[0], x.astype(np.float16).view(np.uint16).astype(np.uint32), m)
        elif b == 'f16tof32':
            x = self.read(A[1], 'u')
            self.write(A[0], (x & 0xFFFF).astype(np.uint16).view(np.float16).astype(np.float32), m, False, True)
        elif b in ('deriv_rtx', 'deriv_rtx_coarse', 'deriv_rtx_fine', 'deriv_rty', 'deriv_rty_coarse', 'deriv_rty_fine'):
            self.write(A[0], self.deriv(F(A[1]), 'x' if 'rtx' in b else 'y', 'fine' in b), m, ins.sat, True)
        elif b in ('sample', 'sample_l', 'sample_b', 'sample_d', 'sample_lz', 'sample_c', 'sample_c_lz', 'gather4', 'gather4_c'):
            self.write(A[0], self.sample(ins), m, ins.sat, True)
        elif b in ('ld', 'ld2dms'):
            self.write(A[0], self.load(ins), m)
        elif b == 'resinfo':
            self.write(A[0], self.resinfo(ins), m)
        elif b in ('ld_structured', 'ld_raw', 'ld_uav_typed'):
            self.write(A[0], self.ld_buffer(ins), m)
        elif b in ('store_structured', 'store_raw', 'store_uav_typed'):
            self.store(ins, m)
        elif b.startswith('atomic_') or b.startswith('imm_atomic_'):
            self.atomic(ins, m)
        elif b in ('sync', 'sync_g_t', 'sync_g', 'sync_ugroup', 'sync_ugroup_g', 'sync_uglobal', 'sync_uglobal_g', 'sync_ugroup_g_t',
                   'sync_uglobal_g_t', 'nop', 'label', 'customdata'):
            pass
        else:
            raise NotImplementedError('opcode %s (line %d: %s)' % (b, ins.line, ins.text))

    # -- derivatives over 2x2 quads (lanes are a row-major H x W image, W and H even)
    def deriv(self, v, axis, fine):
        H, W = self.quads
        a = v.reshape(H, W, 4)
        if axis == 'x':
            if fine:
                d = a[:, 1::2] - a[:, 0::2]
                out = np.repeat(d, 2, axis=1)
            else:
                d = a[0::2, 1::2] - a[0::2, 0::2]
                out = np.repeat(np.repeat(d, 2, axis=1), 2, axis=0)
        else:
            if fine:
                d = a[1::2, :] - a[0::2, :]
                out = np.repeat(d, 2, axis=0)
            else:
                d = a[1::2, 0::2] - a[0::2, 0::2]
                out = np.repeat(np.repeat(d, 2, axis=1), 2, axis=0)
        return out.reshape(-1, 4).astype(np.float32)

    # -- textures
    def _sampler(self, a):
        return self.s[a.num]

    def sample(self, ins):
        b, A = ins.base, ins.args
        coord = self.readf(A[1])
        tex = self.t[A[2].num]
        smp = self._sampler(A[3])
        sw = A[2].swz or (0, 1, 2, 3)
        dim = tex.dim
        lod = np.zeros(self.n, np.float32)
        if b in ('sample_l',):
            lod = self.readf(A[4])[:, 0]
        elif b in ('sample_lz', 'sample_c_lz', 'gather4', 'gather4_c'):
            lod[:] = 0
        elif b in ('sample', 'sample_b', 'sample_c', 'sample_d') and self.quads is not None and len(tex.levels) > 1:
            if b == 'sample_d':
                dx, dy = self.readf(A[4]), self.readf(A[5])
            else:
                dx, dy = self.deriv(coord, 'x', False), self.deriv(coord, 'y', False)
            size = np.array(tex.size(0), np.float32)
            k = len(size)
            lx = np.sqrt(((dx[:, :k] * size) ** 2).sum(1))
            ly = np.sqrt(((dy[:, :k] * size) ** 2).sum(1))
            with np.errstate(divide='ignore'):
                lod = np.log2(np.maximum(np.maximum(lx, ly), 1e-30)).astype(np.float32)
            if b == 'sample_b':
                lod = lod + self.readf(A[4])[:, 0]
        if b in ('gather4', 'gather4_c'):
            ch = A[3].swz[0] if A[3].swz else 0
            r = self._gather(tex, smp, coord, ch)
        else:
            r = self._filter(tex, smp, coord, lod, dim)
        return f2u(r[:, list(sw)])

    def _level_coords(self, tex, lvl, coord, dim):
        size = tex.size(lvl)
        return [coord[:, c] * np.float32(size[c]) - np.float32(0.5) for c in range(dim)], size

    def _filter(self, tex, smp, coord, lod, dim):
        nl = len(tex.levels)
        lod = np.clip(np.nan_to_num(lod), 0, nl - 1)
        if smp.mip == 'point' or nl == 1:
            l0 = np.rint(lod).astype(int) if smp.mip == 'point' else np.zeros(self.n, int)
            out = np.zeros((self.n, 4), np.float32)
            for lv in np.unique(l0):
                sel = l0 == lv
                out[sel] = self._filter_level(tex, smp, coord[sel], int(lv), dim)
            return out
        l0 = np.floor(lod).astype(int)
        fr = (lod - l0).astype(np.float32)
        out = np.zeros((self.n, 4), np.float32)
        for lv in np.unique(l0):
            sel = l0 == lv
            a = self._filter_level(tex, smp, coord[sel], int(lv), dim)
            if lv + 1 < nl:
                bq = self._filter_level(tex, smp, coord[sel], int(lv) + 1, dim)
                f = fr[sel][:, None]
                a = a + (bq - a) * f
            out[sel] = a
        return out

    def _filter_level(self, tex, smp, coord, lvl, dim):
        uv, size = self._level_coords(tex, lvl, coord, dim)
        L = tex.levels[lvl]
        n = coord.shape[0]
        if smp.filter == 'point':
            idx, ok = [], np.ones(n, bool)
            for c in range(dim):
                i, k = addr(np.floor(uv[c] + 0.5).astype(np.int64), size[c], smp.address[c])
                idx.append(i)
                ok &= k
            v = L[idx[2], idx[1], idx[0]] if dim == 3 else L[idx[1], idx[0]]
            return np.where(ok[:, None], v, smp.border).astype(np.float32)
        base = [np.floor(u) for u in uv]
        frac = [(u - bse).astype(np.float32) for u, bse in zip(uv, base)]
        if smp.weight_bits:
            q = float(2 ** smp.weight_bits)
            frac = [np.floor(f * q + 0.5) / q for f in frac]
        out = np.zeros((n, 4), np.float32)
        import itertools
        for corner in itertools.product((0, 1), repeat=dim):
            w = np.ones(n, np.float32)
            idx, ok = [], np.ones(n, bool)
            for c in range(dim):
                i, k = addr(base[c].astype(np.int64) + corner[c], size[c], smp.address[c])
                idx.append(i)
                ok &= k
                w = w * (frac[c] if corner[c] else (1 - frac[c]))
            v = L[idx[2], idx[1], idx[0]] if dim == 3 else L[idx[1], idx[0]]
            v = np.where(ok[:, None], v, smp.border)
            out = out + v * w[:, None]
        return out.astype(np.float32)

    def _gather(self, tex, smp, coord, ch):
        uv, size = self._level_coords(tex, 0, coord, 2)
        L = tex.levels[0]
        bx, by = np.floor(uv[0]).astype(np.int64), np.floor(uv[1]).astype(np.int64)
        out = np.zeros((coord.shape[0], 4), np.float32)
        for k, (dx, dy) in enumerate(((0, 1), (1, 1), (1, 0), (0, 0))):
            ix, okx = addr(bx + dx, size[0], smp.address[0])
            iy, oky = addr(by + dy, size[1], smp.address[1])
            out[:, k] = np.where(okx & oky, L[iy, ix, ch], smp.border[ch])
        return out

    def load(self, ins):
        A = ins.args
        c = u2i(self.read(A[1], 'i')).astype(np.int64)
        tex = self.t[A[2].num]
        sw = A[2].swz or (0, 1, 2, 3)
        if isinstance(tex, Buffer):
            k, nc = c[:, 0], tex.comps
            ok = (k >= 0) & ((k + 1) * nc <= len(tex.words))
            kk = np.where(ok, k, 0)
            v = np.zeros((self.n, 4), np.uint32)
            for j in range(nc):
                v[:, j] = tex.words[kk * nc + j]
            v[~ok] = 0
            return v[:, list(sw)]
        dim = tex.dim
        lvl = c[:, 3]          # ld: the mip level is in .w for 1D/2D/3D textures
        out = np.zeros((self.n, 4), np.uint32)
        for lv in np.unique(lvl):
            sel = lvl == lv
            if lv < 0 or lv >= len(tex.levels):
                continue
            size = tex.size(int(lv))
            ok = np.ones(sel.sum(), bool)
            idx = []
            for k in range(dim):
                i = c[sel, k]
                ok &= (i >= 0) & (i < size[k])
                idx.append(np.clip(i, 0, size[k] - 1))
            L = tex.levels[int(lv)]
            v = L[idx[2], idx[1], idx[0]] if dim == 3 else L[idx[1], idx[0]]
            v = v.astype(np.uint32) if tex.int else f2u(v.astype(np.float32))
            v[~ok] = 0
            out[sel] = v
        return out[:, list(sw)]

    def resinfo(self, ins):
        A = ins.args
        lvl = self.read(A[1], 'u')[:, 0]
        tex = self.t[A[2].num]
        out = np.zeros((self.n, 4), np.float32)
        for lv in np.unique(lvl):
            sel = lvl == lv
            size = list(tex.size(int(lv))) + [0, 0]
            out[sel, 0], out[sel, 1] = size[0], size[1]
            out[sel, 2] = size[2] if tex.dim == 3 else 0
            out[sel, 3] = len(tex.levels)
        sw = A[2].swz or (0, 1, 2, 3)
        out = out[:, list(sw)]
        if ins.ret_type == '_uint':
            return out.astype(np.uint32)
        return f2u(out)

    def _buf(self, a):
        if a.file == 't':
            return self.t[a.num]
        if a.file == 'u':
            return self.u[a.num]
        if a.file == 'g':
            return self.G[a.num]
        raise ValueError(a.text)

    def ld_buffer(self, ins):
        b, A = ins.base, ins.args
        if b == 'ld_uav_typed':
            c = u2i(self.read(A[1], 'i')).astype(np.int64)
            tex = self.u[A[2].num]
            sw = A[2].swz or (0, 1, 2, 3)
            if isinstance(tex, Buffer):
                k = c[:, 0]
                v = np.stack([tex.words[np.clip(k * 4 + j, 0, len(tex.words) - 1)] for j in range(4)], 1)
                return v[:, list(sw)]
            L = tex.levels[0]
            size = tex.size(0)
            ix = np.clip(c[:, 0], 0, size[0] - 1)
            iy = np.clip(c[:, 1], 0, size[1] - 1)
            v = L[np.clip(c[:, 2], 0, size[2] - 1), iy, ix] if tex.dim == 3 else L[iy, ix]
            return f2u(v)[:, list(sw)]
        if b == 'ld_structured':
            idx = self.read(A[1], 'u')[:, 0].astype(np.int64)
            off = self.read(A[2], 'u')[:, 0].astype(np.int64)
            src = A[3]
        else:   # ld_raw
            idx, off = np.zeros(self.n, np.int64), self.read(A[1], 'u')[:, 0].astype(np.int64)
            src = A[2]
        buf = self._buf(src)
        stride = self._stride(src, ins)
        word0 = (idx * stride + off) // 4
        sw = src.swz or (0, 1, 2, 3)
        if src.file == 'g':
            gw = buf
            gi = self.group_of
            out = np.zeros((self.n, 4), np.uint32)
            for j in range(4):
                w = word0 + j
                ok = (w >= 0) & (w < gw.shape[1])
                out[:, j] = np.where(ok, gw[gi, np.clip(w, 0, gw.shape[1] - 1)], 0)
            return out[:, list(sw)] if len(sw) == 4 else out[:, list(sw) + [0] * (4 - len(sw))]
        words = buf.words
        out = np.zeros((self.n, 4), np.uint32)
        for j in range(4):
            w = word0 + j
            ok = (w >= 0) & (w < len(words))
            out[:, j] = np.where(ok, words[np.clip(w, 0, max(0, len(words) - 1))] if len(words) else 0, 0)
        sw = tuple(sw) + (sw[-1],) * (4 - len(sw)) if len(sw) < 4 else sw
        return out[:, list(sw)]

    def _stride(self, a, ins):
        if a.file == 'g':
            d = self.p.tgsm[a.num]
            return d[1] if d[0] == 'structured' else 0
        if ins.stride:
            return ins.stride
        decl = (self.p.resources if a.file == 't' else self.p.uavs).get(a.num, {})
        if decl.get('stride'):
            return decl['stride']
        return getattr(self._buf(a), 'stride', 0) or 0

    def store(self, ins, m):
        b, A = ins.base, ins.args
        dst = A[0]
        lanes = np.nonzero(m & ~self.killed)[0]
        if b == 'store_uav_typed':
            c = u2i(self.read(A[1], 'i')).astype(np.int64)
            v = self.read_raw(A[2])
            tex = self.u[dst.num]
            comps = dst.swz or (0, 1, 2, 3)
            if isinstance(tex, Buffer):
                for ln in lanes:
                    for cc in comps:
                        tex.words[c[ln, 0] * 4 + cc] = v[ln, cc]
                return
            L = tex.levels[0]
            size = tex.size(0)
            vf = u2f(v)
            if tex.fmt:
                vf = quantize(vf, tex.fmt)
            ix, iy = c[lanes, 0], c[lanes, 1]
            ok = (ix >= 0) & (ix < size[0]) & (iy >= 0) & (iy < size[1])
            lanes, ix, iy = lanes[ok], ix[ok], iy[ok]
            for cc in comps:
                if tex.dim == 3:
                    L[c[lanes, 2], iy, ix, cc] = vf[lanes, cc]
                else:
                    L[iy, ix, cc] = vf[lanes, cc]
            return
        if b == 'store_structured':
            idx = self.read(A[1], 'u')[:, 0].astype(np.int64)
            off = self.read(A[2], 'u')[:, 0].astype(np.int64)
            v = self.read_raw(A[3])
        else:
            idx, off = np.zeros(self.n, np.int64), self.read(A[1], 'u')[:, 0].astype(np.int64)
            v = self.read_raw(A[2])
        stride = self._stride(dst, ins)
        word0 = (idx * stride + off) // 4
        comps = dst.swz or (0, 1, 2, 3)
        if dst.file == 'g':
            gw = self.G[dst.num]
            for k, cc in enumerate(comps):
                w = word0[lanes] + k
                ok = (w >= 0) & (w < gw.shape[1])
                gw[self.group_of[lanes][ok], w[ok]] = v[lanes[ok], k]
            return
        words = self._buf(dst).words
        for k, cc in enumerate(comps):
            w = word0[lanes] + k
            ok = (w >= 0) & (w < len(words))
            words[w[ok]] = v[lanes[ok], k]

    def atomic(self, ins, m):
        b, A = ins.base, ins.args
        imm = b.startswith('imm_')
        op = b.split('atomic_', 1)[1]
        if imm:
            dst_ret, target, a_addr, vals = A[0], A[1], A[2], A[3:]
        else:
            dst_ret, target, a_addr, vals = None, A[0], A[1], A[2:]
        lanes = np.nonzero(m & ~self.killed)[0]
        addr_v = self.read(a_addr, 'u').astype(np.int64)
        v0 = self.read(vals[0], 'u')[:, 0]
        v1 = self.read(vals[1], 'u')[:, 0] if len(vals) > 1 else None
        if target.file == 'g':
            gw = self.G[target.num]
            stride = self._stride(target, ins)
            w = (addr_v[:, 0] * stride + (addr_v[:, 1] if stride else 0)) // 4 if self.p.tgsm[target.num][0] == 'structured' else addr_v[:, 0] // 4
            get = lambda ln: gw[self.group_of[ln], w[ln]]

            def put(ln, x):
                gw[self.group_of[ln], w[ln]] = x
        else:
            buf = self.u[target.num]
            if isinstance(buf, Texture):
                L = buf.levels[0]
                get = lambda ln: np.uint32(L[addr_v[ln, 1], addr_v[ln, 0], 0])

                def put(ln, x):
                    L[addr_v[ln, 1], addr_v[ln, 0], 0] = x
            else:
                stride = self._stride(target, ins)
                w = (addr_v[:, 0] * stride + addr_v[:, 1]) // 4 if stride else addr_v[:, 0] // 4
                get = lambda ln: buf.words[w[ln]]

                def put(ln, x):
                    buf.words[w[ln]] = x
        ret = np.zeros((self.n, 4), np.uint32)
        for ln in lanes:
            old = np.uint32(get(ln))
            a, bb = int(old), int(v0[ln])
            if op == 'iadd':
                new = (a + bb) & 0xFFFFFFFF
            elif op == 'and':
                new = a & bb
            elif op == 'or':
                new = a | bb
            elif op == 'xor':
                new = a ^ bb
            elif op == 'umax':
                new = max(a, bb)
            elif op == 'umin':
                new = min(a, bb)
            elif op == 'imax':
                new = max(np.int32(np.uint32(a)), np.int32(np.uint32(bb))) & 0xFFFFFFFF
            elif op == 'imin':
                new = min(np.int32(np.uint32(a)), np.int32(np.uint32(bb))) & 0xFFFFFFFF
            elif op == 'exch':
                new = bb
            elif op == 'cmp_exch':
                new = int(v1[ln]) if a == bb else a
            elif op == 'cmp_store':
                new = int(v1[ln]) if a == bb else a
            else:
                raise NotImplementedError('atomic ' + op)
            put(ln, np.uint32(new))
            ret[ln, :] = old
        if dst_ret is not None:
            self.write(dst_ret, ret, m)


FLOAT_BIN = {
    'add': lambda x, y: x + y,
    'mul': lambda x, y: x * y,
    'div': lambda x, y: x / y,
    'min': np.fmin,
    'max': np.fmax,
}
FLOAT_UN = {
    'frc': lambda x: x - np.floor(x),
    'round_ne': np.rint,
    'round_ni': np.floor,
    'round_pi': np.ceil,
    'round_z': np.trunc,
    'exp': lambda x: np.exp2(x),
    'log': lambda x: np.log2(x),
    'rsq': lambda x: np.float32(1) / np.sqrt(x),
    'rcp': lambda x: np.float32(1) / x,
    'sqrt': np.sqrt,
}
EXACT_UN = {
    'exp': np.exp2,
    'log': np.log2,
    'rsq': lambda x: 1.0 / np.sqrt(x),
    'rcp': lambda x: 1.0 / x,
}
FLOAT_CMP = {
    'lt': lambda x, y: x < y,
    'ge': lambda x, y: x >= y,
    'eq': lambda x, y: x == y,
    'ne': lambda x, y: ~(x == y),
}
INT_BIN = {
    'iadd': lambda x, y: x + y,
    'imin': np.minimum,
    'imax': np.maximum,
    'ieq': lambda x, y: np.where(x == y, 0xFFFFFFFF, 0),
    'ine': lambda x, y: np.where(x != y, 0xFFFFFFFF, 0),
    'ilt': lambda x, y: np.where(x < y, 0xFFFFFFFF, 0),
    'ige': lambda x, y: np.where(x >= y, 0xFFFFFFFF, 0),
    'ishl': lambda x, y: x << (y & 31),
    'ishr': lambda x, y: x >> (y & 31),
}
UINT_BIN = {
    'and': lambda x, y: x & y,
    'or': lambda x, y: x | y,
    'xor': lambda x, y: x ^ y,
    'ushr': lambda x, y: x >> (y & np.uint64(31)),
    'ult': lambda x, y: np.where(x < y, 0xFFFFFFFF, 0).astype(np.uint64),
    'uge': lambda x, y: np.where(x >= y, 0xFFFFFFFF, 0).astype(np.uint64),
    'umin': np.minimum,
    'umax': np.maximum,
}


# ---------------------------------------------------------------- running a pass
def cb_from_floats(vals):
    """A constant buffer from a list of float4 rows (as the capture's JSON gives them) -> (rows, 4) uint32."""
    a = np.array(vals, np.float64).reshape(-1, 4).astype(np.float32)
    return a.view(np.uint32)


def run_pixels(prog, W, H, cbs, textures=None, samplers=None, inputs=None, position_slot=None, uavs=None, **kw):
    """Run a pixel shader over a W x H image (one lane per pixel, row-major, y down).
    inputs: {v#: (H*W, 4) float32}; position_slot: the v# that holds SV_Position (pixel centres)."""
    n = W * H
    mach = Machine(prog, n, quads=(H, W) if W % 2 == 0 and H % 2 == 0 else None, **kw)
    for k, v in cbs.items():
        mach.cb[k] = np.asarray(v, np.uint32)
    mach.t = dict(textures or {})
    mach.s = dict(samplers or {})
    mach.u = dict(uavs or {})
    ys, xs = np.mgrid[0:H, 0:W]
    if position_slot is not None:
        pos = np.zeros((n, 4), np.float32)
        pos[:, 0] = xs.ravel() + 0.5
        pos[:, 1] = ys.ravel() + 0.5
        pos[:, 3] = 1.0
        mach.V[position_slot] = f2u(pos)
    for k, v in (inputs or {}).items():
        mach.V[k] = f2u(np.asarray(v, np.float32))
    mach.run()
    return mach


def run_compute(prog, groups, cbs, textures=None, samplers=None, uavs=None, buffers=None, **kw):
    """Run a compute shader for groups (gx, gy, gz) of the program's thread group size."""
    gx, gy, gz = groups
    tx, ty, tz = prog.group
    per = tx * ty * tz
    ng = gx * gy * gz
    n = per * ng
    mach = Machine(prog, n, **kw)
    for k, v in cbs.items():
        mach.cb[k] = np.asarray(v, np.uint32)
    mach.t = dict(textures or {})
    mach.t.update(buffers or {})
    mach.s = dict(samplers or {})
    mach.u = dict(uavs or {})
    lane = np.arange(n)
    g, local = lane // per, lane % per
    lx, ly, lz = local % tx, (local // tx) % ty, local // (tx * ty)
    gxi, gyi, gzi = g % gx, (g // gx) % gy, g // (gx * gy)
    mach.group_of = g
    z = np.zeros(n, np.uint32)
    mach.sysvals['vThreadIDInGroupFlattened'] = np.stack([local, local, local, local], 1).astype(np.uint32)
    mach.sysvals['vThreadIDInGroup'] = np.stack([lx, ly, lz, z], 1).astype(np.uint32)
    mach.sysvals['vThreadGroupID'] = np.stack([gxi, gyi, gzi, z], 1).astype(np.uint32)
    mach.sysvals['vThreadID'] = np.stack([gxi * tx + lx, gyi * ty + ly, gzi * tz + lz, z], 1).astype(np.uint32)
    for k, d in prog.tgsm.items():
        words = d[1] * d[2] // 4 if d[0] == 'structured' else d[1] // 4
        mach.G[k] = np.zeros((ng, words), np.uint32)
    mach.run()
    return mach
