import { describe, expect, it } from "vitest";
import { publicStatsResponseSchema, type PublicChampion, type PublicMeta, type PublicQueries } from "@lol/public-api";
import { parseStatsParams, resolveChampionPage } from "./page";

const champion: PublicChampion = { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM", "UTILITY"] };
const meta: PublicMeta = {
  patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
  coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-02T00:00:00.000Z",
  minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish", counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
};

function queries(overrides: Partial<PublicQueries> = {}): PublicQueries {
  return {
    meta: async () => meta,
    champions: async () => [champion],
    championDirectory: async () => [champion],
    championBySlug: async () => champion,
    champion: async () => champion,
    stats: async () => ({ code: "role_not_found" }),
    methodology: async () => ({ version: "1", scope: meta.scope, formulas: { rawWinRate: "", buildRate: "", baselineDelta: "", adjustedScore: "" }, minimumSample: 100, lowConfidence: "", limitations: [""], collectorRules: { durationMinimumSeconds: 300, remakeRule: "Reject remakes when any participant is flagged early surrender.", teamPositionMapping: { TOP: "TOP", JUNGLE: "JUNGLE", MIDDLE: "MIDDLE", BOTTOM: "BOTTOM", UTILITY: "UTILITY" } } }),
    status: async () => ({ code: "dataset_warming" }),
    ...overrides
  };
}

const stats = publicStatsResponseSchema.parse({
  meta, champion, role: "BOTTOM", baseline: { wins: 60, losses: 40, sample: 100, winRate: 0.6 }, view: "items", sort: "adjusted", includeLowConfidence: false, minimumSample: 100, rows: []
});

describe("champion page resolver", () => {
  it("permanently redirects aliases and preserves only a safe single role", async () => {
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: "BOTTOM" }, queries: queries() })).resolves.toEqual({ kind: "redirect", location: "/champions/jinx?role=BOTTOM" });
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: ["BOTTOM", "UTILITY"] }, queries: queries() })).resolves.toEqual({ kind: "redirect", location: "/champions/jinx" });
  });

  it.each([
    [{}, null, null],
    [{ role: "BOTTOM" }, "BOTTOM", null],
    [{ role: "TOP" }, null, "TOP"],
    [{ role: ["BOTTOM"] }, null, "That role selection"],
    [{ role: "__proto__" }, null, "That role selection"],
    [{ role: "constructor" }, null, "That role selection"],
    [{ role: "toString" }, null, "That role selection"]
  ])("does not default or trust invalid role values (%j)", async (searchParams, selectedRole, unavailableRole) => {
    const result = await resolveChampionPage({ slug: "jinx", searchParams, queries: queries() });
    if ("role" in searchParams && selectedRole === null && unavailableRole !== "TOP") {
      expect(result).toMatchObject({ kind: "redirect", location: "/champions/jinx" });
      return;
    }
    expect(result).toMatchObject({ kind: "ready", selectedRole, unavailableRole });
  });

  it("keeps warming, unknown, and query failures opaque", async () => {
    await expect(resolveChampionPage({ slug: "jinx", searchParams: {}, queries: queries({ championBySlug: async () => ({ code: "dataset_warming" }) }) })).resolves.toEqual({ kind: "warming" });
    await expect(resolveChampionPage({ slug: "missing", searchParams: {}, queries: queries({ championBySlug: async () => ({ code: "champion_not_found" }) }) })).resolves.toEqual({ kind: "notFound" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: {}, queries: queries({ championBySlug: async () => { throw new Error("secret db details"); } }) })).resolves.toEqual({ kind: "error" });
  });

  it("calls stats only for an explicit valid role and normalizes safe defaults", async () => {
    const calls: unknown[] = [];
    const result = await resolveChampionPage({ slug: "jinx", searchParams: { role: "BOTTOM" }, queries: queries({ stats: async (input) => { calls.push(input); return stats; } }) });
    expect(calls).toEqual([{ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false }]);
    expect(result).toMatchObject({ kind: "ready", stats });
    await resolveChampionPage({ slug: "jinx", searchParams: {}, queries: queries({ stats: async () => { throw new Error("must not call"); } }) });
  });

  it("uses the exact low-confidence token and preserves canonical controls on alias redirects", async () => {
    expect(parseStatsParams({ role: "BOTTOM", view: "trios", sort: "sample", lowConfidence: "1" })).toEqual({ role: "BOTTOM", view: "trios", sort: "sample", lowConfidence: true });
    expect(parseStatsParams({ role: ["BOTTOM"], lowConfidence: ["1", "0"] })).toEqual({ role: null, view: "items", sort: "adjusted", lowConfidence: false });
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: "BOTTOM", view: "pairs", sort: "sample", lowConfidence: "1" }, queries: queries() })).resolves.toMatchObject({ kind: "redirect", location: "/champions/jinx?role=BOTTOM&view=pairs&sort=sample&lowConfidence=1" });
  });

  it("canonicalizes controls even when the slug is already canonical", async () => {
    await expect(resolveChampionPage({ slug: "jinx", searchParams: { role: "BOTTOM", view: "items", sort: "adjusted", lowConfidence: "0", extra: "drop" }, queries: queries() })).resolves.toMatchObject({ kind: "redirect", location: "/champions/jinx?role=BOTTOM" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: { role: "BOTTOM", view: ["pairs", "items"] }, queries: queries() })).resolves.toMatchObject({ kind: "redirect", location: "/champions/jinx?role=BOTTOM" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: { role: "TOP" }, queries: queries() })).resolves.toMatchObject({ kind: "ready", unavailableRole: "TOP" });
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: "ADC" }, queries: queries() })).resolves.toMatchObject({ kind: "redirect", location: "/champions/jinx?role=ADC" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: { role: "ADC" }, queries: queries() })).resolves.toMatchObject({ kind: "ready", selectedRole: null, unavailableRole: "That role selection" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: { role: "__proto__" }, queries: queries() })).resolves.toMatchObject({ kind: "redirect", location: "/champions/jinx" });
  });
});
