# AzuraCast write-capability audit

> Reference for the implementation plan (§10 step 1 of the project description).
> **Date:** 2026-06-16 · **Instance:** AzuraCast 0.23.3, studio.ondezero.net
> **Scope:** writes performed **against `wz-test` (station id 5) only** — never `oz`.
> **Method:** created clearly-tagged throwaway objects (`OS-AUDIT-*`,
> `[ondestudio:audit]`), verified each operation, then deleted everything and
> confirmed the station returned to its exact baseline. No leftovers.

## Result: phase-1 write-back is viable

Every operation the phase-1 overlay needs succeeded with HTTP 200.

### Playlists — `POST/PUT/DELETE /api/station/{station}/playlist(s)`

| Operation | Verb / path | Result |
|---|---|---|
| Create | `POST /playlists` | 200 → returns full object with `id` |
| Read | `GET /playlist/{id}` | 200 |
| Update | `PUT /playlist/{id}` | 200 — rename, `description`, `schedule_items` all persisted |
| Delete | `DELETE /playlist/{id}` | 200 → subsequent GET 404 |

- Created with `{name, type, source, order, is_enabled}`; `is_enabled:false` keeps a
  new playlist inert (safe to stage before activation).
- **`description` is writable free text** → the §6 projected-object **tagging**
  mechanism (marker in description) is viable on playlists.

### Streamers / broadcaster accounts — `POST/PUT/DELETE /api/station/{station}/streamer(s)`

| Operation | Verb / path | Result |
|---|---|---|
| Create | `POST /streamers` | 200 → returns `id` |
| Update | `PUT /streamer/{id}` | 200 — `enforce_schedule` + `schedule_items` persisted |
| Delete | `DELETE /streamer/{id}` | 200 → subsequent GET 404 |

- Created with `{streamer_username, streamer_password, display_name, is_active,
  enforce_schedule, comments}`; `is_active:false` prevents the account from
  broadcasting while staged.
- **`comments` is writable free text** → tagging mechanism viable on streamers too.
- `enforce_schedule` is settable per account → confirms the §5.10 **main/test
  fan-out** (replicate the account to both stations, enforce only on main).

### Schedule items — the grid write-back core

Written as part of the parent playlist/streamer `PUT`, as an array of
`{start_time, end_time, days}`:

- `start_time` / `end_time` are **`HHMM` integers** (e.g. `1400` = 14:00).
- `days` is an array of weekday integers.
- Overnight ranges wrap (`end_time < start_time`), as seen in production `[MIXS]`
  (2200→0900). **DST behavior to confirm** in the plan.

This is what makes grid slots writable to AzuraCast in phase-1 increment 2.

## Not tested here (deliberately)

- **Now-playing metadata push** (live-meta-sync): not re-tested — it would touch the
  test stream, and the mechanism is **already proven in production** by OndePlayer's
  `live-meta-sync`. No risk to phase-1 feasibility.
- **Media write ops** (upload / move / delete files): not tested — a **phase-2**
  concern (§4.11), not part of the phase-1 overlay.

## Notes for the implementation plan

- **Endpoints accept the station shortcode** (`wz-test`) or numeric id in
  `/api/station/{station}`.
- A scheduled block in AzuraCast is exactly "an object (playlist or streamer) carrying
  `schedule_items`" — so the overlay's slots map cleanly onto these. The decided
  Upcoming path (OndePlayer reads OndeStudio's API, §6) means we are **not** obliged to
  keep generating announce-artifact playlists once write-back + the OndePlayer switch
  land.
- Before any **production** (`oz`) writes: provision the **dedicated API account**
  (§7) — the audit used the shared global-admin "OndeZero API account".
