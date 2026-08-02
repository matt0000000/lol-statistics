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

  it("accepts valid participants and rejects malformed entries independently", async () => {
    const saveValidatedMatch = vi.fn().mockResolvedValue({ observationsAccepted: 1, observationsRejected: 1, replay: false });
    const valid = { participantId: 1, puuid: "eligible-puuid", championId: 1, teamPosition: "BOTTOM", win: true, gameEndedInEarlySurrender: false, item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 };
    await ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_3", participants: ["eligible-puuid", "malformed-puuid"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1, gameDuration: 1800, participants: [valid, { puuid: "malformed-puuid", win: "unknown" }] }
    }, eligiblePlayers: new Map([["eligible-puuid", { tier: "EMERALD", division: "I" }]]), catalog, observations: { saveValidatedMatch }});
    expect(saveValidatedMatch.mock.calls[0]?.[3]).toHaveLength(2);
    expect(saveValidatedMatch.mock.calls[0]?.[3][0]).toMatchObject({ accepted: true });
    expect(saveValidatedMatch.mock.calls[0]?.[3][1]).toMatchObject({ accepted: false, reason: "required_field" });
  });

  it("assigns distinct safe indexes to malformed non-object participants", async () => {
    const saveValidatedMatch = vi.fn().mockResolvedValue({ observationsAccepted: 0, observationsRejected: 2, replay: false });
    await ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_4", participants: ["a", "b"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1, gameDuration: 1800, participants: [null, "not-an-object"] }
    }, eligiblePlayers: new Map(), catalog, observations: { saveValidatedMatch }});
    const parsed = saveValidatedMatch.mock.calls[0]?.[3] as Array<{ participantId: number; accepted: boolean }>;
    expect(parsed.map((part) => part.participantId)).toEqual([1, 2]);
  });

  it("reserves every valid participant ID before assigning a malformed row", async () => {
    const saveValidatedMatch = vi.fn().mockResolvedValue({ observationsAccepted: 1, observationsRejected: 1, replay: false });
    const valid = { participantId: 1, puuid: "eligible-puuid", championId: 1, teamPosition: "BOTTOM", win: true, gameEndedInEarlySurrender: false, item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 };
    await ingestMatch({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_5", participants: ["eligible-puuid"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1, gameDuration: 1800, participants: [null, valid] }
    }, eligiblePlayers: new Map([["eligible-puuid", { tier: "EMERALD", division: "I" }]]), catalog, observations: { saveValidatedMatch }});
    const parsed = saveValidatedMatch.mock.calls[0]?.[3] as Array<{ participantId?: number; accepted: boolean; observation?: { participantId: number } }>;
    expect(parsed.map((part) => part.accepted ? part.observation?.participantId : part.participantId)).toEqual([2, 1]);
    expect(parsed[1]).toMatchObject({ accepted: true, observation: { participantId: 1 } });
  });

  it("allocates replay-stable unique synthetic IDs for multiple malformed rows", async () => {
    const valid = { participantId: 1, puuid: "eligible-puuid", championId: 1, teamPosition: "BOTTOM", win: true, gameEndedInEarlySurrender: false, item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 };
    const makeSave = () => vi.fn().mockResolvedValue({ observationsAccepted: 1, observationsRejected: 2, replay: false });
    const makeInput = (participants: unknown[], saveValidatedMatch: ReturnType<typeof makeSave>) => ({ runId: "run", patchId: 1, activePatch: "16.15", match: {
      metadata: { dataVersion: "2", matchId: "TR1_6", participants: ["eligible-puuid"] },
      info: { platformId: "TR1", queueId: 420, gameVersion: "16.15.1", gameCreation: 1, gameDuration: 1800, participants }
    } as never, eligiblePlayers: new Map([["eligible-puuid", { tier: "EMERALD" as const, division: "I" as const }]]), catalog, observations: { saveValidatedMatch }});
    const firstSave = makeSave();
    await ingestMatch(makeInput([null, { puuid: "missing-fields" }, valid], firstSave));
    const secondSave = makeSave();
    await ingestMatch(makeInput([null, { puuid: "missing-fields" }, valid], secondSave));
    const first = firstSave.mock.calls[0]?.[3] as Array<{ participantId?: number; accepted: boolean; observation?: { participantId: number } }>;
    const second = secondSave.mock.calls[0]?.[3] as Array<{ participantId?: number; accepted: boolean; observation?: { participantId: number } }>;
    const ids = (parts: typeof first) => parts.map((part) => part.accepted ? part.observation?.participantId : part.participantId);
    expect(ids(first)).toEqual([2, 3, 1]);
    expect(ids(second)).toEqual(ids(first));
    expect(new Set(ids(first)).size).toBe(3);
    const reorderedSave = makeSave();
    await ingestMatch(makeInput([valid, null, { puuid: "missing-fields" }], reorderedSave));
    const reordered = reorderedSave.mock.calls[0]?.[3] as typeof first;
    expect(ids(reordered)).toEqual([1, 2, 3]);
  });
});
