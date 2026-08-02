import { and, eq, sql } from "drizzle-orm";
import { collectionRuns, discoveredMatches, ladderSnapshots } from "../schema";
import { assertEligibleRun, validateOffset, validatePuuid, validateRunId } from "./ladder";

const MATCH_ID = /^TR1_[0-9]+$/;

export type DiscoveryRepository = {
  loadOffset(runId: string, puuid: string): Promise<number>;
  savePage(runId: string, puuid: string, nextOffset: number, matchIds: readonly string[]): Promise<number>;
  markUnavailable?: (runId: string, matchId: string) => Promise<void>;
  pending?: (runId: string) => Promise<{ matchId: string }[]>;
  markProcessed?: (runId: string, matchId: string) => Promise<void>;
};

export class MatchesRepository implements DiscoveryRepository {
  constructor(private readonly db: any) {}

  async loadOffset(runId: string, puuid: string): Promise<number> {
    validateRunId(runId);
    validatePuuid(puuid);
    await assertEligibleRun(this.db, runId, false);
    const rows = await this.db.select({ offset: ladderSnapshots.nextMatchOffset }).from(ladderSnapshots).where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid))).limit(1);
    if (!rows[0]) throw new Error("ladder snapshot not found");
    const offset = rows[0].offset;
    validateOffset(offset);
    return offset;
  }

  async savePage(runId: string, puuid: string, nextOffset: number, matchIds: readonly string[]): Promise<number> {
    validateRunId(runId);
    validatePuuid(puuid);
    validateOffset(nextOffset);
    if (!Array.isArray(matchIds) || matchIds.some((id) => typeof id !== "string" || !MATCH_ID.test(id))) throw new Error("invalid match identifier");
    const uniqueIds = [...new Set(matchIds)];
    return this.db.transaction(async (tx: any) => {
      await assertEligibleRun(tx, runId, true);
      if (uniqueIds.length > 0) {
        await tx.insert(discoveredMatches).values(uniqueIds.map((matchId) => ({ runId, matchId, status: "PENDING" as const }))).onConflictDoNothing({ target: [discoveredMatches.runId, discoveredMatches.matchId] });
      }
      const updated = await tx.update(ladderSnapshots)
        .set({ nextMatchOffset: sql`greatest(${ladderSnapshots.nextMatchOffset}, ${nextOffset})` })
        .where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid)))
        .returning({ offset: ladderSnapshots.nextMatchOffset });
      if (updated.length === 0) throw new Error("ladder snapshot not found");
      const countRows = await tx.select({ count: sql<number>`count(*)` }).from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
      const count = Number(countRows[0]?.count ?? 0);
      const runUpdate = await tx.update(collectionRuns).set({ matchesDiscovered: count, updatedAt: new Date() }).where(eq(collectionRuns.id, runId)).returning({ id: collectionRuns.id });
      if (runUpdate.length === 0) throw new Error("collection run not found");
      return count;
    });
  }

  /** Durably records a typed Riot 404 without retaining the response body or identifiers. */
  async markUnavailable(runId: string, matchId: string): Promise<void> {
    validateRunId(runId);
    if (!MATCH_ID.test(matchId)) throw new Error("invalid match identifier");
    await this.db.transaction(async (tx: any) => {
      await assertEligibleRun(tx, runId, true);
      const updated = await tx.update(discoveredMatches).set({ status: "UNAVAILABLE", unavailableReason: "not_found" }).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.matchId, matchId), eq(discoveredMatches.status, "PENDING"))).returning({ matchId: discoveredMatches.matchId });
      if (updated.length === 1) {
        await tx.update(collectionRuns).set({ matchesIngested: sql`${collectionRuns.matchesIngested} + 1`, updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
      } else {
        const existing = await tx.select({ matchId: discoveredMatches.matchId }).from(discoveredMatches).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.matchId, matchId))).limit(1);
        if (!existing[0]) throw new Error("discovered match not found");
      }
    });
  }

  async pending(runId: string): Promise<{ matchId: string }[]> {
    validateRunId(runId);
    return this.db.select({ matchId: discoveredMatches.matchId }).from(discoveredMatches).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.status, "PENDING")));
  }

  async markProcessed(runId: string, matchId: string): Promise<void> {
    validateRunId(runId);
    if (!MATCH_ID.test(matchId)) throw new Error("invalid match identifier");
    await this.db.update(discoveredMatches).set({ status: "PROCESSED" }).where(and(eq(discoveredMatches.runId, runId), eq(discoveredMatches.matchId, matchId), eq(discoveredMatches.status, "PENDING")));
  }

  async uniqueMatchCount(runId: string): Promise<number> {
    validateRunId(runId);
    const rows = await this.db.select({ count: sql<number>`count(*)` }).from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
    return Number(rows[0]?.count ?? 0);
  }
}

export { MATCH_ID as matchIdPattern };
