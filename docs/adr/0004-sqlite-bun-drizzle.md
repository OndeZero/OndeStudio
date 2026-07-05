# 0004 — SQLite via `bun:sqlite`, Drizzle ORM, versioned migrations

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Single-server deployment (`onde-zero`), 4–6 users, zero-ops ambition; the PD locks SQLite. The
persistence layer must stay readable and SQL-close (low cognitive load), with schema evolution
that cannot silently diverge between environments.

## Decision

- **`bun:sqlite`** as the driver: native, fast, zero-dependency.
- **Drizzle** as the ORM: SQL-close, readable, typed, with `bun:sqlite` support. Tables are owned
  per-module in each module's `schema.ts`; the domain never sees a row — repositories and
  mappers translate.
- **drizzle-kit** generates **versioned SQL migrations** (`bun run db:generate`), applied
  idempotently at startup.

## Consequences

- One SQLite file: trivial file-copy backups now, litestream-style option later.
- No spreadsheet/Wekan data migration — the seed import populates from AzuraCast.
- Multi-instance needs would force a revisit; phase-3 packaging may offer Postgres as an option.

## Links

- docs/2 §3.8 (stack), §5.6 (migrations), §13 (backups); PD §7.1.
