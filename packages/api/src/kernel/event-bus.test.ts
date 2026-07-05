import { describe, expect, test } from "bun:test";
import { EventBus } from "./event-bus";

// Test-local event registration — the same declaration-merging mechanism
// modules use from their events.ts.
declare module "./event-bus" {
  interface DomainEvents {
    "test.counted": { n: number };
  }
}

describe("EventBus", () => {
  test("delivers typed payloads to subscribers", () => {
    const bus = new EventBus(() => {});
    const seen: number[] = [];
    bus.on("test.counted", ({ n }) => seen.push(n));
    bus.emit("test.counted", { n: 1 });
    bus.emit("test.counted", { n: 2 });
    expect(seen).toEqual([1, 2]);
  });

  test("unsubscribe stops delivery", () => {
    const bus = new EventBus(() => {});
    const seen: number[] = [];
    const off = bus.on("test.counted", ({ n }) => seen.push(n));
    bus.emit("test.counted", { n: 1 });
    off();
    bus.emit("test.counted", { n: 2 });
    expect(seen).toEqual([1]);
  });

  test("a failing subscriber never breaks the others or the emitter", () => {
    const errors: string[] = [];
    const bus = new EventBus((event) => errors.push(event));
    const seen: number[] = [];
    bus.on("test.counted", () => {
      throw new Error("subscriber bug");
    });
    bus.on("test.counted", ({ n }) => seen.push(n));

    expect(() => bus.emit("test.counted", { n: 7 })).not.toThrow();
    expect(seen).toEqual([7]);
    expect(errors).toEqual(["test.counted"]);
  });
});
