<#
.SYNOPSIS
  Compiles the project headlessly with Unity and prints any C# / shader errors.

.DESCRIPTION
  Runs Unity in batchmode against CompileCheck.RunBatch (Assets/Editor/CompileCheck.cs).
  Script errors are reported by scanning the Unity log (Unity never reaches
  -executeMethod when C# fails to compile); shader errors come from the log file
  the editor script writes.

  Exit code 0 = clean, 1 = errors found.
#>
[CmdletBinding()]
param(
    [string]$UnityPath = "C:\Program Files\Unity\Hub\Editor\2022.3.40f1\Editor\Unity.exe",
    [string]$ProjectPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $UnityPath)) {
    Write-Error "Unity not found at '$UnityPath'. Pass -UnityPath <path to Unity.exe>."
}

$logsDir     = Join-Path $ProjectPath 'Logs'
$unityLog    = Join-Path $logsDir 'unity-batch.log'
$errorLog    = Join-Path $logsDir 'compile-errors.log'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
Remove-Item $unityLog, $errorLog -ErrorAction SilentlyContinue

$unityArgs = @(
    '-batchmode'
    '-nographics'
    '-quit'
    '-projectPath', $ProjectPath
    '-executeMethod', 'CompileCheck.RunBatch'
    '-logFile', $unityLog
)

Write-Host "Running Unity batchmode compile..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $UnityPath -ArgumentList $unityArgs -Wait -PassThru -NoNewWindow
$unityExit = $proc.ExitCode

if (-not (Test-Path $unityLog)) {
    Write-Error "Unity produced no log at '$unityLog' (exit $unityExit)."
}

$log = Get-Content $unityLog

# C# errors: matched straight out of the Unity log so they surface even when
# compilation failed hard and CompileCheck never ran.
$csErrors = $log | Select-String -Pattern '\): error CS\d+:' | ForEach-Object { $_.Line.Trim() } | Select-Object -Unique

# Shader errors: both the editor script's report and Unity's own shader logging.
$shaderLogErrors = $log |
    Select-String -Pattern "Shader error in|^Shader compiler:|error: '.*' : " |
    ForEach-Object { $_.Line.Trim() } | Select-Object -Unique

$reportErrors = @()
if (Test-Path $errorLog) {
    $reportErrors = Get-Content $errorLog | Where-Object { $_ -match ': error' -or $_ -match '^COMPILE ' -or $_ -match '^EXCEPTION' }
}

Write-Host ''
if ($csErrors) {
    Write-Host "=== C# errors ($($csErrors.Count)) ===" -ForegroundColor Red
    $csErrors | ForEach-Object { Write-Host $_ }
    Write-Host ''
}
if ($shaderLogErrors) {
    Write-Host "=== Shader errors ($($shaderLogErrors.Count)) ===" -ForegroundColor Red
    $shaderLogErrors | ForEach-Object { Write-Host $_ }
    Write-Host ''
}
if ($reportErrors) {
    Write-Host "=== CompileCheck report ($errorLog) ===" -ForegroundColor Yellow
    $reportErrors | ForEach-Object { Write-Host $_ }
    Write-Host ''
}

# Unity may compile more than once in a run (e.g. new scripts imported after
# the first pass): early-pass CS errors can appear in the log even though the
# final compile succeeded. When CompileCheck ran and reported success, trust
# that final verdict; the log scan is the fallback for hard failures where
# -executeMethod never ran at all.
$reportedOk = ($reportErrors | Where-Object { $_ -match '^COMPILE OK' }).Count -gt 0
if ($reportedOk -and $unityExit -eq 0) {
    if ($csErrors) { Write-Host "(ignoring $($csErrors.Count) stale early-pass CS error(s); final compile succeeded)" -ForegroundColor DarkGray }
    $csErrors = @()
}

$failed = ($csErrors.Count -gt 0) -or ($shaderLogErrors.Count -gt 0) -or ($unityExit -ne 0)

if ($failed) {
    Write-Host "COMPILE FAILED (unity exit $unityExit). Full log: $unityLog" -ForegroundColor Red
    exit 1
}

Write-Host "COMPILE CLEAN (unity exit $unityExit)." -ForegroundColor Green
exit 0
