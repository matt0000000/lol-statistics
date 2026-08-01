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
});
