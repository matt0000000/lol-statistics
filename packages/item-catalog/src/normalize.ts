export type ItemAliases = Record<number, number>;

/** Resolve one catalog alias (for example an Ornn upgrade) to its base item. */
export function normalizeItemId(itemId: number, aliases: ItemAliases): number {
  return aliases[itemId] ?? itemId;
}

/** Validate aliases before writing a catalog snapshot. */
export function validateAliases(aliases: ItemAliases, itemIds: ReadonlySet<number>): void {
  for (const [sourceText, target] of Object.entries(aliases)) {
    const source = Number(sourceText);
    if (!Number.isSafeInteger(source) || source < 0 || !Number.isSafeInteger(target) || target < 0) {
      throw new Error("Invalid item alias");
    }
    if (!itemIds.has(target)) throw new Error("Item alias target is not in catalog");
    const seen = new Set<number>([source]);
    let current = target;
    while (aliases[current] !== undefined) {
      if (seen.has(current)) throw new Error("Item alias cycle");
      seen.add(current);
      current = aliases[current];
      if (!Number.isSafeInteger(current) || current < 0) throw new Error("Invalid item alias");
    }
    if (!itemIds.has(current)) throw new Error("Item alias target is not in catalog");
  }
}
