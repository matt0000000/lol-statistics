import { describe, expect, it } from "vitest";
import { classifyItem } from "./classifier";
import items from "../../../fixtures/riot/ddragon-items-16.15.1.json";

describe("classifyItem", () => {
  it.each([
    ["6672", "CORE"],
    ["3006", "BOOTS"],
    ["1038", "EXCLUDED_COMPONENT"],
    ["1055", "EXCLUDED_STARTER"],
    ["2003", "EXCLUDED_CONSUMABLE"],
    ["3340", "EXCLUDED_TRINKET"]
  ] as const)("classifies %s as %s", (id, expected) => {
    expect(classifyItem({ ...items.data[id], id: Number(id) }, {})).toMatchObject({ category: expected });
  });

  it("classifies base boots with an upgrade path as components", () => {
    const baseBoots = {
      ...items.data["3006"],
      id: 1001,
      name: "Boots",
      into: ["3006"],
      from: [],
      gold: { ...items.data["3006"].gold, base: 300, total: 300 }
    };
    expect(classifyItem(baseBoots, {})).toMatchObject({ category: "EXCLUDED_COMPONENT" });
  });

  it("classifies completed boots even when they advertise an upgrade path", () => {
    const completedBoots = { ...items.data["3006"], id: 3006, into: ["3172"], from: ["1001"] };
    expect(classifyItem(completedBoots, {})).toMatchObject({ category: "BOOTS" });
  });

  it("uses gold.purchasable as the canonical purchasability signal", () => {
    const unavailable = {
      ...items.data["6672"],
      id: 6672,
      purchasable: true,
      gold: { ...items.data["6672"].gold, purchasable: false }
    };

    expect(classifyItem(unavailable, {})).toMatchObject({
      category: "EXCLUDED_UNKNOWN",
      reason: "not purchasable"
    });
  });

  it("classifies the 16.15 upgraded boots fixture separately from core items", () => {
    const upgradedBoots = { ...items.data["3172"], id: 3172 };
    expect(classifyItem(upgradedBoots, { 3172: "BOOTS" })).toMatchObject({
      category: "BOOTS",
      reason: "patch override: upgraded boots"
    });
  });
});
