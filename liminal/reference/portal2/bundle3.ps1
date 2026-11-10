# Copies 5 Portal 2 files into part*.bin files on your Desktop in "bundle3".
# It only reads your Portal 2 files. If Steam isn't in the default place, change the next line to your "Portal 2\portal2" folder.
$p2 = "C:\Program Files (x86)\Steam\steamapps\common\Portal 2\portal2"
$out = "$env:USERPROFILE\Desktop\bundle3"
New-Item -ItemType Directory -Force $out | Out-Null
$list = "24,72021930,4812,1;24,72026742,170880,1;114,23866735,64945,1;24,72262567,705,1;3,171538743,699304,1"
$streams = @{}
foreach ($e in $list.Split(";")) {
  $a = $e.Split(","); $arch = [int]$a[0]; $off = [long]$a[1]; $len = [int]$a[2]; $part = [int]$a[3]
  if (-not $streams.ContainsKey($part)) { $streams[$part] = [IO.File]::Create("$out\part$part.bin") }
  $src = [IO.File]::OpenRead(("{0}\pak01_{1:D3}.vpk" -f $p2, $arch))
  [void]$src.Seek($off, [IO.SeekOrigin]::Begin)
  $buf = New-Object byte[] $len; $n = 0
  while ($n -lt $len) { $n += $src.Read($buf, $n, $len - $n) }
  $streams[$part].Write($buf, 0, $len); $src.Close()
}
foreach ($s in $streams.Values) { $s.Close() }
Write-Host "Done. Upload the part*.bin files from $out"
