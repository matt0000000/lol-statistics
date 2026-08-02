import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  aggregatePublications, AggregatesRepository, CollectionRunRepository, createDatabase, discoveredMatches, items,
  ladderSnapshots, matches as matchesTable, participantRejections, patches, MatchesRepository, ObservationsRepository
} from "@lol/database";
import { RiotHttpClient, LeagueClient, MatchClient, RiotHttpError } from "@lol/riot-client";
import { DataDragonClient, syncCatalog } from "@lol/item-catalog";
import { readCollectorConfig } from "../config";
import { createCollectorLogger } from "../logger";
import { discoverMatches } from "../services/discover-matches";
import { ingestMatch, OutOfScopeMatchError } from "../services/ingest-match";
import { toPatchKey } from "@lol/domain";
import { rebuildAggregates } from "../services/rebuild-aggregates";
import { publishAtomically, verifyPublication } from "../services/publish";
import { snapshotLadder } from "../services/snapshot-ladder";
import { runCollection, exitCodeForError, type PipelineDependencies } from "../pipeline";

export type CollectOptions = { argv?: string[]; env?: Record<string, string | undefined>; write?: (line: string) => void; dependencies?: PipelineDependencies; database?: ReturnType<typeof createDatabase> };

export function isUnavailableMatchError(error: unknown): error is RiotHttpError {
  return error instanceof RiotHttpError && error.status === 404 && error.category === "not_found";
}

/** Build the real production workers. Every stage is backed by Riot clients and repositories. */
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
    const matchClient = new MatchClient(http);
    const runs = new CollectionRunRepository(database.db);
    const ladderRepo = new (await import("@lol/database")).LadderRepository(database.db);
    const discoveryRepo = new MatchesRepository(database.db);
    const observationsRepo = new ObservationsRepository(database.db);
    const dataDragon = new DataDragonClient();
    let catalogPromise: ReturnType<DataDragonClient["fetchTrCatalog"]> | undefined;
    let catalogSyncPromise: ReturnType<typeof syncCatalog> | undefined;
    const loadCatalog = () => (catalogPromise ??= dataDragon.fetchTrCatalog());
    // Resolve the actual TR realm patch before run selection. The promise is
    // shared with CATALOG, so the catalog is synchronized exactly once per
    // invocation and a stale DB active patch cannot suppress a new run.
    const ensureCurrentCatalog = () => (catalogSyncPromise ??= loadCatalog().then((catalog) => syncCatalog(database!, catalog)));
    const resolvePatchId = async (): Promise<number | undefined> => {
      return (await ensureCurrentCatalog()).patchId;
    };
    const dependencies: PipelineDependencies = {
      runs: runs as unknown as PipelineDependencies["runs"],
      advisoryLock: database.withAdvisoryLock,
      resolvePatchId,
      logger,
      stageHandlers: {
        CATALOG: async (run) => {
          const result = await ensureCurrentCatalog();
          if (run.patchId !== null && run.patchId !== undefined && run.patchId !== result.patchId) {
            throw Object.assign(new Error("run patch does not match current catalog"), { invariant: true });
          }
        },
        LADDER: async (run) => snapshotLadder({ runId: run.id, leagueClient: league, repository: ladderRepo, logger }),
        DISCOVERY: async (run) => {
          if (!run.patchId) throw Object.assign(new Error("active patch was not bound"), { invariant: true });
          const snapshots = await database!.db.select().from(ladderSnapshots).where(eq(ladderSnapshots.runId, run.id));
          const start = new Date((run as any).coverageStartedAt ?? new Date(new Date(run.startedAt as Date).getTime() - (run.coverageDays ?? 35) * 86_400_000));
          for (const player of snapshots) await discoverMatches({ runId: run.id, puuid: player.puuid, coverageStart: start, matchClient, repository: discoveryRepo });
        },
        MATCHES: async (run) => {
          if (!run.patchId) throw Object.assign(new Error("active patch was not bound"), { invariant: true });
          const [patch] = await database!.db.select().from(patches).where(eq(patches.id, run.patchId)).limit(1);
          if (!patch) throw Object.assign(new Error("patch not found"), { invariant: true });
          const [players, catalogRows] = await Promise.all([
            database!.db.select().from(ladderSnapshots).where(eq(ladderSnapshots.runId, run.id)),
            database!.db.select().from(items).where(eq(items.patchId, run.patchId))
          ]);
          const eligible = new Map<string, any>(players.map((p) => [p.puuid, { tier: p.tier, division: p.division }]));
          const catalog = new Map(catalogRows.map((row) => [row.itemId, row]));
          const pending = discoveryRepo.pending
            ? await discoveryRepo.pending(run.id)
            : await database!.db.select({ matchId: discoveredMatches.matchId }).from(discoveredMatches).where(and(eq(discoveredMatches.runId, run.id), eq(discoveredMatches.status, "PENDING")));
          for (const { matchId } of pending) {
            const [existing] = await database!.db.select({ id: matchesTable.matchId, patchId: matchesTable.patchId, gameVersion: matchesTable.gameVersion, validationState: matchesTable.validationState }).from(matchesTable).where(eq(matchesTable.matchId, matchId)).limit(1);
            if (existing?.validationState === "VALID") {
              if (discoveryRepo.markProcessed) await discoveryRepo.markProcessed(run.id, matchId);
              continue; // accepted canonical matches are immutable and idempotently skipped
            }
            if (existing?.validationState === "REJECTED") {
              let legacyPatch = "";
              try { legacyPatch = toPatchKey(existing.gameVersion); } catch { /* malformed legacy rows are out of scope */ }
              if (existing.patchId !== run.patchId || legacyPatch !== patch.patchKey) {
                if (!discoveryRepo.markOutOfScope) throw Object.assign(new Error("discovery repository cannot checkpoint out-of-scope matches"), { invariant: true });
                const rejectionRows = await database!.db.select({ count: sql<number>`count(*)` }).from(participantRejections).where(eq(participantRejections.matchId, matchId));
                await discoveryRepo.markOutOfScope(run.id, matchId, Math.min(10, Number(rejectionRows[0]?.count ?? 0)));
                continue;
              }
            }
            try {
              const match = await matchClient.getMatch(matchId);
              await ingestMatch({ runId: run.id, patchId: run.patchId, activePatch: patch.patchKey, match, eligiblePlayers: eligible, catalog, observations: observationsRepo, logger });
              if (discoveryRepo.markProcessed) await discoveryRepo.markProcessed(run.id, matchId);
            } catch (error) {
              if (error instanceof OutOfScopeMatchError) {
                if (!discoveryRepo.markOutOfScope) throw Object.assign(new Error("discovery repository cannot checkpoint out-of-scope matches"), { invariant: true });
                await discoveryRepo.markOutOfScope(run.id, matchId, error.participantCount);
                continue;
              }
              if (isUnavailableMatchError(error)) {
                if (!discoveryRepo.markUnavailable) throw Object.assign(new Error("discovery repository cannot checkpoint unavailable matches"), { invariant: true });
                await discoveryRepo.markUnavailable(run.id, matchId);
                continue;
              }
              throw error;
            }
          }
        },
        AGGREGATES: async (run) => {
          if (!run.patchId) throw Object.assign(new Error("active patch was not bound"), { invariant: true });
          const aggregateRepo = new AggregatesRepository(database!.db);
          const publication = await aggregateRepo.ensurePublicationTarget({ runId: run.id, patchId: run.patchId, coverageStartedAt: new Date((run as any).coverageStartedAt ?? new Date(new Date(run.startedAt as Date).getTime() - (run.coverageDays ?? 35) * 86_400_000)), minimumSample: run.minimumSample ?? 100 });
          const target = await aggregateRepo.getPublication(publication.id);
          const publicationId = publication.id;
          const catalogRows = await database!.db.select().from(items).where(eq(items.patchId, run.patchId));
          const coverageStartedAt = target.coverageStartedAt as Date;
          const source = async (cursor: unknown, pageSize: number) => aggregateRepo.observationPage(run.patchId!, cursor as any, pageSize, undefined, coverageStartedAt);
          await rebuildAggregates({ publicationId, runId: run.id, patchId: run.patchId, source, sink: aggregateRepo, coverageStartedAt, catalog: new Map(catalogRows.map((row) => [row.itemId, row])) });
        },
        VERIFY: async (run) => {
          if (typeof run.publicationId !== "string" || !run.patchId) throw Object.assign(new Error("publication owner is missing"), { invariant: true });
          const report = await verifyPublication({ publicationId: run.publicationId, runId: run.id, database: database! });
          if (!report.valid) throw Object.assign(new Error("publication invariants failed"), { invariant: true });
        },
        PUBLISH: async (run) => {
          if (typeof run.publicationId !== "string") throw Object.assign(new Error("publication owner is missing"), { invariant: true });
          await publishAtomically({ publicationId: run.publicationId, runId: run.id, database: database! });
        }
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
