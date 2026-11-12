"""Make a GLSL ES 3.00 fragment shader compute like a CPU: every +, -, * rounds once and divisions are exact.

GPU compilers may fuse a * b + c into one rounding, regroup (x + 0.5) + 0.5 into x + 1.0, or turn a / b into
a * (1 / b). Blender's CPU code does none of that, so a GPU copy of it drifts by an ulp here and there. This
rewrites every function body: a + b, a - b, a * b become rn(a + b) (rn adds an integer 0 the compiler cannot
see to the result's bits, so the operation stays on its own), a / b becomes dv(a, b) (an exactly rounded quotient), and compound
assignments are expanded. Integer operations go through identity overloads, so the types need no analysis.
Constant initializers (const, globals) are left as they are.

    src2 = harden(src)
"""
import re

PRELUDE = '''
// rn(x): x unchanged, through an integer add of 0 on its bits. The compiler cannot know the 0 (it comes from
// gl_FragCoord), so it cannot fuse, regroup or factor across rn() (multiplying by an unknown 1.0 is not enough:
// a fast-math optimizer still factors v*a + v*b into v*(a + b)).
uint xz_() { return uint(gl_FragCoord.x < 0.0); }
float rn(float x) { return uintBitsToFloat(floatBitsToUint(x) + xz_()); }
vec2 rn(vec2 x) { return uintBitsToFloat(floatBitsToUint(x) + uvec2(xz_())); }
vec3 rn(vec3 x) { return uintBitsToFloat(floatBitsToUint(x) + uvec3(xz_())); }
vec4 rn(vec4 x) { return uintBitsToFloat(floatBitsToUint(x) + uvec4(xz_())); }
int rn(int x) { return x; }
ivec2 rn(ivec2 x) { return x; }
ivec3 rn(ivec3 x) { return x; }
ivec4 rn(ivec4 x) { return x; }
uint rn(uint x) { return x; }
uvec2 rn(uvec2 x) { return x; }
uvec3 rn(uvec3 x) { return x; }
uvec4 rn(uvec4 x) { return x; }
// a / b, rounded once: the GPU's quotient, corrected with the exact residual a - q * b (Dekker's product)
float dv(float a, float b) {
  float q = rn(a / b);
  float aq = abs(q);
  if (!(aq > 1e-30 && aq < 1e30) || isinf(b) || isinf(a)) return q;
  float t = rn(4097.0 * q), qh = rn(t - rn(t - q)), ql = rn(q - qh);
  float u = rn(4097.0 * b), bh = rn(u - rn(u - b)), bl = rn(b - bh);
  float p = rn(q * b);
  float e = rn(rn(rn(rn(rn(qh * bh) - p) + rn(qh * bl)) + rn(ql * bh)) + rn(ql * bl));
  float r = rn(rn(a - p) - e);
  return rn(q + rn(r / b));
}
vec2 dv(vec2 a, vec2 b) { return vec2(dv(a.x, b.x), dv(a.y, b.y)); }
vec3 dv(vec3 a, vec3 b) { return vec3(dv(a.x, b.x), dv(a.y, b.y), dv(a.z, b.z)); }
vec4 dv(vec4 a, vec4 b) { return vec4(dv(a.x, b.x), dv(a.y, b.y), dv(a.z, b.z), dv(a.w, b.w)); }
vec2 dv(vec2 a, float b) { return dv(a, vec2(b)); }
vec3 dv(vec3 a, float b) { return dv(a, vec3(b)); }
vec4 dv(vec4 a, float b) { return dv(a, vec4(b)); }
vec2 dv(float a, vec2 b) { return dv(vec2(a), b); }
vec3 dv(float a, vec3 b) { return dv(vec3(a), b); }
vec4 dv(float a, vec4 b) { return dv(vec4(a), b); }
int dv(int a, int b) { return a / b; }
ivec2 dv(ivec2 a, ivec2 b) { return a / b; }
ivec2 dv(ivec2 a, int b) { return a / b; }
uint dv(uint a, uint b) { return a / b; }
'''

TYPES = {'void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3',
         'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D', 'isampler2D', 'usampler2D'}
QUALS = {'const', 'highp', 'mediump', 'lowp', 'in', 'out', 'inout', 'uniform', 'flat', 'smooth', 'invariant', 'centroid'}

TOK = re.compile(r'''
    (?P<ws>\s+) | (?P<lc>//[^\n]*) | (?P<bc>/\*.*?\*/) |
    (?P<num>0[xX][0-9a-fA-F]+[uU]? | (?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)? | \d+[eE][+-]?\d+ | \d+[uU]?) |
    (?P<id>[A-Za-z_]\w*) |
    (?P<op><<=|>>=|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|\+=|-=|\*=|/=|%=|&=|\|=|\^=|[-+*/%<>=!~&|^?:;,.(){}\[\]])
''', re.S | re.X)


def tokenize(src):
    out, i = [], 0
    while i < len(src):
        m = TOK.match(src, i)
        if not m:
            raise SyntaxError('bad character %r at %d' % (src[i], i))
        i = m.end()
        k = m.lastgroup
        if k in ('ws', 'lc', 'bc'):
            continue
        out.append(m.group(k))
    return out


BIN = {'*': 12, '/': 12, '%': 12, '+': 11, '-': 11, '<<': 10, '>>': 10, '<': 9, '>': 9, '<=': 9, '>=': 9,
       '==': 8, '!=': 8, '&': 7, '^': 6, '|': 5, '&&': 4, '^^': 3, '||': 2}
ASSIGN = {'=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^='}


class P:
    def __init__(self, toks):
        self.t, self.i = toks, 0

    def peek(self, k=0):
        j = self.i + k
        return self.t[j] if j < len(self.t) else None

    def take(self, want=None):
        tok = self.t[self.i]
        if want is not None and tok != want:
            raise SyntaxError('expected %r, got %r near %s' % (want, tok, ' '.join(self.t[max(0, self.i - 8):self.i + 8])))
        self.i += 1
        return tok

    # ---- expressions -> rewritten text
    def expr(self):          # comma expression
        e = self.assign()
        while self.peek() == ',':
            self.take(); e = e + ', ' + self.assign()
        return e

    def assign(self):
        lhs_start = self.i
        e = self.ternary()
        op = self.peek()
        if op in ASSIGN:
            lhs = e
            self.take()
            rhs = self.assign()
            if op == '+=': return '%s = rn(%s + (%s))' % (lhs, lhs, rhs)
            if op == '-=': return '%s = rn(%s - (%s))' % (lhs, lhs, rhs)
            if op == '*=': return '%s = rn(%s * (%s))' % (lhs, lhs, rhs)
            if op == '/=': return '%s = dv(%s, %s)' % (lhs, lhs, rhs)
            return '%s %s %s' % (lhs, op, rhs)
        return e

    def ternary(self):
        c = self.binary(0)
        if self.peek() == '?':
            self.take(); a = self.assign(); self.take(':'); b = self.assign()
            return '(%s ? %s : %s)' % (c, a, b)
        return c

    def binary(self, minp):
        a = self.unary()
        while True:
            op = self.peek()
            p = BIN.get(op)
            if p is None or p < minp or op in ASSIGN:
                return a
            self.take()
            b = self.binary(p + 1)
            if op in ('+', '-', '*'):
                a = 'rn(%s %s %s)' % (a, op, b)
            elif op == '/':
                a = 'dv(%s, %s)' % (a, b)
            else:
                a = '(%s %s %s)' % (a, op, b)

    def unary(self):
        op = self.peek()
        if op in ('-', '+', '!', '~', '++', '--'):
            self.take()
            x = self.unary()
            return '(%s%s)' % (op, x) if op != '+' else x
        return self.postfix()

    def postfix(self):
        e = self.primary()
        while True:
            t = self.peek()
            if t == '(':
                self.take(); args = []
                if self.peek() != ')':
                    args.append(self.assign())
                    while self.peek() == ',':
                        self.take(); args.append(self.assign())
                self.take(')')
                e = '%s(%s)' % (e, ', '.join(args))
            elif t == '[':
                self.take(); ix = self.expr(); self.take(']')
                e = '%s[%s]' % (e, ix)
            elif t == '.':
                self.take(); e = '%s.%s' % (e, self.take())
            elif t in ('++', '--'):
                self.take(); e = '%s%s' % (e, t)
            else:
                return e

    def primary(self):
        t = self.take()
        if t == '(':
            e = self.expr(); self.take(')')
            return '(%s)' % e
        if re.match(r'[A-Za-z_]|\d|\.', t):
            return t
        raise SyntaxError('unexpected %r near %s' % (t, ' '.join(self.t[max(0, self.i - 8):self.i + 8])))

    # ---- statements
    def is_decl(self):
        t = self.peek()
        if t in QUALS or t in TYPES:
            # "vec4(...)" at statement start is a constructor expression, not a declaration
            return not (t in TYPES and self.peek(1) == '(')
        return False

    def decl(self):
        """Declaration statement; const initializers are kept verbatim."""
        words = []
        while self.peek() in QUALS or self.peek() in TYPES:
            words.append(self.take())
        const = 'const' in words
        if self.peek() == '[':   # array type: float[9] a = ...
            words.append(self.take()); words.append(self.take()); words.append(self.take(']'))
        parts = []
        while True:
            name = self.take()
            arr = ''
            if self.peek() == '[':
                self.take(); arr = '[' + self.raw_until(']') + ']'; self.take(']')
            init = ''
            if self.peek() == '=':
                self.take()
                init = ' = ' + (self.raw_assign() if const else self.assign())
            parts.append(name + arr + init)
            if self.peek() == ',':
                self.take(); continue
            break
        self.take(';')
        return ' '.join(words) + ' ' + ', '.join(parts) + ';'

    def raw_until(self, stop):
        out, depth = [], 0
        while True:
            t = self.peek()
            if depth == 0 and t == stop:
                return ' '.join(out)
            if t in '([{': depth += 1
            if t in ')]}': depth -= 1
            out.append(self.take())

    def raw_assign(self):
        """An initializer kept verbatim (up to the next top-level ',' or ';')."""
        out, depth = [], 0
        while True:
            t = self.peek()
            if depth == 0 and t in (',', ';'):
                return ' '.join(out)
            if t in ('(', '[', '{'): depth += 1
            if t in (')', ']', '}'): depth -= 1
            out.append(self.take())

    def stmt(self):
        t = self.peek()
        if t == '{':
            self.take(); body = []
            while self.peek() != '}':
                body.append(self.stmt())
            self.take('}')
            return '{\n' + '\n'.join(body) + '\n}'
        if t == 'if':
            self.take(); self.take('('); c = self.expr(); self.take(')')
            a = self.stmt()
            if self.peek() == 'else':
                self.take(); return 'if (%s) %s else %s' % (c, a, self.stmt())
            return 'if (%s) %s' % (c, a)
        if t == 'for':
            self.take(); self.take('(')
            if self.is_decl():
                init = self.decl()
            elif self.peek() == ';':
                self.take(); init = ';'
            else:
                init = self.expr() + ';'; self.take(';')
            cond = self.expr() if self.peek() != ';' else ''
            self.take(';')
            step = self.expr() if self.peek() != ')' else ''
            self.take(')')
            return 'for (%s %s; %s) %s' % (init, cond, step, self.stmt())
        if t == 'while':
            self.take(); self.take('('); c = self.expr(); self.take(')')
            return 'while (%s) %s' % (c, self.stmt())
        if t == 'return':
            self.take()
            if self.peek() == ';':
                self.take(); return 'return;'
            e = self.expr(); self.take(';')
            return 'return %s;' % e
        if t in ('break', 'continue', 'discard'):
            self.take(); self.take(';'); return t + ';'
        if t == ';':
            self.take(); return ';'
        if self.is_decl():
            return self.decl()
        e = self.expr(); self.take(';')
        return e + ';'


def harden(src):
    """Rewrite every function body of a fragment shader (see module doc). Inserts the rn/dv helpers after the
    leading #version / precision lines."""
    lines = src.split('\n')
    k0 = 0
    while k0 < len(lines) and (lines[k0].lstrip().startswith('#') or not lines[k0].strip()):
        k0 += 1
    pre, rest = lines[:k0], lines[k0:]
    if any(ln.lstrip().startswith('#') for ln in rest):
        raise SyntaxError('preprocessor lines must come first')
    toks = tokenize('\n'.join(rest))
    p = P(toks)
    out = []
    while p.peek() is not None:
        t = p.peek()
        if t == 'precision':
            out.append(' '.join([p.take(), p.take(), p.take()]) + p.take(';')); continue
        # external declaration: qualifiers + type + name, then '(' (function) or declarators
        j = p.i
        words = []
        while p.peek() in QUALS or p.peek() in TYPES:
            words.append(p.take())
        if not words:
            raise SyntaxError('unexpected %r at top level near %s' % (t, ' '.join(toks[j:j + 10])))
        if p.peek(1) == '(' and p.peek() not in TYPES:
            name = p.take(); p.take('(')
            params = p.raw_until(')'); p.take(')')
            if p.peek() == ';':
                p.take(); out.append('%s %s(%s);' % (' '.join(words), name, params)); continue
            body = p.stmt()
            out.append('%s %s(%s) %s' % (' '.join(words), name, params, body))
        else:
            p.i = j
            # global declaration: copy verbatim up to ';'
            raw = p.raw_until(';'); p.take(';')
            out.append(raw + ';')
    # rn/dv go after precision statements (they need float precision) and before everything else
    k = next((i for i, s in enumerate(out) if not s.startswith('precision')), len(out))
    return '\n'.join(pre + out[:k] + [PRELUDE] + out[k:]) + '\n'


if __name__ == '__main__':
    import sys
    print(harden(open(sys.argv[1]).read()))
