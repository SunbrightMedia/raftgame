# Copies every Portal 2 map (.bsp) without its embedded file pack (cube maps etc., most of the size),
# plus the game's colour-grading tables (materials/correction/*.raw), and uploads them to your private
# GitHub repo (branch "p2-maps"), so the liminal tools can study how Valve built the levels: brushes,
# prop placements, lights, fog, colour. It only READS your game files.
#
#   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\export_maps.ps1"
#
# Needs Git for Windows (winget install --id Git.Git -e) and about 1 GB of free disk.
# Safe to run again: it skips maps already done and resumes the upload.
param(
  [string]$Portal2 = "",                                   # the "Portal 2" folder; found automatically if empty
  [string]$Out = "$env:USERPROFILE\Desktop\p2-maps",       # where the files go
  [string]$Remote = "https://github.com/SunbrightMedia/raftgame.git"
)
$ErrorActionPreference = "Stop"

$StripSource = @'
using System;
using System.IO;

public static class VpkGrab
{
    static string CStr(byte[] d, ref int pos)
    {
        int start = pos;
        while (d[pos] != 0) pos++;
        string s = System.Text.Encoding.GetEncoding(28591).GetString(d, start, pos - start);
        pos++;
        return s;
    }

    // Writes every file of the pack whose path starts with `prefix` and ends with `ext` into outDir. Returns how many.
    public static int Extract(string dirFile, string prefix, string ext, string outDir)
    {
        byte[] d = File.ReadAllBytes(dirFile);
        if (BitConverter.ToUInt32(d, 0) != 0x55AA1234) throw new Exception("not a VPK: " + dirFile);
        uint ver = BitConverter.ToUInt32(d, 4), tree = BitConverter.ToUInt32(d, 8);
        int header = ver == 2 ? 28 : 12, pos = header, count = 0;
        long dataStart = header + tree;
        while (true)
        {
            string e = CStr(d, ref pos);
            if (e.Length == 0) break;
            while (true)
            {
                string dir = CStr(d, ref pos);
                if (dir.Length == 0) break;
                while (true)
                {
                    string name = CStr(d, ref pos);
                    if (name.Length == 0) break;
                    pos += 4;
                    int pre = BitConverter.ToUInt16(d, pos); pos += 2;
                    int arch = BitConverter.ToUInt16(d, pos); pos += 2;
                    uint off = BitConverter.ToUInt32(d, pos); pos += 4;
                    uint len = BitConverter.ToUInt32(d, pos); pos += 4;
                    pos += 2;
                    int preAt = pos; pos += pre;
                    string folder = dir.Trim();
                    string path = (((folder.Length > 0) ? folder + "/" : "") + name + "." + e).ToLowerInvariant().Replace('\\', '/');
                    if (!path.StartsWith(prefix) || !path.EndsWith(ext)) continue;
                    byte[] data = new byte[pre + len];
                    Array.Copy(d, preAt, data, 0, pre);
                    if (len > 0)
                    {
                        string file = arch == 0x7FFF ? dirFile : Path.Combine(Path.GetDirectoryName(dirFile), Path.GetFileName(dirFile).Replace("_dir.vpk", "_" + arch.ToString("D3") + ".vpk"));
                        using (var fs = File.OpenRead(file))
                        {
                            fs.Seek(arch == 0x7FFF ? dataStart + off : off, SeekOrigin.Begin);
                            int n = 0;
                            while (n < len) { int r = fs.Read(data, pre + n, (int)len - n); if (r <= 0) throw new Exception("short read"); n += r; }
                        }
                    }
                    string dst = Path.Combine(outDir, path.Substring(prefix.Length).Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(dst));
                    File.WriteAllBytes(dst, data);
                    count++;
                }
            }
        }
        return count;
    }
}

public static class BspStrip
{
    // A copy of the BSP without the lumps in `drop` (their length becomes 0). Plain C# 5.
    public static long Strip(string src, string dst, int[] drop)
    {
        byte[] d = File.ReadAllBytes(src);
        if (d.Length < 1036 || d[0] != 'V' || d[1] != 'B' || d[2] != 'S' || d[3] != 'P') throw new Exception("not a BSP");
        const int HEADER = 1036;
        using (var fs = File.Create(dst))
        {
            byte[] head = new byte[HEADER];
            Array.Copy(d, head, HEADER);
            fs.SetLength(HEADER);
            fs.Seek(HEADER, SeekOrigin.Begin);
            for (int i = 0; i < 64; i++)
            {
                int e = 8 + i * 16;
                int ofs = BitConverter.ToInt32(d, e), len = BitConverter.ToInt32(d, e + 4);
                bool dropped = Array.IndexOf(drop, i) >= 0;
                if (dropped || len <= 0 || ofs <= 0 || (long)ofs + len > d.Length)
                {
                    BitConverter.GetBytes(0).CopyTo(head, e);
                    BitConverter.GetBytes(0).CopyTo(head, e + 4);
                    continue;
                }
                while (fs.Position % 4 != 0) fs.WriteByte(0);
                int at = (int)fs.Position;
                if (i == 35 && len >= 4)
                {
                    // The game lump's directory holds absolute file offsets: move them with it.
                    byte[] g = new byte[len];
                    Array.Copy(d, ofs, g, 0, len);
                    int n = BitConverter.ToInt32(g, 0);
                    for (int k = 0; k < n && 4 + k * 16 + 16 <= len; k++)
                    {
                        int o = 4 + k * 16 + 8;
                        BitConverter.GetBytes(BitConverter.ToInt32(g, o) - ofs + at).CopyTo(g, o);
                    }
                    fs.Write(g, 0, len);
                }
                else fs.Write(d, ofs, len);
                BitConverter.GetBytes(at).CopyTo(head, e);
            }
            long size = fs.Position;
            fs.Seek(0, SeekOrigin.Begin);
            fs.Write(head, 0, HEADER);
            return size;
        }
    }
}
'@

function Find-Portal2 {
  $c = @()
  $steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue).SteamPath
  if ($steam) {
    $c += Join-Path $steam "steamapps\common\Portal 2"
    $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
    if (Test-Path $vdf) {
      foreach ($m in [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"')) {
        $c += Join-Path ($m.Groups[1].Value -replace '\\\\', '\') "steamapps\common\Portal 2"
      }
    }
  }
  $c += "C:\Program Files (x86)\Steam\steamapps\common\Portal 2", "C:\Program Files\Steam\steamapps\common\Portal 2"
  foreach ($d in "D", "E", "F", "G") { $c += "${d}:\SteamLibrary\steamapps\common\Portal 2"; $c += "${d}:\Steam\steamapps\common\Portal 2" }
  foreach ($p in $c) { if ($p -and (Test-Path (Join-Path $p "portal2\pak01_dir.vpk"))) { return $p } }
  return $null
}

if (-not $Portal2) { $Portal2 = Find-Portal2 }
if (-not $Portal2 -or -not (Test-Path (Join-Path $Portal2 "portal2\pak01_dir.vpk"))) {
  Write-Host "Could not find Portal 2. Run again with: -Portal2 'X:\path\to\Portal 2'" -ForegroundColor Red
  exit 1
}
Write-Host "Portal 2: $Portal2"

# ---- 1. copy the maps, without the file pack (lump 40) and the physics mesh (lump 29)
New-Item -ItemType Directory -Force (Join-Path $Out "maps") | Out-Null
Add-Type -TypeDefinition $StripSource -Language CSharp
$done = 0; $total = 0
foreach ($game in "portal2", "portal2_dlc1", "portal2_dlc2") {
  $dir = Join-Path $Portal2 "$game\maps"
  if (-not (Test-Path $dir)) { continue }
  foreach ($f in Get-ChildItem -File $dir -Filter "*.bsp") {
    $dst = Join-Path $Out ("maps\" + $f.Name.ToLowerInvariant())
    if (Test-Path $dst) { continue }
    try {
      $size = [BspStrip]::Strip($f.FullName, $dst, [int[]]@(40, 29))
      $done++; $total += $size
      if ($done % 10 -eq 0) { Write-Host ("  {0} maps, {1:N0} MB" -f $done, ($total / 1MB)) }
    } catch {
      Write-Host "  skipped $($f.Name): $($_.Exception.Message)" -ForegroundColor Yellow
      if (Test-Path $dst) { Remove-Item $dst }
    }
  }
}
# Colour-grading tables (32x32x32 lookup tables the maps' color_correction entities name), later packs last.
$corr = Join-Path $Out "correction"
New-Item -ItemType Directory -Force $corr | Out-Null
foreach ($game in "portal2", "portal2_dlc1", "portal2_dlc2", "update") {
  $pak = Join-Path $Portal2 "$game\pak01_dir.vpk"
  if (Test-Path $pak) {
    try { $n = [VpkGrab]::Extract($pak, "materials/correction/", ".raw", $corr); if ($n -gt 0) { Write-Host "  $game`: $n colour tables" } }
    catch { Write-Host "  colour tables from $game skipped: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
}
# Loose ones (not in a pack) too.
foreach ($game in "portal2", "portal2_dlc1", "portal2_dlc2") {
  $loose = Join-Path $Portal2 "$game\materials\correction"
  if (Test-Path $loose) { Copy-Item (Join-Path $loose "*.raw") $corr -Force -ErrorAction SilentlyContinue }
}

$all = @(Get-ChildItem -File (Join-Path $Out "maps") -Filter "*.bsp")
Write-Host ("{0} maps in {1} ({2:N0} MB)" -f $all.Count, $Out, (($all | Measure-Object Length -Sum).Sum / 1MB))

# ---- 2. upload to GitHub, in batches of about 400 MB
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "The files are in $Out. To upload them, install Git (winget install --id Git.Git -e), open a NEW PowerShell window and run this script again." -ForegroundColor Yellow
  exit 0
}
Push-Location $Out
try {
  if (-not (Test-Path ".git")) {
    git init -q
    git symbolic-ref HEAD refs/heads/p2-maps
  }
  git config core.autocrlf false
  git config http.postBuffer 524288000
  if (-not (git config user.name)) { git config user.name "p2-export" }
  if (-not (git config user.email)) { git config user.email "p2-export@localhost" }
  if (git remote) { git remote set-url origin $Remote } else { git remote add origin $Remote }
  Set-Content -Path ".gitattributes" -Value "* -text" -Encoding ASCII

  $groups = @(); $cur = @(); $size = 0
  foreach ($f in ($all | Sort-Object Name)) {
    if ($cur.Count -gt 0 -and $size + $f.Length -gt 400MB) { $groups += ,$cur; $cur = @(); $size = 0 }
    $cur += ("maps/" + $f.Name); $size += $f.Length
  }
  if ($cur.Count -gt 0) { $groups += ,$cur }

  $i = 0
  foreach ($g in $groups) {
    $i++
    $paths = @($g)
    if ($i -eq 1) { $paths += ".gitattributes"; if (@(Get-ChildItem $corr -Recurse -File).Count -gt 0) { $paths += "correction" } }
    git add -- $paths
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { git commit -q -m "Portal 2 maps, part $i of $($groups.Count)" }
    Write-Host "Uploading part $i of $($groups.Count) ..."
    git push -u origin p2-maps
    if ($LASTEXITCODE -ne 0) { throw "Upload failed. Check your internet and run the script again: it resumes." }
  }
  Write-Host "Done. The maps are on GitHub (branch p2-maps)." -ForegroundColor Green
} finally {
  Pop-Location
}
