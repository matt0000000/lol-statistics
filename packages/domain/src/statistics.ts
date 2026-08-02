/** The two-sided 95% Wilson score critical value used by every consumer. */
export const WILSON_Z = 1.959963984540054;

function assertCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function clampFloatingEpsilon(value: number): number {
  const epsilon = Number.EPSILON * 32;
  if (value < 0 && value >= -epsilon) return 0;
  if (value > 1 && value <= 1 + epsilon) return 1;
  return value;
}

export type WilsonInterval = { lower: number; upper: number };

export function wilson95(wins: number, sample: number): WilsonInterval {
  assertCount(wins, "wins");
  assertCount(sample, "sample");
  if (wins > sample) throw new RangeError("wins cannot exceed sample");
  if (sample === 0) return { lower: 0, upper: 0 };

  const p = wins / sample;
  const zSquared = WILSON_Z * WILSON_Z;
  const denominator = 1 + zSquared / sample;
  const center = (p + zSquared / (2 * sample)) / denominator;
  const margin = WILSON_Z * Math.sqrt((p * (1 - p) + zSquared / (4 * sample)) / sample) / denominator;
  return {
    lower: clampFloatingEpsilon(center - margin),
    upper: clampFloatingEpsilon(center + margin),
  };
}

export type AggregateMetricsInput = {
  wins: number;
  sample: number;
  baselineWins: number;
  baselineSample: number;
  minimumSample?: number;
};

export type AggregateMetrics = AggregateMetricsInput & {
  minimumSample: number;
  losses: number;
  rawWinRate: number;
  buildRate: number;
  baselineWinRate: number;
  baselineDelta: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceInterval: WilsonInterval;
  adjustedScore: number;
  recommended: boolean;
};

export function calculateAggregateMetrics(input: AggregateMetricsInput): AggregateMetrics {
  if (input === null || typeof input !== "object") throw new TypeError("Metrics input must be an object");
  const { wins, sample, baselineWins, baselineSample } = input;
  const minimumSample = input.minimumSample ?? 100;
  assertCount(wins, "wins");
  assertCount(sample, "sample");
  assertCount(baselineWins, "baselineWins");
  assertCount(baselineSample, "baselineSample");
  assertCount(minimumSample, "minimumSample");
  if (wins > sample) throw new RangeError("wins cannot exceed sample");
  if (sample > baselineSample) throw new RangeError("sample cannot exceed baselineSample");
  if (baselineWins > baselineSample) throw new RangeError("baselineWins cannot exceed baselineSample");

  const interval = wilson95(wins, sample);
  const rawWinRate = sample === 0 ? 0 : wins / sample;
  const buildRate = baselineSample === 0 ? 0 : sample / baselineSample;
  const baselineWinRate = baselineSample === 0 ? 0 : baselineWins / baselineSample;
  // Keep the published difference stable instead of exposing a binary floating
  // point artifact (for example, 0.55 - 0.51).
  const baselineDelta = Number((rawWinRate - baselineWinRate).toFixed(12));

  return {
    wins,
    losses: sample - wins,
    sample,
    baselineWins,
    baselineSample,
    minimumSample,
    rawWinRate,
    buildRate,
    baselineWinRate,
    baselineDelta,
    confidenceLower: interval.lower,
    confidenceUpper: interval.upper,
    confidenceInterval: interval,
    adjustedScore: interval.lower,
    recommended: sample >= minimumSample,
  };
}
