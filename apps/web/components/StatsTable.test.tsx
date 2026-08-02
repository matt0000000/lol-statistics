import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicStatsResponse } from "@lol/public-api";
import { StatsTable } from "./StatsTable";

const response = {
  meta: { patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" }, coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-02T00:00:00.000Z", minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish", counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 } },
  champion: { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] },
  role: "BOTTOM", baseline: { wins: 600, losses: 400, sample: 1000, winRate: 0.6 }, view: "items", sort: "adjusted", includeLowConfidence: true, minimumSample: 100,
  rows: [
    { key: "3031", itemIds: [3031], itemMetadata: [{ id: 3031, name: "Infinity Edge", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/3031.png" }], wins: 60, losses: 40, sample: 100, rawWinRate: 0.6, buildRate: 0.1, baselineDelta: 0, confidenceLower: 0.452, confidenceUpper: 0.644, adjustedScore: 0.5, confidence: "recommended" },
    { key: "6672", itemIds: [6672], itemMetadata: [{ id: 6672, name: "Kraken Slayer", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/6672.png" }], wins: 40, losses: 40, sample: 80, rawWinRate: 0.5, buildRate: 0.08, baselineDelta: -0.1, confidenceLower: 0.39, confidenceUpper: 0.61, adjustedScore: null, confidence: "low" }
  ]
} satisfies PublicStatsResponse;

describe("StatsTable", () => {
  it("shows evidence columns and labels a low-confidence row", () => {
    render(<StatsTable response={response} />);
    expect(screen.getByRole("columnheader", { name: "Win rate" })).toBeVisible();
    expect(screen.getByText("95% CI 45.2%–64.4%")).toBeVisible();
    expect(screen.getByText("Low confidence")).toBeVisible();
    expect(screen.getByText("100 games")).toBeVisible();
    expect(screen.getByLabelText("Infinity Edge")).toBeVisible();
  });

  it("distinguishes no recommended rows from no rows", () => {
    const noRecommended = { ...response, includeLowConfidence: false, rows: [] } satisfies PublicStatsResponse;
    render(<StatsTable response={noRecommended} />);
    expect(screen.getByText(/No recommended results/i)).toBeVisible();
  });
});
