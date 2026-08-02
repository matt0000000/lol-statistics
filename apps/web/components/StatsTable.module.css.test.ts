import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "StatsTable.module.css"), "utf8");

describe("responsive evidence table CSS", () => {
  it("switches to cards above the site's narrow layout and constrains grid content", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*9(?:[0-5]\d|[6-9]\d)px\)/);
    expect(css).toContain("grid-template-columns: minmax(7.5rem, 42%) minmax(0, 1fr)");
    expect(css).toContain("max-width: 100%");
    expect(css).not.toContain("max-width: 719px");
  });
});
