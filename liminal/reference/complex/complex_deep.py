# Deep export of RenderDoc frame captures of The Complex: Expedition: the numbers behind its lighting.
#
# complex_export.py saved every drawing step, but only one set of shader numbers per step and pictures as
# 8-bit JPEGs. That hid what the lighting is made of: of the 14 to 73 lamps drawn in a frame, only one
# lamp's numbers were kept, and the HDR light buffers were cut to 256 steps. This reads the SAME captures
# again (nothing new is recorded) and writes, per frame, into <out>/<capture name>/:
#
#  - lights.json   the shader numbers of EVERY draw and dispatch in the lighting steps: each lamp's
#                  position, range, colour and brightness, direction, cone and size (only the blocks that
#                  change from draw to draw are repeated)
#  - buffers.json + buffers/*.bin.z
#                  raw contents of the data buffers the light-list and Lumen light steps read (the list of
#                  every lamp in view, as the engine packs it)
#  - targets.json + targets/*.bin.z
#                  lossless copies (raw bytes, zlib) of what key steps drew: depth, the G-buffer (normals,
#                  material, base colour and their alpha channels), the scene light after the emissive base
#                  pass, after the bounce light, after the lamps, the bounce light itself (Lumen), the
#                  upscaled picture, after motion blur, and the glow
#  - errors.txt
#
# Step numbers are the same as in complex_export.py's export (same way of splitting the frame into steps),
# so the two exports line up. Never the game's own textures or models: only what the graphics card computed
# for this frame.
#
# Runs inside RenderDoc (written for RenderDoc 1.47, same calls as complex_export.py):
#  - by complex_deep.ps1, which starts "qrenderdoc --ui-py" with a config file listing the captures, or
#  - by hand: open a capture, then Window > Python Shell > Run Script, choose this file. The export goes
#    into a folder next to the capture.
# It only reads the captures. Nothing is changed.
import json
import os
import struct
import time
import traceback
import zlib

import renderdoc as rd

CONFIG = os.path.join(os.environ.get('TEMP', os.path.expanduser('~')), 'complex_deep_config.json')
MAX_BUFFER = 16 * 1024 * 1024   # bytes kept of one data buffer
MIN_SIDE = 64                   # targets smaller than this are skipped
MAX_TEXELS = 2560 * 1440        # targets larger than this are skipped (Lumen's atlases)

# Steps whose shader numbers are kept for every single draw/dispatch (the lamps).
LIGHT_STEPS = ('BatchedLights', 'Lights', 'DirectLighting', 'LightGrid', 'CullLights', 'LightFunction', 'Shadow')
# Steps whose data buffers are kept (the packed list of lamps).
BUFFER_STEPS = ('LightGrid', 'CullLights', 'LumenSceneLighting', 'BatchedLights', 'DirectLighting')
# Steps whose drawn targets are kept losslessly (after the last step of each run of steps with the same name).
TARGET_STEPS = ('PrePass', 'BasePass', 'DiffuseIndirectComposite', 'LumenScreenProbeGather / Integrate',
                'LumenScreenProbeGather / TemporalReprojection', 'ShortRangeAO', 'BatchedLights', 'ExponentialHeightFog',
                'PostProcessing / TAA', 'MotionBlur FullResFilter', 'Bloom')
# Depth of field's own half-size copies, Lumen's atlases, the translucency light volume.
SKIP_TARGET_STEPS = ('DOF', 'LumenSceneLighting', 'Inject')


def rid(x):
    return str(x)


def isnull(x):
    return x == rd.ResourceId()


def has(path, words):
    p = ' / '.join(path)
    return any(w in p for w in words)


class Deep:
    def __init__(self, controller, out, progress):
        self.c = controller
        self.out = out
        self.progress = progress
        self.errors = []
        self.sd = controller.GetStructuredFile()
        self.tex = {rid(t.resourceId): t for t in controller.GetTextures()}
        self.buf = {rid(b.resourceId): b for b in controller.GetBuffers()}
        self.names = {rid(r.resourceId): r.name for r in controller.GetResources()}
        self.saved_buffers = {}
        for sub in ('targets', 'buffers'):
            os.makedirs(os.path.join(out, sub), exist_ok=True)

    def err(self, where, e):
        self.errors.append('%s: %s\n%s' % (where, e, traceback.format_exc()))

    def name(self, r):
        return self.names.get(rid(r), rid(r))

    def write_json(self, rel, data):
        with open(os.path.join(self.out, rel), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=1)

    def write_z(self, rel, raw):
        z = zlib.compress(bytes(raw), 6)
        with open(os.path.join(self.out, rel), 'wb') as f:
            f.write(z)
        return len(z)

    # ---- the same steps as complex_export.py
    def leaves(self):
        want = (rd.ActionFlags.Drawcall | rd.ActionFlags.Dispatch | rd.ActionFlags.MeshDispatch | rd.ActionFlags.Clear |
                rd.ActionFlags.Copy | rd.ActionFlags.Resolve | rd.ActionFlags.GenMips | rd.ActionFlags.Present)
        out = []

        def walk(actions, path):
            for a in actions:
                nm = a.GetName(self.sd)
                if len(a.children) > 0:
                    walk(a.children, path + [nm])
                elif a.flags & want:
                    out.append((a, path, nm))
        walk(self.c.GetRootActions(), [])
        return out

    def kind(self, a):
        f = a.flags
        if f & (rd.ActionFlags.Dispatch | rd.ActionFlags.MeshDispatch):
            return 'dispatch'
        if f & rd.ActionFlags.Drawcall:
            return 'draw'
        if f & rd.ActionFlags.Clear:
            return 'clear'
        if f & rd.ActionFlags.Present:
            return 'present'
        return 'copy'

    def passes(self, leaves):
        ps, cur = [], None
        for a, path, nm in leaves:
            k = self.kind(a)
            sig = (k, tuple(rid(o) for o in a.outputs if not isnull(o)), rid(a.depthOut))
            if cur is None or k in ('dispatch', 'copy', 'present') or cur['sig'] != sig:
                cur = {'sig': sig, 'kind': k, 'actions': [], 'path': path}
                ps.append(cur)
            cur['actions'].append((a, nm))
        return ps

    # ---- shader numbers
    def pipe_object(self, pipe, stage):
        return pipe.GetComputePipelineObject() if stage == rd.ShaderStage.Compute else pipe.GetGraphicsPipelineObject()

    def var(self, v):
        if len(v.members) > 0:
            return {'name': v.name, 'members': [self.var(m) for m in v.members]}
        n = max(1, v.rows) * max(1, v.columns)
        if v.type in (rd.VarType.UInt, rd.VarType.UShort, rd.VarType.UByte, rd.VarType.Bool):
            vals = list(v.value.u32v[:n])
        elif v.type in (rd.VarType.SInt, rd.VarType.SShort, rd.VarType.SByte):
            vals = list(v.value.s32v[:n])
        else:
            vals = [float(x) for x in v.value.f32v[:n]]
        return {'name': v.name, 'v': vals}

    def blocks(self, pipe, stage, sh):
        """All constant blocks bound to this stage, as numbers, plus their raw bytes as floats and as uints."""
        out = []
        refl = pipe.GetShaderReflection(stage)
        entry = pipe.GetShaderEntryPoint(stage)
        n = len(refl.constantBlocks) if refl is not None else 0
        for idx in range(n):
            cb = refl.constantBlocks[idx]
            rec = {'block': cb.name, 'slot': idx, 'bytes': cb.byteSize}
            try:
                d = pipe.GetConstantBlock(stage, idx, 0).descriptor
                raw = b''
                if not isnull(d.resource) and d.byteSize:
                    raw = self.c.GetBufferData(d.resource, d.byteOffset, min(d.byteSize, cb.byteSize or d.byteSize))
                if len(raw) >= 4:
                    # The block's bytes as floats and as unsigned ints (the engine packs some as bits).
                    k = len(raw) // 4
                    rec['f'] = list(struct.unpack('<%df' % k, raw[:k * 4]))
                    rec['u'] = list(struct.unpack('<%dI' % k, raw[:k * 4]))
                else:
                    vs = self.c.GetCBufferVariableContents(self.pipe_object(pipe, stage), sh, stage, entry, idx, d.resource, d.byteOffset, d.byteSize)
                    rec['vars'] = [self.var(v) for v in vs]
            except Exception as e:
                rec['error'] = str(e)
            out.append(rec)
        return out

    def buffers_read(self, pipe, stage, step, event):
        refs = []
        try:
            for ud in pipe.GetReadOnlyResources(stage, True):
                d = ud.descriptor
                key = rid(d.resource)
                if isnull(d.resource) or key not in self.buf:
                    continue
                info = {'id': key, 'name': self.name(d.resource), 'length': self.buf[key].length,
                        'offset': getattr(d, 'byteOffset', 0), 'size': getattr(d, 'byteSize', 0),
                        'element': getattr(d, 'elementByteSize', 0), 'format': str(getattr(d, 'format', ''))}
                fname = 'buffers/%04d_%s.bin.z' % (step, ''.join(ch for ch in key if ch.isdigit()))
                if key not in self.saved_buffers:
                    raw = self.c.GetBufferData(d.resource, 0, min(self.buf[key].length, MAX_BUFFER))
                    info['saved_bytes'] = len(raw)
                    info['z_bytes'] = self.write_z(fname, raw)
                    info['file'] = fname
                    info['event'] = event
                    self.saved_buffers[key] = fname
                else:
                    info['same_as'] = self.saved_buffers[key]
                refs.append(info)
        except Exception as e:
            self.err('buffers at %d' % event, e)
        return refs

    def light_step(self, i, p):
        rec = {'step': i, 'markers': p['path'], 'kind': p['kind'], 'draws': []}
        stages = [rd.ShaderStage.Compute] if p['kind'] == 'dispatch' else [rd.ShaderStage.Vertex, rd.ShaderStage.Pixel]
        first = {}
        for a, nm in p['actions']:
            self.c.SetFrameEvent(a.eventId, False)
            pipe = self.c.GetPipelineState()
            d = {'event': a.eventId, 'name': nm}
            try:
                d['instances'] = a.numInstances
                d['indices'] = a.numIndices
                d['groups'] = list(a.dispatchDimension)
            except Exception:
                pass
            for st in stages:
                sh = pipe.GetShader(st)
                if isnull(sh):
                    continue
                sn = {rd.ShaderStage.Vertex: 'vs', rd.ShaderStage.Pixel: 'ps', rd.ShaderStage.Compute: 'cs'}[st]
                d[sn] = rid(sh)
                try:
                    bl = self.blocks(pipe, st, sh)
                except Exception as e:
                    self.err('constants at %d' % a.eventId, e)
                    continue
                # Repeat only what changed since the first draw with this shader (the lamp's own numbers).
                key = (sn, rid(sh))
                if key in first:
                    prev = first[key]
                    bl = [b for k, b in enumerate(bl) if k >= len(prev) or b.get('f') != prev[k].get('f')]
                else:
                    first[key] = bl
                d[sn + '_blocks'] = bl
                if has(p['path'], BUFFER_STEPS) and (key not in rec.get('_buffers_done', set())):
                    rec.setdefault('_buffers_done', set()).add(key)
                    d[sn + '_buffers'] = self.buffers_read(pipe, st, i, a.eventId)
            rec['draws'].append(d)
        rec.pop('_buffers_done', None)
        return rec

    # ---- lossless targets
    def save_target(self, res, step, k, markers):
        t = self.tex.get(rid(res))
        if t is None or t.width < MIN_SIDE or t.height < MIN_SIDE or t.width * t.height > MAX_TEXELS:
            return None
        fmt = t.format.Name()
        if 'R32G32B32' in fmt:      # the glow's FFT work buffers (complex numbers), not pictures
            return None
        sub = rd.Subresource()
        sub.mip, sub.slice, sub.sample = 0, 0, 0
        raw = self.c.GetTextureData(res, sub)
        fname = 'targets/%04d_%d_%s.bin.z' % (step, k, ''.join(ch for ch in rid(res) if ch.isdigit()))
        rec = {'step': step, 'markers': markers, 'file': fname, 'id': rid(res), 'name': self.name(res),
               'w': t.width, 'h': t.height, 'format': fmt, 'bytes': len(raw),
               'bytes_per_texel': round(len(raw) / float(t.width * t.height), 3)}
        try:
            mn, mx = self.c.GetMinMax(res, sub, rd.CompType.Typeless)
            rec['min'], rec['max'] = list(mn.floatValue), list(mx.floatValue)
        except Exception as e:
            self.err('min/max of step %d' % step, e)
        rec['z_bytes'] = self.write_z(fname, raw)
        return rec

    def target_step(self, i, p):
        last = p['actions'][-1][0]
        self.c.SetFrameEvent(last.eventId, True)
        outs = [o for o in last.outputs if not isnull(o)]
        if p['kind'] == 'dispatch':
            outs = []
            try:
                for ud in self.c.GetPipelineState().GetReadWriteResources(rd.ShaderStage.Compute, True):
                    r = ud.descriptor.resource
                    if not isnull(r) and rid(r) in self.tex:
                        outs.append(r)
            except Exception as e:
                self.err('outputs of step %d' % i, e)
        if not isnull(last.depthOut):
            outs.append(last.depthOut)
        res = []
        for k, o in enumerate(outs):
            try:
                r = self.save_target(o, i, k, p['path'])
                if r:
                    res.append(r)
            except Exception as e:
                self.err('target of step %d' % i, e)
        return res

    def run(self, label):
        t0 = time.time()
        leaves = self.leaves()
        ps = self.passes(leaves)
        n = len(ps)
        lights, targets = [], []
        for i, p in enumerate(ps):
            if i % 25 == 0:
                self.progress('%s: step %d of %d' % (label, i, n))
            if p['kind'] in ('draw', 'dispatch') and has(p['path'], LIGHT_STEPS):
                try:
                    lights.append(self.light_step(i, p))
                except Exception as e:
                    self.err('light step %d' % i, e)
            # Targets after the last step of each run of steps with the same markers.
            nxt = ps[i + 1]['path'] if i + 1 < n else None
            if (p['kind'] in ('draw', 'dispatch') and has(p['path'], TARGET_STEPS) and not has(p['path'], SKIP_TARGET_STEPS)
                    and nxt != p['path']):
                targets.extend(self.target_step(i, p))
        # The last picture on screen, raw (the JPEG of the first export had an extra sRGB curve).
        for t in self.tex.values():
            if t.creationFlags & rd.TextureCategory.SwapBuffer:
                try:
                    self.c.SetFrameEvent(leaves[-1][0].eventId, True)
                    r = self.save_target(t.resourceId, n, 0, ['final'])
                    if r:
                        targets.append(r)
                except Exception as e:
                    self.err('final picture', e)
                break
        self.write_json('lights.json', lights)
        self.write_json('targets.json', targets)
        self.write_json('buffers.json', {'saved': self.saved_buffers})
        self.write_json('deep.json', {'steps': n, 'light_steps': len(lights), 'targets': len(targets),
                                      'buffers': len(self.saved_buffers), 'seconds': round(time.time() - t0, 1)})
        with open(os.path.join(self.out, 'errors.txt'), 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(self.errors) if self.errors else 'no errors\n')
        return n, len(lights), len(targets)


def export_controller(controller, out, progress, label):
    d = Deep(controller, out, progress)
    n, nl, nt = d.run(label)
    progress('%s: done, %d steps, %d lighting steps, %d targets, %d buffers, %d errors' % (label, n, nl, nt, len(d.saved_buffers), len(d.errors)))


def export_file(path, out, progress, label):
    cap = rd.OpenCaptureFile()
    try:
        r = cap.OpenFile(path, '', None)
        if hasattr(r, 'OK') and not r.OK():
            progress('%s: could not open (%s)' % (label, r.Message()))
            return
        if cap.LocalReplaySupport() != rd.ReplaySupport.Supported:
            progress('%s: this PC cannot replay it' % label)
            return
        result, controller = cap.OpenCapture(rd.ReplayOptions(), None)
        if hasattr(result, 'OK') and not result.OK():
            progress('%s: could not replay (%s)' % (label, result.Message()))
            return
        try:
            export_controller(controller, out, progress, label)
        finally:
            controller.Shutdown()
    finally:
        cap.Shutdown()


def main():
    if os.path.exists(CONFIG):
        with open(CONFIG, encoding='utf-8-sig') as f:
            cfg = json.load(f)
        log = cfg.get('progress') or os.path.join(cfg['out'], 'progress.txt')

        def progress(msg):
            print(msg)
            with open(log, 'a', encoding='utf-8') as fh:
                fh.write(msg + '\n')
        caps = cfg['captures']
        for k, path in enumerate(caps):
            label = 'frame %d of %d' % (k + 1, len(caps))
            out = os.path.join(cfg['out'], os.path.splitext(os.path.basename(path))[0])
            try:
                export_file(path, out, progress, label)
            except Exception as e:
                progress('%s: failed: %s\n%s' % (label, e, traceback.format_exc()))
        progress('ALL DONE')
        os.remove(CONFIG)
        if cfg.get('quit'):
            os._exit(0)
    elif 'pyrenderdoc' in globals() and pyrenderdoc.IsCaptureLoaded():   # noqa: F821 (given by RenderDoc's UI)
        path = pyrenderdoc.GetCaptureFilename()                          # noqa: F821
        out = os.path.splitext(path)[0] + '_deep'
        pyrenderdoc.Replay().BlockInvoke(lambda c: export_controller(c, out, print, os.path.basename(path)))   # noqa: F821
        print('Deep export written to ' + out)
    else:
        print('Open a capture first (File > Open Capture), then run this script again.')


main()
