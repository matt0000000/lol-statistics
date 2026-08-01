import type { ItemDto } from "./contracts";

export type ItemCategory =
  | "CORE"
  | "BOOTS"
  | "EXCLUDED_COMPONENT"
  | "EXCLUDED_STARTER"
  | "EXCLUDED_CONSUMABLE"
  | "EXCLUDED_TRINKET"
  | "EXCLUDED_SUPPORT"
  | "EXCLUDED_MODE"
  | "EXCLUDED_UNKNOWN";

export type ItemClassification = { category: ItemCategory; reason: string };

export function classifyItem(
  item: ItemDto,
  overrides: Record<number, ItemCategory>
): ItemClassification {
  const forced = overrides[Number(item.id)];
  if (forced) return { category: forced, reason: "patch override" };
  if (item.maps?.["11"] !== true) {
    return { category: "EXCLUDED_MODE", reason: "not enabled on map 11" };
  }
  if (item.tags.includes("Trinket")) {
    return { category: "EXCLUDED_TRINKET", reason: "trinket" };
  }
  if (item.tags.includes("Consumable")) {
    return { category: "EXCLUDED_CONSUMABLE", reason: "consumable" };
  }
  // Some completed boots (for example 3006 in Data Dragon) advertise a
  // cosmetic/alternate upgrade in `into`; boots still have their own stable
  // category and must be handled before generic components.
  if (item.tags.includes("Boots")) {
    return { category: "BOOTS", reason: "completed boots" };
  }
  if (item.into && item.into.length > 0) {
    return { category: "EXCLUDED_COMPONENT", reason: "builds into another item" };
  }
  if (!item.purchasable) {
    return { category: "EXCLUDED_UNKNOWN", reason: "not purchasable" };
  }
  if (item.gold.total <= 500) {
    return { category: "EXCLUDED_STARTER", reason: "starter-price terminal item" };
  }
  return { category: "CORE", reason: "purchasable terminal map-11 item" };
}
