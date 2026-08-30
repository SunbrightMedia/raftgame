<#
.SYNOPSIS
  Type-checks all C# in the project WITHOUT taking Unity's project lock.

.DESCRIPTION
  compile.ps1 is the authoritative check, but it launches the editor and so
  fails whenever Unity is open. This runs Unity's own Roslyn compiler directly
  against the same reference assemblies, which catches every compile error in
  a few seconds and works while you are playing the game.

  It does not compile shaders and does not run Unity's asset pipeline, so
  compile.ps1 is still the final word before committing when Unity is closed.

  Exit code 0 = clean, 1 = errors.
#>
[CmdletBinding()]
param(
    [string]$UnityData = "C:\Program Files\Unity\Hub\Editor\2022.3.40f1\Editor\Data",
    [string]$ProjectPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$dotnet = Join-Path $UnityData 'NetCoreRuntime\dotnet.exe'
$csc = Join-Path $UnityData 'DotNetSdkRoslyn\csc.dll'
foreach ($tool in @($dotnet, $csc)) {
    if (-not (Test-Path $tool)) { Write-Error "Missing '$tool'. Pass -UnityData <Editor\Data path>." }
}

$out = Join-Path $env:TEMP 'raftgame-typecheck'
New-Item -ItemType Directory -Force $out | Out-Null

# Unity's script assemblies carry the package APIs (URP, UI). They are only
# present after the editor has compiled at least once.
$scriptAssemblies = Join-Path $ProjectPath 'Library\ScriptAssemblies'

function Get-Refs([bool]$includeEditor) {
    $refs = @(Join-Path $UnityData 'NetStandard\ref\2.1.0\netstandard.dll')
    $refs += Get-ChildItem (Join-Path $UnityData 'NetStandard\compat\2.1.0\shims\netstandard\*.dll') -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    $refs += Get-ChildItem (Join-Path $UnityData 'Managed\UnityEngine\*.dll') | ForEach-Object { $_.FullName }
    if ($includeEditor) {
        # UnityEditor.dll and UnityEditor.CoreModule.dll both define MenuItem
        # and friends. Unity disambiguates these internally; here it is simpler
        # to drop the CoreModule shim and keep the monolithic assembly.
        $refs = $refs | Where-Object { $_ -notmatch 'UnityEditor\.CoreModule\.dll$' }
        $editorDll = Join-Path $UnityData 'Managed\UnityEditor.dll'
        if (Test-Path $editorDll) { $refs += $editorDll }
    }
    if (Test-Path $scriptAssemblies) {
        $refs += Get-ChildItem "$scriptAssemblies\*.dll" |
            Where-Object { $_.Name -notmatch 'Assembly-CSharp' } |
            ForEach-Object { $_.FullName }
    }
    return $refs
}

function Invoke-Check($name, $sources, $refs) {
    if ($sources.Count -eq 0) { return $true }

    $rsp = Join-Path $out "$name.rsp"
    $lines = @('-target:library', "-out:$out\$name.dll", '-nologo', '-nostdlib+', '-langversion:9')
    $lines += ($refs | ForEach-Object { "-r:`"$_`"" })
    $lines += ($sources | ForEach-Object { "`"$_`"" })
    Set-Content -Path $rsp -Value $lines -Encoding utf8

    Write-Host "Checking $name ($($sources.Count) files)..." -ForegroundColor Cyan
    $output = & $dotnet $csc "@$rsp" 2>&1
    $ok = $LASTEXITCODE -eq 0

    if (-not $ok) {
        $output | Where-Object { $_ -match ': error ' } | Select-Object -First 40 |
            ForEach-Object { Write-Host $_ -ForegroundColor Red }
    }
    return $ok
}

$runtime = @(Get-ChildItem (Join-Path $ProjectPath 'Assets\Scripts') -Recurse -Filter *.cs -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$editor = @(Get-ChildItem (Join-Path $ProjectPath 'Assets\Editor') -Recurse -Filter *.cs -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })

$runtimeOk = Invoke-Check 'runtime' $runtime (Get-Refs $false)

# Editor scripts reference the runtime ones, so compile them together.
$editorOk = Invoke-Check 'editor' ($editor + $runtime) (Get-Refs $true)

Write-Host ''
if ($runtimeOk -and $editorOk) {
    Write-Host "TYPECHECK CLEAN" -ForegroundColor Green
    exit 0
}

Write-Host "TYPECHECK FAILED" -ForegroundColor Red
exit 1
