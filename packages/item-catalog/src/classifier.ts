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
  if (forced) {
    const reason = forced === "BOOTS" ? "patch override: upgraded boots" : "patch override";
    return { category: forced, reason };
  }
  if (item.maps?.["11"] !== true) {
    return { category: "EXCLUDED_MODE", reason: "not enabled on map 11" };
  }
  if (item.tags.includes("Trinket")) {
    return { category: "EXCLUDED_TRINKET", reason: "trinket" };
  }
  if (item.tags.includes("Consumable")) {
    return { category: "EXCLUDED_CONSUMABLE", reason: "consumable" };
  }
  // Completed boots have component inputs (`from`). Base Boots (1001) have
  // an upgrade path but no inputs and are therefore components themselves.
  if (item.tags.includes("Boots") && item.from.length > 0) {
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
