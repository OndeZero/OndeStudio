/**
 * Wall-clock math in the station timezone built on Intl only — no date
 * library on the front, on purpose (bundle weight, docs/2 §8.6). All grid
 * positioning derives from *real day-start instants* because a Europe/Paris
 * day can last 23 or 25 hours (docs/2 §7.8): never compute "midnight + h ×
 * 3600s". Times display 24-hour, server-referenced (PD §8.1).
 */

const DAY_MS = 86_400_000;

/** Intl formatters are expensive to construct; one per zone is plenty. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // h23, not h12/h24: hours must render 00–23 (PD §8.1) and `Date.UTC`
      // below needs numeric fields without a dayPeriod.
      hourCycle: "h23",
    });
    zoneFormatters.set(zone, fmt);
  }
  return fmt;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading of a UTC instant in `zone`, via formatToParts. */
function wallPartsOf(utc: Date, zone: string): WallParts {
  const bag: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of zoneFormatter(zone).formatToParts(utc)) bag[part.type] = part.value;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

/** UTC offset of `zone` at `utc` in ms, positive east of Greenwich. */
export function zoneOffsetMs(utc: Date, zone: string): number {
  const p = wallPartsOf(utc, zone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // The formatter resolves to seconds; compare at second resolution too.
  return wallAsUtc - Math.floor(utc.getTime() / 1000) * 1000;
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "YYYY-MM-DDTHH:mm" wall time in `zone` → UTC instant. Two offset probes
 * converge for every unambiguous time. Around DST transitions the result is
 * still deterministic: a nonexistent spring-forward time lands one hour
 * later, an ambiguous autumn time resolves to the *later* (post-transition)
 * reading. The server (Luxon) may pick the earlier reading for the one
 * ambiguous hour per year — optimistic UI is then corrected by the response.
 */
export function wallToUtc(wall: string, zone: string): Date {
  const m = WALL_RE.exec(wall);
  if (!m) throw new Error(`not a wall datetime: ${wall}`);
  const asUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const probe = asUtc - zoneOffsetMs(new Date(asUtc), zone);
  return new Date(asUtc - zoneOffsetMs(new Date(probe), zone));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** UTC instant → "YYYY-MM-DDTHH:mm" wall datetime in `zone` (the PATCH move format). */
export function utcToWall(utc: Date, zone: string): string {
  const p = wallPartsOf(utc, zone);
  return `${String(p.year).padStart(4, "0")}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** 24-hour "HH:mm" reading of a UTC instant in `zone`. */
export function formatHm(utc: Date, zone: string): string {
  const p = wallPartsOf(utc, zone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** The calendar day ("YYYY-MM-DD") a UTC instant falls on in `zone`. */
export function isoDayOf(utc: Date, zone: string): string {
  const p = wallPartsOf(utc, zone);
  return `${String(p.year).padStart(4, "0")}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** The real first instant of a calendar day in `zone` — 23h/25h days included. */
export function dayStartUtc(isoDay: string, zone: string): Date {
  return wallToUtc(`${isoDay}T00:00`, zone);
}

function dayAsUtcMs(isoDay: string): number {
  const m = DAY_RE.exec(isoDay);
  if (!m) throw new Error(`not an ISO day: ${isoDay}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Calendar-day arithmetic on the label itself — immune to DST by construction. */
export function addDays(isoDay: string, days: number): string {
  return new Date(dayAsUtcMs(isoDay) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar day: 1 = Monday … 7 = Sunday (matches RecurrenceSchema). */
export function isoWeekdayOf(isoDay: string): number {
  return ((new Date(dayAsUtcMs(isoDay)).getUTCDay() + 6) % 7) + 1;
}

/** The Monday of the week containing `now`, as that week is lived in `zone` (PD §5.1). */
export function weekMondayOf(now: Date, zone: string): string {
  const today = isoDayOf(now, zone);
  return addDays(today, 1 - isoWeekdayOf(today));
}

// Label formatting works on the calendar day itself, so a UTC-pinned
// formatter is exact — no zone ambiguity for date-only values.
const dayLabelFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" });
const monthYearFmt = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Mon 6" — the day-column header. */
export function formatDayLabel(isoDay: string): string {
  return dayLabelFmt.format(new Date(dayAsUtcMs(isoDay)));
}

/** "Mon 6 – Sun 12 Jul 2026" (month shown on both sides when the week crosses one). */
export function formatWeekLabel(mondayIso: string): string {
  const sundayIso = addDays(mondayIso, 6);
  const monday = new Date(dayAsUtcMs(mondayIso));
  const sunday = new Date(dayAsUtcMs(sundayIso));
  const sameMonth = mondayIso.slice(0, 7) === sundayIso.slice(0, 7);
  const left = sameMonth
    ? dayLabelFmt.format(monday)
    : `${dayLabelFmt.format(monday)} ${monthFmt.format(monday)}`;
  return `${left} – ${dayLabelFmt.format(sunday)} ${monthYearFmt.format(sunday)}`;
}
