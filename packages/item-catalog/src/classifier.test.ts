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
});
