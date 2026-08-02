import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RoleSelector } from "./RoleSelector";

describe("RoleSelector", () => {
  it("renders no selected role until the user chooses one", () => {
    render(<RoleSelector championSlug="jinx" roles={["BOTTOM", "UTILITY"]} selectedRole={null} />);
    expect(screen.getByRole("link", { name: "Bottom" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Support" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Choose a role to view statistics")).toBeVisible();
  });

  it("marks only the selected role and uses exact encoded role links", () => {
    render(<RoleSelector championSlug="Jinx Prime" roles={["TOP", "UTILITY"]} selectedRole="UTILITY" />);
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Top" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute("href", "/champions/Jinx%20Prime?role=UTILITY");
  });

  it("shows an unavailable message while retaining valid role choices", () => {
    render(<RoleSelector championSlug="jinx" roles={["BOTTOM", "UTILITY"]} selectedRole={null} unavailableRole="TOP" />);
    expect(screen.getByText(/Top is not available/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Bottom" })).toBeVisible();
  });

  it.each(["__proto__", "constructor", "toString"])("renders unsafe unavailable role %s as a plain message", (unavailableRole) => {
    render(<RoleSelector championSlug="jinx" roles={["BOTTOM", "UTILITY"]} selectedRole={null} unavailableRole={unavailableRole} />);
    expect(screen.getByText(/That role selection is not available for this champion/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Bottom" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Support" })).toBeVisible();
    expect(screen.queryByText(/function|object/i)).not.toBeInTheDocument();
  });
});
