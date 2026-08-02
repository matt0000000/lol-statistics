import { describe, expect, it } from "vitest";
import { rejectedRefreshAllowed } from "./observations";

describe("rejected refresh state machine", () => {
  const prior = new Date("2026-08-01T00:00:00.000Z");
  const later = new Date("2026-08-02T00:00:00.000Z");

  it("allows a changed all-rejected audit from a distinct run", () => {
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: ["run-a", "run-a"], currentRunId: "run-b" })).toBe(true);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: ["run-a", "run-c"], currentRunId: "run-b" })).toBe(true);
  });

  it("allows one legacy null-run upgrade but rejects mixed provenance", () => {
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: [null, null], currentRunId: "run-b" })).toBe(true);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: [null, "run-a"], currentRunId: "run-b" })).toBe(false);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: [null, "run-b"], currentRunId: "run-b" })).toBe(false);
  });

  it("fails closed for same-run changed audits and invalid states", () => {
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: ["run-b"], currentRunId: "run-b" })).toBe(false);
    expect(rejectedRefreshAllowed({ existingValidationState: "VALID", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, existingRunIds: ["run-a"], currentRunId: "run-b" })).toBe(false);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: true, incomingAcceptedCount: 0, existingRunIds: ["run-a"], currentRunId: "run-b" })).toBe(false);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 1, existingRunIds: ["run-a"], currentRunId: "run-b" })).toBe(false);
  });
});
