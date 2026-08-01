import { and, eq, notInArray } from "drizzle-orm";
import { toPatchKey } from "@lol/domain";
import { createDatabase, aggregatePublications, champions as championsTable, items as itemsTable, patches } from "@lol/database";
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

export const PATCH_ROLLOVER_LOCK_ORDER = ["active_publications", "patches"] as const;

export function patchPublicationTransition(samePatchRefresh: boolean): { activePublicationId?: string | null; publishedAt?: Date | null } {
  return samePatchRefresh ? {} : { activePublicationId: null, publishedAt: null };
}

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
  // Match publication activation's target-first lock order: the global active
  // publication rows are locked before any patch rows during rollover.
  await transaction.select({ id: aggregatePublications.id }).from(aggregatePublications).where(eq(aggregatePublications.isActive, true)).for("update");
  const prior = (await transaction.select().from(patches).where(eq(patches.isActive, true)).for("update").limit(1))[0];
  const existing = (await transaction.select().from(patches).where(eq(patches.version, version)).for("update").limit(1))[0];
  const samePatchRefresh = Boolean(prior && existing && prior.id === existing.id);
  if (!samePatchRefresh) {
    await transaction.update(aggregatePublications).set({ isActive: false }).where(eq(aggregatePublications.isActive, true));
    await transaction.update(patches).set({ isActive: false, activatedAt: null, ...patchPublicationTransition(false) }).where(eq(patches.isActive, true));
  }

  const [patch] = await transaction
    .insert(patches)
    .values({ version, patchKey, isActive: true, activatedAt: new Date() })
    .onConflictDoUpdate({
      target: patches.version,
      set: samePatchRefresh
        ? { patchKey, isActive: true }
        : { patchKey, isActive: true, activatedAt: new Date(), ...patchPublicationTransition(false) }
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
  if (values.length === 0) {
    await transaction.delete(championsTable).where(eq(championsTable.patchId, patchId));
  } else {
    await transaction
      .delete(championsTable)
      .where(and(eq(championsTable.patchId, patchId), notInArray(championsTable.championId, values.map((value) => value.championId))));
  }
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
  const itemIds = itemCatalog.map((item) => Number(item.id));
  if (itemIds.length === 0) {
    await transaction.delete(itemsTable).where(eq(itemsTable.patchId, patchId));
  } else {
    await transaction
      .delete(itemsTable)
      .where(and(eq(itemsTable.patchId, patchId), notInArray(itemsTable.itemId, itemIds)));
  }
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
