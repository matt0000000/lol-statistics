import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RootLayout from "../app/layout";
import MethodologyPage from "../app/methodology/page";
import { StatusPageContent } from "../app/status/page";
import type { PublicStatus } from "@lol/public-api";

const populatedStatus: PublicStatus = {
  patch: { version: "16.16.1", key: "16.16" },
  scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
  coverageStartedAt: "2026-07-01T00:00:00.000Z",
  publishedAt: "2026-08-01T10:00:00.000Z",
  publicationAgeSeconds: 7200,
  datasetState: "fresh",
  runStatus: "COMPLETED",
  stage: "PUBLISH",
  counters: { matchesDiscovered: 1200, matchesIngested: 1100, observationsAccepted: 900, observationsRejected: 200 },
  eligibleSamplesByRole: { TOP: 180, JUNGLE: 170, MIDDLE: 190, BOTTOM: 200, UTILITY: 160 },
  unknownItemCount: 3
};

describe("public content", () => {
  it("renders the exact Riot legal notice and navigation", () => {
    const view = render(<RootLayout><main>content</main></RootLayout>);
    expect(view.container.textContent).toContain("This product is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Methodology" })).toHaveAttribute("href", "/methodology");
    expect(screen.getByRole("link", { name: "Status" })).toHaveAttribute("href", "/status");
  });

  it("discloses the full methodology without implying unsupported modes", async () => {
    render(await MethodologyPage());
    const text = document.body.textContent ?? "";
    for (const topic of ["TR1", "Ranked Solo", "queue 420", "Emerald+", "35-day", "TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY", "remake", "early surrender", "300 seconds", "canonical", "completed item", "unordered", "multiset", "Wilson", "100", "survivorship", "gold-lead", "correlation", "build rates", "hourly"]) expect(text).toMatch(new RegExp(topic, "i"));
    expect(text).not.toMatch(/Arena is supported|Arena data is included/i);
  });

  it("renders populated public status and keeps content free of private identifiers", async () => {
    const methodology = render(await MethodologyPage());
    const methodologyText = methodology.container.textContent ?? "";
    const forbidden = /\bmatch[_-]?id\b|\bpuuid\b|match[- ]?history|private[-_ ]?(error|details?)|error[-_ ]?details?|riot(?:[_-]?api)?[_-]?key|raw[_-]?final[_-]?slots/i;
    expect(methodologyText).not.toMatch(forbidden);
    methodology.unmount();
    const status = render(<StatusPageContent status={populatedStatus} />);
    const statusText = status.container.textContent ?? "";
    expect(statusText).toContain("Patch 16.16.1");
    expect(statusText).toContain("Last successful publication");
    expect(statusText).toContain("Unknown-item observations");
    expect(statusText).not.toMatch(forbidden);
  });
});
