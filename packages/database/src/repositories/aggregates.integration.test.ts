import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMigratedTestDatabase } from "../test-utils";
import { aggregatePublications, baselineAggregates, bootsAggregates, collectionRuns, combinationAggregates, itemAggregates, items, matches, participantCoreItems, participantObservations, patches } from "../schema";
import { AggregatesRepository } from "./aggregates";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("aggregate repository PostgreSQL invariants", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  let patchId: number;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [patch] = await database.db.insert(patches).values({ version: `99.1.${Date.now()}`, patchKey: "99.1", isActive: true }).returning({ id: patches.id });
    patchId = patch!.id;
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId: run!.id, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
  });
  afterEach(async () => { if (database) await database.close(); });

  const group = (championId = 1) => ({ championId, role: "TOP" as const, baseline: { wins: 1, losses: 0, sample: 1 }, items: new Map([[3031, { wins: 1, losses: 0, sample: 1 }]]), pairs: new Map([["3031:6672", { wins: 1, losses: 0, sample: 1 }]]), trios: new Map([["3031:6672:6692", { wins: 1, losses: 0, sample: 1 }]]), boots: new Map([[3006, { wins: 1, losses: 0, sample: 1 }]]) });

  it("rejects flush before prepare and persists no rows", async () => {
    const repository = new AggregatesRepository(database.db);
    await expect(repository.flushGroup(group())).rejects.toThrow("must be prepared");
    expect(await new AggregatesRepository(database.db).rows(publicationId)).toEqual([]);
  });

  it("rejects wrong run and patch owners without changing rows", async () => {
    const wrongRunSession = new AggregatesRepository(database.db);
    await expect(wrongRunSession.preparePublication({ publicationId, runId: "00000000-0000-4000-8000-000000000099", patchId })).rejects.toThrow("inactive owned");
    const wrongPatchSession = new AggregatesRepository(database.db);
    await expect(wrongPatchSession.preparePublication({ publicationId, runId, patchId: patchId + 999 })).rejects.toThrow("inactive owned");
    expect(await new AggregatesRepository(database.db).rows(publicationId)).toEqual([]);
  });

  it("keeps prepare single-use sticky after a failed ownership attempt", async () => {
    const repository = new AggregatesRepository(database.db);
    await expect(repository.preparePublication({ publicationId, runId: "00000000-0000-4000-8000-000000000099", patchId })).rejects.toThrow("inactive owned");
    await expect(repository.preparePublication({ publicationId, runId, patchId })).rejects.toThrow("already prepared");
    expect(await repository.rows(publicationId)).toEqual([]);
  });

  it("rejects preparing an already-active target", async () => {
    await database.db.update(aggregatePublications).set({ isActive: true }).where(eq(aggregatePublications.id, publicationId));
    const repository = new AggregatesRepository(database.db);
    await expect(repository.preparePublication({ publicationId, runId, patchId })).rejects.toThrow("inactive owned");
  });

  it("allows a new repository session to replace a failed session's inactive target", async () => {
    const first = new AggregatesRepository(database.db);
    await expect(first.preparePublication({ publicationId, runId, patchId: patchId + 1 })).rejects.toThrow("inactive owned");
    const second = new AggregatesRepository(database.db);
    await expect(second.preparePublication({ publicationId, runId, patchId })).resolves.toBeUndefined();
    await second.flushGroup(group());
    expect((await second.rows(publicationId)).length).toBe(5);
  });

  it("rejects same-session double prepare without clearing existing rows", async () => {
    const repository = new AggregatesRepository(database.db);
    await repository.preparePublication({ publicationId, runId, patchId });
    await repository.flushGroup({ championId: 1, role: "TOP", baseline: { wins: 1, losses: 0, sample: 1 }, items: new Map([[3031, { wins: 1, losses: 0, sample: 1 }]]), pairs: new Map(), trios: new Map(), boots: new Map() });
    expect((await repository.rows(publicationId)).length).toBe(2);
    await expect(repository.preparePublication({ publicationId, runId, patchId })).rejects.toThrow("already prepared");
    expect((await repository.rows(publicationId)).length).toBe(2);
  });

  it("clears stale rows from every aggregate detail table during prepare", async () => {
    await database.db.insert(baselineAggregates).values({ publicationId, championId: 9, role: "TOP", wins: 1, losses: 0, sample: 1 });
    await database.db.insert(itemAggregates).values({ publicationId, championId: 9, role: "TOP", itemId: 3031, wins: 1, losses: 0, sample: 1 });
    await database.db.insert(combinationAggregates).values({ publicationId, championId: 9, role: "TOP", size: 2, combinationKey: "3031:6672", wins: 1, losses: 0, sample: 1 });
    await database.db.insert(bootsAggregates).values({ publicationId, championId: 9, role: "TOP", itemId: 3006, wins: 1, losses: 0, sample: 1 });
    const repository = new AggregatesRepository(database.db);
    await repository.preparePublication({ publicationId, runId, patchId });
    expect(await repository.rows(publicationId)).toEqual([]);
  });

  it("flushes an exact replacement set and supports a new-session retry", async () => {
    const first = new AggregatesRepository(database.db);
    await first.preparePublication({ publicationId, runId, patchId });
    await first.flushGroup(group());
    const second = new AggregatesRepository(database.db);
    await second.preparePublication({ publicationId, runId, patchId });
    await second.flushGroup(group(2));
    const rows = await second.rows(publicationId);
    expect(rows.every((row) => row.championId === 2)).toBe(true);
    expect(rows.length).toBe(5);
  });

  it("canonical source excludes rejected, wrong queue/platform/patch rows and preserves global ordering", async () => {
    await database.db.insert(items).values({ patchId, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "fixture", name: "Core", price: 1000, iconUrl: "core" });
    const now = new Date();
    await database.db.insert(matches).values([
      { matchId: "TR1_accepted", patchId, platformId: "TR1", queueId: 420, gameVersion: "99.1.1", gameCreation: now, gameDuration: 1800, validationState: "VALID" },
      { matchId: "TR1_rejected", patchId, platformId: "TR1", queueId: 420, gameVersion: "99.1.1", gameCreation: now, gameDuration: 1800, validationState: "REJECTED" },
      { matchId: "EUW_wrong", patchId, platformId: "EUW1", queueId: 420, gameVersion: "99.1.1", gameCreation: now, gameDuration: 1800, validationState: "VALID" },
      { matchId: "ARAM_wrong", patchId, platformId: "TR1", queueId: 450, gameVersion: "99.1.1", gameCreation: now, gameDuration: 1800, validationState: "VALID" }
    ]);
    const observation = (matchId: string, championId: number) => ({ matchId, participantId: 1, patchId, puuid: `${matchId}-p`, championId, role: "TOP" as const, win: true, tier: "EMERALD" as const, division: "I", gameDuration: 1800, rawFinalSlots: [] });
    await database.db.insert(participantObservations).values([observation("TR1_accepted", 1), observation("TR1_rejected", 2), observation("EUW_wrong", 3), observation("ARAM_wrong", 4)]);
    await database.db.insert(participantCoreItems).values({ matchId: "TR1_accepted", participantId: 1, patchId, slotIndex: 0, itemId: 3031, quantity: 1 });
    const repository = new AggregatesRepository(database.db);
    const rows = await repository.getObservations(patchId);
    expect(rows.map((row) => row.matchId)).toEqual(["TR1_accepted"]);
    expect(rows[0]?.items).toEqual([{ itemId: 3031, quantity: 1, category: "CORE", normalizedBaseId: 3031 }]);
  });
});
