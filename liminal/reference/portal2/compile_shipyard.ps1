# Compiles shipyard_v13p.vmf with Portal 2's own map compiler (vbsp, vvis, vrad),
# then splits the .bsp into parts under 28 MB on your Desktop in "p2compile".
# Needs the "Portal 2 Authoring Tools" (Steam > Library > Tools). It only reads your files.
# Put shipyard_v13p.vmf on your Desktop first. If Steam isn't in the default place, change the next line.
$p2  = "C:\Program Files (x86)\Steam\steamapps\common\Portal 2"
$out = "$env:USERPROFILE\Desktop\p2compile"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item "$env:USERPROFILE\Desktop\shipyard_v13p.vmf" "$out\shipyard_v13p.vmf"
$game = "$p2\portal2"
& "$p2\bin\vbsp.exe" -game $game "$out\shipyard_v13p.vmf"
& "$p2\bin\vvis.exe" -fast -game $game "$out\shipyard_v13p.bsp"
& "$p2\bin\vrad.exe" -both -StaticPropLighting -game $game "$out\shipyard_v13p.bsp"
# Split for upload (each part under 28 MB).
$bytes = [IO.File]::ReadAllBytes("$out\shipyard_v13p.bsp")
$size = 28000000; $n = 0
for ($o = 0; $o -lt $bytes.Length; $o += $size) {
  $n++; $len = [Math]::Min($size, $bytes.Length - $o)
  [IO.File]::WriteAllBytes("$out\bsp_part$n.bin", $bytes[$o..($o + $len - 1)])
}
Write-Host "Done. Upload the bsp_part*.bin files from $out (and the .log files if something failed)."
