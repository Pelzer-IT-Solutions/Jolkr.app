# Pulls origin/dev, builds jolkr-app, and (after confirmation) deploys
# the dist/ bundle to the nginx volume-mount on render-unit.
#
# Usage:
#   .\scripts\deploy-fe.ps1              # pull + build + ask before deploy
#   .\scripts\deploy-fe.ps1 -NoPull      # skip git pull (use working tree as-is)
#   .\scripts\deploy-fe.ps1 -NoDeploy    # build only, leave dist/ local
#   .\scripts\deploy-fe.ps1 -Yes         # auto-confirm the deploy prompt

[CmdletBinding()]
param(
    [switch]$NoPull,
    [switch]$NoDeploy,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path -Parent $PSScriptRoot
$appDir     = Join-Path $repoRoot 'jolkr-app'
$distDir    = Join-Path $appDir 'dist'
$remote     = 'phill@192.168.178.22'
$remoteDist = '/home/phill/jolkr/dist'

function Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Fail([string]$msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}

# --- 1. git pull ---------------------------------------------------------
if (-not $NoPull) {
    Step "git pull --ff-only"
    Set-Location $repoRoot
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "git pull failed" }
}

# --- 2. npm install (only when lockfile changed) -------------------------
Set-Location $appDir
$lockFile  = Join-Path $appDir 'package-lock.json'
$nmLock    = Join-Path $appDir 'node_modules\.package-lock.json'
$installed = (Test-Path $nmLock) -and `
             ((Get-Item $nmLock).LastWriteTime -ge (Get-Item $lockFile).LastWriteTime)

if (-not $installed) {
    Step "npm install (lockfile changed)"
    npm install
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed" }
} else {
    Step "npm install — skipped (node_modules up to date)"
}

# --- 3. type-check -------------------------------------------------------
Step "tsc -b"
npx tsc -b
if ($LASTEXITCODE -ne 0) { Fail "tsc failed" }

# --- 4. lint -------------------------------------------------------------
Step "eslint --max-warnings=0 src"
npx eslint --max-warnings=0 src
if ($LASTEXITCODE -ne 0) { Fail "eslint failed" }

# --- 5. build ------------------------------------------------------------
Step "vite build"
npx vite build
if ($LASTEXITCODE -ne 0) { Fail "vite build failed" }

if (-not (Test-Path $distDir)) { Fail "dist/ missing after build" }

if ($NoDeploy) {
    Write-Host ""
    Write-Host "Build complete. Skipping deploy (-NoDeploy)." -ForegroundColor Green
    exit 0
}

# --- 6. confirm ----------------------------------------------------------
if (-not $Yes) {
    Write-Host ""
    Write-Host "Ready to deploy to ${remote}:${remoteDist}/" -ForegroundColor Yellow
    Write-Host "This wipes the remote dist/ and replaces it with the freshly built bundle."
    $confirm = Read-Host "Continue? [y/N]"
    if ($confirm -notin @('y', 'Y')) {
        Write-Host "Cancelled."
        exit 0
    }
}

# --- 7. tar + scp + remote stage + rsync swap ---------------------------
# Crash-safe deploy. Flow on remote:
#   1. mktemp staging dir (outside dist/)
#   2. extract tar there
#   3. sanity-check (index.html + assets/ must exist)
#   4. rsync -a --delete staging/ → dist/ (contents replace, no dir rename)
# Old dist/ stays intact through 1–3. If any step fails, set -e aborts and
# the trap cleans up staging + tempfile — dist/ is never wiped pre-swap.
# rsync deletes outdated files only after new versions are in place, so
# nginx never sees an empty directory mid-sync.
#
# Why scp the bash script as a file (instead of `ssh remote "..."`):
#  - PowerShell 5.1 corrupts binary streams piped between native commands
#    (so we already staged the tar to a tempfile + scp).
#  - Windows OpenSSH ssh.exe also mangles embedded `"` chars in inline
#    command args, breaking `trap "..."` etc. Reading the script from a
#    file on the remote bypasses all transport-layer quote handling.
Step "tar + scp + remote stage + rsync — sync dist/ to render-unit"

$rand         = Get-Random
$tempTar      = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-dist-$rand.tar"
$tempScript   = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-deploy-$rand.sh"
$remoteTmp    = "/tmp/jolkr-dist-$rand.tar"
$remoteScript = "/tmp/jolkr-deploy-$rand.sh"

# In this here-string:
#   $remoteTmp / $remoteDist / $remoteScript → interpolated by PowerShell
#   `$STAGE / `$(mktemp ...)                 → escaped, sent literal to bash
$bashScript = @"
#!/bin/bash
set -e
STAGE=`$(mktemp -d /tmp/jolkr-dist-stage.XXXXXX)
trap "rm -rf `$STAGE $remoteTmp $remoteScript" EXIT
tar -xf $remoteTmp -C `$STAGE
test -f `$STAGE/index.html
test -d `$STAGE/assets
mkdir -p $remoteDist
rsync -a --delete `$STAGE/ $remoteDist/
"@

# Write the bash script with LF line endings, ASCII, no BOM — bash chokes
# on CRLF and would barf at the shebang otherwise.
[System.IO.File]::WriteAllBytes(
    $tempScript,
    [System.Text.Encoding]::ASCII.GetBytes(($bashScript -replace "`r`n", "`n"))
)

try {
    tar -cf $tempTar -C $distDir .
    if ($LASTEXITCODE -ne 0) { Fail "local tar failed" }

    scp -q $tempTar $tempScript "${remote}:/tmp/"
    if ($LASTEXITCODE -ne 0) { Fail "scp upload failed" }

    ssh $remote "bash $remoteScript"
    if ($LASTEXITCODE -ne 0) { Fail "remote stage/rsync failed (prod dist untouched)" }
}
finally {
    if (Test-Path $tempTar)    { Remove-Item $tempTar -Force }
    if (Test-Path $tempScript) { Remove-Item $tempScript -Force }
}

Write-Host ""
Write-Host "Done. https://jolkr.app/app/ now serves the new bundle." -ForegroundColor Green
