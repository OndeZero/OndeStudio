# playout

The AzuraCast integration module (docs/2 §3.2): ports, adapters and — from M3 —
projection/drift. Everything OndeStudio knows about playout reality enters here;
everything it decides leaves for AzuraCast from here.

## Phase-1 scope

- **Read** (now): `PlayoutStatePort` backed by the AzuraCast now-playing API, polled per
  station (ADR-0011); `GET /stations/{station}/now` serves it live-first, degrading to the
  last-known cached state (`stale: true`) when the link is down.
- **Write-back** (M3): `PlayoutPort` — schedule blocks, media assignment, now-playing meta —
  plus the `projection` table and the drift engine (docs/2 §7.4–7.5).

## Invariants

- **Air is never in our hot path** (docs/2 invariant 1). This module drives and mirrors
  AzuraCast's management API; it does not host or relay the stream. Failure here degrades
  the overlay, never the broadcast.
- **AzuraCast shapes never escape `adapters/`** (invariant 2). The rest of the codebase
  speaks `NowSnapshot` / domain objects; upstream payload types live in
  `adapters/azuracast/types.ts` only.
- **`ac-owned` data is read-only** (docs/2 §3.7): play history and live state are ingested
  and cached, never written.
- **Never write to the production station `oz`** until the per-feature adoption step says
  so; test writes target `wz-test` (docs/2 §7.7). No write code exists yet — keep it that
  way until M3 lands with the dedicated API account.

## Shape

Standard module layout (docs/2 §3.2): `domain/` (pure), `ports.ts` (the phase-2 seam),
`adapters/azuracast/` (the only place AzuraCast exists), `service.ts`, `repo.ts`,
`schema.ts`, `routes.ts`, `events.ts`, `index.ts` (the public surface), plus
`wiring.ts` — concrete adapters/repos for the composition root only, kept off
`index.ts` so no other module can couple to AzuraCast through a "legal" import.

## Extension points

- New upstream capability → extend the port interface, implement in the adapter, emit a
  domain event if others must react.
- Phase-2 native playout → implement the same ports in a new `adapters/` folder and swap
  the wiring in `app.ts` (docs/2 Appendix B).
