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
