#!/bin/bash
# Diagnose why nginx serves the wrong cert for upload.jolkr.app
# Run as: sudo bash ~/diag-upload-domain.sh

set +e
DOMAIN="upload.jolkr.app"
USER="phillipp"

if [[ "$EUID" -ne 0 ]]; then
  echo "ERROR: must run as root. Use:  sudo bash $0"
  exit 1
fi

echo "============================================================"
echo "1. WHAT IS IN upload.jolkr.app.pem"
echo "============================================================"
PEM="/home/$USER/conf/web/$DOMAIN/ssl/$DOMAIN.pem"
if [[ -f "$PEM" ]]; then
  echo "   file size: $(stat -c%s $PEM) bytes"
  echo "   subject + SAN:"
  openssl x509 -in "$PEM" -noout -subject -issuer -ext subjectAltName 2>&1 | sed 's/^/   /'
  echo
  echo "   cert chain in .pem (count):"
  grep -c -- "-----BEGIN CERTIFICATE-----" "$PEM"
else
  echo "   MISSING: $PEM"
fi

echo
echo "============================================================"
echo "2. CERT NGINX SERVES FOR SNI=upload.jolkr.app"
echo "============================================================"
echo Q | openssl s_client -connect 192.168.178.20:443 -servername "$DOMAIN" 2>/dev/null \
  | openssl x509 -noout -subject -ext subjectAltName 2>&1 | sed 's/^/   /'

echo
echo "============================================================"
echo "3. ALL nginx server blocks listening on :443 with 'jolkr' in name"
echo "============================================================"
nginx -T 2>/dev/null | awk '
/^server *{/ { in_srv=1; buf=""; next }
in_srv && /^}/ { if (buf ~ /jolkr/) { print "---"; print buf } in_srv=0; next }
in_srv { buf = buf $0 ORS }
' | grep -E 'server_name|listen|ssl_certificate |---' | head -40

echo
echo "============================================================"
echo "4. CONFLICTING server_name warnings on port 443"
echo "============================================================"
nginx -t 2>&1 | grep -i 'conflicting' | head -10
echo "(none above = no conflicts logged)"

echo
echo "============================================================"
echo "5. EXACT vs WILDCARD server_name competition"
echo "============================================================"
echo "   Files mentioning 'upload.jolkr.app' in server_name:"
grep -lR 'server_name.*upload\.jolkr\.app' /home/*/conf/web/ /etc/nginx/ 2>/dev/null | sed 's/^/   /'
echo
echo "   Files mentioning '*.jolkr.app' in server_name:"
grep -lR 'server_name.*\*\.jolkr\.app' /home/*/conf/web/ /etc/nginx/ 2>/dev/null | sed 's/^/   /'

echo
echo "============================================================"
echo "6. nginx -T order: which jolkr server block is FIRST?"
echo "============================================================"
nginx -T 2>/dev/null | grep -nE 'server_name.*jolkr\.app' | head -10

echo
echo "============================================================"
echo "DONE — paste this output back to Claude"
echo "============================================================"
