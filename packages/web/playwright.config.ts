import { defineConfig } from "@playwright/test";

// Bun/Node provide `process` at runtime; declared locally so one env read does
// not pull all of @types/node into the web package.
declare const process: { env: Record<string, string | undefined> };

/**
 * M0 skeleton (docs/2 §11): only the smoke spec exists — the grid happy-path
 * e2e (docs/2 §9.5) arrives with the M1 grid. No `webServer` block on
 * purpose: point PW_BASE_URL at a running dev or preview server instead;
 * the spec skips itself when it is unset.
 */
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.PW_BASE_URL,
  },
});
