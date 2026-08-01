import { describe, expect, it, vi } from "vitest";
import { discoverMatches, memoryDiscoveryRepository } from "./discover-matches";

describe("discoverMatches", () => {
  it("paginates, deduplicates IDs, and checkpoints by response length", async () => {
    const matchClient = {
      listMatchIds: vi.fn()
        .mockResolvedValueOnce(Array.from({ length: 100 }, (_, index) => `TR1_${index}`))
        .mockResolvedValueOnce(["TR1_100", "TR1_99"])
    };
    const repository = memoryDiscoveryRepository();
    await discoverMatches({ runId: "run-1", puuid: "private", coverageStart: new Date("2026-07-01T00:00:00Z"), matchClient, repository });
    expect(repository.uniqueMatchCount()).toBe(101);
    expect(repository.checkpointFor("private", "run-1")).toBe(102);
    expect(matchClient.listMatchIds).toHaveBeenNthCalledWith(2, { puuid: "private", startTime: 1782864000, start: 100 });
  });

  it("stops after an empty page", async () => {
    const matchClient = { listMatchIds: vi.fn().mockResolvedValue([]) };
    const repository = memoryDiscoveryRepository();
    await discoverMatches({ runId: "run-1", puuid: "private", coverageStart: new Date("2026-07-01T00:00:00Z"), matchClient, repository });
    expect(matchClient.listMatchIds).toHaveBeenCalledTimes(1);
    expect(repository.checkpointFor("private", "run-1")).toBe(0);
  });

  it("redacts dependency failures", async () => {
    const repository = memoryDiscoveryRepository();
    const matchClient = { listMatchIds: vi.fn().mockRejectedValue(new Error("private-puuid leaked")) };
    await expect(discoverMatches({ runId: "run-1", puuid: "private-puuid", coverageStart: new Date("2026-07-01T00:00:00Z"), matchClient, repository })).rejects.toMatchObject({ code: "dependency_failure" });
    await expect(discoverMatches({ runId: "run-1", puuid: "private-puuid", coverageStart: new Date("2026-07-01T00:00:00Z"), matchClient, repository })).rejects.not.toThrow("private-puuid");
  });

  it("uses a static invalid_input diagnostic", async () => {
    await expect(discoverMatches({ runId: "", puuid: "secret", coverageStart: new Date(), matchClient: {} as never, repository: {} as never })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
