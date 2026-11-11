# Deep export: reads the frames of The Complex: Expedition you already recorded (with complex_capture.ps1)
# again, and saves the numbers behind the lighting that the first export left out: every lamp's position,
# colour, brightness, range and cone; the packed list of lamps; and exact (not JPEG) copies of the depth,
# the material buffers and the light at each lighting step. Then it uploads them to your private GitHub
# repo (branch "complex-capture", folder "deep"), next to the first export. Claude reads them there.
#
#   1. Keep the folder complex-capture on your Desktop as it is (its "captures" folder holds the frames).
#   2. Run:  powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\complex_deep.ps1"
#   3. Wait. RenderDoc opens by itself, works through each frame and closes again. Then the upload runs.
#
# The game is not started. Nothing of the game's own files or textures is sent: only what the graphics
# card computed for the recorded frames, and (from a few header bytes of the game's data files) whether the
# game packed its data encrypted. Safe to run again: it skips frames already done.
param(
  [string]$Out = "$env:USERPROFILE\Desktop\complex-capture",       # the folder complex_capture.ps1 made
  [string]$Remote = "https://github.com/SunbrightMedia/raftgame.git",
  [switch]$NoUpload                                                # keep everything on this PC
)
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------- RenderDoc
function Find-RenderDoc {
  $dirs = @()
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'RenderDoc*' -and $_.InstallLocation } | ForEach-Object { $dirs += $_.InstallLocation }
  }
  $dirs += "$env:ProgramFiles\RenderDoc"
  foreach ($d in $dirs) {
    if ((Test-Path (Join-Path $d 'renderdoccmd.exe')) -and (Test-Path (Join-Path $d 'qrenderdoc.exe'))) { return $d }
  }
  return $null
}
$Rd = Find-RenderDoc
if (-not $Rd) {
  Write-Host "RenderDoc is not installed. Get the Windows 64-bit installer from https://renderdoc.org/builds, install it, then run this script again." -ForegroundColor Yellow
  exit 1
}
$RdUi = Join-Path $Rd 'qrenderdoc.exe'
Write-Host ("RenderDoc {0}: {1}" -f (Get-Item $RdUi).VersionInfo.ProductVersion, $Rd)

# ---------------------------------------------------------------- the recorded frames
$caps = @(Get-ChildItem "$Out\captures" -Filter '*.rdc' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
if ($caps.Count -eq 0) {
  Write-Host "No recorded frames in $Out\captures." -ForegroundColor Yellow
  Write-Host "If they were deleted, record new ones with complex_capture.ps1 first (then tell Claude: the frames are new)."
  exit 1
}
Write-Host "$($caps.Count) recorded frame(s) found."
New-Item -ItemType Directory -Force -Path "$Out\deep" | Out-Null

# ---------------------------------------------------------------- the game's data files: locked or not?
# Reads a few header bytes of each container file in the game's Paks folder (nothing is unpacked or
# decrypted): whether Unreal packed it encrypted. If not, the game's own light settings could perhaps be
# read one day; if so, that way is closed (we do not decrypt). Written to deep\game_files.txt.
$AppId = "2172260"
function Find-Game {
  $steam = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -ErrorAction SilentlyContinue).SteamPath
  if (-not $steam) { $steam = "${env:ProgramFiles(x86)}\Steam" }
  $libs = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) {
    foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) { $libs += ($m.Groups[1].Value -replace '\\\\', '\') }
  }
  foreach ($lib in ($libs | Select-Object -Unique)) {
    $acf = Join-Path $lib "steamapps\appmanifest_$AppId.acf"
    if (Test-Path $acf) {
      $dir = [regex]::Match((Get-Content $acf -Raw), '"installdir"\s+"([^"]+)"').Groups[1].Value
      $p = Join-Path $lib "steamapps\common\$dir"
      if (Test-Path $p) { return $p }
    }
  }
  return $null
}
function Read-Bytes([string]$path, [long]$offset, [int]$count) {
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  try {
    if ($offset -lt 0) { $offset = [Math]::Max([long]0, $fs.Length + $offset) }
    [void]$fs.Seek($offset, [System.IO.SeekOrigin]::Begin)
    $buf = New-Object byte[] $count
    [void]$fs.Read($buf, 0, $count)
    return ,$buf
  } finally { $fs.Close() }
}
function Is-Zero($bytes) { foreach ($x in $bytes) { if ($x -ne 0) { return $false } }; return $true }
$gameFiles = @()
$gameDir = Find-Game
if ($gameDir) {
  foreach ($f in @(Get-ChildItem $gameDir -Recurse -Include '*.utoc', '*.pak' -File -ErrorAction SilentlyContinue)) {
    $mb = '{0:N1} MB' -f ($f.Length / 1MB)
    try {
      if ($f.Extension -eq '.utoc') {
        $h = Read-Bytes $f.FullName 0 96
        if ([System.Text.Encoding]::ASCII.GetString($h, 0, 16) -eq '-==--==--==--==-') {
          $flags = $h[80]
          $gameFiles += ('{0}: {1}, IoStore table v{2}, compressed {3}, encrypted {4}, signed {5}, key id set {6}' -f $f.Name, $mb, $h[16], (($flags -band 1) -ne 0), (($flags -band 2) -ne 0), (($flags -band 4) -ne 0), (-not (Is-Zero $h[64..79])))
        } else { $gameFiles += ('{0}: {1}, unknown header' -f $f.Name, $mb) }
      } else {
        $t = Read-Bytes $f.FullName -512 512
        $k = -1
        for ($j = $t.Length - 4; $j -ge 17; $j--) { if ($t[$j] -eq 0xE1 -and $t[$j + 1] -eq 0x12 -and $t[$j + 2] -eq 0x6F -and $t[$j + 3] -eq 0x5A) { $k = $j; break } }
        if ($k -ge 0) {
          $gameFiles += ('{0}: {1}, pak v{2}, index encrypted {3}, key id set {4}' -f $f.Name, $mb, [BitConverter]::ToInt32($t, $k + 4), ($t[$k - 1] -ne 0), (-not (Is-Zero $t[($k - 17)..($k - 2)])))
        } else { $gameFiles += ('{0}: {1}, no pak footer found' -f $f.Name, $mb) }
      }
    } catch { $gameFiles += ('{0}: {1}, could not read ({2})' -f $f.Name, $mb, $_.Exception.Message) }
  }
} else { $gameFiles += 'game folder not found' }
New-Item -ItemType Directory -Force -Path "$Out\deep" | Out-Null
Set-Content -Path "$Out\deep\game_files.txt" -Value $gameFiles -Encoding UTF8
Write-Host "The game's data files (header check only):"
$gameFiles | ForEach-Object { Write-Host "  $_" }

# ---------------------------------------------------------------- deep export (RenderDoc runs complex_deep.py on each frame)
$DeepPy = @'
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
#  - steps.json.z  the same for every other step of the frame (zlib JSON): material numbers of each object
#                  drawn, Lumen's settings, the glow, tone curve and camera passes
#  - buffers.json + buffers/*.bin.z
#                  raw contents of the data buffers the light-list and Lumen light steps read (the list of
#                  every lamp in view, as the engine packs it)
#  - targets.json + targets/*.bin.z
#                  lossless copies (raw bytes, zlib) of what key steps drew: depth, the G-buffer (normals,
#                  material, base colour and their alpha channels), the scene light after the emissive base
#                  pass, after the bounce light, after the lamps, the bounce light itself (Lumen), the
#                  upscaled picture, after motion blur, the glow, the tone curve and each camera pass
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
                'PostProcessing / TAA', 'MotionBlur FullResFilter', 'Bloom', 'Tonemap', 'PostProcessMaterial')
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
        lights, targets, others = [], [], []
        for i, p in enumerate(ps):
            if i % 25 == 0:
                self.progress('%s: step %d of %d' % (label, i, n))
            if p['kind'] in ('draw', 'dispatch') and has(p['path'], LIGHT_STEPS):
                try:
                    lights.append(self.light_step(i, p))
                except Exception as e:
                    self.err('light step %d' % i, e)
            elif p['kind'] in ('draw', 'dispatch'):
                try:
                    others.append(self.light_step(i, p))
                except Exception as e:
                    self.err('step %d' % i, e)
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
        self.write_z('steps.json.z', json.dumps(others).encode('utf-8'))
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
'@
$todo = @($caps | Where-Object { -not (Test-Path (Join-Path (Join-Path "$Out\deep" $_.BaseName) 'deep.json')) })
if ($todo.Count -gt 0) {
  $py = Join-Path $Out 'complex_deep.py'
  Set-Content -Path $py -Value $DeepPy -Encoding UTF8
  $progress = Join-Path "$Out\deep" 'progress.txt'
  Remove-Item $progress -ErrorAction SilentlyContinue
  $cfg = @{ captures = @($todo | ForEach-Object { $_.FullName }); out = "$Out\deep"; progress = $progress; quit = $true }
  Set-Content -Path (Join-Path $env:TEMP 'complex_deep_config.json') -Value ($cfg | ConvertTo-Json) -Encoding UTF8
  Write-Host "Reading $($todo.Count) frame(s) again. RenderDoc opens and closes by itself. This takes a few minutes per frame." -ForegroundColor Green
  $proc = Start-Process -FilePath $RdUi -ArgumentList @('--ui-py', ('"{0}"' -f $py)) -PassThru
  $shown = 0; $started = Get-Date
  while (-not $proc.HasExited) {
    Start-Sleep -Seconds 2
    $lines = $null
    if (Test-Path $progress) { try { $lines = @(Get-Content $progress -ErrorAction Stop) } catch { $lines = $null } }   # (RenderDoc may be writing it)
    if ($lines) {
      for ($k = [Math]::Max(0, $shown); $k -lt $lines.Count; $k++) { Write-Host "  $($lines[$k])" }
      $shown = $lines.Count
    } elseif (((Get-Date) - $started).TotalSeconds -gt 180 -and $shown -eq 0) {
      Write-Host "  (nothing yet: if RenderDoc shows an error, copy it to Claude, then close RenderDoc)" -ForegroundColor Yellow
      $shown = -1
    }
  }
  Start-Sleep -Seconds 1
  if (Test-Path $progress) { $lines = @(Get-Content $progress); for ($k = [Math]::Max(0, $shown); $k -lt $lines.Count; $k++) { Write-Host "  $($lines[$k])" } }
}
$done = @($caps | Where-Object { Test-Path (Join-Path (Join-Path "$Out\deep" $_.BaseName) 'deep.json') })
Write-Host "$($done.Count) of $($caps.Count) frame(s) read again into $Out\deep"
if ($done.Count -eq 0) { Write-Host "Nothing was saved. Send Claude the file $Out\deep\progress.txt if it exists." -ForegroundColor Yellow; exit 1 }

# ---------------------------------------------------------------- upload (into the same branch as the first export)
if ($NoUpload) { Write-Host "Done. Everything is in $Out\deep." -ForegroundColor Green; exit 0 }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "The export is in $Out\deep. To upload it, install Git (winget install --id Git.Git -e), open a NEW PowerShell window and run this script again." -ForegroundColor Yellow
  exit 0
}
Push-Location $Out
try {
  if (-not (Test-Path ".git")) {
    git init -q
    git symbolic-ref HEAD refs/heads/complex-capture
  }
  git config core.autocrlf false
  git config http.postBuffer 524288000
  if (-not (git config user.name)) { git config user.name "complex-capture" }
  if (-not (git config user.email)) { git config user.email "complex-capture@localhost" }
  if (git remote) { git remote set-url origin $Remote } else { git remote add origin $Remote }
  # Get what is already on GitHub first (the first export), so the upload only adds to it.
  # (Git writes notes to the error stream; Windows PowerShell must not treat them as failures.)
  $ErrorActionPreference = "Continue"
  git fetch -q origin complex-capture
  if ($LASTEXITCODE -eq 0) {
    git merge -q --no-edit origin/complex-capture
    if ($LASTEXITCODE -ne 0) { git merge --abort }
  }
  $ErrorActionPreference = "Stop"
  Set-Content -Path ".gitignore" -Value @('captures/', '*.rdc', 'complex_export.py', 'complex_deep.py') -Encoding ASCII
  Set-Content -Path ".gitattributes" -Value "* -text" -Encoding ASCII
  git add -- .gitignore .gitattributes
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -q -m "The Complex: Expedition, ignore list" }
  # One frame per commit and push, so no single upload is too large and a broken upload resumes.
  $parts = @($done | ForEach-Object { "deep/" + $_.BaseName }) + @("deep")
  $n = 0
  foreach ($part in $parts) {
    $n++
    git add -- $part
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { git commit -q -m ("The Complex: Expedition, " + $part) }
    Write-Host "Uploading part $n of $($parts.Count) ..."
    git push -u origin complex-capture
    if ($LASTEXITCODE -ne 0) { throw "Upload failed. Check your internet and run the script again: it resumes." }
  }
  Write-Host "Done. The deep export is on GitHub (branch complex-capture, folder deep). Tell Claude." -ForegroundColor Green
} finally {
  Pop-Location
}
