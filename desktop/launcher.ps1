# Hypnic Teen — desktop launcher.
#
# Finds the game server on the local network and opens it in a chromeless app
# window, so it looks and behaves like an installed program. Nothing to install:
# every Windows machine already has Edge, and most have Chrome.
#
# Double-click "Hypnic Teen.bat" rather than running this directly.

$ErrorActionPreference = 'Stop'
$PORT = 8008
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$memory = Join-Path $here 'last-server.txt'

function Write-Banner {
  Write-Host ''
  Write-Host '   HYPNIC TEEN' -ForegroundColor Red
  Write-Host '   Fun World' -ForegroundColor DarkYellow
  Write-Host ''
}

# Chrome first (better app-window behaviour), then Edge, which is always there.
function Find-Browser {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  return $null
}

function Test-Hypnic([string]$address) {
  try {
    $r = Invoke-WebRequest "http://$address/api/health" -UseBasicParsing -TimeoutSec 2
    return ($r.Content -match '"ok"' -and $r.Content -match 'members')
  } catch { return $false }
}

# Sweeps this machine's own /24. All 254 probes are opened at once and then
# collected, which keeps a full sweep to about a second.
function Find-Servers {
  $prefixes = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { $_.IPAddress -replace '\.\d+$', '.' } |
    Select-Object -Unique

  $hits = @()
  foreach ($prefix in $prefixes) {
    Write-Host "   scanning $prefix" + "0/24 ..." -ForegroundColor DarkGray
    $pending = @()
    foreach ($i in 1..254) {
      $client = New-Object System.Net.Sockets.TcpClient
      $pending += [pscustomobject]@{
        Ip     = "$prefix$i"
        Client = $client
        Handle = $client.BeginConnect("$prefix$i", $PORT, $null, $null)
      }
    }
    Start-Sleep -Milliseconds 700
    foreach ($p in $pending) {
      if ($p.Handle.IsCompleted -and $p.Client.Connected) {
        if (Test-Hypnic "$($p.Ip):$PORT") { $hits += "$($p.Ip):$PORT" }
      }
      try { $p.Client.Close() } catch { }
    }
    if ($hits.Count) { break }
  }
  return $hits
}

function Start-App([string]$address) {
  $url = "http://$address"
  $browser = Find-Browser
  Set-Content -Path $memory -Value $address -Encoding ascii
  if ($browser) {
    Write-Host "   opening $url" -ForegroundColor Green
    # --app strips the address bar and tabs: a plain window, like a real app.
    Start-Process $browser -ArgumentList "--app=$url","--window-size=1100,820"
  } else {
    Write-Host "   opening in your default browser" -ForegroundColor Green
    Start-Process $url
  }
}

Write-Banner

# The address that worked last time is almost always still right.
if (Test-Path $memory) {
  $last = (Get-Content $memory -Raw).Trim()
  if ($last -and (Test-Hypnic $last)) {
    Start-App $last
    exit 0
  }
}

Write-Host '   Looking for a game on this network...' -ForegroundColor Gray
$servers = Find-Servers

if ($servers.Count -eq 1) {
  Start-App $servers[0]
  exit 0
}

if ($servers.Count -gt 1) {
  Write-Host ''
  Write-Host '   More than one game is running:' -ForegroundColor Yellow
  for ($i = 0; $i -lt $servers.Count; $i++) { Write-Host "     [$($i+1)] $($servers[$i])" }
  $pick = Read-Host '   Which one'
  $index = [int]$pick - 1
  if ($index -ge 0 -and $index -lt $servers.Count) { Start-App $servers[$index]; exit 0 }
}

Write-Host ''
Write-Host '   No game found on this network.' -ForegroundColor Yellow
Write-Host '   Make sure the host has started it, and that you are on their WiFi.'
Write-Host ''
$manual = Read-Host '   Type the address they gave you (or press Enter to quit)'
if ($manual) {
  if ($manual -notmatch ':') { $manual = "${manual}:$PORT" }
  $manual = $manual -replace '^https?://', ''
  Start-App $manual
}
