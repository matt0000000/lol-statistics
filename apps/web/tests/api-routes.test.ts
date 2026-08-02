import { describe, expect, it } from "vitest";
import { createRouteHandlers, type RouteQueries } from "../lib/api-routes";
import { createPublicQueries, publicationScopeOf, type PublicChampion, type PublicChampionSummary, type PublicMeta, type PublicMethodology, type PublicStatsResponse } from "@lol/public-api";

const meta: PublicMeta = {
  patch: { version: "14.1.1", key: "14.1" }, scope: { platform: "TR1", queue: 420, rank: "EMERALD+" },
  coverageStartedAt: "2026-08-01T00:00:00.000Z", publishedAt: "2026-08-01T01:00:00.000Z", collectedAt: "2026-08-01T01:00:00.000Z",
  minimumSample: 100, datasetState: "ready", runStatus: "COMPLETED", stage: "publish",
  counters: { matchesDiscovered: 1, matchesIngested: 1, observationsAccepted: 1, observationsRejected: 0 }
};
const champion: PublicChampion = { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", splashUrl: null, roles: ["BOTTOM"] };
const summary: PublicChampionSummary = { championId: 222, slug: "jinx", name: "Jinx", iconUrl: "https://example.test/jinx.png", roles: ["BOTTOM"] };
const methodology: PublicMethodology = { version: "1", scope: meta.scope, formulas: { rawWinRate: "wins / sample", buildRate: "sample / baseline", baselineDelta: "raw - baseline", adjustedScore: "Wilson" }, minimumSample: 100, lowConfidence: "hidden", limitations: ["correlation"] };
const stats: PublicStatsResponse = { meta, champion, role: "BOTTOM", baseline: { wins: 50, losses: 50, sample: 100, winRate: 0.5 }, view: "items", sort: "adjusted", includeLowConfidence: false, minimumSample: 100, rows: [] };

const trustedScopes = new WeakMap<object, string>();
trustedScopes.set(meta, "pub-1");
trustedScopes.set(stats, "pub-1");
trustedScopes.set(champion, "pub-1");
trustedScopes.set(methodology, "pub-1");
const scopeOf = (value: unknown): string | undefined => value && typeof value === "object" ? trustedScopes.get(value) : undefined;

function fakeQueries(overrides: Partial<RouteQueries> = {}): RouteQueries {
  return {
    meta: async () => meta,
    champions: async () => { const value = [summary]; trustedScopes.set(value, "pub-1"); return value; },
    championDirectory: async () => { const value = [summary]; trustedScopes.set(value, "pub-1"); return value; },
    championBySlug: async () => champion,
    champion: async () => champion,
    stats: async () => stats,
    methodology: async () => methodology,
    ...overrides
  };
}

function routes(overrides: Partial<RouteQueries> = {}) { return createRouteHandlers(fakeQueries(overrides), { scopeOf }); }

describe("public API route matrix", () => {
  it("imports production route wiring without opening a database at module load", async () => {
    const route = await import("../app/api/meta/route");
    expect(typeof route.GET).toBe("function");
  });

  it("returns dataset_warming as 503 with retry metadata", async () => {
    const handlers = routes({ meta: async () => ({ code: "dataset_warming" }) });
    const response = await handlers.meta(new Request("http://localhost/api/meta"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "dataset_warming", retryAfterSeconds: 300 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the common security headers for method-not-allowed responses", async () => {
    const response = await routes().meta(new Request("http://localhost/api/meta", { method: "POST" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("vary")).toBe("Accept, If-None-Match");
  });

  it("returns a secured OPTIONS capability response without querying dependencies", async () => {
    const response = await routes().meta(new Request("http://localhost/api/meta", { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Accept, If-None-Match");
  });

  it("rejects an invalid role and view", async () => {
    const handlers = routes();
    const response = await handlers.stats(new Request("http://localhost/api/champions/222/roles/ADC/stats?view=timeline"), { params: { championId: "222", role: "ADC" } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_request" });
  });

  it("requires canonical positive safe integer champion ids and rejects duplicate/unknown params", async () => {
    const handlers = routes();
    for (const id of ["01", "0", "1.0", "9007199254740992", "-1"]) {
      expect((await handlers.champion(new Request(`http://localhost/api/champions/${id}`), { params: { championId: id } })).status).toBe(400);
    }
    expect((await handlers.champions(new Request("http://localhost/api/champions?search=a&search=b"))).status).toBe(400);
    expect((await handlers.champions(new Request("http://localhost/api/champions?wat=1"))).status).toBe(400);
  });

  it("applies stats defaults and returns immutable cache headers", async () => {
    let input: unknown;
    const handlers = routes({ stats: async (value) => { input = value; return stats; } });
    const response = await handlers.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } });
    expect(input).toMatchObject({ championId: 222, role: "BOTTOM", view: "items", sort: "adjusted", includeLowConfidence: false });
    expect(response.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=3600");
    expect(response.headers.get("etag")).toMatch(/^"publication-/);
  });

  it("supports exact, weak, and comma-separated If-None-Match values", async () => {
    const handlers = routes();
    const first = await handlers.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } });
    const etag = first.headers.get("etag")!;
    for (const value of [etag, `W/${etag}`, `"other", ${etag}`]) {
      const response = await handlers.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats", { headers: { "If-None-Match": value } }), { params: { championId: "222", role: "BOTTOM" } });
      expect(response.status).toBe(304);
      expect(await response.text()).toBe("");
    }
  });

  it("serves searchable champions and publication-scoped champion metadata", async () => {
    const handlers = routes();
    const response = await handlers.champions(new Request("http://localhost/api/champions?search=Jin%78"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([summary]);
    expect(response.headers.get("etag")).toContain("publication-pub-1");
    expect((await handlers.champion(new Request("http://localhost/api/champions/222"), { params: { championId: "222" } })).status).toBe(200);
  });

  it("maps query errors and thrown upstream failures without leaking details", async () => {
    const handlers = routes({ champion: async () => ({ code: "champion_not_found" }), methodology: async () => { throw new Error("secret db details"); } });
    const notFound = await handlers.champion(new Request("http://localhost/api/champions/222"), { params: { championId: "222" } });
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({ code: "champion_not_found" });
    const internal = await handlers.methodology(new Request("http://localhost/api/methodology"));
    expect(internal.status).toBe(500);
    expect(await internal.json()).toEqual({ code: "internal_error" });
    expect(internal.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts explicit low-confidence opt-in and rejects malformed encoded paths", async () => {
    let input: any;
    const handlers = routes({ stats: async (value) => { input = value; return stats; } });
    expect((await handlers.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats?includeLowConfidence=true"), { params: { championId: "222", role: "BOTTOM" } })).status).toBe(200);
    expect(input.includeLowConfidence).toBe(true);
    expect((await handlers.champion(new Request("http://localhost/api/champions/%32%32%32"), { params: { championId: "222" } })).status).toBe(400);
    expect((await handlers.stats(new Request("http://localhost/api/champions/222/roles/%42OTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } })).status).toBe(400);
    expect((await handlers.champions(new Request("http://localhost/api/champions?search=a&&"))).status).toBe(400);
  });

  it("accepts only literal boolean confidence flags", async () => {
    const handlers = routes();
    for (const value of ["1", "0", "yes", "TRUE"]) {
      const response = await handlers.stats(new Request(`http://localhost/api/champions/222/roles/BOTTOM/stats?includeLowConfidence=${value}`), { params: { championId: "222", role: "BOTTOM" } });
      expect(response.status).toBe(400);
    }
    for (const value of ["true", "false"]) {
      const response = await handlers.stats(new Request(`http://localhost/api/champions/222/roles/BOTTOM/stats?includeLowConfidence=${value}`), { params: { championId: "222", role: "BOTTOM" } });
      expect(response.status).toBe(200);
    }
  });

  it("fails closed for missing or forged publication markers", async () => {
    const forged = { ...meta } as Record<string, unknown>;
    Object.defineProperty(forged, "publicationId", { value: "attacker-pub", enumerable: false });
    const untrusted = createRouteHandlers({ ...fakeQueries(), meta: async () => forged as PublicMeta });
    expect((await untrusted.meta(new Request("http://localhost/api/meta"))).status).toBe(500);
    const missing = createRouteHandlers(fakeQueries(), { scopeOf: publicationScopeOf });
    expect((await missing.meta(new Request("http://localhost/api/meta"))).status).toBe(500);
  });

  it("keeps an empty champions result scoped by the same active-publication statement", async () => {
    const queries = createPublicQueries({ execute: async () => [{ publication_id: "pub-empty", champion_id: null }] });
    const handlers = createRouteHandlers(queries);
    const response = await handlers.champions(new Request("http://localhost/api/champions?search=missing"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
    expect(response.headers.get("etag")).toContain("publication-pub-empty");
  });

  it("uses parsed query scope for stats and returns deterministic methodology validators", async () => {
    const row = {
      patch_version: "16.16.1", patch_key: "16.16", coverage_started_at: "2026-08-01T00:00:00.000Z", published_at: "2026-08-02T00:00:00.000Z", collected_at: "2026-08-02T00:00:00.000Z", minimum_sample: 100, run_status: "COMPLETED", stage: "publish", matches_discovered: 1, matches_ingested: 1, observations_accepted: 1, observations_rejected: 0, publication_id: "pub-stats", selected_champion_id: 222, slug: "jinx", name: "Jinx", icon_url: "https://example.test/jinx.png", splash_url: null, roles: ["BOTTOM"], baseline_wins: 50, baseline_losses: 50, baseline_sample: 100, stat_key: null, champion_id: 222, role: "BOTTOM", wins: 0, losses: 0, sample: 0, item_ids: []
    };
    const queries = createPublicQueries({ execute: async () => [row] });
    const handlers = createRouteHandlers(queries);
    const statsResponse = await handlers.stats(new Request("http://localhost/api/champions/222/roles/BOTTOM/stats"), { params: { championId: "222", role: "BOTTOM" } });
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.headers.get("etag")).toContain("publication-pub-stats");
    const methodologyResponse = await handlers.methodology(new Request("http://localhost/api/methodology"));
    const etag = methodologyResponse.headers.get("etag")!;
    expect(etag).toMatch(/^"sha256-|^"content-/);
    expect((await handlers.methodology(new Request("http://localhost/api/methodology", { headers: { "If-None-Match": etag } }))).status).toBe(304);
  });
});
