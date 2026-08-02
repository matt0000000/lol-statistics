import z from "zod";

const finiteNumber = z.number().finite();
const nonnegativeInteger = z.number().int().nonnegative();
const isoDate = z.string().datetime({ offset: true });

export const roleSchema = z.enum(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);
export type Role = z.infer<typeof roleSchema>;
export function isRole(value: unknown): value is Role {
  return roleSchema.safeParse(value).success;
}
export const statsViewSchema = z.enum(["items", "pairs", "trios", "boots"]);
export type StatsView = z.infer<typeof statsViewSchema>;
export const statsSortSchema = z.enum(["adjusted", "winRate", "buildRate", "sample"]);
export type StatsSort = z.infer<typeof statsSortSchema>;

export const publicScopeSchema = z.object({
  platform: z.literal("TR1"),
  queue: z.literal(420),
  rank: z.literal("EMERALD+")
}).strict();
export type PublicScope = z.infer<typeof publicScopeSchema>;

export const publicMetaSchema = z.object({
  patch: z.object({ version: z.string().min(1), key: z.string().regex(/^\d+\.\d+$/) }).strict(),
  scope: publicScopeSchema,
  coverageStartedAt: isoDate,
  publishedAt: isoDate,
  collectedAt: isoDate,
  minimumSample: nonnegativeInteger,
  datasetState: z.literal("ready"),
  runStatus: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]),
  stage: z.string().min(1),
  counters: z.object({ matchesDiscovered: nonnegativeInteger, matchesIngested: nonnegativeInteger, observationsAccepted: nonnegativeInteger, observationsRejected: nonnegativeInteger }).strict()
}).strict();
export type PublicMeta = z.infer<typeof publicMetaSchema>;

export const publicChampionSummarySchema = z.object({
  championId: nonnegativeInteger,
  slug: z.string().min(1),
  name: z.string().min(1),
  iconUrl: z.string().url(),
  roles: z.array(roleSchema).min(1)
}).strict();
export type PublicChampionSummary = z.infer<typeof publicChampionSummarySchema>;
export const publicChampionSchema = publicChampionSummarySchema.extend({ splashUrl: z.string().url().nullable() }).strict();
export type PublicChampion = z.infer<typeof publicChampionSchema>;

export const publicBaselineSchema = z.object({
  wins: nonnegativeInteger,
  losses: nonnegativeInteger,
  sample: nonnegativeInteger,
  winRate: finiteNumber
}).strict().superRefine((value, ctx) => {
  if (value.wins + value.losses !== value.sample) ctx.addIssue({ code: "custom", message: "wins + losses must equal sample", path: ["sample"] });
  if (value.winRate < 0 || value.winRate > 1) ctx.addIssue({ code: "custom", message: "winRate must be between 0 and 1", path: ["winRate"] });
});
export type PublicBaseline = z.infer<typeof publicBaselineSchema>;

export const publicStatRowSchema = z.object({
  key: z.string().min(1),
  itemIds: z.array(nonnegativeInteger).min(1).max(3),
  wins: nonnegativeInteger,
  losses: nonnegativeInteger,
  sample: nonnegativeInteger,
  rawWinRate: finiteNumber,
  buildRate: finiteNumber,
  baselineDelta: finiteNumber,
  confidenceLower: finiteNumber,
  confidenceUpper: finiteNumber,
  adjustedScore: finiteNumber.nullable(),
  confidence: z.enum(["recommended", "low"])
}).strict().superRefine((value, ctx) => {
  if (value.wins + value.losses !== value.sample) ctx.addIssue({ code: "custom", message: "wins + losses must equal sample", path: ["sample"] });
  for (const field of ["rawWinRate", "buildRate", "confidenceLower", "confidenceUpper"] as const) {
    if (value[field] < 0 || value[field] > 1) ctx.addIssue({ code: "custom", message: `${field} must be between 0 and 1`, path: [field] });
  }
  if (value.confidenceLower > value.confidenceUpper) ctx.addIssue({ code: "custom", message: "confidence interval is inverted", path: ["confidenceLower"] });
  if (value.confidence === "low" && value.adjustedScore !== null) ctx.addIssue({ code: "custom", message: "low-confidence rows cannot be recommendations", path: ["adjustedScore"] });
});
export type PublicStatRow = z.infer<typeof publicStatRowSchema>;

export const publicStatsResponseSchema = z.object({
  meta: publicMetaSchema,
  champion: publicChampionSchema,
  role: roleSchema,
  baseline: publicBaselineSchema,
  view: statsViewSchema,
  sort: statsSortSchema,
  includeLowConfidence: z.boolean(),
  minimumSample: nonnegativeInteger,
  rows: z.array(publicStatRowSchema).max(100)
}).strict();
export type PublicStatsResponse = z.infer<typeof publicStatsResponseSchema>;

export const publicMethodologySchema = z.object({
  version: z.string().min(1),
  scope: publicScopeSchema,
  formulas: z.object({ rawWinRate: z.string().min(1), buildRate: z.string().min(1), baselineDelta: z.string().min(1), adjustedScore: z.string().min(1) }).strict(),
  minimumSample: nonnegativeInteger,
  lowConfidence: z.string().min(1),
  limitations: z.array(z.string().min(1)).min(1)
}).strict();
export type PublicMethodology = z.infer<typeof publicMethodologySchema>;

export const publicQueryErrorSchema = z.object({ code: z.enum(["dataset_warming", "champion_not_found", "role_not_found"]) }).strict();
export type PublicQueryError = z.infer<typeof publicQueryErrorSchema>;
