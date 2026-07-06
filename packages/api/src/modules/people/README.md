# people

Identity and access (docs/2 §12, PD §4.12): OndeStudio's **own** user/session store,
seeded from AzuraCast accounts but independent thereafter — auth survives phase 3 when
AzuraCast disappears. M2 ships users + sessions + the team directory; broadcasters with
their main/test fan-out join in M4, tags and sessions/replays later.

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
