import type { PublicStatRow, StatsSort } from "./contracts";

/**
 * Compare canonical stat keys using the same byte/code-point ordering as
 * PostgreSQL's `COLLATE "C"` ordering used by the bounded SQL queries.
 */
export function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function valueFor(row: PublicStatRow, sort: Exclude<StatsSort, "adjusted">): number {
  if (sort === "winRate") return row.rawWinRate;
  if (sort === "buildRate") return row.buildRate;
  return row.sample;
}

export function sortStats(rows: readonly PublicStatRow[], sort: StatsSort): PublicStatRow[] {
  return [...rows].sort((left, right) => {
    if (sort === "adjusted") {
      // Null adjusted scores represent low-confidence rows. Keep them after
      // every recommended row without subtracting infinities (which yields
      // NaN when both rows are null and violates comparator transitivity).
      const leftScore = left.adjustedScore;
      const rightScore = right.adjustedScore;
      if (leftScore === null && rightScore !== null) return 1;
      if (leftScore !== null && rightScore === null) return -1;
      if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return rightScore > leftScore ? 1 : -1;
    } else {
      const leftValue = valueFor(left, sort);
      const rightValue = valueFor(right, sort);
      if (leftValue !== rightValue) return rightValue > leftValue ? 1 : -1;
    }
    const sampleDifference = right.sample - left.sample;
    if (sampleDifference !== 0) return sampleDifference;
    return compareCanonicalKeys(left.key, right.key);
  });
}
