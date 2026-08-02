import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { aggregatePublications, baselineAggregates, bootsAggregates, champions, collectionRuns, combinationAggregates, createMigratedTestDatabase, itemAggregates, items, patches } from "@lol/database";
import { createPublicQueries } from "./queries";

const sourceUrl = process.env.TEST_DATABASE_URL;
const integration = describe.skipIf(!sourceUrl);

integration("public views and query repository", () => {
  let isolated: Awaited<ReturnType<typeof createMigratedTestDatabase>>;

  beforeAll(async () => {
    isolated = await createMigratedTestDatabase(sourceUrl!);
    const [patch] = await isolated.db.insert(patches).values({ version: "16.16.1", patchKey: "16.16", isActive: true }).returning({ id: patches.id });
    const [run] = await isolated.db.insert(collectionRuns).values({ status: "COMPLETED", stage: "publish" }).returning({ id: collectionRuns.id });
    const [publication] = await isolated.db.insert(aggregatePublications).values({ patchId: patch!.id, runId: run!.id, coverageStartedAt: new Date("2026-08-01T00:00:00Z"), collectedAt: new Date("2026-08-02T00:00:00Z"), isActive: true }).returning({ id: aggregatePublications.id });
    await isolated.db.update(patches).set({ activePublicationId: publication!.id, publishedAt: new Date("2026-08-02T00:00:00Z") }).where(eq(patches.id, patch!.id));
    await isolated.db.insert(champions).values({ patchId: patch!.id, championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/champion/Jinx.png" });
    await isolated.db.insert(items).values({ patchId: patch!.id, itemId: 3031, normalizedBaseId: 3031, category: "CORE", classificationReason: "test", name: "Infinity Edge", price: 100, iconUrl: "https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/3031.png" });
    await isolated.db.insert(baselineAggregates).values({ publicationId: publication!.id, championId: 222, role: "BOTTOM", wins: 60, losses: 40, sample: 100 });
    await isolated.db.insert(itemAggregates).values({ publicationId: publication!.id, championId: 222, role: "BOTTOM", itemId: 3031, wins: 60, losses: 40, sample: 100 });
    await isolated.db.insert(combinationAggregates).values({ publicationId: publication!.id, championId: 222, role: "BOTTOM", size: 2, combinationKey: "3031:6672", wins: 60, losses: 40, sample: 100 });
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

  it("reports warming when the active pointer is removed", async () => {
    await isolated.db.execute("UPDATE patches SET active_publication_id = NULL" as never);
    await expect(createPublicQueries(isolated.db).meta()).resolves.toEqual({ code: "dataset_warming" });
  });
});
