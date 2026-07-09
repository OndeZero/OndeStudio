import type { Recurrence } from "@ondestudio/shared";
import { describe, expect, it } from "vitest";
import {
  draftToRecurrence,
  isRecurrenceValid,
  type RecurrenceDraft,
  recurrenceToDraft,
} from "./slot-recurrence";

describe("recurrenceToDraft", () => {
  it("keeps weekly weekdays and time", () => {
    expect(recurrenceToDraft({ type: "weekly", weekdays: [2, 5], time: "22:00" })).toEqual({
      type: "weekly",
      weekdays: [2, 5],
      time: "22:00",
    });
  });

  it("splits a one-off wall datetime into day + HH:mm", () => {
    expect(recurrenceToDraft({ type: "once", startsAtWall: "2026-07-10T21:00" })).toEqual({
      type: "once",
      dayIso: "2026-07-10",
      time: "21:00",
    });
  });
});

describe("draftToRecurrence", () => {
  it("sorts weekly weekdays and passes the time", () => {
    expect(draftToRecurrence({ type: "weekly", weekdays: [5, 2], time: "10:00" })).toEqual({
      type: "weekly",
      weekdays: [2, 5],
      time: "10:00",
    });
  });

  it("joins a one-off day + time into a wall datetime", () => {
    expect(draftToRecurrence({ type: "once", dayIso: "2026-07-10", time: "21:00" })).toEqual({
      type: "once",
      startsAtWall: "2026-07-10T21:00",
    });
  });

  it("rejects an empty weekly selection, a bad time, and a bad date", () => {
    expect(draftToRecurrence({ type: "weekly", weekdays: [], time: "10:00" })).toBeNull();
    expect(draftToRecurrence({ type: "weekly", weekdays: [1], time: "1000" })).toBeNull();
    expect(draftToRecurrence({ type: "once", dayIso: "10-07-2026", time: "21:00" })).toBeNull();
  });
});

describe("round-trip", () => {
  it("survives contract → draft → contract for both kinds", () => {
    const cases: Recurrence[] = [
      { type: "weekly", weekdays: [1, 3, 7], time: "08:30" },
      { type: "once", startsAtWall: "2026-12-01T00:15" },
    ];
    for (const original of cases) {
      expect(draftToRecurrence(recurrenceToDraft(original))).toEqual(original);
    }
  });
});

describe("isRecurrenceValid", () => {
  it("mirrors draftToRecurrence success", () => {
    const good: RecurrenceDraft = { type: "weekly", weekdays: [1], time: "12:00" };
    const bad: RecurrenceDraft = { type: "weekly", weekdays: [], time: "12:00" };
    expect(isRecurrenceValid(good)).toBe(true);
    expect(isRecurrenceValid(bad)).toBe(false);
  });
});
