import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import type { UserAccount } from "./domain/user-account";
import type { AccountDirectoryPort } from "./ports";
import type { PeopleRepo } from "./repo";

const SESSION_TTL_MS = 30 * 24 * 3_600_000;
/** Rolling refresh, but only when meaningfully stale — no write per request. */
const SESSION_TOUCH_AFTER_MS = 24 * 3_600_000;
const SETUP_TOKEN_TTL_MS = 7 * 24 * 3_600_000;

export interface AuthenticatedUser {
  user: UserAccount;
  sessionId: string;
}

/**
 * Use-cases around identity (docs/2 §12). Passwords are argon2id via
 * Bun.password; session ids are 256-bit random values — the signed cookie
 * only ever carries the id.
 */
export class PeopleService {
  constructor(
    private readonly deps: {
      repo: PeopleRepo;
      directory: AccountDirectoryPort;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async login(email: string, password: string): Promise<Result<AuthenticatedUser, DomainError>> {
    const user = await this.deps.repo.findUserByEmail(email);
    if (!user) return err(DomainError.validation("unknown email or wrong password"));
    if (!user.hasPassword) {
      // Small-team pragmatism (PD §8.1): telling a teammate they need their
      // setup link beats a deliberately opaque error. Enumeration is a
      // non-threat on a 6-person studio.
      return err(DomainError.validation("no password set for this account — use your setup link"));
    }
    const hash = await this.deps.repo.getPasswordHash(user.id);
    if (!hash || !(await Bun.password.verify(password, hash))) {
      return err(DomainError.validation("unknown email or wrong password"));
    }
    this.deps.logger.info("login", { userId: user.id });
    return ok(await this.openSession(user));
  }

  /** Also used right after a completed setup, so the new password logs the user straight in. */
  async startSession(userId: number): Promise<Result<AuthenticatedUser, DomainError>> {
    const user = await this.deps.repo.getUser(userId);
    if (!user) return err(DomainError.notFound("user"));
    return ok(await this.openSession(user));
  }

  private async openSession(user: UserAccount): Promise<AuthenticatedUser> {
    const now = this.deps.clock.now();
    const sessionId = randomToken();
    await this.deps.repo.createSession({
      id: sessionId,
      userId: user.id,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });
    // Opportunistic hygiene — no cron needed for a 6-person store.
    await this.deps.repo.deleteExpiredSessions(now);
    return { user, sessionId };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.repo.deleteSession(sessionId);
  }

  /** Session-cookie verification — the auth middleware's backend. */
  async verifySession(sessionId: string): Promise<UserAccount | null> {
    const session = await this.deps.repo.getSession(sessionId);
    if (!session) return null;
    const now = this.deps.clock.now();
    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.deps.repo.deleteSession(sessionId);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > SESSION_TOUCH_AFTER_MS) {
      await this.deps.repo.touchSession(sessionId, now, new Date(now.getTime() + SESSION_TTL_MS));
    }
    return this.deps.repo.getUser(session.userId);
  }

  /** Admin-issued one-time setup link (AzuraCast passwords are unreadable, docs/2 §12). */
  async issueSetupToken(email: string): Promise<Result<string, DomainError>> {
    const user = await this.deps.repo.findUserByEmail(email);
    if (!user) return err(DomainError.notFound(`user ${email}`));
    const token = randomToken();
    await this.deps.repo.setSetupToken(
      user.id,
      token,
      new Date(this.deps.clock.now().getTime() + SETUP_TOKEN_TTL_MS),
    );
    return ok(token);
  }

  async completeSetup(token: string, password: string): Promise<Result<UserAccount, DomainError>> {
    const found = await this.deps.repo.findUserBySetupToken(token);
    if (!found) return err(DomainError.notFound("setup token"));
    if (found.expiresAt.getTime() <= this.deps.clock.now().getTime()) {
      return err(DomainError.validation("setup token expired — ask for a fresh link"));
    }
    const hash = await Bun.password.hash(password);
    await this.deps.repo.completeSetup(found.user.id, hash);
    this.deps.logger.info("setup completed", { userId: found.user.id });
    return ok(found.user);
  }

  /** Seed/refresh users from the playout system's directory (docs/2 §7.6) — read-only upstream. */
  async importAccounts(): Promise<Result<number, DomainError>> {
    const accounts = await this.deps.directory.fetchAccounts();
    if (!accounts.ok) return accounts;
    for (const seed of accounts.value) {
      if (!seed.email) continue;
      await this.deps.repo.upsertSeededUser(seed);
    }
    this.deps.logger.info("accounts imported", { count: accounts.value.length });
    return ok(accounts.value.length);
  }

  async listUsers(): Promise<UserAccount[]> {
    return this.deps.repo.listUsers();
  }
}

/** 256-bit URL-safe random token. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
