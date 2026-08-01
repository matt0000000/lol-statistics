import type { ItemCategory } from "./classifier";

// Data Dragon occasionally publishes support quest rows as ordinary items.
// Keep these patch-scoped so the catalog remains deterministic when Riot
// changes the item set.
const SUPPORT_QUEST_IDS: readonly number[] = [
  3850, 3851, 3853, 3854, 3855, 3856, 3857, 3858, 3859, 3860, 3862,
  3863, 3864, 3865, 3866, 3867
];

const PATCH_OVERRIDES: Record<string, Record<number, ItemCategory>> = {
  "16.15": {
    ...Object.fromEntries(SUPPORT_QUEST_IDS.map((id) => [id, "EXCLUDED_SUPPORT"])),
    3172: "BOOTS"
  }
};

export function overridesFor(version: string): Record<number, ItemCategory> {
  const patch = version.match(/^(\d+\.\d+)/)?.[1] ?? version;
  return { ...(PATCH_OVERRIDES[patch] ?? {}) };
}
