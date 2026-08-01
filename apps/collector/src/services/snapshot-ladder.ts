import type { LeagueEntry } from "@lol/riot-client";

export type SnapshotLadderInput = {
  runId: string;
  leagueClient: { listEligiblePlayers(): Promise<readonly LeagueEntry[]> };
  repository: { snapshotLadder(runId: string, entries: readonly LeagueEntry[]): Promise<void> };
};

export async function snapshotLadder(input: SnapshotLadderInput): Promise<void> {
  if (typeof input.runId !== "string" || input.runId.length === 0) throw new Error("invalid collection run");
  try {
    const entries = await input.leagueClient.listEligiblePlayers();
    if (!Array.isArray(entries)) throw new Error("invalid ladder response");
    await input.repository.snapshotLadder(input.runId, entries);
  } catch {
    throw new Error("ladder snapshot failed");
  }
}
