import { expect, it } from "vitest";
import { normalizeItemId, validateAliases } from "./normalize";

it("normalizes an Ornn upgrade and preserves an ordinary item", () => {
  expect(normalizeItemId(7002, { 7002: 3031 })).toBe(3031);
  expect(normalizeItemId(6672, { 7002: 3031 })).toBe(6672);
});

it.each([
  ["rejects a noncanonical alias chain", { 7002: 7003, 7003: 3031 }, [3031, 7003]],
  ["rejects an alias cycle", { 7002: 7003, 7003: 7002 }, [7002, 7003]],
  ["rejects a self alias", { 7002: 7002 }, [7002]],
  ["rejects a missing alias target", { 7002: 9999 }, [3031]]
] as const)("%s", (_name, aliases, ids) => {
  expect(() => validateAliases(aliases, new Set(ids))).toThrow();
});

it("accepts a canonical alias target", () => {
  expect(() => validateAliases({ 7002: 3031 }, new Set([3031]))).not.toThrow();
});
