import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createMigratedTestDatabase, aggregatePublications, collectionRuns, items, patches, champions } from "@lol/database";
import { itemDtoSchema, parseChampionCatalog, parseItemCatalog } from "./contracts";
import { syncCatalog } from "./sync";
import championFixture from "../../../fixtures/riot/ddragon-champions-16.15.1.json";
import itemFixture from "../../../fixtures/riot/ddragon-items-16.15.1.json";
import aliases from "../../../fixtures/riot/item-aliases-16.15.1.json";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("catalog synchronization", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

  beforeEach(async () => {
    database = await createMigratedTestDatabase(url!);
  });
  afterEach(async () => {
    if (database) await database.close();
  });

  it("replaces patch snapshots, classifies rows, and transitions active patches", async () => {
    const championCatalog = parseChampionCatalog(championFixture).data;
    const parsedItems = parseItemCatalog(itemFixture).data;
    const itemCatalog = Object.entries(parsedItems).map(([id, item]) =>
      itemDtoSchema.parse({ ...item, id: Number(id) })
    );
    const catalog = { version: "16.15.1", locale: "tr_TR", champions: championCatalog, items: itemCatalog, aliases };

    const first = await syncCatalog(database, catalog);
    const patchRows = await database.db.select().from(patches).where(eq(patches.version, "16.15.1"));
    expect(patchRows).toHaveLength(1);
    expect(patchRows[0]?.isActive).toBe(true);
    const patchId = patchRows[0]!.id;
    const [run] = await database.db.insert(collectionRuns).values({ patchId, status: "RUNNING", stage: "aggregates" }).returning();
    const [publication] = await database.db.insert(aggregatePublications).values({ patchId, runId: run!.id, coverageStartedAt: new Date(), isActive: true }).returning();
    await database.db.update(patches).set({ activePublicationId: publication!.id, publishedAt: new Date("2026-08-01T00:00:00Z") }).where(eq(patches.id, patchId));
    expect(await database.db.select().from(champions).where(eq(champions.patchId, patchId))).toHaveLength(first.champions);
    const storedItems = await database.db.select().from(items).where(eq(items.patchId, patchId));
    expect(storedItems).toHaveLength(first.items);
    expect(storedItems.find((item) => item.itemId === 3031)).toMatchObject({
      category: "CORE",
      normalizedBaseId: 3031,
      classificationReason: "purchasable terminal map-11 item"
    });
    expect(storedItems.find((item) => item.itemId === 3006)).toMatchObject({
      category: "BOOTS",
      classificationReason: "completed boots"
    });
    expect(storedItems.find((item) => item.itemId === 3172)).toMatchObject({
      category: "BOOTS",
      classificationReason: "patch override: upgraded boots"
    });
    expect(storedItems.find((item) => item.itemId === 1038)).toMatchObject({
      category: "EXCLUDED_COMPONENT",
      classificationReason: "builds into another item"
    });
    expect(storedItems.every((item) => item.classificationReason.length > 0)).toBe(true);

    const shrunk = { ...catalog, champions: {}, items: itemCatalog.filter((item) => item.id !== 6672) };
    const shrunkResult = await syncCatalog(database, shrunk);
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publication!.id)))[0]?.isActive).toBe(true);
    expect((await database.db.select({ activePublicationId: patches.activePublicationId, publishedAt: patches.publishedAt }).from(patches).where(eq(patches.id, patchId)))[0]).toMatchObject({ activePublicationId: publication!.id, publishedAt: expect.any(Date) });
    expect(shrunkResult).toEqual({ patchId, champions: 0, items: first.items - 1 });
    expect(await database.db.select().from(champions).where(eq(champions.patchId, patchId))).toHaveLength(0);
    const shrunkItems = await database.db.select().from(items).where(eq(items.patchId, patchId));
    expect(shrunkItems).toHaveLength(first.items - 1);
    expect(shrunkItems.some((item) => item.itemId === 6672)).toBe(false);

    const nextCatalog = {
      ...catalog,
      version: "16.16.1",
      champions: Object.fromEntries(Object.entries(championCatalog).slice(0, 1)),
      items: itemCatalog.slice(0, 2)
    };
    const next = await syncCatalog(database, nextCatalog);
    const nextPatchRows = await database.db.select().from(patches);
    expect(nextPatchRows.filter((patch) => patch.isActive)).toHaveLength(1);
    expect(nextPatchRows.find((patch) => patch.version === "16.15.1")?.isActive).toBe(false);
    expect(nextPatchRows.find((patch) => patch.version === "16.16.1")?.isActive).toBe(true);
    expect((await database.db.select({ isActive: aggregatePublications.isActive }).from(aggregatePublications).where(eq(aggregatePublications.id, publication!.id)))[0]?.isActive).toBe(false);
    expect(nextPatchRows.find((patch) => patch.version === "16.15.1")).toMatchObject({ activePublicationId: null, publishedAt: null });
    expect(nextPatchRows.find((patch) => patch.version === "16.16.1")).toMatchObject({ activePublicationId: null, publishedAt: null });
    expect(await database.db.select().from(champions).where(eq(champions.patchId, next.patchId))).toHaveLength(next.champions);
    expect(await database.db.select().from(items).where(eq(items.patchId, next.patchId))).toHaveLength(next.items);

    const repeatedNext = await syncCatalog(database, nextCatalog);
    expect(repeatedNext).toEqual(next);
    expect(await database.db.select().from(champions).where(eq(champions.patchId, next.patchId))).toHaveLength(next.champions);
    expect(await database.db.select().from(items).where(eq(items.patchId, next.patchId))).toHaveLength(next.items);
  });

  it("rolls back patch activation and catalog rows when alias validation fails", async () => {
    const championCatalog = parseChampionCatalog(championFixture).data;
    const parsedItems = parseItemCatalog(itemFixture).data;
    const itemCatalog = Object.entries(parsedItems).map(([id, item]) => itemDtoSchema.parse({ ...item, id: Number(id) }));
    const catalog = { version: "16.15.1", locale: "tr_TR", champions: championCatalog, items: itemCatalog, aliases };
    await syncCatalog(database, catalog);
    const priorPatch = (await database.db.select().from(patches).where(eq(patches.version, "16.15.1")))[0]!;
    const priorChampions = await database.db.select().from(champions).where(eq(champions.patchId, priorPatch.id));
    const priorItems = await database.db.select().from(items).where(eq(items.patchId, priorPatch.id));
    const priorChampionCount = priorChampions.length;
    const priorItemCount = priorItems.length;

    const failedCatalog = { ...catalog, version: "16.16.1", aliases: { 7002: 999999 } };
    await expect(syncCatalog(database, failedCatalog)).rejects.toThrow("Item alias target is not in catalog");

    const active = await database.db.select().from(patches).where(eq(patches.isActive, true));
    expect(active).toHaveLength(1);
    expect(active[0]).toEqual(priorPatch);
    expect(await database.db.select().from(patches).where(eq(patches.version, "16.16.1"))).toHaveLength(0);
    const activeChampions = await database.db.select().from(champions).where(eq(champions.patchId, active[0]!.id));
    const activeItems = await database.db.select().from(items).where(eq(items.patchId, active[0]!.id));
    expect(activeChampions).toEqual(priorChampions);
    expect(activeItems).toEqual(priorItems);
    expect(activeChampions).toHaveLength(priorChampionCount);
    expect(activeItems).toHaveLength(priorItemCount);
    expect(await database.db.select().from(champions)).toHaveLength(priorChampionCount);
    expect(await database.db.select().from(items)).toHaveLength(priorItemCount);
    expect(priorItems.find((item) => item.itemId === 3006)?.category).toBe("BOOTS");
    expect(priorItems.find((item) => item.itemId === 3031)?.category).toBe("CORE");
  });
});
