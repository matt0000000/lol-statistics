import { expect, it } from "vitest";
import { normalizeItemId } from "./normalize";

it("normalizes an Ornn upgrade and preserves an ordinary item", () => {
  expect(normalizeItemId(7002, { 7002: 3031 })).toBe(3031);
  expect(normalizeItemId(6672, { 7002: 3031 })).toBe(6672);
});
