// Consistent snapshot of the OndeStudio SQLite DB (RFC 0002, Data & DB):
// `VACUUM INTO` produces a standalone, fully-checkpointed file — no -wal/-shm
// sidecars — so restore is a single file copy. Runs through bun:sqlite (the
// sqlite3 CLI may be absent); a normal read-write connection is used because
// read-only WAL access can need the -shm sidecar the service owns.
import { Database } from "bun:sqlite";

const [dbPath, outPath] = [Bun.argv[2], Bun.argv[3]];
if (!dbPath || !outPath) {
  console.error("usage: bun deploy/backup.ts <db-path> <out-path>");
  process.exit(1);
}
const db = new Database(dbPath);
db.exec(`VACUUM INTO '${outPath.replaceAll("'", "''")}'`);
db.close();
console.log(`snapshot written: ${outPath}`);
