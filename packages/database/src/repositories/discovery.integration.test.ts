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
});
