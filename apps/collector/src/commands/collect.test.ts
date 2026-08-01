import { describe, expect, it } from "vitest";
import { RiotHttpError } from "@lol/riot-client";
import { isUnavailableMatchError } from "./collect";

describe("unavailable match classification", () => {
  it("only checkpoints a genuine Riot 404 not_found error", () => {
    expect(isUnavailableMatchError(new RiotHttpError("missing", 404, false, "not_found"))).toBe(true);
  });

  it.each([
    new RiotHttpError("server", 500, true, "not_found"),
    new RiotHttpError("other category", 404, false, "server"),
    new Error("not a Riot error")
  ])("does not checkpoint mismatched failures", (error) => {
    expect(isUnavailableMatchError(error)).toBe(false);
  });
});
