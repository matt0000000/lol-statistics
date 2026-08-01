import { describe, expect, it } from "vitest";
import { evaluateParticipant } from "./eligibility";

describe("evaluateParticipant", () => {
  it.each([
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, true],
    [{ platformId: "EUW1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
    [{ platformId: "TR1", queueId: 440, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.14.1", duration: 1800, eligible: true, role: "BOTTOM", remake: false }, false],
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 299, eligible: true, role: "BOTTOM", remake: false }, false],
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: false, role: "BOTTOM", remake: false }, false],
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "", remake: false }, false],
    [{ platformId: "TR1", queueId: 420, gameVersion: "16.15.1", duration: 1800, eligible: true, role: "BOTTOM", remake: true }, false]
  ])("applies scope rules", (input, accepted) => {
    expect(evaluateParticipant({ ...input, activePatch: "16.15" }).accepted).toBe(accepted);
  });

  it("redacts malformed versions", () => {
    expect(evaluateParticipant({ platformId: "TR1", queueId: 420, gameVersion: "secret-version", activePatch: "16.15", duration: 1800, eligible: true, role: "BOTTOM", remake: false })).toEqual({ accepted: false, reason: "patch" });
  });
});
