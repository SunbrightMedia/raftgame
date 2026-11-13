#!/usr/bin/env python3
"""
capture.py: the user's capture of The Complex (branch complex-capture, first export) as inputs for dxbc.py.

    frame(dir) -> Frame: its steps (passes/*.json), shaders, constants and saved pictures.

Study only (see dxbc.py). The capture's pictures are 8-bit JPEGs (an exact export is complex_deep.ps1's job).
"""
import glob
import json
import os

import numpy as np

import dxbc


class Frame:
    def __init__(self, folder):
        self.dir = folder
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
        if shader not in self._progs:
            self._progs[shader] = dxbc.Program(open(os.path.join(self.dir, 'shaders', shader + '.txt')).read(), exact=exact)
        return self._progs[shader]

    def constants(self, step, stage):
        """{slot: (rows, 4) uint32} for a step's shader stage, from the capture's numbers (float rows)."""
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
