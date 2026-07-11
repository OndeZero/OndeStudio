# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

OndeStudio (the OndeZero studio) is **in build**. Landed: **M0** skeleton, **M1** week grid (team-validated 2026-07-06), **M2** (auth, board, show hub, media browser), **M4** (broadcaster main/test fan-out), reversible negotiation states (ADR-0012), **M3** the **driver** (write-back: validated weekly show/series/echo slots → tagged AzuraCast playlists with schedule_items; projection ledger + drift engine + reconciliation inbox; RFC 0001), the **episode queue** (drop-folder scan → nearest-empty occurrence fill → content-state flip → deterministic exact-membership episode media on the projected playlist; ADR-0013), **grid time-lens zooms** (week / 3-day / month) with grid slot-editing at parity with creation (edit recurrence/day/time in place; shared recurrence control), a **global quick-open palette** (Cmd/Ctrl-K → any page/show/card), and **live-slot projection** (a live slot binds a broadcaster; validated live slots fill that broadcaster's AzuraCast streamer `schedule_items` via the M4 fan-out — enforcement stays the per-broadcaster setting, so internal team accounts keep open airtime while external accounts are locked to their grid slots; PD §5.10), **drift auto-absorb** (the driver inverts a single weekly AzuraCast-side schedule change back onto the slot instead of always freezing; only ambiguous edits/deletes open the reconciliation inbox), and the **external broadcaster self-service** surface at `/self` (a SEPARATE auth realm — Icecast-credential login, `os_bc_session` cookie, `broadcaster_session` table — with own profile, own slots, propose-times [external → team-validated `prebooked` hold, internal → auto-validated], per-slot now-playing meta, and the **browser webcaster** "broadcast from here": mic → RMS level meter → MP3 (`@breezystack/lamejs`) → WebSocket `webcast` handshake to the AzuraCast WebDJ harbor; the client pipeline is verified headlessly, the on-air audible test is the user's to run; PD §5.6). **All four phase-1 exit-bar items exist** (grid, board, broadcaster mgmt, write-back). AzuraCast writes target `wz-test` only until the dedicated API account + adoption (docs/2 §7.7); everything write-related is live-verified there with tagged cleanup (episode-queue exact-membership and streamer schedule_items included). **Next** — the phase-1 fast-follow list is essentially complete, and **RFC 0002's precondition PR has landed**: one Bun process now serves the built web SPA via `serveStatic` + a guarded history fallback (`packages/api/src/platform/spa.ts`, wired in `app.ts`); both session cookies set `Secure` header-aware from `X-Forwarded-Proto` (`isRequestSecure` in `platform/http.ts`); and a root `build` script exists. **(1) DEPLOYED — OndeStudio is LIVE on `onde-zero` (2026-07-11, RFC 0002 Stages 0-3 verified)**: `ondestudio.service` (single Bun process, API + built SPA) bound to the tailnet at `http://100.84.152.42:4400` (team URL `http://onde-zero.tail14bc63.ts.net:4400` — **`localhost:4400` is NOT bound on the box**), DB `/srv/data/ondestudio/ondestudio.sqlite`, 7 team accounts imported, nightly `VACUUM INTO` backups, `ProtectSystem=strict` hardening verified; **public** at `https://studio2.ondezero.net` via the tyrell nginx vhost (allowlist: `/self/*` + `stations/*/{now,sse}` + SPA shell; team API + the M5 schedule seam 403'd publicly — team stays tailnet-only). Runbook = `deploy/` (`install.sh` re-run = upgrade). Deployment remains: **team setup links** (`issue-setup-link.ts`, rewrite host to the tailnet URL) · **Stage 2** dedicated station-scoped AzuraCast API key (deferred by team choice 2026-07-11 — currently on the shared global-admin key; do it soon, swap in `/opt/OndeStudio/.env` + restart) · **Stage 4** per-feature `oz` adoption (`AZURACAST_WRITE_STATIONS`); (2) **M5 — code complete both sides, awaiting only the operational cutover**: OndeStudio's public `GET /stations/{station}/schedule` seam (announceable occurrences only — validated + past-aired, revert-to-generic per PD §5.5, live `streamerName`; `public-schedule-routes.ts`, in `PUBLIC_PATHS`, on-box/tailnet) and OndePlayer's source selector (`../OndePlayer` `server/ondestudio-schedule.js` — prefer `ONDESTUDIO_URL`, time-boxed, fall back to AzuraCast on any miss; unset ⇒ byte-for-byte today) are both **landed and inert-by-default**; the cutover is one on-box env var — `ONDESTUDIO_URL=http://100.84.152.42:4400` (**not** `localhost`: OndeStudio binds only the tailnet address; verified `localhost:4400` answers nothing on the box) — and (1) is now live, so the cutover is unblocked. Now-playing stays on AzuraCast SSE — its OS richness arrives via the meta push (3), not this read-switch. See **RFC 0003** (`docs/rfc/0003-m5-ondeplayer-read-seam.md`, *proposed*); (3) **now-playing meta push** (server-side handoff, retires OndePlayer's `live-meta-sync` in the same change, see the playout README). The specification set under `docs/` remains the spec; RFCs in `docs/rfc/`.

## The docs are the spec

Read in this order:

1. `docs/1-project_description.md` (the "PD") — contexts, goals, **normative** domain vocabulary (§4), 3-phase architecture strategy (§6). **When documents disagree, the PD wins.**
2. `docs/2-implementation_plan.md` — architecture (modular monolith, ports & adapters), data model, API, milestones (§11), engineering conventions and contribution model (§9–§10).
3. `docs/3-storage-layout.md` — target media filetree (proposal, pending team validation; phase 1 reads the current tree as-is).
4. `docs/azuracast-write-audit.md` — confirmed AzuraCast API write capabilities (tested on `wz-test` only).

## Key Facts

- Remote: `git@github.com:OndeZero/OndeStudio.git` (default branch: `main`)
- License: GNU AGPL-3.0 — dependencies added to this project must be license-compatible with AGPL-3.0.
- Stack (locked, PD §7.1 / docs/2 §3.8): Bun · TypeScript · Hono · Vue 3 + Vite · SQLite (Drizzle) · Zod.
- Secrets live in the repo-local `.env` (gitignored); `.env.example` documents the variables. Never commit credentials.
- **AzuraCast writes: never against `oz` (production) until the per-feature adoption step says so** — test writes target `wz-test`, and production writes require the dedicated API account (docs/2 §7.7).

## Commands

Run from the repo root so `.env` loads. API dev serves on port 4400; web dev on 5173 (proxies `/api`).

| Command | Purpose |
|---|---|
| `bun install` | install workspace dependencies |
| `bun dev` | run api + web dev servers together |
| `bun run dev:api` / `bun run dev:web` | run one side alone |
| `bun run typecheck` | TypeScript strict across all packages |
| `bun run lint` / `bun run lint:fix` / `bun run format` | Biome lint / auto-fix / format |
| `bun run boundaries` | dependency-cruiser import-graph rules (docs/2 §3.6) |
| `bun run test` / `bun run test:api` / `bun run test:web` | test suites |
| `bun run check` | all gates: typecheck + lint + boundaries + test |
| `bun run db:generate` | generate Drizzle migrations (drizzle-kit) |
| `bun run --cwd packages/api seed:demo [--fresh]` | seed a demo week + the dev login (demo@ondestudio.local / ondestudio-demo) |
| `bun packages/api/scripts/import-users.ts` | seed/refresh users from the AzuraCast directory (read-only) |
| `bun packages/api/scripts/issue-setup-link.ts <email>` | print a one-time password-setup link for a teammate |

Code layout and conventions: `ARCHITECTURE.md` (the map) and `AGENTS.md` (the agent on-ramp).
