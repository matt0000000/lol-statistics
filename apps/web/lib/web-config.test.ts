import { describe, expect, it } from "vitest";
import { readWebConfig } from "./web-config";

describe("readWebConfig", () => {
  it("accepts only the read-only database URL and public site URL", () => {
    expect(readWebConfig({ DATABASE_READ_URL: "postgres://reader:secret@db/lol", PUBLIC_SITE_URL: "https://stats.example", NODE_ENV: "test" })).toEqual({
      databaseReadUrl: "postgres://reader:secret@db/lol",
      publicSiteUrl: "https://stats.example"
    });
  });

  it("rejects writer and Riot credentials without leaking values", () => {
    expect(() => readWebConfig({ DATABASE_URL: "postgres://writer:secret@db/lol", RIOT_API_KEY: "super-secret", PUBLIC_SITE_URL: "https://stats.example" })).toThrow("Invalid web configuration");
    expect(() => readWebConfig({ DATABASE_READ_URL: "postgres://reader:secret@db/lol" })).toThrow("Invalid web configuration");
  });
});
