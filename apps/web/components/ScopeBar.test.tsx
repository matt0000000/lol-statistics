import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicMeta } from "@lol/public-api";
import { ScopeBar } from "./ScopeBar";

const meta: PublicMeta = {
  patch: { version: "16.16.1", key: "16.16" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
  coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-02T00:00:00.000Z", collectedAt: "2026-08-03T00:00:00.000Z",
  minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish", counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
};

describe("ScopeBar", () => {
  it("shows published and collection dates for ready data", () => {
    render(<ScopeBar meta={meta} />);
    expect(screen.getByText("Published 2 Aug 2026")).toBeVisible();
    expect(screen.getByText("Data through 3 Aug 2026")).toBeVisible();
    expect(screen.getByText("Patch 16.16.1")).toBeVisible();
  });

  it("shows an explicit warming state without stale dates", () => {
    render(<ScopeBar warming />);
    expect(screen.getByText("Dataset warming")).toBeVisible();
    expect(screen.getByText("Current patch")).toBeVisible();
    expect(screen.queryByText(/Published|Data through/)).toBeNull();
  });
});
