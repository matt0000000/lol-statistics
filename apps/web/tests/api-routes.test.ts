import { describe, expect, it } from "vitest";
import { createRouteHandlers, type RouteQueries } from "../lib/api-routes";
import type { PublicChampion, PublicChampionSummary, PublicMeta, PublicMethodology, PublicStatsResponse } from "@lol/public-api";

const meta: PublicMeta = {
  patch: { version: "14.1.1", key: "14.1" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
  coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-01T01:00:00.000Z", collectedAt: "2026-08-01T01:00:00.000Z",
  minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish",
  counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
};
Object.defineProperty(meta, "publicationId", { value: "pub-1", enumerable: false });
const champion: PublicChampion = { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] };
const summary: PublicChampionSummary = { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", roles: ["BOTTOM"] };
const methodology: PublicMethodology = { version: "1", scope: meta.scope, formulas: { rawWinRate: "wins / sample", buildRate: "sample / baseline", baselineDelta: "raw - baseline", adjustedScore: "Wilson" }, minimumSample: 100, lowConfidence: "hidden", limitations: ["correlation"] };
const stats: PublicStatsResponse = { meta, champion, role: "BOTTOM", baseline: { wins: 50, losses: 50, sample: 100, winRate: 0.5 }, view: "items", sort: "adjusted", includeLowConfidence: false, minimumSample: 100, rows: [] };

function fakeQueries(overrides: Partial<RouteQueries> = {}): RouteQueries {
  return {
    meta: async () => meta,
    champions: async () => [summary],
    champion: async () => champion,
    stats: async () => stats,
    methodology: async () => methodology,
    ...overrides
  };
}

describe("public API route matrix", () => {
  it("imports production route wiring without opening a database at module load", async () => {
    const route = await import("../app/api/meta/route");
    expect(typeof route.GET).toBe("function");
  });

  it("returns dataset_warming as 503 with retry metadata", async () => {
    const routes = createRouteHandlers(fakeQueries({ meta: async () => ({ code: "dataset_warming" }) }));
    const response = await routes.meta(new Request("http://localhost/api/meta"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "dataset_warming", retryAfterSeconds: 300 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects an invalid role and view", async () => {
    const routes = createRouteHandlers(fakeQueries());
    const response = await routes.stats(new Request("http://localhost/api/champions/222/roles/ADC/stats?view=timeline"), { params: { championId: "222", role: "ADC" } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
  });

  it("requires canonical positive safe integer champion ids and rejects duplicate/unknown params", async () => {
    const routes = createRouteHandlers(fakeQueries());
    for (const id of ["01", "0", "1.0", "9007199254740992", "-1"]) {
      expect((await routes.champion(new Request(`http://localhost/api/champions/${id}`), { params: { championId: id } })).status).toBe(400);
    }
    expect((await routes.champions(new Request("http://localhost/api/champions?search=a&search=b"))).status).toBe(400);
    expect((await routes.champions(new Request("http://localhost/api/champions?wat=1"))).status).toBe(400);
  });

  it("applies stats defaults and returns immutable cache headers", async () => {
    let input: unknown;
    const routes = createRouteHandlers(fakeQueries({ stats: async (value) => { input = value; return stats; } }));
    const response = await routes.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } });
    expect(input).toMatchObject({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false });
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("etag")).toMatch(/^"publication-/);
  });

  it("supports exact, weak, and comma-separated If-None-Match values", async () => {
    const routes = createRouteHandlers(fakeQueries());
    const first = await routes.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } });
    const etag = first.headers.get("etag")!;
    for (const value of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const response = await routes.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats", { headers: { "If-None-Match": value } }), { params: { championId: "222", role: "BOTTOM" } });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
    }
  });

  it("serves searchable champions and publication-scoped champion metadata", async () => {
    const routes = createRouteHandlers(fakeQueries());
    const response = await routes.champions(new Request("http://localhost/api/champions?search=Jin%78"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([summary]);
    expect(response.headers.get("etag")).toContain("publication-pub-1");
    expect((await routes.champion(new Request("http://localhost/api/champions/222"), { params: { championId: "222" } })).status).toBe(200);
  });

  it("maps query errors and thrown upstream failures without leaking details", async () => {
    const routes = createRouteHandlers(fakeQueries({ champion: async () => ({ code: "champion_not_found" }), methodology: async () => { throw new Error("secret db details"); } }));
    const notFound = await routes.champion(new Request("http://localhost/api/champions/222"), { params: { championId: "222" } });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ code: "champion_not_found" });
    const internal = await routes.methodology(new Request("http://localhost/api/methodology"));
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ code: "internal_error" });
    expect(internal.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts explicit low-confidence opt-in and rejects malformed encoded paths", async () => {
    let input: any;
    const routes = createRouteHandlers(fakeQueries({ stats: async (value) => { input = value; return stats; } }));
    expect((await routes.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats?includeLowConfidence=true"), { params: { championId: "222", role: "BOTTOM" } })).status).toBe(200);
    expect(input.includeLowConfidence).toBe(true);
    expect((await routes.champion(new Request("http://localhost/api/champions/%32%32%32"), { params: { championId: "222" } })).status).toBe(400);
    expect((await routes.stats(new Request("http://localhost/api/champions/222/roles/%42OTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } })).status).toBe(400);
    expect((await routes.champions(new Request("http://localhost/api/champions?search=a&&"))).status).toBe(400);
  });
});
