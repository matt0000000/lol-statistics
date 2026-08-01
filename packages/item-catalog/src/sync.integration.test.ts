import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDatabase, items, patches, champions } from "@lol/database";
import { itemDtoSchema, parseChampionCatalog, parseItemCatalog } from "./contracts";
import { syncCatalog } from "./sync";
import championFixture from "../../../fixtures/riot/ddragon-champions-16.15.1.json";
import itemFixture from "../../../fixtures/riot/ddragon-items-16.15.1.json";
import aliases from "../../../fixtures/riot/item-aliases-16.15.1.json";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("catalog synchronization", () => {
  const database = createDatabase(url!);
  afterAll(() => database.close());

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
    expect(storedItems.find((item) => item.itemId === 1038)).toMatchObject({
      category: "EXCLUDED_COMPONENT",
      classificationReason: "builds into another item"
    });
    expect(storedItems.every((item) => item.classificationReason.length > 0)).toBe(true);

    const shrunk = { ...catalog, champions: {}, items: itemCatalog.filter((item) => item.id !== 6672) };
    const shrunkResult = await syncCatalog(database, shrunk);
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
    expect(await database.db.select().from(champions).where(eq(champions.patchId, next.patchId))).toHaveLength(next.champions);
    expect(await database.db.select().from(items).where(eq(items.patchId, next.patchId))).toHaveLength(next.items);

    const repeatedNext = await syncCatalog(database, nextCatalog);
    expect(repeatedNext).toEqual(next);
    expect(await database.db.select().from(champions).where(eq(champions.patchId, next.patchId))).toHaveLength(next.champions);
    expect(await database.db.select().from(items).where(eq(items.patchId, next.patchId))).toHaveLength(next.items);
  });
});
