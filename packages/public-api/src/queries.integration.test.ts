import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aggregatePublications, baselineAggregates, bootsAggregates, champions, collectionRuns, combinationAggregates, createMigratedTestDatabase, itemAggregates, items, patches } from "@lol/database";
import { createPublicQueries } from "./queries";
import { publicChampionSchema, publicChampionSummarySchema, publicMethodologySchema, publicStatsResponseSchema } from "./contracts";

const sourceUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!sourceUrl);

integration("public views and query repository", () => {
  let isolated: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

  beforeAll(async () => {
    isolated = await createMigratedTestDatabase(sourceUrl!);
    const [stalePatch] = await isolated.db.insert(patches).values({ version: "16.15.1", patchKey: "16.15", isActive: false }).returning({ id: patches.id });
    const [patch] = await isolated.db.insert(patches).values({ version: "16.16.1", patchKey: "16.16", isActive: true }).returning({ id: patches.id });
    const [staleRun] = await isolated.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish" }).returning({ id: collectionRuns.id });
    await isolated.db.insert(aggregatePublications).values({ patchId: stalePatch!.id, runId: staleRun!.id, coverageStartedAt: new Date("2026-07-01T00:00:00Z"), isActive: false });
    const [run] = await isolated.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish", minimumSample: 100 }).returning({ id: collectionRuns.id });
    const [publication] = await isolated.db.insert(aggregatePublications).values({ patchId: patch!.id, runId: run!.id, coverageStartedAt: new Date("2026-08-01T00:00:00Z"), collectedAt: new Date("2026-08-02T00:00:00Z"), isActive: true }).returning({ id: aggregatePublications.id });
    await isolated.db.update(patches).set({ activePublicationId: publication!.id, publishedAt: new Date("2026-08-02T00:00:00Z") }).where(eq(patches.id, patch!.id));
    await isolated.db.insert(champions).values([
      { patchId: patch!.id, championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Jinx.png" },
      { patchId: patch!.id, championId: 1, slug: "annie", name: "Annie", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Annie.png" }
    ]);
    await isolated.db.insert(items).values([3031, 6672, 6692, 3006].map((itemId) => ({ patchId: patch!.id, itemId, normalizedBaseId: itemId, category: itemId === 3006 ? "BOOTS" as const : "CORE" as const, classificationReason: "test", name: `Item ${itemId}`, price: 100, iconUrl: `https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/${itemId}.png` })));
    await isolated.db.insert(baselineAggregates).values([
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", wins: 60, losses: 40, sample: 100 },
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
      { publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 3, combinationKey: "3031:6672:6692", wins: 55, losses: 45, sample: 100 }
    ]);
    await isolated.db.insert(bootsAggregates).values({ publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 3006, wins: 60, losses: 40, sample: 100 });
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

  it("returns all available champion roles and rejects champions without aggregates", async () => {
    const queries = createPublicQueries(isolated.db);
    const champion = await queries.champion(222);
    expect("code" in champion).toBe(false);
    if (!("code" in champion)) expect(champion.roles).toEqual(["BOTTOM", "UTILITY"]);
    expect(await queries.champion(999)).toEqual({ code: "champion_not_found" });
    publicChampionSchema.parse(champion);
  });

  it("bounds search and isolates stale publication data", async () => {
    const queries = createPublicQueries(isolated.db);
    const rows = await queries.champions("JINX");
    expect(rows).toHaveLength(1);
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
