import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createMigratedTestDatabase } from "../test-utils";
import { collectionRuns, discoveredMatches, ladderSnapshots } from "../schema";
import { LadderRepository } from "./ladder";
import { MatchesRepository } from "./matches";
import { CollectionRunRepository } from "./collection-runs";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ladder and match discovery checkpoints", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let runId: string;

  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [run] = await database.db.insert(collectionRuns).values({}).returning({ id: collectionRuns.id });
    runId = run!.id;
  });

  it("persists the repository's exact coverage start for a configured run", async () => {
    const now = new Date("2026-08-02T00:00:00.000Z");
    const run = await new CollectionRunRepository(database.db, { now: () => now }).resumeOrCreate({ coverageDays: 7, minimumSample: 0 });
    expect(run.startedAt).toEqual(now);
    expect(run.coverageStartedAt).toEqual(new Date(now.getTime() - 7 * 86_400_000));
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

  it("marks Riot 404 matches unavailable and never returns them as pending", async () => {
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    const matches = new MatchesRepository(database.db);
    await matches.savePage(runId, "private", 2, ["TR1_404", "TR1_200"]);
    await matches.markUnavailable(runId, "TR1_404");
    expect(await matches.pending(runId)).toEqual([{ matchId: "TR1_200" }]);
    const [unavailable] = await database.db.select().from(discoveredMatches).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.matchId, "TR1_404")));
    expect(unavailable).toMatchObject({ status: "UNAVAILABLE", unavailableReason: "not_found" });
    await matches.markUnavailable(runId, "TR1_404");
    expect(await matches.pending(runId)).toEqual([{ matchId: "TR1_200" }]);
  });

  it("marks processed matches idempotently while preserving unavailable rows", async () => {
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    const matches = new MatchesRepository(database.db);
    await matches.savePage(runId, "private", 2, ["TR1_200", "TR1_404"]);
    await matches.markProcessed(runId, "TR1_200");
    await matches.markProcessed(runId, "TR1_200");
    await matches.markUnavailable(runId, "TR1_404");
    await matches.markProcessed(runId, "TR1_404");
    expect(await matches.pending(runId)).toEqual([]);
    const rows = await database.db.select().from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ matchId: "TR1_200", status: "PROCESSED", unavailableReason: null }),
      expect.objectContaining({ matchId: "TR1_404", status: "UNAVAILABLE", unavailableReason: "not_found" })
    ]));
  });

  it("serializes counter updates against terminal status", async () => {
    const { CollectionRunRepository } = await import("./collection-runs");
    const runs = new CollectionRunRepository(database.db);
    await runs.updateStatus(runId, "RUNNING");
    const [terminal, counter] = await Promise.allSettled([
      runs.updateStatus(runId, "COMPLETED"),
      runs.incrementCounters(runId, { matchesIngested: 1 })
    ]);
    const [row] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(row?.status).toBe("COMPLETED");
    expect(row?.matchesIngested === 0 || row?.matchesIngested === 1).toBe(true);
    if (counter.status === "fulfilled") expect(row?.matchesIngested).toBe(1);
    else {
      expect(counter.reason).toMatchObject({ message: "collection run is not eligible" });
      expect(row?.matchesIngested).toBe(0);
    }
    expect(terminal.status).toBe("fulfilled");
    await expect(runs.incrementCounters(runId, { matchesIngested: 1 })).rejects.toThrow("collection run is not eligible");
    const [after] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(after?.matchesIngested).toBe(row?.matchesIngested);
  });

  it("serializes setOffset against terminal status and preserves repeat offsets", async () => {
    const { CollectionRunRepository } = await import("./collection-runs");
    const runs = new CollectionRunRepository(database.db);
    const ladder = new LadderRepository(database.db);
    await ladder.snapshotLadder(runId, [{ puuid: "private", tier: "EMERALD", rank: "I", queueType: "RANKED_SOLO_5x5" }]);
    await ladder.setOffset(runId, "private", 10);
    await ladder.setOffset(runId, "private", 10);
    const [terminal, offset] = await Promise.allSettled([
      runs.updateStatus(runId, "COMPLETED"),
      ladder.setOffset(runId, "private", 20)
    ]);
    expect(terminal.status).toBe("fulfilled");
    const [snapshot] = await database.db.select().from(ladderSnapshots).where(eq(ladderSnapshots.runId, runId));
    expect(snapshot?.nextMatchOffset === 10 || snapshot?.nextMatchOffset === 20).toBe(true);
    if (offset.status === "fulfilled") expect(snapshot?.nextMatchOffset).toBe(20);
    else expect(offset.reason).toMatchObject({ message: "collection run is not eligible" });
    await expect(ladder.setOffset(runId, "private", 30)).rejects.toThrow("collection run is not eligible");
    const [after] = await database.db.select().from(ladderSnapshots).where(eq(ladderSnapshots.runId, runId));
    expect(after?.nextMatchOffset).toBe(snapshot?.nextMatchOffset);
  });

  it("serializes absolute counter updates against terminal status", async () => {
    const { CollectionRunRepository } = await import("./collection-runs");
    const runs = new CollectionRunRepository(database.db);
    await runs.updateStatus(runId, "RUNNING");
    const [terminal, counter] = await Promise.allSettled([
      runs.updateStatus(runId, "COMPLETED"),
      runs.updateCounters(runId, { matchesDiscovered: 7 })
    ]);
    expect(terminal.status).toBe("fulfilled");
    const [row] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    if (counter.status === "fulfilled") expect(row?.matchesDiscovered).toBe(7);
    else {
      expect(counter.reason).toMatchObject({ message: "collection run is not eligible" });
      expect(row?.matchesDiscovered).toBe(0);
    }
    await expect(runs.updateCounters(runId, { matchesDiscovered: 9 })).rejects.toThrow("collection run is not eligible");
    const [after] = await database.db.select().from(collectionRuns).where(eq(collectionRuns.id, runId));
    expect(after?.matchesDiscovered).toBe(row?.matchesDiscovered);
  });

  it("rolls back malformed error details without leaking secrets", async () => {
    const { CollectionRunRepository } = await import("./collection-runs");
    const runs = new CollectionRunRepository(database.db);
    const before = await runs.get(runId);
    await expect(runs.updateStatus(runId, "FAILED", { code: "DISCOVERY_FAILED", puuid: "secret-puuid" } as never)).rejects.toThrow("invalid collection error details");
    const after = await runs.get(runId);
    expect(after?.status).toBe(before?.status);
    expect(after?.finishedAt).toBe(before?.finishedAt);
    expect(after?.errorDetails).toEqual(before?.errorDetails);
    expect(JSON.stringify(after)).not.toContain("secret-puuid");
  });
});
