import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, createMigratedTestDatabase, aggregatePublications, baselineAggregates, bootsAggregates, combinationAggregates, collectionRuns, itemAggregates, items, matches, participantCoreItems, participantObservations, patches, AggregatesRepository } from "@lol/database";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { publishAtomically } from "./publish";

const url = process.env.TEST_DATABASE_URL;
const ACTIVATION_ADVISORY_KEY = 2_147_400_001;
const BARRIER_TIMEOUT_MS = 3_000;

type BackendIdentity = { pid: number; applicationName: string };

function namedUrl(base: string, suffix: string): string {
  const parsed = new URL(base);
  parsed.searchParams.set("application_name", `lol_task6_${suffix}_${randomUUID().replaceAll("-", "")}`);
  return parsed.toString();
}

async function backendIdentity(client: ReturnType<typeof postgres>): Promise<BackendIdentity> {
  const rows = await client`SELECT pg_backend_pid() AS pid, current_setting('application_name') AS application_name`;
  const row = rows[0] as { pid: number; application_name: string } | undefined;
  if (!row) throw new Error("backend identity query returned no rows");
  return { pid: Number(row.pid), applicationName: row.application_name };
}

async function databaseIdentity(database: ReturnType<typeof createDatabase>): Promise<BackendIdentity> {
  const rows = await database.db.execute(sql`SELECT pg_backend_pid() AS pid, current_setting('application_name') AS application_name`);
  const row = rows[0] as { pid: number; application_name: string } | undefined;
  if (!row) throw new Error("database backend identity query returned no rows");
  return { pid: Number(row.pid), applicationName: row.application_name };
}

type LockExpectation = {
  identity: BackendIdentity;
  waitEvent: "advisory" | "transactionid" | "tuple" | readonly ["transactionid", "tuple"];
  queryFragment: string;
};

async function waitForLock(client: ReturnType<typeof postgres>, expected: LockExpectation, label: string): Promise<void> {
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  await client`SELECT set_config('statement_timeout', ${String(BARRIER_TIMEOUT_MS)}, false)`;
  while (Date.now() < deadline) {
    const rows = await client`
      SELECT pid, application_name, wait_event_type, wait_event, query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid = ${expected.identity.pid}
        AND application_name = ${expected.identity.applicationName}
    `;
    const waitEvents = Array.isArray(expected.waitEvent) ? expected.waitEvent : [expected.waitEvent];
    const observed = rows.some((row) => row.wait_event_type === "Lock" && waitEvents.includes(row.wait_event) && String(row.query).includes(expected.queryFragment));
    if (observed) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`${label} timed out`);
}

describe.skipIf(!url)("canonical publication activation PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  let productionDatabase: ReturnType<typeof createDatabase>;
  let barrierClient: ReturnType<typeof postgres>;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    barrierClient = postgres(namedUrl(database.url, "barrier"), { max: 1 });
    await barrierClient.unsafe("CREATE TABLE publication_test_control (id boolean PRIMARY KEY DEFAULT true, pause_activation boolean NOT NULL DEFAULT false, fail_activation boolean NOT NULL DEFAULT false)");
    await barrierClient.unsafe("INSERT INTO publication_test_control DEFAULT VALUES");
    await barrierClient.unsafe("CREATE FUNCTION publication_test_activation_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE control publication_test_control%ROWTYPE; BEGIN SELECT * INTO control FROM publication_test_control WHERE id = true; IF NEW.is_active AND control.fail_activation THEN RAISE EXCEPTION 'test activation failure'; END IF; IF NEW.is_active AND control.pause_activation THEN PERFORM pg_advisory_lock(2147400001); END IF; RETURN NEW; END; $$");
    await barrierClient.unsafe("CREATE TRIGGER publication_test_activation_guard BEFORE UPDATE OF is_active ON aggregate_publications FOR EACH ROW EXECUTE FUNCTION publication_test_activation_guard()");
    const [patch] = await database.db.insert(patches).values({ version: `99.2.${Date.now()}`, patchKey: "99.2", isActive: true }).returning({ id: patches.id });
    await database.db.insert(items).values([
      { patchId: patch!.id, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "fixture", name: "Core", price: 1000, iconUrl: "core" },
      { patchId: patch!.id, itemId: 6672, normalizedBaseId: 6672, category: "CORE", classificationReason: "fixture", name: "Core 2", price: 1000, iconUrl: "core-2" },
      { patchId: patch!.id, itemId: 6692, normalizedBaseId: 6692, category: "CORE", classificationReason: "fixture", name: "Core 3", price: 1000, iconUrl: "core-3" },
      { patchId: patch!.id, itemId: 3006, normalizedBaseId: 3006, category: "BOOTS", classificationReason: "fixture", name: "Boots", price: 1000, iconUrl: "boots" }
    ]);
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
    productionDatabase = createDatabase(namedUrl(database.url, "setup"), { max: 1 });
  });
  afterEach(async () => {
    if (barrierClient) await barrierClient.end();
    if (productionDatabase) await productionDatabase.close();
    if (database) await database.close();
  });

  async function setControl(pauseActivation: boolean, failActivation = false) {
    await database.db.execute(sql`UPDATE publication_test_control SET pause_activation = ${pauseActivation}, fail_activation = ${failActivation} WHERE id = true`);
  }

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

  it("serializes ensure(existing target) with publish at the shared run/target barrier", async () => {
    const patchId = (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!.patchId;
    await database.db.update(collectionRuns).set({ patchId }).where(eq(collectionRuns.id, runId));
    const holdClient = postgres(namedUrl(database.url, "ensure-hold"), { max: 1 });
    const ensureDatabase = createDatabase(namedUrl(database.url, "ensure-existing"), { max: 1 });
    const publishDatabase = createDatabase(namedUrl(database.url, "publish-existing"), { max: 1 });
    let ensure: Promise<unknown> | undefined;
    let publish: Promise<unknown> | undefined;
    let outcomes: PromiseSettledResult<unknown>[] | undefined;
    let held = false;
    try {
      await holdClient`BEGIN`;
      await holdClient`SELECT id FROM aggregate_publications WHERE id = ${publicationId} FOR UPDATE`;
      held = true;
      const ensureIdentity = await databaseIdentity(ensureDatabase);
      const publishIdentity = await databaseIdentity(publishDatabase);
      ensure = new AggregatesRepository(ensureDatabase.db).ensurePublicationTarget({ runId, patchId, coverageStartedAt: new Date(), minimumSample: 100 });
      await waitForLock(barrierClient, { identity: ensureIdentity, waitEvent: ["transactionid", "tuple"], queryFragment: "aggregate_publications" }, "ensure target lock barrier");
      publish = publishAtomically({ publicationId, runId, database: publishDatabase });
      await waitForLock(barrierClient, { identity: publishIdentity, waitEvent: ["transactionid", "tuple"], queryFragment: "aggregate_publications" }, "publish target lock barrier");
    } finally {
      try {
        if (held) await holdClient`ROLLBACK`;
      } finally {
        outcomes = await Promise.allSettled([...(ensure ? [ensure] : []), ...(publish ? [publish] : [])]);
        await ensureDatabase.close();
        await publishDatabase.close();
        await holdClient.end();
      }
    }
    expect(outcomes).toHaveLength(2);
    expect(outcomes?.every((result) => result.status === "fulfilled")).toBe(true);
    expect(await database.db.select().from(aggregatePublications).where(eq(aggregatePublications.runId, runId))).toHaveLength(1);
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.runId, runId))).filter((row) => row.isActive)).toHaveLength(1);
    expect((await database.db.select({ status: collectionRuns.status, publicationId: collectionRuns.publicationId }).from(collectionRuns).where(eq(collectionRuns.id, runId)))[0]).toMatchObject({ status: "COMPLETED", publicationId });
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

  it("serializes a flush already waiting on the target lock against activation", async () => {
    await setControl(true);
    await barrierClient`SELECT pg_advisory_lock(${ACTIVATION_ADVISORY_KEY})`;
    const activationDatabase = createDatabase(namedUrl(database.url, "activation"), { max: 1 });
    const flushDatabase = createDatabase(namedUrl(database.url, "flush"), { max: 1 });
    let activationIdentity!: BackendIdentity;
    let flushIdentity!: BackendIdentity;
    const repository = new AggregatesRepository(flushDatabase.db);
    let activation: Promise<unknown> | undefined;
    let flush: Promise<unknown> | undefined;
    let outcomes: PromiseSettledResult<unknown>[] | undefined;
    try {
      activationIdentity = await databaseIdentity(activationDatabase);
      flushIdentity = await databaseIdentity(flushDatabase);
      await repository.preparePublication({ publicationId, runId, patchId: (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!.patchId });
      activation = publishAtomically({ publicationId, runId, database: activationDatabase });
      await waitForLock(barrierClient, { identity: activationIdentity, waitEvent: "advisory", queryFragment: "aggregate_publications" }, "activation lock barrier");
      flush = repository.flushGroup({ championId: 1, role: "TOP", baseline: { wins: 1, losses: 0, sample: 1 }, items: new Map(), pairs: new Map(), trios: new Map(), boots: new Map() });
      await waitForLock(barrierClient, { identity: flushIdentity, waitEvent: ["transactionid", "tuple"], queryFragment: "collection_runs" }, "flush run-lock attempt");
    } finally {
      try {
        await barrierClient`SELECT pg_advisory_unlock(${ACTIVATION_ADVISORY_KEY})`;
      } finally {
        try {
          outcomes = await Promise.allSettled([...(activation ? [activation] : []), ...(flush ? [flush] : [])]);
        } finally {
          try {
            await activationDatabase.close();
          } finally {
            await flushDatabase.close();
          }
        }
      }
    }
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
    expect((outcomes[1] as PromiseRejectedResult).reason).toMatchObject({ message: expect.stringContaining("aggregate sink owner is no longer valid") });
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]?.isActive).toBe(true);
    expect(await new AggregatesRepository(database.db).rows(publicationId)).toEqual([]);
  });

  it("proves overlapping publication attempts serialize with an unchanged loser", async () => {
    const patchRow = (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!;
    const [priorRun] = await database.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish" }).returning({ id: collectionRuns.id });
    await database.db.insert(aggregatePublications).values({ patchId: patchRow.patchId, runId: priorRun!.id, coverageStartedAt: new Date(), isActive: true });
    const [otherRun] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    const [otherPublication] = await database.db.insert(aggregatePublications).values({ patchId: patchRow.patchId, runId: otherRun!.id, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    await setControl(true);
    await barrierClient`SELECT pg_advisory_lock(${ACTIVATION_ADVISORY_KEY})`;
    const firstDatabase = createDatabase(namedUrl(database.url, "first-publish"), { max: 1 });
    const secondDatabase = createDatabase(namedUrl(database.url, "second-publish"), { max: 1 });
    let firstIdentity!: BackendIdentity;
    let secondIdentity!: BackendIdentity;
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    let outcomes: PromiseSettledResult<unknown>[] | undefined;
    try {
      firstIdentity = await databaseIdentity(firstDatabase);
      secondIdentity = await databaseIdentity(secondDatabase);
      first = publishAtomically({ publicationId, runId, database: firstDatabase });
      await waitForLock(barrierClient, { identity: firstIdentity, waitEvent: "advisory", queryFragment: "aggregate_publications" }, "first publication entry");
      second = publishAtomically({ publicationId: otherPublication!.id, runId: otherRun!.id, database: secondDatabase });
      await waitForLock(barrierClient, { identity: secondIdentity, waitEvent: ["transactionid", "tuple"], queryFragment: "aggregate_publications" }, "second publication lock overlap");
    } finally {
      try {
        await barrierClient`SELECT pg_advisory_unlock(${ACTIVATION_ADVISORY_KEY})`;
      } finally {
        try {
          outcomes = await Promise.allSettled([...(first ? [first] : []), ...(second ? [second] : [])]);
        } finally {
          try {
            await firstDatabase.close();
          } finally {
            await secondDatabase.close();
          }
        }
      }
    }
    expect(outcomes[0]?.status).toBe("fulfilled");
    expect(outcomes[1]?.status).toBe("rejected");
    const publications = await database.db.select({ id: aggregatePublications.id, isActive: aggregatePublications.isActive }).from(aggregatePublications);
    expect(publications.filter((row) => row.isActive)).toHaveLength(1);
    expect(publications.find((row) => row.id === publicationId)?.isActive).toBe(true);
    expect(publications.find((row) => row.id === otherPublication!.id)?.isActive).toBe(false);
    const winner = (await database.db.select({ status: collectionRuns.status, publicationId: collectionRuns.publicationId }).from(collectionRuns).where(eq(collectionRuns.id, runId)))[0]!;
    expect(winner).toEqual({ status: "COMPLETED", publicationId });
    expect((await database.db.select({ isActive: patches.isActive, publishedAt: patches.publishedAt, activePublicationId: patches.activePublicationId }).from(patches).where(eq(patches.id, patchRow.patchId)))[0]).toMatchObject({ isActive: true, publishedAt: expect.any(Date), activePublicationId: publicationId });
    const loser = (await database.db.select({ status: collectionRuns.status, publicationId: collectionRuns.publicationId }).from(collectionRuns).where(eq(collectionRuns.id, otherRun!.id)))[0]!;
    expect(loser).toEqual({ status: "RUNNING", publicationId: null });
  });

  it("rolls back a test-only database trigger failure with a complete snapshot", async () => {
    const [priorRun] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    const [priorPublication] = await database.db.insert(aggregatePublications).values({ patchId: (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)).limit(1))[0]!.patchId, runId: priorRun!.id, coverageStartedAt: new Date(), isActive: true }).returning({ id: aggregatePublications.id });
    await database.db.update(collectionRuns).set({ status: "COMPLETED", publicationId: priorPublication!.id }).where(eq(collectionRuns.id, priorRun!.id));
    const patchId = (await database.db.select({ patchId: aggregatePublications.patchId }).from(aggregatePublications).where(eq(aggregatePublications.id, publicationId)))[0]!.patchId;
    const patchBefore = (await database.db.select({ isActive: patches.isActive, publishedAt: patches.publishedAt }).from(patches).where(eq(patches.id, patchId)))[0]!;
    const publicationsBefore = await database.db.select({ id: aggregatePublications.id, isActive: aggregatePublications.isActive }).from(aggregatePublications);
    const runsBefore = await database.db.select({ id: collectionRuns.id, status: collectionRuns.status, publicationId: collectionRuns.publicationId }).from(collectionRuns);
    const aggregatesBefore = await Promise.all([database.db.select().from(baselineAggregates), database.db.select().from(itemAggregates), database.db.select().from(combinationAggregates), database.db.select().from(bootsAggregates)]);
    await setControl(false, true);
    await expect(publishAtomically({ publicationId, runId, database: productionDatabase })).rejects.toThrow("test activation failure");
    expect(await database.db.select({ id: aggregatePublications.id, isActive: aggregatePublications.isActive }).from(aggregatePublications)).toEqual(publicationsBefore);
    expect(await database.db.select({ id: collectionRuns.id, status: collectionRuns.status, publicationId: collectionRuns.publicationId }).from(collectionRuns)).toEqual(runsBefore);
    expect((await database.db.select({ isActive: patches.isActive, publishedAt: patches.publishedAt }).from(patches).where(eq(patches.id, patchId)))[0]).toEqual(patchBefore);
    expect(await Promise.all([database.db.select().from(baselineAggregates), database.db.select().from(itemAggregates), database.db.select().from(combinationAggregates), database.db.select().from(bootsAggregates)])).toEqual(aggregatesBefore);
  });
});
