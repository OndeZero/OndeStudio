# 0002 — Ports & adapters: the AzuraCast API is a boundary, not a foundation

- **Status:** accepted
- **Date:** 2026-07-05

## Context

The three-phase strategy (PD §6) requires each capability's implementation to flip from "drive
AzuraCast" (phase 1) to "do it natively" (phase 2) without rewriting the layers above. If
AzuraCast assumptions leak upward, that flip becomes a rewrite.

## Decision

Hexagonal architecture (ports & adapters). Each takeover-bound capability sits behind a
TypeScript interface — `PlayoutPort`, `MediaStorePort`, `PlayoutStatePort`, `IdentityPort`;
repositories and the event bus are ports too — with the phase-1 AzuraCast-backed implementations
in `modules/playout/adapters/azuracast`, wired once in `app.ts`. AzuraCast-shaped types never
escape the adapter; `ProjectionRef` carries AzuraCast ids opaquely.

## Consequences

- A phase-2 takeover is a new adapter plus a wiring change; nothing above the port notices.
- The domain is testable with zero IO; adapters test against recorded fixtures.
- One level of indirection everywhere a port sits — accepted as the price of the seam.
- A flaky AzuraCast degrades the overlay (retry/backoff, circuit breaker), never air.

## Links

- docs/2 §3.1 (layering), §3.5 (ports), §7.2 (adapter); PD §6 (cross-phase implications).
