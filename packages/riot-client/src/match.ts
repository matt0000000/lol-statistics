import { matchIdsSchema, matchSchema, type MatchDto } from "./contracts/match";
import type { RiotRequest } from "./http";

const HOST = "europe.api.riotgames.com";
const MAX_DISCOVERY_AGE_SECONDS = 35 * 86_400;

export type MatchListInput = { puuid: string; startTime: number; start: number };
export type MatchClientOptions = { now?: () => number };

export class MatchClient {
  private readonly now: () => number;

  constructor(private readonly http: RiotServiceHttp, options: MatchClientOptions = {}) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  }

  async listMatchIds(input: MatchListInput): Promise<string[]> {
    this.validateListInput(input);
    const query = new URLSearchParams({
      queue: "420",
      startTime: String(input.startTime),
      start: String(input.start),
      count: "100",
    });
    return this.http.getJson({
      host: HOST,
      path: `/lol/match/v5/matches/by-puuid/${segment(input.puuid)}/ids?${query.toString()}`,
      schema: matchIdsSchema,
    });
  }

  async getMatch(matchId: string): Promise<MatchDto> {
    if (!matchIdSchemaSafe(matchId)) throw invalidInput();
    return this.http.getJson({
      host: HOST,
      path: `/lol/match/v5/matches/${segment(matchId)}`,
      schema: matchSchema,
    });
  }

  private validateListInput(input: MatchListInput): void {
    if (typeof input.puuid !== "string" || input.puuid.length === 0 || !isSafeInteger(input.startTime) || !isSafeInteger(input.start)) throw invalidInput();
    const now = this.now();
    if (!isSafeInteger(now) || input.startTime > now || input.startTime < now - MAX_DISCOVERY_AGE_SECONDS) throw invalidInput();
  }
}

export type RiotServiceHttp = { getJson<T>(request: RiotRequest<T>): Promise<T> };

function matchIdSchemaSafe(value: string): boolean {
  return typeof value === "string" && /^TR1_[0-9]+$/.test(value);
}

function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function invalidInput(): Error {
  return new Error("invalid Riot client input");
}
