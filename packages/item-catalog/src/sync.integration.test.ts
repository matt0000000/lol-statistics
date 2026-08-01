import { afterAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
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

  it("upserts one active patch and an idempotent classified catalog", async () => {
    const championCatalog = parseChampionCatalog(championFixture).data;
    const parsedItems = parseItemCatalog(itemFixture).data;
    const itemCatalog = Object.entries(parsedItems).map(([id, item]) =>
      itemDtoSchema.parse({ ...item, id: Number(id) })
    );
    const catalog = {
      version: "16.15.1",
      locale: "tr_TR",
      champions: championCatalog,
      items: itemCatalog,
      aliases
    };

    const first = await syncCatalog(database, catalog);
    const second = await syncCatalog(database, catalog);
    expect(second).toEqual(first);

    const patchRows = await database.db.select().from(patches).where(eq(patches.version, "16.15.1"));
    expect(patchRows).toHaveLength(1);
    expect(patchRows[0]?.isActive).toBe(true);
    expect((await database.db.select({ value: count() }).from(champions))[0]?.value).toBe(first.champions);
    expect((await database.db.select({ value: count() }).from(items))[0]?.value).toBe(first.items);
  });
});
