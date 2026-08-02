import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { createPublicQueries } from "./queries";
import { publicStatsResponseSchema, type StatsSort } from "./contracts";

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
  champion_id: 222,
  role: "BOTTOM",
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

// Independent reference: this intentionally repeats the published formula and
// comparator literals rather than importing any production implementation.
const REFERENCE_WILSON_Z = 1.959963984540054;
const REFERENCE_MINIMUM_SAMPLE = 100;

function referenceWilsonLower(wins: number, sample: number): number {
  if (sample === 0) return 0;
  const p = wins / sample;
  const zSquared = REFERENCE_WILSON_Z * REFERENCE_WILSON_Z;
  const denominator = 1 + zSquared / sample;
  const center = (p + zSquared / (2 * sample)) / denominator;
  const margin = REFERENCE_WILSON_Z * Math.sqrt((p * (1 - p) + zSquared / (4 * sample)) / sample) / denominator;
  return center - margin;
}

function referenceKeys(rows: readonly SourceRow[], sort: StatsSort, includeLowConfidence: boolean): string[] {
  const filtered = rows.filter((row) => row.champion_id === 222 && row.role === "BOTTOM" && (includeLowConfidence || row.sample >= REFERENCE_MINIMUM_SAMPLE));
  const score = (row: SourceRow): number | null => row.sample >= REFERENCE_MINIMUM_SAMPLE ? referenceWilsonLower(row.wins, row.sample) : null;
  const metric = (row: SourceRow): number => sort === "winRate" ? row.wins / row.sample : sort === "buildRate" ? row.sample / row.baseline_sample : row.sample;
  return [...filtered].sort((left, right) => {
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
  }).slice(0, 100).map((row) => row.stat_key);
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

const expectedOrderSql: Record<StatsSort, string> = {
  adjusted: 'ORDER BY CASE WHEN s.sample >= a.minimum_sample THEN CASE WHEN s.sample > 0 THEN ((s.wins::double precision / s.sample::double precision + 1.959963984540054::double precision * 1.959963984540054::double precision / (2 * s.sample::double precision)) / (1 + 1.959963984540054::double precision * 1.959963984540054::double precision / s.sample::double precision) - 1.959963984540054::double precision * sqrt(((s.wins::double precision / s.sample::double precision * (1 - s.wins::double precision / s.sample::double precision) + 1.959963984540054::double precision * 1.959963984540054::double precision / (4 * s.sample::double precision)) / s.sample::double precision)) / (1 + 1.959963984540054::double precision * 1.959963984540054::double precision / s.sample::double precision)) ELSE 0 END ELSE NULL END DESC NULLS LAST, s.sample DESC NULLS LAST, s.stat_key COLLATE "C" LIMIT 100',
  winRate: 'ORDER BY CASE WHEN s.sample > 0 THEN s.wins::double precision / s.sample::double precision ELSE 0 END DESC, s.sample DESC NULLS LAST, s.stat_key COLLATE "C" LIMIT 100',
  buildRate: 'ORDER BY CASE WHEN b.sample > 0 THEN s.sample::double precision / b.sample::double precision ELSE 0 END DESC, s.sample DESC NULLS LAST, s.stat_key COLLATE "C" LIMIT 100',
  sample: 'ORDER BY s.sample DESC NULLS LAST, s.stat_key COLLATE "C" LIMIT 100'
};

function sqlOrder(sql: string): StatsSort {
  const normalized = normalizeSql(sql);
  const order = normalized.slice(normalized.lastIndexOf("ORDER BY"), normalized.indexOf("LIMIT 100") + "LIMIT 100".length);
  const sort = (Object.entries(expectedOrderSql) as [StatsSort, string][]).find(([, expected]) => order === expected)?.[0];
  if (!sort) throw new Error(`unexpected stats ORDER/LIMIT: ${order}`);
  return sort;
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
    const sorts = ["adjusted", "winRate", "buildRate", "sample"] as const;

    for (const sort of sorts) {
      for (const includeLowConfidence of [true, false]) {
        const captures: { sql: string; params: unknown[] }[] = [];
        const response = await createPublicQueries({
          execute: async (query) => {
            const rendered = renderedQuery(query);
            captures.push(rendered);
            const normalized = normalizeSql(rendered.sql);
            expect(normalized).toContain("LEFT JOIN public_item_stats s");
            expect(normalized).toContain("s.champion_id = $4 AND s.role = $5");
            expect(normalized).toContain("AND ($6 OR s.sample >= a.minimum_sample)");
            expect(rendered.params).toEqual([222, 222, "BOTTOM", 222, "BOTTOM", includeLowConfidence]);
            const sqlSort = sqlOrder(rendered.sql);
            expect(sqlSort).toBe(sort);
            const championId = rendered.params[3];
            const role = rendered.params[4];
            const include = rendered.params[5];
            if (typeof championId !== "number" || typeof role !== "string" || typeof include !== "boolean") throw new Error("unexpected parameter types");
            return sourceRows
              .filter((row) => row.champion_id === championId && row.role === role && (include || row.sample >= REFERENCE_MINIMUM_SAMPLE))
              .sort((left, right) => {
                const expected = referenceKeys([left, right], sqlSort, true);
                return expected[0] === left.stat_key ? -1 : expected[0] === right.stat_key ? 1 : 0;
              })
              .slice(0, 100);
          }
        }).stats({ championId: 222, role: "BOTTOM", view: "items", sort, includeLowConfidence });
        expect("code" in response).toBe(false);
        expect(captures).toHaveLength(1);
        expect(sqlOrder(captures[0]!.sql)).toBe(sort);
        if (!("code" in response)) {
          const expected = referenceKeys(sourceRows, sort, includeLowConfidence);
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

    const normalized = normalizeSql(statement);
    const order = normalized.slice(normalized.lastIndexOf("ORDER BY"), normalized.indexOf("LIMIT 100") + "LIMIT 100".length);
    expect(order).toBe(expectedOrderSql.adjusted);
    expect(order).toContain("s.wins::double precision / s.sample::double precision");
    expect(order).toContain("(1 - s.wins::double precision / s.sample::double precision)");
    expect(order).toContain("sqrt(((");
    expect(order).toContain("DESC NULLS LAST, s.sample DESC NULLS LAST, s.stat_key COLLATE \"C\" LIMIT 100");
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
