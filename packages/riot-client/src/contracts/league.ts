import z from "zod";

export const eligibleTierSchema = z.enum(["EMERALD", "DIAMOND", "MASTER", "GRANDMASTER", "CHALLENGER"]);
export type EligibleTier = z.infer<typeof eligibleTierSchema>;

export const leagueEntrySchema = z.object({
  puuid: z.string().min(1),
  queueType: z.literal("RANKED_SOLO_5x5"),
  tier: eligibleTierSchema,
  rank: z.string().min(1),
  leaguePoints: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
});
export type LeagueEntry = z.infer<typeof leagueEntrySchema>;

const rawLeagueFields = {
  leagueId: z.string().min(1).optional(),
  summonerId: z.string().min(1),
  summonerName: z.string().min(1).optional(),
  rank: z.string().min(1),
  leaguePoints: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  veteran: z.boolean().optional(),
  inactive: z.boolean().optional(),
  freshBlood: z.boolean().optional(),
  hotStreak: z.boolean().optional(),
};
export const rawLeagueEntrySchema = z.object({
  ...rawLeagueFields,
  queueType: z.literal("RANKED_SOLO_5x5"),
  tier: eligibleTierSchema,
});
export type RawLeagueEntry = z.infer<typeof rawLeagueEntrySchema>;
export const rawApexLeagueEntrySchema = z.object(rawLeagueFields);
export const rawApexLeagueSchema = z.object({
  tier: eligibleTierSchema,
  queue: z.literal("RANKED_SOLO_5x5"),
  entries: z.array(rawApexLeagueEntrySchema),
});
export type RawApexLeague = z.infer<typeof rawApexLeagueSchema>;

export const leagueEntriesSchema = z.array(rawLeagueEntrySchema);
export const leagueResponseSchema = z.union([leagueEntriesSchema, rawApexLeagueSchema]);
export type LeagueResponse = z.infer<typeof leagueResponseSchema>;
