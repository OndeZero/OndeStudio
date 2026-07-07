# 0013 — Episode queue, phase-1 shape

- **Status:** accepted
- **Date:** 2026-07-07

## Context

The episode queue (PD §4.5) is the MVP piece that makes content flow: a file dropped in a
show's drop folder fills the nearest empty occurrence, its content state flips, and the
driver airs the right file — killing today's manual playlist juggling and stale Upcoming.
It was deferred out of M2; this ADR fixes the phase-1 shape so it can ship before the full
media/fingerprint layer.

## Decisions

1. **Episode identity = the AzuraCast file id + path**, not an audio fingerprint. The
   fingerprint (PD §4.11) is a hash of the audio stream, which needs **filesystem access**
   OndeStudio only has when deployed on `onde-zero` beside AzuraCast. From the current dev
   machine we have the files API only, so phase-1 keys episodes by `az_file_id`. The
   `media` table + fingerprints (identity that survives moves/renames) land when OndeStudio
   runs on the server; the `episode.az_file_id` column re-homes cleanly then.

2. **Intake = files appearing in the drop folder.** Upload is deferred (docs/2 §8.5);
   episodes "arrive" via SFTP / the AzuraCast UI. The queue is **derived by scanning** the
   show's drop folder through the MediaStore, ordered by file id (an arrival proxy),
   manually reorderable via `queue_order`.

3. **Single-file episodes only.** Ordered folder-episodes (docs/3 D1) are deferred — the
   common case is one file per episode.

4. **Fill = nearest empty upcoming occurrence** (Appendix C): queued (unconsumed) episodes
   fill the show's upcoming empty occurrences in time order — including the current week's
   if it hasn't aired. `occurrence.episode_id` records the binding; content state flips
   `empty → ready` (or `received`, awaiting review, when the show's `trust_auto_air` is
   off). An episode is "consumed" iff some occurrence references it.

5. **Fallback (per-show):** `discard` leaves the occurrence empty (rotation covers it);
   `replay_previous` binds the most recently aired episode's media without consuming a
   queued one.

6. **Deterministic driver media.** A projected show playlist carries **exactly** the
   current (nearest upcoming) occurrence's episode media, swapped as occurrences advance —
   so `setBlockMedia` becomes exact-membership (prune + add), not additive. Current
   membership is read from the station files list (`GET /files` carries each file's
   `playlists`), diffed against the desired set, and the minimum per-file PUTs applied; a
   short per-station cache lets one reconcile pass fetch the list once. A desired file that
   no longer exists upstream is skipped, not an error.

7. **Media is enforced, not drift-detected.** Schedule/name drift keeps its
   reconciliation-and-freeze workflow (RFC 0001); episode membership does **not** join it.
   Projected playlists are OS-owned content, so the driver simply re-asserts the queue's
   truth every reconcile (`setBlockMedia` is idempotent — zero upstream writes when already
   exact). This keeps `NormalizedBlock` — and therefore drift detection — unchanged, and
   means a manual episode swap in AzuraCast is corrected on the next pass rather than
   opening a reconciliation. The media assertion runs on every synced/updated/created
   projection so it also catches occurrence advance (which fires no grid event).

## Deferred (staged)

Fingerprint identity + the `media` table; folder-episodes; echo-slot inheritance;
drop-tool intake (push from wavezero-form); Upcoming metadata enrichment + revert-to-generic
(rides on M5's OndePlayer switch); the contribution pipeline.

## Consequences

The driver's `setBlockMedia` (a no-op until now) becomes real and must manage exact
playlist membership. Content states stop being purely manual — they auto-advance on fill,
which the grid and show page already render. Because media sits outside drift detection, a
hand edit of a projected playlist's songs in AzuraCast is silently reverted — acceptable
while these playlists are OS-owned; revisit if the team ever curates them by hand.
