import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewTabs, statsHref } from "./ViewTabs";

describe("statistics URL controls", () => {
  it("preserves canonical role and controls while omitting defaults", () => {
    expect(statsHref("/champions/a%20b", "BOTTOM", "items", "adjusted", false)).toBe("/champions/a%20b?role=BOTTOM");
    expect(statsHref("/champions/jinx", "BOTTOM", "pairs", "sample", true)).toBe("/champions/jinx?role=BOTTOM&view=pairs&sort=sample&lowConfidence=1");
  });

  it("renders all views with one active page", () => {
    render(<ViewTabs basePath="/champions/jinx" role="BOTTOM" view="pairs" sort="adjusted" includeLowConfidence={false} />);
    expect(screen.getByRole("link", { name: "Items" })).toHaveAttribute("href", "/champions/jinx?role=BOTTOM");
    expect(screen.getByRole("link", { name: "2-item builds" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "3-item builds" })).toHaveAttribute("href", "/champions/jinx?role=BOTTOM&view=trios");
    expect(screen.getByRole("link", { name: "Boots" })).toHaveAttribute("href", "/champions/jinx?role=BOTTOM&view=boots");
  });
});
