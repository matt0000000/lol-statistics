import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { aggregatePublications, baselineAggregates, bootsAggregates, champions, collectionRuns, combinationAggregates, createMigratedTestDatabase, itemAggregates, items, patches } from "@lol/database";
import { createPublicQueries } from "./queries";
import { publicChampionSchema, publicChampionSummarySchema, publicMethodologySchema, publicStatsResponseSchema } from "./contracts";

const sourceUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!sourceUrl);

type FixtureStat = { key: string; wins: number; losses: number; sample: number };
type Sort = "adjusted" | "winRate" | "buildRate" | "sample";

function cCollationCompare(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

const REFERENCE_Z = 1.959963984540054;
function referenceWilsonLower(wins: number, sample: number): number {
  if (sample === 0) return 0;
  const p = wins / sample;
  const zSquared = REFERENCE_Z * REFERENCE_Z;
  const denominator = 1 + zSquared / sample;
  const center = (p + zSquared / (2 * sample)) / denominator;
  const margin = REFERENCE_Z * Math.sqrt((p * (1 - p) + zSquared / (4 * sample)) / sample) / denominator;
  return center - margin;
}

function independentReference(rows: readonly FixtureStat[], sort: Sort, includeLowConfidence: boolean): FixtureStat[] {
  const filtered = includeLowConfidence ? [...rows] : rows.filter((row) => row.sample >= 100);
  const score = (row: FixtureStat): number | null => row.sample >= 100 ? referenceWilsonLower(row.wins, row.sample) : null;
  return filtered.sort((left, right) => {
    if (sort === "adjusted") {
      const leftScore = score(left);
      const rightScore = score(right);
      if (leftScore === null && rightScore !== null) return 1;
      if (leftScore !== null && rightScore === null) return -1;
      if (leftScore !== null && rightScore !== null && leftScore !== rightScore) return rightScore > leftScore ? 1 : -1;
    } else {
      const leftValue = sort === "winRate" ? left.wins / left.sample : sort === "buildRate" ? left.sample / 1000 : left.sample;
      const rightValue = sort === "winRate" ? right.wins / right.sample : sort === "buildRate" ? right.sample / 1000 : right.sample;
      if (leftValue !== rightValue) return rightValue > leftValue ? 1 : -1;
    }
    return right.sample - left.sample || cCollationCompare(left.key, right.key);
  }).slice(0, 100);
}

integration("public views and query repository", () => {
  let isolated: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let activePatchId: number;
  let activePublicationId: string;

  beforeAll(async () => {
    isolated = await createMigratedTestDatabase(sourceUrl!);
    const [stalePatch] = await isolated.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15", isActive: false }).returning({ id: patches.id });
    const [patch] = await isolated.db.insert(patches).values({ version: "16.16.1", patchKey: "16.16", isActive: true }).returning({ id: patches.id });
    const [staleRun] = await isolated.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish" }).returning({ id: collectionRuns.id });
    await isolated.db.insert(aggregatePublications).values({ patchId: stalePatch!.id, runId: staleRun!.id, coverageStartedAt: new Date("2026-07-01T00:00:00Z"), isActive: false });
    const [run] = await isolated.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish", minimumSample: 100 }).returning({ id: collectionRuns.id });
    const [publication] = await isolated.db.insert(aggregatePublications).values({ patchId: patch!.id, runId: run!.id, coverageStartedAt: new Date("2026-08-01T00:00:00Z"), collectedAt: new Date("2026-08-02T00:00:00Z"), isActive: true }).returning({ id: aggregatePublications.id });
    activePatchId = patch!.id;
    activePublicationId = publication!.id;
    await isolated.db.update(patches).set({ activePublicationId: publication!.id, publishedAt: new Date("2026-08-02T00:00:00Z") }).where(eq(patches.id, patch!.id));
    await isolated.db.insert(champions).values([
      { patchId: patch!.id, championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Jinx.png" },
      { patchId: patch!.id, championId: 1, slug: "annie", name: "Annie", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Annie.png" }
    ]);
    await isolated.db.insert(items).values([3031, 6672, 6692, 3006, 3111].map((itemId) => ({ patchId: patch!.id, itemId, normalizedBaseId: itemId, category: itemId === 3006 || itemId === 3111 ? "BOOTS" as const : "CORE" as const, classificationReason: "test", name: `Item ${itemId}`, price: 100, iconUrl: `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/${itemId}.png` })));
    await isolated.db.insert(baselineAggregates).values([
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", wins: 600, losses: 400, sample: 1000 },
      { publicationId: publication!.id, championId: 222, role: "UTILITY", wins: 55, losses: 45, sample: 100 },
      { publicationId: publication!.id, championId: 1, role: "MIDDLE", wins: 70, losses: 30, sample: 100 }
    ]);
    await isolated.db.insert(itemAggregates).values([
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 3031, wins: 60, losses: 40, sample: 100 },
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 6672, wins: 40, losses: 40, sample: 80 },
      { publicationId: publication!.id, championId: 222, role: "UTILITY", itemId: 6692, wins: 60, losses: 40, sample: 100 }
    ]);
    await isolated.db.insert(combinationAggregates).values([
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 2, combinationKey: "3031:6672", wins: 60, losses: 40, sample: 100 },
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 2, combinationKey: "3031:6692", wins: 40, losses: 40, sample: 80 },
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 3, combinationKey: "3031:6672:6692", wins: 55, losses: 45, sample: 100 },
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 3, combinationKey: "3006:3031:6672", wins: 40, losses: 40, sample: 80 }
    ]);
    await isolated.db.insert(bootsAggregates).values([
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 3006, wins: 60, losses: 40, sample: 100 },
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 3111, wins: 40, losses: 40, sample: 80 }
    ]);
  });

  afterAll(async () => { await isolated?.close(); });

  it("returns only the active publication and never private identifiers", async () => {
    const queries = createPublicQueries(isolated.db);
    const response = await queries.stats({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false });
    expect("code" in response).toBe(false);
    if ("code" in response) return;
    expect(response.rows.every((row) => row.sample >= response.minimumSample)).toBe(true);
    expect(JSON.stringify(response)).not.toMatch(/puuid|matchId|riotApiKey|rawFinalSlots|errorDetails/i);
  });

  it("serves every view and sort with strict response contracts", async () => {
    const queries = createPublicQueries(isolated.db);
    for (const view of ["items", "pairs", "trios", "boots"] as const) {
      for (const sort of ["adjusted", "winRate", "buildRate", "sample"] as const) {
        const response = await queries.stats({ championId: 222, role: "BOTTOM", view, sort, includeLowConfidence: true });
        expect("code" in response).toBe(false);
        if (!("code" in response)) publicStatsResponseSchema.parse(response);
      }
    }
    const hidden = await queries.stats({ championId: 222, role: "BOTTOM", view: "items", sort: "sample", includeLowConfidence: false });
    const shown = await queries.stats({ championId: 222, role: "BOTTOM", view: "items", sort: "sample", includeLowConfidence: true });
    if (!("code" in hidden) && !("code" in shown)) {
      expect(hidden.rows.every((row) => row.sample >= hidden.minimumSample)).toBe(true);
      expect(shown.rows.some((row) => row.sample < shown.minimumSample)).toBe(true);
    }
  });

  it("matches the independent key oracle for every view, sort, and confidence flag", async () => {
    const sourceByView: Record<"items" | "pairs" | "trios" | "boots", FixtureStat[]> = {
      items: [
        { key: "3031", wins: 60, losses: 40, sample: 100 },
        { key: "6672", wins: 40, losses: 40, sample: 80 }
      ],
      pairs: [
        { key: "3031:6672", wins: 60, losses: 40, sample: 100 },
        { key: "3031:6692", wins: 40, losses: 40, sample: 80 }
      ],
      trios: [
        { key: "3031:6672:6692", wins: 55, losses: 45, sample: 100 },
        { key: "3006:3031:6672", wins: 40, losses: 40, sample: 80 }
      ],
      boots: [
        { key: "3006", wins: 60, losses: 40, sample: 100 },
        { key: "3111", wins: 40, losses: 40, sample: 80 }
      ]
    };
    const expectedKeys: Record<keyof typeof sourceByView, Record<Sort, Record<"false" | "true", string[]>>> = {
      items: {
        adjusted: { false: ["3031"], true: ["3031", "6672"] },
        winRate: { false: ["3031"], true: ["3031", "6672"] },
        buildRate: { false: ["3031"], true: ["3031", "6672"] },
        sample: { false: ["3031"], true: ["3031", "6672"] }
      },
      pairs: {
        adjusted: { false: ["3031:6672"], true: ["3031:6672", "3031:6692"] },
        winRate: { false: ["3031:6672"], true: ["3031:6672", "3031:6692"] },
        buildRate: { false: ["3031:6672"], true: ["3031:6672", "3031:6692"] },
        sample: { false: ["3031:6672"], true: ["3031:6672", "3031:6692"] }
      },
      trios: {
        adjusted: { false: ["3031:6672:6692"], true: ["3031:6672:6692", "3006:3031:6672"] },
        winRate: { false: ["3031:6672:6692"], true: ["3031:6672:6692", "3006:3031:6672"] },
        buildRate: { false: ["3031:6672:6692"], true: ["3031:6672:6692", "3006:3031:6672"] },
        sample: { false: ["3031:6672:6692"], true: ["3031:6672:6692", "3006:3031:6672"] },
      },
      boots: {
        adjusted: { false: ["3006"], true: ["3006", "3111"] },
        winRate: { false: ["3006"], true: ["3006", "3111"] },
        buildRate: { false: ["3006"], true: ["3006", "3111"] },
        sample: { false: ["3006"], true: ["3006", "3111"] }
      }
    };
    for (const view of ["items", "pairs", "trios", "boots"] as const) {
      for (const sort of ["adjusted", "winRate", "buildRate", "sample"] as const) {
        for (const includeLowConfidence of [false, true] as const) {
          const response = await createPublicQueries(isolated.db).stats({ championId: 222, role: "BOTTOM", view, sort, includeLowConfidence });
          expect("code" in response).toBe(false);
          if ("code" in response) continue;
          const independent = independentReference(sourceByView[view], sort, includeLowConfidence).map((row) => row.key);
          expect(independent).toEqual(expectedKeys[view][sort][String(includeLowConfidence) as "false" | "true"]);
          expect(response.rows.map((row) => row.key)).toEqual(independent);
        }
      }
    }
  });

  it("keeps the exact top 100 for every sort when SQL bounds a mixed-confidence candidate set", async () => {
    const candidateIds = Array.from({ length: 130 }, (_, index) => 7000 + index);
    await isolated.db.insert(items).values(candidateIds.map((itemId) => ({
      patchId: activePatchId,
      itemId,
      normalizedBaseId: itemId,
      category: "CORE" as const,
      classificationReason: "test-top-100",
      name: `Candidate ${itemId}`,
      price: 100,
      iconUrl: `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/${itemId}.png`
    })));
    await isolated.db.insert(itemAggregates).values(candidateIds.map((itemId, index) => ({
      publicationId: activePublicationId,
      championId: 222,
      role: "BOTTOM" as const,
      itemId,
      wins: index === 0 ? 99 : index < 90 ? 45 + (index % 53) : 49,
      losses: index === 0 ? 1 : index < 90 ? (100 + (index % 7)) - (45 + (index % 53)) : 50,
      sample: index === 0 ? 100 : index < 90 ? 100 + (index % 7) : 99
    })));
    try {
      const fixtureRows: FixtureStat[] = [
        { key: "3031", wins: 60, losses: 40, sample: 100 },
        { key: "6672", wins: 40, losses: 40, sample: 80 },
        ...candidateIds.map((itemId, index) => ({
          key: String(itemId),
          wins: index === 0 ? 99 : index < 90 ? 45 + (index % 53) : 49,
          losses: index === 0 ? 1 : index < 90 ? (100 + (index % 7)) - (45 + (index % 53)) : 50,
          sample: index === 0 ? 100 : index < 90 ? 100 + (index % 7) : 99
        }))
      ];
      expect(fixtureRows.length).toBeGreaterThan(100);
      for (const sort of ["adjusted", "winRate", "buildRate", "sample"] as const) {
        for (const includeLowConfidence of [true, false]) {
          const expected = independentReference(fixtureRows, sort, includeLowConfidence);
          const response = await createPublicQueries(isolated.db).stats({ championId: 222, role: "BOTTOM", view: "items", sort, includeLowConfidence });
          expect("code" in response).toBe(false);
          if ("code" in response) continue;
          expect(response.rows.map((row) => row.key)).toEqual(expected.map((row) => row.key));
          expect(response.rows).toHaveLength(Math.min(100, expected.length));
          expect(response.rows[0]?.key).toBe(expected[0]?.key);
          expect(response.rows.at(-1)?.key).toBe(expected.at(-1)?.key);
          expect(response.rows[99]?.key).toBe(expected[99]?.key);
          expect(response.rows.some((row) => row.confidence === "low")).toBe(expected.some((row) => row.sample < 100));
          const WilsonReference = referenceWilsonLower(99, 100);
          expect(response.rows.find((row) => row.key === "7000")?.adjustedScore).toBeCloseTo(WilsonReference, 12);
        }
      }
    } finally {
      await isolated.db.delete(itemAggregates).where(inArray(itemAggregates.itemId, candidateIds));
      await isolated.db.delete(items).where(inArray(items.itemId, candidateIds));
    }
  });

  it("returns all available champion roles and rejects champions without aggregates", async () => {
    const queries = createPublicQueries(isolated.db);
    const champion = await queries.champion(222);
    expect("code" in champion).toBe(false);
    if (!("code" in champion)) expect(champion.roles).toEqual(["BOTTOM", "UTILITY"]);
    expect(await queries.champion(999)).toEqual({ code: "champion_not_found" });
    publicChampionSchema.parse(champion);
  });

  it("uses C collation for digit and colon tie keys", async () => {
    const tieKeys = ["10:20", "1:10", "1:2", "1:20"];
    await isolated.db.insert(combinationAggregates).values(tieKeys.map((combinationKey) => ({
      publicationId: activePublicationId,
      championId: 222,
      role: "BOTTOM" as const,
      size: 2,
      combinationKey,
      wins: 50,
      losses: 50,
      sample: 100
    })));
    try {
      const response = await createPublicQueries(isolated.db).stats({ championId: 222, role: "BOTTOM", view: "pairs", sort: "sample", includeLowConfidence: true });
      expect("code" in response).toBe(false);
      if (!("code" in response)) expect(response.rows.slice(0, tieKeys.length).map((row) => row.key)).toEqual(tieKeys);
    } finally {
      await isolated.db.delete(combinationAggregates).where(inArray(combinationAggregates.combinationKey, tieKeys));
    }
  });

  it("bounds search and isolates stale publication data", async () => {
    const queries = createPublicQueries(isolated.db);
    const rows = await queries.champions("JINX");
    expect(rows).toHaveLength(1);
    if ("code" in rows) throw new Error(`unexpected query error: ${rows.code}`);
    publicChampionSummarySchema.parse(rows[0]);
    const source = await isolated.db.execute("SELECT pg_get_viewdef('public_item_stats'::regclass, true) AS definition" as never) as Array<{ definition: string }>;
    expect(JSON.stringify(source)).not.toMatch(/puuid|match_id|raw_final_slots|error_details|riot_api_key/i);
  });

  it("reports warming when the active pointer is removed", async () => {
    try {
      await isolated.db.execute("UPDATE patches SET active_publication_id = NULL" as never);
      await expect(createPublicQueries(isolated.db).meta()).resolves.toEqual({ code: "dataset_warming" });
    } finally {
      await isolated.db.execute("UPDATE patches SET active_publication_id = (SELECT id FROM aggregate_publications WHERE is_active = true)" as never);
    }
  });

  it("returns strict methodology output", async () => {
    publicMethodologySchema.parse(await createPublicQueries(isolated.db).methodology());
  });
});
