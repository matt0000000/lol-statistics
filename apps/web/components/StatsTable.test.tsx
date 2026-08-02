import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { publicStatsResponseSchema } from "@lol/public-api";
import { wilson95 } from "../../../packages/domain/src/statistics";
import { StatsTable } from "./StatsTable";

function statRow({ id, name, wins, sample, baselineWinRate = 0.6, baselineSample = 1000, confidence }: { id: number; name: string; wins: number; sample: number; baselineWinRate?: number; baselineSample?: number; confidence: "recommended" | "low" }) {
  const interval = wilson95(wins, sample);
  const rawWinRate = wins / sample;
  return {
    key: String(id), itemIds: [id], itemMetadata: [{ id, name, iconUrl: `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/${id}.png` }],
    wins, losses: sample - wins, sample, rawWinRate, buildRate: sample / baselineSample, baselineDelta: rawWinRate - baselineWinRate,
    confidenceLower: interval.lower, confidenceUpper: interval.upper, adjustedScore: confidence === "recommended" ? interval.lower : null, confidence
  };
}

const response = publicStatsResponseSchema.parse({
  meta: { patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" }, coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-02T00:00:00.000Z", minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish", counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 } },
  champion: { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] },
  role: "BOTTOM", baseline: { wins: 600, losses: 400, sample: 1000, winRate: 0.6 }, view: "items", sort: "adjusted", includeLowConfidence: true, minimumSample: 100,
  rows: [
    statRow({ id: 3031, name: "Infinity Edge", wins: 55, sample: 100, confidence: "recommended" }),
    statRow({ id: 6672, name: "Kraken Slayer", wins: 40, sample: 80, confidence: "low" })
  ]
});

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
    const noRecommended = publicStatsResponseSchema.parse({ ...response, includeLowConfidence: false, rows: [] });
    render(<StatsTable response={noRecommended} />);
    expect(screen.getByText(/No recommended results/i)).toBeVisible();
  });
});
