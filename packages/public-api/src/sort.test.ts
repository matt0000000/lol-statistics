import { describe, expect, it } from "vitest";
import { wilson95 } from "@lol/domain";
import { publicStatRowSchema, type PublicStatRow } from "./contracts";
import { compareCanonicalKeys, sortStats } from "./sort";

const row = (key: string, wins: number, sample: number): PublicStatRow => publicStatRowSchema.parse({
  key,
  itemIds: key.split(":").map(Number),
  itemMetadata: key.split(":").map((id) => ({ id: Number(id), name: `Item ${id}`, iconUrl: `https://example.test/${id}.png` })),
  wins,
  losses: sample - wins,
  sample,
  rawWinRate: wins / sample,
  buildRate: 0.1,
  baselineDelta: 0,
  confidenceLower: wilson95(wins, sample).lower,
  confidenceUpper: wilson95(wins, sample).upper,
  adjustedScore: sample >= 100 ? wilson95(wins, sample).lower : null,
  confidence: sample >= 100 ? "recommended" : "low"
});

describe("sortStats", () => {
  it("sorts recommended rows before low-confidence rows with stable ties", () => {
    const sorted = sortStats([row("2", 1, 3), row("4", 1, 2), row("3", 60, 100), row("1", 120, 200)], "adjusted");
    expect(sorted.map((item) => item.key)).toEqual(["1", "3", "2", "4"]);
  });

  it("orders canonical keys by C/ASCII lexical order", () => {
    const keys = ["1", "10", "10:20", "1:10", "1:2", "1:20"];
    expect([...keys].sort(compareCanonicalKeys)).toEqual(["1", "10", "10:20", "1:10", "1:2", "1:20"]);
    const sorted = sortStats(keys.map((key) => row(key, 50, 100)), "sample");
    expect(sorted.map((item) => item.key)).toEqual(["1", "10", "10:20", "1:10", "1:2", "1:20"]);
  });

  it("keeps shuffled low-confidence rows deterministic without NaN comparisons", () => {
    const sorted = sortStats([
      row("1:20", 5, 11),
      row("1", 5, 11),
      row("10", 7, 14),
      row("1:2", 5, 11),
      row("10:20", 7, 14),
      row("1:10", 5, 11)
    ], "adjusted");
    expect(sorted.map((item) => item.key)).toEqual(["10", "10:20", "1", "1:10", "1:2", "1:20"]);
  });

  it("uses the requested metric and canonical key as exact tie breakers", () => {
    const sorted = sortStats([row("10:20", 50, 100), row("2:30", 50, 100)], "sample");
    expect(sorted.map((item) => item.key)).toEqual(["10:20", "2:30"]);
  });

  it("keeps a lower-sample high-confidence candidate in the adjusted top 100", () => {
    const candidates = [
      row("100", 99, 100),
      ...Array.from({ length: 100 }, (_, index) => row(String(1000 + index), 250, 500))
    ];
    const top100 = sortStats(candidates, "adjusted").slice(0, 100);
    expect(top100).toHaveLength(100);
    expect(top100[0]?.key).toBe("100");
    expect(top100.some((candidate) => candidate.key === "100")).toBe(true);
  });
});
