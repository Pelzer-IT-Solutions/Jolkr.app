# Regenerates the Jolkr error pages and copies them to the Hestia
# document_errors directories on web-unit.
#
# Run this after ANY `v-rebuild-web-domain` on jolkr.app or upload.jolkr.app:
# a rebuild wipes document_errors/ and restores Hestia's four stock files,
# which silently reverts the branded pages.
#
# The nginx wiring (the per-vhost error_page block and, on upload, the
# internal /error/ location) lives in the Hestia templates and survives a
# rebuild — only the HTML needs re-copying.
#
# Usage:
#   .\scripts\deploy-error-pages.ps1            # generate + copy + verify
#   .\scripts\deploy-error-pages.ps1 -NoDeploy  # generate only

[CmdletBinding()]
param(
    [switch]$NoDeploy
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcDir   = Join-Path $repoRoot 'jolkr-server\docker\error-pages'
$distDir  = Join-Path $srcDir 'dist'
$remote   = '192.168.178.20'   # web-unit, root via ~/.ssh/config
$domains  = @('jolkr.app', 'upload.jolkr.app', 'status.jolkr.app')

function Step([string]$m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "FAIL: $m" -ForegroundColor Red; exit 1 }
function Ok([string]$m)   { Write-Host "OK: $m" -ForegroundColor Green }

Step "generate"
node (Join-Path $srcDir 'generate.mjs')
if ($LASTEXITCODE -ne 0) { Fail "generate.mjs failed" }

if ($NoDeploy) { Ok "generated only (-NoDeploy)"; exit 0 }

Step "copy to web-unit"
foreach ($d in $domains) {
    $local = Join-Path $distDir $d
    if (-not (Test-Path $local)) { Fail "missing generated output for $d" }

    ssh $remote "mkdir -p /root/error-stage/$d"
    if ($LASTEXITCODE -ne 0) { Fail "could not create staging dir for $d" }

    scp -q "$local\*.html" "${remote}:/root/error-stage/$d/"
    if ($LASTEXITCODE -ne 0) { Fail "scp failed for $d" }

    # Hestia serves these as the domain owner; install rather than cp so the
    # ownership is right even when the rebuild recreated the directory.
    ssh $remote "install -o phillipp -g phillipp -m 644 /root/error-stage/$d/*.html /home/phillipp/web/$d/document_errors/"
    if ($LASTEXITCODE -ne 0) { Fail "install failed for $d" }
    Ok "$d"
}

# open_file_cache_valid is 60s on this box, so a reload avoids serving the
# previous files for up to a minute after a deploy.
Step "reload nginx"
# nginx -t is noisy on this box (pre-existing ssl_stapling + server-name
# warnings on unrelated domains); only the verdict matters here.
ssh $remote "nginx -t 2>&1 | tail -2 && systemctl reload nginx"
if ($LASTEXITCODE -ne 0) { Fail "nginx config test or reload failed" }

Step "verify"
# status.jolkr.app proxies every path to the API's /health page, so it has no
# reachable 404 — its error documents only surface when the backend is down.
# Verifying it means asking for the status page itself, with an Accept header,
# since a bare request there returns JSON and would have no <title> at all.
$checks = @(
    @{ url = 'https://jolkr.app/saap';       accept = $null;        expect = 'Page not found' },
    @{ url = 'https://upload.jolkr.app/';    accept = $null;        expect = 'Page not found' },
    @{ url = 'https://status.jolkr.app/';    accept = 'text/html';  expect = 'Service Status' }
)
foreach ($c in $checks) {
    # curl.exe emits an array of lines; -match on an array filters instead of
    # matching, which leaves $Matches empty. Join first.
    $args = @('-s', '--max-time', '15')
    if ($c.accept) { $args += @('-H', "Accept: $($c.accept)") }
    $body = (curl.exe @args $c.url) -join "`n"
    if ($body -match '<title>([^<]*)</title>') {
        $title = $Matches[1]
        if ($title -like '*Jolkr*' -and $title -like "*$($c.expect)*") { Ok "$($c.url) -> $title" }
        else { Fail "$($c.url) serves '$title' — expected a Jolkr '$($c.expect)' page" }
    } else {
        Fail "$($c.url) returned no title"
    }
}

# The status vhost's own error documents cannot be reached over HTTP while the
# backend is up, so check them on disk instead. Single-quoted on purpose: the
# remote command must reach bash verbatim, without PowerShell interpolation.
$found = ssh $remote 'ls /home/phillipp/web/status.jolkr.app/document_errors/50*.html 2>/dev/null | wc -l'
if ($LASTEXITCODE -ne 0) { Fail "could not list status.jolkr.app error documents" }
if ([int]$found -lt 4) { Fail "status.jolkr.app has $found of the expected 4 upstream-error documents (502/503/504/50x)" }
Ok "status.jolkr.app upstream-error documents in place ($found)"

Write-Host ""
Ok "error pages deployed"
