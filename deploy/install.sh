#!/usr/bin/env bash
# OndeStudio first-deploy installer for onde-zero (RFC 0002 runbook, Stage 0).
# Run as root:  sudo bash /home/onde/ondestudio-deploy/install.sh
# Idempotent — safe to re-run. Expects the production .env staged at
# /home/onde/ondestudio-deploy/env.production (moved into place, then shredded).
set -euo pipefail

REPO=https://github.com/OndeZero/OndeStudio.git
APP=/opt/OndeStudio
DATA=/srv/data/ondestudio
BACKUPS=/srv/backups/ondestudio
STAGED_ENV=/home/onde/ondestudio-deploy/env.production
BUN=/usr/local/bin/bun

step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1. system user + dirs (app on /opt, data + backups on /srv)"
id ondestudio &>/dev/null || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin ondestudio
mkdir -p "$DATA" "$BACKUPS"
chown ondestudio:ondestudio "$DATA" "$BACKUPS"

step "2. clone (https, public repo) or reuse existing checkout"
if [ ! -d "$APP/.git" ]; then
  git clone "$REPO" "$APP"
fi
chown -R ondestudio:ondestudio "$APP"

step "3. bun install + build the SPA bundle (as ondestudio, cache on /srv)"
cd "$APP"
sudo -u ondestudio env HOME="$DATA" "$BUN" install --frozen-lockfile
sudo -u ondestudio env HOME="$DATA" "$BUN" run build
test -f "$APP/packages/web/dist/index.html" || { echo "ERROR: web build missing"; exit 1; }

step "4. production .env (0600, owned by ondestudio)"
if [ -f "$STAGED_ENV" ]; then
  install -o ondestudio -g ondestudio -m 600 "$STAGED_ENV" "$APP/.env"
  shred -u "$STAGED_ENV"
fi
test -f "$APP/.env" || { echo "ERROR: $APP/.env missing (stage env.production first)"; exit 1; }

step "5. hairpin check: on-box AzuraCast API answers without an HTTPS redirect"
curl -sf -o /dev/null http://localhost:8080/api/nowplaying \
  || { echo "ERROR: http://localhost:8080/api/nowplaying not answering"; exit 1; }

step "6. apply migrations + seed team users (no port bind — RFC runbook step 6)"
sudo -u ondestudio env HOME="$DATA" "$BUN" packages/api/scripts/import-users.ts

step "7. systemd units (service + nightly backup timer)"
install -m 644 "$APP/deploy/ondestudio.service" /etc/systemd/system/
install -m 644 "$APP/deploy/ondestudio-backup.service" /etc/systemd/system/
install -m 644 "$APP/deploy/ondestudio-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ondestudio
systemctl enable --now ondestudio-backup.timer

step "8. verify"
sleep 3
systemctl --no-pager --lines=0 status ondestudio | head -6
HOST_ADDR=$(grep -E '^HOST=' "$APP/.env" | cut -d= -f2)
PORT_NUM=$(grep -E '^PORT=' "$APP/.env" | cut -d= -f2)
echo "health:"
curl -sf "http://${HOST_ADDR}:${PORT_NUM:-4400}/api/v1/health" && echo || { echo "health check FAILED"; journalctl -u ondestudio --no-pager -n 20; exit 1; }

echo
echo "DONE. Issue team setup links with:"
echo "  cd $APP && sudo -u ondestudio env HOME=$DATA $BUN packages/api/scripts/issue-setup-link.ts <email>"
echo "  (replace the printed http://localhost:5173 host with http://onde-zero.tail14bc63.ts.net:4400)"
