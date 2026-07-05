# 0006 — A typed, synchronous, in-process event bus — no broker

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Cross-module reactions (a notification when an episode attaches, a playout push on validation)
must not couple the emitting module to its consumers, and must not create import cycles. A
message broker or async job infra would solve this at an operational cost a one-process,
4–6-user app cannot justify.

## Decision

A **typed, synchronous, in-process event bus** lives in `kernel`. Modules declare the events they
emit and subscribe to in their `events.ts`; the emitter never knows its consumers. No broker, no
queues, no async infrastructure — the simplest thing that works.

## Consequences

- Reactions live at one seam; would-be import cycles between modules are broken by events.
- Handlers run synchronously in-process: no durability, no retry, no cross-restart delivery.
  That is fine while every reaction is best-effort; **revisit only if a reaction ever needs
  durability** (docs/2 open question §14.7).

## Links

- docs/2 §3.4 (inter-module communication), §14.7 (event-bus scope, open).
