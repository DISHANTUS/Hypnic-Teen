# Rebuilds the studio opening from scratch: renders every frame in Blender,
# then encodes public/media/intro.mp4 and the poster.
#
#   npm run film

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$blender = if ($env:BLENDER) { $env:BLENDER } else { 'G:\Blender\blender.exe' }
if (-not (Test-Path $blender)) { throw "Blender not found at $blender - set `$env:BLENDER" }

$ffmpeg = $null
try { $ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source } catch {}
if (-not $ffmpeg) {
  $winget = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter ffmpeg.exe -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($winget) { $ffmpeg = $winget.FullName }
}
if (-not $ffmpeg) { throw 'ffmpeg not found - winget install Gyan.FFmpeg' }

Write-Host '  [1/2] rendering frames (Blender, ~3 min)'
& $blender -b --factory-startup -P (Join-Path $here 'tools\intro-film.py') -- --film | Out-Null
if ($LASTEXITCODE) { throw 'Blender render failed' }

Write-Host '  [2/2] encoding (with bloom)'
# The glow pass runs in RGB end to end — mixing RGB and YUV branches inside
# the blend once turned the whole film magenta.
$bloom = "[0:v]format=gbrp,split=2[base][hl];" +
  "[hl]lutrgb=r='clip((val-150)*2.6,0,255)':g='clip((val-150)*2.6,0,255)':b='clip((val-150)*2.6,0,255)',gblur=sigma=13[glow];" +
  "[base][glow]blend=all_mode=screen,format=yuv420p[out]"
& $ffmpeg -y -framerate 30 -i (Join-Path $here 'build-media\f%04d.png') `
  -filter_complex $bloom -map '[out]' `
  -c:v libx264 -crf 20 -preset slow -movflags +faststart `
  (Join-Path $here 'public\media\intro.mp4') 2>$null
if ($LASTEXITCODE) { throw 'ffmpeg encode failed' }

# The poster is pulled from the encoded film so it carries the bloom too.
& $ffmpeg -y -ss 7.2 -i (Join-Path $here 'public\media\intro.mp4') -frames:v 1 `
  (Join-Path $here 'public\media\intro-poster.png') 2>$null
if ($LASTEXITCODE) { throw 'poster extraction failed' }
Write-Host '  Remember: bump FILM_VERSION in public/js/intro.js and the ?v= entries in public/sw.js.'

$size = [math]::Round((Get-Item (Join-Path $here 'public\media\intro.mp4')).Length / 1KB)
Write-Host "  Done - public/media/intro.mp4 ($size KB)" -ForegroundColor Green
