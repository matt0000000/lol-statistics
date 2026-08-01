import { and, eq, sql } from "drizzle-orm";
import { collectionRuns, discoveredMatches, ladderSnapshots } from "../schema";
import { validateOffset, validatePuuid, validateRunId } from "./ladder";

const MATCH_ID = /^TR1_[0-9]+$/;

export type DiscoveryRepository = {
  loadOffset(runId: string, puuid: string): Promise<number>;
  savePage(runId: string, puuid: string, nextOffset: number, matchIds: readonly string[]): Promise<number>;
};

export class MatchesRepository implements DiscoveryRepository {
  constructor(private readonly db: any) {}

  async loadOffset(runId: string, puuid: string): Promise<number> {
    validateRunId(runId);
    validatePuuid(puuid);
    const rows = await this.db.select({ offset: ladderSnapshots.nextMatchOffset }).from(ladderSnapshots).where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid))).limit(1);
    const offset = rows[0]?.offset ?? 0;
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
      if (uniqueIds.length > 0) {
        await tx.insert(discoveredMatches).values(uniqueIds.map((matchId) => ({ runId, matchId }))).onConflictDoNothing({ target: [discoveredMatches.runId, discoveredMatches.matchId] });
      }
      const updated = await tx.update(ladderSnapshots)
        .set({ nextMatchOffset: sql`greatest(${ladderSnapshots.nextMatchOffset}, ${nextOffset})` })
        .where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid)))
        .returning({ offset: ladderSnapshots.nextMatchOffset });
      if (updated.length === 0) throw new Error("ladder snapshot not found");
      const countRows = await tx.select({ count: sql<number>`count(*)` }).from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
      const count = Number(countRows[0]?.count ?? 0);
      await tx.update(collectionRuns).set({ matchesDiscovered: count, updatedAt: new Date() }).where(eq(collectionRuns.id, runId));
      return count;
    });
  }

  async uniqueMatchCount(runId: string): Promise<number> {
    validateRunId(runId);
    const rows = await this.db.select({ count: sql<number>`count(*)` }).from(discoveredMatches).where(eq(discoveredMatches.runId, runId));
    return Number(rows[0]?.count ?? 0);
  }
}

export { MATCH_ID as matchIdPattern };

