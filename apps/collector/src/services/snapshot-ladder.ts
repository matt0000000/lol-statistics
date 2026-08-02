import type { LeagueEntry } from "@lol/riot-client";

export type SnapshotErrorCode = "invalid_input" | "invalid_response" | "dependency_failure";
export class SnapshotServiceError extends Error {
  readonly category?: "auth" | "rate_limit" | "server" | "network";
  constructor(readonly code: SnapshotErrorCode, message = `ladder snapshot failed (${code})`, options: { cause?: unknown } = {}) {
    super(message, options);
    this.category = safeCategory(options.cause);
  }
}

export type SnapshotLadderInput = {
  runId: string;
  leagueClient: { listEligiblePlayers(): Promise<readonly LeagueEntry[]> };
  repository: { snapshotLadder(runId: string, entries: readonly LeagueEntry[]): Promise<void> };
  logger?: { info?: (fields: Record<string, unknown>) => void };
};

export async function snapshotLadder(input: SnapshotLadderInput): Promise<void> {
  if (typeof input.runId !== "string" || input.runId.length === 0) throw new SnapshotServiceError("invalid_input");
  try {
    emitInfo(input.logger, { event: "ladder_fetch_started", runId: input.runId, stage: "LADDER" });
    const entries = await input.leagueClient.listEligiblePlayers();
    if (!Array.isArray(entries)) throw new SnapshotServiceError("invalid_response");
    emitInfo(input.logger, { event: "ladder_fetch_completed", runId: input.runId, stage: "LADDER", aggregateCount: entries.length });
    emitInfo(input.logger, { event: "ladder_persist_started", runId: input.runId, stage: "LADDER", aggregateCount: entries.length });
    await input.repository.snapshotLadder(input.runId, entries);
    emitInfo(input.logger, { event: "ladder_persist_completed", runId: input.runId, stage: "LADDER", aggregateCount: entries.length });
  } catch (error) {
    if (error instanceof SnapshotServiceError) throw error;
    throw new SnapshotServiceError("dependency_failure", undefined, { cause: error });
  }
}

function emitInfo(logger: SnapshotLadderInput["logger"], fields: Record<string, unknown>): void {
  try {
    logger?.info?.(fields);
  } catch {
    // Lifecycle diagnostics are best-effort and must not affect snapshot behavior.
  }
}

function safeCategory(error: unknown): SnapshotServiceError["category"] {
  if (!error || typeof error !== "object") return undefined;
  const category = (error as { category?: unknown }).category;
  return category === "auth" || category === "rate_limit" || category === "server" || category === "network" ? category : undefined;
}
