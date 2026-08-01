import { describe, expect, it, vi } from "vitest";
import { ingestMatch, IngestMatchError, parseFinalInventory } from "./ingest-match";

describe("parseFinalInventory", () => {
  const catalog = [
    { id: 3031, category: "CORE" },
    { id: 3172, category: "BOOTS" },
    { id: 1001, category: "EXCLUDED_COMPONENT" },
    { id: 2055, category: "EXCLUDED_CONSUMABLE" }
  ];
  it("normalizes aliases, duplicate cores, and upgraded boots", () => {
    const result = parseFinalInventory({ participant: { item0: 7002, item1: 3031, item2: 3172, item3: 1001, item4: 2055, item5: 0, item6: 0 }, gameVersion: "16.15.1", catalog });
    expect(result.coreItems).toEqual([{ itemId: 3031, quantity: 2, slotIndex: 0 }]);
    expect(result.boots).toEqual({ itemId: 3172, slotIndex: 2 });
  });
  it("rejects an uncatalogued item without exposing its id", () => {
    expect(() => parseFinalInventory({ participant: { item0: 999999, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 }, gameVersion: "16.15.1", catalog })).toThrow("inventory parse failed (unknown_item)");
  });

  it("requires the explicit active patch and emits only static logger fields", async () => {
    const saveValidatedMatch = vi.fn().mockResolvedValue({ observationsAccepted: 0, observationsRejected: 1, replay: false });
    const logger = { warn: vi.fn() };
    await ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_1", participants: ["secret-puuid"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1, gameDuration: 1800, participants: [{ participantId: 1, puuid: "secret-puuid", championId: 1, teamPosition: "BOTTOM", win: true, gameEndedInEarlySurrender: false, item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 }] }
    }, eligiblePlayers: new Map(), catalog, observations: { saveValidatedMatch }, logger });
    expect(saveValidatedMatch).toHaveBeenCalledWith("run", 1, expect.anything(), [{ accepted: false, participantId: 1, reason: "rank" }]);
    for (const arg of logger.warn.mock.calls.flat()) expect(JSON.stringify(arg)).not.toContain("secret-puuid");
  });

  it("turns malformed game versions into safe rejected observations", async () => {
    const saveValidatedMatch = vi.fn().mockResolvedValue({ observationsAccepted: 0, observationsRejected: 1, replay: false });
    await ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_2", participants: ["secret-puuid"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "secret-version", gameCreation: 1, gameDuration: 1800, participants: [{ participantId: 1, puuid: "secret-puuid", championId: 1, teamPosition: "BOTTOM", win: true, gameEndedInEarlySurrender: false, item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 }] }
    }, eligiblePlayers: new Map([["secret-puuid", { tier: "EMERALD", division: "I" }]]), catalog, observations: { saveValidatedMatch }});
    expect(saveValidatedMatch.mock.calls[0]?.[3]).toEqual([{ accepted: false, participantId: 1, reason: "patch" }]);
  });

  it("rejects an empty runtime match before remake parsing or repository calls", async () => {
    const saveValidatedMatch = vi.fn();
    await expect(ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: { info: { participants: [] } } as never, eligiblePlayers: new Map(), catalog, observations: { saveValidatedMatch } })).rejects.toEqual(new IngestMatchError("empty_participants"));
    expect(saveValidatedMatch).not.toHaveBeenCalled();
  });
});
