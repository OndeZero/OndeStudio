/**
 * Seeds/refreshes OndeStudio users from the AzuraCast directory (read-only):
 *
 *   bun packages/api/scripts/import-users.ts
 */
import { systemClock } from "../src/kernel/clock";
import { PeopleService } from "../src/modules/people";
import { DrizzlePeopleRepo } from "../src/modules/people/wiring";
import { AzuracastClient, AzuracastDirectoryAdapter } from "../src/modules/playout/wiring";
import { loadConfig } from "../src/platform/config";
import { createDb } from "../src/platform/db";
import { createLogger } from "../src/platform/logger";

const config = loadConfig();
const logger = createLogger("info");
const service = new PeopleService({
  repo: new DrizzlePeopleRepo(createDb(config.dbPath, logger)),
  directory: new AzuracastDirectoryAdapter(new AzuracastClient({ ...config.azuracast, logger })),
  clock: systemClock,
  logger,
});

const imported = await service.importAccounts();
if (!imported.ok) {
  logger.error("import failed", { reason: imported.error.message });
  process.exit(1);
}
for (const user of await service.listUsers()) {
  logger.info("user", {
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    hasPassword: user.hasPassword,
  });
}
