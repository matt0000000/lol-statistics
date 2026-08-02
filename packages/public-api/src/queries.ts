import { sql, type SQL } from "drizzle-orm";
import { WILSON_Z, wilson95 } from "@lol/domain";
import type {
  PublicChampion,
  PublicChampionSummary,
  PublicMeta,
  PublicMethodology,
  PublicQueryError,
  PublicStatRow,
  PublicStatsResponse,
  Role,
  StatsSort,
  StatsView
} from "./contracts";
import {
  publicChampionSchema,
  publicChampionSummarySchema,
  publicMetaSchema,
  publicMethodologySchema,
  publicQueryErrorSchema,
  publicStatsResponseSchema
} from "./contracts";
import { sortStats } from "./sort";
import { attachPublicationScope } from "./scope";

export type QueryDatabase = { execute: (query: SQL) => Promise<unknown> } | { db: { execute: (query: SQL) => Promise<unknown> } };
export type PublicStatsInput = { championId: number; role: Role; view: StatsView; sort: StatsSort; includeLowConfidence: boolean };
export interface PublicQueries {
  meta(): Promise<PublicMeta | PublicQueryError>;
  champions(search?: string): Promise<PublicChampionSummary[] | PublicQueryError>;
  championDirectory(): Promise<PublicChampionSummary[] | PublicQueryError>;
  championBySlug(slug: string): Promise<PublicChampion | PublicQueryError>;
  champion(championId: number): Promise<PublicChampion | PublicQueryError>;
  stats(input: PublicStatsInput): Promise<PublicStatsResponse | PublicQueryError>;
  methodology(): Promise<PublicMethodology>;
}

type Row = Record<string, unknown>;
const viewNames: Record<StatsView, string> = {
  items: "public_item_stats",
  pairs: "public_combination_stats",
  trios: "public_combination_stats",
  boots: "public_boots_stats"
};

// Keep this literal in lockstep with the domain implementation and type it
// before any arithmetic so PostgreSQL follows IEEE double precision semantics.
const wilsonZ = sql.raw(`${WILSON_Z}::double precision`);
const canonicalKey = sql.raw('s.stat_key COLLATE "C"');

function wilsonLowerBoundSql() {
  const proportion = sql`s.wins::double precision / s.sample::double precision`;
  const zSquared = sql`${wilsonZ} * ${wilsonZ}`;
  const denominator = sql`(1 + ${zSquared} / s.sample::double precision)`;
  const center = sql`(${proportion} + ${zSquared} / (2 * s.sample::double precision)) / ${denominator}`;
  const margin = sql`${wilsonZ} * sqrt(((${proportion} * (1 - ${proportion}) + ${zSquared} / (4 * s.sample::double precision)) / s.sample::double precision)) / ${denominator}`;
  return sql`(${center} - ${margin})`;
}

function rowsOf(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object" && Array.isArray((value as { rows?: unknown }).rows)) return (value as { rows: Row[] }).rows;
  if (value && typeof value === "object" && Symbol.iterator in value) return [...value as Iterable<Row>];
  return [];
}

function firstRow(value: unknown): Row | undefined { return rowsOf(value)[0]; }

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function numberValue(value: unknown): number { return Number(value ?? 0); }
function integerValue(value: unknown): number { return Math.trunc(numberValue(value)); }

/** Locale-independent, accent-insensitive text folding for user search. */
export function normalizeChampionSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Slugs are canonical ASCII path segments; lookup is case-insensitive. */
export function normalizeChampionSlug(value: string): string | undefined {
  const trimmed = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(trimmed) ? trimmed.toLowerCase() : undefined;
}

function publicMeta(row: Row): PublicMeta {
  return publicMetaSchema.parse({
    patch: { version: String(row.patch_version), key: String(row.patch_key) },
    scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
    coverageStartedAt: iso(row.coverage_started_at),
    publishedAt: iso(row.published_at),
    collectedAt: iso(row.collected_at),
    minimumSample: integerValue(row.minimum_sample),
    datasetState: "ready",
    runStatus: String(row.run_status) as PublicMeta["runStatus"],
    stage: String(row.stage),
    counters: {
      matchesDiscovered: integerValue(row.matches_discovered),
      matchesIngested: integerValue(row.matches_ingested),
      observationsAccepted: integerValue(row.observations_accepted),
      observationsRejected: integerValue(row.observations_rejected)
    }
  });
}

function publicationId(row: Row): string | undefined {
  return typeof row.publication_id === "string" && row.publication_id.length > 0 ? row.publication_id : undefined;
}

function championFromRow(row: Row): PublicChampion {
  return {
    championId: integerValue(row.selected_champion_id ?? row.champion_id),
    slug: String(row.slug),
    name: String(row.name),
    iconUrl: String(row.icon_url),
    splashUrl: row.splash_url == null ? null : String(row.splash_url),
    roles: []
  };
}

function parseRoles(row: Row): Role[] {
  const value = row.roles;
  if (Array.isArray(value)) return value.filter((role): role is Role => typeof role === "string") as Role[];
  if (typeof value === "string") return value.replace(/[{}]/g, "").split(",").filter(Boolean) as Role[];
  return [];
}

function baselineFromRow(row: Row) {
  const wins = integerValue(row.baseline_wins ?? row.wins);
  const losses = integerValue(row.baseline_losses ?? row.losses);
  const sample = integerValue(row.baseline_sample ?? row.sample);
  return { wins, losses, sample, winRate: sample === 0 ? 0 : wins / sample };
}

function itemIds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(integerValue);
  if (typeof value === "string") return value.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);
  return [];
}

function statRow(row: Row, minimumSample: number, baselineSample: number, baselineWins: number): PublicStatRow {
  const wins = integerValue(row.wins);
  const losses = integerValue(row.losses);
  const sample = integerValue(row.sample);
  const rawWinRate = sample === 0 ? 0 : wins / sample;
  const buildRate = baselineSample === 0 ? 0 : sample / baselineSample;
  const baselineWinRate = baselineSample === 0 ? 0 : baselineWins / baselineSample;
  const interval = wilson95(wins, sample);
  const recommended = sample >= minimumSample;
  return {
    key: String(row.stat_key),
    itemIds: itemIds(row.item_ids),
    wins,
    losses,
    sample,
    rawWinRate,
    buildRate,
    baselineDelta: Number((rawWinRate - baselineWinRate).toFixed(12)),
    confidenceLower: interval.lower,
    confidenceUpper: interval.upper,
    adjustedScore: recommended ? interval.lower : null,
    confidence: recommended ? "recommended" : "low"
  };
}

export function createPublicQueries(database: QueryDatabase): PublicQueries {
  const executor = "execute" in database ? database : database.db;
  const execute = async <T extends Row = Row>(query: SQL): Promise<T[]> => rowsOf(await executor.execute(query)) as T[];

  return {
    async meta() {
      const row = firstRow(await execute(sql`SELECT * FROM public_active_publication LIMIT 1`));
      if (!row) return publicQueryErrorSchema.parse({ code: "dataset_warming" });
      const parsed = publicMeta(row);
      return attachPublicationScope(parsed, publicationId(row));
    },

    async champions(search) {
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT a.publication_id, x.champion_id, x.slug, x.name, x.icon_url, x.roles
        FROM active a
        LEFT JOIN (
          SELECT b.publication_id, c.champion_id, c.slug, c.name, c.icon_url,
            ARRAY_AGG(DISTINCT b.role ORDER BY b.role) AS roles,
            c.patch_id
          FROM public_champions c
          JOIN public_champion_role_baselines b ON b.champion_id = c.champion_id
          GROUP BY b.publication_id, c.champion_id, c.slug, c.name, c.icon_url, c.patch_id
        ) x ON x.publication_id = a.publication_id AND x.patch_id = a.patch_id
        ORDER BY x.name COLLATE "C", x.champion_id
        LIMIT 256
      `);
      if (rows.length === 0) return publicQueryErrorSchema.parse({ code: "dataset_warming" });
      const scope = rows.find((row) => publicationId(row))?.publication_id;
      const needle = search?.trim() ? normalizeChampionSearch(search.trim()) : "";
      const output = rows.filter((row) => row.champion_id != null)
        .map((row) => publicChampionSummarySchema.parse({ championId: integerValue(row.champion_id), slug: String(row.slug), name: String(row.name), iconUrl: String(row.icon_url), roles: parseRoles(row) }))
        .filter((entry) => !needle || normalizeChampionSearch(`${entry.name} ${entry.slug}`).includes(needle))
        .slice(0, 50);
      return attachPublicationScope(output, scope);
    },

    async championDirectory() {
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT a.publication_id, c.champion_id, c.slug, c.name, c.icon_url,
          ARRAY_AGG(DISTINCT b.role ORDER BY b.role) AS roles
        FROM active a
        JOIN public_champions c ON c.patch_id = a.patch_id
        JOIN public_champion_role_baselines b ON b.publication_id = a.publication_id AND b.champion_id = c.champion_id
        GROUP BY a.publication_id, c.champion_id, c.slug, c.name, c.icon_url
        ORDER BY c.name COLLATE "C", c.champion_id
        LIMIT 256
      `);
      if (rows.length === 0) return publicQueryErrorSchema.parse({ code: "dataset_warming" });
      const scope = rows.find((row) => publicationId(row))?.publication_id;
      const output = rows.filter((row) => row.champion_id != null).map((row) => publicChampionSummarySchema.parse({ championId: integerValue(row.champion_id), slug: String(row.slug), name: String(row.name), iconUrl: String(row.icon_url), roles: parseRoles(row) })) as PublicChampionSummary[];
      return attachPublicationScope(output, scope);
    },

    async championBySlug(slug) {
      const canonical = normalizeChampionSlug(slug);
      if (!canonical) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT a.publication_id, c.champion_id, c.slug, c.name, c.icon_url, c.splash_url,
          COALESCE(ARRAY_AGG(DISTINCT b.role ORDER BY b.role) FILTER (WHERE b.role IS NOT NULL), ARRAY[]::role[]) AS roles
        FROM active a
        LEFT JOIN public_champions c ON c.patch_id = a.patch_id AND lower(c.slug) = ${canonical}
        LEFT JOIN public_champion_role_baselines b ON b.publication_id = a.publication_id AND b.champion_id = c.champion_id
        GROUP BY a.publication_id, c.champion_id, c.slug, c.name, c.icon_url, c.splash_url
      `);
      const active = rows.find((row) => publicationId(row));
      if (!active) return publicQueryErrorSchema.parse({ code: "dataset_warming" });
      const matches = rows.filter((row) => row.champion_id != null);
      // Slug collisions are unsafe to resolve by guesswork: fail closed.
      if (matches.length !== 1) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      if (parseRoles(matches[0]!).length === 0) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      const champion = championFromRow(matches[0]!);
      champion.roles = parseRoles(matches[0]!);
      return attachPublicationScope(publicChampionSchema.parse(champion), publicationId(matches[0]!));
    },

    async champion(championId) {
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT a.publication_id, c.champion_id, c.slug, c.name, c.icon_url, c.splash_url,
          COALESCE(ARRAY_AGG(DISTINCT b.role ORDER BY b.role) FILTER (WHERE b.role IS NOT NULL), ARRAY[]::role[]) AS roles
        FROM public_champions c
        JOIN active a ON a.patch_id = c.patch_id
        LEFT JOIN public_champion_role_baselines b ON b.publication_id = a.publication_id AND b.champion_id = c.champion_id
        WHERE c.champion_id = ${championId}
        GROUP BY a.publication_id, c.champion_id, c.slug, c.name, c.icon_url, c.splash_url
      `);
      if (rows.length === 0) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      const champion = championFromRow(rows[0]!);
      champion.roles = parseRoles(rows[0]!);
      if (champion.roles.length === 0) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      return attachPublicationScope(publicChampionSchema.parse(champion), publicationId(rows[0]!));
    },

    async stats(input) {
      const source = viewNames[input.view];
      const sizeClause = input.view === "pairs" ? sql`AND s.size = 2` : input.view === "trios" ? sql`AND s.size = 3` : sql``;
      // Keep the bounded SQL window aligned with the exact JS comparator. The
      // canonical keys are numeric IDs joined by ':', so the C collation is
      // deterministic and matches localeCompare for this restricted alphabet.
      const adjustedScore = wilsonLowerBoundSql();
      const orderClause = input.sort === "adjusted"
        ? sql`ORDER BY CASE WHEN s.sample >= a.minimum_sample THEN CASE WHEN s.sample > 0 THEN ${adjustedScore} ELSE 0 END ELSE NULL END DESC NULLS LAST, s.sample DESC NULLS LAST, ${canonicalKey}`
        : input.sort === "winRate"
          ? sql`ORDER BY CASE WHEN s.sample > 0 THEN s.wins::double precision / s.sample::double precision ELSE 0 END DESC, s.sample DESC NULLS LAST, ${canonicalKey}`
          : input.sort === "buildRate"
            ? sql`ORDER BY CASE WHEN b.sample > 0 THEN s.sample::double precision / b.sample::double precision ELSE 0 END DESC, s.sample DESC NULLS LAST, ${canonicalKey}`
            : sql`ORDER BY s.sample DESC NULLS LAST, ${canonicalKey}`;
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1),
        selected_champion AS (
          SELECT c.champion_id, c.slug, c.name, c.icon_url, c.splash_url,
            COALESCE((SELECT ARRAY_AGG(DISTINCT b2.role ORDER BY b2.role)
              FROM public_champion_role_baselines b2
              JOIN active a2 ON a2.publication_id = b2.publication_id
              WHERE b2.champion_id = c.champion_id), ARRAY[]::role[]) AS roles
          FROM public_champions c JOIN active a ON a.patch_id = c.patch_id
          WHERE c.champion_id = ${input.championId}
        ),
        selected_baseline AS (
          SELECT b.* FROM public_champion_role_baselines b JOIN active a ON a.publication_id = b.publication_id
          WHERE b.champion_id = ${input.championId} AND b.role = ${input.role}
        )
        SELECT a.*, c.champion_id AS selected_champion_id, c.slug, c.name, c.icon_url, c.splash_url,
          c.roles,
          b.wins AS baseline_wins, b.losses AS baseline_losses, b.sample AS baseline_sample,
          s.stat_key, s.item_ids, s.wins, s.losses, s.sample
        FROM active a
        LEFT JOIN selected_champion c ON true
        LEFT JOIN selected_baseline b ON true
        LEFT JOIN ${sql.raw(source)} s ON s.publication_id = a.publication_id AND s.champion_id = ${input.championId} AND s.role = ${input.role} ${sizeClause}
          AND (${input.includeLowConfidence} OR s.sample >= a.minimum_sample)
        ${orderClause}
        LIMIT 100
      `);
      if (rows.length === 0) return publicQueryErrorSchema.parse({ code: "dataset_warming" });
      const first = rows[0]!;
      if (first.selected_champion_id == null) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      if (first.baseline_sample == null) return publicQueryErrorSchema.parse({ code: "role_not_found" });
      const minimumSample = integerValue(first.minimum_sample);
      const baseline = baselineFromRow(first);
      const champion = championFromRow(first);
      champion.roles = parseRoles(first);
      if (champion.roles.length === 0) return publicQueryErrorSchema.parse({ code: "champion_not_found" });
      const stats = rows.filter((row) => row.stat_key != null).map((row) => statRow(row, minimumSample, baseline.sample, baseline.wins));
      const parsed = publicStatsResponseSchema.parse({
        meta: publicMeta(first),
        champion,
        role: input.role,
        baseline,
        view: input.view,
        sort: input.sort,
        includeLowConfidence: input.includeLowConfidence,
        minimumSample,
        rows: sortStats(stats, input.sort).slice(0, 100)
      });
      const scope = publicationId(first);
      attachPublicationScope(parsed.meta, scope);
      return attachPublicationScope(parsed, scope);
    },

    async methodology() {
      return publicMethodologySchema.parse({
        version: "1",
        scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
        formulas: {
          rawWinRate: "wins / sample",
          buildRate: "sample / champion-role baseline sample",
          baselineDelta: "raw win rate - champion-role baseline win rate",
          adjustedScore: "lower bound of a two-sided 95% Wilson score interval"
        },
        minimumSample: 100,
        lowConfidence: "Rows below the publication minimum sample are hidden by default and never receive an adjusted recommendation score.",
        limitations: ["These aggregates describe correlation, not causation.", "Completed-item results include survivorship and gold-lead bias.", "Rank is measured at collection time."]
      });
    }
  };
}
