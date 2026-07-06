import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Logger } from "../kernel/logger";

export type Db = ReturnType<typeof drizzle>;

// Both paths are file-relative — never cwd-relative — so the API opens the
// SAME database and migrations whether launched from the repo root (`bun dev`)
// or the package (`bun --cwd packages/api dev`). fileURLToPath, not
// URL.pathname: checkouts with spaces or non-ASCII in the path must work.
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Repo-root-anchored data path (same rule as the DB) for siblings like the session secret. */
export function resolveDataPath(relative: string): string {
  return isAbsolute(relative) ? relative : resolve(REPO_ROOT, relative);
}

/**
 * Opens (creating if needed) the SQLite database and applies pending
 * migrations idempotently at startup (docs/2 §5.6). One file, WAL mode:
 * file-copy backups stay trivial (docs/2 §13).
 */
export function createDb(dbPath: string, logger: Logger): Db {
  const resolved =
    dbPath === ":memory:" || isAbsolute(dbPath) ? dbPath : resolve(REPO_ROOT, dbPath);
  if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  logger.info("database ready", { dbPath: resolved });
  return db;
}
