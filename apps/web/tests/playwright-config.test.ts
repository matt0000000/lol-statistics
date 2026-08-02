import { describe, expect, it } from "vitest";
import config from "../../../playwright.config";

describe("Playwright server isolation", () => {
  it("owns a configurable non-default E2E port and passes the database environment", () => {
    const server = Array.isArray(config.webServer) ? config.webServer[0] : config.webServer;
    expect(server?.reuseExistingServer).toBe(false);
    expect(server?.command).toMatch(/@lol\/web dev/);
    expect(server?.command).toMatch(/--port/);
    expect(server?.url).toMatch(/127\.0\.0\.1:(?!3000\b)\d+/);
    const databaseUrl = process.env.DATABASE_READ_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (databaseUrl) expect(server?.env).toHaveProperty("DATABASE_READ_URL", databaseUrl);
  });
});
