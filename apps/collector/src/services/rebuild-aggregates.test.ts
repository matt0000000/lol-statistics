import { describe, expect, it } from "vitest";
import { rebuildAggregates, type AggregateObservation } from "./rebuild-aggregates";

describe("rebuildAggregates", () => {
  it("builds baseline, item, pair, trio, and boots counters from observations", async () => {
    const source: AggregateObservation[] = [
      { championId: 1, role: "TOP", matchId: "m1", participantId: 1, win: true, items: [3031, 6672, 3085], boots: 3006 },
      { championId: 1, role: "TOP", matchId: "m2", participantId: 1, win: false, items: [6672, 3031], boots: 3006 }
    ];
    const result = await rebuildAggregates({ publicationId: "pub-1", source });
    const group = result.groups.get("1:TOP")!;
    expect(group.baseline).toEqual({ wins: 1, losses: 1, sample: 2 });
    expect(group.items.get(3031)).toEqual({ wins: 1, losses: 1, sample: 2 });
    expect(group.pairs.get("3031:6672")).toEqual({ wins: 1, losses: 1, sample: 2 });
    expect(group.trios.get("3031:3085:6672")).toEqual({ wins: 1, losses: 0, sample: 1 });
    expect(group.boots.get(3006)).toEqual({ wins: 1, losses: 1, sample: 2 });
  });

  it("preserves multiset duplicates while item counters count presence once", async () => {
    const result = await rebuildAggregates({ publicationId: "p", source: [{ championId: 1, role: "TOP", matchId: "m", participantId: 1, win: true, items: [{ itemId: 3031, quantity: 2 }, 6672] }] });
    const group = result.groups.get("1:TOP")!;
    expect(group.items.get(3031)).toEqual({ wins: 1, losses: 0, sample: 1 });
    expect(group.pairs.get("3031:3031")).toEqual({ wins: 1, losses: 0, sample: 1 });
  });

  it("rejects a regressing async source instead of silently reordering it", async () => {
    async function* source() {
      yield { championId: 2, role: "TOP", matchId: "m2", participantId: 1, win: true, items: [] };
      yield { championId: 1, role: "TOP", matchId: "m1", participantId: 1, win: true, items: [] };
    }
    await expect(rebuildAggregates({ publicationId: "p", source: source() })).rejects.toThrow("aggregate source order regression");
  });

  it("flushes and discards exactly one group at a time", async () => {
    const flushed: number[] = [];
    await rebuildAggregates({ publicationId: "p", source: [
      { championId: 1, role: "TOP", matchId: "m1", participantId: 1, win: true, items: [] },
      { championId: 2, role: "TOP", matchId: "m2", participantId: 1, win: false, items: [] }
    ], sink: { flushGroup: async (_p, group) => flushed.push(group.championId) } });
    expect(flushed).toEqual([1, 2]);
  });

  it("uses raw catalog keys to normalize core item IDs and boots", async () => {
    const result = await rebuildAggregates({ publicationId: "p", source: [{ championId: 1, role: "TOP", matchId: "m", participantId: 1, win: true, items: [{ itemId: 7000, quantity: 2, normalizedBaseId: 3031, category: "CORE" }], boots: { itemId: 9000, normalizedBaseId: 3006, category: "BOOTS" } }], catalog: new Map([
      [7000, { itemId: 7000, normalizedBaseId: 3031, category: "CORE" }], [3031, { itemId: 3031, normalizedBaseId: 3031, category: "CORE" }], [9000, { itemId: 9000, normalizedBaseId: 3006, category: "BOOTS" }], [3006, { itemId: 3006, normalizedBaseId: 3006, category: "BOOTS" }]
    ]) });
    expect(result.items?.has(3031)).toBe(true);
    expect(result.boots?.has(3006)).toBe(true);
  });
});
