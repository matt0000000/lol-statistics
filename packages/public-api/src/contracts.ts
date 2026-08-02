import z from "zod";
import { wilson95 } from "@lol/domain";

const finiteNumber = z.number().finite();
const nonnegativeInteger = z.number().int().nonnegative();
const isoDate = z.string().datetime({ offset: true });

// PostgreSQL double precision values are serialized as JSON numbers. Allow a
// tiny representation error while still rejecting materially inconsistent
// derived values supplied by an untrusted/public row source.
const DERIVED_TOLERANCE = 1e-9;
function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= DERIVED_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right));
}

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
  const expected = value.sample === 0 ? 0 : value.wins / value.sample;
  if (!approximatelyEqual(value.winRate, expected)) ctx.addIssue({ code: "custom", message: "baseline winRate does not match wins / sample", path: ["winRate"] });
});
export type PublicBaseline = z.infer<typeof publicBaselineSchema>;

export const publicStatRowSchema = z.object({
  key: z.string().min(1),
  itemIds: z.array(nonnegativeInteger).min(1).max(3),
  // Official Data Dragon metadata for every item in the stat key. Public SQL
  // views populate this in canonical item-id order for all production rows.
  itemMetadata: z.array(z.object({ id: nonnegativeInteger, name: z.string().min(1), iconUrl: z.string().url() }).strict()).max(3),
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
  if (value.itemMetadata.length !== value.itemIds.length) ctx.addIssue({ code: "custom", message: "item metadata must cover every item id", path: ["itemMetadata"] });
  value.itemMetadata.forEach((item, index) => { if (item.id !== value.itemIds[index]) ctx.addIssue({ code: "custom", message: "item metadata must follow item id order", path: ["itemMetadata", index, "id"] }); });
  if (value.wins + value.losses !== value.sample) ctx.addIssue({ code: "custom", message: "wins + losses must equal sample", path: ["sample"] });
  if (value.sample <= 0) ctx.addIssue({ code: "custom", message: "sample must be positive", path: ["sample"] });
  if (value.key !== value.itemIds.join(":")) ctx.addIssue({ code: "custom", message: "stat key must be the canonical item-id key", path: ["key"] });
  if (value.itemIds.some((id, index) => index > 0 && id < value.itemIds[index - 1]!)) ctx.addIssue({ code: "custom", message: "item ids must be in numeric order", path: ["itemIds"] });
  for (const field of ["rawWinRate", "buildRate", "confidenceLower", "confidenceUpper"] as const) {
    if (value[field] < 0 || value[field] > 1) ctx.addIssue({ code: "custom", message: `${field} must be between 0 and 1`, path: [field] });
  }
  if (value.confidenceLower > value.confidenceUpper) ctx.addIssue({ code: "custom", message: "confidence interval is inverted", path: ["confidenceLower"] });
  if (value.confidenceLower < 0 || value.confidenceUpper > 1) ctx.addIssue({ code: "custom", message: "confidence interval must be between 0 and 1", path: ["confidenceLower"] });
  if (!approximatelyEqual(value.rawWinRate, value.sample === 0 ? 0 : value.wins / value.sample)) ctx.addIssue({ code: "custom", message: "rawWinRate does not match wins / sample", path: ["rawWinRate"] });
  if (value.sample > 0 && value.wins <= value.sample) {
    const expectedInterval = wilson95(value.wins, value.sample);
    if (!approximatelyEqual(value.confidenceLower, expectedInterval.lower)) ctx.addIssue({ code: "custom", message: "confidenceLower does not match the Wilson lower bound", path: ["confidenceLower"] });
    if (!approximatelyEqual(value.confidenceUpper, expectedInterval.upper)) ctx.addIssue({ code: "custom", message: "confidenceUpper does not match the Wilson upper bound", path: ["confidenceUpper"] });
    if (value.adjustedScore !== null && !approximatelyEqual(value.adjustedScore, expectedInterval.lower)) ctx.addIssue({ code: "custom", message: "adjustedScore does not match the Wilson lower bound", path: ["adjustedScore"] });
  }
  if (value.adjustedScore !== null) {
    if (value.adjustedScore < 0 || value.adjustedScore > 1) ctx.addIssue({ code: "custom", message: "adjustedScore must be between 0 and 1", path: ["adjustedScore"] });
    if (!approximatelyEqual(value.adjustedScore, value.confidenceLower)) ctx.addIssue({ code: "custom", message: "adjustedScore must match the Wilson lower bound", path: ["adjustedScore"] });
  }
  if (value.confidence === "recommended" && value.adjustedScore === null) ctx.addIssue({ code: "custom", message: "recommended rows require an adjusted score", path: ["adjustedScore"] });
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
}).strict().superRefine((value, ctx) => {
  if (value.minimumSample !== value.meta.minimumSample) ctx.addIssue({ code: "custom", message: "minimumSample must match publication metadata", path: ["minimumSample"] });
  const expectedBaseline = value.baseline.sample === 0 ? 0 : value.baseline.wins / value.baseline.sample;
  if (!approximatelyEqual(value.baseline.winRate, expectedBaseline)) ctx.addIssue({ code: "custom", message: "baseline winRate does not match wins / sample", path: ["baseline", "winRate"] });
  const expectedLength = value.view === "pairs" ? 2 : value.view === "trios" ? 3 : 1;
  for (const [index, row] of value.rows.entries()) {
    if (row.itemIds.length !== expectedLength) ctx.addIssue({ code: "custom", message: `row must contain ${expectedLength} item ids for ${value.view}`, path: ["rows", index, "itemIds"] });
    const recommended = row.sample >= value.minimumSample;
    if ((row.confidence === "recommended") !== recommended) ctx.addIssue({ code: "custom", message: "confidence must match minimum sample", path: ["rows", index, "confidence"] });
    if (!value.includeLowConfidence && (!recommended || row.confidence === "low")) {
      ctx.addIssue({ code: "custom", message: "low-confidence rows are not allowed when includeLowConfidence is false", path: ["rows", index] });
    }
    if (value.baseline.sample === 0) {
      ctx.addIssue({ code: "custom", message: "rows require a positive baseline sample", path: ["baseline", "sample"] });
    } else {
      const expectedBuild = row.sample / value.baseline.sample;
      const expectedDelta = row.rawWinRate - value.baseline.winRate;
      if (!approximatelyEqual(row.buildRate, expectedBuild)) ctx.addIssue({ code: "custom", message: "buildRate does not match sample / baseline sample", path: ["rows", index, "buildRate"] });
      if (!approximatelyEqual(row.baselineDelta, expectedDelta)) ctx.addIssue({ code: "custom", message: "baselineDelta does not match raw - baseline", path: ["rows", index, "baselineDelta"] });
    }
  }
});
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
