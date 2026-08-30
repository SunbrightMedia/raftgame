<#
.SYNOPSIS
  Renders Assets/Scenes/Ocean.unity to PNGs in Logs/shots via headless Unity.
.DESCRIPTION
  Runs WITHOUT -nographics on purpose: Camera.Render needs a real GPU context.
#>
[CmdletBinding()]
param(
    [string]$UnityPath = "C:\Program Files\Unity\Hub\Editor\2022.3.40f1\Editor\Unity.exe",
    [string]$ProjectPath = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $UnityPath)) { Write-Error "Unity not found at '$UnityPath'." }

$logsDir  = Join-Path $ProjectPath 'Logs'
$unityLog = Join-Path $logsDir 'unity-capture.log'
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }

$unityArgs = @(
    '-batchmode'
    '-quit'
    '-projectPath', $ProjectPath
    '-executeMethod', 'SceneCapture.RunBatch'
    '-logFile', $unityLog
)

Write-Host "Rendering scene..." -ForegroundColor Cyan
$proc = Start-Process -FilePath $UnityPath -ArgumentList $unityArgs -Wait -PassThru -NoNewWindow

if ($proc.ExitCode -ne 0) {
    Get-Content $unityLog | Select-String -Pattern 'SceneCapture failed|error CS|Shader error|Exception' |
        ForEach-Object { Write-Host $_.Line.Trim() -ForegroundColor Red }
    Write-Error "Capture failed (exit $($proc.ExitCode)). Log: $unityLog"
}

Get-ChildItem (Join-Path $logsDir 'shots') -Filter *.png |
    ForEach-Object { Write-Host "  $($_.FullName) ($([math]::Round($_.Length/1kb)) KB)" -ForegroundColor Green }
