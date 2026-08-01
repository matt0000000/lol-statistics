import type { MatchClient } from "@lol/riot-client";
import type { DiscoveryRepository } from "@lol/database";

export type DiscoverMatchesInput = {
  runId: string;
  puuid: string;
  coverageStart: Date;
  matchClient: Pick<MatchClient, "listMatchIds">;
  repository: DiscoveryRepository;
};

export async function discoverMatches(input: DiscoverMatchesInput): Promise<void> {
  validateInput(input);
  const startTime = Math.floor(input.coverageStart.getTime() / 1_000);
  let start = await input.repository.loadOffset(input.runId, input.puuid);
  validateOffset(start);
  for (;;) {
    const ids = await input.matchClient.listMatchIds({ puuid: input.puuid, startTime, start });
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !/^TR1_[0-9]+$/.test(id))) throw new Error("invalid match discovery response");
    if (ids.length > 100) throw new Error("invalid match discovery response");
    const next = start + ids.length;
    if (!Number.isSafeInteger(next) || next <= start && ids.length > 0) throw new Error("invalid discovery offset");
    await input.repository.savePage(input.runId, input.puuid, next, ids);
    start = next;
    if (ids.length < 100) return;
  }
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
    uniqueMatchCount() { return [...matches.values()].reduce((sum, set) => sum + set.size, 0); },
    checkpointFor(puuid, runId = "run-1") { return offsets.get(key(runId, puuid)) ?? 0; }
  };
}

