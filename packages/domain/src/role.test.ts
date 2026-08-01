import { describe, expect, it } from "vitest";
import { parseTeamPosition, roleLabel } from "./role";

describe("roles", () => {
  it("accepts Riot positions and labels utility as support", () => {
    expect(parseTeamPosition("UTILITY")).toBe("UTILITY");
    expect(roleLabel("UTILITY")).toBe("Support");
    expect(parseTeamPosition("INVALID")).toBeNull();
  });
});
