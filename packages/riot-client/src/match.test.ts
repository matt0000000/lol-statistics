import { describe, expect, it } from "vitest";
import { MatchClient } from "./match";
import { matchSchema, participantSchema } from "./contracts/match";
import validFixture from "../../../fixtures/riot/match-valid.json";
import remakeFixture from "../../../fixtures/riot/match-remake.json";

type Call = { host: string; path: string; schema: { parse(value: unknown): unknown } };

function fakeRiotHttp(responses: unknown[]) {
  const calls: Call[] = [];
  return {
    calls,
    getJson<T>(request: Call): Promise<T> {
      calls.push(request);
      return Promise.resolve(responses.shift() as T);
    },
  };
}

const validMatch = {
  metadata: { dataVersion: "2", matchId: "TR1_123", participants: ["player-a", "player-b"] },
  info: {
    platformId: "TR1",
    queueId: 420,
    gameVersion: "16.15.1",
    gameCreation: 1_785_000_000_000,
    gameDuration: 1_800,
    participants: [
      { participantId: 1, puuid: "player-a", championId: 1, teamPosition: "TOP", win: true, gameEndedInEarlySurrender: false, item0: 1001, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 },
      { participantId: 2, puuid: "player-b", championId: 2, teamPosition: "JUNGLE", win: false, gameEndedInEarlySurrender: false, item0: 1001, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 },
    ],
  },
};

describe("MatchClient", () => {
  it("builds a canonical queue-420, count-100, 35-day match-list request", async () => {
    const http = fakeRiotHttp([["TR1_10", "TR1_9"]]);
    const client = new MatchClient(http, { now: () => 1_785_100_000 });
    const ids = await client.listMatchIds({ puuid: "encrypted", startTime: 1_785_000_000, start: 100 });

    expect(ids).toEqual(["TR1_10", "TR1_9"]);
    expect(http.calls[0]).toMatchObject({
      host: "europe.api.riotgames.com",
      path: "/lol/match/v5/matches/by-puuid/encrypted/ids?queue=420&startTime=1785000000&start=100&count=100",
    });
  });

  it("encodes PUUIDs and validates match IDs before constructing paths", async () => {
    const http = fakeRiotHttp([[], validMatch]);
    const client = new MatchClient(http, { now: () => 1_785_100_000 });
    await client.listMatchIds({ puuid: "private/value", startTime: 1_785_000_000, start: 0 });
    expect(http.calls[0].path).toContain("private%2Fvalue");

    await expect(client.getMatch("not-a-tr1-id")).rejects.toThrow("invalid Riot client input");
    await client.getMatch("TR1_123");
    expect(http.calls[1]).toMatchObject({ path: "/lol/match/v5/matches/TR1_123" });
  });

  it.each([
    { puuid: "", startTime: 1_785_000_000, start: 0 },
    { puuid: "p", startTime: -1, start: 0 },
    { puuid: "p", startTime: 1_785_000_000.5, start: 0 },
    { puuid: "p", startTime: 1_785_000_000, start: -1 },
    { puuid: "p", startTime: 1_785_000_000, start: 0.5 },
  ])("rejects invalid list input %#", async (input) => {
    const http = fakeRiotHttp([]);
    const client = new MatchClient(http, { now: () => 1_785_100_000 });
    await expect(client.listMatchIds(input)).rejects.toThrow("invalid Riot client input");
    expect(http.calls).toHaveLength(0);
  });

  it("rejects start times outside the recorded 35-day discovery window", async () => {
    const http = fakeRiotHttp([]);
    const client = new MatchClient(http, { now: () => 1_785_100_000 });
    await expect(client.listMatchIds({ puuid: "p", startTime: 1_785_100_000 - 35 * 86_400 - 1, start: 0 })).rejects.toThrow("invalid Riot client input");
    await expect(client.listMatchIds({ puuid: "p", startTime: 1_785_100_001, start: 0 })).rejects.toThrow("invalid Riot client input");
  });

  it("parses match DTOs and requires metadata PUUIDs to match participants", async () => {
    const http = fakeRiotHttp([validMatch]);
    const match = await new MatchClient(http, { now: () => 1_785_100_000 }).getMatch("TR1_123");
    expect(match).toEqual(validMatch);
    expect(http.calls[0].schema).toBe(matchSchema);

    expect(() => matchSchema.parse({ ...validMatch, metadata: { ...validMatch.metadata, participants: ["other"] } })).toThrow();
  });

  it.each([
    { metadata: { ...validMatch.metadata, participants: ["player-a", "player-a"] } },
    { info: { ...validMatch.info, participants: [validMatch.info.participants[0], validMatch.info.participants[0]] } },
    { info: { ...validMatch.info, participants: [{ ...validMatch.info.participants[0], participantId: 1 }, { ...validMatch.info.participants[1], participantId: 1 }] } },
  ])("rejects duplicate participant identities at the boundary", (override) => {
    expect(() => matchSchema.parse({ ...validMatch, ...override })).toThrow();
  });

  it("accepts both ordinary and early-remake fixture payloads", () => {
    expect(matchSchema.parse(validFixture).info.gameDuration).toBe(1800);
    expect(matchSchema.parse(remakeFixture).info.gameDuration).toBe(90);
  });

  it("keeps match-level validation while allowing a malformed participant through", () => {
    const malformed = { ...validMatch, info: { ...validMatch.info, participants: [validMatch.info.participants[0], { puuid: "player-b" }] } };
    expect(matchSchema.parse(malformed).info.participants).toEqual(malformed.info.participants);
    expect(() => participantSchema.parse(malformed.info.participants[1])).toThrow();
  });

  it("returns a mixed match when the HTTP parser applies the match schema", async () => {
    const malformed = { ...validMatch, info: { ...validMatch.info, participants: [validMatch.info.participants[0], { puuid: "player-b", win: "unknown" }] } };
    const calls: Call[] = [];
    const http = { getJson<T>(request: Call): Promise<T> { calls.push(request); return Promise.resolve(request.schema.parse(malformed) as T); } };
    const match = await new MatchClient(http).getMatch("TR1_123");
    expect(match.info.participants).toEqual(malformed.info.participants);
    expect(calls).toHaveLength(1);
  });

  it("rejects empty participant payloads", () => {
    expect(() => matchSchema.parse({ ...validMatch, metadata: { ...validMatch.metadata, participants: [] }, info: { ...validMatch.info, participants: [] } })).toThrow();
  });

  it("rejects null and non-object list inputs with a controlled error", async () => {
    const client = new MatchClient(fakeRiotHttp([]), { now: () => 1_785_100_000 });
    await expect(client.listMatchIds(null as never)).rejects.toThrow("invalid Riot client input");
    await expect(client.listMatchIds(42 as never)).rejects.toThrow("invalid Riot client input");
  });
});
