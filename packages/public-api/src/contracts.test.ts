import { describe, expect, it } from "vitest";
import { publicStatRowSchema, publicStatsResponseSchema } from "./contracts";

const row = {
  key: "3031", itemIds: [3031], itemMetadata: [{ id: 3031, name: "Infinity Edge", iconUrl: "https://example.test/3031.png" }], wins: 60, losses: 40, sample: 100,
  rawWinRate: 0.6, buildRate: 1, baselineDelta: 0,
  confidenceLower: 0.5, confidenceUpper: 0.69, adjustedScore: 0.5, confidence: "recommended" as const
};

describe("public contracts", () => {
  it("rejects private or unknown stat fields", () => {
    expect(publicStatRowSchema.safeParse({ ...row, puuid: "secret" }).success).toBe(false);
    expect(publicStatRowSchema.safeParse({ ...row, rawWinRate: Number.NaN }).success).toBe(false);
  });

  it("requires low-confidence rows to have no recommendation score", () => {
    expect(publicStatRowSchema.safeParse({ ...row, confidence: "low", adjustedScore: null }).success).toBe(true);
    expect(publicStatRowSchema.safeParse({ ...row, confidence: "low", adjustedScore: 0.5 }).success).toBe(false);
  });

  it("rejects private fields on complete responses", () => {
    const minimal = {
      meta: {
        patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
        coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-02T00:00:00.000Z",
        minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish",
        counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
      },
      champion: { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] },
      role: "BOTTOM", baseline: { wins: 60, losses: 40, sample: 100, winRate: 0.6 }, view: "items", sort: "adjusted", includeLowConfidence: false, minimumSample: 100, rows: [row]
    };
    expect(publicStatsResponseSchema.safeParse({ ...minimal, publicationId: "private" }).success).toBe(false);
  });

  it.each([
    ["items", [3031]], ["boots", [3157]], ["pairs", [3031, 6672]], ["trios", [3031, 3157, 6672]]
  ] as const)("requires the exact item-id cardinality for %s view", (view, ids) => {
    const rowForView = { ...row, key: ids.join(":"), itemIds: ids, itemMetadata: ids.map((id) => ({ id, name: `Item ${id}`, iconUrl: `https://example.test/${id}.png` })), buildRate: 0.1 };
    const baseline = { wins: 600, losses: 400, sample: 1000, winRate: 0.6 };
    const response = { meta: { minimumSample: 100, patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" }, coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-02T00:00:00.000Z", datasetState: "ready", runStatus: "COMPLETED", stage: "publish", counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 } }, champion: { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] }, role: "BOTTOM", baseline, view, sort: "adjusted", includeLowConfidence: false, minimumSample: 100, rows: [rowForView] };
    expect(publicStatsResponseSchema.safeParse(response).success).toBe(true);
  });

  it("rejects inconsistent derived metrics and canonical keys", () => {
    expect(publicStatRowSchema.safeParse({ ...row, sample: 0, wins: 0, losses: 0 }).success).toBe(false);
    expect(publicStatRowSchema.safeParse({ ...row, key: "6672:3031", itemIds: [6672, 3031], itemMetadata: [{ id: 6672, name: "A", iconUrl: "https://example.test/a.png" }, { id: 3031, name: "B", iconUrl: "https://example.test/b.png" }] }).success).toBe(false);
    expect(publicStatRowSchema.safeParse({ ...row, rawWinRate: 0.61 }).success).toBe(false);
    expect(publicStatRowSchema.safeParse({ ...row, adjustedScore: null }).success).toBe(false);
  });
});
