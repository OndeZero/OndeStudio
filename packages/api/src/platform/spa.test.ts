import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { createApiApp } from "./http";
import { silentLogger } from "./logger";
import { mountSpa } from "./spa";

/**
 * The precondition-PR seam (RFC 0002): one Bun process serves the built SPA and
 * `/api/v1`. Proves the API always wins, real static files are served, client
 * routes deep-link to the shell, and a mistyped `/api/...` is NOT shadowed by
 * `index.html`.
 */
const INDEX_HTML = "<!doctype html><title>OndeStudio</title><div id=app></div>";

describe("mountSpa — one process serves web + API (RFC 0002)", () => {
  let dist: string;
  let app: Hono;

  beforeAll(() => {
    dist = mkdtempSync(join(tmpdir(), "ondestudio-dist-"));
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "index.html"), INDEX_HTML);
    writeFileSync(join(dist, "assets", "app-abc123.js"), "console.log('spa')");

    // Mirror app.ts: the API sub-app mounted first, then the SPA on the outer app.
    const api = createApiApp(silentLogger);
    api.get("/health", (c) => c.json({ status: "ok" }));
    app = new Hono();
    app.route("/api/v1", api);
    mountSpa(app, dist);
  });

  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  test("the API wins for /api/v1/*", async () => {
    const res = await app.request("/api/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("hashed assets are served with their content", async () => {
    const res = await app.request("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log('spa')");
  });

  test("/ serves the index shell", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>OndeStudio</title>");
  });

  test("a deep client route history-falls back to the shell", async () => {
    const res = await app.request("/grid/2026-07-11/some-show");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>OndeStudio</title>");
  });

  test("a mistyped /api/... is NOT shadowed by the index shell", async () => {
    const res = await app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<title>OndeStudio</title>");
  });
});
