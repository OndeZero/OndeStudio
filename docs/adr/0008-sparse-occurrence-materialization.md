# 0008 — Sparse occurrence materialization with RFC-5545-style exceptions

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Recurring slots need individually editable occurrences (move one week, attach an episode, record
state) without materializing every future instance forever — and a *moved* occurrence must not
double-render next to its computed original.

## Decision

Occurrences are **computed on read** from `slot.rrule` over a rolling horizon; an `occurrence`
row is **persisted only when it diverges** — it carries state, an episode/echo binding, an
exception, or has aired. **`original_starts_at_utc` is the recurrence key** (the RFC-5545
`RECURRENCE-ID`/`EXDATE` analogue): it pins a persisted row to the computed instance it
overrides, so a moved occurrence suppresses its original slot time. Uniqueness:
`UNIQUE(slot_id, original_starts_at_utc)`.

## Consequences

- Small table; "edit one occurrence" is one exception row; the series stays intact.
- Phase 1 emits/parses only the weekly `rrule` subset (the dominant case); the column is
  forward-compatible.
- The materialization horizon is tuned at M1 against grid performance (open question §14.9);
  echo-pairing edge cases settle in the domain pass.

## Links

- docs/2 §5.3 (recurrence), §5.2 (`occurrence` table); PD §7.2 (definition + occurrences).
