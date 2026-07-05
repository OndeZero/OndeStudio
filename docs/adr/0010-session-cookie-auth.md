# 0010 — Session-cookie auth on an OndeStudio-owned store; no JWT

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Auth must survive phase 3, when AzuraCast disappears — so it cannot be a live proxy to AzuraCast.
AzuraCast passwords are neither readable nor verifiable through its API. The deployment is one
server and 4–6 trusted users; token infrastructure would be ceremony.

## Decision

- OndeStudio **owns its user/session store**, provisioned and synced from AzuraCast accounts —
  not a live proxy.
- **Signed httpOnly session cookies** (`SameSite=Lax`; with a JSON-only API this covers CSRF
  without a token dance), backed by a `user_session` table. **No JWT.**
- Passwords hashed with **`Bun.password` (argon2id)**. Team members set an OndeStudio password
  via an admin-issued one-time setup link; external broadcasters are verified against their
  Icecast streamer credentials via `IdentityPort.verifyBroadcaster`.
- Lands at **M2**; public-read auth for the galaxy seam is decided at M5.

## Consequences

- Auth is decoupled and phase-3-ready; the store is independent after first password set.
- Sessions are revocable server-side (a table row), unlike stateless tokens.
- Roles stay coarse (`team` / `external`); a finer intra-team split is deliberately deferred.

## Links

- docs/2 §12 (auth & identity), §6.5, §14.8; PD §4.12, §7.1.
