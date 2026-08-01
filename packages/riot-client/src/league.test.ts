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
      return Promise.resolve(response as T);
    },
  };
}

const row = (summonerId: string, tier: string) => ({
  summonerId, queueType: "RANKED_SOLO_5x5", tier, rank: "I", leaguePoints: 10, wins: 1, losses: 1,
});
const apex = (tier: string, summonerId: string) => ({
  tier, queue: "RANKED_SOLO_5x5", entries: [{ summonerId, rank: "I", leaguePoints: 10, wins: 1, losses: 1 }],
});
const apexEmpty = (tier: string) => ({ tier, queue: "RANKED_SOLO_5x5", entries: [] });
const summoner = (id: string, puuid: string) => ({ id, accountId: `account-${id}`, puuid, name: "Fixture Summoner", profileIconId: 1, revisionDate: 1_785_000_000_000, summonerLevel: 100 });
const emptyDiscovery = () => [[], [], [], [], [], [], [], [], apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER")];

describe("LeagueClient", () => {
  it("validates official paged and apex fixture shapes", () => {
    expect(leagueResponseSchema.parse(emeraldFixture)).toHaveLength(1);
    expect(leagueResponseSchema.parse(masterFixture)).toMatchObject({ tier: "MASTER", queue: "RANKED_SOLO_5x5" });
  });

  it("normalizes official League-V4 shapes, enriches through Summoner-V4, and uses fixed TR1 routes", async () => {
    const http = fakeRiotHttp([
      [row("sum-a", "EMERALD")], [], [], [], [],
      [row("sum-a", "DIAMOND")], [], [], [], [],
      apex("MASTER", "sum-b"), apex("GRANDMASTER", "sum-c"), apex("CHALLENGER", "sum-d"),
      summoner("sum-a", "player-a"), summoner("sum-b", "player-b"), summoner("sum-c", "player-c"), summoner("sum-d", "player-d"),
    ]);

    const players = await new LeagueClient(http).listEligiblePlayers();

    expect(players.map((player) => player.tier)).toEqual(["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND"]);
    expect(players.map((player) => player.puuid)).toEqual(["player-d", "player-c", "player-b", "player-a"]);
    expect(http.calls[0]).toMatchObject({ host: "tr1.api.riotgames.com", path: "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1" });
    expect(http.calls).toContainEqual(expect.objectContaining({ path: "/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5" }));
    expect(http.calls).toContainEqual(expect.objectContaining({ path: "/lol/summoner/v4/summoners/sum-a" }));
  });

  it("deduplicates by summoner ID before enrichment and keeps first same-tier data", async () => {
    const http = fakeRiotHttp([
      [row("same", "EMERALD")], [], [], [], [],
      [row("same", "DIAMOND")], [], [], [], [],
      apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"),
      summoner("same", "puuid-same"),
    ]);
    const players = await new LeagueClient(http).listEligiblePlayers();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ puuid: "puuid-same", tier: "DIAMOND" });
    expect(http.calls.filter((call) => call.path.startsWith("/lol/summoner/")).map((call) => call.path)).toEqual(["/lol/summoner/v4/summoners/same"]);
  });

  it("stops each division only after an empty page", async () => {
    const http = fakeRiotHttp([
      [row("a", "EMERALD")], [row("b", "EMERALD")], [], [], [], [], [], [], [], [],
      apexEmpty("MASTER"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"),
      summoner("a", "a"), summoner("b", "b"),
    ]);
    await new LeagueClient(http).listEligiblePlayers();
    expect(http.calls.filter((call) => call.path.includes("EMERALD/I?")).map((call) => call.path)).toEqual([
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=2",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=3",
    ]);
  });

  it("skips stale summoner 404s but propagates auth failures", async () => {
    const notFound = new RiotHttpError("Riot not_found request failed", 404, false, "not_found");
    const staleDiscovery = [...emptyDiscovery().slice(0, 8), apex("MASTER", "stale"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"), notFound];
    const http = fakeRiotHttp(staleDiscovery);
    const players = await new LeagueClient(http).listEligiblePlayers();
    expect(players).toEqual([]);

    const auth = new RiotHttpError("Riot auth request failed", 403, false, "auth");
    const failingDiscovery = [...emptyDiscovery().slice(0, 8), apex("MASTER", "stale"), apexEmpty("GRANDMASTER"), apexEmpty("CHALLENGER"), auth];
    const failing = fakeRiotHttp(failingDiscovery);
    await expect(new LeagueClient(failing).listEligiblePlayers()).rejects.toBe(auth);
  });
});
