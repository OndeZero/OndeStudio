import type {
  ContentState,
  FallbackPolicy,
  IssueFlag,
  NegotiationState,
  ReplayFlag,
} from "@ondestudio/shared";
import { and, eq, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { unwrap } from "../../kernel/result";
import type { Db } from "../../platform/db";
import { ContentPipeline } from "./domain/content-pipeline";
import { Negotiation } from "./domain/negotiation";
import { encodeOccurrenceId, Occurrence, type OccurrenceKey } from "./domain/occurrence";
import { RecurrenceRule } from "./domain/recurrence-rule";
import { SlotDefinition, type SlotProps } from "./domain/slot-definition";
import { episodes, occurrences, shows, slots } from "./schema";

/** A slot with the display context the grid needs (bound show's name). */
export interface SlotRecord {
  slot: SlotDefinition;
  showName: string | null;
}

/** The show-hub row (docs/2 §5.2): identity + per-show settings (PD §4.5, §5.4). */
export interface ShowRecord {
  id: number;
  name: string;
  slug: string;
  fallbackPolicy: FallbackPolicy;
  trustAutoAir: boolean;
  replayFlag: ReplayFlag;
  contributorTz: string | null;
  dropFolderPath: string | null;
}

/** Settings + name; a name change refreshes the slug (docs/3 D3). */
export type UpdateShowFields = Partial<Omit<ShowRecord, "id" | "slug">>;

export interface SchedulingRepo {
  listSlots(stationId: string): Promise<SlotRecord[]>;
  getSlot(id: number): Promise<SlotRecord | null>;
  insertSlot(props: Omit<SlotProps, "id">): Promise<SlotRecord>;
  updateSlotFields(
    id: number,
    fields: {
      title?: string | null;
      rule?: RecurrenceRule;
      durationMin?: number;
      negotiationDefault?: NegotiationState;
    },
  ): Promise<void>;
  deleteSlot(id: number): Promise<void>;
  findOrCreateShow(name: string): Promise<{ id: number; name: string }>;
  getShow(id: number): Promise<ShowRecord | null>;
  findShowBySlug(slug: string): Promise<ShowRecord | null>;
  listShows(): Promise<ShowRecord[]>;
  /** Partial settings update; a name change refreshes the slug (docs/3 D3). */
  updateShow(id: number, fields: UpdateShowFields): Promise<void>;
  slotsForShow(showId: number): Promise<SlotRecord[]>;
  /** Shows with a drop folder configured — content's ownership badge source (PD §5.4). */
  dropFolders(): Promise<{ showId: number; name: string; path: string }[]>;
  /** Exception rows whose current OR original time intersects the window (docs/2 §5.3). */
  findOccurrenceRows(stationId: string, fromUtc: Date, toUtc: Date): Promise<Occurrence[]>;
  getOccurrenceRow(key: OccurrenceKey): Promise<Occurrence | null>;
  upsertOccurrence(occurrence: Occurrence): Promise<void>;
  // Episode queue (PD §4.5, ADR-0013)
  listEpisodes(showId: number): Promise<EpisodeRow[]>;
  getEpisode(id: number): Promise<EpisodeRow | null>;
  episodeTitles(ids: number[]): Promise<Map<number, string>>;
  insertEpisode(episode: Omit<EpisodeRow, "id">): Promise<void>;
  deleteEpisodesExcept(showId: number, keepAzFileIds: string[]): Promise<void>;
  setEpisodeOrder(showId: number, orderedIds: number[]): Promise<void>;
  occurrenceRowsForShow(showId: number): Promise<Occurrence[]>;
}

export class DrizzleSchedulingRepo implements SchedulingRepo {
  constructor(private readonly db: Db) {}

  async listSlots(stationId: string): Promise<SlotRecord[]> {
    const rows = await this.db
      .select({ slot: slots, showName: shows.name })
      .from(slots)
      .leftJoin(shows, eq(slots.showId, shows.id))
      .where(eq(slots.stationId, stationId));
    return rows.map((row) => toSlotRecord(row.slot, row.showName));
  }

  async getSlot(id: number): Promise<SlotRecord | null> {
    const rows = await this.db
      .select({ slot: slots, showName: shows.name })
      .from(slots)
      .leftJoin(shows, eq(slots.showId, shows.id))
      .where(eq(slots.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toSlotRecord(row.slot, row.showName) : null;
  }

  async insertSlot(props: Omit<SlotProps, "id">): Promise<SlotRecord> {
    const now = new Date().toISOString();
    const db = props.rule.toDb();
    const inserted = await this.db
      .insert(slots)
      .values({
        stationId: props.stationId,
        showId: props.showId,
        kind: props.kind,
        title: props.title,
        rrule: db.rrule,
        startWall: db.startWall,
        durationMin: props.durationMin,
        negotiationDefault: props.negotiationDefault,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("slot insert returned no row");
    const record = await this.getSlot(row.id);
    if (!record) throw new Error("slot vanished after insert");
    return record;
  }

  async updateSlotFields(
    id: number,
    fields: {
      title?: string | null;
      rule?: RecurrenceRule;
      durationMin?: number;
      negotiationDefault?: NegotiationState;
    },
  ): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (fields.title !== undefined) set.title = fields.title;
    if (fields.durationMin !== undefined) set.durationMin = fields.durationMin;
    if (fields.negotiationDefault !== undefined) set.negotiationDefault = fields.negotiationDefault;
    if (fields.rule !== undefined) {
      const db = fields.rule.toDb();
      set.rrule = db.rrule;
      set.startWall = db.startWall;
    }
    await this.db.update(slots).set(set).where(eq(slots.id, id));
  }

  async deleteSlot(id: number): Promise<void> {
    // Exception rows cascade (schema): a deleted series takes its exceptions with it.
    await this.db.delete(occurrences).where(eq(occurrences.slotId, id));
    await this.db.delete(slots).where(eq(slots.id, id));
  }

  async findOrCreateShow(name: string): Promise<{ id: number; name: string }> {
    const slug = slugify(name);
    const existing = await this.db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
    const found = existing[0];
    if (found) return { id: found.id, name: found.name };
    const now = new Date().toISOString();
    const inserted = await this.db
      .insert(shows)
      .values({ name, slug, createdAt: now, updatedAt: now })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("show insert returned no row");
    return { id: row.id, name: row.name };
  }

  async getShow(id: number): Promise<ShowRecord | null> {
    const rows = await this.db.select().from(shows).where(eq(shows.id, id)).limit(1);
    const row = rows[0];
    return row ? toShowRecord(row) : null;
  }

  async findShowBySlug(slug: string): Promise<ShowRecord | null> {
    const rows = await this.db.select().from(shows).where(eq(shows.slug, slug)).limit(1);
    const row = rows[0];
    return row ? toShowRecord(row) : null;
  }

  async listShows(): Promise<ShowRecord[]> {
    const rows = await this.db.select().from(shows);
    return rows.map(toShowRecord);
  }

  async updateShow(id: number, fields: UpdateShowFields): Promise<void> {
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (fields.name !== undefined) {
      set.name = fields.name;
      set.slug = slugify(fields.name);
    }
    if (fields.fallbackPolicy !== undefined) set.fallbackPolicy = fields.fallbackPolicy;
    if (fields.trustAutoAir !== undefined) set.trustAutoAir = fields.trustAutoAir;
    if (fields.replayFlag !== undefined) set.replayFlag = fields.replayFlag;
    if (fields.contributorTz !== undefined) set.contributorTz = fields.contributorTz;
    if (fields.dropFolderPath !== undefined) set.dropFolderPath = fields.dropFolderPath;
    await this.db.update(shows).set(set).where(eq(shows.id, id));
  }

  async slotsForShow(showId: number): Promise<SlotRecord[]> {
    const rows = await this.db
      .select({ slot: slots, showName: shows.name })
      .from(slots)
      .innerJoin(shows, eq(slots.showId, shows.id))
      .where(eq(slots.showId, showId));
    return rows.map((row) => toSlotRecord(row.slot, row.showName));
  }

  async dropFolders(): Promise<{ showId: number; name: string; path: string }[]> {
    const rows = await this.db.select().from(shows).where(isNotNull(shows.dropFolderPath));
    return rows.flatMap((row) =>
      row.dropFolderPath === null
        ? []
        : [{ showId: row.id, name: row.name, path: row.dropFolderPath }],
    );
  }

  async findOccurrenceRows(stationId: string, fromUtc: Date, toUtc: Date): Promise<Occurrence[]> {
    const from = fromUtc.toISOString();
    const to = toUtc.toISOString();
    const rows = await this.db
      .select({ occurrence: occurrences })
      .from(occurrences)
      .innerJoin(slots, eq(occurrences.slotId, slots.id))
      .where(
        and(
          eq(slots.stationId, stationId),
          or(
            and(gte(occurrences.startsAtUtc, from), lt(occurrences.startsAtUtc, to)),
            and(
              gte(occurrences.originalStartsAtUtc, from),
              lt(occurrences.originalStartsAtUtc, to),
            ),
          ),
        ),
      );
    return rows.map((row) => toOccurrence(row.occurrence));
  }

  async getOccurrenceRow(key: OccurrenceKey): Promise<Occurrence | null> {
    const rows = await this.db
      .select()
      .from(occurrences)
      .where(
        and(
          eq(occurrences.slotId, key.slotId),
          eq(occurrences.originalStartsAtUtc, key.originalStartsAtUtc.toISOString()),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toOccurrence(row) : null;
  }

  async upsertOccurrence(occurrence: Occurrence): Promise<void> {
    const row = {
      slotId: occurrence.key.slotId,
      originalStartsAtUtc: occurrence.key.originalStartsAtUtc.toISOString(),
      startsAtUtc: occurrence.startsAtUtc.toISOString(),
      endsAtUtc: occurrence.endsAtUtc.toISOString(),
      negotiationState: occurrence.negotiation.value,
      contentState: occurrence.content.value,
      episodeId: occurrence.episodeId,
      issueFlags: JSON.stringify(occurrence.issueFlags),
      contentDurationMin: occurrence.contentDurationMin,
    };
    await this.db
      .insert(occurrences)
      .values(row)
      .onConflictDoUpdate({
        target: [occurrences.slotId, occurrences.originalStartsAtUtc],
        set: row,
      });
  }

  // ── Episode queue (PD §4.5, ADR-0013) ──────────────────────────────────────

  async listEpisodes(showId: number): Promise<EpisodeRow[]> {
    const rows = await this.db
      .select()
      .from(episodes)
      .where(eq(episodes.showId, showId))
      .orderBy(episodes.queueOrder, episodes.id);
    return rows.map(toEpisode);
  }

  async getEpisode(id: number): Promise<EpisodeRow | null> {
    const row = (await this.db.select().from(episodes).where(eq(episodes.id, id)).limit(1))[0];
    return row ? toEpisode(row) : null;
  }

  async episodeTitles(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: episodes.id, title: episodes.title })
      .from(episodes)
      .where(inArray(episodes.id, ids));
    return new Map(rows.map((row) => [row.id, row.title]));
  }

  async insertEpisode(episode: {
    showId: number;
    azFileId: string;
    path: string;
    title: string;
    artist: string | null;
    durationSec: number | null;
    queueOrder: number;
    arrivedAt: string;
  }): Promise<void> {
    await this.db.insert(episodes).values(episode).onConflictDoNothing();
  }

  async deleteEpisodesExcept(showId: number, keepAzFileIds: string[]): Promise<void> {
    const existing = await this.db.select().from(episodes).where(eq(episodes.showId, showId));
    const keep = new Set(keepAzFileIds);
    for (const row of existing) {
      if (!keep.has(row.azFileId)) await this.db.delete(episodes).where(eq(episodes.id, row.id));
    }
  }

  async setEpisodeOrder(showId: number, orderedIds: number[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (id === undefined) continue;
      await this.db
        .update(episodes)
        .set({ queueOrder: i })
        .where(and(eq(episodes.id, id), eq(episodes.showId, showId)));
    }
  }

  /** Persisted occurrence rows for a show's slots (the exceptions carrying episode/state). */
  async occurrenceRowsForShow(showId: number): Promise<Occurrence[]> {
    const rows = await this.db
      .select({ occurrence: occurrences })
      .from(occurrences)
      .innerJoin(slots, eq(occurrences.slotId, slots.id))
      .where(eq(slots.showId, showId));
    return rows.map((row) => toOccurrence(row.occurrence));
  }
}

type SlotRow = typeof slots.$inferSelect;
type ShowRow = typeof shows.$inferSelect;
type OccurrenceRow = typeof occurrences.$inferSelect;

/** The row IS the record minus timestamps — enum/boolean narrowing comes from the schema. */
function toShowRecord(row: ShowRow): ShowRecord {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...record } = row;
  return record;
}

function toSlotRecord(row: SlotRow, showName: string | null): SlotRecord {
  return {
    slot: SlotDefinition.rehydrate({
      id: row.id,
      stationId: row.stationId,
      kind: row.kind,
      title: row.title,
      showId: row.showId,
      // A parse failure here means corrupt data — exceptional, not an expected Result.
      rule: unwrap(RecurrenceRule.fromDb(row.rrule, row.startWall)),
      durationMin: row.durationMin,
      negotiationDefault: row.negotiationDefault as NegotiationState,
    }),
    showName,
  };
}

function toOccurrence(row: OccurrenceRow): Occurrence {
  return Occurrence.rehydrate({
    key: { slotId: row.slotId, originalStartsAtUtc: new Date(row.originalStartsAtUtc) },
    startsAtUtc: new Date(row.startsAtUtc),
    endsAtUtc: new Date(row.endsAtUtc),
    negotiation: Negotiation.of(row.negotiationState as NegotiationState),
    content: ContentPipeline.of(row.contentState as ContentState),
    issueFlags: JSON.parse(row.issueFlags) as IssueFlag[],
    contentDurationMin: row.contentDurationMin,
    episodeId: row.episodeId,
  });
}

export interface EpisodeRow {
  id: number;
  showId: number;
  azFileId: string;
  path: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  queueOrder: number;
  arrivedAt: string;
}
function toEpisode(row: typeof episodes.$inferSelect): EpisodeRow {
  return {
    id: row.id,
    showId: row.showId,
    azFileId: row.azFileId,
    path: row.path,
    title: row.title,
    artist: row.artist,
    durationSec: row.durationSec,
    queueOrder: row.queueOrder,
    arrivedAt: row.arrivedAt,
  };
}

export const occurrenceRowId = encodeOccurrenceId;

/** docs/3 D3 naming: lowercase, ASCII-folded, hyphen-slugged. */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  // Non-Latin names (Greek, Arabic, CJK…) can fold to nothing; the UNIQUE slug
  // must never collapse to "" (docs/3 D3 edge case, flagged in its §8.3).
  let hash = 5381;
  for (const ch of name) hash = ((hash * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return `show-${hash.toString(36)}`;
}
