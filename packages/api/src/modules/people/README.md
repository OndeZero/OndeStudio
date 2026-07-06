# people

Identity and access (docs/2 §12, PD §4.12): OndeStudio's **own** user/session store,
seeded from AzuraCast accounts but independent thereafter — auth survives phase 3 when
AzuraCast disappears. M2 ships users + sessions + the team directory; M4 adds
broadcasters with their main/test fan-out; tags and sessions/replays come later.

## Broadcasters (M4 — the fan-out, PD §5.10)

One definition fans out to both stations: identical username/credential, schedule
enforcement pushed to MAIN only, the test mirror always unrestricted (PD §2.2).
Rules that matter:

- **Writes obey docs/2 §7.7 twice**: the composition root wires only
  `AZURACAST_WRITE_STATIONS` (default `wz-test`) into the fan-out, and the playout
  streamer adapter refuses anything else itself. `oz` reports `blocked` until the
  dedicated API account exists and the team adopts the feature — never silently
  skipped, always in `warnings`.
- Every streamer we own upstream carries the `[ondestudio:broadcaster:<id>]` marker
  (docs/2 §3.7). Adopted (imported) streamers keep their credentials — which are
  unreadable upstream, so `hasPassword: false` until a rotate; the mirror-drift fix
  (`sync-test`) therefore issues a fresh credential and says so.
- Routes live at root level (`/broadcasters`), not under `/stations/{station}` — a
  deliberate deviation from the docs/2 §6.2 sketch: the object IS the station pair.
- Full projection rows + the drift engine arrive with M3; until then the
  `*_streamer_ref` columns carry the linkage.

## How auth works

- Users are **seeded** from the AzuraCast admin directory (`AccountDirectoryPort`,
  implemented by the playout module's adapter — read-only upstream). AzuraCast
  passwords are neither readable nor verifiable, so each account gets an
  **admin-issued one-time setup link** (`scripts/issue-setup-link.ts`) to set a local
  password (argon2id via `Bun.password`).
- Sessions are DB rows keyed by a 256-bit random id; the signed httpOnly cookie
  (`os_session`, SameSite=Lax) carries only that id. 30-day rolling expiry, touched at
  most daily. No JWT — a single-server 4-6-user app (docs/2 §12).
- The platform auth middleware gates the whole API except the public read seam
  (health, OpenAPI, `auth/login|setup`, `now`, SSE) — wired in app.ts so platform
  never imports modules.

## Invariants

- **Never write upstream**: the directory import is GET-only; account changes flow
  OndeStudio→AzuraCast only from M4's broadcaster fan-out under docs/2 §7.7.
- Login errors are deliberately specific about the no-password-yet case — small-team
  pragmatism outranks enumeration paranoia here (PD §8.1), revisit for phase 3.
- `external` role reaches only its own surfaces — enforced when those surfaces land
  (M4/fast-follow); M2 gates everything at team level.
