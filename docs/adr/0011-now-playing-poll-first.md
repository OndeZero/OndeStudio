# 0011 — Now-playing ingest: short polling first, SSE when the on-air surface lands

- **Status:** accepted
- **Date:** 2026-07-05

## Context

The M0 walking skeleton's vertical slice (`GET /stations/{station}/now`) needs now-playing state
from AzuraCast. The planned SSE listener (docs/2 §7.3) brings real machinery — connection
lifecycle, reconnect, event parsing — that the skeleton does not need in order to prove the
architecture runs end to end.

## Decision

For the walking skeleton, ingest now-playing by **short polling** the AzuraCast API (default
**10 s**) behind `PlayoutStatePort` — the simplest correct thing. The freshness bar (live in
seconds, structural ≤ 30 s) is still met at this poll rate for the skeleton's purposes.

## Consequences

- M0 stays small; the vertical slice proves route → service → domain → adapter without SSE
  plumbing.
- The **AzuraCast SSE upgrade is planned as a fast-follow, when the on-air surface lands** —
  OndePlayer already proves AzuraCast SSE works in production.
- The upgrade is adapter-internal: `PlayoutStatePort` does not change, so nothing above the port
  will notice the switch.

## Links

- docs/2 §7.3 (ingest), §6.3 (SSE channels); PD §6 (freshness); OndePlayer precedent (PD §2.2).
