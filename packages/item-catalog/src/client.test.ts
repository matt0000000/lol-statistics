import { describe, expect, it, vi } from "vitest";
import { DataDragonClient } from "./client";
import { loadChampionFixture, loadItemFixture, loadRealmFixture } from "./contracts";
import realmFixture from "../../../fixtures/riot/tr-realm-16.15.1.json";
import championFixture from "../../../fixtures/riot/ddragon-champions-16.15.1.json";
import itemFixture from "../../../fixtures/riot/ddragon-items-16.15.1.json";
import itemAliasesFixture from "../../../fixtures/riot/item-aliases-16.15.1.json";

describe("DataDragonClient", () => {
  it("uses the TR realm version for both catalogs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    const client = new DataDragonClient(fetcher);
    const result = await client.fetchTrCatalog();
    expect(result.version).toBe("16.15.1");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://ddragon.leagueoflegends.com/realms/tr.json",
      "https://ddragon.leagueoflegends.com/cdn/16.15.1/data/tr_TR/champion.json",
      "https://ddragon.leagueoflegends.com/cdn/16.15.1/data/tr_TR/item.json"
    ]);
  });

  it("parses stable champion keys and enriches item keys as numbers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { Aatrox: { id: "Aatrox", key: "266", name: "Aatrox", image: { full: "Aatrox.png" } } }
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: {
          "3031": {
            name: "Ebedi Kılıç",
            description: "",
            gold: { base: 725, total: 3500, sell: 2450, purchasable: true },
            into: [],
            from: [],
            tags: ["Damage"],
            maps: { "11": true },
            purchasable: true,
            image: { full: "3031.png" }
          }
        }
      })));

    const result = await new DataDragonClient(fetcher).fetchTrCatalog();
    expect(result.champions.Aatrox.key).toBe(266);
    expect(result.items[0].id).toBe(3031);
  });

  it("rejects a catalog record whose key is not a numeric item id", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { invalid: {
        name: "Invalid", description: "", gold: { base: 0, total: 0, sell: 0, purchasable: false },
        into: [], from: [], tags: [], maps: { "11": true }, purchasable: false, image: { full: "invalid.png" }
      } } })));

    await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow();
  });

  it("validates fixture boundaries", () => {
    expect(loadRealmFixture({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" }).dd).toBe("16.15.1");
    expect(loadChampionFixture({ data: { A: { id: "A", key: "1", name: "A", image: { full: "A.png" } } } }).data.A.key).toBe(1);
    expect(() => loadItemFixture({ data: { bad: { name: "missing fields" } } })).toThrow();
    expect(() => loadChampionFixture({ data: { A: { id: "A", key: "9007199254740993", name: "A", image: { full: "A.png" } } } })).toThrow();
    expect(() => loadChampionFixture({ data: { A: { id: "A", key: "01", name: "A", image: { full: "A.png" } } } })).toThrow();
  });

  it("accepts the sanitized 16.15.1 fixtures", () => {
    expect(loadRealmFixture(realmFixture).v).toBe("16.15.1");
    expect(Object.keys(loadChampionFixture(championFixture).data)).toEqual(["Aatrox"]);
    const items = loadItemFixture(itemFixture).data;
    expect(Object.keys(items)).toHaveLength(10);
    expect(itemAliasesFixture["7002"]).toBe(3031);
    expect(items["220000"].maps["11"]).toBe(false);
  });

  it("attaches only the versioned aliases for the active TR patch", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    await expect(new DataDragonClient(fetcher).fetchTrCatalog()).resolves.toMatchObject({ aliases: { 7002: 3031 } });

    const unknownFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.16.1", dd: "16.16.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    await expect(new DataDragonClient(unknownFetcher).fetchTrCatalog()).resolves.toMatchObject({ aliases: {} });
  });

  it.each([
    "http://ddragon.leagueoflegends.com",
    "https://evil.example",
    "https://user:pass@ddragon.leagueoflegends.com/cdn",
    "https://ddragon.leagueoflegends.com:443/cdn",
    "https://ddragon.leagueoflegends.com/cdn?x=1",
    "https://ddragon.leagueoflegends.com/cdn#fragment",
    "https://ddragon.leagueoflegends.com/assets"
  ])("rejects a non-official realm CDN (%s)", async (cdn) => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn })));
    await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow("official Data Dragon CDN");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts the official CDN base with one trailing slash", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn/" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    await expect(new DataDragonClient(fetcher).fetchTrCatalog()).resolves.toMatchObject({ version: "16.15.1" });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://ddragon.leagueoflegends.com/cdn/16.15.1/data/tr_TR/champion.json");
  });

  it.each([".", "..", "tr/TR", "tr\\TR", "tr%2FTR", "tr_TR/../secret", "tr_TR\u0000"]) (
    "rejects an unsafe realm locale segment (%s)",
    async (locale) => {
      const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
        v: "16.15.1", dd: "16.15.1", l: locale, cdn: "https://ddragon.leagueoflegends.com/cdn"
      })));
      await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );

  it.each(["1e3", "0x10", "+1", " 1"]) (
    "rejects a non-canonical item record key (%s)",
    async (key) => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: { [key]: {
          name: "Invalid", description: "", gold: { base: 0, total: 0, sell: 0, purchasable: false },
          into: [], from: [], tags: [], maps: { "11": true }, purchasable: false, image: { full: "invalid.png" }
        } } })));

      await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow();
    }
  );

  it.each(["01", "001", "000"]) (
    "rejects a leading-zero item record key (%s)",
    async (key) => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ data: { [key]: {
          name: "Invalid", description: "", gold: { base: 0, total: 0, sell: 0, purchasable: false },
          into: [], from: [], tags: [], maps: { "11": true }, purchasable: false, image: { full: "invalid.png" }
        } } })));

      await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow();
    }
  );

  it("rejects colliding and unsafe item record keys", async () => {
    const item = {
      name: "Invalid", description: "", gold: { base: 0, total: 0, sell: 0, purchasable: false },
      into: [], from: [], tags: [], maps: { "11": true }, purchasable: false, image: { full: "invalid.png" }
    };
    const collidingFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { "1": item, "01": item } })));
    await expect(new DataDragonClient(collidingFetcher).fetchTrCatalog()).rejects.toThrow();

    const unsafeFetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://ddragon.leagueoflegends.com/cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { "9007199254740993": item } })));
    await expect(new DataDragonClient(unsafeFetcher).fetchTrCatalog()).rejects.toThrow();
  });
});
