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

export const leagueEntriesSchema = z.array(leagueEntrySchema);
export const leagueResponseSchema = z.union([
  leagueEntriesSchema,
  z.object({ entries: leagueEntriesSchema }),
]);
export type LeagueResponse = z.infer<typeof leagueResponseSchema>;

