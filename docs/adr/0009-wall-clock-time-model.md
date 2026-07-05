# 0009 — Wall-clock time model; DST confined to the AzuraCast adapter

- **Status:** accepted
- **Date:** 2026-07-05

## Context

A 14:00 show must stay 14:00 across DST changes — the grid speaks the station's wall clock
(Europe/Paris), and humans negotiate in it. Meanwhile AzuraCast `schedule_items` are DST-naive
`HHMM` + `days`, and event history needs absolute timestamps.

## Decision

- **Slot times are wall-clock in the station timezone**; absolute `starts_at_utc` /
  `ends_at_utc` are derived via **Luxon** at materialization.
- **Event timestamps** (comments, sessions, play history) are **UTC**.
- The **one DST mapping** — wall-clock occurrences → DST-naive `schedule_items` — lives in the
  AzuraCast adapter and nowhere else.

## Consequences

- Grid, humans and recurrence rules agree by construction; DST cannot leak into the domain.
- The spring-forward/fall-back edge behaviour of the adapter mapping is an open item, confirmed
  in implementation at M3 (docs/2 §14.5).
- Time display is 24-hour, server-referenced, with contributor-timezone helpers as a UI concern.

## Links

- docs/2 §5.4 (time model), §7.8 (`schedule_items` mapping), §14.5; PD §8.1 (time guidelines).
