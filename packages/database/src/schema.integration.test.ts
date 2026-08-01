import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { patches } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("canonical schema", () => {
  const database = createDatabase(url!);

  afterAll(() => database.close());

  it("stores a patch once by exact Data Dragon version", async () => {
    await database.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15" }).onConflictDoNothing();
    await database.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15" }).onConflictDoNothing();
    const rows = await database.db.select().from(patches).where(eq(patches.version, "16.15.1"));
    expect(rows).toHaveLength(1);
  });
});
