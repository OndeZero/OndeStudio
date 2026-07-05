import { describe, expect, test } from "bun:test";
import { err, ok, unwrap } from "./result";

describe("Result", () => {
  test("ok carries the value", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  test("err carries the error", () => {
    const result = err("boom");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  test("unwrap returns the value and throws on Err", () => {
    expect(unwrap(ok("fine"))).toBe("fine");
    expect(() => unwrap(err("broken"))).toThrow("unwrap() called on Err");
  });
});
