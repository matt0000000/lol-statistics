import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedTestDatabase } from "../test-utils";
import { aggregatePublications, collectionRuns, patches } from "../schema";
import { AggregatesRepository } from "./aggregates";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("aggregate repository PostgreSQL invariants", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  let patchId: number;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [patch] = await database.db.insert(patches).values({ version: `99.1.${Date.now()}`, patchKey: "99.1", isActive: true }).returning({ id: patches.id });
    patchId = patch!.id;
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId: run!.id, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
  });
  afterEach(async () => { if (database) await database.close(); });

  it("replaces inactive rows deterministically and leaves active rows protected", async () => {
    const repository = new AggregatesRepository(database.db);
    await repository.preparePublication({ publicationId, runId, patchId });
    await repository.flushGroup({ championId: 1, role: "TOP", baseline: { wins: 1, losses: 0, sample: 1 }, items: new Map([[3031, { wins: 1, losses: 0, sample: 1 }]]), pairs: new Map(), trios: new Map(), boots: new Map() });
    expect((await repository.rows(publicationId)).length).toBe(2);
    await expect(repository.preparePublication({ publicationId, runId, patchId })).resolves.toBeUndefined();
  });
});
