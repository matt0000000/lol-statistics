import { describe, expect, it } from "vitest";
import { seedE2E, validateSeedEnvironment } from "./seed-e2e";

describe("E2E seed safety", () => {
  it("accepts an encoded test database name and ignores URL query parameters", () => {
    const url = validateSeedEnvironment({
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgres://lol:lol@localhost:5432/lol_stats_%74est?sslmode=disable"
    });
    expect(decodeURIComponent(url.pathname)).toBe("/lol_stats_test");
  });

  it("rejects a non-test environment before opening a connection", async () => {
    await expect(seedE2E({ NODE_ENV: "production", DATABASE_URL: "postgres://localhost/lol_stats_test" })).rejects.toThrow(/NODE_ENV=test/);
  });

  it("rejects a production database even when the URL has a test-looking query", async () => {
    await expect(seedE2E({ NODE_ENV: "test", DATABASE_URL: "postgres://localhost/lol_stats?db=lol_stats_test" })).rejects.toThrow(/_test/);
  });
});
