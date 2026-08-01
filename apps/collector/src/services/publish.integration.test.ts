import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, createMigratedTestDatabase, aggregatePublications, collectionRuns, items, patches } from "@lol/database";
import { publishAtomically } from "./publish";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("canonical publication activation PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  let productionDatabase: ReturnType<typeof createDatabase>;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [patch] = await database.db.insert(patches).values({ version: `99.2.${Date.now()}`, patchKey: "99.2", isActive: true }).returning({ id: patches.id });
    await database.db.insert(items).values([
      { patchId: patch!.id, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "fixture", name: "Core", price: 1000, iconUrl: "core" },
      { patchId: patch!.id, itemId: 3006, normalizedBaseId: 3006, category: "BOOTS", classificationReason: "fixture", name: "Boots", price: 1000, iconUrl: "boots" }
    ]);
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
    productionDatabase = createDatabase(database.url);
  });
  afterEach(async () => { if (productionDatabase) await productionDatabase.close(); if (database) await database.close(); });

  it("activates an empty canonical publication and marks its run atomically", async () => {
    await publishAtomically({ publicationId, runId, database: productionDatabase });
    const [publication] = await database.db.select().from(aggregatePublications);
    const [run] = await database.db.select().from(collectionRuns);
    expect(publication?.isActive).toBe(true);
    expect(run?.publicationId).toBe(publicationId);
    expect(run?.status).toBe("COMPLETED");
  });
});
