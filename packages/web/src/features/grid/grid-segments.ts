import type { TimeRange } from "./grid-geometry";

/**
 * Day-splitting for the week grid: an item spanning midnight renders one
 * segment in each day it touches (docs/2 §8.4), with continuation flags so
 * the card can show its cut edges. Pure — the store feeds it occurrences
 * and mirror blocks alike.
 */

export interface DayWindow {
  dayIso: string;
  startMs: number;
  endMs: number;
}

export interface DaySegment<T> {
  item: T;
  dayIso: string;
  /** Clipped to the day window. */
  startMs: number;
  endMs: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export function splitIntoDaySegments<T>(
  items: readonly T[],
  rangeOf: (item: T) => TimeRange,
  windows: readonly DayWindow[],
): Map<string, DaySegment<T>[]> {
  const byDay = new Map<string, DaySegment<T>[]>(windows.map((w) => [w.dayIso, []]));
  for (const item of items) {
    const range = rangeOf(item);
    for (const window of windows) {
      if (range.startMs >= window.endMs || range.endMs <= window.startMs) continue;
      byDay.get(window.dayIso)?.push({
        item,
        dayIso: window.dayIso,
        startMs: Math.max(range.startMs, window.startMs),
        endMs: Math.min(range.endMs, window.endMs),
        continuesBefore: range.startMs < window.startMs,
        continuesAfter: range.endMs > window.endMs,
      });
    }
  }
  for (const segments of byDay.values()) segments.sort((a, b) => a.startMs - b.startMs);
  return byDay;
}
