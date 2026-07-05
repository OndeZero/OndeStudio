# Architecture Decision Records

Short, permanent records of the non-trivial decisions that shape OndeStudio — so the *why* is
never lost (docs/2 §10.3). ADRs 0001–0011 seed the log with decisions taken during the pre-build
design sessions and the 2026-07-05 audit; from here on, any patch that takes a non-trivial
decision adds its ADR in the same PR.

## Format — MADR-lite

One screenful: **Title · Status · Date · Context · Decision · Consequences · Links**. See
[`0000-template.md`](0000-template.md). Context says what forced a choice; Decision states it
plainly; Consequences name the trade-offs accepted; Links point at spec sections, issues, PRs.

## Adding one

1. Copy `0000-template.md` to `NNNN-short-slug.md`, taking the next free number.
2. Fill it in — short beats complete; a reader wants the decision and its why in a minute.
3. Include it in the PR that implements (or proposes) the decision. Status is `proposed` while
   under discussion, `accepted` once merged.

Never rewrite an accepted ADR: add a new one and mark the old one `superseded by NNNN`.

## Index

- [0001](0001-modular-monolith-feature-modules.md) — Modular monolith in six feature modules
- [0002](0002-ports-and-adapters-azuracast-boundary.md) — Ports & adapters; AzuraCast is a boundary
- [0003](0003-hono-zod-openapi-shared-contract.md) — Hono + @hono/zod-openapi + shared Zod contract
- [0004](0004-sqlite-bun-drizzle.md) — SQLite via `bun:sqlite` + Drizzle migrations
- [0005](0005-result-errors.md) — `Result` values for expected failures
- [0006](0006-in-process-event-bus.md) — Typed in-process event bus, no broker
- [0007](0007-biome-depcruise-lefthook.md) — Biome + dependency-cruiser + Lefthook toolchain
- [0008](0008-sparse-occurrence-materialization.md) — Sparse occurrence materialization
- [0009](0009-wall-clock-time-model.md) — Wall-clock time model, DST confined to the adapter
- [0010](0010-session-cookie-auth.md) — Session-cookie auth on an OndeStudio-owned store
- [0011](0011-now-playing-poll-first.md) — Now-playing ingest: poll first, SSE later
