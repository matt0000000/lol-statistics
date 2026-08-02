import { sql, type SQL } from "drizzle-orm";
import { wilson95 } from "@lol/domain";
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
import { sortStats } from "./sort";

export type QueryDatabase = { execute: (query: SQL) => Promise<unknown> } | { db: { execute: (query: SQL) => Promise<unknown> } };
export type PublicStatsInput = { championId: number; role: Role; view: StatsView; sort: StatsSort; includeLowConfidence: boolean };
export interface PublicQueries {
  meta(): Promise<PublicMeta | PublicQueryError>;
  champions(search?: string): Promise<PublicChampionSummary[]>;
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

function publicMeta(row: Row): PublicMeta {
  return {
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
  };
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
      return row ? publicMeta(row) : { code: "dataset_warming" };
    },

    async champions(search) {
      const pattern = search?.trim() ? `%${search.trim().toLowerCase()}%` : null;
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT c.champion_id, c.slug, c.name, c.icon_url,
          COALESCE(ARRAY_AGG(DISTINCT b.role ORDER BY b.role) FILTER (WHERE b.role IS NOT NULL), ARRAY[]::role[]) AS roles
        FROM public_champions c
        JOIN active a ON a.patch_id = c.patch_id
        JOIN public_champion_role_baselines b ON b.publication_id = a.publication_id AND b.champion_id = c.champion_id
        WHERE (${pattern} IS NULL OR lower(c.name) LIKE ${pattern} OR lower(c.slug) LIKE ${pattern})
        GROUP BY c.champion_id, c.slug, c.name, c.icon_url
        ORDER BY lower(c.name), c.champion_id
        LIMIT 50
      `);
      return rows.map((row) => ({ championId: integerValue(row.champion_id), slug: String(row.slug), name: String(row.name), iconUrl: String(row.icon_url), roles: parseRoles(row) }));
    },

    async champion(championId) {
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1)
        SELECT c.champion_id, c.slug, c.name, c.icon_url, c.splash_url,
          COALESCE(ARRAY_AGG(DISTINCT b.role ORDER BY b.role) FILTER (WHERE b.role IS NOT NULL), ARRAY[]::role[]) AS roles
        FROM public_champions c
        JOIN active a ON a.patch_id = c.patch_id
        LEFT JOIN public_champion_role_baselines b ON b.publication_id = a.publication_id AND b.champion_id = c.champion_id
        WHERE c.champion_id = ${championId}
        GROUP BY c.champion_id, c.slug, c.name, c.icon_url, c.splash_url
      `);
      if (rows.length === 0) return { code: "champion_not_found" };
      const champion = championFromRow(rows[0]!);
      champion.roles = parseRoles(rows[0]!);
      return champion;
    },

    async stats(input) {
      const source = viewNames[input.view];
      const sizeClause = input.view === "pairs" ? sql`AND s.size = 2` : input.view === "trios" ? sql`AND s.size = 3` : sql``;
      const rows = await execute(sql`
        WITH active AS (SELECT * FROM public_active_publication LIMIT 1),
        selected_champion AS (
          SELECT c.champion_id, c.slug, c.name, c.icon_url, c.splash_url
          FROM public_champions c JOIN active a ON a.patch_id = c.patch_id
          WHERE c.champion_id = ${input.championId}
        ),
        selected_baseline AS (
          SELECT b.* FROM public_champion_role_baselines b JOIN active a ON a.publication_id = b.publication_id
          WHERE b.champion_id = ${input.championId} AND b.role = ${input.role}
        )
        SELECT a.*, c.champion_id AS selected_champion_id, c.slug, c.name, c.icon_url, c.splash_url,
          b.wins AS baseline_wins, b.losses AS baseline_losses, b.sample AS baseline_sample,
          s.stat_key, s.item_ids, s.wins, s.losses, s.sample
        FROM active a
        LEFT JOIN selected_champion c ON true
        LEFT JOIN selected_baseline b ON true
        LEFT JOIN ${sql.raw(source)} s ON s.publication_id = a.publication_id AND s.champion_id = ${input.championId} AND s.role = ${input.role} ${sizeClause}
          AND (${input.includeLowConfidence} OR s.sample >= a.minimum_sample)
        ORDER BY s.sample DESC NULLS LAST, s.stat_key
      `);
      if (rows.length === 0) return { code: "dataset_warming" };
      const first = rows[0]!;
      if (first.selected_champion_id == null) return { code: "champion_not_found" };
      if (first.baseline_sample == null) return { code: "role_not_found" };
      const minimumSample = integerValue(first.minimum_sample);
      const baseline = baselineFromRow(first);
      const champion = championFromRow(first);
      champion.roles = [input.role];
      const stats = rows.filter((row) => row.stat_key != null).map((row) => statRow(row, minimumSample, baseline.sample, baseline.wins));
      return {
        meta: publicMeta(first),
        champion,
        role: input.role,
        baseline,
        view: input.view,
        sort: input.sort,
        includeLowConfidence: input.includeLowConfidence,
        minimumSample,
        rows: sortStats(stats, input.sort).slice(0, 100)
      };
    },

    async methodology() {
      return {
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
      };
    }
  };
}
