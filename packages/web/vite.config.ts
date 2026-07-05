/// <reference types="vitest/config" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  server: {
    // Dev-only: the front talks the real API shape from day one (docs/2 §2.2);
    // the api package listens on 4400. In production one Bun process serves both.
    proxy: { "/api": "http://localhost:4400" },
  },
  test: {
    environment: "happy-dom",
    // e2e/ belongs to Playwright; keep Vitest on the colocated *.test.ts files.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
