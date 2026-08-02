import { describe, expect, it } from "vitest";
import type { PublicChampion, PublicMeta, PublicQueries } from "@lol/public-api";
import { resolveChampionPage } from "./page";

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
    methodology: async () => ({ version: "1", scope: meta.scope, formulas: { rawWinRate: "", buildRate: "", baselineDelta: "", adjustedScore: "" }, minimumSample: 100, lowConfidence: "", limitations: [""] }),
    ...overrides
  };
}

describe("champion page resolver", () => {
  it("permanently redirects aliases and preserves only a safe single role", async () => {
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: "BOTTOM" }, queries: queries() })).resolves.toEqual({ kind: "redirect", location: "/champions/jinx?role=BOTTOM" });
    await expect(resolveChampionPage({ slug: "JINX", searchParams: { role: ["BOTTOM", "UTILITY"] }, queries: queries() })).resolves.toEqual({ kind: "redirect", location: "/champions/jinx" });
  });

  it.each([
    [{}, null, null],
    [{ role: "BOTTOM" }, "BOTTOM", null],
    [{ role: "TOP" }, null, "TOP"],
    [{ role: ["BOTTOM"] }, null, "That role selection"]
  ])("does not default or trust invalid role values (%j)", async (searchParams, selectedRole, unavailableRole) => {
    const result = await resolveChampionPage({ slug: "jinx", searchParams, queries: queries() });
    expect(result).toMatchObject({ kind: "ready", selectedRole, unavailableRole });
  });

  it("keeps warming, unknown, and query failures opaque", async () => {
    await expect(resolveChampionPage({ slug: "jinx", searchParams: {}, queries: queries({ championBySlug: async () => ({ code: "dataset_warming" }) }) })).resolves.toEqual({ kind: "warming" });
    await expect(resolveChampionPage({ slug: "missing", searchParams: {}, queries: queries({ championBySlug: async () => ({ code: "champion_not_found" }) }) })).resolves.toEqual({ kind: "notFound" });
    await expect(resolveChampionPage({ slug: "jinx", searchParams: {}, queries: queries({ championBySlug: async () => { throw new Error("secret db details"); } }) })).resolves.toEqual({ kind: "error" });
  });
});
