import { eq } from "drizzle-orm";
import { toPatchKey } from "@lol/domain";
import { createDatabase, champions as championsTable, items as itemsTable, patches } from "@lol/database";
import { DataDragonClient } from "./client";
import { classifyItem, type ItemCategory } from "./classifier";
import { normalizeItemId, validateAliases, type ItemAliases } from "./normalize";
import { overridesFor } from "./overrides";
import type { ChampionDto, ItemDto } from "./contracts";

export type Database = ReturnType<typeof createDatabase>;
export type DataDragonCatalog = Awaited<ReturnType<DataDragonClient["fetchTrCatalog"]>> & {
  /** Optional versioned aliases supplied by a catalog importer. */
  aliases?: ItemAliases;
};

type Transaction = any;

export async function syncCatalog(
  database: Database,
  catalog: DataDragonCatalog
): Promise<{ patchId: number; champions: number; items: number }> {
  return database.db.transaction(async (transaction) => {
    const patchId = await upsertPatch(transaction, catalog.version);
    const aliases = catalog.aliases ?? {};
    validateAliases(aliases, new Set(catalog.items.map((item) => Number(item.id))));
    const championCount = await upsertChampions(transaction, patchId, catalog.champions);
    const itemCount = await upsertClassifiedItems(
      transaction,
      patchId,
      catalog.items,
      overridesFor(catalog.version),
      aliases
    );
    return { patchId, champions: championCount, items: itemCount };
  });
}

export async function upsertPatch(transaction: Transaction, version: string): Promise<number> {
  const patchKey = toPatchKey(version);
  await transaction
    .update(patches)
    .set({ isActive: false, activatedAt: null })
    .where(eq(patches.isActive, true));

  const [patch] = await transaction
    .insert(patches)
    .values({ version, patchKey, isActive: true, activatedAt: new Date() })
    .onConflictDoUpdate({
      target: patches.version,
      set: { patchKey, isActive: true, activatedAt: new Date() }
    })
    .returning({ id: patches.id });
  if (!patch) throw new Error("Failed to upsert patch");
  return patch.id;
}

export async function upsertChampions(
  transaction: Transaction,
  patchId: number,
  championCatalog: Record<string, ChampionDto>
): Promise<number> {
  const values = Object.entries(championCatalog).map(([slug, champion]) => ({
    patchId,
    championId: Number(champion.key),
    slug,
    name: champion.name,
    iconUrl: champion.image.full
  }));
  for (const value of values) {
    await transaction
      .insert(championsTable)
      .values(value)
      .onConflictDoUpdate({
        target: [championsTable.patchId, championsTable.championId],
        set: { slug: value.slug, name: value.name, iconUrl: value.iconUrl }
      });
  }
  return values.length;
}

export async function upsertClassifiedItems(
  transaction: Transaction,
  patchId: number,
  itemCatalog: ItemDto[],
  overrides: Record<number, ItemCategory>,
  aliases: ItemAliases = {}
): Promise<number> {
  for (const item of itemCatalog) {
    const itemId = Number(item.id);
    const classification = classifyItem(item, overrides);
    await transaction
      .insert(itemsTable)
      .values({
        patchId,
        itemId,
        normalizedBaseId: normalizeItemId(itemId, aliases),
        category: classification.category,
        classificationReason: classification.reason,
        name: item.name,
        price: item.gold.total,
        iconUrl: item.image.full
      })
      .onConflictDoUpdate({
        target: [itemsTable.patchId, itemsTable.itemId],
        set: {
          normalizedBaseId: normalizeItemId(itemId, aliases),
          category: classification.category,
          classificationReason: classification.reason,
          name: item.name,
          price: item.gold.total,
          iconUrl: item.image.full
        }
      });
  }
  return itemCatalog.length;
}
