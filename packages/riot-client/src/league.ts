import { leagueResponseSchema, type EligibleTier, type LeagueEntry, type LeagueResponse, type RawLeagueEntry } from "./contracts/league";
import type { RiotRequest } from "./http";

const HOST = "tr1.api.riotgames.com";
const QUEUE = "RANKED_SOLO_5x5";
const DIVISIONS = ["I", "II", "III", "IV"] as const;
const PAGINATED_TIERS = ["EMERALD", "DIAMOND"] as const;
const APEX_TIERS = ["MASTER", "GRANDMASTER", "CHALLENGER"] as const;
const TIER_PRIORITY: Record<EligibleTier, number> = {
  EMERALD: 0,
  DIAMOND: 1,
  MASTER: 2,
  GRANDMASTER: 3,
  CHALLENGER: 4,
};

export class LeagueClient {
  constructor(private readonly http: RiotServiceHttp) {}

  async listEligiblePlayers(): Promise<LeagueEntry[]> {
    const byPuuid = new Map<string, RawLeagueEntry>();
    for (const tier of PAGINATED_TIERS) {
      for (const division of DIVISIONS) {
        for (let page = 1; ; page += 1) {
          const response = await this.http.getJson<LeagueResponse>({
            host: HOST,
            path: `/lol/league/v4/entries/${segment(QUEUE)}/${segment(tier)}/${segment(division)}?page=${page}`,
            schema: leagueResponseSchema,
          });
          const entries = normalizeEntries(response);
          if (entries.length === 0) break;
          for (const entry of entries) keepHighest(byPuuid, entry);
        }
      }
    }

    for (const tier of APEX_TIERS) {
      const response = await this.http.getJson<LeagueResponse>({
        host: HOST,
        path: `/lol/league/v4/${tier.toLowerCase()}leagues/by-queue/${segment(QUEUE)}`,
        schema: leagueResponseSchema,
      });
      for (const entry of normalizeEntries(response)) keepHighest(byPuuid, entry);
    }

    return [...byPuuid.values()]
      .map((entry): LeagueEntry => ({ puuid: entry.puuid, queueType: "RANKED_SOLO_5x5", tier: entry.tier, rank: entry.rank, leaguePoints: entry.leaguePoints, wins: entry.wins, losses: entry.losses }))
      .sort((left, right) => TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier] || left.puuid.localeCompare(right.puuid));
  }
}

export type RiotServiceHttp = { getJson<T>(request: RiotRequest<T>): Promise<T> };

function normalizeEntries(response: LeagueResponse): RawLeagueEntry[] {
  if (Array.isArray(response)) return response;
  return response.entries.map((entry) => ({ ...entry, tier: response.tier, queueType: response.queue }));
}

function keepHighest(byPuuid: Map<string, RawLeagueEntry>, entry: RawLeagueEntry): void {
  const existing = byPuuid.get(entry.puuid);
  if (!existing || TIER_PRIORITY[entry.tier] > TIER_PRIORITY[existing.tier]) byPuuid.set(entry.puuid, entry);
}

function segment(value: string): string {
  return encodeURIComponent(value);
}
