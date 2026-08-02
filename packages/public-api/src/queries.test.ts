import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { wilson95 } from "@lol/domain";
import { createPublicQueries } from "./queries";
import { publicStatsResponseSchema, type PublicStatRow, type StatsSort } from "./contracts";
import { sortStats } from "./sort";

const metadata = {
  patch_version: "16.16.1",
  patch_key: "16.16",
  coverage_started_at: "2026-08-01T00:00:00.000Z",
  published_at: "2026-08-02T00:00:00.000Z",
  collected_at: "2026-08-02T00:00:00.000Z",
  minimum_sample: 100,
  run_status: "COMPLETED",
  stage: "publish",
  matches_discovered: 10,
  matches_ingested: 10,
  observations_accepted: 100,
  observations_rejected: 0
};

const statsRow = {
  ...metadata,
  selected_champion_id: 222,
  slug: "jinx",
  name: "Jinx",
  icon_url: "https://example.test/jinx.png",
  splash_url: null,
  roles: ["BOTTOM", "UTILITY"],
  baseline_wins: 60,
  baseline_losses: 40,
  baseline_sample: 100,
  stat_key: "3031",
  item_ids: [3031],
  wins: 60,
  losses: 40,
  sample: 100
};

function renderedQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = query.toQuery({
    casing: undefined as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`
  });
  return { sql: rendered.sql, params: rendered.params };
}

function sqlText(query: SQL): string { return renderedQuery(query).sql; }

function cCollationCompare(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

type SourceRow = typeof statsRow;

function emulateSqlOrder(rows: readonly SourceRow[], sort: StatsSort, includeLowConfidence: boolean): SourceRow[] {
  const filtered = includeLowConfidence ? [...rows] : rows.filter((row) => row.sample >= 100);
  const score = (row: SourceRow): number | null => row.sample >= 100 ? wilson95(row.wins, row.sample).lower : null;
  const metric = (row: SourceRow): number => sort === "winRate" ? row.wins / row.sample : sort === "buildRate" ? row.sample / row.baseline_sample : row.sample;
  return filtered.sort((left, right) => {
    if (sort === "adjusted") {
      const leftScore = score(left);
      const rightScore = score(right);
      if (leftScore === null && rightScore !== null) return 1;
      if (leftScore !== null && rightScore === null) return -1;
      if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return rightScore > leftScore ? 1 : -1;
    } else {
      const leftMetric = metric(left);
      const rightMetric = metric(right);
      if (leftMetric !== rightMetric) return rightMetric > leftMetric ? 1 : -1;
    }
    if (left.sample !== right.sample) return right.sample - left.sample;
    return cCollationCompare(left.stat_key, right.stat_key);
  }).slice(0, 100);
}

function publicRow(row: SourceRow): PublicStatRow {
  const interval = wilson95(row.wins, row.sample);
  return {
    key: row.stat_key,
    itemIds: row.item_ids,
    wins: row.wins,
    losses: row.losses,
    sample: row.sample,
    rawWinRate: row.wins / row.sample,
    buildRate: row.sample / row.baseline_sample,
    baselineDelta: Number((row.wins / row.sample - row.baseline_wins / row.baseline_sample).toFixed(12)),
    confidenceLower: interval.lower,
    confidenceUpper: interval.upper,
    adjustedScore: row.sample >= 100 ? interval.lower : null,
    confidence: row.sample >= 100 ? "recommended" : "low"
  };
}

describe("stats query boundary", () => {
  it("keeps the bounded SQL window aligned with an independent C-order reference for every sort", async () => {
    const keys = ["1", "10", "10:20", "1:10", "1:2", "1:20", ...Array.from({ length: 125 }, (_, index) => String(2000 + index))];
    const sourceRows = keys.map((stat_key, index) => {
      const sample = index < 90 ? 100 + (index % 7) : 99;
      const wins = Math.min(sample, 45 + (index % 53));
      return { ...statsRow, baseline_wins: 600, baseline_losses: 400, baseline_sample: 1000, stat_key, item_ids: stat_key.split(":").map(Number), wins, losses: sample - wins, sample };
    });
    expect(sourceRows.length).toBeGreaterThan(100);
    const fullSource = sourceRows.map(publicRow);
    const sorts = ["adjusted", "winRate", "buildRate", "sample"] as const;
    const orderFragments: Record<StatsSort, RegExp> = {
      adjusted: /ORDER BY CASE WHEN s\.sample >= a\.minimum_sample THEN CASE WHEN s\.sample > 0 THEN .*? ELSE 0 END ELSE NULL END DESC NULLS LAST, s\.sample DESC NULLS LAST, s\.stat_key COLLATE "C"\s+LIMIT 100/s,
      winRate: /ORDER BY CASE WHEN s\.sample > 0 THEN s\.wins::double precision \/ s\.sample::double precision ELSE 0 END DESC, s\.sample DESC NULLS LAST, s\.stat_key COLLATE "C"\s+LIMIT 100/s,
      buildRate: /ORDER BY CASE WHEN b\.sample > 0 THEN s\.sample::double precision \/ b\.sample::double precision ELSE 0 END DESC, s\.sample DESC NULLS LAST, s\.stat_key COLLATE "C"\s+LIMIT 100/s,
      sample: /ORDER BY s\.sample DESC NULLS LAST, s\.stat_key COLLATE "C"\s+LIMIT 100/s
    };

    for (const sort of sorts) {
      for (const includeLowConfidence of [true, false]) {
        const captures: { sql: string; params: unknown[] }[] = [];
        const response = await createPublicQueries({
          execute: async (query) => {
            const rendered = renderedQuery(query);
            captures.push(rendered);
            return emulateSqlOrder(sourceRows, sort, includeLowConfidence);
          }
        }).stats({ championId: 222, role: "BOTTOM", view: "items", sort, includeLowConfidence });
        expect("code" in response).toBe(false);
        expect(captures).toHaveLength(1);
        expect(captures[0]?.sql).toMatch(orderFragments[sort]);
        expect(captures[0]?.params).toContain(222);
        if (!("code" in response)) {
          const expected = sortStats(fullSource.filter((row) => includeLowConfidence || row.sample >= 100), sort).slice(0, 100).map((row) => row.key);
          expect(response.rows).toHaveLength(Math.min(100, expected.length));
          expect(response.rows.map((row) => row.key)).toEqual(expected);
          expect(response.rows.some((row) => row.confidence === "low")).toBe(expected.some((key) => sourceRows.find((source) => source.stat_key === key)?.sample! < 100));
        }
      }
    }
  });

  it("emits typed Wilson arithmetic and C-collated key ordering", async () => {
    let statement = "";
    await createPublicQueries({
      execute: async (query) => {
        statement = sqlText(query);
        return [statsRow];
      }
    }).stats({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: true });

    expect(statement).toContain("1.959963984540054::double precision * 1.959963984540054::double precision");
    expect(statement).toContain('s.stat_key COLLATE "C"');
  });

  it("projects every published champion role into a strict stats response", async () => {
    const queries: string[] = [];
    const response = await createPublicQueries({
      execute: async (query) => {
        const text = sqlText(query);
        queries.push(text);
        // Model PostgreSQL's outer projection: roles are only returned when
        // selected_champion.roles is included by the final SELECT.
        return [{ ...statsRow, ...(text.includes("c.roles") ? {} : { roles: undefined }) }];
      }
    }).stats({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false });

    expect("code" in response).toBe(false);
    if ("code" in response) return;
    expect(response.champion.roles).toEqual(["BOTTOM", "UTILITY"]);
    expect(response.rows).toHaveLength(1);
    publicStatsResponseSchema.parse(response);
    expect(queries[0]).toContain("c.roles");
  });

  it.each([
    ["dataset_warming", []],
    ["champion_not_found", [{ ...statsRow, selected_champion_id: null }]],
    ["role_not_found", [{ ...statsRow, baseline_sample: null }]]
  ] as const)("distinguishes %s from other empty stats states", async (code, rows) => {
    const response = await createPublicQueries({ execute: async () => rows }).stats({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false });
    expect(response).toEqual({ code });
  });
});
