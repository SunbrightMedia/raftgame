#!/usr/bin/env python3
"""
capture.py: the user's capture of The Complex (branch complex-capture, first export) as inputs for dxbc.py.

    frame(dir) -> Frame: its steps (passes/*.json), shaders, constants and saved pictures.

Study only (see dxbc.py). The capture's pictures are 8-bit JPEGs (an exact export is complex_deep.ps1's job).
"""
import glob
import json
import os
import zlib

import numpy as np

import dxbc
import dxbc_bytes


class Frame:
    def __init__(self, folder, deep=None):
        """deep: the same frame in the deep export (its shaders' bytes give exact numbers). By default taken
        from $COMPLEX_DEEP (the folder holding the deep export's complex_frame* folders), when it has this frame."""
        self.dir = folder
        if deep is None and os.environ.get('COMPLEX_DEEP'):
            cand = os.path.join(os.environ['COMPLEX_DEEP'], os.path.basename(os.path.normpath(folder)))
            deep = cand if os.path.isdir(cand) else None
        self.deep = deep
        self.steps = {}
        for pf in glob.glob(os.path.join(folder, 'passes', '*.json')):
            p = json.load(open(pf))
            self.steps[p['index']] = p
        self._progs = {}

    def find(self, shader):
        """The last step that uses this shader (e.g. 'ps_8878')."""
        hit = None
        for i in sorted(self.steps):
            names = [os.path.basename(x)[:-4] for v in (self.steps[i].get('shaders') or {}).values() for x in v]
            if shader in names:
                hit = self.steps[i]
        return hit

    def program(self, shader, exact=None):
        """The shader as dxbc.Program. With the deep export, every written number is exact (from the shader's
        bytes, prog.exact = True); otherwise as the disassembly prints them, snapped to simple values."""
        if shader not in self._progs:
            text = open(os.path.join(self.dir, 'shaders', shader + '.txt')).read()
            blob = os.path.join(self.deep, 'shaders', shader + '.dxbc.z') if self.deep else None
            if blob and os.path.exists(blob):
                prog = dxbc.Program(text, snap=False)
                dxbc_bytes.apply(prog, zlib.decompress(open(blob, 'rb').read()))
                prog.exact = True
            else:
                prog = dxbc.Program(text, exact=exact)
                prog.exact = False
            self._progs[shader] = prog
        return self._progs[shader]

    def _deep_steps(self):
        if getattr(self, '_dsteps', None) is None:
            self._dsteps = {}
            if self.deep:
                path = os.path.join(self.deep, 'steps.json.z')
                if os.path.exists(path):
                    for rec in json.loads(zlib.decompress(open(path, 'rb').read())):
                        self._dsteps[rec['step']] = rec
                path = os.path.join(self.deep, 'lights.json')
                if os.path.exists(path):
                    for rec in json.load(open(path)):
                        self._dsteps[rec['step']] = rec
        return self._dsteps

    def deep_constants(self, step, stage, draw=-1):
        """{slot: (rows, 4) uint32} from the deep export: the blocks' own bytes (exact), for one draw of the step
        (default the last; a draw repeats only the blocks that changed since the first, so they are merged)."""
        rec = self._deep_steps().get(step['index'])
        if not rec or not rec.get('draws'):
            return None
        draws = rec['draws']
        draw = draw % len(draws)
        blocks = {}
        for d in (draws[0], draws[draw]) if draw else (draws[0],):
            for b in d.get(stage + '_blocks') or []:
                if 'u' in b:
                    slot = int(b['block'].replace('cbuffer', '')) if b['block'].startswith('cbuffer') else b['slot']
                    words = list(b['u']) + [0] * (-len(b['u']) % 4)
                    blocks[slot] = np.array(words, np.uint32).reshape(-1, 4)
        return blocks or None

    def constants(self, step, stage):
        """{slot: (rows, 4) uint32} for a step's shader stage. With the deep export: its exact bytes. Otherwise
        the first export's numbers (float rows, rounded to 6 significant digits: 1 / 1440 reads 0.000694)."""
        exact = self.deep_constants(step, stage)
        if exact is not None:
            return exact
        out = {}
        blocks = list((step.get('constants') or {}).get(stage, {}).values())
        if not blocks:
            return out
        for k, blk in enumerate(blocks[0]):
            rows = []
            for v in blk.get('vars', []):
                vals = list(v['v']) + [0.0] * (4 - len(v['v']))
                rows.append(vals[:4])
            slot = int(blk['block'].replace('cbuffer', '')) if blk['block'].startswith('cbuffer') else k
            out[slot] = dxbc.cb_from_floats(rows) if rows else np.zeros((0, 4), np.uint32)
        return out

    def image(self, step, k=0):
        """A step's saved picture (JPEG, 0..1, rows top first), and its stretch (black, white)."""
        from PIL import Image
        im = step['images'][k]
        a = np.asarray(Image.open(os.path.join(self.dir, im['file'])).convert('RGB')).astype(np.float32) / 255
        return a, (im.get('black', 0.0), im.get('white', 1.0))
