/**
 * Pure time↔pixel mapping for one day column (docs/2 §8.4). A column's
 * height derives from the day's *actual* duration — a Europe/Paris day can
 * be 23 or 25 hours — so every mapping goes through real UTC instants,
 * never "h × 3600e3 from midnight".
 */

export const PX_PER_HOUR = 48;
export const SNAP_STEP_MIN = 15;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface DayGeometry {
  readonly startUtcMs: number;
  readonly endUtcMs: number;
  readonly pxPerHour: number;
  readonly heightPx: number;
}

export function dayGeometry(
  startUtc: Date,
  endUtc: Date,
  pxPerHour: number = PX_PER_HOUR,
): DayGeometry {
  const startUtcMs = startUtc.getTime();
  const endUtcMs = endUtc.getTime();
  return {
    startUtcMs,
    endUtcMs,
    pxPerHour,
    heightPx: ((endUtcMs - startUtcMs) / HOUR_MS) * pxPerHour,
  };
}

/** y (px from column top) of a UTC instant. Unclamped: callers clip cards themselves. */
export function instantToY(geo: DayGeometry, utcMs: number): number {
  return ((utcMs - geo.startUtcMs) / HOUR_MS) * geo.pxPerHour;
}

/** UTC instant at a column y, clamped inside the day window. */
export function yToInstant(geo: DayGeometry, y: number): number {
  const clamped = Math.min(Math.max(y, 0), geo.heightPx);
  return geo.startUtcMs + (clamped / geo.pxPerHour) * HOUR_MS;
}

export function durationMinToPx(geo: DayGeometry, minutes: number): number {
  return (minutes / 60) * geo.pxPerHour;
}

export function pxToDurationMin(geo: DayGeometry, px: number): number {
  return (px / geo.pxPerHour) * 60;
}

export function snapMinutes(minutes: number, step: number = SNAP_STEP_MIN): number {
  return Math.round(minutes / step) * step;
}

/**
 * Snap an instant to the wall 15-minute raster. Stepping elapsed time from
 * the real day start is wall-correct even across DST, because zone shifts
 * are whole hours — every step lands on wall :00/:15/:30/:45.
 */
export function snapInstant(
  geo: DayGeometry,
  utcMs: number,
  stepMin: number = SNAP_STEP_MIN,
): number {
  const stepMs = stepMin * MINUTE_MS;
  const snapped = Math.round((utcMs - geo.startUtcMs) / stepMs) * stepMs + geo.startUtcMs;
  return Math.min(Math.max(snapped, geo.startUtcMs), geo.endUtcMs);
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface LaneBox {
  lane: number;
  lanes: number;
}

/** Final positioned box for a card inside its day column. */
export interface CardBox {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
}

/**
 * Simple lane packing for overlapping cards: sort by start, give each item
 * the lowest free lane; everything in one overlap cluster shares the cluster
 * width. Returned array is index-aligned with the input.
 */
export function packLanes(items: readonly TimeRange[]): LaneBox[] {
  const boxes: LaneBox[] = items.map(() => ({ lane: 0, lanes: 1 }));
  const order = items
    .map((_, i) => i)
    .sort((a, b) => (items[a]?.startMs ?? 0) - (items[b]?.startMs ?? 0));

  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  const flush = (): void => {
    for (const idx of cluster) {
      const box = boxes[idx];
      if (box) box.lanes = Math.max(1, laneEnds.length);
    }
    cluster = [];
    laneEnds = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const idx of order) {
    const item = items[idx];
    if (!item) continue;
    if (cluster.length > 0 && item.startMs >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMs);
    } else {
      laneEnds[lane] = item.endMs;
    }
    const box = boxes[idx];
    if (box) box.lane = lane;
    cluster.push(idx);
    clusterEnd = Math.max(clusterEnd, item.endMs);
  }
  flush();
  return boxes;
}

/**
 * Free windows between occupied ranges — the phase-1 "derived rotation":
 * the gaps between scheduled objects, not AzuraCast objects (docs/2 §8.4).
 * Gaps shorter than `minGapMs` are real but not worth a ghost card.
 */
export function gapsBetween(
  occupied: readonly TimeRange[],
  windowStartMs: number,
  windowEndMs: number,
  minGapMs: number,
): TimeRange[] {
  const sorted = occupied
    .filter((r) => r.endMs > windowStartMs && r.startMs < windowEndMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs);

  const gaps: TimeRange[] = [];
  let cursor = windowStartMs;
  for (const range of sorted) {
    if (range.startMs - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: range.startMs });
    cursor = Math.max(cursor, range.endMs);
  }
  if (windowEndMs - cursor >= minGapMs) gaps.push({ startMs: cursor, endMs: windowEndMs });
  return gaps;
}
