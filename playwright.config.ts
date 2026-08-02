import { defineConfig } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const requestedPort = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);
const port = Number.isInteger(requestedPort) && requestedPort > 1024 && requestedPort < 65_536 && requestedPort !== 3000 ? requestedPort : 4173;
const baseURL = `http://127.0.0.1:${port}`;
const databaseReadUrl = process.env.DATABASE_READ_URL ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  testDir: join(projectRoot, "e2e"),
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  webServer: {
    command: `bun --filter @lol/web dev -- --port ${port}`,
    url: baseURL,
    // E2E must always verify the server started by this run. Reusing an
    // arbitrary development server makes DB fixture state and code revision
    // unknowable, especially on shared CI/dev hosts.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL ?? baseURL,
      ...(databaseReadUrl ? { DATABASE_READ_URL: databaseReadUrl } : {})
    }
  }
});
