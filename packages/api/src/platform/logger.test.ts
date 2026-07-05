import { describe, expect, test } from "bun:test";
import { createLogger } from "./logger";

describe("createLogger", () => {
  test("filters below the threshold and emits valid JSON lines", () => {
    const lines: string[] = [];
    const logger = createLogger("info", (line) => lines.push(line));
    logger.debug("hidden");
    logger.info("shown", { a: 1 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("shown");
    expect(parsed.a).toBe(1);
    expect(typeof parsed.ts).toBe("string");
  });

  test("child loggers stamp their fields on every line", () => {
    const lines: string[] = [];
    const logger = createLogger("info", (line) => lines.push(line)).child({ component: "x" });
    logger.warn("w", { b: 2 });
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed.component).toBe("x");
    expect(parsed.b).toBe(2);
  });
});
