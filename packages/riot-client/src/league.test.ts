import { describe, expect, it } from "vitest";
import { RiotHttpError } from "./errors";
import { LeagueClient } from "./league";
import { leagueResponseSchema } from "./contracts/league";
import emeraldFixture from "../../../fixtures/riot/league-emerald-page.json";
import masterFixture from "../../../fixtures/riot/league-master.json";

type Call = { host: string; path: string; schema: { parse(value: unknown): unknown } };
function fakeRiotHttp(responses: unknown[]) {
  const calls: Call[] = [];
  return {
    calls,
    getJson<T>(request: Call): Promise<T> {
      calls.push(request);
      const response = responses.shift();
      if (response instanceof Error) return Promise.reject(response);
      return Promise.resolve(request.schema.parse(response) as T);
    },
  };
}

const row = (puuid: string, tier: string) => ({
  puuid, queueType: "RANKED_SOLO_5x5", tier, rank: "I", leaguePoints: 10, wins: 1, losses: 1,
});
const apex = (tier: string, puuid: string) => ({
  tier, queue: "RANKED_SOLO_5x5", entries: [{ puuid, rank: "I", leaguePoints: 10, wins: 1, losses: 1 }],
});
const apexEmpty = (tier: string) => ({ tier, queue: "RANKED_SOLO_5x5", entries: [] });
const emptyDiscovery = () => [[], [], [], [], [], [], [], [], apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER")];

describe("LeagueClient", () => {
  it("validates official paged and apex fixture shapes", () => {
    expect(leagueResponseSchema.parse(emeraldFixture)).toHaveLength(1);
    expect(leagueResponseSchema.parse(masterFixture)).toMatchObject({ tier: "MASTER", queue: "RANKED_SOLO_5x5" });
  });

  it("normalizes current League-V4 PUUID shapes and uses fixed TR1 routes", async () => {
    const http = fakeRiotHttp([
      [row("player-a", "EMERALD")], [], [], [], [],
      [row("player-a", "DIAMOND")], [], [], [], [],
      apex("MASTER", "player-b"), apex("GRANDMASTER", "player-c"), apex("CHALLENGER", "player-d"),
    ]);

    const players = await new LeagueClient(http).listEligiblePlayers();

    expect(players.map((player) => player.tier)).toEqual(["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND"]);
    expect(players.map((player) => player.puuid)).toEqual(["player-d", "player-c", "player-b", "player-a"]);
    expect(http.calls[0]).toMatchObject({ host: "tr1.api.riotgames.com", path: "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1" });
    expect(http.calls).toContainEqual(expect.objectContaining({ path: "/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5" }));
    expect(http.calls.some((call) => call.path.startsWith("/lol/summoner/"))).toBe(false);
  });

  it("deduplicates by PUUID and keeps the highest-tier data", async () => {
    const http = fakeRiotHttp([
      [row("same", "EMERALD")], [], [], [], [],
      [row("same", "DIAMOND")], [], [], [], [],
      apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"),
    ]);
    const players = await new LeagueClient(http).listEligiblePlayers();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ puuid: "same", tier: "DIAMOND" });
  });

  it("stops each division only after an empty page", async () => {
    const http = fakeRiotHttp([
      [row("a", "EMERALD")], [row("b", "EMERALD")], [], [], [], [], [], [], [], [],
      apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"),
    ]);
    await new LeagueClient(http).listEligiblePlayers();
    expect(http.calls.filter((call) => call.path.includes("EMERALD/I?")).map((call) => call.path)).toEqual([
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=2",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=3",
    ]);
  });

  it("propagates League-V4 authentication failures", async () => {
    const auth = new RiotHttpError("Riot auth request failed", 403, false, "auth");
    const failingDiscovery = [...emptyDiscovery().slice(0, 8), auth];
    const failing = fakeRiotHttp(failingDiscovery);
    await expect(new LeagueClient(failing).listEligiblePlayers()).rejects.toBe(auth);
  });
});
