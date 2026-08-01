import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMigratedTestDatabase, AggregatesRepository, aggregatePublications, collectionRuns, patches } from "@lol/database";
import { publishAtomically } from "./publish";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("canonical publication activation PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let publicationId: string;
  let runId: string;
  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
    const [patch] = await database.db.insert(patches).values({ version: `99.2.${Date.now()}`, patchKey: "99.2", isActive: true }).returning({ id: patches.id });
    const [run] = await database.db.insert(collectionRuns).values({ status: "RUNNING", stage: "publish" }).returning({ id: collectionRuns.id });
    runId = run!.id;
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId: patch!.id, runId, coverageStartedAt: new Date() }).returning({ id: aggregatePublications.id });
    publicationId = publication!.id;
  });
  afterEach(async () => { if (database) await database.close(); });

  it("activates an empty canonical publication and marks its run atomically", async () => {
    await publishAtomically({ publicationId, runId, database: database.db, repository: new AggregatesRepository(database.db) });
    const [publication] = await database.db.select().from(aggregatePublications);
    const [run] = await database.db.select().from(collectionRuns);
    expect(publication?.isActive).toBe(true);
    expect(run?.publicationId).toBe(publicationId);
    expect(run?.status).toBe("COMPLETED");
  });
});
