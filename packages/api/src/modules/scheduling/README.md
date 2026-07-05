# scheduling

The grid's engine (docs/2 §3.2): shows, slots, occurrences, recurrence, states.
Owns the two state machines the whole product turns on (PD §4.4) and the sparse
materialization model (docs/2 §5.3).

## Model in one breath

A **slot** is a recurrence *definition* (weekly rule or one-off, wall-clock in the
station timezone). The grid **materializes occurrences on read**; an `occurrence`
row is persisted **only when it diverges** — moved, resized, state-changed, flagged —
keyed by `(slot_id, original_starts_at_utc)`, the RFC-5545-style recurrence key.
Occurrence identity in the API is `{slotId}_{originalEpochMs}`, stable whether or
not a row exists yet.

## Invariants

- **Soft boundaries are sacred** (PD §4.3): moves/resizes never fail on overlap.
  The grid *shows* conflicts; it never blocks them.
- **`aired` is time-driven** (PD §4.4): computed against the clock at read time,
  never stored by a human action.
- **Illegal state transitions are typed errors** (`illegal-transition` → 409), and
  the transition maps live in `shared` so the UI offers exactly what the domain
  accepts.
- **Wall-clock model** (docs/2 §5.4): slot times are station-tz wall clock; only
  materialization derives UTC instants (Luxon). Event timestamps are UTC.
- **Mirror is read-only and separable** (Increment 1, docs/2 §2.5): playout-system
  blocks come from `MirrorSchedulePort` (implemented by the playout module) and are
  served on their own endpoint, so the grid still works when the playout link is down.

## Phase-1 scope notes

- `echo` slots are a kind with no origin-binding yet — metadata sync with the origin
  episode arrives with the episode queue (M2).
- Shows are minimal identities (name + slug) until the show page lands (M2).
- Write-back to AzuraCast is M3; nothing here touches the playout system.

## Extension points

New occurrence operation → a method on `Occurrence` (domain rules) + a field on
`PatchOccurrenceInput` (shared) + a branch in `SchedulingService.patchOccurrence`.
New slot kind → extend `SLOT_KINDS` in shared, teach `SlotDefinition.plan` its
invariants and the grid renderer its look (docs/2 Appendix B).
