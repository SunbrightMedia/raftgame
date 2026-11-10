"""
Ask for Portal 2 files without making anyone dig through VPKs.

    python3 tools/source/bundle.py make NAME path/in/vpk ... [--parts-mb 28]
        → reference/portal2/NAME.ps1 + NAME_manifest.json
          A PowerShell script the user runs on their PC: it copies exactly those
          byte ranges out of their pak01_NNN.vpk archives into a few part*.bin
          files on their Desktop (each under the upload limit).
    python3 tools/source/bundle.py unpack NAME DIR_WITH_PARTS
        → the files, under reference/portal2/files/<path>

Paths are as in the VPK index (pak01_dir.vpk), e.g.
models/props_underground/underground_testchamber_button.mdl.
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import vpk  # noqa: E402

REF = os.path.normpath(os.path.join(HERE, '../../reference/portal2'))


def make(name, paths, part_mb=28):
    E, _ = vpk.read_dir(os.path.join(REF, 'pak01_dir.vpk'))
    manifest, part, used = [], 1, 0
    for p in paths:
        p = p.lower()
        arch, off, ln, pre = E[p]
        if pre:
            raise SystemExit(f'{p}: has preloaded bytes in the index; read it from pak01_dir.vpk instead')
        if used and used + ln > part_mb * 1e6:
            part, used = part + 1, 0
        manifest.append({'file': p, 'arch': arch, 'src_off': off, 'len': ln, 'part': part, 'off': used})
        used += ln
    lst = ';'.join(f"{m['arch']},{m['src_off']},{m['len']},{m['part']}" for m in manifest)
    ps = f'''# Copies {len(manifest)} Portal 2 files into part*.bin files on your Desktop in "{name}".
# It only reads your Portal 2 files. If Steam isn't in the default place, change the next line to your "Portal 2\\portal2" folder.
$p2 = "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Portal 2\\portal2"
$out = "$env:USERPROFILE\\Desktop\\{name}"
New-Item -ItemType Directory -Force $out | Out-Null
$list = "{lst}"
$streams = @{{}}
foreach ($e in $list.Split(";")) {{
  $a = $e.Split(","); $arch = [int]$a[0]; $off = [long]$a[1]; $len = [int]$a[2]; $part = [int]$a[3]
  if (-not $streams.ContainsKey($part)) {{ $streams[$part] = [IO.File]::Create("$out\\part$part.bin") }}
  $src = [IO.File]::OpenRead(("{{0}}\\pak01_{{1:D3}}.vpk" -f $p2, $arch))
  [void]$src.Seek($off, [IO.SeekOrigin]::Begin)
  $buf = New-Object byte[] $len; $n = 0
  while ($n -lt $len) {{ $n += $src.Read($buf, $n, $len - $n) }}
  $streams[$part].Write($buf, 0, $len); $src.Close()
}}
foreach ($s in $streams.Values) {{ $s.Close() }}
Write-Host "Done. Upload the part*.bin files from $out"
'''
    open(os.path.join(REF, f'{name}.ps1'), 'w', newline='\r\n').write(ps)
    json.dump(manifest, open(os.path.join(REF, f'{name}_manifest.json'), 'w'), indent=0)
    print(f'{name}.ps1: {len(manifest)} files, {part} part(s), {sum(m["len"] for m in manifest) / 1e6:.1f} MB')


def unpack(name, parts_dir):
    manifest = json.load(open(os.path.join(REF, f'{name}_manifest.json')))
    parts = {}
    for m in manifest:
        if m['part'] not in parts:
            parts[m['part']] = open(os.path.join(parts_dir, f"part{m['part']}.bin"), 'rb').read()
        data = parts[m['part']][m['off']:m['off'] + m['len']]
        assert len(data) == m['len'], f"{m['file']}: part{m['part']}.bin is short"
        dst = os.path.join(REF, 'files', m['file'])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        open(dst, 'wb').write(data)
    print(f'unpacked {len(manifest)} files into reference/portal2/files')


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'make':
        args = sys.argv[2:]
        mb = 28
        if '--parts-mb' in args:
            i = args.index('--parts-mb'); mb = float(args[i + 1]); del args[i:i + 2]
        make(args[0], args[1:], mb)
    elif cmd == 'unpack':
        unpack(sys.argv[2], sys.argv[3])
