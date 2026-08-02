import { describe, expect, it } from "vitest";
import { dataDragonAssetUrl } from "./asset-url";

describe("dataDragonAssetUrl", () => {
  it.each([
    ["16.15.1", "champion", "Jinx.png", "https://ddragon.leagueoflegends.com/cdn/16.15.1/img/champion/Jinx.png"],
    ["16.15.1", "item", "3031.png", "https://ddragon.leagueoflegends.com/cdn/16.15.1/img/item/3031.png"],
    ["14.24.1", "item", "3006.png", "https://ddragon.leagueoflegends.com/cdn/14.24.1/img/item/3006.png"]
  ] as const)("constructs the canonical %s URL for the exact Data Dragon version", (version, resource, filename, expected) => {
    expect(dataDragonAssetUrl(version, resource, filename)).toBe(expected);
  });

  it("preserves patch components and encodes the filename path segment", () => {
    expect(dataDragonAssetUrl("16.15.1", "champion", "Aatrox skin 1.png")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.15.1/img/champion/Aatrox%20skin%201.png"
    );
  });

  it.each([
    "",
    "16",
    "16.15/../secret",
    "16.15.1?evil=1",
    "16.15.1#fragment",
    "16.15.1\u0000"
  ])("rejects an unsafe or empty version (%s)", (version) => {
    expect(() => dataDragonAssetUrl(version, "item", "3031.png")).toThrow();
  });

  it.each([
    "",
    ".",
    "..",
    "../secret.png",
    "dir/item.png",
    "dir\\item.png",
    "https://evil.example/item.png",
    "data:text.png",
    "HTTP:evil.png",
    "mailto:user@example.com",
    "mIxEd+scheme:payload.png",
    "item.png?x=1",
    "item.png#x",
    "item.png\u0000",
    "item%2F.png",
    "item%2f.png",
    "item%41.png"
  ]) (
    "rejects an unsafe or empty filename (%s)",
    (filename) => {
      expect(() => dataDragonAssetUrl("16.15.1", "item", filename)).toThrow();
    }
  );

  it("encodes a safe literal percent in a raw Data Dragon filename", () => {
    expect(dataDragonAssetUrl("16.15.1", "item", "100%.png")).toBe(
      "https://ddragon.leagueoflegends.com/cdn/16.15.1/img/item/100%25.png"
    );
  });

  it("rejects an unknown resource path", () => {
    expect(() => dataDragonAssetUrl("16.15.1", "spell" as "item", "foo.png")).toThrow();
  });
});
