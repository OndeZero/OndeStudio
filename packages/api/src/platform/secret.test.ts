import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { loadOrCreateSessionSecret } from "./secret";

const TMP = `${process.env.TMPDIR ?? "/tmp"}/ondestudio-secret-test/session-secret`;

afterEach(() => {
  rmSync(`${process.env.TMPDIR ?? "/tmp"}/ondestudio-secret-test`, {
    recursive: true,
    force: true,
  });
});

describe("loadOrCreateSessionSecret", () => {
  test("a sufficiently long env secret wins and no file is written", () => {
    const env = "x".repeat(48);
    expect(loadOrCreateSessionSecret(env, TMP)).toBe(env);
    expect(existsSync(TMP)).toBe(false);
  });

  test("without an env secret, one is generated once and then reused", () => {
    const first = loadOrCreateSessionSecret(undefined, TMP);
    expect(first.length).toBeGreaterThanOrEqual(64);
    const second = loadOrCreateSessionSecret(undefined, TMP);
    expect(second).toBe(first);
  });

  test("a too-short env secret is ignored in favour of the generated one", () => {
    const generated = loadOrCreateSessionSecret("short", TMP);
    expect(generated.length).toBeGreaterThanOrEqual(64);
  });
});
