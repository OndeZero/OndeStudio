import { describe, expect, test } from "bun:test";
import { unwrap } from "./result";
import { StationId } from "./station-id";

describe("StationId", () => {
  test("parses valid shortcodes, normalizing case and whitespace", () => {
    expect(unwrap(StationId.parse("oz")).value).toBe("oz");
    expect(unwrap(StationId.parse(" WZ-TEST ")).value).toBe("wz-test");
  });

  test("rejects invalid shortcodes", () => {
    for (const raw of ["", "-oz", "oz stations", "öz", "oz!"]) {
      const result = StationId.parse(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("validation");
    }
  });

  test("equality is by value", () => {
    expect(unwrap(StationId.parse("oz")).equals(unwrap(StationId.parse("OZ")))).toBe(true);
    expect(unwrap(StationId.parse("oz")).equals(unwrap(StationId.parse("wz-test")))).toBe(false);
  });
});
