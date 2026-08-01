import { describe, expect, it, vi } from "vitest";
import { snapshotLadder } from "./snapshot-ladder";
import { RiotHttpError } from "@lol/riot-client";

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

  it("preserves a safe dependency cause/category", async () => {
    const cause = new RiotHttpError("private detail", 403, false, "auth");
    await expect(snapshotLadder({ runId: "run", leagueClient: { listEligiblePlayers: async () => { throw cause; } }, repository: { snapshotLadder: async () => {} } })).rejects.toMatchObject({ code: "dependency_failure", category: "auth", cause });
  });
});
