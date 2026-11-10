# Exports EVERY Portal 2 material and model (base game + DLC packs) and uploads them to your private
# GitHub repo (branch "p2-library") for the liminal catalogue rooms. It only READS your game files.
#
#   powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\export_all.ps1"
#
# Needs Git for Windows (winget install --id Git.Git -e) and about 8 GB of free disk.
# Safe to run again: it skips work already done and resumes the upload.
param(
  [string]$Portal2 = "",                                   # the "Portal 2" folder; found automatically if empty
  [string]$Out = "$env:USERPROFILE\Desktop\p2-library",    # where the files go
  [int]$MaxSize = 1024,                                    # textures bigger than this keep their own 1024 mip
  [string]$Remote = "https://github.com/SunbrightMedia/raftgame.git"
)
$ErrorActionPreference = "Stop"

# The exporter itself (P2Export.cs in the liminal repo), compiled on the fly.
$P2ExportSource = @'
// Copies every Portal 2 material (.vmt/.vtf) and model (.mdl/.vvd/.dx90.vtx/.phy) out of the game's
// VPK packs into a folder, later packs overriding earlier ones (base game, then DLC, then update).
// Textures larger than MaxSize on a side keep only their mip levels up to MaxSize (the original pixels,
// no re-encoding); animated, cube-map and volume textures are copied unchanged.
// Plain C# 5 so Windows PowerShell 5.1 can compile it with Add-Type (export_all.ps1).
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

public static class P2Export
{
    public class Entry
    {
        public string Path;
        public int Arch;
        public uint Offset;
        public uint Length;
        public byte[] Preload;
        public string DirFile;
        public long DataStart;
    }

    public static List<Entry> ReadDir(string dirFile)
    {
        var list = new List<Entry>();
        byte[] d = File.ReadAllBytes(dirFile);
        uint sig = BitConverter.ToUInt32(d, 0), ver = BitConverter.ToUInt32(d, 4), tree = BitConverter.ToUInt32(d, 8);
        if (sig != 0x55AA1234) throw new Exception("not a VPK: " + dirFile);
        int header = ver == 2 ? 28 : 12;
        int pos = header;
        long dataStart = header + tree;
        while (true)
        {
            string ext = CStr(d, ref pos);
            if (ext.Length == 0) break;
            while (true)
            {
                string dir = CStr(d, ref pos);
                if (dir.Length == 0) break;
                while (true)
                {
                    string name = CStr(d, ref pos);
                    if (name.Length == 0) break;
                    var e = new Entry();
                    pos += 4; // crc
                    int pre = BitConverter.ToUInt16(d, pos); pos += 2;
                    e.Arch = BitConverter.ToUInt16(d, pos); pos += 2;
                    e.Offset = BitConverter.ToUInt32(d, pos); pos += 4;
                    e.Length = BitConverter.ToUInt32(d, pos); pos += 4;
                    pos += 2; // terminator
                    e.Preload = new byte[pre];
                    Array.Copy(d, pos, e.Preload, 0, pre); pos += pre;
                    string folder = dir.Trim();
                    e.Path = ((folder.Length > 0 && folder != " ") ? folder + "/" : "") + name + "." + ext;
                    e.Path = e.Path.ToLowerInvariant().Replace('\\', '/');
                    e.DirFile = dirFile;
                    e.DataStart = dataStart;
                    list.Add(e);
                }
            }
        }
        return list;
    }

    static string CStr(byte[] d, ref int pos)
    {
        int start = pos;
        while (d[pos] != 0) pos++;
        string s = Encoding.GetEncoding(28591).GetString(d, start, pos - start);
        pos++;
        return s;
    }

    public static bool Wanted(string p)
    {
        if (p.StartsWith("materials/")) return p.EndsWith(".vmt") || p.EndsWith(".vtf");
        if (p.StartsWith("models/")) return p.EndsWith(".mdl") || p.EndsWith(".vvd") || p.EndsWith(".dx90.vtx") || p.EndsWith(".phy");
        return false;
    }

    static Dictionary<string, FileStream> archives = new Dictionary<string, FileStream>();

    public static byte[] Read(Entry e)
    {
        byte[] outb = new byte[e.Preload.Length + e.Length];
        Array.Copy(e.Preload, outb, e.Preload.Length);
        if (e.Length == 0) return outb;
        string file;
        long off;
        if (e.Arch == 0x7FFF) { file = e.DirFile; off = e.DataStart + e.Offset; }
        else { file = Path.Combine(Path.GetDirectoryName(e.DirFile), Path.GetFileName(e.DirFile).Replace("_dir.vpk", "_" + e.Arch.ToString("D3") + ".vpk")); off = e.Offset; }
        FileStream fs;
        if (!archives.TryGetValue(file, out fs)) { fs = File.OpenRead(file); archives[file] = fs; }
        fs.Seek(off, SeekOrigin.Begin);
        int n = 0, want = (int)e.Length;
        while (n < want)
        {
            int r = fs.Read(outb, e.Preload.Length + n, want - n);
            if (r <= 0) throw new Exception("short read in " + file);
            n += r;
        }
        return outb;
    }

    public static void CloseAll()
    {
        foreach (var fs in archives.Values) fs.Close();
        archives.Clear();
    }

    // Bytes of one image of a format (-1 = not handled: the file is copied unchanged).
    public static long SizeOf(int fmt, int w, int h)
    {
        w = Math.Max(1, w); h = Math.Max(1, h);
        long bw = (w + 3) / 4, bh = (h + 3) / 4;
        switch (fmt)
        {
            case 13: case 20: return bw * bh * 8;           // DXT1, DXT1 one-bit alpha
            case 14: case 15: return bw * bh * 16;          // DXT3, DXT5
            case 5: case 7: case 8: return (long)w * h;     // I8, P8, A8
            case 4: case 6: case 17: case 18: case 19: case 21: case 22: return (long)w * h * 2;
            case 2: case 3: case 9: case 10: return (long)w * h * 3;
            case 0: case 1: case 11: case 12: case 16: case 23: case 26: case 27: return (long)w * h * 4;
            case 24: case 25: return (long)w * h * 8;
            case 28: return (long)w * h * 12;
            case 29: return (long)w * h * 16;
        }
        return -1;
    }

    // A VTF with only the mips no larger than maxSize, as a VTF 7.2 (no low-res thumbnail, no resources);
    // the original bytes when it is already small enough or can't be trimmed safely.
    public static byte[] TrimVtf(byte[] d, int maxSize, out string note)
    {
        note = "";
        if (d.Length < 80 || d[0] != 'V' || d[1] != 'T' || d[2] != 'F' || d[3] != 0) { note = "not a vtf"; return d; }
        int vmin = BitConverter.ToInt32(d, 8), hsize = BitConverter.ToInt32(d, 12);
        int w = BitConverter.ToUInt16(d, 16), h = BitConverter.ToUInt16(d, 18);
        uint flags = BitConverter.ToUInt32(d, 20);
        int frames = BitConverter.ToUInt16(d, 24);
        int fmt = BitConverter.ToInt32(d, 52);
        int mips = d[56];
        int lofmt = BitConverter.ToInt32(d, 57);
        int lw = d[61], lh = d[62];
        int depth = vmin >= 2 ? BitConverter.ToUInt16(d, 63) : 1;
        if (Math.Max(w, h) <= maxSize) return d;
        if (frames > 1 || depth > 1 || (flags & 0x4000) != 0) { note = "kept whole (animated/cube/volume)"; return d; }
        if (SizeOf(fmt, 4, 4) < 0) { note = "kept whole (format " + fmt + ")"; return d; }
        long hi = -1;
        if (vmin >= 3)
        {
            int nres = BitConverter.ToInt32(d, 68);
            for (int k = 0; k < nres && 80 + 8 * k + 8 <= d.Length; k++)
            {
                int o = 80 + 8 * k;
                if (d[o] == 0x30 && d[o + 1] == 0 && d[o + 2] == 0) hi = BitConverter.ToUInt32(d, o + 4);
            }
        }
        else
        {
            long lo = (lofmt >= 0 && lofmt != -1) ? SizeOf(lofmt, lw, lh) : 0;
            if (lo < 0) { note = "kept whole (thumbnail format)"; return d; }
            hi = hsize + lo;
        }
        if (hi < 0) { note = "kept whole (no image data found)"; return d; }
        int m0 = 0;
        while (m0 < mips - 1 && Math.Max(w >> m0, h >> m0) > maxSize) m0++;
        if (m0 == 0) return d;
        long keep = 0;
        for (int k = m0; k < mips; k++) keep += SizeOf(fmt, w >> k, h >> k);
        if (hi + keep > d.Length) { note = "kept whole (short file)"; return d; }
        byte[] o2 = new byte[80 + keep];
        o2[0] = (byte)'V'; o2[1] = (byte)'T'; o2[2] = (byte)'F';
        BitConverter.GetBytes(7).CopyTo(o2, 4);
        BitConverter.GetBytes(2).CopyTo(o2, 8);
        BitConverter.GetBytes(80).CopyTo(o2, 12);
        BitConverter.GetBytes((ushort)Math.Max(1, w >> m0)).CopyTo(o2, 16);
        BitConverter.GetBytes((ushort)Math.Max(1, h >> m0)).CopyTo(o2, 18);
        BitConverter.GetBytes(flags).CopyTo(o2, 20);
        BitConverter.GetBytes((ushort)1).CopyTo(o2, 24);
        Array.Copy(d, 32, o2, 32, 12);   // reflectivity
        Array.Copy(d, 48, o2, 48, 4);    // bumpmap scale
        BitConverter.GetBytes(fmt).CopyTo(o2, 52);
        o2[56] = (byte)(mips - m0);
        BitConverter.GetBytes(-1).CopyTo(o2, 57);
        BitConverter.GetBytes((ushort)1).CopyTo(o2, 63);
        Array.Copy(d, hi, o2, 80, keep);
        note = "trimmed " + w + "x" + h + " -> " + Math.Max(1, w >> m0) + "x" + Math.Max(1, h >> m0);
        return o2;
    }

    // packDirs in increasing priority (later ones override earlier ones). Returns the number of files written.
    public static int Run(string[] packDirs, string outDir, int maxSize)
    {
        var chosen = new Dictionary<string, Entry>();
        var source = new Dictionary<string, string>();
        foreach (string pd in packDirs)
        {
            string dirFile = Path.Combine(pd, "pak01_dir.vpk");
            if (!File.Exists(dirFile)) continue;
            int n = 0;
            foreach (var e in ReadDir(dirFile))
            {
                if (!Wanted(e.Path)) continue;
                chosen[e.Path] = e; source[e.Path] = Path.GetFileName(pd); n++;
            }
            Console.WriteLine("  " + Path.GetFileName(pd) + ": " + n + " materials and model files");
        }
        var manifest = new StringBuilder("path\tpack\tbytes\tnote\n");
        int written = 0, failed = 0;
        long total = 0;
        foreach (var kv in chosen)
        {
            try
            {
                byte[] data = Read(kv.Value);
                string note = "";
                if (kv.Key.EndsWith(".vtf")) data = TrimVtf(data, maxSize, out note);
                string dest = Path.Combine(outDir, kv.Key.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(dest));
                File.WriteAllBytes(dest, data);
                manifest.Append(kv.Key).Append('\t').Append(source[kv.Key]).Append('\t').Append(data.Length).Append('\t').Append(note).Append('\n');
                written++; total += data.Length;
                if (written % 1000 == 0) Console.WriteLine("  " + written + " of " + chosen.Count + " files, " + (total >> 20) + " MB");
            }
            catch (Exception ex)
            {
                failed++;
                manifest.Append(kv.Key).Append('\t').Append(source[kv.Key]).Append("\t0\tFAILED ").Append(ex.Message.Replace('\t', ' ').Replace('\n', ' ')).Append('\n');
            }
        }
        CloseAll();
        File.WriteAllText(Path.Combine(outDir, "manifest.tsv"), manifest.ToString());
        Console.WriteLine("  wrote " + written + " files (" + (total >> 20) + " MB), " + failed + " failed");
        return written;
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
$drive = (Get-Item $env:USERPROFILE).PSDrive
if ($drive.Free -lt 8GB) { Write-Host ("Warning: only {0:N1} GB free on {1}:. About 8 GB is needed." -f ($drive.Free / 1GB), $drive.Name) -ForegroundColor Yellow }

# ---- 1. export (skipped when a finished export is already there)
New-Item -ItemType Directory -Force $Out | Out-Null
if (Test-Path (Join-Path $Out "manifest.tsv")) {
  Write-Host "Export already done in $Out (delete manifest.tsv there to redo it)."
} else {
  Write-Host "Exporting materials and models to $Out ..."
  Add-Type -TypeDefinition $P2ExportSource -Language CSharp
  $packs = @("portal2", "portal2_tempcontent", "portal2_dlc1", "portal2_dlc2", "update") | ForEach-Object { Join-Path $Portal2 $_ } | Where-Object { Test-Path (Join-Path $_ "pak01_dir.vpk") }
  [void][P2Export]::Run([string[]]$packs, $Out, $MaxSize)
}

# ---- 2. upload to GitHub, in batches of about 700 MB
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "The files are in $Out. To upload them, install Git (winget install --id Git.Git -e), open a NEW PowerShell window and run this script again." -ForegroundColor Yellow
  exit 0
}
Push-Location $Out
try {
  if (-not (Test-Path ".git")) {
    git init -q
    git symbolic-ref HEAD refs/heads/p2-library
  }
  git config core.autocrlf false
  git config http.postBuffer 524288000
  if (-not (git config user.name)) { git config user.name "p2-export" }
  if (-not (git config user.email)) { git config user.email "p2-export@localhost" }
  if (git remote) { git remote set-url origin $Remote } else { git remote add origin $Remote }
  Set-Content -Path ".gitattributes" -Value "* -text" -Encoding ASCII

  # Folders to add, grouped so each commit is at most about 700 MB.
  $groups = @(); $cur = @(); $size = 0
  $dirs = @()
  foreach ($top in "materials", "models") { if (Test-Path $top) { $dirs += @(Get-ChildItem -Directory $top) } }
  foreach ($d in $dirs) {
    $s = (Get-ChildItem -Recurse -File $d.FullName | Measure-Object Length -Sum).Sum
    if ($cur.Count -gt 0 -and $size + $s -gt 700MB) { $groups += ,$cur; $cur = @(); $size = 0 }
    $cur += (Resolve-Path -Relative $d.FullName); $size += $s
  }
  if ($cur.Count -gt 0) { $groups += ,$cur }
  # Loose files directly in materials/ and models/ go with the first batch.
  $loose = @(Get-ChildItem -File "materials", "models" -ErrorAction SilentlyContinue | ForEach-Object { Resolve-Path -Relative $_.FullName })

  $i = 0
  foreach ($g in $groups) {
    $i++
    $paths = @($g)
    if ($i -eq 1) { $paths += @(".gitattributes", "manifest.tsv") + $loose }
    git add -- $paths
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit -q -m "Portal 2 library, part $i of $($groups.Count)"
    }
    Write-Host "Uploading part $i of $($groups.Count) ..."
    git push -u origin p2-library
    if ($LASTEXITCODE -ne 0) { throw "Upload failed. Check your internet and run the script again: it resumes." }
  }
  Write-Host "Done. Everything is on GitHub (branch p2-library). You can close this window." -ForegroundColor Green
} finally {
  Pop-Location
}
