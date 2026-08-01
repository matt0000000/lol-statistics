import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, createMigratedTestDatabase, aggregatePublications, baselineAggregates, collectionRuns, itemAggregates, items, matches, participantCoreItems, participantObservations, patches } from "@lol/database";
import { eq } from "drizzle-orm";
import { publishAtomically } from "./publish";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("canonical publication activation PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  let productionDatabase: ReturnType<typeof createDatabase>;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [patch] = await database.db.insert(patches).values({ version: `99.2.${Date.now()}`, patchKey: "99.2", isActive: true }).returning({ id: patches.id });
    await database.db.insert(items).values([
      { patchId: patch!.id, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "fixture", name: "Core", price: 1000, iconUrl: "core" },
      { patchId: patch!.id, itemId: 3006, normalizedBaseId: 3006, category: "BOOTS", classificationReason: "fixture", name: "Boots", price: 1000, iconUrl: "boots" }
    ]);
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
    productionDatabase = createDatabase(database.url);
  });
  afterEach(async () => { if (productionDatabase) await productionDatabase.close(); if (database) await database.close(); });

  async function seedAcceptedObservation() {
    const now = new Date();
    const patchRow = (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!;
    await database.db.insert(matches).values({ matchId: "TR1_publish", patchId: patchRow.patchId, platformId: "TR1", queueId: 420, gameVersion: "99.2.1", gameCreation: now, gameDuration: 1800, validationState: "VALID" });
    await database.db.insert(participantObservations).values({ matchId: "TR1_publish", participantId: 1, patchId: patchRow.patchId, puuid: "private", championId: 1, role: "TOP", win: true, tier: "EMERALD", division: "I", gameDuration: 1800, rawFinalSlots: [] });
    await database.db.insert(participantCoreItems).values({ matchId: "TR1_publish", participantId: 1, patchId: patchRow.patchId, slotIndex: 0, itemId: 3031, quantity: 1 });
    return patchRow.patchId;
  }

  async function seedCanonicalRows() {
    const patchId = await seedAcceptedObservation();
    await database.db.insert(baselineAggregates).values({ publicationId, championId: 1, role: "TOP", wins: 1, losses: 0, sample: 1 });
    await database.db.insert(itemAggregates).values({ publicationId, championId: 1, role: "TOP", itemId: 3031, wins: 1, losses: 0, sample: 1 });
    expect(patchId).toBeGreaterThan(0);
  }

  it("activates an empty canonical publication and marks its run atomically", async () => {
    await publishAtomically({ publicationId, runId, database: productionDatabase });
    const [publication] = await database.db.select().from(aggregatePublications);
    const [run] = await database.db.select().from(collectionRuns);
    expect(publication?.isActive).toBe(true);
    expect(run?.publicationId).toBe(publicationId);
    expect(run?.status).toBe("COMPLETED");
  });

  it("activates a valid nonempty catalog/source target and switches a seeded active publication", async () => {
    await database.db.insert(aggregatePublications).values({ patchId: (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!.patchId, runId: (await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id }))[0]!.id, coverageStartedAt: new Date(), isActive: true });
    await seedCanonicalRows();
    await publishAtomically({ publicationId, runId, database: productionDatabase });
    const publications = await database.db.select().from(aggregatePublications);
    const run = (await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId)))[0]!;
    expect(publications.filter((row) => row.isActive)).toHaveLength(1);
    expect(publications.find((row) => row.id === publicationId)?.isActive).toBe(true);
    expect(run.status).toBe("COMPLETED");
    expect(run.publicationId).toBe(publicationId);
  });

  it("rejects missing baseline and preserves the prior active publication", async () => {
    await database.db.update(aggregatePublications).set({ isActive: true }).where(eq(aggregatePublications.id, publicationId));
    await database.db.insert(itemAggregates).values({ publicationId, championId: 1, role: "TOP", itemId: 3031, wins: 1, losses: 0, sample: 1 });
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toThrow("publication invariants failed");
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]?.isActive).toBe(true);
  });

  it.each([
    ["wrong run id", "00000000-0000-4000-8000-000000000099"],
    ["wrong owner run", "00000000-0000-4000-8000-000000000098"]
  ])("rejects %s without changing target state", async (_label, wrongRunId) => {
    await expect(publishAtomically({ publicationId, runId: wrongRunId, database: productionDatabase })).rejects.toBeDefined();
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]?.isActive).toBe(false);
  });

  it("rejects a publication whose patch owner no longer matches the active patch", async () => {
    const [otherPatch] = await database.db.insert(patches).values({ version: `99.3.${Date.now()}`, patchKey: "99.3", isActive: false }).returning({ id: patches.id });
    await database.db.update(aggregatePublications).set({ patchId: otherPatch!.id }).where(eq(aggregatePublications.id, publicationId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toBeDefined();
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]?.isActive).toBe(false);
  });

  it("rejects an already-active target", async () => {
    await database.db.update(aggregatePublications).set({ isActive: true }).where(eq(aggregatePublications.id, publicationId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toBeDefined();
  });

  it.each(["FAILED", "COMPLETED"] as const)("rejects a run in %s status", async (status) => {
    await database.db.update(collectionRuns).set({ status }).where(eq(collectionRuns.id, runId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toBeDefined();
    expect((await database.db.select({ status: collectionRuns.status }).from(collectionRuns).where(eq(collectionRuns.id, runId)))[0]?.status).toBe(status);
  });

  it("rejects a run outside the publish stage", async () => {
    await database.db.update(collectionRuns).set({ stage: "aggregate" }).where(eq(collectionRuns.id, runId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toBeDefined();
  });

  it("rejects an empty catalog from a fresh database target", async () => {
    const patchRow = (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!;
    await database.db.delete(items).where(eq(items.patchId, patchRow.patchId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toThrow("publication invariants failed");
  });

  it.each([
    ["wrong queue", { queueId: 450 }],
    ["wrong platform", { platformId: "EUW1" }],
    ["rejected source", { validationState: "REJECTED" as const }]
  ])("rejects an %s source row with no aggregate mutation", async (_label, change) => {
    const patchId = await seedAcceptedObservation();
    await database.db.update(matches).set(change).where(eq(matches.matchId, "TR1_publish"));
    await database.db.insert(baselineAggregates).values({ publicationId, championId: 1, role: "TOP", wins: 1, losses: 0, sample: 1 });
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toThrow("publication invariants failed");
    expect((await database.db.select().from(baselineAggregates).where(eq(baselineAggregates.publicationId, publicationId))).length).toBe(1);
    expect(patchId).toBeGreaterThan(0);
  });

  it("rolls back natural publish failure without deactivating the prior target", async () => {
    await database.db.update(aggregatePublications).set({ isActive: true }).where(eq(aggregatePublications.id, publicationId));
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toBeDefined();
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]?.isActive).toBe(true);
  });
});
