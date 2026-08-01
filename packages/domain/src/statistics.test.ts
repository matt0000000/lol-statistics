import { describe, expect, it } from "vitest";
import { calculateAggregateMetrics, wilson95 } from "./statistics";

describe("wilson95", () => {
  it("calculates the specified 95% interval", () => {
    expect(wilson95(55, 100)).toEqual({ lower: expect.closeTo(0.4524, 4), upper: expect.closeTo(0.6439, 4) });
  });

  it("returns an exact zero interval for an empty sample", () => {
    expect(wilson95(0, 0)).toEqual({ lower: 0, upper: 0 });
  });

  it("supports all wins and all losses", () => {
    expect(wilson95(10, 10).lower).toBeGreaterThan(0);
    expect(wilson95(0, 10).upper).toBeLessThan(1);
  });

  it("rejects invalid counts", () => {
    for (const [wins, sample] of [[-1, 3], [4, 3], [1.5, 3], [1, Number.NaN], [1, Number.POSITIVE_INFINITY], [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1]]) {
      expect(() => wilson95(wins, sample)).toThrow();
    }
  });
});

describe("calculateAggregateMetrics", () => {
  it("calculates transparent metrics and ranks by the Wilson lower bound", () => {
    expect(calculateAggregateMetrics({ wins: 55, sample: 100, baselineWins: 510, baselineSample: 1000 })).toMatchObject({
      wins: 55,
      sample: 100,
      losses: 45,
      rawWinRate: 0.55,
      buildRate: 0.1,
      baselineWins: 510,
      baselineSample: 1000,
      baselineWinRate: 0.51,
      baselineDelta: 0.04,
      adjustedScore: expect.closeTo(0.4524, 4),
      recommended: true,
    });
  });

  it("does not recommend a sample below the configured minimum", () => {
    expect(calculateAggregateMetrics({ wins: 99, sample: 99, baselineWins: 510, baselineSample: 1000 }).recommended).toBe(false);
    expect(calculateAggregateMetrics({ wins: 0, sample: 0, baselineWins: 0, baselineSample: 0, minimumSample: 0 })).toMatchObject({ rawWinRate: 0, buildRate: 0, baselineWinRate: 0, baselineDelta: 0, adjustedScore: 0, recommended: true });
  });

  it("validates aggregate counts and minimum sample", () => {
    const invalid = [
      { wins: -1, sample: 1, baselineWins: 0, baselineSample: 1 },
      { wins: 2, sample: 1, baselineWins: 0, baselineSample: 1 },
      { wins: 1, sample: 2, baselineWins: 0, baselineSample: 1 },
      { wins: 0, sample: 0, baselineWins: 1, baselineSample: 0 },
      { wins: 1.2, sample: 2, baselineWins: 0, baselineSample: 2 },
      { wins: Number.NaN, sample: 2, baselineWins: 0, baselineSample: 2 },
      { wins: 0, sample: Number.POSITIVE_INFINITY, baselineWins: 0, baselineSample: 2 },
      { wins: 0, sample: 2, baselineWins: 0, baselineSample: 2, minimumSample: -1 },
      { wins: 0, sample: 2, baselineWins: 0, baselineSample: 2, minimumSample: 1.5 },
    ];
    for (const input of invalid) expect(() => calculateAggregateMetrics(input)).toThrow();
  });
});
