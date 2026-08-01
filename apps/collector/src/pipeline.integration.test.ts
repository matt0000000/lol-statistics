import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  aggregatePublications, AggregatesRepository, CollectionRunRepository, collectionRuns,
  createMigratedTestDatabase, items, LadderRepository, MatchesRepository, ObservationsRepository,
  patches, ladderSnapshots, matches
} from "@lol/database";
import type { MatchDto } from "@lol/riot-client";
import { discoverMatches } from "./services/discover-matches";
import { ingestMatch } from "./services/ingest-match";
import { publishAtomically, verifyPublication } from "./services/publish";
import { rebuildAggregates } from "./services/rebuild-aggregates";
import { COLLECTION_STAGES, runCollection } from "./pipeline";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("collector pipeline PostgreSQL restart durability", () => {
  it("restarts after exactly two fetched matches and publishes one canonical target", async () => {
    const isolated = await createMigratedTestDatabase(process.env.TEST_DATABASE_URL!);
    try {
      const now = Date.now();
      const [patch] = await isolated.db.insert(patches).values({ version: `99.9.${now}`, patchKey: "99.9", isActive: true }).returning();
      await isolated.db.insert(items).values([
        { patchId: patch!.id, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "fixture", name: "Core", price: 1, iconUrl: "core" },
        { patchId: patch!.id, itemId: 3006, normalizedBaseId: 3006, category: "BOOTS", classificationReason: "fixture", name: "Boots", price: 1, iconUrl: "boots" }
      ]);
      const runs = new CollectionRunRepository(isolated.db);
      const ladder = new LadderRepository(isolated.db);
      const discovery = new MatchesRepository(isolated.db);
      const observations = new ObservationsRepository(isolated.db);
      const aggregates = new AggregatesRepository(isolated.db);
      const fetched = new Map<string, number>();
      let injectCrash = true;
      const fixtureMatch = (id: string): MatchDto => ({ metadata: { dataVersion: "2", matchId: id, participants: ["player-1"] }, info: { platformId: "TR1", queueId: 420, gameVersion: "99.9.1", gameCreation: now, gameDuration: 1800, participants: [{ participantId: 1, puuid: "player-1", championId: 1, teamPosition: "TOP", win: true, gameEndedInEarlySurrender: false, item0: 3031, item1: 3006, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 }] } });
      const matchClient = {
        async listMatchIds() { return ["TR1_1", "TR1_2", "TR1_3"]; },
        async getMatch(id: string) {
          const count = (fetched.get(id) ?? 0) + 1; fetched.set(id, count);
          return fixtureMatch(id);
        }
      };
      const deps = {
        runs: runs as any,
        coverageDays: 35,
        minimumSample: 0,
        stageHandlers: {
          CATALOG: async (run: any) => { await runs.bindPatch(run.id, patch!.id); },
          LADDER: async (run: any) => ladder.snapshotLadder(run.id, [{ puuid: "player-1", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]),
          DISCOVERY: async (run: any) => discoverMatches({ runId: run.id, puuid: "player-1", coverageStart: new Date(now - 35 * 86_400_000), matchClient, repository: discovery }),
          MATCHES: async (run: any) => {
            const discovered = await isolated.db.select({ matchId: (await import("@lol/database")).discoveredMatches.matchId }).from((await import("@lol/database")).discoveredMatches).where(eq((await import("@lol/database")).discoveredMatches.runId, run.id));
            for (const row of discovered) {
              const [existing] = await isolated.db.select({ id: matches.matchId }).from(matches).where(eq(matches.matchId, row.matchId)).limit(1);
              if (existing) continue;
              const match = await matchClient.getMatch(row.matchId);
              await ingestMatch({ runId: run.id, patchId: patch!.id, activePatch: "99.9", match, eligiblePlayers: new Map([["player-1", { tier: "EMERALD", division: "I" }]]), catalog: new Map([[3031, { itemId: 3031, category: "CORE", normalizedBaseId: 3031 }], [3006, { itemId: 3006, category: "BOOTS", normalizedBaseId: 3006 }]]), observations });
              if (injectCrash && fetched.get(row.matchId) === 1 && [...fetched.values()].reduce((a, b) => a + b, 0) === 2) { injectCrash = false; throw new Error("injected fetch failure"); }
            }
          },
          AGGREGATES: async (run: any) => { const target = await aggregates.ensurePublicationTarget({ runId: run.id, patchId: patch!.id, coverageStartedAt: new Date(now - 35 * 86_400_000), minimumSample: 0 }); await rebuildAggregates({ publicationId: target.id, runId: run.id, patchId: patch!.id, source: async (cursor, size) => aggregates.observationPage(patch!.id, cursor as any, size), sink: aggregates, catalog: new Map([[3031, { itemId: 3031, category: "CORE", normalizedBaseId: 3031 }], [3006, { itemId: 3006, category: "BOOTS", normalizedBaseId: 3006 }]]) }); },
          VERIFY: async (run: any) => { const report = await verifyPublication({ publicationId: run.publicationId, runId: run.id, database: isolated as any }); if (!report.valid) throw new Error("verify failed"); },
          PUBLISH: async (run: any) => publishAtomically({ publicationId: run.publicationId, runId: run.id, database: isolated as any })
        }
      } as any;
      await expect(runCollection(deps)).rejects.toThrow("injected fetch failure");
      expect((await isolated.db.select().from(aggregatePublications).where(eq(aggregatePublications.isActive, true))).length).toBe(0);
      await runCollection(deps);
      expect(fetched.get("TR1_1")).toBe(1); expect(fetched.get("TR1_2")).toBe(1); expect(fetched.get("TR1_3")).toBe(1);
      expect((await isolated.db.select().from(aggregatePublications).where(eq(aggregatePublications.isActive, true))).length).toBe(1);
      const [completedRun] = await isolated.db.select().from(collectionRuns).where(eq(collectionRuns.status, "COMPLETED")).limit(1);
      const targets = await Promise.all([
        aggregates.ensurePublicationTarget({ runId: completedRun!.id, patchId: patch!.id, coverageStartedAt: new Date(now - 35 * 86_400_000), minimumSample: 0 }),
        aggregates.ensurePublicationTarget({ runId: completedRun!.id, patchId: patch!.id, coverageStartedAt: new Date(now - 35 * 86_400_000), minimumSample: 0 })
      ]);
      expect(targets[0].id).toBe(targets[1].id);
      const third = await runCollection(deps); expect(third).toBe((await isolated.db.select({ id: collectionRuns.id }).from(collectionRuns).where(eq(collectionRuns.status, "COMPLETED")).limit(1))[0]?.id);
      const concurrent = await Promise.all([runCollection(deps), runCollection(deps)]);
      expect(new Set(concurrent)).toEqual(new Set([third]));
      const differentCoverage = await runs.resumeOrCreate({ patchId: patch!.id, coverageDays: 34, minimumSample: 0 });
      expect(differentCoverage.id).not.toBe(third);
      const differentSample = await runs.resumeOrCreate({ patchId: patch!.id, coverageDays: 35, minimumSample: 1 });
      expect(differentSample.id).not.toBe(third);
    } finally { await isolated.close(); }
  });
});
