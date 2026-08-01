import { describe, expect, it, vi } from "vitest";
import { publishAtomically, verifyPublicationSnapshot, type PublishSnapshot } from "./publish";

const base = (overrides: Partial<PublishSnapshot> = {}): PublishSnapshot => ({
  publicationId: "pub", runId: "run", patchId: 1,
  publication: { id: "pub", patchId: 1, runId: "run", isActive: false },
  patch: { id: 1, isActive: true },
  run: { id: "run", status: "RUNNING", stage: "publish" },
  itemCatalog: new Map([[3031, { itemId: 3031, category: "CORE", normalizedBaseId: 3031 }]]),
  baseline: [{ publicationId: "pub", championId: 1, role: "TOP", wins: 1, losses: 1, sample: 2 }],
  items: [], combinations: [], boots: [], observations: [],
  ...overrides
});

describe("publication verification", () => {
  it("reports deterministic count equation and missing baseline failures", async () => {
    const result = await verifyPublicationSnapshot(base({ baseline: [], items: [{ championId: 1, role: "TOP", itemId: 3031, wins: 2, losses: 0, sample: 1 }] }));
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual([{ code: "COUNT_EQUATION", count: 1 }, { code: "MISSING_BASELINE", count: 1 }, { code: "RECOMPUTATION_MISMATCH", count: 1 }]);
  });

  it("activates only after verification in a serializable transaction", async () => {
    const repository = { lockAndLoad: vi.fn(), activateVerified: vi.fn() };
    await expect(publishAtomically({ publicationId: "pub", runId: "run", database: {}, repository: repository as any })).rejects.toThrow("database transaction is required");
    expect(repository.activateVerified).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied snapshot state at the production boundary", async () => {
    await expect(publishAtomically({ publicationId: "pub", runId: "run", database: {} as any, repository: {} as any, observations: [] } as never)).rejects.toThrow("canonical publication state");
  });
});
