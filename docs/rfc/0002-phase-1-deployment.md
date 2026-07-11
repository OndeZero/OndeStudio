# RFC 0002 — Phase-1 deployment: OndeStudio onto onde-zero

- **Status:** proposed (draft for team review, 2026-07-10)
- **Milestone:** docs/2 §11 — the deployment work-item behind M5 (OndePlayer reads OndeStudio's `schedule`/`now`) and the §7.7 `wz-test`→`oz` adoption gate. Exit bar: **OndeStudio runs as an always-on service on the real server, reachable by the team over TLS, still writing only to `wz-test`.**
- **Relates to:** docs/2 §7.7 (adoption gate + dedicated API account), docs/2 §13 Cross-cutting concerns (single-server / systemd / one-Bun-process deployment intent; also §3 line 143 "one Bun process"), RFC 0001 (the driver whose reconcile loop this keeps alive), PD §6 (per-feature adoption), PD §7.1 (secrets), PD §5.6 (self-service webcaster → secure-context requirement).
- **Companion code work-item (precondition PR):** a small change set that does not exist yet and **must merge before the runbook below runs** — see Design → "One process, two surfaces (the precondition PR)". Nothing in this RFC's runbook (`bun run build`, secure cookies, the served SPA) works until it lands.

## Problem

Everything shipped through M4 + the M3 driver + episode queue runs only on the dev machine. There is no place the team can open a browser and use OndeStudio, and the always-on loops that make the driver a driver (RFC 0001: boot catch-up + 30s drift sweep, live-slot projection, now-playing poll) never run unattended. Phase 1's exit bars all *exist in code*; none of them is *operational* until OndeStudio lives on the real server next to the AzuraCast it mirrors.

Three facts shape the deployment and are not yet reconciled anywhere:

1. **The API does not serve the SPA today.** The composition root mounts only the API (`packages/api/src/app.ts:419-420`); the prod entry `Bun.serve({ port, hostname, fetch: app.fetch })` (`app.ts:457-467`) answers `/api/v1/*` and 404s `index.html` and `/assets/*`. In dev the SPA (5173) reaches the API (4400) only through the Vite proxy (`packages/web/vite.config.ts:8-12`), which does not exist in prod. The spec's own intent — "one Bun process serves the built SPA + the API" (docs/2 §13 Cross-cutting concerns, Deployment) — is documented but unbuilt.
2. **This deploy *is* the TLS cutover the code defers to.** Both session cookies are minted without the `secure` flag, each with an explicit comment that "the reverse-proxy TLS deployment flips this" (`packages/api/src/modules/people/routes.ts:87-91`; the self-service cookie in `broadcaster-self-routes.ts` is the same), and the same comment defers a login throttle to "before leaving the LAN." This RFC is that deployment; those two items are its preconditions, not M5's.
3. **The server is behind NAT, and the public edge is a *separate* VM.** onde-zero hosts AzuraCast (Docker), OndePlayer, and wavezero-form; the public TLS termination + nginx vhosts live on the **tyrell** VM. OndeStudio must slot into that topology without touching AzuraCast's own edge, without a public listener of its own, and while the self-service webcaster (PD §5.6) needs a **secure context** (HTTPS) to open a microphone and a WebSocket.

This RFC specifies the target topology, the systemd/Bun unit, the tyrell vhost, the data/secrets surface, backup **and restore**, monitoring, and — the point of the whole exercise — the **staged path that keeps writes on `wz-test` until the adoption gate clears** (docs/2 §7.7).

> **Server facts confirmed by a read-only SSH survey of onde-zero (2026-07-10).** The topology below — the tyrell edge VM, NAT/hairpin, the `/dev/sdb1` `/srv/data` disk (503 G, ~196 G free) vs. the tight 30 G root, the `onde` user having no sudo and no docker group, the `ondeplayer.service` + `wavezero-form` systemd/Bun units, Bun 1.3.10 at `/usr/local/bin/bun`, and the AzuraCast Docker port map (host `:8080`/`:4430`/`8000-8496`) — was observed directly, not assumed. Two items remain genuine runbook checks (called out where load-bearing): AzuraCast's "Always Use HTTPS Browser URL" toggle (step 6), and the concrete `HOST` bind address (Open questions) which **blocks Stage 3**. Code claims (file:line citations throughout) were likewise verified against the tree.

## Constraints

- **Air is never in our hot path** (RFC 0001 invariant 1). OndeStudio drives the AzuraCast *management* API; if OndeStudio is down or wedged, the stream and the AzuraCast web UI are untouched. The deploy must not put OndeStudio anywhere in the audio path.
- **`wz-test` only, still** (docs/2 §7.7). `AZURACAST_WRITE_STATIONS` stays `wz-test` and does not gain `oz` until *both* preconditions hold: the dedicated API account exists **and** the team adopts each feature. This env var (`packages/api/src/platform/config.ts:31,94-97`) is the sole *runtime* write gate — enforced twice (composition root + adapter). **It protects against OndeStudio's own bugs, not against compromise:** it constrains OndeStudio's code paths, not an attacker who reads the key and calls AzuraCast directly. That distinction is why the dedicated key must be least-privilege and must land *before* internet exposure (see the stage sequence).
- **No public listener from OndeStudio.** The Bun process binds a *private* interface (the tailnet address, below); tyrell's nginx is the only thing the internet talks to, and it exposes only the self-service + read-seam paths. This mirrors how AzuraCast itself sits behind tyrell.
- **Only the webcaster + read seam ever face the internet.** The self-service webcaster (`/self/*`, PD §5.6) is for *external* broadcasters who cannot be on the tailnet, so it must be public. The public read seam (`/stations/*/now`, `/stations/*/sse`) feeds the galaxy. **Everything else — the whole team/admin surface (grid, board, broadcaster mgmt, driver routes, `/users`) — stays tailnet-only, permanently**, not "until the pilot is trusted."
- **onde-zero's `onde` user has no sudo and no docker** (confirmed by the survey — the `onde` account is not in the `docker` group and has no sudo). Every root step (systemd unit install, dir creation under `/opt` and `/srv`, tyrell nginx + cert, backup timer) is done by whoever holds root on each box; the service *runs* as an unprivileged dedicated user. Who those root-holders actually are is an Open question.
- **Low operational complexity** (PD goal). One long-running process, file-based SQLite, file-copy backups, systemd for supervision — the same shape as OndePlayer and wavezero-form already on the box. No new datastore, no broker, no container for OndeStudio in phase 1.
- **Root disk is tight; the data disk has room.** The DB, backups, and (if used) the auto-generated secret live under `/srv` (data disk), not on `/` — the code goes under `/opt` (small).

## Design

### Target topology

OndeStudio runs as a single always-on Bun process on **onde-zero**, code under `/opt/OndeStudio`, data under `/srv/data`, supervised by a **systemd unit modeled on `ondeplayer.service`**, running as a dedicated unprivileged system user **`ondestudio`**. It binds **onde-zero's tailnet address** on port **4400** — reachable only by tailnet peers, which is how both the team (directly) and tyrell (as the public edge) reach it, all over the encrypted tailnet hop. It sits *beside* AzuraCast (Docker, published on onde-zero `:8080` on the host), OndePlayer, and wavezero-form — sharing the host but not the audio path.

```
                              INTERNET
                                 │ 443 (TLS)   ── external webcasters only
                    ┌────────────┴─────────────────────────────┐
                    │                 tyrell VM                 │
                    │                  nginx                    │
                    │  studio2.ondezero.net                     │
                    │   PUBLIC allowlist → /api/v1/self/*       │
                    │                    + /stations/*/{now,sse}│
                    │   SPA shell served; else /api/v1 → 403    │
                    └────────────┬──────────────────────────────┘
                                 │ encrypted tailnet hop
        team/admin ─────────────┤  (tyrell is a tailnet peer;
        over tailnet ───────────┤   admin surface is tailnet-only)
                                 ▼
        ┌────────────────────────────────────────────────────────┐
        │                    onde-zero VM                          │
        │   OndeStudio (Bun, systemd)                              │
        │     HOST=<onde-zero tailnet addr>:4400   ◄── this RFC    │
        │       │ SQLite /srv/data (WAL) + migrations on boot      │
        │       ▼ AZURACAST_BASE_URL=http://localhost:8080         │
        │     AzuraCast (Docker, :8080 on host)   ── on-box hairpin│
        │       (NOT the public studio.ondezero.net — avoids NAT)  │
        │                                                          │
        │   OndePlayer (Bun, systemd)    wavezero-form (systemd)   │
        └────────────────────────────────────────────────────────┘
                     listeners ── audio path ── OndeStudio is NOT on it
                                                (invariant 1)
```

Same-origin is already true in the client: every path is relative (`packages/web/src/lib/api/client.ts:5`, `mutate.ts:5` → `/api/v1`; SSE `sse.ts:20`). The moment one host:port serves both the static bundle and `/api/v1`, fetch + SSE + the signed session cookie work with **zero client changes** — dev fakes this with the Vite proxy; prod needs the API to serve `packages/web/dist`.

### One process, two surfaces (the precondition PR)

A small change set makes one Bun process on one port cover web + API **and** makes it safe to leave the LAN. All of it must merge and deploy before the runbook runs. The dependency for the first item already ships (`serveStatic` is in `hono/bun`), so no new/AGPL concern:

1. **Serve static + SPA fallback in the outer app** — after `app.route("/api/v1", api)` (`app.ts:420`):
   ```ts
   import { serveStatic } from "hono/bun";
   // …
   app.route("/api/v1", api);                                       // API wins (registered first)
   app.use("/*", serveStatic({ root: WEB_DIST }));                  // /assets/*
   app.get("/*", serveStatic({ path: `${WEB_DIST}/index.html` }));  // SPA history fallback
   ```
   Resolve `WEB_DIST` as an **absolute** path (from env or `import.meta.dir`), and guard the fallback to non-`/api` paths so a mistyped `/api/...` 404s as JSON instead of being shadowed by `index.html`. **Verify at build time** that Hono's `serveStatic({ root })` honours an absolute `root` under the pinned Hono — historically Hono has treated `root` as a relative join, so this needs a smoke test, not an assertion.
2. **Secure cookies behind the proxy.** Set `secure: true` on both `setSignedCookie` calls when the request arrived over HTTPS. The process sees *plaintext* `http` on the private hop, so a `c.req.url`-scheme check reads `http` and would wrongly drop the flag — decide from `X-Forwarded-Proto: https`, which nginx and `tailscale serve` both set (the RFC's nginx block sends it). This is the code's own "header-aware revisit"; it belongs **here**, not M5. Without it, the 80→443 redirect hop and any stray plaintext access leak the session cookie.
3. **Add root prod scripts** to `package.json` (currently absent — only `dev`/`typecheck`/lint/test/`check`/`db:generate` exist): `"build": "bun run --cwd packages/web build"`. `packages/api` already has a `start` (`bun src/app.ts`); the unit invokes the entrypoint directly (below), so a root `start` is optional. Deploy is then `bun install && bun run build && systemctl restart`.

The web build output is Vite default **`packages/web/dist/`** (no `outDir` override); the API has **no build/bundle step** — it runs TypeScript directly under Bun.

Login rate-limiting is *not* in this PR — with the team surface tailnet-only, the only internet-reachable login is `/self/login`, and it is throttled at the tyrell edge (below). An app-side per-identity throttle is a hardening follow-on, not a deploy blocker.

### The systemd unit (onde-zero)

Modeled on `ondeplayer.service`, hardened like `wavezero-form`. `/opt/OndeStudio/deploy/ondestudio.service`, installed to `/etc/systemd/system/ondestudio.service` by root:

```ini
[Unit]
Description=OndeStudio (OndeZero studio) — API + web, single Bun process
After=network-online.target
Wants=network-online.target
# AzuraCast runs in Docker on the same host; we reach it over the on-box
# hairpin (localhost:8080), so ordering is best-effort, not a hard Requires.
# Crash-loop backstop: a hard-failing boot (bad .env, bad migration) enters
# `failed` instead of hammering AzuraCast's mgmt API every 3s forever.
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=ondestudio
Group=ondestudio
WorkingDirectory=/opt/OndeStudio
# Bun autoloads /opt/OndeStudio/.env from WorkingDirectory — this is the ONLY
# env loader. No EnvironmentFile: systemd's parser is not dotenv (no `export`,
# different quoting, no ${} expansion), so pointing both at the same secret
# file risks a silent mis-parse. One loader, and the secret never lands in
# systemd's environment either. Keep .env to plain KEY=value lines.
Environment=HOME=/srv/data
ExecStart=/usr/local/bin/bun run packages/api/src/app.ts
Restart=on-failure
RestartSec=3
# --- hardening (mirror wavezero-form) ---
NoNewPrivileges=true
ProtectSystem=strict            # all of / read-only, incl. /opt (the code + .env) …
ReadWritePaths=/srv/data        # … except the DB, its WAL sidecars, and HOME cache
ProtectHome=true
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=false    # Bun's JIT needs W^X relaxed

[Install]
WantedBy=multi-user.target
```

Notes:
- **Env mechanism.** `WorkingDirectory=/opt/OndeStudio` + `ExecStart=… bun run packages/api/src/app.ts` (no `--cwd`) means Bun's own dotenv loader reads `/opt/OndeStudio/.env` from cwd — so the root `.env` is genuinely the loader, matching CLAUDE.md's "run from repo root." A `--cwd packages/api` would move cwd and make Bun look in `packages/api/.env`, so it is deliberately absent.
- **`HOME=/srv/data`** keeps any Bun/dependency runtime cache (`~/.bun/…`) on a writable path — `HOME` would otherwise be `/opt/OndeStudio` (from `useradd --home`), which is read-only under `ProtectSystem=strict`, a latent failure on a future Bun upgrade.
- **No separate `ReadOnlyPaths=/opt`** — `ProtectSystem=strict` already makes the whole filesystem read-only except `ReadWritePaths`. The process therefore cannot write the code, the migrations, or a session secret into `/opt`; that read-only-`/opt` is *exactly* why `SESSION_SECRET` must be supplied explicitly (see Data & DB).
- **`/srv/backups` is not in the service's `ReadWritePaths`** — backups are written by a *separate* timer unit (below), not by OndeStudio, so the service needs only `/srv/data`.
- **`TZ` is deliberately unset** — correctness comes from `STATION_TZ` + luxon's bundled tz database, not the OS zone (`config.ts:20-24`, `service.ts:141,329`); ensure NTP keeps the host clock correct (`kernel/clock.ts` reads real wall time).
- **Bun is pinned by floor, not by "whatever OndePlayer has."** The code needs `Bun.serve({ idleTimeout })` (`app.ts:465`), `new Database(…, { strict: true })` (`db.ts:32`), and `serveStatic` from `hono/bun`. Record a minimum (e.g. `>= 1.1.30`) in the runbook, gate the deploy on `bun --version`, and note that a single shared `/usr/local/bin/bun` couples OndeStudio and OndePlayer upgrades — install a versioned Bun for this unit if that coupling is unwanted.

### Public exposure (tyrell nginx + TLS)

The internet reaches OndeStudio only via **tyrell**, and only for `/self/*` + the read seam. Propose the hostname **`studio2.ondezero.net`** — deliberately distinct from AzuraCast's `studio.ondezero.net` (already the WebDJ/public AzuraCast host, `.env.example:5,28`), so the two vhosts never collide. The team/admin surface is **never** on this vhost; the team uses the tailnet.

Shared proxy snippet (defined once), then the allowlisting vhost — root installs on tyrell:

```nginx
# /etc/nginx/snippets/ondestudio-proxy.conf  (tyrell)
proxy_pass         $ondestudio;
proxy_http_version 1.1;
proxy_set_header   Host              $host;
proxy_set_header   X-Real-IP         $remote_addr;
proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header   X-Forwarded-Proto $scheme;   # drives the Secure cookie flag
```

```nginx
# /etc/nginx/sites-available/studio2.ondezero.net  (tyrell)
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
# per-IP throttle for the ONE public login: argon2 is CPU-costly and the whole
# app is a single Bun process, so an anonymous /self/login flood could starve
# the now-poll / 30s driver sweep / live-slot loops on the same event loop.
limit_req_zone $binary_remote_addr zone=selflogin:10m rate=5r/m;

server {
    listen 443 ssl http2;
    server_name studio2.ondezero.net;
    ssl_certificate     /etc/letsencrypt/live/studio2.ondezero.net/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/studio2.ondezero.net/privkey.pem;

    # onde-zero over the encrypted tailnet hop (HOST binds this same addr)
    set $ondestudio http://onde-zero.tailnet:4400;

    # SPA shell (the external webcaster page needs the static bundle)
    location / { include snippets/ondestudio-proxy.conf; }

    # public API allowlist — self-service + read seam only
    location ^~ /api/v1/self/ {
        include snippets/ondestudio-proxy.conf;
        proxy_set_header Upgrade    $http_upgrade;        # webcaster wss upstream
        proxy_set_header Connection $connection_upgrade;
    }
    location = /api/v1/self/login {
        limit_req zone=selflogin burst=3 nodelay;
        include snippets/ondestudio-proxy.conf;
    }
    location ~ ^/api/v1/stations/[^/]+/(now|sse)$ {
        include snippets/ondestudio-proxy.conf;
        proxy_buffering    off;                           # SSE
        proxy_read_timeout 1h;
    }
    # everything else under /api/v1 is team-only → never on the internet.
    # This also keeps /api/v1/openapi.json and /api/v1/health (both in
    # PUBLIC_PATHS, app.ts:70-71) off the public origin — no free API-surface
    # recon. nginx can still hit /health directly for its own upstream check.
    location /api/v1/ { return 403; }
}
server { listen 80; server_name studio2.ondezero.net; return 301 https://$host$request_uri; }
```

**Secure-context requirement.** The self-service webcaster (PD §5.6) uses `getUserMedia` + a WebSocket to the AzuraCast WebDJ harbor; browsers grant a microphone and open that socket **only from an HTTPS origin**. Serving `studio2.ondezero.net` over TLS is therefore a functional precondition for "broadcast from here," not cosmetics. `AZURACAST_WEBDJ_URL` (`wss://studio.ondezero.net/radio/8015/input`, `.env.example:28`) is opened by the *client's browser*, so it stays a public `wss://` host — unlike `AZURACAST_BASE_URL`, the *server*→AzuraCast on-box URL (see Config). The team's tailnet access is HTTPS too (Tailscale's own cert), so the secure context holds for team users without any public exposure.

Not exposing `/openapi.json` and `/health` publicly (they are in `PUBLIC_PATHS`, `app.ts:70-71`) is handled at the edge above; optionally drop `/openapi.json` from `PUBLIC_PATHS` in prod as belt-and-braces, but the edge 403 is sufficient.

### Data & DB

- **Path.** `DB_PATH=/srv/data/ondestudio.sqlite` (absolute — the resolver anchors relative paths to the repo root, but an absolute path is unambiguous under `ProtectSystem=strict`; `db.ts:19-21,28-32`). Opened WAL + `foreign_keys=ON`; the parent dir is auto-created.
- **Session secret — must be explicit.** `SESSION_SECRET` (≥32 chars) is **required** in this deployment. When unset, the code writes an auto-generated secret to `resolveDataPath("data/session-secret")`, which anchors to the **repo root** — `/opt/OndeStudio/data/session-secret` — *independent of `DB_PATH`* (`app.ts:357-360` → `db.ts:19-21`; `secret.ts:21-22` does `mkdirSync`+`writeFileSync`). Under this unit `/opt` is read-only, so the unset path throws `EROFS`/`EACCES` and the service crash-loops. Supplying `SESSION_SECRET` makes `loadOrCreateSessionSecret` return early (`secret.ts:13`) and never touch the filesystem, side-stepping the bug entirely. (Alternative, if the auto-generate path is ever wanted: a one-line code change to derive the secret path from `dirname(config.dbPath)` — that would then be a precondition-PR item; this RFC takes the no-code route and mandates the env var.)
- **Migrations bring-up.** There is **no** `db:migrate` step — migrations apply **on boot** inside `createDb()` (`migrate(db, { migrationsFolder })`, `db.ts:16,36`), idempotent, so simply starting the service (or running any ops script that calls `createDb()`) applies all pending migrations. The count/tags are whatever `drizzle/meta/_journal.json` lists (the source of truth — don't hardcode a number). Verify the "database ready" log.
- **Backups (data disk, no `sqlite3` CLI dependency).** Single-file WAL SQLite ⇒ do **not** `cp` the live file (uncommitted data lives in `-wal`/`-shm`). The app uses `bun:sqlite`, not the `sqlite3` binary — which may be absent — so the nightly systemd-timer (installed by root, its own unit with `ReadWritePaths=/srv/backups`) takes a consistent snapshot through Bun:
  ```sh
  /usr/local/bin/bun -e 'new (require("bun:sqlite").Database)("/srv/data/ondestudio.sqlite", {readonly:true}).exec(`VACUUM INTO '\''/srv/backups/ondestudio-'"$(date +%F)"'.sqlite'\''`)'
  ```
  `VACUUM INTO` produces a fully-checkpointed **standalone** file (no `-wal`/`-shm` sidecar) — ideal for restore. Keep ~14 daily + a few weekly, gzip, rotate. `.env` (which holds `SESSION_SECRET` **and** `AZURACAST_API_KEY`) is the only other stateful thing — back it up out-of-band with the DB. There is **no** `/srv/data/session-secret` file when `SESSION_SECRET` is set, so nothing extra to snapshot. `/` (tight) stays untouched. No app-side cron is needed — session/token cleanup is lazy/opportunistic.
- **Restore (RPO ≈ 24h).** With nightly snapshots a restore loses up to ~24h. Procedure: `systemctl stop ondestudio` → delete `ondestudio.sqlite` **and** its `-wal`/`-shm` sidecars → copy the chosen snapshot into place, `chown ondestudio:ondestudio` → confirm `.env` (with the same `SESSION_SECRET`, or logged-in sessions invalidate) is present → `systemctl start ondestudio` → confirm the "database ready" log and that migrations are at head. Because the snapshot is a standalone file, this is a single-file copy — no sidecar juggling.

### Config & secrets

The complete runtime surface is the 13-var Zod schema `EnvSchema` (`platform/config.ts:10-38`); the web front reads no `VITE_*`. Boot fails fast with a per-field message if a required var is missing. The `.env` lives at `/opt/OndeStudio/.env`, mode `0600`, owned by `ondestudio`, gitignored, never committed (PD §7.1). It stays *inside* the clone (so Bun's cwd-loader finds it and the secret never enters systemd's environment); `ProtectSystem=strict` blocks the process from writing it. **The one deploy hazard of co-locating it: `git clean -x` would delete a gitignored `.env`** — so the upgrade procedure below uses `git checkout <tag>` only and **never** `git clean -x`. (If you prefer the key outside the tree, move it to `/srv/data/ondestudio.env` and switch to `EnvironmentFile=` — but then constrain the file to systemd's `KEY=value` grammar.) Production values:

| Var | Value on onde-zero | Notes |
|---|---|---|
| `AZURACAST_BASE_URL` | **`http://localhost:8080`** | **On-box hairpin** — hit the AzuraCast container directly; do **not** use public `studio.ondezero.net` (NAT hairpin). `.env.example:5` ships the public URL and **must be overridden**. Server→AzuraCast only. Verify (a) the container publishes `:8080` on the host and (b) AzuraCast's "Prefer/Always Use HTTPS Browser URL" is off, else `http://localhost:8080` 301-redirects to the public host — see runbook check. |
| `AZURACAST_API_KEY` | **secret** — dedicated, **station-scoped**, least-privilege account key | Today the shared global-admin "OndeZero API account" key is reused: over-privileged (global-admin, not station-scoped), shared with OndePlayer (writes unattributable), blast radius covers `oz`. The `wz-test` env gate does *not* contain a leaked key. **Provision the dedicated station-scoped account and swap this key BEFORE any internet exposure** (stage sequence, Stage 2). |
| `AZURACAST_WRITE_STATIONS` | **`wz-test`** | The sole runtime write gate (bug-safety, not compromise-safety). **Never add `oz`** until the adoption sequence clears. |
| `AZURACAST_WEBDJ_URL` | `wss://studio.ondezero.net/radio/8015/input` | **Public** `wss://` — the browser opens it. Unset ⇒ webcaster console disabled. |
| `SESSION_SECRET` | **required** — explicit ≥32-char random | Not optional here: the auto-generate fallback writes under read-only `/opt` and crash-loops boot (see Data & DB). Back up with `.env`. |
| `HOST` | **required, explicit — onde-zero's tailnet address** | The schema default is `127.0.0.1` (`config.ts:12`), which is invisible to tyrell → `proxy_pass` connection-refused. Binding the tailnet interface makes `:4400` reachable by tailnet peers only (team + tyrell), so no host firewall and no plaintext co-tenant exposure. Use `127.0.0.1` **only** in the `tailscale serve` on-box variant. |
| `PORT` | `4400` | |
| `DB_PATH` | `/srv/data/ondestudio.sqlite` | absolute, data disk |
| `STATION_TZ` | `Europe/Paris` | luxon-driven, not OS `TZ` |
| `AZURACAST_STATION_MAIN` / `_TEST` | `oz` / `wz-test` | mirror pair |
| `LOG_LEVEL` / `NOW_POLL_SECONDS` | `info` / `10` | defaults |

Only `AZURACAST_API_KEY` and `SESSION_SECRET` are secrets; the rest is non-sensitive config.

### Process model & runtime loops

One always-on process keeps *every* server-side loop alive (all self-scheduled inside `startIngest()` → `Bun.serve`, `app.ts:457-468`; no worker, no OS cron):

- **now-playing poll** — per station `setInterval`, `NOW_POLL_SECONDS` (default 10s), feeds the public `now` seam + SSE `onair`.
- **M3 driver** — `runOnce()` boot catch-up, then a **30s** drift sweep, plus a **4s** per-station debounce (the undo window) on `scheduling.grid-changed`. No-op until `writeStations` is non-empty, so it is inert while `wz-test`-only-and-idle and active for `wz-test` writes.
- **live-slot projection coordinator** — a **4s** debounced apply of broadcaster streamer `schedule_items` on main-station grid changes (`app.ts:342-355`).
- **SSE heartbeat** — 15s per open connection (Bun `idleTimeout: 60`).

**Restart / deploy behavior.** The driver self-heals: boot `runOnce()` + 30s sweep reconcile by observing tagged upstream markers (idempotent adopt), so drift accumulated while down — including a create whose ledger row never landed mid-crash — is reconciled within boot + ≤30s. The projection ledger, reconciliation inbox, and now-cache live in SQLite and survive restart; stale on-air is served immediately then refreshed. In-memory debounce timers are lost on restart but the driver's are backstopped by the sweep. **One gap to flag:** the live-slot projection coordinator is **edge-triggered only** (`app.ts:348-354`) — no boot catch-up, no periodic sweep — so after a restart with no subsequent main-station grid edit, broadcaster streamer `schedule_items` are never re-asserted. If streamer schedules must be as durable as playlist projection, add a boot `applyLiveSchedules` and/or a periodic reconcile (tracked as a follow-on, not a deploy blocker since it is idle until adoption).

`systemctl restart ondestudio` is a clean bounce: the teardown closure clears all intervals + `driver.stop()`; `Restart=on-failure` + the `StartLimit*` backstop cover crashes without infinite hammering.

### Monitoring & logs

- **journald.** systemd captures stdout/stderr → `journalctl -u ondestudio`; `LOG_LEVEL=info` gives structured lines. Decide persistent vs volatile journal and a retention cap (e.g. `SystemMaxUse`) so logs don't fill the tight `/`.
- **Liveness.** `/api/v1/health` (`app.ts:416`) returns `{ status, adapters.azuracast }` — the AzuraCast adapter's reachability. Wire tyrell's upstream check (or a lightweight external probe) at it *internally* (nginx reaches the upstream regardless of the public `403` on `/api/v1/`), so tyrell/ops can tell when onde-zero:4400 is down.
- **Alerting.** An external uptime probe on the service (and, once `oz` adoption starts, an eye on the reconciliation-inbox depth) turns a wedged driver into a page instead of a silent stall.
- **Crash-loop surfacing.** The `StartLimitIntervalSec=120` / `StartLimitBurst=5` in the unit turn a hard-failing boot (bad `.env`, bad migration) into a `failed` state after 5 tries, instead of restarting every 3s forever and re-firing `driver.runOnce()` against `wz-test` each time.

### Deploy & upgrade procedure (runbook)

**Precondition:** the "One process, two surfaces" PR (serveStatic + SPA fallback, secure cookies via `X-Forwarded-Proto`, root `build` script) is merged and tagged. Until it is, `bun run build` and the served SPA do not exist.

**First deploy** (root does dir/user/unit/vhost/timer; `ondestudio` owns the app; whoever holds the tyrell cert does TLS):

1. **(root, onde-zero)** `useradd --system --home /opt/OndeStudio --shell /usr/sbin/nologin ondestudio`; `mkdir -p /opt/OndeStudio /srv/data /srv/backups`; `chown -R ondestudio:ondestudio /opt/OndeStudio /srv/data /srv/backups`. Confirm `bun --version` meets the floor and nothing else on the box already holds `:4400`.
2. **(ondestudio)** `git clone git@github.com:OndeZero/OndeStudio.git /opt/OndeStudio` (or deploy a tarball) at the release tag.
3. **(ondestudio)** `cd /opt/OndeStudio && bun install`.
4. **(ondestudio)** `bun run build` → `packages/web/dist/` (requires the precondition PR).
5. **(ondestudio)** create `/opt/OndeStudio/.env` (chmod 600) with the Config values — `AZURACAST_BASE_URL=http://localhost:8080`, `AZURACAST_WRITE_STATIONS=wz-test`, `DB_PATH=/srv/data/ondestudio.sqlite`, `HOST=<onde-zero tailnet addr>`, the API key, and an explicit `SESSION_SECRET` (≥32 chars). Keep it to plain `KEY=value` lines.
6. **(ondestudio)** verify the on-box hairpin: `curl -sS http://localhost:8080/api/nowplaying` returns JSON, **not** a 301 to `https://studio.ondezero.net` (if it redirects, turn off AzuraCast's "Always Use HTTPS Browser URL" or use the container's host port). Then apply migrations *without* binding the port or starting loops by running an ops script that calls `createDb()`: `bun packages/api/scripts/import-users.ts` (read-only pull from AzuraCast; applies all pending migrations idempotently). Do **not** boot the full server just to migrate — that binds `:4400` and fires `driver.runOnce()`, risking a port collision with step 8 and a manual `wz-test` reconcile.
7. **(ondestudio)** per teammate: `bun packages/api/scripts/issue-setup-link.ts <email>` — **rewrite the printed host**: the script hardcodes `http://localhost:5173/setup?token=…` (`issue-setup-link.ts:40`); the *token* is valid, but replace the host with **whatever origin the team currently reaches** — the **tailnet name during the pilot** (Stages 0-1), `studio2.ondezero.net` only once a public origin exists for team use (which, under this design, it does not — the team stays on the tailnet, so the tailnet host is the durable answer). Do **not** run `seed:demo` (writes demo rows on `oz` + a demo login — dev only).
8. **(root, onde-zero)** install `/etc/systemd/system/ondestudio.service`, `systemctl daemon-reload`, `systemctl enable --now ondestudio`, verify `systemctl status` + `journalctl -u ondestudio` (look for "database ready" + "listening").
9. **(root, tyrell)** *[Stage 3 only]* issue the cert for `studio2.ondezero.net`, install the snippet + allowlisting server block, `nginx -t && systemctl reload nginx`. Confirm tyrell reaches `http://<onde-zero tailnet addr>:4400/api/v1/health` over the tailnet.
10. **(root, onde-zero)** install the nightly `VACUUM INTO` backup timer → `/srv/backups`, and confirm `.env` is included in the out-of-band backup set.

**Upgrade:** `git fetch && git checkout <tag>` (**never** `git clean -x` — it would delete `.env`) → `bun install` → `bun run build` → `systemctl restart ondestudio` (migrations re-apply on boot; driver self-reconciles within ≤30s). **Rollback:** `git checkout <previous tag>` → `bun install` → `bun run build` → `systemctl restart`. Migrations are additive; keep releases migration-compatible across one step so a code-only rollback is safe, otherwise restore the pre-upgrade `/srv/backups` snapshot alongside the code rollback (Restore, above).

### The `wz-test` → `oz` adoption sequence (staged; dedicated key before public exposure)

Deployment and write-adoption are deliberately **decoupled**: OndeStudio goes live reading-and-writing-`wz-test` long before it writes `oz`. Both §7.7 preconditions — **dedicated API account** *and* **per-feature adoption** — must hold before the flip, and the flip is one env var. The order below is chosen so OndeStudio is **never internet-facing while holding the shared global-admin key**.

1. **Stage 0 — deploy, `wz-test`-gated, tailnet-only.** All of the above with `AZURACAST_WRITE_STATIONS=wz-test`, bound to the tailnet, no public vhost. OndeStudio reads `oz` (mirror), writes only `wz-test`, verified with tagged cleanup. Not reachable from the internet.
2. **Stage 1 — team pilot over the tailnet.** The team uses real grid/board/broadcaster-mgmt against real `oz` reads; writes still `wz-test`. Shake out auth, sessions (now `secure`), timezone, SSE under the real network. Setup-link host = the tailnet name.
3. **Stage 2 — dedicated, least-privilege API account.** Provision OndeStudio's **own** AzuraCast account, **station-scoped** to `wz-test` (later `oz`) with only playlist/schedule/streamer permissions — *not* global admin — so a host compromise cannot reach production at all. Swap its key into `AZURACAST_API_KEY`, retire the reused shared global-admin key. Re-run the `wz-test` write suite + recorded-fixture tests (the M3 version-safety step, docs/2 §13) against the account. **This precedes any internet exposure.**
4. **Stage 3 — public webcaster exposure.** Bring up the tyrell `studio2.ondezero.net` vhost + TLS with the allowlist (public: `/self/*` + read seam; team/admin stay tailnet-only). Secure context for external webcasters is now satisfied. Still `wz-test`-only, and now on a least-privilege key.
5. **Stage 4 — per-feature `oz` adoption.** Feature by feature, once trusted (PD §6 — *not* a single global flip): extend the dedicated account's scope to `oz`, add `oz` to `AZURACAST_WRITE_STATIONS`, restart, watch the reconciliation inbox. M4 fan-out writes obey the same gate.

Only Stage 4 touches production audio; Stages 0-3 are pure deployment and can proceed now.

### Security & hardening

- **Least privilege — process.** Dedicated `ondestudio` system user, `nologin`, no sudo, no docker group. It can write only `/srv/data`; `/opt/OndeStudio` (incl. the built SPA and migrations) is read-only under `ProtectSystem=strict`. `.env` is `0600`.
- **Least privilege — AzuraCast.** The dedicated account is station-scoped with playout permissions only (Stage 2). The `AZURACAST_WRITE_STATIONS` env gate protects against OndeStudio *bugs*; the scoped account is what protects `oz` against OndeStudio *compromise* — the two are complementary, and the RFC relies on both.
- **Minimal internet surface.** Only `/self/*` + the read seam are public; the entire team/admin surface, `/openapi.json`, and `/health` are tailnet-only. The one public login is edge-throttled (`limit_req`). The process binds the tailnet interface, so `:4400` is unreachable from the raw internet or from non-tailnet co-tenants; the tyrell↔onde-zero hop is encrypted by the tailnet, so cookies/credentials never cross a plaintext link.
- **systemd sandboxing** mirrors wavezero-form: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `ProtectKernel*`, `RestrictAddressFamilies`, `RestrictNamespaces`, `LockPersonality`, plus the `StartLimit*` backstop. `MemoryDenyWriteExecute` stays off (Bun JIT).
- **Who runs the root steps.** The `ondestudio` user cannot install units, create `/opt`/`/srv` dirs, or touch nginx. Runbook 1, 8, 9, 10 are executed by **the box's root holder** (onde-zero root for the unit + dirs + backup timer; tyrell root for the vhost + cert); `ondestudio` does only clone/install/build/env/migrate/seed (runbook 2-7). *Which people hold those roots is an Open question.*
- **Secret handling.** `AZURACAST_API_KEY` and `SESSION_SECRET` live only in `.env`, `0600`, backed up out-of-band with the DB, never committed. No `EnvironmentFile`, so the secret is not exposed via `systemctl show`. The shared-key risk is closed at Stage 2, before exposure.
- **CSRF** posture is acceptable (`SameSite=Lax` + cookie auth; state changes are POST/PUT). Before Stage 3, audit that no *state-changing GET* routes exist on the public `/self/*` surface (Lax permits top-level GET) — a quick check, nothing suggests one today.

## Out of scope (phase 1)

- **`oz` writes** — held by `AZURACAST_WRITE_STATIONS` until the adoption sequence completes (§7.7); Stage 4 is a separate, deliberate act.
- **A public team/admin origin** — the team stays tailnet-only by design; taking the admin surface off the tailnet is a future decision, not phase 1.
- **App-side login rate-limiting** — the internet-reachable `/self/login` is edge-throttled; a per-identity in-app throttle (and a global argon2 concurrency cap) is a hardening follow-on for the team login too.
- **now-playing meta push against live streams** — built and unit-tested (RFC 0001) but must be wired in the *same* change that retires OndePlayer's `live-meta-sync` (two writers would fight); M5-adjacent server-side handoff, not this RFC.
- **M5 OndePlayer↔OndeStudio** — OndePlayer reading OndeStudio's `schedule`/`now` is the next milestone; this RFC only makes OndeStudio *reachable* so M5 has an endpoint to point at.
- **Unattended drop-folder ingest** — `scanAndFill` fires only on `POST /rescan` (UI action); no ingest timer is added here.
- **The live-slot projection self-heal gap** — flagged above; a boot/periodic `applyLiveSchedules` is a follow-on, harmless while writes are `wz-test`-idle.
- **Containerizing OndeStudio, HA, multi-server** — single-server systemd is the phase-1 shape (PD low-complexity goal).

## Open questions

- **Who holds root, and who owns AzuraCast.** Runbook 1/8/9/10 and Stage 2 need concrete actors: who holds root on onde-zero, who administers tyrell (cert + vhost), and who owns the AzuraCast instance to provision the dedicated station-scoped account. Named before Stage 0 (onde-zero root) / Stage 2 (AzuraCast owner) / Stage 3 (tyrell root).
- **The onde-zero bind address / name — blocks Stage 3.** The team reaches onde-zero as a tailnet peer (survey: `100.84.152.42`, `onde-zero.tail14bc63.ts.net`), so Stage 0-1 work today. The open part is how **tyrell** reaches it: the survey confirms tyrell and onde-zero are co-located on the same physical host and the same LAN (`ens18` = `192.168.4.102/24`), so two concrete options exist — (a) if tyrell is also a tailnet peer, bind the tailnet interface and use the encrypted hop (preferred; no firewall needed); (b) otherwise bind the **LAN** address `192.168.4.102:4400` and firewall `:4400` to tyrell's LAN IP (the hop is same-host plaintext, acceptable for a co-located link). The vhost uses the placeholder `onde-zero.tailnet:4400` until the choice is made. What remains is confirming tyrell's tailnet membership and picking the concrete `HOST` + nginx upstream.
- **tyrell cert mechanism (Stage 3).** Let's Encrypt via certbot on tyrell (HTTP-01 needs `studio2.ondezero.net`→tyrell:80; DNS-01 avoids that) vs. an existing wildcard tyrell already holds. Settled by whoever administers tyrell.
- **on-box hairpin — one toggle to confirm.** The survey confirmed the AzuraCast container publishes `:8080` on the host (fingerprinted: `localhost:8080` → nginx `302`). What remains is whether AzuraCast's "Always Use HTTPS Browser URL" is off, so `http://localhost:8080` serves the API rather than `301`-redirecting to the public host — runbook step 6 is that check.
- **M5 seam auth.** When OndePlayer reads OndeStudio's `schedule`/`now`, does it hit the tailnet origin or `:4400` directly on-box? Likely the latter (both on onde-zero) — settled in the M5 RFC.
- **now-playing meta push cutover.** The exact ordering that disables OndePlayer's `live-meta-sync` in the same change that arms OndeStudio's push — settled in the M5/meta-push RFC (server-side, per RFC 0001).
