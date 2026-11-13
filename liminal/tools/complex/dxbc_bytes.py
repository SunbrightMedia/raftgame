#!/usr/bin/env python3
"""
dxbc_bytes.py: the exact numbers in a shader's bytes (DXBC container, SM4/SM5 token stream).

RenderDoc's disassembly (the first export) prints each number written in a shader with 6 decimals, so dxbc.py
had to guess the values behind them (snapping to simple fractions). The deep export (complex_deep.ps1) saved
each shader's bytes; this reads the immediate operands and the immediate constant buffer from them, so a
dxbc.Program built from the disassembly can use the exact values:

    prog = dxbc.Program(text, snap=False)
    apply(prog, blob)          # blob: the shader's bytes (shaders/<stage>_<id>.dxbc.z, unzipped)

Written from the token format Microsoft documents for Direct3D 10/11 shaders (d3d11TokenizedProgramFormat.hpp
in the Windows SDK): opcode tokens, operand tokens, index representations, custom-data blocks. Study only.
"""
import struct

import numpy as np

CUSTOMDATA = 53
ICB_CLASS = 3
# Declarations: not instructions (RenderDoc lists them without a number).
DECLS = set(range(88, 107)) | {113} | set(range(143, 163)) | {206}
IMM32, IMM64 = 4, 5


def chunks(blob):
    if blob[:4] != b'DXBC':
        raise ValueError('not a DXBC container')
    n = struct.unpack_from('<I', blob, 28)[0]
    out = {}
    for off in struct.unpack_from('<%dI' % n, blob, 32):
        tag = blob[off:off + 4].decode('latin-1')
        size = struct.unpack_from('<I', blob, off + 4)[0]
        out[tag] = blob[off + 8:off + 8 + size]
    return out


def tokens(blob):
    c = chunks(blob)
    code = c.get('SHEX') or c.get('SHDR')
    if code is None:
        raise ValueError('no SHEX/SHDR chunk')
    t = np.frombuffer(code, np.uint32)
    return t[:int(t[1])]


def _operand(t, i):
    """Parse one operand at t[i]. Returns (immediate values or None, next index)."""
    tok = int(t[i]); i += 1
    ncomp = tok & 3
    otype = (tok >> 12) & 0xff
    idim = (tok >> 20) & 3
    reps = [(tok >> 22) & 7, (tok >> 25) & 7, (tok >> 28) & 7]
    ext = tok >> 31
    while ext:
        ext = int(t[i]) >> 31
        i += 1
    imm = None
    if otype == IMM32:
        n = 1 if ncomp == 1 else 4
        imm = np.array(t[i:i + n], np.uint32); i += n
    elif otype == IMM64:
        n = 2 if ncomp == 1 else 4
        imm = ('64', np.array(t[i:i + n], np.uint32)); i += n
    for d in range(idim):
        r = reps[d]
        if r in (0, 3):
            i += 1
        elif r in (1, 4):
            i += 2
        if r in (2, 3, 4):
            _, i = _operand(t, i)
    return imm, i


def instructions(blob):
    """[(opcode, [immediate values per immediate operand])] for every instruction (not declarations), in order,
    and the immediate constant buffer (uint32, rows of 4) if there is one."""
    t = tokens(blob)
    i, end = 2, len(t)
    out, icb = [], None
    while i < end:
        tok = int(t[i])
        op = tok & 0x7ff
        if op == CUSTOMDATA:
            n = int(t[i + 1])
            if (tok >> 11) == ICB_CLASS:
                icb = np.array(t[i + 2:i + n], np.uint32).reshape(-1, 4)
            i += n
            continue
        n = (tok >> 24) & 0x7f
        if n == 0:
            raise ValueError('instruction with length 0 at token %d (opcode %d)' % (i, op))
        if op in DECLS:
            i += n
            continue
        j = i + 1
        ext = tok >> 31
        while ext:
            ext = int(t[j]) >> 31
            j += 1
        imms = []
        while j < i + n:
            imm, j = _operand(t, j)
            if imm is not None:
                imms.append(imm)
        if j != i + n:
            raise ValueError('operands overran instruction at token %d (opcode %d)' % (i, op))
        out.append((op, imms))
        i += n
    return out, icb


def exact_map(prog, blob):
    """{(instruction index, operand index): uint32 values} for every immediate of a dxbc.Program, from the
    shader's bytes; and the exact immediate constant buffer (or None). Raises if the two do not line up."""
    ins, icb = instructions(blob)
    if len(ins) != len(prog.code):
        raise ValueError('instruction count: bytes %d, disassembly %d' % (len(ins), len(prog.code)))
    exact = {}
    for k, (code, (op, imms)) in enumerate(zip(prog.code, ins)):
        slots = [j for j, a in enumerate(code.args) if a.file == 'l']
        if len(slots) != len(imms):
            raise ValueError('instruction %d (%s): %d immediates in the disassembly, %d in the bytes'
                             % (k, code.text, len(slots), len(imms)))
        for j, v in zip(slots, imms):
            if isinstance(v, tuple):
                raise ValueError('instruction %d: 64-bit immediate not handled' % k)
            exact[(k, j)] = v
    return exact, icb


def apply(prog, blob):
    """Put the exact values into prog (a dxbc.Program). Returns how many immediates changed."""
    exact, icb = exact_map(prog, blob)
    changed = 0
    for (k, j), v in exact.items():
        a = prog.code[k].args[j]
        want = np.repeat(v, 4) if len(v) == 1 else v
        if a.imm is None or not np.array_equal(np.asarray(a.imm, np.uint32), want):
            changed += 1
    prog.apply_exact(exact)
    if icb is not None:
        if prog.icb is not None and prog.icb.shape != icb.shape:
            raise ValueError('immediate constant buffer shape: bytes %s, disassembly %s' % (icb.shape, prog.icb.shape))
        prog.icb = icb
    return changed
