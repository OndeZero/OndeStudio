# deploy/ — RFC 0002 phase-1 deployment artifacts

The full design + rationale is **`docs/rfc/0002-phase-1-deployment.md`**; these
files are its runbook made executable. Layout mirrors the box's existing
pattern (`/opt/OndePlayer/deploy`).

| File | Where it lands | What it does |
|---|---|---|
| `install.sh` | run as **root on onde-zero** | user + dirs + clone + build + `.env` + migrations/users + units + start + verify (idempotent) |
| `ondestudio.service` | `/etc/systemd/system/` | the always-on Bun process (API + built SPA on `HOST:4400`) |
| `ondestudio-backup.service` + `.timer` | `/etc/systemd/system/` | nightly 04:30 `VACUUM INTO` snapshot → `/srv/backups/ondestudio`, 14-day rotation |
| `backup.sh` / `backup.ts` | run from the checkout | the snapshot implementation (bun:sqlite, no sqlite3-CLI dependency) |
| `tyrell/studio2.ondezero.net.conf` | tyrell `/etc/nginx/sites-available/` | public vhost: `/self` + read seam only, team API 403'd, `X-Forwarded-Proto` set |
| `tyrell/install-vhost.sh` | run as **root on tyrell** | installs + enables the vhost, `nginx -t`, reload, verifies |

**Secrets:** `install.sh` expects the production `.env` staged at
`/home/onde/ondestudio-deploy/env.production` (it moves it to
`/opt/OndeStudio/.env` 0600 and shreds the staging copy). Required there:
explicit `SESSION_SECRET` (≥32 chars) and `HOST` (the tailnet address) — see
the RFC's Config & secrets table.

**Stage order (RFC):** Stage 0-1 = `install.sh`, team over the tailnet
(`http://onde-zero.tail14bc63.ts.net:4400`). Stage 2 = dedicated station-scoped
AzuraCast API key swapped into `.env`. Stage 3 = `install-vhost.sh` on tyrell
(public exposure only after the key swap). Stage 4 = per-feature `oz` adoption
via `AZURACAST_WRITE_STATIONS`.

**Upgrade:** `cd /opt/OndeStudio && sudo -u ondestudio env HOME=/srv/data/ondestudio git pull --ff-only && sudo -u ondestudio env HOME=/srv/data/ondestudio bun install --frozen-lockfile && sudo -u ondestudio env HOME=/srv/data/ondestudio bun run build && sudo systemctl restart ondestudio` — never `git clean -x` (it would delete `.env`).
