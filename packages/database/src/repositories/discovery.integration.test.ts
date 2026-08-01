import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createMigratedTestDatabase } from "../test-utils";
import { collectionRuns, discoveredMatches, ladderSnapshots } from "../schema";
import { LadderRepository } from "./ladder";
import { MatchesRepository } from "./matches";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ladder and match discovery checkpoints", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let runId: string;

  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [run] = await database.db.insert(collectionRuns).values({}).returning({ id: collectionRuns.id });
    runId = run!.id;
  });

  afterEach(async () => {
    if (database) await database.close();
  });

  it("snapshots idempotently and saves overlapping pages with monotonic offsets", async () => {
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "DIAMOND", rank: "II", queueType: "RANKED_SOLO_5x5" }]);
    const matches = new MatchesRepository(database.db);
    await matches.savePage(runId, "private", 100, ["TR1_1", "TR1_2"]);
    await matches.savePage(runId, "private", 90, ["TR1_2", "TR1_3"]);
    const snapshots = await database.db.select().from(ladderSnapshots).where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, "private")));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.tier).toBe("DIAMOND");
    expect(snapshots[0]?.nextMatchOffset).toBe(100);
    expect(await database.db.select().from(discoveredMatches).where(eq(discoveredMatches.runId, runId))).toHaveLength(3);
  });

  it("serializes concurrent pages and counts unique work rows exactly", async () => {
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    const matches = new MatchesRepository(database.db);
    await Promise.all([
      matches.savePage(runId, "private", 100, ["TR1_1", "TR1_2"]),
      matches.savePage(runId, "private", 200, ["TR1_2", "TR1_3"]),
      matches.savePage(runId, "private", 150, ["TR1_3", "TR1_4"])
    ]);
    const rows = await database.db.select().from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
    const snapshot = await database.db.select().from(ladderSnapshots).where(eq(ladderSnapshots.runId, runId));
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(rows).toHaveLength(4);
    expect(snapshot[0]?.nextMatchOffset).toBe(200);
    expect(run?.matchesDiscovered).toBe(4);
  });

  it("persists lifecycle transitions and rejects terminal mutations", async () => {
    const runs = new (await import("./collection-runs")).CollectionRunRepository(database.db);
    await runs.updateStatus(runId, "RUNNING");
    await runs.updateStage(runId, "snapshot");
    await expect(runs.updateStage(runId, "discovery")).rejects.toThrow("regression");
    await runs.updateStatus(runId, "FAILED", { code: "DISCOVERY_FAILED", stage: "snapshot" });
    let row = await runs.get(runId);
    expect(row?.finishedAt).not.toBeNull();
    expect(row?.errorDetails).toEqual({ code: "DISCOVERY_FAILED", stage: "snapshot" });
    await runs.updateStatus(runId, "RUNNING");
    row = await runs.get(runId);
    expect(row?.finishedAt).toBeNull();
    expect(row?.errorDetails).toBeNull();
    await runs.updateStatus(runId, "COMPLETED");
    await expect(runs.updateStatus(runId, "RUNNING")).rejects.toThrow("transition");
    await expect(runs.updateCounters(runId, { matchesDiscovered: 1 })).rejects.toThrow("eligible");
    await expect(runs.updateStage(runId, "publish")).rejects.toThrow("eligible");
    await expect(runs.updateStatus(runId, "FAILED", { code: "DISCOVERY_FAILED", secret: "private" } as never)).rejects.toThrow("details");
  });

  it("keeps setOffset monotonic and rejects missing or terminal snapshots", async () => {
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    await ladder.setOffset(runId, "private", 100);
    await ladder.setOffset(runId, "private", 50);
    expect(await ladder.loadOffset(runId, "private")).toBe(100);
    await expect(ladder.setOffset(runId, "missing", 1)).rejects.toThrow("snapshot");
    const runs = new (await import("./collection-runs")).CollectionRunRepository(database.db);
    await runs.updateStatus(runId, "COMPLETED");
    await expect(ladder.setOffset(runId, "private", 200)).rejects.toThrow("eligible");
  });

  it("rolls back inserted work when the ladder checkpoint is missing", async () => {
    const matches = new MatchesRepository(database.db);
    await expect(matches.savePage(runId, "private", 10, ["TR1_900"])).rejects.toThrow("snapshot");
    expect(await database.db.select().from(discoveredMatches).where(eq(discoveredMatches.runId, runId))).toHaveLength(0);
    const [run] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(run?.matchesDiscovered).toBe(0);
  });

  it("allows the same match ID independently in different runs", async () => {
    const second = await database.db.insert(collectionRuns).values({}).returning({ id: collectionRuns.id });
    const secondRun = second[0]!.id;
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    await ladder.snapshotLadder(secondRun, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    const matches = new MatchesRepository(database.db);
    await matches.savePage(runId, "private", 1, ["TR1_77"]);
    await matches.savePage(secondRun, "private", 1, ["TR1_77"]);
    expect(await matches.uniqueMatchCount(runId)).toBe(1);
    expect(await matches.uniqueMatchCount(secondRun)).toBe(1);
  });
});
