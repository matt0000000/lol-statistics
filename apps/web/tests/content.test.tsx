import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RootLayout from "../app/layout";
import MethodologyPage from "../app/methodology/page";
import StatusPage from "../app/status/page";

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

  it("keeps status and methodology content free of private identifiers and diagnostics", async () => {
    const methodology = render(await MethodologyPage());
    const methodologyText = methodology.container.textContent ?? "";
    expect(methodologyText).not.toMatch(/puuid|match[- ]history|private error|error details|riot api key|match id/i);
    methodology.unmount();
    const status = render(await StatusPage());
    const statusText = status.container.textContent ?? "";
    expect(statusText).not.toMatch(/puuid|match[- ]history|private error|error details|riot api key|match id/i);
  });
});
