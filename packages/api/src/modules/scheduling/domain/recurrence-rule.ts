import type { Recurrence } from "@ondestudio/shared";
import { DateTime } from "luxon";
import { DomainError } from "../../../kernel/domain-error";
import { err, ok, type Result } from "../../../kernel/result";

/** A concrete series time computed from the rule — the recurrence key (docs/2 §5.3). */
export interface ComputedOccurrence {
  originalStartsAtUtc: Date;
  endsAtUtc: Date;
}

const BYDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WALL_DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Recurrence, phase-1 subset: weekly (RFC-5545 `FREQ=WEEKLY;BYDAY=…`) or a
 * one-off wall datetime (docs/2 §5.3 — `rrule` stored for forward-compat,
 * only the weekly subset is emitted/parsed). All wall times are station-tz
 * (docs/2 §5.4): a 22:00 slot stays 22:00 across DST; Luxon absorbs the
 * offset changes when deriving UTC instants.
 */
export class RecurrenceRule {
  private constructor(readonly pattern: Recurrence) {}

  static from(pattern: Recurrence): Result<RecurrenceRule, DomainError> {
    if (pattern.type === "weekly") {
      const unique = [...new Set(pattern.weekdays)];
      if (unique.length === 0) return err(DomainError.validation("weekly rule needs weekdays"));
      if (unique.some((d) => d < 1 || d > 7)) {
        return err(DomainError.validation("weekdays are ISO 1 (Monday) … 7 (Sunday)"));
      }
      if (!WALL_TIME.test(pattern.time)) {
        return err(DomainError.validation(`invalid wall time: ${pattern.time}`));
      }
      return ok(new RecurrenceRule({ ...pattern, weekdays: unique.sort((a, b) => a - b) }));
    }
    if (!WALL_DATETIME.test(pattern.startsAtWall)) {
      return err(DomainError.validation(`invalid wall datetime: ${pattern.startsAtWall}`));
    }
    return ok(new RecurrenceRule(pattern));
  }

  /** DB round-trip: (`rrule`, `start_wall`) columns ↔ rule (docs/2 §5.2). */
  static fromDb(rrule: string | null, startWall: string): Result<RecurrenceRule, DomainError> {
    if (rrule === null) return RecurrenceRule.from({ type: "once", startsAtWall: startWall });
    const match = rrule.match(/^FREQ=WEEKLY;BYDAY=([A-Z,]+)$/);
    if (!match?.[1]) return err(DomainError.validation(`unsupported rrule: ${rrule}`));
    const weekdays: number[] = [];
    for (const code of match[1].split(",")) {
      const index = (BYDAY_CODES as readonly string[]).indexOf(code);
      if (index === -1) return err(DomainError.validation(`unsupported BYDAY code: ${code}`));
      weekdays.push(index + 1);
    }
    return RecurrenceRule.from({ type: "weekly", weekdays, time: startWall });
  }

  toDb(): { rrule: string | null; startWall: string } {
    if (this.pattern.type === "once") return { rrule: null, startWall: this.pattern.startsAtWall };
    const byday = this.pattern.weekdays.map((d) => BYDAY_CODES[d - 1]).join(",");
    return { rrule: `FREQ=WEEKLY;BYDAY=${byday}`, startWall: this.pattern.time };
  }

  /**
   * All series times whose [start, end) intersects the UTC window. Iterates
   * station-tz calendar days with a one-day margin so an occurrence that
   * starts before the window but runs into it (overnight shows) is included.
   */
  occurrencesBetween(
    durationMin: number,
    windowFromUtc: Date,
    windowToUtc: Date,
    zone: string,
  ): ComputedOccurrence[] {
    const results: ComputedOccurrence[] = [];
    const push = (start: DateTime): void => {
      const end = start.plus({ minutes: durationMin });
      if (start.toMillis() < windowToUtc.getTime() && end.toMillis() > windowFromUtc.getTime()) {
        results.push({
          originalStartsAtUtc: start.toUTC().toJSDate(),
          endsAtUtc: end.toUTC().toJSDate(),
        });
      }
    };

    if (this.pattern.type === "once") {
      // Nonexistent DST wall times are shifted forward by Luxon; ambiguous ones take the first offset.
      push(DateTime.fromISO(this.pattern.startsAtWall, { zone }));
      return results;
    }

    const [hourRaw, minuteRaw] = this.pattern.time.split(":");
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);
    let day = DateTime.fromJSDate(windowFromUtc, { zone }).startOf("day").minus({ days: 1 });
    const lastDay = DateTime.fromJSDate(windowToUtc, { zone }).startOf("day");
    while (day.toMillis() <= lastDay.toMillis()) {
      if (this.pattern.weekdays.includes(day.weekday)) {
        push(day.set({ hour, minute, second: 0, millisecond: 0 }));
      }
      day = day.plus({ days: 1 });
    }
    return results;
  }
}
