import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createMigratedTestDatabase } from "./test-utils";
import { matches, patches, participantObservations } from "./schema";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("canonical schema", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

  beforeAll(async () => {
    database = await createMigratedTestDatabase(url!);
  });

  afterAll(() => database?.close());

  const cleanup = async () => {
    const rows = await database.db.select({ id: patches.id, version: patches.version }).from(patches);
    const testRows = rows.filter((row) => /^(90|97|98)\./.test(row.version));
    for (const row of testRows) {
      await database.db.execute(sql`DELETE FROM participant_observations WHERE patch_id = ${row.id}`);
      await database.db.execute(sql`DELETE FROM matches WHERE patch_id = ${row.id}`);
      await database.db.delete(patches).where(eq(patches.id, row.id));
    }
  };

  afterEach(async () => {
    if (database) await cleanup();
  });

  it("stores a patch once by exact Data Dragon version", async () => {
    await database.db.insert(patches).values({ version: "90.15.1", patchKey: "90.15" }).onConflictDoNothing();
    await database.db.insert(patches).values({ version: "90.15.1", patchKey: "90.15" }).onConflictDoNothing();
    const rows = await database.db.select().from(patches).where(eq(patches.version, "90.15.1"));
    expect(rows).toHaveLength(1);
  });

  it("enforces one active patch", async () => {
    const stamp = Date.now();
    const firstVersion = `98.1.${stamp}`;
    const secondVersion = `98.2.${stamp}`;
    await database.db.insert(patches).values([
      { version: firstVersion, patchKey: "98.1", isActive: true },
      { version: secondVersion, patchKey: "98.2", isActive: false }
    ]);
    await expect(database.db.insert(patches).values({ version: `98.3.${stamp}`, patchKey: "98.3", isActive: true })).rejects.toThrow();
    await database.db.delete(patches).where(sql`${patches.version} IN (${firstVersion}, ${secondVersion}, ${`98.3.${stamp}`})`);
  });

  it("enforces patch-key format checks", async () => {
    await expect(database.db.insert(patches).values({ version: `invalid-${Date.now()}`, patchKey: "not-a-patch" as never })).rejects.toThrow();
  });

  it("rejects an observation whose patch differs from its match", async () => {
    const stamp = Date.now();
    const [patchA] = await database.db.insert(patches).values({ version: `97.1.${stamp}`, patchKey: "97.1" }).returning({ id: patches.id });
    const [patchB] = await database.db.insert(patches).values({ version: `97.2.${stamp}`, patchKey: "97.2" }).returning({ id: patches.id });
    const matchId = `TR1_INTEGRATION_${stamp}`;
    await database.db.insert(matches).values({
      matchId, patchId: patchA!.id, platformId: "TR1", queueId: 420, gameVersion: "97.1.1",
      gameCreation: new Date(), gameDuration: 600
    });
    await expect(database.db.insert(participantObservations).values({
      matchId, participantId: 1, patchId: patchB!.id, puuid: "private", championId: 1,
      role: "TOP", win: true, tier: "EMERALD", division: "I", gameDuration: 600, rawFinalSlots: {}
    })).rejects.toThrow();
    await database.db.execute(sql`DELETE FROM participant_observations WHERE match_id = ${matchId}`);
    await database.db.execute(sql`DELETE FROM matches WHERE match_id = ${matchId}`);
    await database.db.delete(patches).where(sql`${patches.id} IN (${patchA!.id}, ${patchB!.id})`);
  });
});
