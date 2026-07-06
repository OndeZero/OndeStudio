# playout

The AzuraCast integration module (docs/2 §3.2): ports, adapters and — from M3 —
projection/drift. Everything OndeStudio knows about playout reality enters here;
everything it decides leaves for AzuraCast from here.

## Phase-1 scope

- **Read**: `PlayoutStatePort` backed by the AzuraCast now-playing API, polled per station
  (ADR-0011); `GET /stations/{station}/now` serves it live-first, degrading to the
  last-known cached state (`stale: true`) when the link is down. `MirrorSchedulePort` and
  `MediaStorePort` (M1/M2) read AzuraCast's own schedule/files read-only.
- **Write-back** (M3, RFC 0001): `PlayoutWritePort` + the `PlayoutDriver` reconcile loop +
  the `projection`/`reconciliation` tables. A validated weekly show/series/echo slot is
  maintained in AzuraCast as a tagged playlist with `schedule_items`; the driver detects a
  manual AzuraCast edit as drift and queues it (never fights an emergency fix, PD §6).
  **Live-verified on wz-test** (create → project → edit → drift → resolve → retract →
  baseline). Writes reach only `AZURACAST_WRITE_STATIONS` (default `wz-test`), enforced by
  the composition root AND the adapter (docs/2 §7.7 — `oz` blocked until the dedicated API
  account + adoption).

## The driver (M3) at a glance

`driver.ts` runs one reconcile loop per write station, debounced after a grid change (the
undo window, §7.5) and periodically (≤30s drift sweep). Ordered so a manual edit always
wins: **observe → drift-detect (freeze + queue) → push desired (only synced) → retract
orphans**. `last_pushed` vs `last_seen` in the `projection` row is the drift signal;
`readScheduleBlock` after every push keeps `last_seen` truthful so there is no false drift.
See RFC 0001 for the full model and the staged-out scope.

## Now-playing meta push — handoff (NOT built here, on purpose)

Slot-aware now-playing meta push (retire OndePlayer's `live-meta-sync`, docs/2 §7.1, §5.6)
is **deferred with intent**, not stubbed — building speculative machinery to an unverified
endpoint would violate invariant 6. It is blocked on three server-side facts this dev
machine cannot reach:

1. **The exact push endpoint.** OndePlayer's `live-meta-sync` "pushes corrected metadata
   back through the API" (docs/2 §2.2) — confirm the precise AzuraCast call by reading
   `/opt/OndePlayer` on `onde-zero` before implementing.
2. **OndePlayer coordination.** Its sync must be **disabled in the same change** — two
   writers on the same now-playing meta would fight (docs/2 §7.1). That is an OndePlayer
   edit + deploy, not an OndeStudio-only change.
3. **A live source to match.** Slot-aware matching needs live `session` ingest and
   `live` slots to be projectable (which needs `slot.broadcaster_id`, itself staged). None
   exist yet.

When those land: add `pushNowPlayingMeta` to `PlayoutWritePort` + the adapter, a slot-match
service (session → overlapping validated live slot → its metadata), and disable OndePlayer's
sync in the same PR. Until then `now` is read-only and OndePlayer keeps its sync.

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
  so (docs/2 §7.7): `oz` joins `AZURACAST_WRITE_STATIONS` only after the dedicated API
  account exists and the team adopts. Both the composition root and the write adapters
  enforce this — defense in depth.

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
