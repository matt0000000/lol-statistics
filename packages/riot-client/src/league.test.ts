import { describe, expect, it } from "vitest";
import { LeagueClient } from "./league";

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

const entry = (puuid: string, tier: string) => ({
  puuid,
  queueType: "RANKED_SOLO_5x5",
  tier,
  rank: "I",
  leaguePoints: 10,
  wins: 1,
  losses: 1,
});

describe("LeagueClient", () => {
  it("paginates Emerald and Diamond divisions and fetches each apex league once", async () => {
    const http = fakeRiotHttp([
      [entry("player-a", "EMERALD")], [], [], [], [],
      [entry("player-a", "DIAMOND")], [], [], [], [],
      { entries: [entry("player-b", "MASTER")] },
      { entries: [entry("player-c", "GRANDMASTER")] },
      { entries: [entry("player-d", "CHALLENGER")] },
    ]);

    const players = await new LeagueClient(http).listEligiblePlayers();

    expect(players.map((player) => player.tier)).toEqual([
      "CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND",
    ]);
    expect(players.map((player) => player.puuid)).toEqual([
      "player-d", "player-c", "player-b", "player-a",
    ]);
    expect(http.calls[0]).toMatchObject({
      host: "tr1.api.riotgames.com",
      path: "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1",
    });
    expect(http.calls).toContainEqual(expect.objectContaining({
      path: "/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5",
    }));
  });

  it("keeps the first record for same-tier ties while preferring higher tiers", async () => {
    const http = fakeRiotHttp([
      [entry("same", "EMERALD")], [], [], [], [],
      [entry("same", "DIAMOND")], [], [], [], [],
      { entries: [entry("same", "MASTER")] },
      { entries: [] },
      { entries: [] },
    ]);

    const players = await new LeagueClient(http).listEligiblePlayers();
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ puuid: "same", tier: "MASTER" });
  });

  it("stops each division only after an empty page", async () => {
    const http = fakeRiotHttp([
      [entry("a", "EMERALD")], [entry("b", "EMERALD")], [], [], [],
      [], [], [], [], [],
      { entries: [] }, { entries: [] }, { entries: [] },
    ]);

    await new LeagueClient(http).listEligiblePlayers();
    expect(http.calls.filter((call) => call.path.includes("EMERALD/I?")).map((call) => call.path)).toEqual([
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=1",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=2",
      "/lol/league/v4/entries/RANKED_SOLO_5x5/EMERALD/I?page=3",
    ]);
  });
});
