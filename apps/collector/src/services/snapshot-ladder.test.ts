import { describe, expect, it, vi } from "vitest";
import { snapshotLadder } from "./snapshot-ladder";

describe("snapshotLadder", () => {
  it("redacts dependency failures", async () => {
    const repository = { snapshotLadder: vi.fn().mockRejectedValue(new Error("secret-puuid")) };
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: vi.fn().mockResolvedValue([]) },
      repository
    })).rejects.toMatchObject({ code: "dependency_failure", message: "ladder snapshot failed (dependency_failure)" });
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: vi.fn().mockRejectedValue(new Error("secret-puuid")) },
      repository
    })).rejects.toMatchObject({ code: "dependency_failure", message: "ladder snapshot failed (dependency_failure)" });
  });

  it("uses a static invalid_input diagnostic", async () => {
    await expect(snapshotLadder({ runId: "", leagueClient: {} as never, repository: {} as never })).rejects.toMatchObject({ code: "invalid_input", message: "ladder snapshot failed (invalid_input)" });
  });
});
