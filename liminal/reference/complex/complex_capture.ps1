# Records frames of The Complex: Expedition with RenderDoc, then exports what the graphics card ran for each
# frame: every drawing step in order, the picture it made, the shader code and the numbers it used. The
# export goes to your private GitHub repo (branch "complex-capture"), where Claude can study it.
#
#   1. Install RenderDoc: https://renderdoc.org/builds (the Windows 64-bit installer). Keep Steam running.
#   2. Run:  powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\complex_capture.ps1"
#   3. The game starts, with RenderDoc's text at the top left. Go to a spot and press F12 (or Print Screen).
#      Do this at 3 to 5 spots (a lit room, a dark hall, ...). Then quit the game.
#   4. Wait. RenderDoc opens by itself, exports each frame and closes again. Then the upload runs.
#
# It does not open or change the game's own files. While the game runs it puts a small steam_appid.txt next
# to the game's program (so the game starts without going through Steam), and takes it away afterwards.
# The upload needs Git for Windows (winget install --id Git.Git -e). Safe to run again: with -ExportOnly it
# skips the game and exports and uploads what is not done yet.
param(
  [string]$Game = "",                                             # the game's folder; found automatically if empty
  [string]$Out = "$env:USERPROFILE\Desktop\complex-capture",       # where everything goes
  [string]$Remote = "https://github.com/SunbrightMedia/raftgame.git",
  [switch]$ExportOnly,                                             # do not start the game: export the frames already recorded
  [switch]$NoUpload                                                # export only, keep everything on this PC
)
$ErrorActionPreference = "Stop"
$AppId = "2172260"
foreach ($d in @($Out, "$Out\captures", "$Out\exports", "$Out\facts")) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

function Redact([string]$s) {
  if (-not $s) { return '' }
  $s = $s -ireplace [regex]::Escape($env:USERPROFILE), '<you>'
  if ($env:USERNAME) { $s = $s -ireplace [regex]::Escape($env:USERNAME), '<you>' }
  return $s
}

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
$RdCmd = Join-Path $Rd 'renderdoccmd.exe'
$RdUi = Join-Path $Rd 'qrenderdoc.exe'
Write-Host ("RenderDoc {0}: {1}" -f (Get-Item $RdUi).VersionInfo.ProductVersion, $Rd)

# ---------------------------------------------------------------- the game
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
if (-not $Game) { $Game = Find-Game }
if (-not $Game -or -not (Test-Path $Game)) {
  Write-Host 'Could not find The Complex: Expedition. Install it in Steam, or run this script with -Game "<the game''s folder>".' -ForegroundColor Yellow
  exit 1
}
$Game = (Resolve-Path $Game).Path.TrimEnd('\')
Write-Host "Game: $(Redact $Game)"

$engine = 'unknown'; $exe = $null; $gameArgs = @()
$ship = Get-ChildItem $Game -Recurse -Filter '*-Shipping.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
$unity = Get-ChildItem $Game -Filter 'UnityPlayer.dll' -File -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ship) {
  $engine = 'Unreal'; $exe = $ship.FullName; $gameArgs = @('-dx11')
} elseif ($unity) {
  $engine = 'Unity'; $exe = (Get-ChildItem $Game -Filter '*.exe' -File | Where-Object { $_.Name -notlike 'UnityCrashHandler*' } | Select-Object -First 1).FullName; $gameArgs = @('-force-d3d11')
} else {
  $exe = (Get-ChildItem $Game -Filter '*.exe' -File | Sort-Object Length -Descending | Select-Object -First 1).FullName
}
if (-not $exe) { Write-Host "Could not find the game's program in $Game." -ForegroundColor Yellow; exit 1 }
Write-Host "Engine (from its files): $engine; program: $(Redact $exe)"

# ---------------------------------------------------------------- facts (names, versions, the game's own logs and settings)
$facts = New-Object System.Collections.Generic.List[string]
function Fact([string]$s) { $facts.Add((Redact $s)) }
Fact "The Complex: Expedition, Steam app $AppId"
Fact "folder: $Game"
Fact "engine (from its files): $engine"
Fact "--- programs:"
foreach ($e in (Get-ChildItem $Game -Recurse -Filter '*.exe' -File -ErrorAction SilentlyContinue)) {
  $v = $e.VersionInfo
  Fact ("  {0}: product '{1}' {2}, file version {3}, company '{4}'" -f $e.FullName.Substring($Game.Length), $v.ProductName, $v.ProductVersion, $v.FileVersion, $v.CompanyName)
}
Fact "--- libraries (their names show upscalers, sound and other middleware):"
Get-ChildItem $Game -Recurse -Filter '*.dll' -File -ErrorAction SilentlyContinue | ForEach-Object { Fact ("  {0}  {1:N0} KB" -f $_.FullName.Substring($Game.Length), ($_.Length / 1KB)) }
Fact "--- data files (names and sizes; nothing is unpacked):"
Get-ChildItem $Game -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.pak', '.utoc', '.ucas', '.pck', '.assets', '.bundle', '.resS') } | ForEach-Object { Fact ("  {0}  {1:N1} MB" -f $_.FullName.Substring($Game.Length), ($_.Length / 1MB)) }
Fact "--- the game's own log and settings files:"
$candidates = @()
if ($ship) { $candidates += (Join-Path $env:LOCALAPPDATA ($ship.Directory.Parent.Parent.Name + '\Saved')) }
$candidates += @(Get-ChildItem $env:LOCALAPPDATA -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Complex*' } | ForEach-Object { Join-Path $_.FullName 'Saved' })
$candidates += @(Get-ChildItem "$env:USERPROFILE\AppData\LocalLow" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue } | Where-Object { $_.Name -like '*Complex*' } | ForEach-Object { $_.FullName })
$copied = 0
foreach ($c in ($candidates | Select-Object -Unique)) {
  if (-not (Test-Path $c)) { continue }
  Fact "  found: $c"
  Get-ChildItem $c -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @('.ini', '.log') -and $_.Length -lt 20MB } | ForEach-Object {
    $dest = Join-Path "$Out\facts" ($_.Directory.Name + '_' + $_.Name + '.txt')
    Set-Content -Path $dest -Value (Redact (Get-Content $_.FullName -Raw)) -Encoding UTF8
    Fact ("  copied {0} -> facts\{1}" -f $_.FullName, (Split-Path $dest -Leaf)); $copied++
  }
}
if ($copied -eq 0) { Fact "  none found (the game may not write a log)" }
Fact "--- this PC:"
Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object { Fact ("  graphics card: {0}, driver {1}" -f $_.Name, $_.DriverVersion) }
Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | ForEach-Object { Fact ("  processor: {0}" -f $_.Name) }
Set-Content -Path "$Out\facts\facts.txt" -Value $facts -Encoding UTF8

# ---------------------------------------------------------------- record frames
if (-not $ExportOnly) {
  $exeDir = Split-Path $exe
  $appidFile = Join-Path $exeDir 'steam_appid.txt'
  $made = $false
  if (-not (Test-Path $appidFile)) { Set-Content -Path $appidFile -Value $AppId -Encoding ASCII -NoNewline; $made = $true }
  Write-Host ""
  Write-Host "The game starts now." -ForegroundColor Green
  Write-Host "  - Go to a spot and press F12 (or Print Screen). Do it at 3 to 5 spots (a lit room, a dark hall, ...)."
  Write-Host "  - RenderDoc's text at the top left of the game counts the frames it saved."
  Write-Host "  - Then quit the game normally."
  try {
    & $RdCmd capture --wait-for-exit --opt-hook-children --working-dir $exeDir --capture-file "$Out\captures\complex" $exe @gameArgs
    # (if the program handed over to another one, wait for that too)
    $name = [IO.Path]::GetFileNameWithoutExtension($exe)
    while (Get-Process -Name $name -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 2 }
  } finally {
    if ($made) { Remove-Item $appidFile -ErrorAction SilentlyContinue }
  }
}

$caps = @(Get-ChildItem "$Out\captures" -Filter '*.rdc' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
if ($caps.Count -eq 0) {
  Write-Host "No frames were recorded." -ForegroundColor Yellow
  Write-Host "If RenderDoc's text did not show at the top left of the game, the game blocked RenderDoc."
  Write-Host "Then you can refund the game on Steam (bought within 14 days, played under 2 hours)."
  exit 1
}
Write-Host "$($caps.Count) frame(s) recorded."

# ---------------------------------------------------------------- export (RenderDoc runs complex_export.py on each frame)
$ExportPy = @'
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
'@
$todo = @($caps | Where-Object { -not (Test-Path (Join-Path (Join-Path "$Out\exports" $_.BaseName) 'frame.json')) })
if ($todo.Count -gt 0) {
  $py = Join-Path $Out 'complex_export.py'
  Set-Content -Path $py -Value $ExportPy -Encoding UTF8
  $progress = Join-Path "$Out\exports" 'progress.txt'
  Remove-Item $progress -ErrorAction SilentlyContinue
  $cfg = @{ captures = @($todo | ForEach-Object { $_.FullName }); out = "$Out\exports"; progress = $progress; quit = $true }
  Set-Content -Path (Join-Path $env:TEMP 'complex_capture_config.json') -Value ($cfg | ConvertTo-Json) -Encoding UTF8
  Write-Host "Exporting $($todo.Count) frame(s). RenderDoc opens and closes by itself. This takes a few minutes per frame." -ForegroundColor Green
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
$done = @($caps | Where-Object { Test-Path (Join-Path (Join-Path "$Out\exports" $_.BaseName) 'frame.json') })
Write-Host "$($done.Count) of $($caps.Count) frame(s) exported to $Out\exports"
if ($done.Count -eq 0) { Write-Host "Nothing was exported. Send Claude the file $Out\exports\progress.txt if it exists." -ForegroundColor Yellow; exit 1 }

# ---------------------------------------------------------------- upload (the exports and facts; never the raw .rdc frames)
if ($NoUpload) { Write-Host "Done. Everything is in $Out (exports and facts)." -ForegroundColor Green; exit 0 }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "The export is in $Out. To upload it, install Git (winget install --id Git.Git -e), open a NEW PowerShell window and run this script again with -ExportOnly." -ForegroundColor Yellow
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
  Set-Content -Path ".gitignore" -Value @('captures/', '*.rdc', 'complex_export.py') -Encoding ASCII
  Set-Content -Path ".gitattributes" -Value "* -text" -Encoding ASCII
  git add -- .gitignore .gitattributes facts
  git diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { git commit -q -m "The Complex: Expedition, facts" }
  # One frame per commit and push, so no single upload is too large and a broken upload resumes.
  $parts = @($done | ForEach-Object { "exports/" + $_.BaseName }) + @("exports")
  $n = 0
  foreach ($part in $parts) {
    $n++
    git add -- $part
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { git commit -q -m ("The Complex: Expedition, " + $part) }
    Write-Host "Uploading part $n of $($parts.Count) ..."
    git push -u origin complex-capture
    if ($LASTEXITCODE -ne 0) { throw "Upload failed. Check your internet and run the script again with -ExportOnly: it resumes." }
  }
  Write-Host "Done. The export is on GitHub (branch complex-capture). Tell Claude." -ForegroundColor Green
} finally {
  Pop-Location
}
