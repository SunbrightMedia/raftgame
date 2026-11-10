"""
Read a Source BSP (v21, Portal 2): entities, brushes with their sides'
materials and texture axes, which brush belongs to which brush model, static
props, overlays. Used by import_bsp.py and the study tools.
"""
import re, struct

L_ENTITIES, L_PLANES, L_TEXDATA, L_NODES, L_TEXINFO, L_LEAFS, L_MODELS, L_LEAFBRUSHES, L_BRUSHES, L_BRUSHSIDES = 0, 1, 2, 5, 6, 10, 14, 17, 18, 19
L_GAME, L_STRDATA, L_STRTABLE, L_OVERLAYS = 35, 43, 44, 45

SURF_SKY, SURF_NODRAW, SURF_TRIGGER, SURF_HINT, SURF_SKIP = 0x4, 0x80, 0x40, 0x100, 0x200


class Bsp:
    def __init__(self, path):
        self.b = b = open(path, 'rb').read()
        assert b[:4] == b'VBSP', 'not a BSP'
        self.version = struct.unpack_from('<i', b, 4)[0]
        self.lumps = [struct.unpack_from('<4i', b, 8 + i * 16) for i in range(64)]

    def lump(self, i):
        o, n = self.lumps[i][0], self.lumps[i][1]
        return self.b[o:o + n]

    def entities(self):
        """Every entity as a dict of its keys (first value of a key wins) plus '_outputs' left out."""
        txt = self.lump(L_ENTITIES).decode('latin-1')
        out = []
        for blk in re.findall(r'\{([^{}]*)\}', txt):
            d = {}
            for k, v in re.findall(r'"([^"]*)"\s+"([^"]*)"', blk):
                d.setdefault(k, v)
            out.append(d)
        return out

    def entity_pairs(self):
        """Every entity as its list of (key, value) pairs, repeats kept (outputs repeat their key)."""
        txt = self.lump(L_ENTITIES).decode('latin-1')
        return [re.findall(r'"([^"]*)"\s+"([^"]*)"', blk) for blk in re.findall(r'\{([^{}]*)\}', txt)]

    def planes(self):
        d = self.lump(L_PLANES)
        return [struct.unpack_from('<4f', d, i * 20) for i in range(len(d) // 20)]

    def texnames(self):
        table, data = self.lump(L_STRTABLE), self.lump(L_STRDATA)
        offs = struct.unpack_from(f'<{len(table) // 4}i', table, 0)
        return [data[o:data.index(b'\0', o)].decode('latin-1') for o in offs]

    def texdata(self):
        """(name, width, height, reflectivity) per texdata."""
        d, names = self.lump(L_TEXDATA), self.texnames()
        out = []
        for i in range(len(d) // 32):
            r = struct.unpack_from('<3f', d, i * 32)
            sid, w, h = struct.unpack_from('<3i', d, i * 32 + 12)
            out.append((names[sid], w, h, r))
        return out

    def texinfo(self):
        """(textureVecs s, t; lightmapVecs s, t; flags; texdata index) per texinfo."""
        d = self.lump(L_TEXINFO)
        out = []
        for i in range(len(d) // 72):
            v = struct.unpack_from('<16f', d, i * 72)
            flags, td = struct.unpack_from('<2i', d, i * 72 + 64)
            out.append((v[0:4], v[4:8], v[8:12], v[12:16], flags, td))
        return out

    def brushes(self):
        """Per brush: (contents, [(plane index, texinfo, dispinfo, bevel)])."""
        d, s = self.lump(L_BRUSHES), self.lump(L_BRUSHSIDES)
        out = []
        for i in range(len(d) // 12):
            first, num, contents = struct.unpack_from('<3i', d, i * 12)
            sides = []
            for k in range(first, first + num):
                pn, ti, disp, bevel, _thin = struct.unpack_from('<HhhBB', s, k * 8)
                sides.append((pn, ti, disp, bevel))
            out.append((contents, sides))
        return out

    def models(self):
        """Brush models: (mins, maxs, origin, headnode, firstface, numfaces)."""
        d = self.lump(L_MODELS)
        return [(struct.unpack_from('<3f', d, i * 48), struct.unpack_from('<3f', d, i * 48 + 12), struct.unpack_from('<3f', d, i * 48 + 24)) + struct.unpack_from('<3i', d, i * 48 + 36) for i in range(len(d) // 48)]

    def brush_models(self):
        """brush index -> brush model index (0 = world), by walking each model's node tree to its leaves' brushes."""
        nodes, leafs, lb = self.lump(L_NODES), self.lump(L_LEAFS), self.lump(L_LEAFBRUSHES)
        leaf_size = 32 if self.lumps[L_LEAFS][2] >= 1 else 56
        owner = {}
        for mi, m in enumerate(self.models()):
            stack = [m[3]]
            while stack:
                n = stack.pop()
                if n < 0:
                    o = (-1 - n) * leaf_size
                    first, num = struct.unpack_from('<2H', leafs, o + 24)
                    for k in range(first, first + num):
                        owner.setdefault(struct.unpack_from('<H', lb, k * 2)[0], mi)
                else:
                    stack.extend(struct.unpack_from('<2i', nodes, n * 32 + 4))
        return owner

    def static_props(self):
        """Static props: dicts of model, origin, angles, skin, solid, flags, scale."""
        b = self.b
        go, gl = self.lumps[L_GAME][0], self.lumps[L_GAME][1]
        if gl < 4:
            return []
        for k in range(struct.unpack_from('<i', b, go)[0]):
            gid, _flags, ver, off, ln = struct.unpack_from('<4sHHii', b, go + 4 + k * 16)
            if gid != b'prps':
                continue
            nd = struct.unpack_from('<i', b, off)[0]
            names = [b[off + 4 + i * 128:off + 4 + i * 128 + 128].split(b'\0')[0].decode('latin-1').lower() for i in range(nd)]
            p = off + 4 + nd * 128
            nl = struct.unpack_from('<i', b, p)[0]
            p += 4 + nl * 2
            n = struct.unpack_from('<i', b, p)[0]
            p += 4
            size = (off + ln - p) // n if n else 0
            out = []
            for i in range(n):
                o = p + i * size
                origin = struct.unpack_from('<3f', b, o)
                angles = struct.unpack_from('<3f', b, o + 12)
                ptype, _fl, _lc, solid, flags = struct.unpack_from('<HHHBB', b, o + 24)
                skin = struct.unpack_from('<i', b, o + 32)[0]
                d = {'model': names[ptype], 'origin': list(origin), 'angles': list(angles), 'skin': skin, 'solid': solid, 'flags': flags}
                if ver >= 11 and size >= 76:
                    d['scale'] = struct.unpack_from('<f', b, o + size - 4)[0]
                out.append(d)
            return out
        return []

    def overlays(self):
        """Overlays (info_overlay): texinfo, U/V ranges, the four corner points, origin, basis."""
        d = self.lump(L_OVERLAYS)
        out = []
        for i in range(len(d) // 352):
            o = i * 352
            ti = struct.unpack_from('<h', d, o + 4)[0]
            u = struct.unpack_from('<2f', d, o + 264)
            v = struct.unpack_from('<2f', d, o + 272)
            uv = [struct.unpack_from('<3f', d, o + 280 + k * 12) for k in range(4)]
            origin = struct.unpack_from('<3f', d, o + 328)
            normal = struct.unpack_from('<3f', d, o + 340)
            # The basis U axis rides in the z of the first three UV points.
            bu = [uv[0][2], uv[1][2], uv[2][2]]
            out.append({'texinfo': ti, 'u': u, 'v': v, 'uv': [p[:2] for p in uv], 'origin': origin, 'normal': normal, 'basisu': bu})
        return out


def clean_material(name: str) -> str:
    """A BSP's material name as the game files name it: lower case, cube-map patches (maps/<map>/x_-12_34_56) undone."""
    n = name.lower().replace('\\', '/')
    m = re.match(r'^maps/[^/]+/(.*?)(?:_-?\d+_-?\d+_-?\d+)?$', n)
    if m:
        n = m.group(1)
    return re.sub(r'_depth_-?\d+$', '', n)
