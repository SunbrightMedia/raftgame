#!/usr/bin/env python3
"""
deep.py: the deep export (complex_deep.ps1; branch complex-capture, folder deep) as numpy arrays.

    d = Deep('<deep>/complex_frame18325')
    d.target(415)            # what step 415 drew (lossless), float32 (H, W, 4) or (D, H, W, 4), row 0 = top
    d.target(417, 'input')   # a picture step 417 read that no earlier step of the export kept
    d.buffer(8180)           # a data buffer by resource number, raw bytes

Study only: every picture here is what the graphics card computed for the user's captured frame.
"""
import json
import os
import zlib

import numpy as np


def _small_float(bits, mant):
    """Unsigned float with 5 exponent bits and `mant` mantissa bits (R11G11B10's channels)."""
    bits = bits.astype(np.uint32)
    e = (bits >> mant).astype(np.int32)
    m = (bits & ((1 << mant) - 1)).astype(np.float64)
    v = np.where(e == 0, m / (1 << mant) * 2.0 ** -14, (1 + m / (1 << mant)) * np.exp2(e - 15))
    v = np.where(e == 31, np.where(m == 0, np.inf, np.nan), v)
    return v.astype(np.float32)


def decode(raw, fmt, w, h, depth=1):
    """Raw texture bytes (rows top first, depth slices front to back) -> float32 (.., H, W, 4)."""
    shape = (depth, h, w) if depth > 1 else (h, w)
    if fmt.startswith('R10G10B10A2'):
        v = np.frombuffer(raw, np.uint32).reshape(shape)
        out = np.stack([(v >> s) & 1023 for s in (0, 10, 20)] + [v >> 30], -1).astype(np.float32)
        return out / np.array([1023, 1023, 1023, 3], np.float32)
    if fmt.startswith('R11G11B10'):
        v = np.frombuffer(raw, np.uint32).reshape(shape)
        r, g, b = _small_float(v & 0x7ff, 6), _small_float((v >> 11) & 0x7ff, 6), _small_float(v >> 22, 5)
        return np.stack([r, g, b, np.ones_like(r)], -1)
    if fmt.startswith('R16G16B16A16_FLOAT'):
        return np.frombuffer(raw, np.float16).reshape(shape + (4,)).astype(np.float32)
    if fmt.startswith('R32G32B32A32_FLOAT'):
        return np.frombuffer(raw, np.float32).reshape(shape + (4,)).copy()
    if fmt.startswith('R16G16B16A16_UNORM'):
        return np.frombuffer(raw, np.uint16).reshape(shape + (4,)).astype(np.float32) / 65535
    if fmt.startswith('D32S8') or fmt.startswith('R32G8X24'):
        # depth (float) and stencil, 8 bytes a texel: R = depth, G = stencil
        v = np.frombuffer(raw, np.uint32).reshape(shape + (2,))
        d = v[..., 0].view(np.float32)
        st = (v[..., 1] & 255).astype(np.float32)
        return np.stack([d, st, d * 0, d * 0 + 1], -1)
    if fmt in ('B8G8R8A8_TYPELESS', 'R8G8B8A8_TYPELESS'):     # read as UNORM (raw / 255)
        fmt = fmt.replace('TYPELESS', 'UNORM')
    if fmt.startswith(('R8_UNORM', 'R8_UINT')):
        a = np.frombuffer(raw, np.uint8).reshape(shape).astype(np.float32)
        a = a / 255 if fmt.startswith('R8_UNORM') else a
        return np.stack([a, a * 0, a * 0, a * 0 + 1], -1)
    if fmt.startswith(('R8G8B8A8_UNORM', 'B8G8R8A8_UNORM')):
        a = np.frombuffer(raw, np.uint8).reshape(shape + (4,)).astype(np.float32) / 255
        return a[..., [2, 1, 0, 3]] if fmt.startswith('B8') else a
    if fmt.startswith('R32_FLOAT'):
        a = np.frombuffer(raw, np.float32).reshape(shape)
        return np.stack([a, a * 0, a * 0, a * 0 + 1], -1)
    raise ValueError('format not handled: ' + fmt)


class Deep:
    def __init__(self, folder):
        self.dir = folder
        self.targets = json.load(open(os.path.join(folder, 'targets.json')))
        self.buffers = json.load(open(os.path.join(folder, 'buffers.json')))['saved']

    def find(self, step, role='output', k=None):
        hits = [t for t in self.targets if t['step'] == step and t['role'] == role]
        if k is not None:
            hits = [t for t in hits if os.path.basename(t['file']).split('_')[1] == str(k)]
        if not hits:
            raise KeyError('no %s saved for step %d' % (role, step))
        return hits[0]

    def raw(self, rec):
        return zlib.decompress(open(os.path.join(self.dir, rec['file']), 'rb').read())

    def target(self, step, role='output', k=None):
        rec = self.find(step, role, k)
        return decode(self.raw(rec), rec['format'], rec['w'], rec['h'], rec.get('depth', 1) or 1)

    def light_steps(self):
        """The frame's lighting steps by name: base pass, bounce composite, lamps, fog; and the scene light's
        resource number (the lamps' render target)."""
        def last(word):
            hits = [t['step'] for t in self.targets if word in ' / '.join(t['markers'])]
            return max(hits) if hits else None
        out = {'base': last('BasePass'), 'bounce': last('DiffuseIndirectComposite'), 'lamps': last('BatchedLights'),
               'fog': last('ExponentialHeightFog')}
        rt = [t for t in self.targets if t['step'] == out['lamps'] and t['format'].startswith('R16G16B16A16_FLOAT')]
        out['scene'] = int(rt[0]['id'].split('::')[1]) if rt else None
        return out

    def buffer(self, resource):
        key = 'ResourceId::%d' % resource
        return zlib.decompress(open(os.path.join(self.dir, self.buffers[key]), 'rb').read())
