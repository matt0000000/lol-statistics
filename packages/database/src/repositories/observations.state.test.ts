import { describe, expect, it } from "vitest";
import { rejectedRefreshAllowed } from "./observations";

describe("rejected refresh state machine", () => {
  const prior = new Date("2026-08-01T00:00:00.000Z");
  const later = new Date("2026-08-02T00:00:00.000Z");

  it("allows only a later all-rejected run without accepted canonical rows", () => {
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, currentRunStartedAt: later, latestRejectionCreatedAt: prior })).toBe(true);
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: true, incomingAcceptedCount: 0, currentRunStartedAt: later, latestRejectionCreatedAt: prior })).toBe(false);
    expect(rejectedRefreshAllowed({ existingValidationState: "VALID", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, currentRunStartedAt: later, latestRejectionCreatedAt: prior })).toBe(false);
  });

  it("does not treat a same-run changed audit as a refresh", () => {
    expect(rejectedRefreshAllowed({ existingValidationState: "REJECTED", hasAcceptedCanonicalRows: false, incomingAcceptedCount: 0, currentRunStartedAt: prior, latestRejectionCreatedAt: later })).toBe(false);
  });
});
