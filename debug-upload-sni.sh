#!/bin/bash
# Debug why nginx still serves jolkr.app cert for SNI=upload.jolkr.app
# even after the wildcard removal. Run as: sudo bash ~/debug-upload-sni.sh
set +e
if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: must run as root."; exit 1
fi

echo "============================================================"
echo "1. CERT FILE PERMISSIONS — can nginx workers (www-data) read?"
echo "============================================================"
for d in jolkr.app upload.jolkr.app; do
  echo "   $d:"
  ls -la /home/phillipp/conf/web/$d/ssl/$d.{pem,key,crt} 2>/dev/null | sed 's/^/      /'
  echo "      effective permission for www-data:"
  for f in /home/phillipp/conf/web/$d/ssl/$d.pem /home/phillipp/conf/web/$d/ssl/$d.key; do
    if sudo -u www-data test -r "$f"; then
      echo "         readable: $f"
    else
      echo "         NOT readable by www-data: $f"
    fi
  done
done

echo
echo "============================================================"
echo "2. FULL upload.jolkr.app SSL server block (from nginx -T)"
echo "============================================================"
nginx -T 2>/dev/null | awk '/^server *\{/{srv=NR; buf=""} {buf=buf $0 ORS} /^\}/{if (buf ~ /upload\.jolkr\.app/ && buf ~ /listen.*443/) print buf; buf=""}' | head -80

echo
echo "============================================================"
echo "3. FULL jolkr.app SSL server block (for comparison)"
echo "============================================================"
nginx -T 2>/dev/null | awk '/^server *\{/{srv=NR; buf=""} {buf=buf $0 ORS} /^\}/{if (buf ~ /server_name jolkr\.app/ && buf ~ /listen.*443/) print buf; buf=""}' | head -80

echo
echo "============================================================"
echo "4. SNI test — verify which block matches each name"
echo "============================================================"
for sni in upload.jolkr.app upload-jolkr-app.phillippepelzer.me jolkr.app jolkr-app.phillippepelzer.me; do
  cert_cn=$(echo Q | openssl s_client -connect 192.168.178.20:443 -servername "$sni" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//')
  echo "   SNI=$sni → cert CN=$cert_cn"
done

echo
echo "============================================================"
echo "5. systemctl restart nginx (full restart — flushes cached state)"
echo "============================================================"
systemctl restart nginx
sleep 1
systemctl is-active nginx
echo

echo "============================================================"
echo "6. SNI test AFTER restart"
echo "============================================================"
for sni in upload.jolkr.app jolkr.app; do
  cert_cn=$(echo Q | openssl s_client -connect 192.168.178.20:443 -servername "$sni" 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed 's/.*CN *= *//')
  echo "   SNI=$sni → cert CN=$cert_cn"
done

echo
echo "============================================================"
echo "7. nginx error log — last 30 lines"
echo "============================================================"
tail -n 30 /var/log/nginx/error.log 2>/dev/null

echo
echo "============================================================"
echo "DONE"
echo "============================================================"
