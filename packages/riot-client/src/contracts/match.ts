import z from "zod";

export const matchIdSchema = z.string().regex(/^TR1_[0-9]+$/);

const participantSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  puuid: z.string().min(1),
  championId: z.number().int().nonnegative(),
  teamPosition: z.string(),
  win: z.boolean(),
  gameEndedInEarlySurrender: z.boolean(),
  item0: z.number().int().nonnegative(),
  item1: z.number().int().nonnegative(),
  item2: z.number().int().nonnegative(),
  item3: z.number().int().nonnegative(),
  item4: z.number().int().nonnegative(),
  item5: z.number().int().nonnegative(),
  item6: z.number().int().nonnegative(),
});
export type MatchParticipant = z.infer<typeof participantSchema>;

const metadataSchema = z.object({
  dataVersion: z.string().min(1),
  matchId: matchIdSchema,
  participants: z.array(z.string().min(1)),
});

const infoSchema = z.object({
  platformId: z.string().min(1),
  queueId: z.number().int().nonnegative(),
  gameVersion: z.string().min(1),
  gameCreation: z.number().int().nonnegative(),
  gameDuration: z.number().int().nonnegative(),
  participants: z.array(participantSchema),
});

export const matchSchema = z.object({ metadata: metadataSchema, info: infoSchema }).superRefine((match, context) => {
  const metadataParticipants = [...match.metadata.participants].sort();
  const infoParticipants = match.info.participants.map((participant) => participant.puuid).sort();
  if (metadataParticipants.length !== infoParticipants.length || metadataParticipants.some((value, index) => value !== infoParticipants[index])) {
    context.addIssue({ code: "custom", path: ["metadata", "participants"], message: "metadata participants do not match info participants" });
  }
});
export type MatchDto = z.infer<typeof matchSchema>;

export const matchIdsSchema = z.array(matchIdSchema);

