#!/usr/bin/env bash
# Nightly OndeStudio DB snapshot + rotation (RFC 0002). Run by
# ondestudio-backup.timer as the ondestudio user; writes /srv/backups/ondestudio.
set -euo pipefail

DB=/srv/data/ondestudio/ondestudio.sqlite
OUT_DIR=/srv/backups/ondestudio
DAY=$(date +%F)
OUT="$OUT_DIR/ondestudio-$DAY.sqlite"

/usr/local/bin/bun /opt/OndeStudio/deploy/backup.ts "$DB" "$OUT"
gzip -f "$OUT"

# Keep ~14 daily snapshots; .env (SESSION_SECRET + API key) is backed up
# out-of-band — it is NOT captured here.
find "$OUT_DIR" -name 'ondestudio-*.sqlite.gz' -mtime +14 -delete
