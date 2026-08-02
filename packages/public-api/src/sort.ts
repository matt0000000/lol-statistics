import type { PublicStatRow, StatsSort } from "./contracts";

function valueFor(row: PublicStatRow, sort: StatsSort): number {
  if (sort === "adjusted") return row.adjustedScore ?? Number.NEGATIVE_INFINITY;
  if (sort === "winRate") return row.rawWinRate;
  if (sort === "buildRate") return row.buildRate;
  return row.sample;
}

export function sortStats(rows: readonly PublicStatRow[], sort: StatsSort): PublicStatRow[] {
  return [...rows].sort((left, right) => {
    const metricDifference = valueFor(right, sort) - valueFor(left, sort);
    if (metricDifference !== 0) return metricDifference;
    const sampleDifference = right.sample - left.sample;
    if (sampleDifference !== 0) return sampleDifference;
    return left.key.localeCompare(right.key);
  });
}
