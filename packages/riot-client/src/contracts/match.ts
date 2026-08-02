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
  const metadataParticipants = new Set(match.metadata.participants);
  const rawPuuids = match.info.participants.flatMap((participant) => {
    if (typeof participant !== "object" || participant === null || Array.isArray(participant)) return [];
    const puuid = (participant as { puuid?: unknown }).puuid;
    return typeof puuid === "string" && puuid.length > 0 ? [puuid] : [];
  });
  if (new Set(rawPuuids).size !== rawPuuids.length) context.addIssue({ code: "custom", path: ["info", "participants"], message: "participant PUUIDs must be unique" });
  for (const puuid of rawPuuids) {
    if (!metadataParticipants.has(puuid)) context.addIssue({ code: "custom", path: ["metadata", "participants"], message: "metadata participants do not match info participants" });
  }

  const validParticipants = parsedParticipants.flatMap((result) => result.success ? [result.data] : []);
  const participantIds = validParticipants.map((participant) => participant.participantId);
  if (new Set(participantIds).size !== participantIds.length) context.addIssue({ code: "custom", path: ["info", "participants"], message: "participant IDs must be unique" });

  // When every row exposes a usable PUUID, the metadata must be an exact
  // identity set. If any row lacks one, only the known subset is enforceable.
  if (rawPuuids.length === match.info.participants.length) {
    const metadataValues = [...match.metadata.participants].sort();
    const infoValues = [...rawPuuids].sort();
    if (metadataValues.length !== infoValues.length || metadataValues.some((value, index) => value !== infoValues[index])) {
      context.addIssue({ code: "custom", path: ["metadata", "participants"], message: "metadata participants do not match info participants" });
    }
  }
});
export type MatchDto = z.infer<typeof matchSchema>;

export const matchIdsSchema = z.array(matchIdSchema);
