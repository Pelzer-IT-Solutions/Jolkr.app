# Combined BE+FE deploy. Pulls, detects what changed in jolkr-server/** vs
# jolkr-app/**, builds & deploys those parts to render-unit. BE is always
# rolled out before FE (per project convention), and BE deploys tag the
# current images as :prev so we can auto-rollback if the new containers
# fail their health check.
#
# Usage:
#   .\scripts\deploy.ps1                 # pull, detect, build & deploy both as needed
#   .\scripts\deploy.ps1 -NoPull         # don't pull; deploy both unless -FEOnly/-BEOnly
#   .\scripts\deploy.ps1 -FEOnly         # only FE
#   .\scripts\deploy.ps1 -BEOnly         # only BE
#   .\scripts\deploy.ps1 -NoDeploy       # build only, no remote changes
#   .\scripts\deploy.ps1 -Yes            # skip the confirm prompt

[CmdletBinding()]
param(
    [switch]$NoPull,
    [switch]$NoDeploy,
    [switch]$FEOnly,
    [switch]$BEOnly,
    [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# --- paths & remote target -----------------------------------------------
$repoRoot   = Split-Path -Parent $PSScriptRoot
$appDir     = Join-Path $repoRoot 'jolkr-app'
$distDir    = Join-Path $appDir 'dist'
$beDockerDir = Join-Path $repoRoot 'jolkr-server\docker'
$remote     = 'phill@192.168.178.22'
$remoteDist = '/home/phill/jolkr/dist'
$remoteCompose = '/home/phill/jolkr/docker'
$healthUrl  = 'https://jolkr.app/health'

# --- helpers -------------------------------------------------------------
function Step([string]$msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}
function Fail([string]$msg) {
    Write-Host "FAIL: $msg" -ForegroundColor Red
    exit 1
}
function Ok([string]$msg) {
    Write-Host "OK: $msg" -ForegroundColor Green
}
function Warn([string]$msg) {
    Write-Host "WARN: $msg" -ForegroundColor Yellow
}

if ($FEOnly -and $BEOnly) { Fail "-FEOnly and -BEOnly are mutually exclusive" }

# --- 1. git pull + detect what changed -----------------------------------
$changedFiles = @()
$preHead = $null

if (-not $NoPull) {
    Step "git pull --ff-only"
    Set-Location $repoRoot
    $preHead = (git rev-parse HEAD).Trim()
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "git pull failed" }
    $postHead = (git rev-parse HEAD).Trim()
    if ($preHead -ne $postHead) {
        $changedFiles = git diff --name-only $preHead $postHead
        Write-Host "Pulled commits:" -ForegroundColor DarkGray
        git log --oneline "$preHead..$postHead" | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    } else {
        Write-Host "Already up to date." -ForegroundColor DarkGray
    }
}

# --- 2. decide scope -----------------------------------------------------
$deployBE = $false
$deployFE = $false

if ($BEOnly) {
    $deployBE = $true
} elseif ($FEOnly) {
    $deployFE = $true
} elseif ($NoPull) {
    # Without a pull we have no signal — deploy both. Cheap enough since
    # builds are mostly cache-hits when nothing changed.
    $deployBE = $true
    $deployFE = $true
} else {
    $deployBE = [bool]($changedFiles | Where-Object { $_ -like 'jolkr-server/*' })
    $deployFE = [bool]($changedFiles | Where-Object { $_ -like 'jolkr-app/*' })
    if (-not $deployBE -and -not $deployFE) {
        Warn "no jolkr-server/ or jolkr-app/ changes pulled — nothing to deploy"
        if ($changedFiles.Count -gt 0) {
            Write-Host "Changed files (outside deploy scope):" -ForegroundColor DarkGray
            $changedFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
        exit 0
    }
}

$scopeLabel = @()
if ($deployBE) { $scopeLabel += 'BE' }
if ($deployFE) { $scopeLabel += 'FE' }
Step "Scope: $($scopeLabel -join ' + ')"

# --- 3. BE build ---------------------------------------------------------
if ($deployBE) {
    Step "docker ps (sanity)"
    docker ps -q > $null 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Docker is not running — start Docker Desktop and retry" }

    Step "docker compose build jolkr-api jolkr-media"
    Set-Location $beDockerDir
    docker compose build jolkr-api jolkr-media
    if ($LASTEXITCODE -ne 0) { Fail "BE docker compose build failed" }
    Set-Location $repoRoot
}

# --- 4. FE build ---------------------------------------------------------
if ($deployFE) {
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

    Step "tsc -b"
    npx tsc -b
    if ($LASTEXITCODE -ne 0) { Fail "tsc failed" }

    Step "eslint --max-warnings=0 src"
    npx eslint --max-warnings=0 src
    if ($LASTEXITCODE -ne 0) { Fail "eslint failed" }

    Step "vite build"
    npx vite build
    if ($LASTEXITCODE -ne 0) { Fail "vite build failed" }
    if (-not (Test-Path $distDir)) { Fail "dist/ missing after build" }

    Set-Location $repoRoot
}

if ($NoDeploy) {
    Write-Host ""
    Ok "Build complete. Skipping deploy (-NoDeploy)."
    exit 0
}

# --- 5. confirm ----------------------------------------------------------
if (-not $Yes) {
    Write-Host ""
    Write-Host "Ready to deploy to ${remote}:" -ForegroundColor Yellow
    if ($deployBE) { Write-Host "  - BE: load new images + force-recreate jolkr-api + jolkr-media (with auto-rollback if unhealthy)" }
    if ($deployFE) { Write-Host "  - FE: stage + rsync into $remoteDist/" }
    $confirm = Read-Host "Continue? [y/N]"
    if ($confirm -notin @('y', 'Y')) {
        Write-Host "Cancelled."
        exit 0
    }
}

# --- 6. BE deploy --------------------------------------------------------
# Flow on remote (executed from an scp'd bash script — Windows OpenSSH
# mangles `"` in inline ssh args, file delivery sidesteps it):
#   1. tag current :latest as :prev for both images
#   2. docker load < new-images.tar  (overwrites :latest, :prev keeps old)
#   3. docker compose up -d --force-recreate jolkr-api jolkr-media
#   4. sleep 8 → containers must show "Up" in `docker compose ps`
#   5. curl /health → must return 2xx
#   6. on any failure: retag :prev → :latest, recreate, exit 1
if ($deployBE) {
    Step "BE deploy — docker save → scp → load → recreate → health → rollback-if-bad"

    $rand            = Get-Random
    $imagesTar       = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-images-$rand.tar"
    $beScript        = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-be-deploy-$rand.sh"
    $remoteImagesTar = "/tmp/jolkr-images-$rand.tar"
    $remoteBEScript  = "/tmp/jolkr-be-deploy-$rand.sh"

    Step "docker save → $imagesTar"
    docker save -o $imagesTar docker-jolkr-api:latest docker-jolkr-media:latest
    if ($LASTEXITCODE -ne 0) { Fail "docker save failed" }
    $sizeMB = [math]::Round((Get-Item $imagesTar).Length / 1MB, 1)
    Write-Host "  image tarball: $sizeMB MB"

    # Remote bash. Same escape rules as deploy-fe.ps1:
    #   $remoteImagesTar / $remoteBEScript / $remoteCompose / $healthUrl → PS interp
    #   `$VAR / `$(cmd)                                                  → literal for bash
    $beBash = @"
#!/bin/bash
cd $remoteCompose

# Poll /health until 2xx or timeout. 12 attempts × 5s = 60s tolerance.
wait_for_health() {
  local i
  for i in `$(seq 1 12); do
    if curl -fsS -m 5 $healthUrl > /dev/null 2>&1; then
      echo "  /health OK (attempt `$i)"
      return 0
    fi
    if [ `$i -lt 12 ]; then
      echo "  /health not ready (attempt `$i/12), retrying in 5s..."
      sleep 5
    fi
  done
  return 1
}

# nginx.conf upstream blocks have no resolver, so nginx caches the
# jolkr-api/jolkr-media IPs at startup. After force-recreate the
# containers get new IPs but nginx keeps proxying to the dead ones
# (502) until reloaded. A graceful reload re-resolves all upstream
# DNS entries — zero downtime, ~50ms.
reload_nginx() {
  echo "==> nginx -s reload (refresh upstream DNS)"
  docker compose exec -T nginx nginx -s reload || echo "  warn: nginx reload failed (not fatal — DNS may take longer to refresh)"
}

rollback() {
  echo "ROLLBACK: restoring :prev → :latest and recreating"
  docker tag docker-jolkr-api:prev docker-jolkr-api:latest 2>/dev/null || true
  docker tag docker-jolkr-media:prev docker-jolkr-media:latest 2>/dev/null || true
  docker compose up -d --force-recreate jolkr-api jolkr-media || true
  reload_nginx
  sleep 5
  if wait_for_health; then
    echo "ROLLBACK: prev images healthy again, prod restored"
  else
    echo "ROLLBACK: WARNING — prev images also unhealthy after 60s. Manual intervention needed."
  fi
  rm -f $remoteImagesTar $remoteBEScript
  exit 1
}

echo "==> tagging current :latest as :prev (for rollback)"
docker tag docker-jolkr-api:latest docker-jolkr-api:prev 2>/dev/null || true
docker tag docker-jolkr-media:latest docker-jolkr-media:prev 2>/dev/null || true

echo "==> docker load < new images"
docker load -i $remoteImagesTar || rollback

echo "==> force-recreate jolkr-api + jolkr-media"
docker compose up -d --force-recreate jolkr-api jolkr-media || rollback

reload_nginx

echo "==> waiting 5s for processes to start..."
sleep 5

API_STATUS=`$(docker compose ps jolkr-api --format '{{.Status}}')
MEDIA_STATUS=`$(docker compose ps jolkr-media --format '{{.Status}}')
echo "  api: `$API_STATUS"
echo "  media: `$MEDIA_STATUS"

case "`$API_STATUS" in Up*) ;; *) echo "FAIL: jolkr-api not Up"; rollback ;; esac
case "`$MEDIA_STATUS" in Up*) ;; *) echo "FAIL: jolkr-media not Up"; rollback ;; esac

echo "==> polling $healthUrl (up to 60s)..."
if ! wait_for_health; then
  echo "FAIL: /health did not return 2xx after 60s"
  rollback
fi

echo "==> BE deploy healthy"
rm -f $remoteImagesTar $remoteBEScript
"@

    [System.IO.File]::WriteAllBytes(
        $beScript,
        [System.Text.Encoding]::ASCII.GetBytes(($beBash -replace "`r`n", "`n"))
    )

    try {
        Step "scp images + script to $remote"
        scp -q $imagesTar $beScript "${remote}:/tmp/"
        if ($LASTEXITCODE -ne 0) { Fail "scp BE artifacts failed" }

        Step "ssh — load, recreate, health-check"
        ssh $remote "bash $remoteBEScript"
        if ($LASTEXITCODE -ne 0) { Fail "BE deploy failed (rollback was attempted on remote)" }
    }
    finally {
        if (Test-Path $imagesTar) { Remove-Item $imagesTar -Force }
        if (Test-Path $beScript)  { Remove-Item $beScript -Force }
    }

    Ok "BE deployed and healthy"
}

# --- 7. FE deploy --------------------------------------------------------
# Same crash-safe pattern as deploy-fe.ps1: tar dist/ to local tempfile,
# scp tar + bash script, remote bash extracts into a staging dir, sanity-
# checks index.html + assets/, then rsync -a --delete swaps the contents.
# Old dist/ stays intact through extract+sanity-check.
if ($deployFE) {
    Step "FE deploy — tar + scp + remote stage + rsync"

    $rand         = Get-Random
    $tempTar      = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-dist-$rand.tar"
    $tempScript   = Join-Path ([System.IO.Path]::GetTempPath()) "jolkr-fe-deploy-$rand.sh"
    $remoteTmp    = "/tmp/jolkr-dist-$rand.tar"
    $remoteScript = "/tmp/jolkr-fe-deploy-$rand.sh"

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

    [System.IO.File]::WriteAllBytes(
        $tempScript,
        [System.Text.Encoding]::ASCII.GetBytes(($bashScript -replace "`r`n", "`n"))
    )

    try {
        tar -cf $tempTar -C $distDir .
        if ($LASTEXITCODE -ne 0) { Fail "local tar failed" }

        scp -q $tempTar $tempScript "${remote}:/tmp/"
        if ($LASTEXITCODE -ne 0) { Fail "scp FE artifacts failed" }

        ssh $remote "bash $remoteScript"
        if ($LASTEXITCODE -ne 0) { Fail "remote FE stage/rsync failed (prod dist untouched)" }
    }
    finally {
        if (Test-Path $tempTar)    { Remove-Item $tempTar -Force }
        if (Test-Path $tempScript) { Remove-Item $tempScript -Force }
    }

    Ok "FE deployed"
}

Write-Host ""
Ok "Done. https://jolkr.app/app/ is live."
