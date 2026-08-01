import type { LeagueEntry } from "@lol/riot-client";

export type SnapshotErrorCode = "invalid_input" | "invalid_response" | "dependency_failure";
export class SnapshotServiceError extends Error {
  constructor(readonly code: SnapshotErrorCode, message = `ladder snapshot failed (${code})`) { super(message); }
}

export type SnapshotLadderInput = {
  runId: string;
  leagueClient: { listEligiblePlayers(): Promise<readonly LeagueEntry[]> };
  repository: { snapshotLadder(runId: string, entries: readonly LeagueEntry[]): Promise<void> };
};

export async function snapshotLadder(input: SnapshotLadderInput): Promise<void> {
  if (typeof input.runId !== "string" || input.runId.length === 0) throw new SnapshotServiceError("invalid_input");
  try {
    const entries = await input.leagueClient.listEligiblePlayers();
    if (!Array.isArray(entries)) throw new SnapshotServiceError("invalid_response");
    await input.repository.snapshotLadder(input.runId, entries);
  } catch (error) {
    if (error instanceof SnapshotServiceError) throw error;
    throw new SnapshotServiceError("dependency_failure");
  }
}
