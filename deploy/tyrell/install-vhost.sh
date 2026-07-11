#!/usr/bin/env bash
# Install the OndeStudio public vhost on tyrell (RFC 0002, Stage 3).
# Run as root on tyrell:  sudo bash /home/tyrell/ondestudio-deploy/install-vhost.sh
# The RFC recommends the dedicated station-scoped AzuraCast key (Stage 2)
# BEFORE public exposure; the team chose (2026-07-11) to go public on the
# shared global-admin key for now — Stage 2 remains open, do it soon.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/studio2.ondezero.net.conf"
DST=/etc/nginx/sites-available/studio2.ondezero.net

install -m 644 "$SRC" "$DST"
ln -sf "$DST" /etc/nginx/sites-enabled/studio2.ondezero.net
nginx -t
systemctl reload nginx

echo "verify (via localhost — tyrell can't reach its own public IP, NAT hairpin):"
curl -skI --max-time 8 --resolve studio2.ondezero.net:443:127.0.0.1 https://studio2.ondezero.net | head -3
curl -sk -o /dev/null --max-time 8 --resolve studio2.ondezero.net:443:127.0.0.1 \
  -w 'team route blocked publicly: /api/v1/driver -> %{http_code} (expect 403)\n' \
  https://studio2.ondezero.net/api/v1/driver
echo "(full external verification must run from OUTSIDE the NAT)"
