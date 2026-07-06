import { describe, expect, test } from "bun:test";
import { silentLogger } from "./logger";
import { createSseHub, createSseRoutes } from "./sse";

describe("SseHub", () => {
  test("publishes only to matching station/channel subscribers", () => {
    const hub = createSseHub(silentLogger);
    const received: unknown[] = [];
    hub.register("oz", "onair", (_event, data) => received.push(data));
    hub.publish("oz", "onair", "onair", { n: 1 });
    hub.publish("oz", "grid", "grid", { n: 2 });
    hub.publish("wz-test", "onair", "onair", { n: 3 });
    expect(received).toEqual([{ n: 1 }]);
  });

  test("unregister removes the subscriber", () => {
    const hub = createSseHub(silentLogger);
    const received: unknown[] = [];
    const off = hub.register("oz", "onair", (_event, data) => received.push(data));
    off();
    hub.publish("oz", "onair", "onair", { n: 1 });
    expect(received).toEqual([]);
    expect(hub.subscriberCount("oz", "onair")).toBe(0);
  });

  test("a throwing subscriber does not break the fan-out", () => {
    const hub = createSseHub(silentLogger);
    const received: unknown[] = [];
    hub.register("oz", "onair", () => {
      throw new Error("dead socket");
    });
    hub.register("oz", "onair", (_event, data) => received.push(data));
    expect(() => hub.publish("oz", "onair", "onair", { n: 1 })).not.toThrow();
    expect(received).toEqual([{ n: 1 }]);
  });
});

describe("SSE route", () => {
  test("team channels require a session when a gate is configured; onair stays public", async () => {
    const hub = createSseHub(silentLogger);
    const routes = createSseRoutes(hub, silentLogger, {
      publicChannels: ["onair"],
      isAuthorized: (c) => Promise.resolve(c.req.header("x-test-auth") === "yes"),
    });
    expect((await routes.request("/stations/oz/sse?channels=board")).status).toBe(401);
    expect((await routes.request("/stations/oz/sse?channels=onair,grid")).status).toBe(401);
    const publicOnly = await routes.request("/stations/oz/sse?channels=onair");
    expect(publicOnly.status).toBe(200);
    await publicOnly.body?.cancel();
    const authed = await routes.request("/stations/oz/sse?channels=board", {
      headers: { "x-test-auth": "yes" },
    });
    expect(authed.status).toBe(200);
    await authed.body?.cancel();
  });

  test("rejects missing or unknown channels", async () => {
    const routes = createSseRoutes(createSseHub(silentLogger), silentLogger);
    const missing = await routes.request("/stations/oz/sse");
    expect(missing.status).toBe(422);
    const unknown = await routes.request("/stations/oz/sse?channels=nope");
    expect(unknown.status).toBe(422);
  });

  test("invalid stations are 422; the subscribe key is canonicalized like publishers'", async () => {
    const hub = createSseHub(silentLogger);
    const routes = createSseRoutes(hub, silentLogger);
    expect((await routes.request("/stations/oz%20x/sse?channels=onair")).status).toBe(422);

    // `OZ` must land on the same hub key publishers use (`oz`), not a dead one.
    const response = await routes.request("/stations/OZ/sse?channels=onair");
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body stream");
    await reader.read(); // heartbeat
    hub.publish("oz", "onair", "onair", { n: 1 });
    const frame = new TextDecoder().decode((await reader.read()).value);
    expect(frame).toContain('"n":1');
    await reader.cancel();
  });

  test("a fresh subscriber gets the channel snapshot before heartbeats", async () => {
    const hub = createSseHub(silentLogger);
    const routes = createSseRoutes(hub, silentLogger, {
      snapshots: { onair: () => Promise.resolve({ hello: "oz" }) },
    });
    const response = await routes.request("/stations/oz/sse?channels=onair");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body stream");
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: onair");
    expect(first).toContain('"hello":"oz"');
    await reader.cancel();
  });

  test("streams a heartbeat then published events", async () => {
    const hub = createSseHub(silentLogger);
    const routes = createSseRoutes(hub, silentLogger);
    const response = await routes.request("/stations/oz/sse?channels=onair");
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    if (!reader) throw new Error("no body stream");
    const decoder = new TextDecoder();

    // First frame is the heartbeat written on subscribe.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("event: ping");

    hub.publish("oz", "onair", "onair", { station: "oz" });
    const second = await reader.read();
    const frame = decoder.decode(second.value);
    expect(frame).toContain("event: onair");
    expect(frame).toContain('"station":"oz"');

    await reader.cancel();
  });
});
