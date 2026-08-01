import type { MatchClient } from "@lol/riot-client";
import type { DiscoveryRepository } from "@lol/database";

export type DiscoverMatchesInput = {
  runId: string;
  puuid: string;
  coverageStart: Date;
  matchClient: Pick<MatchClient, "listMatchIds">;
  repository: DiscoveryRepository;
};

export type DiscoveryErrorCode = "invalid_input" | "invalid_response" | "invalid_checkpoint" | "dependency_failure";
export class DiscoveryServiceError extends Error {
  readonly category?: "auth" | "rate_limit" | "server" | "network";
  constructor(readonly code: DiscoveryErrorCode, message = `match discovery failed (${code})`, options: { cause?: unknown } = {}) {
    super(message, options);
    this.category = safeCategory(options.cause);
  }
}

export async function discoverMatches(input: DiscoverMatchesInput): Promise<void> {
  try { validateInput(input); } catch { throw new DiscoveryServiceError("invalid_input"); }
  try {
    const startTime = Math.floor(input.coverageStart.getTime() / 1_000);
    let start: number;
    try { start = await input.repository.loadOffset(input.runId, input.puuid); }
    catch (cause) { throw new DiscoveryServiceError("dependency_failure", undefined, { cause }); }
    try { validateOffset(start); } catch { throw new DiscoveryServiceError("invalid_checkpoint"); }
    for (;;) {
      let ids: string[];
      try { ids = await input.matchClient.listMatchIds({ puuid: input.puuid, startTime, start }); }
      catch (cause) { throw new DiscoveryServiceError("dependency_failure", undefined, { cause }); }
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^TR1_[0-9]+$/.test(id)) || ids.length > 100) throw new DiscoveryServiceError("invalid_response");
      const next = start + ids.length;
      if (!Number.isSafeInteger(next) || next <= start && ids.length > 0) throw new DiscoveryServiceError("invalid_checkpoint");
      try { await input.repository.savePage(input.runId, input.puuid, next, ids); }
      catch (cause) { throw new DiscoveryServiceError("dependency_failure", undefined, { cause }); }
      start = next;
      if (ids.length < 100) return;
    }
  } catch (error) {
    if (error instanceof DiscoveryServiceError) throw error;
    throw new DiscoveryServiceError("dependency_failure", undefined, { cause: error });
  }
}

function safeCategory(error: unknown): DiscoveryServiceError["category"] {
  if (!error || typeof error !== "object") return undefined;
  const category = (error as { category?: unknown }).category;
  return category === "auth" || category === "rate_limit" || category === "server" || category === "network" ? category : undefined;
}

function validateInput(input: DiscoverMatchesInput): void {
  if (typeof input.runId !== "string" || input.runId.length === 0) throw new Error("invalid collection run");
  if (typeof input.puuid !== "string" || input.puuid.length === 0) throw new Error("invalid player identifier");
  if (!(input.coverageStart instanceof Date) || !Number.isFinite(input.coverageStart.getTime())) throw new Error("invalid coverage date");
}

function validateOffset(offset: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid discovery offset");
}

export type MemoryDiscoveryRepository = DiscoveryRepository & {
  uniqueMatchCount(): number;
  checkpointFor(puuid: string, runId?: string): number;
};

/** Deterministic repository used by collector unit tests. */
export function memoryDiscoveryRepository(): MemoryDiscoveryRepository {
  const offsets = new Map<string, number>();
  const matches = new Map<string, Set<string>>();
  const unavailable = new Set<string>();
  const key = (runId: string, puuid: string) => `${runId}\u0000${puuid}`;
  return {
    async loadOffset(runId, puuid) { return offsets.get(key(runId, puuid)) ?? 0; },
    async savePage(runId, puuid, nextOffset, ids) {
      validateOffset(nextOffset);
      if (ids.some((id) => !/^TR1_[0-9]+$/.test(id))) throw new Error("invalid match identifier");
      const current = offsets.get(key(runId, puuid)) ?? 0;
      offsets.set(key(runId, puuid), Math.max(current, nextOffset));
      const set = matches.get(runId) ?? new Set<string>();
      for (const id of ids) set.add(id);
      matches.set(runId, set);
      return set.size;
    },
    async markUnavailable(runId, matchId) {
      if (!/^TR1_[0-9]+$/.test(matchId)) throw new Error("invalid match identifier");
      if (!(matches.get(runId)?.has(matchId))) throw new Error("discovered match not found");
      unavailable.add(`${runId}\u0000${matchId}`);
    },
    async pending(runId) {
      return [...(matches.get(runId) ?? [])].filter((matchId) => !unavailable.has(`${runId}\u0000${matchId}`)).map((matchId) => ({ matchId }));
    },
    uniqueMatchCount() { return [...matches.values()].reduce((sum, set) => sum + set.size, 0); },
    checkpointFor(puuid, runId = "run-1") { return offsets.get(key(runId, puuid)) ?? 0; }
  };
}
