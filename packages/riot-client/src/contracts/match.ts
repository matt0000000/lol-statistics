import z from "zod";

export const matchIdSchema = z.string().regex(/^TR1_[0-9]+$/);

/** Strict parser for one participant. Match-level parsing intentionally defers to this parser. */
export const participantSchema = z.object({
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
  participants: z.array(z.string().min(1)).min(1),
});

const infoSchema = z.object({
  platformId: z.string().min(1),
  queueId: z.number().int().nonnegative(),
  gameVersion: z.string().min(1),
  gameCreation: z.number().int().nonnegative(),
  gameDuration: z.number().int().nonnegative(),
  // Participant fields are validated independently during ingestion so one
  // malformed Riot element cannot discard the rest of an otherwise usable
  // match response.
  participants: z.array(z.unknown()).min(1),
});

export const matchSchema = z.object({ metadata: metadataSchema, info: infoSchema }).superRefine((match, context) => {
  const metadataUnique = new Set(match.metadata.participants);
  if (metadataUnique.size !== match.metadata.participants.length) context.addIssue({ code: "custom", path: ["metadata", "participants"], message: "metadata participants must be unique" });
  const parsedParticipants = match.info.participants.map((participant) => participantSchema.safeParse(participant));
  // Preserve the stronger identity checks for fully valid payloads. If one
  // element is malformed, ingestion owns its independent rejection instead.
  if (parsedParticipants.every((result) => result.success)) {
    const values = parsedParticipants.map((result) => result.success ? result.data : undefined);
    const infoPuuids = values.map((participant) => participant!.puuid);
    const infoPuuidUnique = new Set(infoPuuids);
    const participantIds = values.map((participant) => participant!.participantId);
    if (infoPuuidUnique.size !== infoPuuids.length) context.addIssue({ code: "custom", path: ["info", "participants"], message: "participant PUUIDs must be unique" });
    if (new Set(participantIds).size !== participantIds.length) context.addIssue({ code: "custom", path: ["info", "participants"], message: "participant IDs must be unique" });
    const metadataParticipants = [...match.metadata.participants].sort();
    const infoParticipants = [...infoPuuids].sort();
    if (metadataParticipants.length !== infoParticipants.length || metadataParticipants.some((value, index) => value !== infoParticipants[index])) {
      context.addIssue({ code: "custom", path: ["metadata", "participants"], message: "metadata participants do not match info participants" });
    }
  }
});
export type MatchDto = z.infer<typeof matchSchema>;

export const matchIdsSchema = z.array(matchIdSchema);
