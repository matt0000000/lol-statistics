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
    render(<ChampionGrid champions={[champion("Jinx"), champion("Ahri")]} />);
    await user.type(screen.getByRole("searchbox", { name: "Search champions" }), "jin");
    expect(screen.getByRole("link", { name: /Jinx/ })).toBeVisible();
    expect(screen.queryByRole("link", { name: /Ahri/ })).toBeNull();
    expect(screen.getByText(/TR1/)).toBeVisible();
  });

  it("matches case and diacritics and announces an empty result", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[champion("Şampiyon"), champion("Ahri")]} />);
    const input = screen.getByRole("searchbox", { name: "Search champions" });
    await user.type(input, "sampiyon");
    expect(screen.getByRole("link", { name: /Şampiyon/ })).toBeVisible();
    await user.clear(input);
    await user.type(input, "no champion");
    expect(screen.getByText("No champions match your search.")).toBeVisible();
  });

  it("keeps semantic links keyboard reachable", async () => {
    const user = userEvent.setup();
    render(<ChampionGrid champions={[champion("Jinx")]} />);
    const input = screen.getByRole("searchbox", { name: "Search champions" });
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: /Jinx/ })).toHaveFocus();
    expect(screen.getByRole("link", { name: /Jinx/ })).toHaveAttribute("href", "/champions/jinx");
  });
});
