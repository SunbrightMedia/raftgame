"""
Collision models (.phy, IVP compact surfaces) → triangles in Source units.
VRAD casts static-prop shadows from the first solid's convex pieces.
    phy_triangles(bytes) -> numpy (n, 3, 3) array, or None
"""
import struct
import numpy as np


def phy_triangles(b: bytes):
    hsize, _, solids, _ = struct.unpack_from('<iiii', b, 0)
    if solids < 1:
        return None
    o = hsize + 4                      # first solid: its size, then its data
    if b[o:o + 4] == b'VPHY':
        o += 28                        # compactsurfaceheader_t
    surf = o
    root = surf + struct.unpack_from('<i', b, surf + 32)[0]
    tris = []
    # Walk the ledge tree (IVP_Compact_Ledgetree_Node, 28 bytes): leaves point at the convex pieces.
    stack = [root]
    seen = set()
    while stack:
        node = stack.pop()
        if node in seen or node < 0 or node + 28 > len(b):
            continue
        seen.add(node)
        right, ledge_off = struct.unpack_from('<ii', b, node)
        if right == 0:
            ledge = node + ledge_off
            if ledge < 0 or ledge + 16 > len(b):
                continue
            cpo, _, flags, ntri, _ = struct.unpack_from('<iiIhh', b, ledge)
            for t in range(ntri):
                to = ledge + 16 + t * 16
                idx = [struct.unpack_from('<I', b, to + 4 + k * 4)[0] & 0xFFFF for k in range(3)]
                pts = [struct.unpack_from('<3f', b, ledge + cpo + i * 16) for i in idx]
                tris.append(pts)
        else:
            stack.append(node + 28)
            stack.append(node + right)
    if not tris:
        return None
    a = np.array(tris, dtype=np.float64) / 0.0254       # metres → inches
    return np.stack([a[..., 0], a[..., 2], -a[..., 1]], -1)   # IVP (x, y, z) → Source (x, z, -y)


def phy_convexes(b: bytes):
    """Every convex piece of every solid, as a list of (n, 3) point arrays in Source units (for collision)."""
    hsize, _, solids, _ = struct.unpack_from('<iiii', b, 0)
    pieces = []
    o = hsize
    for _s in range(max(0, solids)):
        if o + 4 > len(b):
            break
        size = struct.unpack_from('<i', b, o)[0]
        surf = o + 4
        nxt = surf + size
        if b[surf:surf + 4] == b'VPHY':
            surf += 28
        try:
            root = surf + struct.unpack_from('<i', b, surf + 32)[0]
        except struct.error:
            break
        stack, seen = [root], set()
        while stack:
            node = stack.pop()
            if node in seen or node < 0 or node + 28 > len(b):
                continue
            seen.add(node)
            right, ledge_off = struct.unpack_from('<ii', b, node)
            if right == 0:
                ledge = node + ledge_off
                if ledge < 0 or ledge + 16 > len(b):
                    continue
                cpo, _, flags, ntri, _ = struct.unpack_from('<iiIhh', b, ledge)
                idx = set()
                for t in range(ntri):
                    to = ledge + 16 + t * 16
                    for k in range(3):
                        idx.add(struct.unpack_from('<I', b, to + 4 + k * 4)[0] & 0xFFFF)
                pts = [struct.unpack_from('<3f', b, ledge + cpo + i * 16) for i in sorted(idx) if ledge + cpo + i * 16 + 12 <= len(b)]
                if len(pts) >= 4:
                    a = np.array(pts, dtype=np.float64) / 0.0254
                    pieces.append(np.stack([a[:, 0], a[:, 2], -a[:, 1]], -1))
            else:
                stack.append(node + 28)
                stack.append(node + right)
        o = nxt
    return pieces
