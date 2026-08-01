import { summonerSchema, type SummonerDto } from "./contracts/summoner";
import type { RiotRequest } from "./http";

const HOST = "tr1.api.riotgames.com";

export class SummonerClient {
  constructor(private readonly http: RiotServiceHttp) {}

  getSummoner(summonerId: string): Promise<SummonerDto> {
    if (typeof summonerId !== "string" || summonerId.length === 0) throw new Error("invalid Riot client input");
    return this.http.getJson({
      host: HOST,
      path: `/lol/summoner/v4/summoners/${encodeURIComponent(summonerId)}`,
      schema: summonerSchema,
    });
  }
}

export type RiotServiceHttp = { getJson<T>(request: RiotRequest<T>): Promise<T> };
