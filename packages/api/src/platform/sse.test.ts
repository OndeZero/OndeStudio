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
  test("rejects missing or unknown channels", async () => {
    const routes = createSseRoutes(createSseHub(silentLogger), silentLogger);
    const missing = await routes.request("/stations/oz/sse");
    expect(missing.status).toBe(422);
    const unknown = await routes.request("/stations/oz/sse?channels=nope");
    expect(unknown.status).toBe(422);
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
