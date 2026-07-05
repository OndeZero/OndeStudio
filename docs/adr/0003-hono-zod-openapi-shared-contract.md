# 0003 — Hono + @hono/zod-openapi, with a shared Zod package as the single contract source

- **Status:** accepted
- **Date:** 2026-07-05

## Context

API-first, alongside the front (docs/2 §2.2): the front must talk the real API shape from day
one, external consumers (OndePlayer, drop, OndePi) are first-class, and one contract source must
drive validation, documentation and client types — writing schemas twice guarantees drift.

## Decision

- **Hono** as the HTTP server: tiny, fast, runtime-agnostic (honours "boundary, not foundation"),
  first-class OpenAPI via Zod, built-in SSE. Elysia was rejected as more Bun lock-in.
- **@hono/zod-openapi** generates the OpenAPI document straight from the Zod-typed routes.
- A **shared workspace package (`packages/shared`) of Zod schemas** is the single contract
  source: it validates server I/O, produces the OpenAPI document, and types the web client.
  `shared` depends on neither `api` nor `web`; both import it.

## Consequences

- One schema, three artefacts — validation, docs, client types — no drift by construction.
- `web` and `api` never import each other; they meet only in `shared` (CI-enforced).
- Contract changes are visible in one package, making API-breaking PRs easy to spot (and to send
  through an RFC when cross-cutting).

## Links

- docs/2 §2.2 (API-first), §3.3 (tree), §3.8 (stack), §6 (API design).
