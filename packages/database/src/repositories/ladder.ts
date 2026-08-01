import { and, eq, sql } from "drizzle-orm";
import { ladderSnapshots } from "../schema";

const TIERS = new Set(["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]);
const DIVISIONS = new Set(["I", "II", "III", "IV"]);

export type LadderEntry = {
  puuid: string;
  tier: string;
  rank: string;
  queueType?: string;
};

export class LadderRepository {
  constructor(private readonly db: any) {}

  async snapshotLadder(runId: string, entries: readonly LadderEntry[]): Promise<void> {
    validateRunId(runId);
    const accepted = entries.filter(isAcceptedEntry);
    await this.db.transaction(async (tx: any) => {
      for (const entry of accepted) {
        await tx.insert(ladderSnapshots).values({
          runId,
          puuid: entry.puuid,
          queue: 420,
          tier: entry.tier,
          division: entry.rank,
          capturedAt: new Date()
        }).onConflictDoUpdate({
          target: [ladderSnapshots.runId, ladderSnapshots.puuid],
          set: {
            queue: 420,
            tier: entry.tier,
            division: entry.rank,
            capturedAt: new Date()
          }
        });
      }
    });
  }

  snapshot(runId: string, entries: readonly LadderEntry[]): Promise<void> {
    return this.snapshotLadder(runId, entries);
  }

  async loadOffset(runId: string, puuid: string): Promise<number> {
    validateRunId(runId);
    validatePuuid(puuid);
    const rows = await this.db.select({ offset: ladderSnapshots.nextMatchOffset }).from(ladderSnapshots).where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid))).limit(1);
    const offset = rows[0]?.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid discovery offset");
    return offset;
  }

  async setOffset(runId: string, puuid: string, offset: number): Promise<void> {
    validateRunId(runId);
    validatePuuid(puuid);
    validateOffset(offset);
    await this.db.update(ladderSnapshots)
      .set({ nextMatchOffset: sql`greatest(${ladderSnapshots.nextMatchOffset}, ${offset})` })
      .where(and(eq(ladderSnapshots.runId, runId), eq(ladderSnapshots.puuid, puuid)));
  }
}

export function isAcceptedEntry(entry: LadderEntry): boolean {
  return typeof entry.puuid === "string" && entry.puuid.length > 0 && TIERS.has(entry.tier) && DIVISIONS.has(entry.rank) && (entry.queueType === undefined || entry.queueType === "RANKED_SOLO_5x5");
}

export function validateRunId(runId: string): void {
  if (typeof runId !== "string" || runId.length === 0) throw new Error("invalid collection run");
}

export function validatePuuid(puuid: string): void {
  if (typeof puuid !== "string" || puuid.length === 0) throw new Error("invalid player identifier");
}

export function validateOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid discovery offset");
}
