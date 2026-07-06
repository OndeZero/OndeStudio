import { beforeAll, describe, expect, test } from "bun:test";
import {
  CardSchema,
  CardsResponseSchema,
  CommentSchema,
  CommentsResponseSchema,
  NotificationsResponseSchema,
} from "@ondestudio/shared";
import { serializeSigned } from "hono/utils/cookie";
import { systemClock } from "../../kernel/clock";
import { EventBus } from "../../kernel/event-bus";
import { ok } from "../../kernel/result";
import { createAuthMiddleware, SESSION_COOKIE } from "../../platform/auth";
import { createDb } from "../../platform/db";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import type { DirectoryUser, UserDirectoryPort } from "./ports";
import { DrizzleCollaborationRepo } from "./repo";
import { createCollaborationRoutes } from "./routes";
import { CollaborationService } from "./service";

/**
 * Integration proof at the HTTP boundary: real routes → service → domain →
 * repo → SQLite (in-memory, real migrations). The three ports are fake; auth
 * is the real middleware with a stub verify mapping two fixed sessions to two
 * users — the people suite proves real sessions.
 */
const SECRET = "test-secret-test-secret-test-secret!";
const ALICE = { id: 1, displayName: "Alice", email: "alice@wz.test", role: "team" as const };
const BOB = { id: 2, displayName: "Bob", email: "bob@wz.test", role: "team" as const };
const DIRECTORY = new Map<number, DirectoryUser>([
  [1, { id: 1, displayName: "Alice" }],
  [2, { id: 2, displayName: "Bob" }],
]);

const users: UserDirectoryPort = {
  getUsers: (ids) => {
    const found = new Map<number, DirectoryUser>();
    for (const id of ids) {
      const user = DIRECTORY.get(id);
      if (user) found.set(id, user);
    }
    return Promise.resolve(found);
  },
  allUserIds: () => Promise.resolve([...DIRECTORY.keys()]),
};

function buildApp() {
  const repo = new DrizzleCollaborationRepo(createDb(":memory:", silentLogger));
  const bus = new EventBus(() => {});
  const changed: number[] = [];
  bus.on("collaboration.card-changed", (event) => changed.push(event.cardId));
  const service = new CollaborationService({
    repo,
    anchors: {
      resolveLabel: (anchor) =>
        Promise.resolve(anchor.type === "show" ? `Show ${anchor.id}` : null),
    },
    promotion: {
      createShow: (name) => Promise.resolve(ok({ id: 7, name })),
      // Station-scoped (ports.ts): slot 42 exists — on oz only.
      slotExists: (slotId, station) => Promise.resolve(slotId === 42 && station === "oz"),
    },
    users,
    bus,
    clock: systemClock,
    logger: silentLogger,
  });
  const app = createApiApp(silentLogger);
  app.use(
    "*",
    createAuthMiddleware({
      cookieSecret: SECRET,
      publicPaths: [],
      verify: (sessionId) =>
        Promise.resolve(sessionId === "alice" ? ALICE : sessionId === "bob" ? BOB : null),
    }),
  );
  app.route("/", createCollaborationRoutes(service));
  return { app, changed };
}

const { app, changed } = buildApp();
let alice = "";
let bob = "";

const request = (cookie: string, path: string, method = "GET", body?: unknown) =>
  app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function board(cookie: string, query = "") {
  const response = await request(cookie, `/stations/oz/cards${query}`);
  expect(response.status).toBe(200);
  return CardsResponseSchema.parse(await response.json()).cards;
}

async function inbox(cookie: string) {
  const response = await request(cookie, "/notifications");
  expect(response.status).toBe(200);
  return NotificationsResponseSchema.parse(await response.json());
}

describe("collaboration over HTTP", () => {
  let cardId = 0;

  beforeAll(async () => {
    alice = (await serializeSigned(SESSION_COOKIE, "alice", SECRET)).split(";")[0] ?? "";
    bob = (await serializeSigned(SESSION_COOKIE, "bob", SECRET)).split(";")[0] ?? "";
  });

  test("the board is team-only: 401 without a session", async () => {
    expect((await app.request("/stations/oz/cards")).status).toBe(401);
    expect((await app.request("/notifications")).status).toBe(401);
  });

  test("create with assignee: Bob is notified and sees unread; Alice does not", async () => {
    const response = await request(alice, "/stations/oz/cards", "POST", {
      intent: "task",
      subject: "Bring back the night mix",
      body: "It vanished from Tuesdays.",
      assigneeIds: [2],
    });
    expect(response.status).toBe(201);
    const card = CardSchema.parse(await response.json());
    cardId = card.id;
    expect(card.status).toBe("open");
    expect(card.assignees.map((a) => a.displayName)).toEqual(["Bob"]);
    expect(card.unread).toBe(false); // the creator has plainly seen their own card
    expect(changed).toContain(cardId);

    expect((await board(bob))[0]?.unread).toBe(true); // Bob never looked

    const bobInbox = await inbox(bob);
    expect(bobInbox.unreadCount).toBe(1);
    expect(bobInbox.notifications[0]?.kind).toBe("assigned");
    expect(bobInbox.notifications[0]?.message).toBe(
      "«Bring back the night mix» — assigned to you by Alice",
    );
    expect(bobInbox.notifications[0]?.cardId).toBe(cardId);
    expect(bobInbox.notifications[0]?.station).toBe("oz"); // deep-links carry the station
    expect((await inbox(alice)).unreadCount).toBe(0);
  });

  test("an assignee unknown to the directory is refused", async () => {
    const response = await request(alice, "/stations/oz/cards", "POST", {
      intent: "task",
      subject: "Ghost",
      assigneeIds: [99],
    });
    expect(response.status).toBe(422);
  });

  test("Bob's reply notifies Alice; her card shows unread + snippet; his does not", async () => {
    const long =
      "We should check the export folder first, then ask N. about the missing session files " +
      "before rebuilding the playlist from scratch entirely.";
    const posted = await request(bob, `/stations/oz/cards/${cardId}/comments`, "POST", {
      body: long,
    });
    expect(posted.status).toBe(201);
    expect(CommentSchema.parse(await posted.json()).author.displayName).toBe("Bob");

    const aliceCard = (await board(alice))[0];
    expect(aliceCard?.unread).toBe(true);
    expect(aliceCard?.commentCount).toBe(1);
    expect(aliceCard?.lastComment?.author).toBe("Bob");
    expect(aliceCard?.lastComment?.snippet.length).toBeLessThanOrEqual(120);
    expect(aliceCard?.lastComment?.snippet.endsWith("…")).toBe(true);
    expect((await board(bob))[0]?.unread).toBe(false); // his own reply

    const aliceInbox = await inbox(alice);
    expect(aliceInbox.notifications[0]?.kind).toBe("comment");
    expect(aliceInbox.notifications[0]?.message).toBe("Bob replied on «Bring back the night mix»");

    const thread = CommentsResponseSchema.parse(
      await (await request(alice, `/stations/oz/cards/${cardId}/comments`)).json(),
    );
    expect(thread.comments).toHaveLength(1);
  });

  test("mark-read clears the dot", async () => {
    expect((await request(alice, `/stations/oz/cards/${cardId}/read`, "POST")).status).toBe(204);
    expect((await board(alice))[0]?.unread).toBe(false);
  });

  test("votes: tally + myVote per user, change, clear — and no unread churn", async () => {
    const set = async (cookie: string, kind: string | null) => {
      const response = await request(cookie, `/stations/oz/cards/${cardId}/vote`, "PUT", { kind });
      expect(response.status).toBe(200);
      return CardSchema.parse(await response.json());
    };
    let card = await set(alice, "want_on_air");
    expect(card.myVote).toBe("want_on_air");
    card = await set(bob, "love");
    expect(card.votes).toEqual({ want_on_air: 1, love: 1, needs_discussion: 0, no: 0 });
    expect(card.myVote).toBe("love");
    card = await set(alice, "love"); // change
    expect(card.votes.love).toBe(2);
    expect(card.votes.want_on_air).toBe(0);
    card = await set(alice, null); // clear
    expect(card.votes.love).toBe(1);
    expect(card.myVote).toBeNull();
    expect((await board(alice))[0]?.unread).toBe(false); // votes are ambient
  });

  test("promotion: idea → show re-anchors; anchored/discussion cards refuse; missing slot 404", async () => {
    const create = async (cookie: string, intent: string, subject: string) => {
      const response = await request(cookie, "/stations/oz/cards", "POST", { intent, subject });
      expect(response.status).toBe(201);
      return CardSchema.parse(await response.json());
    };
    const idea = await create(alice, "idea", "Invite Métaraph");
    const promoted = await request(alice, `/stations/oz/cards/${idea.id}/promote`, "POST", {
      to: "show",
      name: "Métaraph Sessions",
    });
    expect(promoted.status).toBe(200);
    const anchored = CardSchema.parse(await promoted.json());
    expect(anchored.anchor).toEqual({ type: "show", id: "7", label: "Show 7" });

    const again = await request(alice, `/stations/oz/cards/${idea.id}/promote`, "POST", {
      to: "show",
      name: "Again",
    });
    expect(again.status).toBe(409); // already anchored

    const talk = await create(alice, "discussion", "General griping");
    const refused = await request(alice, `/stations/oz/cards/${talk.id}/promote`, "POST", {
      to: "show",
      name: "Nope",
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { kind: string }).kind).toBe("illegal-transition");

    const prospect = await create(bob, "prospect", "Contact DJ Sel");
    const badSlot = await request(bob, `/stations/oz/cards/${prospect.id}/promote`, "POST", {
      to: "slot",
      slotId: 41,
    });
    expect(badSlot.status).toBe(404);
    const toSlot = await request(bob, `/stations/oz/cards/${prospect.id}/promote`, "POST", {
      to: "slot",
      slotId: 42,
    });
    expect(toSlot.status).toBe(200);
    expect(CardSchema.parse(await toSlot.json()).anchor).toEqual({ type: "slot", id: "42" });
  });

  test("a slot on another station is out of reach: promote and anchor both 404", async () => {
    // Slot 42 exists — on oz (fake port above). This card lives on wz-test.
    const created = await request(alice, "/stations/wz-test/cards", "POST", {
      intent: "prospect",
      subject: "Poach the oz slot",
    });
    expect(created.status).toBe(201);
    const card = CardSchema.parse(await created.json());

    const promoted = await request(alice, `/stations/wz-test/cards/${card.id}/promote`, "POST", {
      to: "slot",
      slotId: 42,
    });
    expect(promoted.status).toBe(404);

    const anchored = await request(alice, `/stations/wz-test/cards/${card.id}`, "PUT", {
      anchor: { type: "slot", id: "42" },
    });
    expect(anchored.status).toBe(404);

    // The refusals wrote nothing: the card is still unanchored.
    const after = await request(alice, `/stations/wz-test/cards/${card.id}`);
    expect(CardSchema.parse(await after.json()).anchor).toBeNull();
  });

  test("update replaces the assignee set, notifies only new assignees, bumps activity", async () => {
    const before = (await inbox(alice)).notifications.length;
    const response = await request(bob, `/stations/oz/cards/${cardId}`, "PUT", {
      assigneeIds: [1],
    });
    expect(response.status).toBe(200);
    const card = CardSchema.parse(await response.json());
    expect(card.assignees.map((a) => a.displayName)).toEqual(["Alice"]);

    const after = await inbox(alice);
    expect(after.notifications.length).toBe(before + 1);
    expect(after.notifications[0]?.kind).toBe("assigned");
    expect(after.notifications[0]?.message).toBe(
      "«Bring back the night mix» — assigned to you by Bob",
    );
    expect((await board(alice))[0]?.id).toBe(cardId); // freshest activity sorts first
    expect((await request(bob, `/stations/oz/cards/${cardId}`, "PUT", {})).status).toBe(422);
  });

  test("filters narrow by intent and status; junk is 422", async () => {
    const ideas = await board(alice, "?intent=idea");
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.intent).toBe("idea");
    expect(await board(alice, "?status=done")).toHaveLength(0);
    expect(await board(alice, "?intent=idea,prospect")).toHaveLength(2);
    expect((await request(alice, "/stations/oz/cards?status=nope")).status).toBe(422);
  });

  test("a card is invisible from another station", async () => {
    expect((await request(alice, `/stations/oz/cards/${cardId}`)).status).toBe(200);
    expect((await request(alice, `/stations/wz-test/cards/${cardId}`)).status).toBe(404);
  });

  test("notification read is per-owner; read-all sweeps the inbox", async () => {
    const bobInbox = await inbox(bob);
    const first = bobInbox.notifications[0];
    if (!first) throw new Error("missing notification");
    expect((await request(alice, `/notifications/${first.id}/read`, "POST")).status).toBe(404);
    expect((await request(bob, `/notifications/${first.id}/read`, "POST")).status).toBe(204);
    const after = await inbox(bob);
    expect(after.notifications.find((n) => n.id === first.id)?.readAt).not.toBeNull();
    expect(after.unreadCount).toBe(bobInbox.unreadCount - 1);

    expect((await request(bob, "/notifications/read-all", "POST")).status).toBe(204);
    expect((await inbox(bob)).unreadCount).toBe(0);
  });
});
