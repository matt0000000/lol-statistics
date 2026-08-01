import z from "zod";

export const summonerSchema = z.object({
  id: z.string().min(1),
  puuid: z.string().min(1),
  accountId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  profileIconId: z.number().int().nonnegative().optional(),
  revisionDate: z.number().int().nonnegative().optional(),
  summonerLevel: z.number().int().nonnegative().optional(),
});
export type SummonerDto = z.infer<typeof summonerSchema>;
