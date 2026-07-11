#!/usr/bin/env bash
# Install the OndeStudio public vhost on tyrell (RFC 0002, Stage 3).
# Run as root on tyrell:  sudo bash /home/tyrell/ondestudio-deploy/install-vhost.sh
# Per the RFC's stage order, run this only AFTER the dedicated station-scoped
# AzuraCast API key is in place on onde-zero (Stage 2) — public exposure last.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/studio-app.ondezero.net.conf"
DST=/etc/nginx/sites-available/studio-app.ondezero.net

install -m 644 "$SRC" "$DST"
ln -sf "$DST" /etc/nginx/sites-enabled/studio-app.ondezero.net
nginx -t
systemctl reload nginx

echo "verify:"
curl -sI https://studio-app.ondezero.net | head -3
curl -s -o /dev/null -w 'team route blocked publicly: /api/v1/driver -> %{http_code} (expect 403)\n' https://studio-app.ondezero.net/api/v1/driver
