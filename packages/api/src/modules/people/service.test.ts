import { beforeEach, describe, expect, test } from "bun:test";
import { ok } from "../../kernel/result";
import { silentLogger } from "../../platform/logger";
import { UserAccount } from "./domain/user-account";
import type { AccountDirectoryPort } from "./ports";
import type { PeopleRepo, SessionRecord } from "./repo";
import { PeopleService } from "./service";

/** In-memory PeopleRepo — the service contract without SQLite. */
class MemoryPeopleRepo implements PeopleRepo {
  users = new Map<
    number,
    {
      id: number;
      azAccountRef: string | null;
      email: string;
      displayName: string;
      role: "team" | "external";
      passwordHash: string | null;
      setupToken: string | null;
      setupTokenExpiresAt: string | null;
    }
  >();
  sessions = new Map<string, SessionRecord>();
  private nextId = 1;

  private account(row: NonNullable<ReturnType<MemoryPeopleRepo["users"]["get"]>>): UserAccount {
    return UserAccount.rehydrate({ ...row, hasPassword: row.passwordHash !== null });
  }
  async getUser(id: number) {
    const row = this.users.get(id);
    return row ? this.account(row) : null;
  }
  async findUserByEmail(email: string) {
    const row = [...this.users.values()].find((u) => u.email === email.trim().toLowerCase());
    return row ? this.account(row) : null;
  }
  async listUsers() {
    return [...this.users.values()].map((row) => this.account(row));
  }
  async getPasswordHash(userId: number) {
    return this.users.get(userId)?.passwordHash ?? null;
  }
  async upsertSeededUser(seed: { ref: string; email: string; displayName: string }) {
    const existing = [...this.users.values()].find((u) => u.azAccountRef === seed.ref);
    if (existing) {
      existing.email = seed.email.toLowerCase();
      existing.displayName = seed.displayName;
      return;
    }
    const id = this.nextId++;
    this.users.set(id, {
      id,
      azAccountRef: seed.ref,
      email: seed.email.toLowerCase(),
      displayName: seed.displayName,
      role: "team",
      passwordHash: null,
      setupToken: null,
      setupTokenExpiresAt: null,
    });
  }
  async createLocalUser(user: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: "team" | "external";
  }) {
    const id = this.nextId++;
    this.users.set(id, {
      id,
      azAccountRef: null,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      role: user.role,
      passwordHash: user.passwordHash,
      setupToken: null,
      setupTokenExpiresAt: null,
    });
    const row = this.users.get(id);
    if (!row) throw new Error("unreachable");
    return this.account(row);
  }
  async setSetupToken(userId: number, token: string, expiresAt: Date) {
    const row = this.users.get(userId);
    if (row) {
      row.setupToken = token;
      row.setupTokenExpiresAt = expiresAt.toISOString();
    }
  }
  async findUserBySetupToken(token: string) {
    const row = [...this.users.values()].find((u) => u.setupToken === token);
    if (!row?.setupTokenExpiresAt) return null;
    return { user: this.account(row), expiresAt: new Date(row.setupTokenExpiresAt) };
  }
  async completeSetup(userId: number, passwordHash: string) {
    const row = this.users.get(userId);
    if (row) {
      row.passwordHash = passwordHash;
      row.setupToken = null;
      row.setupTokenExpiresAt = null;
    }
  }
  async createSession(session: SessionRecord) {
    this.sessions.set(session.id, session);
  }
  async getSession(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async touchSession(id: string, lastSeenAt: Date, expiresAt: Date) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, lastSeenAt, expiresAt });
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async deleteExpiredSessions(now: Date) {
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
  }
}

const directory: AccountDirectoryPort = {
  fetchAccounts: () =>
    Promise.resolve(
      ok([
        { ref: "7", email: "Maigre@WaveZero.World", displayName: "Maigre" },
        { ref: "9", email: "polly@wavezero.world", displayName: "polly@wavezero.world" },
      ]),
    ),
};

let repo: MemoryPeopleRepo;
let service: PeopleService;
let now: Date;

beforeEach(() => {
  repo = new MemoryPeopleRepo();
  now = new Date("2026-07-06T10:00:00Z");
  service = new PeopleService({
    repo,
    directory,
    clock: { now: () => now },
    logger: silentLogger,
  });
});

describe("PeopleService auth", () => {
  test("login: unknown email and wrong password fail; the no-password case says so", async () => {
    expect((await service.login("nobody@x.y", "pw")).ok).toBe(false);

    await repo.upsertSeededUser({ ref: "1", email: "a@b.c", displayName: "A" });
    const noPassword = await service.login("a@b.c", "pw");
    expect(noPassword.ok).toBe(false);
    if (!noPassword.ok) expect(noPassword.error.message).toContain("setup link");

    await repo.createLocalUser({
      email: "b@b.c",
      displayName: "B",
      role: "team",
      passwordHash: await Bun.password.hash("right-password"),
    });
    expect((await service.login("b@b.c", "wrong-password")).ok).toBe(false);
  });

  test("login → session verifies, expires, and is touched only when stale", async () => {
    await repo.createLocalUser({
      email: "b@b.c",
      displayName: "B",
      role: "team",
      passwordHash: await Bun.password.hash("right-password"),
    });
    const login = await service.login("B@b.c ", "right-password");
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const verified = await service.verifySession(login.value.sessionId);
    expect(verified?.email).toBe("b@b.c");

    // Two days later the session is touched (rolling expiry)…
    now = new Date("2026-07-08T10:00:00Z");
    await service.verifySession(login.value.sessionId);
    const touched = repo.sessions.get(login.value.sessionId);
    expect(touched?.lastSeenAt.toISOString()).toBe(now.toISOString());

    // …and 31 days of silence end it.
    now = new Date("2026-08-08T11:00:00Z");
    expect(await service.verifySession(login.value.sessionId)).toBeNull();
    expect(repo.sessions.has(login.value.sessionId)).toBe(false);
  });

  test("setup-link flow: issue → complete sets the password and starts working", async () => {
    await repo.upsertSeededUser({ ref: "1", email: "a@b.c", displayName: "A" });
    const token = await service.issueSetupToken("a@b.c");
    expect(token.ok).toBe(true);
    if (!token.ok) return;

    const done = await service.completeSetup(token.value, "long-enough-password");
    expect(done.ok).toBe(true);
    expect((await service.login("a@b.c", "long-enough-password")).ok).toBe(true);
    // One-time: the token is gone.
    expect((await service.completeSetup(token.value, "another-password")).ok).toBe(false);
  });

  test("expired setup tokens are refused", async () => {
    await repo.upsertSeededUser({ ref: "1", email: "a@b.c", displayName: "A" });
    const token = await service.issueSetupToken("a@b.c");
    if (!token.ok) return;
    now = new Date("2026-07-20T10:00:00Z"); // past the 7-day TTL
    const result = await service.completeSetup(token.value, "long-enough-password");
    expect(result.ok).toBe(false);
  });

  test("importAccounts seeds and refreshes without touching local passwords", async () => {
    await service.importAccounts();
    const maigre = await service.listUsers();
    expect(maigre.map((u) => u.email)).toContain("maigre@wavezero.world");

    // Local password set, then a re-import refreshes identity only.
    const user = await repo.findUserByEmail("maigre@wavezero.world");
    if (!user) throw new Error("missing user");
    await repo.completeSetup(user.id, await Bun.password.hash("kept-password"));
    await service.importAccounts();
    expect(await repo.getPasswordHash(user.id)).not.toBeNull();
  });
});
