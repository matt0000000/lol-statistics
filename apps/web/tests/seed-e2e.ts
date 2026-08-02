import postgres from "postgres";

export type E2EFixtureState = "fresh" | "stale" | "warming";
export type SeedEnvironment = Record<string, string | undefined>;
type SeedInput = SeedEnvironment | string;

/** Validate before creating a socket: this command may only target an explicit test database. */
export function validateSeedEnvironment(env: SeedEnvironment = process.env): URL {
  if (env.NODE_ENV !== "test") throw new Error("seed:e2e refuses to run unless NODE_ENV=test");
  const rawUrl = env.TEST_DATABASE_URL ?? env.DATABASE_URL;
  if (!rawUrl) throw new Error("seed:e2e requires TEST_DATABASE_URL or DATABASE_URL");
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error("seed:e2e requires a valid PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("seed:e2e requires a PostgreSQL URL");
  let databaseName: string;
  try { databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, "")); }
  catch { throw new Error("seed:e2e requires a valid encoded database name"); }
  if (!databaseName || databaseName.includes("/") || !databaseName.endsWith("_test")) {
    throw new Error("seed:e2e refuses databases whose name does not end in _test");
  }
  return url;
}

function environmentOf(input: SeedInput): SeedEnvironment {
  return typeof input === "string" ? { ...process.env, DATABASE_URL: input } : input;
}

function fixtureState(environment: SeedEnvironment): E2EFixtureState {
  const state = environment.E2E_FIXTURE_STATE ?? "fresh";
  if (state !== "fresh" && state !== "stale" && state !== "warming") throw new Error("E2E_FIXTURE_STATE must be fresh, stale, or warming");
  return state;
}

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000011";
const PATCH_VERSION = "16.15.1";

/** Seed one publication/state. Validation is intentionally repeated here so direct imports cannot bypass the CLI guard. */
export async function seedE2E(input: SeedInput = process.env): Promise<void> {
  const environment = environmentOf(input);
  const url = validateSeedEnvironment(environment);
  const state = fixtureState(environment);
  const sql = postgres(url.toString(), { max: 1 });
  const now = Date.now();
  const publishedAt = new Date(now - (state === "stale" ? 7 * 60 * 60_000 : 60 * 60_000)).toISOString();
  const collectedAt = new Date(now - (state === "stale" ? 7 * 60 * 60_000 : 30 * 60_000)).toISOString();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`TRUNCATE TABLE
        participant_core_items, participant_boots, participant_observations, participant_rejections,
        item_aggregates, combination_aggregates, boots_aggregates, baseline_aggregates,
        aggregate_publications, discovered_matches, matches, ladder_snapshots, collection_runs,
        items, champions, patches RESTART IDENTITY CASCADE`);

      await tx.unsafe(`INSERT INTO patches (id, version, patch_key, activated_at, published_at, is_active)
        VALUES (1, '${PATCH_VERSION}', '16.15', '${publishedAt}', '${publishedAt}', true)`);
      await tx.unsafe(`INSERT INTO collection_runs
        (id, status, stage, patch_id, coverage_days, minimum_sample, started_at, finished_at,
         matches_discovered, matches_ingested, observations_accepted, observations_rejected, publication_id, updated_at)
        VALUES ('${RUN_ID}', '${state === "warming" ? "RUNNING" : "COMPLETED"}', '${state === "warming" ? "catalog" : "publish"}', 1, 35, 100,
          '${collectedAt}', ${state === "warming" ? "NULL" : `'${collectedAt}'`},
          ${state === "warming" ? 0 : 200}, ${state === "warming" ? 0 : 200}, ${state === "warming" ? 0 : 150}, 0,
          ${state === "warming" ? "NULL" : `'${PUBLICATION_ID}'`}, '${collectedAt}')`);

      await tx.unsafe(`INSERT INTO champions (patch_id, champion_id, slug, name, icon_url, splash_url) VALUES
        (1, 222, 'jinx', 'Jinx', 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/champion/Jinx.png', NULL),
        (1, 103, 'ahri', 'Ahri', 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/champion/Ahri.png', NULL)`);
      await tx.unsafe(`INSERT INTO items (patch_id, item_id, normalized_base_id, category, classification_reason, name, price, icon_url) VALUES
        (1, 3031, 3031, 'CORE', 'e2e fixture', 'Infinity Edge', 3600, 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/item/3031.png'),
        (1, 6672, 6672, 'CORE', 'e2e fixture', 'Kraken Slayer', 3100, 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/item/6672.png'),
        (1, 3080, 3080, 'CORE', 'e2e fixture', 'Archangel''s Staff', 2500, 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/item/3080.png'),
        (1, 3006, 3006, 'BOOTS', 'e2e fixture', 'Berserker''s Greaves', 1100, 'https://ddragon.leagueoflegends.com/cdn/${PATCH_VERSION}/img/item/3006.png')`);

      if (state !== "warming") {
        await tx.unsafe(`INSERT INTO aggregate_publications
          (id, patch_id, run_id, coverage_started_at, collected_at, minimum_sample, is_active)
          VALUES ('${PUBLICATION_ID}', 1, '${RUN_ID}', '${new Date(now - 35 * 86_400_000).toISOString()}', '${collectedAt}', 100, true)`);
        await tx.unsafe(`UPDATE patches SET active_publication_id = '${PUBLICATION_ID}' WHERE id = 1`);
        await tx.unsafe(`INSERT INTO baseline_aggregates (publication_id, champion_id, role, wins, losses, sample) VALUES
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 78, 72, 150),
          ('${PUBLICATION_ID}', 103, 'MIDDLE', 58, 42, 100)`);
        await tx.unsafe(`INSERT INTO item_aggregates (publication_id, champion_id, role, item_id, wins, losses, sample) VALUES
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 3031, 65, 45, 110),
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 6672, 45, 55, 100),
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 3080, 55, 65, 120)`);
        await tx.unsafe(`INSERT INTO combination_aggregates (publication_id, champion_id, role, size, combination_key, wins, losses, sample) VALUES
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 2, '3031:6672', 50, 55, 105),
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 3, '3031:3031:6672', 6, 4, 10)`);
        await tx.unsafe(`INSERT INTO boots_aggregates (publication_id, champion_id, role, item_id, wins, losses, sample) VALUES
          ('${PUBLICATION_ID}', 222, 'BOTTOM', 3006, 70, 50, 120)`);
      }
    });
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    await seedE2E();
    console.log("Seeded deterministic E2E publication.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
