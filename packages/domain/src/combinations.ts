function assertItemId(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Item IDs must be nonnegative safe integers");
  }
}

function sortedItems(items: readonly number[]): number[] {
  const result = [...items];
  for (const item of result) assertItemId(item);
  return result.sort((a, b) => a - b);
}

/** Return the canonical, numeric-order key for an item multiset. */
export function combinationKey(items: readonly number[]): string {
  return sortedItems(items).join(":");
}

/**
 * Return unique multisets of the requested size contained in `items`.
 * Input and returned arrays are independent, and duplicate item quantities
 * are represented (while duplicate index subsets are removed).
 */
export function combinations(items: readonly number[], size: number): number[][] {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError("Combination size must be a positive safe integer");
  }

  const sorted = sortedItems(items);
  if (size > sorted.length) return [];

  const unique = new Map<string, number[]>();
  const selected: number[] = [];

  function visit(start: number): void {
    if (selected.length === size) {
      const value = selected.slice();
      unique.set(value.join(":"), value);
      return;
    }
    const needed = size - selected.length;
    for (let index = start; index <= sorted.length - needed; index += 1) {
      selected.push(sorted[index]);
      visit(index + 1);
      selected.pop();
    }
  }
  visit(0);

  return [...unique.values()].sort((left, right) => {
    for (let index = 0; index < left.length; index += 1) {
      const difference = left[index] - right[index];
      if (difference !== 0) return difference;
    }
    return 0;
  });
}
