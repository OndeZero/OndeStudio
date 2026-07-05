import { defineConfig } from "drizzle-kit";

/**
 * Each feature module owns its tables in its `schema.ts` (docs/2 §3.2);
 * drizzle-kit reads them all to generate versioned SQL migrations into ./drizzle,
 * applied idempotently at startup (docs/2 §5.6).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/modules/*/schema.ts",
  out: "./drizzle",
});
