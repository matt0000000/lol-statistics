import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { wilson95 } from "@lol/domain";
import { createPublicQueries } from "./queries";
import { publicStatsResponseSchema } from "./contracts";
import { compareCanonicalKeys } from "./sort";

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

function sqlText(query: SQL): string {
  return query.toQuery({
    casing: undefined as never,
    escapeName: (name) => `"${name}"`,
    escapeParam: (index) => `$${index + 1}`,
    escapeString: (value) => `'${value.replaceAll("'", "''")}'`
  }).sql;
}

describe("stats query boundary", () => {
  it("keeps fake SQL cap and JS order aligned for every sort on adversarial ties", async () => {
    const keys = ["1", "10", "10:20", "1:10", "1:2", "1:20", ...Array.from({ length: 114 }, (_, index) => String(2000 + index))];
    const sourceRows = keys.map((stat_key, index) => {
      const sample = index < 105 ? 100 : 99;
      const wins = index < 105 ? 50 + (index % 3) : 49;
      return { ...statsRow, stat_key, item_ids: stat_key.split(":").map(Number), wins, losses: sample - wins, sample };
    });
    const sqlOrder = (sort: "adjusted" | "winRate" | "buildRate" | "sample") => [...sourceRows].sort((left, right) => {
      const leftAdjusted = left.sample >= 100 ? wilson95(left.wins, left.sample).lower : null;
      const rightAdjusted = right.sample >= 100 ? wilson95(right.wins, right.sample).lower : null;
      if (sort === "adjusted") {
        if (leftAdjusted === null && rightAdjusted !== null) return 1;
        if (leftAdjusted !== null && rightAdjusted === null) return -1;
        if (leftAdjusted !== null && rightAdjusted !== null && leftAdjusted !== rightAdjusted) return rightAdjusted > leftAdjusted ? 1 : -1;
      } else {
        const leftValue = sort === "winRate" ? left.wins / left.sample : sort === "buildRate" ? left.sample / 1000 : left.sample;
        const rightValue = sort === "winRate" ? right.wins / right.sample : sort === "buildRate" ? right.sample / 1000 : right.sample;
        if (leftValue !== rightValue) return rightValue > leftValue ? 1 : -1;
      }
      return right.sample - left.sample || compareCanonicalKeys(left.stat_key, right.stat_key);
    }).slice(0, 100);

    for (const sort of ["adjusted", "winRate", "buildRate", "sample"] as const) {
      const expected = sqlOrder(sort).map((row) => row.stat_key);
      const response = await createPublicQueries({ execute: async () => sqlOrder(sort) }).stats({ championId: 222, role: "BOTTOM", view: "items", sort, includeLowConfidence: true });
      expect("code" in response).toBe(false);
      if (!("code" in response)) expect(response.rows.map((row) => row.key)).toEqual(expected);
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
