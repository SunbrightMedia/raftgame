"""
Read a Valve VPK directory file (pak01_dir.vpk): list entries, and extract
files from the numbered archives that sit next to it.
    python3 tools/source/vpk.py list reference/portal2/pak01_dir.vpk [pattern]
    python3 tools/source/vpk.py get  reference/portal2/pak01_dir.vpk path/in/vpk.vtf out_dir
"""
import struct, sys, os, fnmatch


def read_dir(path):
    f = open(path, 'rb')
    sig, ver, tree = struct.unpack('<III', f.read(12))
    assert sig == 0x55AA1234, 'not a VPK'
    if ver == 2:
        f.read(16)
    header = 12 + (16 if ver == 2 else 0)
    data = f.read(tree)
    pos = 0
    def cstr():
        nonlocal pos
        e = data.index(b'\0', pos); s = data[pos:e].decode('latin-1'); pos = e + 1; return s
    entries = {}
    while True:
        ext = cstr()
        if not ext: break
        while True:
            d = cstr()
            if not d: break
            while True:
                n = cstr()
                if not n: break
                crc, pre, arch, off, ln, term = struct.unpack('<IHHIIH', data[pos:pos + 18]); pos += 18
                preload = data[pos:pos + pre]; pos += pre
                full = (d.strip() + '/' if d.strip() else '') + n + '.' + ext
                entries[full.lower()] = (arch, off, ln, preload)
    return entries, header + tree


def extract(dirpath, name, entries, tree_end):
    arch, off, ln, pre = entries[name.lower()]
    if arch == 0x7FFF:
        f = open(dirpath, 'rb'); f.seek(tree_end + off); return pre + f.read(ln)
    ap = dirpath.replace('_dir.vpk', f'_{arch:03d}.vpk')
    with open(ap, 'rb') as f:
        f.seek(off); return pre + f.read(ln)


if __name__ == '__main__':
    cmd, path = sys.argv[1], sys.argv[2]
    entries, tree_end = read_dir(path)
    if cmd == 'list':
        pat = sys.argv[3] if len(sys.argv) > 3 else '*'
        for k, (a, o, l, p) in sorted(entries.items()):
            if fnmatch.fnmatch(k, pat): print(f'{a:5d} {l + len(p):10d} {k}')
    elif cmd == 'get':
        name, out = sys.argv[3], sys.argv[4]
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, os.path.basename(name)), 'wb').write(extract(path, name, entries, tree_end))
