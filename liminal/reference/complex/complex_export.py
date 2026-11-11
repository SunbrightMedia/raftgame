# Exports RenderDoc frame captures so the frame can be studied away from the PC it was made on:
# every drawing step ("pass") in order, the picture each step drew, every shader the graphics card
# ran (as disassembly, and as source if the game kept any), the numbers each shader was given
# (constant buffers), and which textures each step read (names and sizes only, never the pixels
# of the game's own textures).
#
# Runs inside RenderDoc (written for RenderDoc 1.47):
#  - by complex_capture.ps1, which starts "qrenderdoc --ui-py" with a config file listing the
#    captures (then it exports them all and closes RenderDoc), or
#  - by hand: open a capture in RenderDoc, then Window > Python Shell > Run Script, choose this
#    file. The export goes into a folder next to the capture.
# It only reads the captures. Nothing is changed.
import json
import os
import struct
import time
import traceback

import renderdoc as rd

CONFIG = os.path.join(os.environ.get('TEMP', os.path.expanduser('~')), 'complex_capture_config.json')
MAX_IMAGES = 400          # pictures of steps per capture (a frame has a few hundred steps)
MIN_SIDE = 16             # targets smaller than this are not saved as pictures
JPEG_QUALITY = 85
MAX_CB_BYTES = 8192       # raw constant-buffer bytes kept when a shader has no reflection data


def rid(x):
    return str(x)


def isnull(x):
    return x == rd.ResourceId()


def num(key):
    return ''.join(ch for ch in key if ch.isdigit()) or key.replace(':', '_')


STAGE_NAMES = {rd.ShaderStage.Vertex: 'vs', rd.ShaderStage.Hull: 'hs', rd.ShaderStage.Domain: 'ds',
               rd.ShaderStage.Geometry: 'gs', rd.ShaderStage.Pixel: 'ps', rd.ShaderStage.Compute: 'cs'}


class Exporter:
    def __init__(self, controller, out, progress):
        self.c = controller
        self.out = out
        self.progress = progress
        self.errors = []
        self.sd = controller.GetStructuredFile()
        self.tex = {rid(t.resourceId): t for t in controller.GetTextures()}
        self.names = {rid(r.resourceId): r.name for r in controller.GetResources()}
        self.shaders = {}         # shader key -> file
        self.images = 0
        self.targets = None
        for sub in ('passes', 'images', 'shaders'):
            os.makedirs(os.path.join(out, sub), exist_ok=True)

    # ---- small helpers
    def err(self, where, e):
        self.errors.append('%s: %s\n%s' % (where, e, traceback.format_exc()))

    def name(self, r):
        return self.names.get(rid(r), rid(r))

    def texinfo(self, r):
        t = self.tex.get(rid(r))
        if t is None:
            return {'id': rid(r), 'name': self.name(r)}
        return {'id': rid(r), 'name': self.name(r), 'w': t.width, 'h': t.height, 'depth': t.depth,
                'mips': t.mips, 'array': t.arraysize, 'format': t.format.Name(), 'samples': t.msSamp}

    def write_json(self, rel, data):
        with open(os.path.join(self.out, rel), 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=1)

    # ---- the frame as a list of steps
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
        """Consecutive draws into the same targets make one step; every dispatch, copy and present is its own."""
        ps, cur = [], None
        for a, path, nm in leaves:
            k = self.kind(a)
            sig = (k, tuple(rid(o) for o in a.outputs if not isnull(o)), rid(a.depthOut))
            if cur is None or k in ('dispatch', 'copy', 'present') or cur['sig'] != sig:
                cur = {'sig': sig, 'kind': k, 'actions': [], 'path': path}
                ps.append(cur)
            cur['actions'].append((a, nm))
        return ps

    # ---- shaders
    def pipe_object(self, pipe, stage):
        return pipe.GetComputePipelineObject() if stage == rd.ShaderStage.Compute else pipe.GetGraphicsPipelineObject()

    def describe_reflection(self, refl):
        lines = ['entry point: %s' % refl.entryPoint]
        for i, cb in enumerate(refl.constantBlocks):
            lines.append('constant block %d "%s" (%d bytes)' % (i, cb.name, cb.byteSize))
            for v in cb.variables:
                t = v.type
                lines.append('    +%-5d %s %s %dx%d%s' % (v.byteOffset, t.name, v.name, t.rows, t.columns, ' [%d]' % t.elements if t.elements > 1 else ''))
        for i, r in enumerate(refl.readOnlyResources):
            lines.append('read  %d "%s" (%s)' % (i, r.name, r.textureType))
        for i, r in enumerate(refl.readWriteResources):
            lines.append('write %d "%s" (%s)' % (i, r.name, r.textureType))
        for i, s in enumerate(refl.samplers):
            lines.append('sampler %d "%s"' % (i, s.name))
        for sig in refl.inputSignature:
            lines.append('in  %s%d' % (sig.semanticName, sig.semanticIndex))
        for sig in refl.outputSignature:
            lines.append('out %s%d' % (sig.semanticName, sig.semanticIndex))
        return '\n'.join(lines)

    def export_shader(self, pipe, stage, sh, refl):
        key = rid(sh)
        if key in self.shaders:
            return self.shaders[key]
        fname = 'shaders/%s_%s.txt' % (STAGE_NAMES.get(stage, 'sh'), num(key))
        self.shaders[key] = fname
        parts = ['shader %s, stage %s, name "%s"' % (key, STAGE_NAMES.get(stage, stage), self.name(sh))]
        if refl is None:
            parts.append('(no reflection data)')
        else:
            try:
                parts.append(self.describe_reflection(refl))
            except Exception as e:
                self.err('reflection ' + key, e)
            try:
                if self.targets is None:
                    self.targets = list(self.c.GetDisassemblyTargets(True))
                for tgt in (self.targets or ['']):
                    parts.append('\n==================== disassembly: %s ====================\n' % (tgt or 'default'))
                    parts.append(self.c.DisassembleShader(self.pipe_object(pipe, stage), refl, tgt))
            except Exception as e:
                self.err('disassembly ' + key, e)
            try:
                # Some games ship their shaders with the source text inside: if so, keep it.
                files = refl.debugInfo.files
                for i, f in enumerate(files):
                    src = 'shaders/%s_%s_src%d_%s' % (STAGE_NAMES.get(stage, 'sh'), num(key), i, os.path.basename(f.filename or 'source.hlsl'))
                    with open(os.path.join(self.out, src), 'w', encoding='utf-8') as fh:
                        fh.write(f.contents)
                    parts.append('source file kept: ' + src)
            except Exception as e:
                self.err('debug source ' + key, e)
        with open(os.path.join(self.out, fname), 'w', encoding='utf-8') as fh:
            fh.write('\n'.join(parts))
        return fname

    # ---- the numbers a shader was given
    def var(self, v):
        if len(v.members) > 0:
            return {'name': v.name, 'members': [self.var(m) for m in v.members]}
        n = max(1, v.rows) * max(1, v.columns)
        if v.type in (rd.VarType.UInt, rd.VarType.UShort, rd.VarType.UByte, rd.VarType.Bool):
            vals = list(v.value.u32v[:n])
        elif v.type in (rd.VarType.SInt, rd.VarType.SShort, rd.VarType.SByte):
            vals = list(v.value.s32v[:n])
        elif v.type == rd.VarType.Double:
            vals = [round(x, 6) for x in v.value.f64v[:n]]
        else:
            vals = [round(x, 6) for x in v.value.f32v[:n]]
        return {'name': v.name, 'type': str(v.type), 'rows': v.rows, 'cols': v.columns, 'v': vals}

    def constants(self, pipe, stage, sh, refl):
        out = []
        if refl is not None and len(refl.constantBlocks) > 0:
            entry = pipe.GetShaderEntryPoint(stage)
            for idx, cb in enumerate(refl.constantBlocks):
                try:
                    d = pipe.GetConstantBlock(stage, idx, 0).descriptor
                    vs = self.c.GetCBufferVariableContents(self.pipe_object(pipe, stage), sh, stage, entry, idx, d.resource, d.byteOffset, d.byteSize)
                    out.append({'block': cb.name, 'bytes': cb.byteSize, 'vars': [self.var(v) for v in vs]})
                except Exception as e:
                    out.append({'block': cb.name, 'error': str(e)})
            return out
        # No reflection: keep the raw contents of whatever is bound, as floats.
        try:
            for i, ud in enumerate(pipe.GetConstantBlocks(stage, False)):
                d = ud.descriptor
                if isnull(d.resource):
                    continue
                size = min(d.byteSize or MAX_CB_BYTES, MAX_CB_BYTES)
                raw = self.c.GetBufferData(d.resource, d.byteOffset, size)
                fl = struct.unpack('<%df' % (len(raw) // 4), raw[:len(raw) // 4 * 4])
                out.append({'slot': i, 'raw_floats': [round(x, 6) for x in fl]})
        except Exception as e:
            out.append({'error': str(e)})
        return out

    def reads(self, pipe, stage, refl):
        out = []
        try:
            for ud in pipe.GetReadOnlyResources(stage, True):
                d = ud.descriptor
                if isnull(d.resource):
                    continue
                info = self.texinfo(d.resource)
                idx = ud.access.index
                if refl is not None and 0 <= idx < len(refl.readOnlyResources):
                    info['binding'] = refl.readOnlyResources[idx].name
                out.append(info)
        except Exception as e:
            out.append({'error': str(e)})
        return out

    def writes(self, pipe, stage):
        out = []
        try:
            for ud in pipe.GetReadWriteResources(stage, True):
                d = ud.descriptor
                if not isnull(d.resource):
                    out.append(d.resource)
        except Exception as e:
            self.err('read-write resources', e)
        return out

    # ---- pictures
    def save_image(self, res, fname):
        t = self.tex.get(rid(res))
        if t is None or t.width < MIN_SIDE or t.height < MIN_SIDE or self.images >= MAX_IMAGES:
            return None
        sub = rd.Subresource()
        sub.mip, sub.slice, sub.sample = 0, 0, 0
        mn, mx = self.c.GetMinMax(res, sub, rd.CompType.Typeless)
        lo, hi = min(mn.floatValue[:3]), max(mx.floatValue[:3])
        ts = rd.TextureSave()
        ts.resourceId = res
        ts.destType = rd.FileType.JPG
        ts.jpegQuality = JPEG_QUALITY
        ts.mip = 0
        ts.slice.sliceIndex = 0
        ts.alpha = rd.AlphaMapping.Discard
        # Bright (HDR) or signed targets: map their own range to the picture, so nothing is cut off. The range is
        # written down, so the picture's values can be turned back into the real ones.
        black, white = 0.0, 1.0
        if lo < 0.0 or hi > 1.0:
            black, white = min(0.0, lo), (hi if hi > 0 else 1.0)
        ts.comp.blackPoint, ts.comp.whitePoint = black, white
        result = self.c.SaveTexture(ts, os.path.join(self.out, fname))
        if hasattr(result, 'OK') and not result.OK():
            self.errors.append('save %s: %s' % (fname, result.Message()))
            return None
        self.images += 1
        return {'file': fname, 'black': black, 'white': white, 'min': list(mn.floatValue), 'max': list(mx.floatValue)}

    # ---- one step
    def export_pass(self, i, p, picture):
        first, last = p['actions'][0][0], p['actions'][-1][0]
        rec = {'index': i, 'kind': p['kind'], 'events': [first.eventId, last.eventId], 'count': len(p['actions']),
               'markers': p['path'], 'first': p['actions'][0][1], 'last': p['actions'][-1][1], 'shaders': {}, 'constants': {}, 'reads': {}}
        # Every distinct pixel/compute shader in the step: its code, numbers and inputs at the first draw that uses it.
        seen = set()
        stages = [rd.ShaderStage.Compute] if p['kind'] == 'dispatch' else [rd.ShaderStage.Vertex, rd.ShaderStage.Pixel]
        draws = rec['draws'] = []
        if p['kind'] in ('draw', 'dispatch'):
            for a, nm in p['actions']:
                self.c.SetFrameEvent(a.eventId, False)
                pipe = self.c.GetPipelineState()
                entry = {'event': a.eventId, 'name': nm}
                for st in stages:
                    sh = pipe.GetShader(st)
                    if isnull(sh):
                        continue
                    sn = STAGE_NAMES.get(st, str(st))
                    entry[sn] = rid(sh)
                    key = (sn, rid(sh))
                    if key in seen:
                        continue
                    seen.add(key)
                    refl = pipe.GetShaderReflection(st)
                    try:
                        rec['shaders'].setdefault(sn, []).append(self.export_shader(pipe, st, sh, refl))
                    except Exception as e:
                        self.err('shader at %d' % a.eventId, e)
                    if st != rd.ShaderStage.Vertex:
                        try:
                            rec['constants'].setdefault(sn, {})[rid(sh)] = self.constants(pipe, st, sh, refl)
                            rec['reads'].setdefault(sn, {})[rid(sh)] = self.reads(pipe, st, refl)
                        except Exception as e:
                            self.err('constants at %d' % a.eventId, e)
                draws.append(entry)
        # What the step wrote, as it stands after its last action.
        self.c.SetFrameEvent(last.eventId, True)
        outs = [o for o in last.outputs if not isnull(o)]
        if p['kind'] == 'dispatch':
            outs = [r for r in self.writes(self.c.GetPipelineState(), rd.ShaderStage.Compute) if rid(r) in self.tex]
        elif p['kind'] == 'copy' and not isnull(last.copyDestination):
            outs = [last.copyDestination]
        rec['outputs'] = [self.texinfo(o) for o in outs]
        if not isnull(last.depthOut):
            rec['depth'] = self.texinfo(last.depthOut)
        rec['images'] = []
        if picture:
            for k, o in enumerate(outs):
                try:
                    im = self.save_image(o, 'images/%04d_out%d.jpg' % (i, k))
                    if im:
                        im['target'] = self.texinfo(o)
                        rec['images'].append(im)
                except Exception as e:
                    self.err('image of step %d' % i, e)
        self.write_json('passes/%04d.json' % i, rec)
        short = {k: rec[k] for k in ('index', 'kind', 'events', 'count', 'markers', 'first', 'last', 'outputs', 'images')}
        short['shaders'] = rec['shaders']
        return short

    def run(self, label):
        t0 = time.time()
        leaves = self.leaves()
        ps = self.passes(leaves)
        # Which steps get pictures: all, unless there are too many; then the end of the frame (where the camera
        # filter and the colour work are) gets the larger share, and the rest is spread evenly.
        n = len(ps)
        pick = set(range(n))
        if n > MAX_IMAGES:
            tail = int(MAX_IMAGES * 0.6)
            pick = set(range(n - tail, n))
            head = n - tail
            step = head / float(MAX_IMAGES - tail)
            pick |= {int(k * step) for k in range(MAX_IMAGES - tail)}
        summary = []
        for i, p in enumerate(ps):
            if i % 10 == 0:
                self.progress('%s: step %d of %d' % (label, i, n))
            try:
                summary.append(self.export_pass(i, p, i in pick))
            except Exception as e:
                self.err('step %d' % i, e)
        # The finished picture as shown on screen.
        final = None
        for t in self.tex.values():
            if t.creationFlags & rd.TextureCategory.SwapBuffer:
                try:
                    self.c.SetFrameEvent(leaves[-1][0].eventId, True)
                    final = self.save_image(t.resourceId, 'final.jpg')
                except Exception as e:
                    self.err('final picture', e)
                break
        api = ''
        try:
            api = str(self.c.GetAPIProperties().pipelineType)
        except Exception as e:
            self.err('api', e)
        self.write_json('frame.json', {
            'api': api, 'actions': len(leaves), 'steps': n, 'pictures': self.images, 'shaders': len(self.shaders),
            'final': final, 'seconds': round(time.time() - t0, 1), 'passes': summary,
            'textures': [self.texinfo(t.resourceId) for t in self.tex.values()],
        })
        with open(os.path.join(self.out, 'errors.txt'), 'w', encoding='utf-8') as f:
            f.write('\n\n'.join(self.errors) if self.errors else 'no errors\n')
        return n


def export_controller(controller, out, progress, label):
    ex = Exporter(controller, out, progress)
    n = ex.run(label)
    progress('%s: done, %d steps, %d pictures, %d shaders, %d errors' % (label, n, ex.images, len(ex.shaders), len(ex.errors)))


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
        out = os.path.splitext(path)[0] + '_export'
        pyrenderdoc.Replay().BlockInvoke(lambda c: export_controller(c, out, print, os.path.basename(path)))   # noqa: F821
        print('Export written to ' + out)
    else:
        print('Open a capture first (File > Open Capture), then run this script again.')


main()
