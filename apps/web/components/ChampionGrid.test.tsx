import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { PublicChampionSummary } from "@lol/public-api";
import { ChampionGrid } from "./ChampionGrid";

const champion = (name: string, slug = name.toLowerCase(), roles: PublicChampionSummary["roles"] = ["BOTTOM"]): PublicChampionSummary => ({
  championId: name === "Jinx" ? 222 : name === "Ahri" ? 103 : 1,
  slug,
  name,
  iconUrl: `https://ddragon.leagueoflegends.com/cdn/16.15.1/img/champion/${slug}.png`,
  roles
});

describe("ChampionGrid", () => {
  it("filters champions by localized name without changing the fixed scope", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[champion("Jinx"), champion("Ahri")]} state="fresh" />);
    await user.type(screen.getByRole("searchbox", { name: "Search champions" }), "jin");
    expect(screen.getByRole("link", { name: /Jinx/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Ahri/ })).toBeNull();
    expect(screen.getByText(/TR1/)).toBeVisible();
  });

  it("matches case and diacritics and announces an empty result", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[champion("Şampiyon"), champion("Ahri")]} state="fresh" />);
    const input = screen.getByRole("searchbox", { name: "Search champions" });
    await user.type(input, "sampiyon");
    expect(screen.getByRole("link", { name: /Şampiyon/ })).toBeVisible();
    await user.clear(input);
    await user.type(input, "no champion");
    expect(screen.getByText("No champions match your search.")).toBeVisible();
  });

  it("keeps semantic links keyboard reachable", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[champion("Jinx")]} state="fresh" />);
    const input = screen.getByRole("searchbox", { name: "Search champions" });
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: /Jinx/ })).toHaveFocus();
    expect(screen.getByRole("link", { name: /Jinx/ })).toHaveAttribute("href", "/champions/jinx");
  });

  it("uses the server-provided freshness state instead of the browser clock", () => {
    render(<ChampionGrid champions={[champion("Jinx")]} meta={{
      patch: { version: "16.16.1", key: "16.16" },
      scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
      coverageStartedAt: "2026-08-01T00:00:00.000Z",
      publishedAt: "2026-08-01T00:00:00.000Z",
      collectedAt: "2026-08-01T00:00:00.000Z",
      minimumSample: 100,
      datasetState: "ready",
      runStatus: "COMPLETED",
      stage: "publish",
      counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
    }} state="fresh" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows warming copy instead of search-empty copy while no dataset exists", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[]} warming state="warming" />);
    await user.type(screen.getByRole("searchbox", { name: "Search champions" }), "jinx");
    expect(screen.getByText(/current-patch data is warming up/i)).toBeVisible();
    expect(screen.queryByText("No champions match your search.")).toBeNull();
  });
});
