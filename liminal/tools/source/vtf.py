"""
Decode Valve Texture Format (VTF 7.0-7.5) files: the largest mip of the first
frame (and first face of cube maps) as a PIL image.

    python3 tools/source/vtf.py in.vtf out.png

Formats: DXT1/3/5 (via Pillow's DDS decoder), 8-bit RGB/RGBA orders, I8,
IA88, A8, UV88, RGBA16161616F (tone-mapped linear HDR, stored as 8-bit).
"""
import io, struct, sys
import numpy as np
from PIL import Image

FMT = {0: 'RGBA8888', 1: 'ABGR8888', 2: 'RGB888', 3: 'BGR888', 4: 'RGB565', 5: 'I8', 6: 'IA88', 8: 'A8', 11: 'ARGB8888', 12: 'BGRA8888',
       13: 'DXT1', 14: 'DXT3', 15: 'DXT5', 16: 'BGRX8888', 17: 'BGR565', 20: 'DXT1A', 22: 'UV88', 24: 'RGBA16161616F', 25: 'RGBA16161616'}
BPP = {'RGBA8888': 4, 'ABGR8888': 4, 'RGB888': 3, 'BGR888': 3, 'RGB565': 2, 'I8': 1, 'IA88': 2, 'A8': 1, 'ARGB8888': 4, 'BGRA8888': 4,
       'BGRX8888': 4, 'BGR565': 2, 'UV88': 2, 'RGBA16161616F': 8, 'RGBA16161616': 8}
TEXTUREFLAGS_ENVMAP = 0x4000


def size_of(fmt: str, w: int, h: int) -> int:
    if fmt in ('DXT1', 'DXT1A'):
        return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 8
    if fmt in ('DXT3', 'DXT5'):
        return max(1, (w + 3) // 4) * max(1, (h + 3) // 4) * 16
    return w * h * BPP[fmt]


def info(data: bytes) -> dict:
    assert data[:4] == b'VTF\0', 'not a VTF'
    vmaj, vmin, hsize = struct.unpack_from('<III', data, 4)
    w, h, flags, frames, first = struct.unpack_from('<HHIHH', data, 16)
    refl = struct.unpack_from('<fff', data, 32)
    bumpscale, hifmt, mips, lofmt, lw, lh = struct.unpack_from('<fiBiBB', data, 48)
    depth = struct.unpack_from('<H', data, 63)[0] if vmin >= 2 else 1
    return {'version': (vmaj, vmin), 'header': hsize, 'w': w, 'h': h, 'flags': flags, 'frames': max(1, frames), 'reflectivity': refl,
            'format': FMT.get(hifmt, f'?{hifmt}'), 'mips': mips, 'lofmt': FMT.get(lofmt) if lofmt >= 0 else None, 'lw': lw, 'lh': lh,
            'depth': max(1, depth), 'faces': (7 if vmin < 5 and first == 0xFFFF else 6) if flags & TEXTUREFLAGS_ENVMAP else 1}


def high_res_offset(data: bytes, i: dict) -> int:
    vmin = i['version'][1]
    if vmin >= 3:
        nres = struct.unpack_from('<I', data, 68)[0]
        for k in range(nres):
            tag, flags, off = struct.unpack_from('<3sBI', data, 80 + 8 * k)
            if tag == b'\x30\0\0':
                return off
    lo = size_of(i['lofmt'], i['lw'], i['lh']) if i['lofmt'] else 0
    return i['header'] + lo


def decode(data: bytes) -> Image.Image:
    i = info(data)
    fmt, W, H = i['format'], i['w'], i['h']
    # Mips are stored smallest first; the largest (mip 0) is last.
    off = high_res_offset(data, i)
    per_mip = lambda m: size_of(fmt, max(1, W >> m), max(1, H >> m)) * i['frames'] * i['faces'] * max(1, i['depth'] >> m)
    for m in range(i['mips'] - 1, 0, -1):
        off += per_mip(m)
    raw = data[off: off + size_of(fmt, W, H)]
    if fmt in ('DXT1', 'DXT1A', 'DXT3', 'DXT5'):
        four = b'DXT1' if fmt.startswith('DXT1') else fmt.encode()
        hdr = struct.pack('<4s7I44s8I5I', b'DDS ', 124, 0x1007 | 0x80000, H, W, len(raw), 0, 1, b'\0' * 44,
                          32, 4, int.from_bytes(four, 'little'), 0, 0, 0, 0, 0, 0x1000, 0, 0, 0, 0)
        return Image.open(io.BytesIO(hdr + raw)).convert('RGBA')
    a = np.frombuffer(raw, np.uint8)
    if fmt == 'RGBA8888': px = a.reshape(H, W, 4)
    elif fmt == 'ABGR8888': px = a.reshape(H, W, 4)[..., [3, 2, 1, 0]]
    elif fmt == 'ARGB8888': px = a.reshape(H, W, 4)[..., [1, 2, 3, 0]]
    elif fmt == 'BGRA8888': px = a.reshape(H, W, 4)[..., [2, 1, 0, 3]]
    elif fmt == 'BGRX8888': px = np.concatenate([a.reshape(H, W, 4)[..., [2, 1, 0]], np.full((H, W, 1), 255, np.uint8)], -1)
    elif fmt == 'RGB888': px = np.concatenate([a.reshape(H, W, 3), np.full((H, W, 1), 255, np.uint8)], -1)
    elif fmt == 'BGR888': px = np.concatenate([a.reshape(H, W, 3)[..., ::-1], np.full((H, W, 1), 255, np.uint8)], -1)
    elif fmt == 'I8': g = a.reshape(H, W, 1); px = np.concatenate([g, g, g, np.full((H, W, 1), 255, np.uint8)], -1)
    elif fmt == 'IA88': g = a.reshape(H, W, 2); px = np.concatenate([g[..., :1]] * 3 + [g[..., 1:]], -1)
    elif fmt == 'A8': g = a.reshape(H, W, 1); px = np.concatenate([np.full((H, W, 3), 255, np.uint8), g], -1)
    elif fmt == 'UV88': g = a.reshape(H, W, 2); px = np.concatenate([g, np.full((H, W, 1), 255, np.uint8), np.full((H, W, 1), 255, np.uint8)], -1)
    elif fmt == 'RGBA16161616F':
        f = np.frombuffer(raw, np.float16).reshape(H, W, 4).astype(np.float32)
        px = (np.clip(f, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
    elif fmt == 'RGBA16161616':
        px = (np.frombuffer(raw, np.uint16).reshape(H, W, 4) >> 8).astype(np.uint8)
    elif fmt in ('RGB565', 'BGR565'):
        v = np.frombuffer(raw, np.uint16).reshape(H, W)
        r, g, b = ((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31
        if fmt == 'BGR565': r, b = b, r
        px = np.stack([r, g, b, np.full_like(r, 255)], -1).astype(np.uint8)
    else:
        raise ValueError(f'unsupported VTF format {fmt}')
    return Image.fromarray(np.ascontiguousarray(px), 'RGBA')


if __name__ == '__main__':
    d = open(sys.argv[1], 'rb').read()
    print(info(d))
    decode(d).save(sys.argv[2])
