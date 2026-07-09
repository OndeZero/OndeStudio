import type { Recurrence } from "@ondestudio/shared";

/**
 * The editable shape of a slot's recurrence, shared by the create dialog and
 * the quick-edit popover so the two read identically (M1 UX note). Weekly and
 * one-off both carry a wall time; weekly carries ISO weekdays (1 = Mon … 7 =
 * Sun), one-off a station-day. Converters below keep it in sync with the
 * `Recurrence` contract.
 */
export type RecurrenceDraft =
  | { type: "weekly"; weekdays: number[]; time: string }
  | { type: "once"; dayIso: string; time: string };

/** ISO weekday labels, Monday-first (index 0 → weekday 1). */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const HHMM = /^\d{2}:\d{2}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Contract → editable draft (prefill the fields from an existing slot). */
export function recurrenceToDraft(recurrence: Recurrence): RecurrenceDraft {
  if (recurrence.type === "weekly") {
    return { type: "weekly", weekdays: [...recurrence.weekdays], time: recurrence.time };
  }
  const [dayIso, wall] = recurrence.startsAtWall.split("T");
  return { type: "once", dayIso: dayIso ?? "", time: (wall ?? "").slice(0, 5) };
}

/** Editable draft → contract, or null when the draft is not yet valid. */
export function draftToRecurrence(draft: RecurrenceDraft): Recurrence | null {
  if (!HHMM.test(draft.time)) return null;
  if (draft.type === "weekly") {
    if (draft.weekdays.length === 0) return null;
    return {
      type: "weekly",
      weekdays: [...draft.weekdays].sort((a, b) => a - b),
      time: draft.time,
    };
  }
  if (!ISO_DAY.test(draft.dayIso)) return null;
  return { type: "once", startsAtWall: `${draft.dayIso}T${draft.time}` };
}

/** True when a draft can be submitted — same rule the forms gate their buttons on. */
export function isRecurrenceValid(draft: RecurrenceDraft): boolean {
  return draftToRecurrence(draft) !== null;
}
