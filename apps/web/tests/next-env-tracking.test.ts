import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Next generated type metadata", () => {
  it("is ignored rather than tracked so next dev cannot rewrite the worktree", () => {
    expect(readFileSync(".gitignore", "utf8")).toMatch(/^apps\/web\/next-env\.d\.ts$/m);
    expect(readFileSync("apps/web/tsconfig.json", "utf8")).toMatch(/\.next\/types\/\*\*\/\*\.ts/);
  });
});
