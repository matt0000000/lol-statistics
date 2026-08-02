import { describe, expect, it } from "vitest";
import { formatDelta, formatPercent } from "./format";

describe("statistics formatters", () => {
  it("formats rates and signed percentage-point deltas", () => {
    expect(formatPercent(0.554)).toBe("55.4%");
    expect(formatDelta(0.04)).toBe("+4.0 pp");
    expect(formatDelta(-0.013)).toBe("−1.3 pp");
  });

  it("uses an en dash for non-finite values and normalizes negative zero", () => {
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatDelta(-0)).toBe("0.0 pp");
  });
});
