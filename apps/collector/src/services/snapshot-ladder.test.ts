import { describe, expect, it, vi } from "vitest";
import { snapshotLadder } from "./snapshot-ladder";
import { RiotHttpError } from "@lol/riot-client";

describe("snapshotLadder", () => {
  it("emits ordered lifecycle events for a successful ladder snapshot", async () => {
    const events: Record<string, unknown>[] = [];
    const entries = [{ puuid: "fixture-puuid", tier: "EMERALD" as const, rank: "I", queueType: "RANKED_SOLO_5x5" as const, leaguePoints: 0, wins: 0, losses: 0 }];
    await snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: async () => entries },
      repository: { snapshotLadder: async () => {} },
      logger: { info: (fields) => events.push(fields) }
    });

    expect(events).toEqual([
      { event: "ladder_fetch_started", runId: "run-1", stage: "LADDER" },
      { event: "ladder_fetch_completed", runId: "run-1", stage: "LADDER", aggregateCount: 1 },
      { event: "ladder_persist_started", runId: "run-1", stage: "LADDER", aggregateCount: 1 },
      { event: "ladder_persist_completed", runId: "run-1", stage: "LADDER", aggregateCount: 1 }
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("fixture-puuid");
    expect(serialized).not.toContain("secret exception message");
  });

  it("leaves ladder_fetch_started as the last event when fetching fails", async () => {
    const events: Record<string, unknown>[] = [];
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: async () => { throw new Error("secret exception message"); } },
      repository: { snapshotLadder: async () => {} },
      logger: { info: (fields) => events.push(fields) }
    })).rejects.toMatchObject({ code: "dependency_failure" });

    expect(events).toEqual([{ event: "ladder_fetch_started", runId: "run-1", stage: "LADDER" }]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("fixture-puuid");
    expect(serialized).not.toContain("secret exception message");
  });

  it("leaves ladder_persist_started as the last event when persistence fails", async () => {
    const events: Record<string, unknown>[] = [];
    const entries = [{ puuid: "fixture-puuid", tier: "EMERALD" as const, rank: "I", queueType: "RANKED_SOLO_5x5" as const, leaguePoints: 0, wins: 0, losses: 0 }];
    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: async () => entries },
      repository: { snapshotLadder: async () => { throw new Error("secret exception message"); } },
      logger: { info: (fields) => events.push(fields) }
    })).rejects.toMatchObject({ code: "dependency_failure" });

    expect(events).toEqual([
      { event: "ladder_fetch_started", runId: "run-1", stage: "LADDER" },
      { event: "ladder_fetch_completed", runId: "run-1", stage: "LADDER", aggregateCount: 1 },
      { event: "ladder_persist_started", runId: "run-1", stage: "LADDER", aggregateCount: 1 }
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("fixture-puuid");
    expect(serialized).not.toContain("secret exception message");
  });

  it("ignores logger failures and still persists the ladder snapshot", async () => {
    const repository = { snapshotLadder: vi.fn().mockResolvedValue(undefined) };
    const entries = [{ puuid: "fixture-puuid", tier: "EMERALD" as const, rank: "I", queueType: "RANKED_SOLO_5x5" as const, leaguePoints: 0, wins: 0, losses: 0 }];

    await expect(snapshotLadder({
      runId: "run-1",
      leagueClient: { listEligiblePlayers: async () => entries },
      repository,
      logger: { info: () => { throw new Error("logger unavailable"); } }
    })).resolves.toBeUndefined();

    expect(repository.snapshotLadder).toHaveBeenCalledWith("run-1", entries);
  });

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
