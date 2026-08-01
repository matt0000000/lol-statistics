import { describe, expect, it } from "vitest";
import { readCollectorConfig } from "./config";

describe("readCollectorConfig", () => {
  it("rejects an absent Riot key and accepts a complete environment", () => {
    expect(() => readCollectorConfig({ DATABASE_URL: "postgres://db" })).toThrow("RIOT_API_KEY");
    expect(
      readCollectorConfig({
        DATABASE_URL: "postgres://db",
        RIOT_API_KEY: "RGAPI-test",
        RIOT_PLATFORM: "TR1",
        RIOT_REGION: "EUROPE"
      })
    ).toEqual({
      databaseUrl: "postgres://db",
      riotApiKey: "RGAPI-test",
      platform: "TR1",
      region: "EUROPE"
    });
  });
});
