# grid

The M1 week-grid prototype (docs/2 §8.3–8.4): a custom CSS-grid week component +
interact.js — no calendar library. Frame = negotiation state, inner fill = content
pipeline, badges = issue flags; mirror blocks and insert bands render AzuraCast's own
schedule read-only; rotation is the derived gaps.

This surface is gated on the team's **ergonomics validation** (the M1 exit bar); expect
it to move. Reviewed 2026-07-06 (multi-agent pass, confirmed findings fixed or listed).

## Known limits, deliberately left for the validation round

- **No undo toast yet** — docs/2 §7.5/§8.4 specify instant-apply *with an undo window*;
  today a mis-drop is corrected by dragging back (failure paths roll back
  automatically). Wire it together with the M3 debounced write-back, or earlier if the
  team asks.
- **No drop-cancel zone** — releasing a drag outside the grid still commits to the
  nearest column; ESC (desktop) is the only abort. Whether dropping outside should
  cancel is an ergonomics question for the validation.
- **Fall-back repeated hour (one hour, once a year)** — the wall-clock PATCH contract
  cannot distinguish the two 02:xx readings on the October DST day; the server resolves
  to the earlier one, the client displays the later. A drop inside that hour can land
  one real hour off. Inherent to wall-only times (docs/2 §7.8); revisit only if it ever
  matters in practice.
- **Native time inputs follow the browser locale** — a 12-hour display in en-US
  browsers; the grid itself renders 24-hour everywhere (PD §8.1).
- Gutter labels vs DST columns drift by one hour on the two transition days (the
  column's own hour lines are instant-true; the shared gutter is canonical 24h).
