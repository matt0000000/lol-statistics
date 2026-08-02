import { describe, expect, it } from "vitest";
import type { PublicStatRow } from "./contracts";
import { compareCanonicalKeys, sortStats } from "./sort";

const row = (key: string, adjustedScore: number | null, sample: number): PublicStatRow => ({
  key,
  itemIds: key.split(":").map(Number),
  wins: sample / 2,
  losses: sample / 2,
  sample,
  rawWinRate: 0.5,
  buildRate: 0.1,
  baselineDelta: 0,
  confidenceLower: adjustedScore ?? 0,
  confidenceUpper: 0.6,
  adjustedScore,
  confidence: adjustedScore === null ? "low" : "recommended"
});

describe("sortStats", () => {
  it("sorts recommended rows before low-confidence rows with stable ties", () => {
    const sorted = sortStats([row("2", null, 3), row("4", null, 2), row("3", 0.52, 100), row("1", 0.52, 200)], "adjusted");
    expect(sorted.map((item) => item.key)).toEqual(["1", "3", "2", "4"]);
  });

  it("orders canonical keys by C/ASCII lexical order", () => {
    const keys = ["1", "10", "10:20", "1:10", "1:2", "1:20"];
    expect([...keys].sort(compareCanonicalKeys)).toEqual(["1", "10", "10:20", "1:10", "1:2", "1:20"]);
    const sorted = sortStats(keys.map((key) => row(key, 0.5, 100)), "sample");
    expect(sorted.map((item) => item.key)).toEqual(["1", "10", "10:20", "1:10", "1:2", "1:20"]);
  });

  it("keeps shuffled low-confidence rows deterministic without NaN comparisons", () => {
    const sorted = sortStats([
      row("1:20", null, 11),
      row("1", null, 11),
      row("10", null, 14),
      row("1:2", null, 11),
      row("10:20", null, 14),
      row("1:10", null, 11)
    ], "adjusted");
    expect(sorted.map((item) => item.key)).toEqual(["10", "10:20", "1", "1:10", "1:2", "1:20"]);
  });

  it("uses the requested metric and canonical key as exact tie breakers", () => {
    const sorted = sortStats([row("10:20", 0.4, 100), row("2:30", 0.5, 100)], "sample");
    expect(sorted.map((item) => item.key)).toEqual(["10:20", "2:30"]);
  });

  it("keeps a lower-sample high-confidence candidate in the adjusted top 100", () => {
    const candidates = [
      row("100", 0.9, 100),
      ...Array.from({ length: 100 }, (_, index) => row(String(1000 + index), 0.5, 500))
    ];
    const top100 = sortStats(candidates, "adjusted").slice(0, 100);
    expect(top100).toHaveLength(100);
    expect(top100[0]?.key).toBe("100");
    expect(top100.some((candidate) => candidate.key === "100")).toBe(true);
  });
});
