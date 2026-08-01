import { describe, expect, it } from "vitest";
import { PUBLISH_LOCK_ORDER, lockAndLoadCanonical, publishAtomically, verifyPublicationSnapshot, type PublishSnapshot } from "./publish";

const base = (overrides: Partial<PublishSnapshot> = {}): PublishSnapshot => ({
  publicationId: "00000000-0000-4000-8000-000000000001", runId: "00000000-0000-4000-8000-000000000002", patchId: 1,
  publication: { id: "00000000-0000-4000-8000-000000000001", patchId: 1, runId: "00000000-0000-4000-8000-000000000002", isActive: false },
  patch: { id: 1, isActive: true },
  run: { id: "00000000-0000-4000-8000-000000000002", status: "RUNNING", stage: "publish" },
  itemCatalog: new Map([[3031, { itemId: 3031, category: "CORE", normalizedBaseId: 3031 }]]),
  baseline: [{ publicationId: "00000000-0000-4000-8000-000000000001", championId: 1, role: "TOP", wins: 1, losses: 1, sample: 2 }],
  items: [], combinations: [], boots: [], observations: [],
  ...overrides
});

const lowSampleSnapshot = (): PublishSnapshot => base({
  publication: { ...base().publication!, minimumSample: 100 },
  itemCatalog: new Map([
    [3031, { itemId: 3031, category: "CORE", normalizedBaseId: 3031 }],
    [6672, { itemId: 6672, category: "CORE", normalizedBaseId: 6672 }],
    [3085, { itemId: 3085, category: "CORE", normalizedBaseId: 3085 }],
    [3006, { itemId: 3006, category: "BOOTS", normalizedBaseId: 3006 }]
  ]),
  baseline: [{ championId: 1, role: "TOP", wins: 1, losses: 0, sample: 1 }],
  items: [3031, 6672, 3085].map((itemId) => ({ championId: 1, role: "TOP", itemId, wins: 1, losses: 0, sample: 1 })),
  combinations: [
    { championId: 1, role: "TOP", size: 2, combinationKey: "3031:6672", wins: 1, losses: 0, sample: 1 },
    { championId: 1, role: "TOP", size: 2, combinationKey: "3031:3085", wins: 1, losses: 0, sample: 1 },
    { championId: 1, role: "TOP", size: 2, combinationKey: "3085:6672", wins: 1, losses: 0, sample: 1 },
    { championId: 1, role: "TOP", size: 3, combinationKey: "3031:3085:6672", wins: 1, losses: 0, sample: 1 }
  ],
  boots: [{ championId: 1, role: "TOP", itemId: 3006, wins: 1, losses: 0, sample: 1 }],
  observations: [{ championId: 1, role: "TOP", matchId: "m1", participantId: 1, win: true, items: [3031, 6672, 3085], boots: 3006, patchId: 1, queueId: 420, platformId: "TR1", validationState: "VALID" }]
});

describe("publication verification", () => {
  it("locks the collection run before target, active publications, and patch", () => {
    expect(PUBLISH_LOCK_ORDER).toEqual(["run", "target_publication", "active_publications", "patch"]);
  });

  it("locks canonical rows in run, target, active-publications, patch order", async () => {
    const calls: string[] = [];
    const runId = base().runId;
    const publicationId = base().publicationId;
    const rows: Record<string, unknown[]> = {
      collection_runs: [{ id: runId, status: "RUNNING", stage: "publish", publicationId: null }],
      aggregate_publications: [{ id: publicationId, runId, patchId: 1, isActive: false }],
      patches: [{ id: 1, isActive: true }]
    };
    const tx = {
      select: () => ({
        from: (table: any) => {
          const name = table[Symbol.for("drizzle:Name")];
          calls.push(name);
          const chain: any = {
            where: () => chain,
            innerJoin: () => chain,
            for: () => chain,
            limit: () => chain,
            orderBy: () => chain,
            then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows[name] ?? []).then(resolve, reject)
          };
          return chain;
        }
      })
    };
    await lockAndLoadCanonical(tx, publicationId, runId);
    expect(calls.slice(0, 4)).toEqual(["collection_runs", "aggregate_publications", "aggregate_publications", "patches"]);
  });

  it("reports deterministic count equation and missing baseline failures", async () => {
    const result = await verifyPublicationSnapshot(base({ baseline: [], items: [{ championId: 1, role: "TOP", itemId: 3031, wins: 2, losses: 0, sample: 1 }] }));
    expect(result.valid).toBe(false);
    expect(result.failures).toEqual([{ code: "COUNT_EQUATION", count: 1 }, { code: "MISSING_BASELINE", count: 1 }, { code: "RECOMPUTATION_MISMATCH", count: 1 }]);
  });

  it("activates only after verification in a serializable transaction", async () => {
    await expect(publishAtomically({ publicationId: "pub", runId: "run", database: {} as any })).rejects.toThrow("created by createDatabase");
  });

  it("rejects caller-supplied snapshot state at the production boundary", async () => {
    await expect(publishAtomically({ publicationId: "pub", runId: "run", database: {} as any, repository: {} as any, observations: [] } as never)).rejects.toThrow("canonical publication state");
  });

  it("rejects an empty canonical catalog", async () => {
    const result = await verifyPublicationSnapshot(base({ itemCatalog: new Map() }));
    expect(result.failures).toContainEqual({ code: "CATALOG_MISSING", count: 1 });
  });

  it("keeps low-sample baseline, item, combination, and boots rows publishable", async () => {
    const result = await verifyPublicationSnapshot(lowSampleSnapshot());
    expect(result).toEqual({ valid: true, failures: [] });
  });
});
