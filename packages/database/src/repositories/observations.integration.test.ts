import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createMigratedTestDatabase } from "../test-utils";
import { collectionRuns, discoveredMatches, items, ladderSnapshots, matches, participantBoots, participantCoreItems, participantObservations, patches } from "../schema";
import { ObservationsRepository, type ParsedParticipant } from "./observations";

const url = process.env.TEST_DATABASE_URL;
const MATCH_ID = "TR1_424242";
const PRIVATE_PREFIX = "private-puuid-";

describe.skipIf(!url)("validated participant observations", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let runId: string;
  let patchId: number;
  let repository: ObservationsRepository;

  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    repository = new ObservationsRepository(database.db);
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "ingest" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [patch] = await database.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15", isActive: true }).returning({ id: patches.id });
    patchId = patch!.id;
    await database.db.insert(items).values([
      { patchId, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "test core", name: "Infinity Edge", price: 1000, iconUrl: "core" },
      { patchId, itemId: 3172, normalizedBaseId: 3172, category: "BOOTS", classificationReason: "test boots", name: "Zephyr", price: 1000, iconUrl: "boots" },
      { patchId, itemId: 1001, normalizedBaseId: 1001, category: "EXCLUDED_COMPONENT", classificationReason: "test component", name: "Boots", price: 300, iconUrl: "component" },
      { patchId, itemId: 2055, normalizedBaseId: 2055, category: "EXCLUDED_CONSUMABLE", classificationReason: "test consumable", name: "Control Ward", price: 75, iconUrl: "ward" }
    ]);
    await database.db.insert(discoveredMatches).values({ runId, matchId: MATCH_ID });
    await database.db.insert(ladderSnapshots).values(Array.from({ length: 8 }, (_, index) => ({ runId, puuid: `${PRIVATE_PREFIX}${index + 1}`, tier: "EMERALD" as const, division: "I" as const })));
  });

  afterEach(async () => { if (database) await database.close(); });

  it("persists accepted observations, normalized items, boots, and exact counters", async () => {
    const participants = acceptedParticipants();
    const result = await repository.saveValidatedMatch(runId, patchId, matchPayload(), participants);
    expect(result).toMatchObject({ observationsAccepted: 8, observationsRejected: 2, replay: false });
    const [match] = await database.db.select().from(matches).where(eq(matches.matchId, MATCH_ID));
    expect(match?.validationState).toBe("VALID");
    const observations = await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID));
    expect(observations).toHaveLength(8);
    expect(observations.every((row) => row.puuid.startsWith(PRIVATE_PREFIX))).toBe(true);
    const cores = await database.db.select().from(participantCoreItems).where(eq(participantCoreItems.matchId, MATCH_ID));
    expect(cores.find((row) => row.participantId === 1)).toMatchObject({ itemId: 3031, quantity: 2, slotIndex: 0 });
    expect(cores.some((row) => row.itemId === 1001 || row.itemId === 2055)).toBe(false);
    const boots = await database.db.select().from(participantBoots).where(eq(participantBoots.matchId, MATCH_ID));
    expect(boots).toHaveLength(1);
    expect(boots[0]).toMatchObject({ participantId: 1, itemId: 3172, slotIndex: 2 });
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(run).toMatchObject({ matchesIngested: 1, observationsAccepted: 8, observationsRejected: 2 });
  });

  it("makes identical replay idempotent", async () => {
    const participants = acceptedParticipants();
    await repository.saveValidatedMatch(runId, patchId, matchPayload(), participants);
    const before = {
      match: await database.db.select().from(matches).where(eq(matches.matchId, MATCH_ID)),
      observations: await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID)),
      cores: await database.db.select().from(participantCoreItems).where(eq(participantCoreItems.matchId, MATCH_ID)),
      boots: await database.db.select().from(participantBoots).where(eq(participantBoots.matchId, MATCH_ID)),
      run: await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId))
    };
    expect(await repository.saveValidatedMatch(runId, patchId, matchPayload(), participants)).toMatchObject({ replay: true });
    expect(await database.db.select().from(matches).where(eq(matches.matchId, MATCH_ID))).toEqual(before.match);
    expect(await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID))).toEqual(before.observations);
    expect(await database.db.select().from(participantCoreItems).where(eq(participantCoreItems.matchId, MATCH_ID))).toEqual(before.cores);
    expect(await database.db.select().from(participantBoots).where(eq(participantBoots.matchId, MATCH_ID))).toEqual(before.boots);
    expect(await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId))).toEqual(before.run);
  });

  it("fails the run durably on a differing replay without overwriting canonical rows", async () => {
    await repository.saveValidatedMatch(runId, patchId, matchPayload(), acceptedParticipants());
    const changed = acceptedParticipants();
    const first = changed[0]!;
    if (first.accepted) first.observation.win = !first.observation.win;
    await expect(repository.saveValidatedMatch(runId, patchId, matchPayload(), changed)).rejects.toThrow("match replay conflict");
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(run?.status).toBe("FAILED");
    expect(run?.errorDetails).toEqual({ code: "INGEST_FAILED", stage: "ingest" });
    expect(JSON.stringify(run?.errorDetails)).not.toContain(PRIVATE_PREFIX);
    expect(await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID))).toHaveLength(8);
  });

  it("rejects patch, missing run, and missing discovery atomically", async () => {
    const [otherPatch] = await database.db.insert(patches).values({ version: "16.14.1", patchKey: "16.14" }).returning({ id: patches.id });
    await expect(repository.saveValidatedMatch(runId, otherPatch!.id, matchPayload(), acceptedParticipants())).rejects.toThrow("patch mismatch");
    await expect(repository.saveValidatedMatch("00000000-0000-4000-8000-000000000000", patchId, matchPayload(), acceptedParticipants())).rejects.toThrow("run not found");
    const [otherRun] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "ingest" }).returning({ id: collectionRuns.id });
    await expect(repository.saveValidatedMatch(otherRun!.id, patchId, matchPayload(), acceptedParticipants())).rejects.toThrow("does not belong");
    expect(await database.db.select().from(matches).where(eq(matches.matchId, MATCH_ID))).toHaveLength(0);
    expect(await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID))).toHaveLength(0);
  });

  it("serializes concurrent identical saves and keeps exact counters", async () => {
    const participants = acceptedParticipants();
    const results = await Promise.allSettled([
      repository.saveValidatedMatch(runId, patchId, matchPayload(), participants),
      repository.saveValidatedMatch(runId, patchId, matchPayload(), participants)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(run).toMatchObject({ matchesIngested: 1, observationsAccepted: 8, observationsRejected: 2 });
  });

  it("persists rejected-only work without observations and counts remake rejections", async () => {
    const rejected: ParsedParticipant[] = [1, 2].map((participantId) => ({ accepted: false, participantId, reason: "remake" }));
    const result = await repository.saveValidatedMatch(runId, patchId, matchPayload(), rejected);
    expect(result).toMatchObject({ observationsAccepted: 0, observationsRejected: 2 });
    expect(await database.db.select().from(participantObservations).where(eq(participantObservations.matchId, MATCH_ID))).toHaveLength(0);
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(run).toMatchObject({ matchesIngested: 1, observationsAccepted: 0, observationsRejected: 2 });
  });
});

function matchPayload() {
  return { metadata: { matchId: MATCH_ID }, info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1_722_470_400_000, gameDuration: 1_800 } };
}

function acceptedParticipants(): ParsedParticipant[] {
  const accepted = Array.from({ length: 8 }, (_, index): ParsedParticipant => ({
    accepted: true,
    observation: {
      participantId: index + 1,
      puuid: `${PRIVATE_PREFIX}${index + 1}`,
      championId: index + 1,
      role: "BOTTOM",
      win: index % 2 === 0,
      tier: "EMERALD",
      division: "I",
      gameDuration: 1_800,
      rawFinalSlots: index === 0 ? [7002, 3031, 3172, 1001, 2055, 0, 0] : [0, 0, 0, 0, 0, 0, 0],
      coreItems: index === 0 ? [{ itemId: 3031, quantity: 2, slotIndex: 0 }] : [],
      boots: index === 0 ? { itemId: 3172, slotIndex: 2 } : undefined
    }
  }));
  return [...accepted, { accepted: false, participantId: 9, reason: "rank" }, { accepted: false, participantId: 10, reason: "role" }];
}
