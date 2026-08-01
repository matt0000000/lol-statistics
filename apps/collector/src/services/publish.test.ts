import { describe, expect, it, vi } from "vitest";
import { publishAtomically, verifyPublication, type PublishInput } from "./publish";

const base = (overrides: Partial<PublishInput> = {}): PublishInput => ({
  publicationId: "pub", runId: "run", patchId: 1,
  publication: { id: "pub", patchId: 1, runId: "run", isActive: false },
  baseline: [{ publicationId: "pub", championId: 1, role: "TOP", wins: 1, losses: 1, sample: 2 }],
  items: [], combinations: [], boots: [], observations: [],
  ...overrides
});

describe("publication verification", () => {
  it("reports deterministic count equation and missing baseline failures", async () => {
    const result = await verifyPublication(base({ baseline: [], items: [{ championId: 1, role: "TOP", itemId: 3031, wins: 2, losses: 0, sample: 1 }] }));
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual([{ code: "COUNT_EQUATION", count: 1 }, { code: "MISSING_BASELINE", count: 1 }]);
  });

  it("activates only after verification in a serializable transaction", async () => {
    const calls: string[] = [];
    const database = { transaction: async (fn: any, options: any) => { expect(options).toMatchObject({ isolationLevel: "serializable" }); return fn({}); } };
    const repository = { deactivateCurrent: vi.fn(async () => calls.push("deactivate")), activate: vi.fn(async () => calls.push("activate")), markRunPublished: vi.fn(async () => calls.push("mark")) };
    await publishAtomically({ ...base(), database, repository });
    expect(calls).toEqual(["deactivate", "activate", "mark"]);
  });
});
