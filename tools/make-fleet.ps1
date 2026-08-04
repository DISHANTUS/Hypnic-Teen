# Rebuilds the fleet models into public/media/fleet/*.glb
#
#   npm run fleet
#
# Parametric hard-surface warships: symmetric by construction, a few hundred
# triangles each, tens of kilobytes. Edit tools/fleet.py and re-run.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$blender = if ($env:BLENDER) { $env:BLENDER } else { 'G:\Blender\blender.exe' }
if (-not (Test-Path $blender)) { throw "Blender not found at $blender - set `$env:BLENDER" }

& $blender -b --factory-startup -P (Join-Path $here 'tools\fleet.py') -- --export
if ($LASTEXITCODE) { throw 'fleet export failed' }

$dir = Join-Path $here 'public\media\fleet'
$total = (Get-ChildItem $dir -Filter *.glb | Measure-Object Length -Sum).Sum / 1KB
Write-Host ("  Fleet exported - {0:N0} KB total" -f $total) -ForegroundColor Green
