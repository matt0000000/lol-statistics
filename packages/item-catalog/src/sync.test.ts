import { describe, expect, it } from "vitest";
import { itemDtoSchema, parseChampionCatalog, parseItemCatalog } from "./contracts";
import championFixture from "../../../fixtures/riot/ddragon-champions-16.15.1.json";
import itemFixture from "../../../fixtures/riot/ddragon-items-16.15.1.json";
import { canonicalizeCatalogAssets, patchPublicationTransition, PATCH_ROLLOVER_LOCK_ORDER } from "./sync";

describe("patch publication rollover", () => {
  it("clears publication ownership and timestamp on every deactivated patch", () => {
    expect(patchPublicationTransition(false)).toEqual({ activePublicationId: null, publishedAt: null });
  });

  it("preserves publication ownership during same-patch refresh", () => {
    expect(patchPublicationTransition(true)).toEqual({});
  });

  it("locks global active publications before patch rows", () => {
    expect(PATCH_ROLLOVER_LOCK_ORDER).toEqual(["active_publications", "patches"]);
  });
});

describe("catalog asset URLs", () => {
  it("canonicalizes real champion and item fixture filenames for public URL contracts", () => {
    const champions = parseChampionCatalog(championFixture).data;
    const parsedItems = parseItemCatalog(itemFixture).data;
    const items = Object.entries(parsedItems).map(([id, item]) => itemDtoSchema.parse({ ...item, id: Number(id) }));
    const catalog = canonicalizeCatalogAssets({ version: "16.15.1", locale: "tr_TR", champions, items, aliases: {} });

    expect(catalog.champions.Aatrox?.image.full).toBe("https://ddragon.leagueoflegends.com/cdn/16.15.1/img/champion/Aatrox.png");
    expect(catalog.items.find((item) => item.id === 3031)?.image.full).toBe("https://ddragon.leagueoflegends.com/cdn/16.15.1/img/item/3031.png");
    expect(() => new URL(catalog.champions.Aatrox!.image.full)).not.toThrow();
    expect(catalog.items.every((item) => new URL(item.image.full).hostname === "ddragon.leagueoflegends.com")).toBe(true);
  });

  it("rejects arbitrary image origins before a catalog can be persisted", () => {
    expect(() => canonicalizeCatalogAssets({
      version: "16.15.1",
      locale: "tr_TR",
      champions: { Aatrox: { id: "Aatrox", key: 266, name: "Aatrox", image: { full: "https://evil.example/Aatrox.png" } } },
      items: [],
      aliases: {}
    })).toThrow();
  });
});
