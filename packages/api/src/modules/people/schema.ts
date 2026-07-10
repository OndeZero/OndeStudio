import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * People-owned persistence (docs/2 §12): OndeStudio's OWN user/session store,
 * seeded from AzuraCast accounts but independent thereafter — auth must
 * survive phase 3 when AzuraCast disappears. Broadcaster tables join in M4.
 */
export const users = sqliteTable("user", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** AzuraCast account id this user was seeded from; null for local-only users. */
  azAccountRef: text("az_account_ref").unique(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["team", "external"] })
    .notNull()
    .default("team"),
  /** argon2id via Bun.password; null until the one-time setup link is used. */
  passwordHash: text("password_hash"),
  setupToken: text("setup_token").unique(),
  setupTokenExpiresAt: text("setup_token_expires_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const broadcasters = sqliteTable("broadcaster", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Future link to a login for the external self-service page (fast-follow). */
  userId: integer("user_id"),
  /** streamer_username — identical on both stations (PD §5.10). */
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  kind: text("kind", { enum: ["team", "external"] })
    .notNull()
    .default("external"),
  commentMeta: text("comment_meta"),
  /** Pushed to MAIN only; the test mirror always stays unrestricted (PD §2.2). */
  enforceSchedule: integer("enforce_schedule", { mode: "boolean" }).notNull().default(false),
  replayFlag: text("replay_flag", { enum: ["yes", "no", "not_specified"] })
    .notNull()
    .default("not_specified"),
  /** argon2id of the streamer credential — OndeStudio owns it going forward (docs/2 §12); null = adopted, credential unknown. */
  passwordHash: text("password_hash"),
  /** AzuraCast streamer ids per station; null = nothing linked there yet. Full projection rows arrive with the M3 drift engine. */
  mainStreamerRef: text("main_streamer_ref"),
  testStreamerRef: text("test_streamer_ref"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const userSessions = sqliteTable("user_session", {
  /** Random 256-bit id — the (signed) cookie value. */
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

/**
 * Broadcaster self-service sessions (PD §5.6): a SEPARATE store from team
 * user_session, keyed to the broadcaster and its own cookie — an external
 * broadcaster authenticated by Icecast credentials can never reach a team
 * surface, whatever the cookie.
 */
export const broadcasterSessions = sqliteTable("broadcaster_session", {
  id: text("id").primaryKey(),
  broadcasterId: integer("broadcaster_id")
    .notNull()
    .references(() => broadcasters.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});
