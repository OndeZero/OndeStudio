import { describe, expect, test } from "bun:test";
import { silentLogger } from "../../../../platform/logger";
import { AzuracastClient } from "./client";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function clientWith(
  handler: (calls: number) => Response | Promise<Response>,
  overrides: Partial<ConstructorParameters<typeof AzuracastClient>[0]> = {},
) {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return handler(calls);
  }) as unknown as typeof fetch;
  const client = new AzuracastClient({
    baseUrl: "https://az.example.net",
    apiKey: "k",
    logger: silentLogger,
    fetchImpl,
    maxRetries: 0,
    ...overrides,
  });
  return { client, calls: () => calls };
}

describe("AzuracastClient", () => {
  test("returns parsed JSON on success", async () => {
    const { client } = clientWith(() => jsonResponse({ hello: "oz" }));
    const result = await client.getJson<{ hello: string }>("/api/nowplaying/oz");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.hello).toBe("oz");
  });

  test("retries transient 5xx then succeeds", async () => {
    const { client, calls } = clientWith(
      (n) => (n < 3 ? jsonResponse({}, 500) : jsonResponse({ fine: true })),
      { maxRetries: 2 },
    );
    const result = await client.getJson("/x");
    expect(result.ok).toBe(true);
    expect(calls()).toBe(3);
  });

  test("does not retry a 404 — AzuraCast answered", async () => {
    const { client, calls } = clientWith(() => jsonResponse({}, 404), { maxRetries: 2 });
    const result = await client.getJson("/missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not-found");
    expect(calls()).toBe(1);
  });

  test("opens the circuit after consecutive failures and fails fast while open", async () => {
    const { client, calls } = clientWith(
      () => {
        throw new Error("network down");
      },
      { breakerThreshold: 1, breakerCooldownMs: 60_000 },
    );

    const first = await client.getJson("/x");
    expect(first.ok).toBe(false);
    expect(calls()).toBe(1);

    // Circuit is open: no network call is even attempted.
    const second = await client.getJson("/x");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toContain("circuit open");
    expect(calls()).toBe(1);

    expect(client.health().circuit).toBe("open");
    expect(client.health().consecutiveFailures).toBe(1);
  });
});
