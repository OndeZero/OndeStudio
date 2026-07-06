import { eq } from "drizzle-orm";
import type { Db } from "../../platform/db";
import { broadcasters } from "./schema";

export interface BroadcasterRow {
  id: number;
  username: string;
  displayName: string;
  kind: "team" | "external";
  commentMeta: string | null;
  enforceSchedule: boolean;
  replayFlag: "yes" | "no" | "not_specified";
  hasPassword: boolean;
  mainStreamerRef: string | null;
  testStreamerRef: string | null;
}

export interface BroadcasterFields {
  displayName?: string;
  kind?: "team" | "external";
  commentMeta?: string | null;
  enforceSchedule?: boolean;
  replayFlag?: "yes" | "no" | "not_specified";
  passwordHash?: string;
  mainStreamerRef?: string | null;
  testStreamerRef?: string | null;
}

export interface BroadcasterRepo {
  list(): Promise<BroadcasterRow[]>;
  get(id: number): Promise<BroadcasterRow | null>;
  findByUsername(username: string): Promise<BroadcasterRow | null>;
  insert(row: {
    username: string;
    displayName: string;
    kind: "team" | "external";
    commentMeta: string | null;
    enforceSchedule: boolean;
    replayFlag: "yes" | "no" | "not_specified";
    passwordHash: string | null;
    mainStreamerRef?: string | null;
    testStreamerRef?: string | null;
  }): Promise<BroadcasterRow>;
  update(id: number, fields: BroadcasterFields): Promise<void>;
  remove(id: number): Promise<void>;
}

export class DrizzleBroadcasterRepo implements BroadcasterRepo {
  constructor(private readonly db: Db) {}

  async list(): Promise<BroadcasterRow[]> {
    return (await this.db.select().from(broadcasters)).map(toRow);
  }

  async get(id: number): Promise<BroadcasterRow | null> {
    const row = (
      await this.db.select().from(broadcasters).where(eq(broadcasters.id, id)).limit(1)
    )[0];
    return row ? toRow(row) : null;
  }

  async findByUsername(username: string): Promise<BroadcasterRow | null> {
    const row = (
      await this.db.select().from(broadcasters).where(eq(broadcasters.username, username)).limit(1)
    )[0];
    return row ? toRow(row) : null;
  }

  async insert(row: Parameters<BroadcasterRepo["insert"]>[0]): Promise<BroadcasterRow> {
    const now = new Date().toISOString();
    const inserted = await this.db
      .insert(broadcasters)
      .values({ ...row, createdAt: now, updatedAt: now })
      .returning();
    const created = inserted[0];
    if (!created) throw new Error("broadcaster insert returned no row");
    return toRow(created);
  }

  async update(id: number, fields: BroadcasterFields): Promise<void> {
    await this.db
      .update(broadcasters)
      .set({ ...fields, updatedAt: new Date().toISOString() })
      .where(eq(broadcasters.id, id));
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(broadcasters).where(eq(broadcasters.id, id));
  }
}

type DbRow = typeof broadcasters.$inferSelect;

function toRow(row: DbRow): BroadcasterRow {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    kind: row.kind,
    commentMeta: row.commentMeta,
    enforceSchedule: row.enforceSchedule,
    replayFlag: row.replayFlag,
    hasPassword: row.passwordHash !== null,
    mainStreamerRef: row.mainStreamerRef,
    testStreamerRef: row.testStreamerRef,
  };
}
