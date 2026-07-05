# 0005 — `Result` values for expected failures; exceptions stay exceptional

- **Status:** accepted
- **Date:** 2026-07-05

## Context

A reader of a use-case (`service.ts`) must see every failure it can produce — hidden control flow
(throws surfacing three layers up) is exactly the complexity the project bans. Domain rules
(illegal state transitions, invariant violations) are *expected* outcomes, not accidents.

## Decision

Expected outcomes are returned as a **`Result<T, DomainError>`** value (defined in `kernel`).
**Exceptions are reserved for the truly exceptional**: bugs and infrastructure failure. Domain
errors map to HTTP status codes **once**, in `platform` — modules never hand-roll error
responses.

## Consequences

- Every failure a use-case can return is in its signature; the compiler forces callers to handle
  it.
- One place defines the HTTP mapping (4xx client, 5xx adapter/AzuraCast); routes stay thin.
- Slightly more ceremony than `throw` — accepted; it is the readable kind.

## Links

- docs/2 §4.3 (errors), §6.1 (API conventions), §4.4 (state machines return typed errors).
