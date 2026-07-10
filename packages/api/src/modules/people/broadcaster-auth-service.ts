import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import type { BroadcasterRepo } from "./broadcaster-repo";

const SESSION_TTL_MS = 30 * 24 * 3_600_000;

/** Who a verified self-service session belongs to (never carries the hash). */
export interface BroadcasterIdentity {
  id: number;
  username: string;
  displayName: string;
  kind: "team" | "external";
}

export interface BroadcasterSession {
  identity: BroadcasterIdentity;
  sessionId: string;
  ttlMs: number;
}

/**
 * Self-service auth (PD §5.6): a broadcaster signs in with its Icecast
 * credentials — the streamer username + the OndeStudio-owned password. Sessions
 * are broadcaster-scoped and stored separately from team sessions, so an
 * external account can never reach a team surface whatever the cookie.
 */
export class BroadcasterAuthService {
  constructor(private readonly deps: { repo: BroadcasterRepo; clock: Clock; logger: Logger }) {}

  async login(
    username: string,
    password: string,
  ): Promise<Result<BroadcasterSession, DomainError>> {
    const invalid = DomainError.validation("unknown broadcaster or wrong password");
    const row = await this.deps.repo.findAuthByUsername(username.trim());
    if (!row) return err(invalid);
    if (!row.passwordHash) {
      // Adopted streamers keep an unreadable AzuraCast credential until a rotate.
      return err(DomainError.validation("no password set yet — ask the team to send you one"));
    }
    if (!(await Bun.password.verify(password, row.passwordHash))) return err(invalid);

    const now = this.deps.clock.now();
    const sessionId = randomToken();
    await this.deps.repo.createSession({
      id: sessionId,
      broadcasterId: row.id,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    });
    this.deps.logger.info("self-service login", { broadcasterId: row.id });
    return ok({
      identity: {
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        kind: row.kind,
      },
      sessionId,
      ttlMs: SESSION_TTL_MS,
    });
  }

  /** Cookie verification — the self-service middleware's backend. */
  async verifySession(sessionId: string): Promise<BroadcasterIdentity | null> {
    const session = await this.deps.repo.getSession(sessionId);
    if (!session) return null;
    const now = this.deps.clock.now();
    if (new Date(session.expiresAt).getTime() <= now.getTime()) {
      await this.deps.repo.deleteSession(sessionId);
      return null;
    }
    await this.deps.repo.touchSession(sessionId, now.toISOString());
    const row = await this.deps.repo.get(session.broadcasterId);
    if (!row) return null;
    return { id: row.id, username: row.username, displayName: row.displayName, kind: row.kind };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.repo.deleteSession(sessionId);
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
