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

  it.each([
    "file:///tmp/db",
    "ftp://db/lol",
    "javascript:alert(1)",
    "mysql://reader:secret@db/lol",
    "http://db/lol"
  ])("rejects non-PostgreSQL database URL %s", (databaseReadUrl) => {
    expect(() => readWebConfig({ DATABASE_READ_URL: databaseReadUrl, PUBLIC_SITE_URL: "https://stats.example" })).toThrow("Invalid web configuration");
  });

  it.each(["postgres://reader:secret@db/lol", "postgresql://reader:secret@db/lol"]) ("accepts PostgreSQL URL %s", (databaseReadUrl) => {
    expect(readWebConfig({ DATABASE_READ_URL: databaseReadUrl, PUBLIC_SITE_URL: "https://stats.example" }).databaseReadUrl).toBe(databaseReadUrl);
  });

  it.each(["ftp://stats.example", "javascript:alert(1)", "mysql://stats.example", "https://user:secret@stats.example"]) ("rejects unsafe public site URL %s", (publicSiteUrl) => {
    expect(() => readWebConfig({ DATABASE_READ_URL: "postgres://reader:secret@db/lol", PUBLIC_SITE_URL: publicSiteUrl })).toThrow("Invalid web configuration");
  });

  it("normalizes a root trailing slash on the public URL", () => {
    expect(readWebConfig({ DATABASE_READ_URL: "postgres://reader:secret@db/lol", PUBLIC_SITE_URL: "https://stats.example/" }).publicSiteUrl).toBe("https://stats.example");
  });

  it("never includes URL secrets in validation errors", () => {
    const secret = "do-not-leak-7f4d";
    let message = "";
    try {
      readWebConfig({ DATABASE_READ_URL: "http://reader:" + secret + "@db/lol", PUBLIC_SITE_URL: "https://user:" + secret + "@stats.example" });
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(secret);
  });
});
