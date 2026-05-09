#!/bin/bash
# Emergency recovery + proper fix for upload.jolkr.app:
#   1. Stop nginx from trying to bind 192.168.178.20:8080 (port already used by Apache).
#      Caused by my jolkr-upload.tpl using %web_port% (=8080) instead of %proxy_port% (=80).
#   2. Fix the template so future rebuilds use port 80 correctly.
#   3. Rebuild upload.jolkr.app config.
#   4. Start nginx.
#   5. Diagnose why upload's SSL block isn't being added to nginx's server-name hash
#      (default_server falls back to 7pleasures.com — proves block is loaded but its names
#      aren't being registered).
#
# Run as: sudo bash ~/recover-and-fix.sh

set +e
[[ "$EUID" -ne 0 ]] && { echo "ERROR: must run as root."; exit 1; }
PATH=/usr/local/hestia/bin:$PATH
USER="phillipp"
DOMAIN="upload.jolkr.app"
TPL_DIR="/usr/local/hestia/data/templates/web/nginx"

echo "============================================================"
echo "1. EMERGENCY: fix wrong port in template (.tpl)"
echo "============================================================"
echo "   before:"
grep -n 'listen' "$TPL_DIR/jolkr-upload.tpl" | sed 's/^/      /'
sed -i 's/%web_port%/%proxy_port%/g' "$TPL_DIR/jolkr-upload.tpl"
echo "   after:"
grep -n 'listen' "$TPL_DIR/jolkr-upload.tpl" | sed 's/^/      /'

echo
echo "============================================================"
echo "2. Rebuild upload.jolkr.app config from fixed template"
echo "============================================================"
v-rebuild-web-domain "$USER" "$DOMAIN" 2>&1 | tail -20

echo
echo "============================================================"
echo "3. Verify generated nginx.conf now uses port 80"
echo "============================================================"
grep -h listen /home/$USER/conf/web/$DOMAIN/nginx.conf | sed 's/^/   /'

echo
echo "============================================================"
echo "4. nginx -t (must be successful)"
echo "============================================================"
if nginx -t 2>&1 | tail -5; then
  :
fi

echo
echo "============================================================"
echo "5. systemctl start nginx"
echo "============================================================"
systemctl start nginx
sleep 1
systemctl is-active nginx
echo

echo "============================================================"
echo "6. SNI test — upload.jolkr.app + alias"
echo "============================================================"
for sni in upload.jolkr.app upload-jolkr-app.phillippepelzer.me jolkr.app; do
  cn=$(echo Q | openssl s_client -connect 192.168.178.20:443 -servername "$sni" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//')
  echo "   SNI=$sni → cert CN=$cn"
done

echo
echo "============================================================"
echo "7. SHA256 of upload's pem vs the one nginx is actually using"
echo "============================================================"
echo "   upload.jolkr.app.pem (file on disk):"
sha256sum /home/$USER/conf/web/$DOMAIN/ssl/$DOMAIN.pem | sed 's/^/      /'
echo "   what nginx serves for SNI=upload.jolkr.app (compare CN):"
echo Q | openssl s_client -connect 192.168.178.20:443 -servername upload.jolkr.app 2>/dev/null \
  | openssl x509 -noout -subject -fingerprint -sha256 2>/dev/null | sed 's/^/      /'

echo
echo "============================================================"
echo "8. Compare server_name entries — is upload's block in the hash?"
echo "============================================================"
nginx -T 2>/dev/null | grep -nE '^\s*server_name.*(upload|jolkr|7pleasures)' | head -20

echo
echo "============================================================"
echo "9. nginx error log — last 15 lines AFTER recovery"
echo "============================================================"
tail -n 15 /var/log/nginx/error.log

echo
echo "============================================================"
echo "DONE"
echo "============================================================"
