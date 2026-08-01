import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, CollectionRunRepository } from "@lol/database";
import { RiotHttpClient, LeagueClient, MatchClient } from "@lol/riot-client";
import { DataDragonClient, syncCatalog } from "@lol/item-catalog";
import { readCollectorConfig } from "../config";
import { createCollectorLogger } from "../logger";
import { runCollection, exitCodeForError, type PipelineDependencies } from "../pipeline";

export type CollectOptions = { argv?: string[]; env?: Record<string, string | undefined>; write?: (line: string) => void; dependencies?: PipelineDependencies; database?: ReturnType<typeof createDatabase> };

export async function collectCommand(options: CollectOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  let database = options.database;
  let owned = false;
  try {
    if (options.dependencies) { await runCollection(options.dependencies); return 0; }
    const config = readCollectorConfig(env);
    database = database ?? createDatabase(config.databaseUrl, { max: 8 });
    owned = !options.database;
    if ((options.argv ?? process.argv.slice(2)).includes("--migrate")) {
      await migrate(database.db, { migrationsFolder: new URL("../../../../migrations", import.meta.url).pathname });
    }
    const logger = createCollectorLogger({ write });
    const http = new RiotHttpClient({ apiKey: config.riotApiKey });
    const league = new LeagueClient(http);
    const matches = new MatchClient(http);
    const runs = new CollectionRunRepository(database.db);
    // Real service wiring is injected at the stage boundary. Catalog and Riot clients are
    // deliberately constructed here so a production invocation never uses fake data.
    const dependencies: PipelineDependencies = {
      runs: runs as unknown as PipelineDependencies["runs"],
      advisoryLock: database.withAdvisoryLock,
      logger,
      stageHandlers: {
        CATALOG: async (run) => {
          const result = await syncCatalog(database!, await new DataDragonClient().fetchTrCatalog());
          await runs.bindPatch(run.id, result.patchId);
        },
        LADDER: async (run) => {
          const { LadderRepository } = await import("@lol/database");
          const { snapshotLadder } = await import("../services/snapshot-ladder");
          await snapshotLadder({ runId: run.id, leagueClient: league, repository: new LadderRepository(database!.db) });
        },
        DISCOVERY: async () => { throw Object.assign(new Error("discovery worker is not configured"), { invariant: true }); },
        MATCHES: async () => { throw Object.assign(new Error("match ingestion worker is not configured"), { invariant: true }); },
        AGGREGATES: async () => { throw Object.assign(new Error("aggregate rebuild worker is not configured"), { invariant: true }); },
        VERIFY: async () => { throw Object.assign(new Error("publication verifier is not configured"), { invariant: true }); },
        PUBLISH: async () => { throw Object.assign(new Error("publication worker is not configured"), { invariant: true }); }
      }
    };
    await runCollection(dependencies);
    return 0;
  } catch (error) {
    write(`collector failed (exit ${exitCodeForError(error)})\n`);
    return exitCodeForError(error);
  } finally {
    if (owned) await database?.close().catch(() => undefined);
  }
}
