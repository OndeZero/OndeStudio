import { describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const minimalEnv = {
  AZURACAST_BASE_URL: "https://studio.example.net",
  AZURACAST_API_KEY: "test-key",
};

describe("loadConfig", () => {
  test("applies defaults over a minimal environment", () => {
    const config = loadConfig(minimalEnv);
    expect(config.port).toBe(4400);
    expect(config.dbPath).toBe("data/ondestudio.sqlite");
    expect(config.mainStation.value).toBe("oz");
    expect(config.testStation.value).toBe("wz-test");
    expect(config.stations.map((s) => s.value)).toEqual(["oz", "wz-test"]);
    expect(config.nowPollSeconds).toBe(10);
  });

  test("strips a trailing slash from the AzuraCast base URL", () => {
    const config = loadConfig({ ...minimalEnv, AZURACAST_BASE_URL: "https://x.example.net/" });
    expect(config.azuracast.baseUrl).toBe("https://x.example.net");
  });

  test("fails fast, naming the offending variable", () => {
    expect(() => loadConfig({ AZURACAST_BASE_URL: "https://x.example.net" })).toThrow(
      /AZURACAST_API_KEY/,
    );
    expect(() => loadConfig({ ...minimalEnv, AZURACAST_BASE_URL: "not-a-url" })).toThrow(
      /AZURACAST_BASE_URL/,
    );
  });
});
