#!/bin/bash
# Restores the branded Jolkr error pages when a Hestia rebuild has wiped them.
#
# `v-rebuild-web-domain` empties document_errors/ and drops Hestia's four stock
# files back in, which silently reverts the branded pages. The nginx wiring
# lives in the templates and survives, so only the HTML needs restoring.
# (Happened unnoticed on upload.jolkr.app on 2026-09-06; found on 2026-09-09.)
#
# Canonical source: /root/jolkr-error-pages/<domain>/*.html
# Runs from jolkr-heal-error-pages.timer every 15 minutes.

set -uo pipefail

SRC=/root/jolkr-error-pages
WEB=/home/phillipp/web
DOMAINS=(jolkr.app upload.jolkr.app)
LOG=/var/log/jolkr-error-pages.log
healed=0

log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

for d in "${DOMAINS[@]}"; do
    target="$WEB/$d/document_errors"
    src="$SRC/$d"

    [[ -d $src ]] || { log "SKIP $d: no canonical source at $src"; continue; }
    [[ -d $WEB/$d ]] || { log "SKIP $d: domain not on this host"; continue; }

    # The branded pages all carry the Jolkr title. A missing directory, a
    # missing 404, or a 404 without that marker all mean a rebuild reverted us.
    if [[ -f $target/404.html ]] && grep -qi 'Jolkr' "$target/404.html"; then
        continue
    fi

    mkdir -p "$target"
    if install -o phillipp -g phillipp -m 644 "$src"/*.html "$target/" 2>>"$LOG"; then
        log "HEALED $d: restored $(ls -1 "$src"/*.html | wc -l) pages"
        healed=1
    else
        log "ERROR $d: install failed"
    fi
done

# open_file_cache_valid is 60s here, so a reload avoids serving the stock
# pages for up to a minute after a restore.
if [[ $healed -eq 1 ]]; then
    if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx && log 'nginx reloaded'
    else
        log 'ERROR nginx -t failed, reload skipped'
    fi
fi
