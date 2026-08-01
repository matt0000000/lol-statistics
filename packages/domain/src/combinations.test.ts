import { describe, expect, it } from "vitest";
import { combinationKey, combinations } from "./combinations";

describe("combinations", () => {
  it("canonicalizes unordered numeric keys", () => {
    expect(combinationKey([3031, 6672])).toBe("3031:6672");
    expect(combinationKey([6672, 3031])).toBe("3031:6672");
  });

  it("preserves duplicate quantities and removes duplicate index subsets", () => {
    expect(combinations([3031, 3031, 6672], 2)).toEqual([[3031, 3031], [3031, 6672]]);
  });

  it("returns every contained trio from four items in numeric order", () => {
    expect(combinations([1, 2, 3, 4], 3)).toEqual([
      [1, 2, 3],
      [1, 2, 4],
      [1, 3, 4],
      [2, 3, 4],
    ]);
  });

  it("handles size one, empty input, and an oversized request", () => {
    expect(combinations([10, 2, 2], 1)).toEqual([[2], [10]]);
    expect(combinations([], 1)).toEqual([]);
    expect(combinations([1, 2], 3)).toEqual([]);
  });

  it("does not mutate caller input and sorts numerically rather than lexically", () => {
    const items = [10, 2, 1];
    expect(combinations(items, 2)).toEqual([[1, 2], [1, 10], [2, 10]]);
    expect(items).toEqual([10, 2, 1]);
  });

  it("rejects invalid item IDs and combination sizes", () => {
    expect(() => combinationKey([-1])).toThrow();
    expect(() => combinationKey([Number.NaN])).toThrow();
    expect(() => combinationKey([Number.MAX_SAFE_INTEGER + 1])).toThrow();
    expect(() => combinations([1], 0)).toThrow();
    expect(() => combinations([1], 1.5)).toThrow();
    expect(() => combinations([1], Number.POSITIVE_INFINITY)).toThrow();
  });
});
