import { eq, lt } from "drizzle-orm";
import type { Db } from "../../platform/db";
import { UserAccount } from "./domain/user-account";
import { userSessions, users } from "./schema";

export interface SessionRecord {
  id: string;
  userId: number;
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface PeopleRepo {
  getUser(id: number): Promise<UserAccount | null>;
  findUserByEmail(email: string): Promise<UserAccount | null>;
  listUsers(): Promise<UserAccount[]>;
  getPasswordHash(userId: number): Promise<string | null>;
  /** Seed/refresh from the upstream directory; never touches local passwords. */
  upsertSeededUser(seed: { ref: string; email: string; displayName: string }): Promise<void>;
  createLocalUser(user: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: "team" | "external";
  }): Promise<UserAccount>;
  setSetupToken(userId: number, token: string, expiresAt: Date): Promise<void>;
  findUserBySetupToken(token: string): Promise<{ user: UserAccount; expiresAt: Date } | null>;
  completeSetup(userId: number, passwordHash: string): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  touchSession(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<void>;
}

export class DrizzlePeopleRepo implements PeopleRepo {
  constructor(private readonly db: Db) {}

  async getUser(id: number): Promise<UserAccount | null> {
    const row = (await this.db.select().from(users).where(eq(users.id, id)).limit(1))[0];
    return row ? toAccount(row) : null;
  }

  async findUserByEmail(email: string): Promise<UserAccount | null> {
    const normalized = email.trim().toLowerCase();
    const row = (await this.db.select().from(users).where(eq(users.email, normalized)).limit(1))[0];
    return row ? toAccount(row) : null;
  }

  async listUsers(): Promise<UserAccount[]> {
    return (await this.db.select().from(users)).map(toAccount);
  }

  async getPasswordHash(userId: number): Promise<string | null> {
    const row = (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    return row?.passwordHash ?? null;
  }

  async upsertSeededUser(seed: { ref: string; email: string; displayName: string }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(users)
      .values({
        azAccountRef: seed.ref,
        email: seed.email.trim().toLowerCase(),
        displayName: seed.displayName,
        role: "team",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.azAccountRef,
        // Refresh identity fields only — local password/setup state is ours.
        set: {
          email: seed.email.trim().toLowerCase(),
          displayName: seed.displayName,
          updatedAt: now,
        },
      });
  }

  async createLocalUser(user: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: "team" | "external";
  }): Promise<UserAccount> {
    const now = new Date().toISOString();
    const inserted = await this.db
      .insert(users)
      .values({
        email: user.email.trim().toLowerCase(),
        displayName: user.displayName,
        role: user.role,
        passwordHash: user.passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: { displayName: user.displayName, passwordHash: user.passwordHash, updatedAt: now },
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("user insert returned no row");
    return toAccount(row);
  }

  async setSetupToken(userId: number, token: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(users)
      .set({
        setupToken: token,
        setupTokenExpiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));
  }

  async findUserBySetupToken(
    token: string,
  ): Promise<{ user: UserAccount; expiresAt: Date } | null> {
    const row = (await this.db.select().from(users).where(eq(users.setupToken, token)).limit(1))[0];
    if (!row || !row.setupTokenExpiresAt) return null;
    return { user: toAccount(row), expiresAt: new Date(row.setupTokenExpiresAt) };
  }

  async completeSetup(userId: number, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({
        passwordHash,
        setupToken: null,
        setupTokenExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));
  }

  async createSession(session: SessionRecord): Promise<void> {
    await this.db.insert(userSessions).values({
      id: session.id,
      userId: session.userId,
      createdAt: session.lastSeenAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    });
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    const row = (
      await this.db.select().from(userSessions).where(eq(userSessions.id, id)).limit(1)
    )[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      lastSeenAt: new Date(row.lastSeenAt),
      expiresAt: new Date(row.expiresAt),
    };
  }

  async touchSession(id: string, lastSeenAt: Date, expiresAt: Date): Promise<void> {
    await this.db
      .update(userSessions)
      .set({ lastSeenAt: lastSeenAt.toISOString(), expiresAt: expiresAt.toISOString() })
      .where(eq(userSessions.id, id));
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.delete(userSessions).where(eq(userSessions.id, id));
  }

  async deleteExpiredSessions(now: Date): Promise<void> {
    await this.db.delete(userSessions).where(lt(userSessions.expiresAt, now.toISOString()));
  }
}

type UserRow = typeof users.$inferSelect;

function toAccount(row: UserRow): UserAccount {
  return UserAccount.rehydrate({
    id: row.id,
    azAccountRef: row.azAccountRef,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    hasPassword: row.passwordHash !== null,
  });
}
