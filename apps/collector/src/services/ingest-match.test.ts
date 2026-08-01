import { describe, expect, it } from "vitest";
import { parseFinalInventory } from "./ingest-match";

describe("parseFinalInventory", () => {
  const catalog = [
    { id: 3031, category: "CORE" },
    { id: 3172, category: "BOOTS" },
    { id: 1001, category: "EXCLUDED_COMPONENT" },
    { id: 2055, category: "EXCLUDED_CONSUMABLE" }
  ];
  it("normalizes aliases, duplicate cores, and upgraded boots", () => {
    const result = parseFinalInventory({ participant: { item0: 7002, item1: 3031, item2: 3172, item3: 1001, item4: 2055, item5: 0, item6: 0 }, gameVersion: "16.15.1", catalog });
    expect(result.coreItems).toEqual([{ itemId: 3031, quantity: 2, slotIndex: 0 }]);
    expect(result.boots).toEqual({ itemId: 3172, slotIndex: 2 });
  });
  it("rejects an uncatalogued item without exposing its id", () => {
    expect(() => parseFinalInventory({ participant: { item0: 999999, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0 }, gameVersion: "16.15.1", catalog })).toThrow("inventory parse failed (unknown_item)");
  });
});
