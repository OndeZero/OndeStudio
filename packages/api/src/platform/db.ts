import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { Logger } from "../kernel/logger";

export type Db = ReturnType<typeof drizzle>;

/**
 * Opens (creating if needed) the SQLite database and applies pending
 * migrations idempotently at startup (docs/2 §5.6). One file, WAL mode:
 * file-copy backups stay trivial (docs/2 §13).
 */
export function createDb(dbPath: string, logger: Logger): Db {
  if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const sqlite = new Database(dbPath, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite);
  // Migrations live in packages/api/drizzle — resolved from this file, not cwd,
  // so the API runs identically from the repo root or the package.
  const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;
  migrate(db, { migrationsFolder });
  logger.info("database ready", { dbPath });
  return db;
}
