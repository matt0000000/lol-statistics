import { describe, expect, it, vi } from "vitest";
import { snapshotLadder } from "./snapshot-ladder";

describe("snapshotLadder", () => {
  it("redacts dependency failures", async () => {
    const repository = { snapshotLadder: vi.fn().mockRejectedValue(new Error("secret-puuid")) };
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: vi.fn().mockResolvedValue([]) },
      repository
    })).rejects.toThrow("ladder snapshot failed");
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: vi.fn().mockRejectedValue(new Error("secret-puuid")) },
      repository
    })).rejects.not.toThrow("secret-puuid");
  });
});
