import { describe, expect, it, vi } from "vitest";
import { DataDragonClient } from "./client";
import { loadChampionFixture, loadItemFixture, loadRealmFixture } from "./contracts";
import realmFixture from "../../../fixtures/riot/tr-realm-16.15.1.json";
import championFixture from "../../../fixtures/riot/ddragon-champions-16.15.1.json";
import itemFixture from "../../../fixtures/riot/ddragon-items-16.15.1.json";

describe("DataDragonClient", () => {
  it("uses the TR realm version for both catalogs", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })));
    const client = new DataDragonClient(fetcher);
    const result = await client.fetchTrCatalog();
    expect(result.version).toBe("16.15.1");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      "https://ddragon.leagueoflegends.com/realms/tr.json",
      "https://cdn/16.15.1/data/tr_TR/champion.json",
      "https://cdn/16.15.1/data/tr_TR/item.json"
    ]);
  });

  it("parses stable champion keys and enriches item keys as numbers", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://cdn" })))
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://cdn" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { invalid: {
        name: "Invalid", description: "", gold: { base: 0, total: 0, sell: 0, purchasable: false },
        into: [], from: [], tags: [], maps: { "11": true }, purchasable: false, image: { full: "invalid.png" }
      } } })));

    await expect(new DataDragonClient(fetcher).fetchTrCatalog()).rejects.toThrow();
  });

  it("validates fixture boundaries", () => {
    expect(loadRealmFixture({ v: "16.15.1", dd: "16.15.1", l: "tr_TR", cdn: "https://cdn" }).dd).toBe("16.15.1");
    expect(loadChampionFixture({ data: { A: { id: "A", key: "1", name: "A", image: { full: "A.png" } } } }).data.A.key).toBe(1);
    expect(() => loadItemFixture({ data: { bad: { name: "missing fields" } } })).toThrow();
  });

  it("accepts the sanitized 16.15.1 fixtures", () => {
    expect(loadRealmFixture(realmFixture).v).toBe("16.15.1");
    expect(Object.keys(loadChampionFixture(championFixture).data)).toEqual(["Aatrox"]);
    const items = loadItemFixture(itemFixture).data;
    expect(Object.keys(items)).toHaveLength(11);
    expect(items["7002"].maps["11"]).toBe(true);
    expect(items["220000"].maps["11"]).toBe(false);
  });
});
