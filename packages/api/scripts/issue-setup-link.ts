/**
 * Prints a one-time setup link for a seeded user (docs/2 §12 — AzuraCast
 * passwords are unreadable, so each teammate sets a local one):
 *
 *   bun packages/api/scripts/issue-setup-link.ts maigre@wavezero.world
 */
import { systemClock } from "../src/kernel/clock";
import { DomainError } from "../src/kernel/domain-error";
import { err } from "../src/kernel/result";
import { PeopleService } from "../src/modules/people";
import { DrizzlePeopleRepo } from "../src/modules/people/wiring";
import { loadConfig } from "../src/platform/config";
import { createDb } from "../src/platform/db";
import { createLogger } from "../src/platform/logger";

const email = process.argv[2];
if (!email) {
  console.error("usage: bun packages/api/scripts/issue-setup-link.ts <email>");
  process.exit(1);
}

const config = loadConfig();
const logger = createLogger("warn");
const service = new PeopleService({
  repo: new DrizzlePeopleRepo(createDb(config.dbPath, logger)),
  // Issuing a link never talks upstream.
  directory: {
    fetchAccounts: () => Promise.resolve(err(DomainError.upstreamUnavailable("not used"))),
  },
  clock: systemClock,
  logger,
});

const token = await service.issueSetupToken(email);
if (!token.ok) {
  console.error(`${token.error.message} — run import-users.ts first?`);
  process.exit(1);
}
console.log(`Setup link (valid 7 days, one-time):`);
console.log(`  http://localhost:5173/setup?token=${token.value}`);
