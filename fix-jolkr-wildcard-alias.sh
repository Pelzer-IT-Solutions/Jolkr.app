#!/bin/bash
# Fix: jolkr.app has '*.jolkr.app' in nginx server_name, which captures SNI for
# upload.jolkr.app and serves the wrong cert. Remove the wildcard alias from
# jolkr.app via Hestia, rebuild, reload nginx, and verify SNI selection.
#
# Run on 192.168.178.20 as:  sudo bash ~/fix-jolkr-wildcard-alias.sh

set -euo pipefail

USER="phillipp"
DOMAIN="jolkr.app"
ALIAS_TO_KILL="*.jolkr.app"

if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: must run as root. Use:  sudo bash $0"
  exit 1
fi

PATH=/usr/local/hestia/bin:$PATH

echo "============================================================"
echo "1. Current aliases on $DOMAIN"
echo "============================================================"
v-list-web-domain "$USER" "$DOMAIN" | grep -iE 'aliases?|domain' | head -10 || true

echo
echo "============================================================"
echo "2. Try Hestia CLI: v-delete-web-domain-alias"
echo "============================================================"
if v-delete-web-domain-alias "$USER" "$DOMAIN" "$ALIAS_TO_KILL" 2>&1 | tee /tmp/hestia-fix.log; then
  echo "   removed via Hestia CLI"
  HESTIA_REMOVED=yes
else
  echo "   Hestia CLI returned non-zero; will fall back to direct file edit"
  HESTIA_REMOVED=no
fi

echo
echo "============================================================"
echo "3. Verify wildcard is gone from generated nginx confs"
echo "============================================================"
if grep -l "\\*\\.jolkr\\.app" \
     /home/$USER/conf/web/$DOMAIN/nginx.conf \
     /home/$USER/conf/web/$DOMAIN/nginx.ssl.conf 2>/dev/null; then
  echo "   STILL PRESENT — falling back to direct sed"
  sed -i 's/ \*\.jolkr\.app//g' \
    /home/$USER/conf/web/$DOMAIN/nginx.conf \
    /home/$USER/conf/web/$DOMAIN/nginx.ssl.conf
  # Also clean the backup folder if present (so future restore doesn't re-add it).
  if [[ -d /home/$USER/conf/web/$DOMAIN.backup ]]; then
    sed -i 's/ \*\.jolkr\.app//g' \
      /home/$USER/conf/web/$DOMAIN.backup/nginx.conf \
      /home/$USER/conf/web/$DOMAIN.backup/nginx.ssl.conf 2>/dev/null || true
  fi
  echo "   sed-cleaned"
else
  echo "   confirmed: '*.jolkr.app' no longer present in jolkr.app server_name"
fi

echo
echo "============================================================"
echo "4. Show resulting server_name for jolkr.app"
echo "============================================================"
grep -h server_name /home/$USER/conf/web/$DOMAIN/nginx.ssl.conf | head -3

echo
echo "============================================================"
echo "5. Reload nginx"
echo "============================================================"
if nginx -t; then
  systemctl reload nginx
  echo "   nginx reloaded"
else
  echo "FATAL: nginx -t failed; aborting."
  exit 1
fi

echo
echo "============================================================"
echo "6. SNI verification"
echo "============================================================"
echo "   SNI=upload.jolkr.app:"
echo Q | openssl s_client -connect 192.168.178.20:443 -servername upload.jolkr.app 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName 2>&1 | sed 's/^/      /'
echo
echo "   SNI=jolkr.app:"
echo Q | openssl s_client -connect 192.168.178.20:443 -servername jolkr.app 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName 2>&1 | sed 's/^/      /'

echo
echo "============================================================"
echo "DONE"
echo "============================================================"
echo "Expected: SNI=upload.jolkr.app returns CN=upload.jolkr.app cert"
echo "          SNI=jolkr.app returns CN=jolkr.app cert"
