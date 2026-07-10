import { describe, expect, test } from "bun:test";
import { createDb } from "../../platform/db";
import { silentLogger } from "../../platform/logger";
import { BroadcasterAuthService } from "./broadcaster-auth-service";
import { DrizzleBroadcasterRepo } from "./broadcaster-repo";

const clock = { now: () => new Date("2026-07-10T12:00:00.000Z") };

async function build() {
  const repo = new DrizzleBroadcasterRepo(createDb(":memory:", silentLogger));
  const auth = new BroadcasterAuthService({ repo, clock, logger: silentLogger });
  await repo.insert({
    username: "dj-nova",
    displayName: "DJ Nova",
    kind: "external",
    commentMeta: null,
    enforceSchedule: true,
    replayFlag: "not_specified",
    passwordHash: await Bun.password.hash("secret-pw"),
  });
  await repo.insert({
    username: "adopted",
    displayName: "Adopted",
    kind: "external",
    commentMeta: null,
    enforceSchedule: false,
    replayFlag: "not_specified",
    passwordHash: null, // adopted streamer — credential unreadable until a rotate
  });
  return { repo, auth };
}

describe("BroadcasterAuthService (self-service, PD §5.6)", () => {
  test("valid Icecast credentials start a session; verify returns the identity", async () => {
    const { auth } = await build();
    const login = await auth.login("dj-nova", "secret-pw");
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.value.identity).toMatchObject({
      username: "dj-nova",
      displayName: "DJ Nova",
      kind: "external",
    });
    const who = await auth.verifySession(login.value.sessionId);
    expect(who?.username).toBe("dj-nova");
  });

  test("wrong password and unknown username both fail", async () => {
    const { auth } = await build();
    expect((await auth.login("dj-nova", "nope")).ok).toBe(false);
    expect((await auth.login("ghost", "whatever")).ok).toBe(false);
  });

  test("an adopted broadcaster with no password is told to ask the team", async () => {
    const { auth } = await build();
    const login = await auth.login("adopted", "anything");
    expect(login.ok).toBe(false);
    if (login.ok) return;
    expect(login.error.message).toContain("no password set");
  });

  test("logout ends the session", async () => {
    const { auth } = await build();
    const login = await auth.login("dj-nova", "secret-pw");
    if (!login.ok) throw new Error("login failed");
    await auth.logout(login.value.sessionId);
    expect(await auth.verifySession(login.value.sessionId)).toBeNull();
  });

  test("an expired session verifies to null", async () => {
    const repo = new DrizzleBroadcasterRepo(createDb(":memory:", silentLogger));
    let t = new Date("2026-07-10T12:00:00.000Z");
    const auth = new BroadcasterAuthService({
      repo,
      clock: { now: () => t },
      logger: silentLogger,
    });
    await repo.insert({
      username: "dj",
      displayName: "DJ",
      kind: "external",
      commentMeta: null,
      enforceSchedule: false,
      replayFlag: "not_specified",
      passwordHash: await Bun.password.hash("pw"),
    });
    const login = await auth.login("dj", "pw");
    if (!login.ok) throw new Error("login failed");
    t = new Date(t.getTime() + 31 * 24 * 3_600_000); // past the 30-day TTL
    expect(await auth.verifySession(login.value.sessionId)).toBeNull();
  });
});
