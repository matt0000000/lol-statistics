import { validateTestDatabaseUrl } from "./seed-e2e";

const rawUrl = process.env.TEST_DATABASE_URL;
if (!rawUrl) {
  console.error("E2E requires TEST_DATABASE_URL; DATABASE_READ_URL and DATABASE_URL are not accepted for seeding");
  process.exit(1);
}
try {
  validateTestDatabaseUrl(rawUrl);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
