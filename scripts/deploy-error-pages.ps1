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
$domains  = @('jolkr.app', 'upload.jolkr.app')

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
foreach ($u in @('https://jolkr.app/saap', 'https://upload.jolkr.app/')) {
    # curl.exe emits an array of lines; -match on an array filters instead of
    # matching, which leaves $Matches empty. Join first.
    $body = (curl.exe -s --max-time 15 $u) -join "`n"
    if ($body -match '<title>([^<]*)</title>') {
        $title = $Matches[1]
        if ($title -like '*Jolkr*') { Ok "$u -> $title" }
        else { Fail "$u still serves '$title' — expected the Jolkr page" }
    } else {
        Fail "$u returned no title"
    }
}

Write-Host ""
Ok "error pages deployed"
