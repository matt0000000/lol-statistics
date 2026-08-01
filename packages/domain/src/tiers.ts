export const ELIGIBLE_TIERS = ["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"] as const;
export type Tier = (typeof ELIGIBLE_TIERS)[number];

export const DIVISIONS = ["I", "II", "III", "IV"] as const;
export type Division = (typeof DIVISIONS)[number];

export type LadderEligibility = {
  tier: Tier;
  division: Division;
};

export function parseTier(value: unknown): Tier | null {
  return typeof value === "string" && (ELIGIBLE_TIERS as readonly string[]).includes(value)
    ? value as Tier
    : null;
}

export function parseDivision(value: unknown): Division | null {
  return typeof value === "string" && (DIVISIONS as readonly string[]).includes(value)
    ? value as Division
    : null;
}
