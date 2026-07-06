# RFC 0001 — M3 Driver: write-back, projection, drift & reconciliation

- **Status:** accepted (build 2026-07-07)
- **Milestone:** docs/2 §11 M3 (Increment 2). Exit bar: **decisions reach AzuraCast.**
- **Supersedes open questions:** docs/2 §14.11 (folder-linked playlists), the §7.5 apply model
  made concrete, §14.5 DST-on-write.

## Problem

OndeStudio is a mirror (M1/M2): the grid reads AzuraCast and overlays OndeStudio state, but
AzuraCast still performs every write. M3 turns the mirror into a **driver** — a validated slot
in OndeStudio produces and maintains a real, tagged, correctly-scheduled object in AzuraCast,
without ever fighting a manual edit or a live emergency fix (PD §6).

## Constraints

- **wz-test only** (docs/2 §7.7): writes are gated by `AZURACAST_WRITE_STATIONS`, enforced
  twice (composition root + adapter). `oz` joins after the dedicated API account + adoption.
- **Air is never in our hot path** (invariant 1): the driver drives the *management* API; a
  flaky/down AzuraCast degrades the overlay, never the stream.
- **Never silently overwrite a manual edit; never fight an emergency fix** (PD §6).
- **Apply instantly with an undo window** (docs/2 §7.5): OS state changes immediately; the
  AzuraCast push is debounced, so an undo cancels the write before it leaves.

## Design

### What projects, and to what

| Slot kind | Projects to | Notes |
|---|---|---|
| `show` / `series` / `echo` | a **tagged playlist** + `schedule_items` (+ episode media when known) | M3 core |
| `live` | the bound broadcaster's **streamer** `schedule_items` | staged — needs `slot.broadcaster_id` |
| `rotation` | nothing | phase-1 rotation is the derived gaps; AzuraCast's own rotation runs untouched |

**Projection rule:** a slot projects when it is **weekly** and its `negotiationDefault` is
`validated` (a team's own show is born validated; PD §4.4). Un-validating, deleting, or making
it non-weekly retracts the projection. One-off and per-occurrence exceptions do **not** map to
`schedule_items` (recurrence-level only) — they remain OS-truth on the grid; documented gap.

**Projected playlists are OS-created** (`type: default`, tagged `[ondestudio:slot:<id>]` in
`description`), so they carry **no folder auto-fill** — this resolves docs/2 §14.11 for
projected objects: OndeStudio owns membership fully; deterministic episode selection is a
`PUT /file/{id} {playlists}` we control. Adopting existing folder-linked playlists into
projection stays deferred.

### schedule_items mapping (DST — §14.5 resolved)

A weekly slot → one `schedule_item`: `start_time = HHMM(wall start)`, `end_time =
HHMM(wall start + duration)`, `days = ISO weekdays`. `end <= start` wraps past midnight.
**No DST math on write:** `schedule_items` are DST-naive local-time, and AzuraCast applies
them in the station tz — a 22:00 wall slot is `2200` year-round. (The mirror read already
inverts exactly this.)

### The projection table (docs/2 §5.2/§3.7)

`projection(id, os_object_type, os_object_id, station_id, az_kind, az_id, tag_marker,
last_pushed_json, last_seen_json, last_synced_at)` — one row per projected slot. `last_pushed`
is what OndeStudio pushed; `last_seen` is the last AzuraCast snapshot the driver observed.
Their divergence is drift.

### The reconcile loop (the heart)

One loop per write station, run **debounced after `scheduling.grid-changed`** (the undo window)
**and periodically** (≤30s, §6 freshness). Ordered so a manual AzuraCast edit always wins over
a stale re-push:

1. **Observe** — fetch AzuraCast playlists; match tagged ones to projection rows by marker.
2. **Drift-detect** — for each projection row: if its AzuraCast object changed since
   `last_seen` and differs from `last_pushed`, a human edited it → open a **reconciliation**
   item and mark the row `drifted` (excluded from step 4 until resolved). A deleted-in-AzuraCast
   object is also a reconciliation item. Refresh `last_seen`.
3. **(no auto-absorb in M3)** — every drift goes to the one-click inbox; the resolve action
   either **re-pushes** OS state or **pulls** AzuraCast's version into the OS slot. Auto-absorbing
   unambiguous diffs (enable/disable, time) is a documented follow-on.
4. **Push desired state** — for each projectable slot with no open reconciliation and whose
   AzuraCast object equals `last_seen` (no pending manual edit): create the playlist if absent,
   or update it if the computed payload differs from `last_pushed`; assign episode media when a
   ref is known. Record `last_pushed`/`last_seen`.
5. **Retract orphans** — projection rows whose slot is no longer projectable → delete the
   AzuraCast object + the row.

**Undo** falls out of steps 4 + the debounce: an undo reverts the OS slot within the window, so
the debounced reconcile reads the reverted desired state and pushes nothing net. The web undo
toast is the affordance that makes the revert one click.

### now-playing meta push (capability, staged wiring)

`pushNowPlayingMeta` lands on the port + adapter (slot-aware: a live session matched to the
overlapping slot pushes that slot's metadata). It is **built and unit-tested but not
auto-fired against live streams** here: retiring OndePlayer's `live-meta-sync` must disable it
in the *same* change (docs/2 §7.1 — two writers would fight), and OndePlayer runs on the server
(unreachable from this dev machine). Handoff documented; the capability is gated behind an
explicit flag.

## Scope boundaries (honest)

- **In:** show/series/echo weekly-slot projection; projection table; the reconcile/drift loop;
  reconciliation inbox (API + web); the undo toast; now-playing push capability; live wz-test
  verification with tagged cleanup.
- **Out / staged:** live-slot→streamer projection (needs `slot.broadcaster_id`); one-off &
  per-occurrence-exception projection; auto-absorb of unambiguous drift; episode-queue auto-fill
  (media assignment fires only when a media ref already exists); OndePlayer live-meta-sync
  retirement (server-side handoff); `oz` writes (§7.7).

## Consequences

- The `projection` table + reconcile loop are the phase-2 seam made real: the same loop drives
  native playout in phase 3 by swapping the port implementation.
- Three phase-1 exit-bar items now exist (grid, board, broadcaster mgmt); M3 adds the fourth
  (write-back). M5 (OndePlayer reads OS `schedule`/`now`) is what makes the Upcoming path whole.
