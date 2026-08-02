import { describe, expect, it } from "vitest";
import { publicStatRowSchema, publicStatsResponseSchema } from "./contracts";

const row = {
  key: "3031", itemIds: [3031], itemMetadata: [{ id: 3031, name: "Infinity Edge", iconUrl: "https://example.test/3031.png" }], wins: 60, losses: 40, sample: 100,
  rawWinRate: 0.6, buildRate: 0.2, baselineDelta: 0.1,
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
});
