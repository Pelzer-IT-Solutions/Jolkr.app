#!/bin/bash
# FULL ROLLBACK: undo every change Claude made to HestiaCP/nginx on this box.
#
# Restores:
#   - *.jolkr.app alias in jolkr.app's nginx server_name (4 files)
#   - removes upload.jolkr.app web domain (nginx.conf, ssl.conf, cert, public_html)
#   - removes custom HestiaCP templates jolkr-upload.{tpl,stpl}
# Verifies nginx restarts cleanly.
#
# Run as: sudo bash ~/rollback-everything.sh

set +e
[[ "$EUID" -ne 0 ]] && { echo "ERROR: must run as root."; exit 1; }
PATH=/usr/local/hestia/bin:$PATH
USER="phillipp"
TPL_DIR="/usr/local/hestia/data/templates/web/nginx"

echo "============================================================"
echo "1. Restore *.jolkr.app in jolkr.app server_name (4 files)"
echo "============================================================"
for f in \
    /home/$USER/conf/web/jolkr.app/nginx.conf \
    /home/$USER/conf/web/jolkr.app/nginx.ssl.conf \
    /home/$USER/conf/web/jolkr.app.backup/nginx.conf \
    /home/$USER/conf/web/jolkr.app.backup/nginx.ssl.conf
do
  if [[ -f "$f" ]]; then
    if grep -q '\*\.jolkr\.app' "$f"; then
      echo "   already has wildcard: $f"
    else
      # Insert "*.jolkr.app " right after "server_name jolkr.app "
      sed -i 's/server_name jolkr\.app jolkr-app\.phillippepelzer\.me/server_name jolkr.app *.jolkr.app jolkr-app.phillippepelzer.me/g' "$f"
      if grep -q '\*\.jolkr\.app' "$f"; then
        echo "   restored: $f"
      else
        echo "   FAILED to restore (manual check needed): $f"
      fi
    fi
  fi
done

echo
echo "============================================================"
echo "2. Delete upload.jolkr.app web domain (via Hestia)"
echo "============================================================"
if v-list-web-domain "$USER" upload.jolkr.app >/dev/null 2>&1; then
  v-delete-web-domain "$USER" upload.jolkr.app 2>&1 | tail -10
  echo "   v-delete-web-domain completed"
else
  echo "   already gone"
fi

# Belt-and-suspenders: nuke any lingering symlinks/dirs even if v-delete-web-domain failed.
echo
echo "============================================================"
echo "3. Belt-and-suspenders: remove any leftover upload.jolkr.app files"
echo "============================================================"
rm -fv /etc/nginx/conf.d/domains/upload.jolkr.app.conf
rm -fv /etc/nginx/conf.d/domains/upload.jolkr.app.ssl.conf
rm -rfv /home/$USER/conf/web/upload.jolkr.app
rm -rfv /home/$USER/web/upload.jolkr.app

echo
echo "============================================================"
echo "4. Remove custom HestiaCP templates jolkr-upload.{tpl,stpl}"
echo "============================================================"
rm -fv "$TPL_DIR/jolkr-upload.tpl" "$TPL_DIR/jolkr-upload.stpl"

echo
echo "============================================================"
echo "5. nginx -t + start nginx"
echo "============================================================"
if nginx -t 2>&1 | tail -3; then
  systemctl start nginx
  sleep 1
  echo "   nginx status: $(systemctl is-active nginx)"
else
  echo "FATAL: nginx -t failed; aborting (fix config manually)"
  exit 1
fi

echo
echo "============================================================"
echo "6. Sanity SNI check — jolkr.app should serve its own cert"
echo "============================================================"
for sni in jolkr.app www.jolkr.app; do
  cn=$(echo Q | openssl s_client -connect 192.168.178.20:443 -servername "$sni" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//')
  echo "   SNI=$sni → cert CN=$cn"
done

echo
echo "============================================================"
echo "DONE — HestiaCP rolled back to pre-Claude state"
echo "============================================================"
echo "Claude will remove the Cloudflare DNS A-record from his side."
