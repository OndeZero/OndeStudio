import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiGet } from "./client";

const PayloadSchema = z.object({ title: z.string() });

// A factory, not a shared instance: a Response body can only be read once.
function stubFetch(makeResponse: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => makeResponse()),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("returns the body parsed by the schema on a 2xx response", async () => {
    stubFetch(() => jsonResponse({ title: "Night Drift" }));
    await expect(apiGet("/stations/oz/now", PayloadSchema)).resolves.toEqual({
      title: "Night Drift",
    });
  });

  it("throws the status and envelope message on a non-2xx response", async () => {
    stubFetch(() => jsonResponse({ error: "station not found", kind: "not-found" }, 404));
    await expect(apiGet("/stations/nope/now", PayloadSchema)).rejects.toThrow(
      /404.*station not found/,
    );
  });

  it("throws an error naming the path when the body does not match the schema", async () => {
    stubFetch(() => jsonResponse({ nope: true }));
    await expect(apiGet("/stations/oz/now", PayloadSchema)).rejects.toThrow(
      /\/stations\/oz\/now.*does not match/,
    );
  });
});
