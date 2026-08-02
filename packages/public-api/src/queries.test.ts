import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { createPublicQueries } from "./queries";
import { publicStatsResponseSchema } from "./contracts";

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
