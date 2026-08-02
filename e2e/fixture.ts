import { seedE2E, type E2EFixtureState } from "../apps/web/tests/seed-e2e";

export async function seedFixture(state: E2EFixtureState): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_READ_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E fixture requires TEST_DATABASE_URL, DATABASE_READ_URL, or DATABASE_URL");
  await seedE2E({ ...process.env, NODE_ENV: "test", TEST_DATABASE_URL: databaseUrl, E2E_FIXTURE_STATE: state });
}
