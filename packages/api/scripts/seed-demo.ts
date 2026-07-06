/**
 * Seeds a demo week on station `oz` (OndeStudio DB only — AzuraCast untouched)
 * so the M1 grid can be evaluated with every state combination visible at a
 * glance (PD §8.1): negotiation frames, content fills, flags, under/over-runs,
 * a moved occurrence, ghosts.
 *
 *   bun packages/api/scripts/seed-demo.ts [--fresh]
 *
 * --fresh wipes existing scheduling rows first (shows, slots, occurrences).
 */
import type { Recurrence } from "@ondestudio/shared";
import { DateTime } from "luxon";
import { unwrap } from "../src/kernel/result";
import { StationId } from "../src/kernel/station-id";
import { DrizzlePeopleRepo } from "../src/modules/people/wiring";
import { Occurrence, RecurrenceRule, SlotDefinition } from "../src/modules/scheduling";
import { occurrences, shows, slots } from "../src/modules/scheduling/schema";
import { DrizzleSchedulingRepo } from "../src/modules/scheduling/wiring";
import { loadConfig } from "../src/platform/config";
import { createDb } from "../src/platform/db";
import { createLogger } from "../src/platform/logger";

const ZONE = "Europe/Paris";
const config = loadConfig();
const logger = createLogger("info");
const db = createDb(config.dbPath, logger);
const repo = new DrizzleSchedulingRepo(db);
const oz = unwrap(StationId.parse("oz"));

if (process.argv.includes("--fresh")) {
  await db.delete(occurrences);
  await db.delete(slots);
  await db.delete(shows);
  logger.info("scheduling tables wiped");
} else {
  const existing = await repo.listSlots(oz.value);
  if (existing.length > 0) {
    logger.error("slots already exist — run with --fresh to reseed");
    process.exit(1);
  }
}

const monday = DateTime.now().setZone(ZONE).startOf("week");
const wall = (dayOffset: number, time: string): string =>
  `${monday.plus({ days: dayOffset }).toISODate()}T${time}`;

interface SeedSlot {
  kind: "show" | "series" | "echo" | "live" | "rotation";
  title?: string;
  showName?: string;
  recurrence: Recurrence;
  durationMin: number;
  bornValidated: boolean;
  /** Applied to each materialized occurrence over the seeded fortnight. */
  tweak?: (occ: Occurrence) => Occurrence;
}

const weekly = (weekday: number, time: string): Recurrence => ({
  type: "weekly",
  weekdays: [weekday],
  time,
});

const content = (occ: Occurrence, state: "received" | "ready"): Occurrence => {
  const received = unwrap(occ.transitionContentTo("received"));
  return state === "received" ? received : unwrap(received.transitionContentTo("ready"));
};

const SEEDS: SeedSlot[] = [
  {
    kind: "show",
    showName: "Minuit Décousu",
    recurrence: weekly(2, "22:00"),
    durationMin: 120,
    bornValidated: true,
    tweak: (occ) => content(occ, "ready").withContentDuration(118),
  },
  {
    kind: "show",
    showName: "Habibi Funk Hour",
    recurrence: weekly(4, "18:00"),
    durationMin: 60,
    bornValidated: true,
    // Episode arrived short and without description: hatched fill + metadata flag + visible gap.
    tweak: (occ) => content(occ, "received").withContentDuration(45).withIssueFlags(["metadata"]),
  },
  {
    kind: "show",
    showName: "Eurodance",
    recurrence: weekly(6, "12:00"),
    durationMin: 60,
    bornValidated: true,
    // Ready but overlong (75 in 60): over-run indicator; also moved 90 min later this week.
    tweak: (occ) =>
      content(unwrap(occ.moveTo(shiftWall(occ, 90))), "ready").withContentDuration(75),
  },
  {
    kind: "series",
    showName: "Flotilla Tapes",
    recurrence: weekly(7, "16:00"),
    durationMin: 60,
    bornValidated: true,
    tweak: (occ) => content(occ, "ready").withContentDuration(58),
  },
  {
    kind: "echo",
    title: "Minuit Décousu (echo)",
    showName: "Minuit Décousu",
    recurrence: weekly(6, "15:00"),
    durationMin: 120,
    bornValidated: true,
  },
  {
    kind: "live",
    title: "Maigre — studio live",
    recurrence: weekly(5, "21:00"),
    durationMin: 120,
    bornValidated: true,
  },
  {
    kind: "live",
    title: "OndePi — Grrrnd Zero concert",
    recurrence: weekly(6, "20:00"),
    durationMin: 240,
    bornValidated: false,
    tweak: (occ) => unwrap(occ.transitionNegotiationTo("dealing")),
  },
  {
    kind: "live",
    title: "DJ Nova (external, to confirm)",
    recurrence: weekly(3, "19:00"),
    durationMin: 90,
    bornValidated: false,
  },
  {
    kind: "show",
    title: "Radio X takeover",
    showName: "Radio X",
    recurrence: weekly(4, "10:00"),
    durationMin: 60,
    bornValidated: false,
    // A ghost: never got to yes (PD §4.4).
    tweak: (occ) => unwrap(occ.transitionNegotiationTo("declined")),
  },
  {
    kind: "live",
    title: "Acid Bal (cancelled)",
    recurrence: weekly(7, "21:00"),
    durationMin: 120,
    bornValidated: true,
    // Was announced, then called off — distinct from declined (PD §4.4).
    tweak: (occ) => unwrap(occ.transitionNegotiationTo("cancelled")),
  },
  {
    kind: "show",
    title: "Interview spéciale (one-off)",
    showName: "Interview spéciale",
    recurrence: { type: "once", startsAtWall: wall(4, "14:00") },
    durationMin: 45,
    bornValidated: false,
    tweak: (occ) => unwrap(occ.transitionNegotiationTo("dealing")),
  },
];

function shiftWall(occ: Occurrence, minutes: number): Date {
  return new Date(occ.startsAtUtc.getTime() + minutes * 60_000);
}

let occurrenceCount = 0;
for (const seed of SEEDS) {
  const rule = unwrap(RecurrenceRule.from(seed.recurrence));
  const showId = seed.showName ? (await repo.findOrCreateShow(seed.showName)).id : null;
  const planned = unwrap(
    SlotDefinition.plan({
      stationId: oz.value,
      kind: seed.kind,
      title: seed.title ?? null,
      showId,
      rule,
      durationMin: seed.durationMin,
      bornValidated: seed.bornValidated,
    }),
  );
  const record = await repo.insertSlot(planned);

  if (seed.tweak) {
    // Two weeks of tweaked occurrences, so the demo is rich whichever week is open.
    const windowFrom = monday.toUTC().toJSDate();
    const windowTo = monday.plus({ days: 14 }).toUTC().toJSDate();
    for (const candidate of record.slot.materialize(windowFrom, windowTo, ZONE)) {
      const base: Occurrence = Occurrence.fromCandidate(
        { slotId: candidate.slotId, originalStartsAtUtc: candidate.originalStartsAtUtc },
        candidate.endsAtUtc,
        record.slot.negotiationDefault,
      );
      await repo.upsertOccurrence(seed.tweak(base));
      occurrenceCount++;
    }
  }
}

// Local demo login so the seeded studio is usable without the setup-link flow.
// DEV ONLY — real teammates come from import-users.ts + issue-setup-link.ts.
const people = new DrizzlePeopleRepo(db);
await people.createLocalUser({
  email: "demo@ondestudio.local",
  displayName: "Demo",
  role: "team",
  passwordHash: await Bun.password.hash("ondestudio-demo"),
});

logger.info("demo week seeded", {
  station: oz.value,
  weekOf: monday.toISODate(),
  slots: SEEDS.length,
  tweakedOccurrences: occurrenceCount,
  login: "demo@ondestudio.local / ondestudio-demo",
});
